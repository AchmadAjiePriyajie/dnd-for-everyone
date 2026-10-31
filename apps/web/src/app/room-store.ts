import { useEffect, useSyncExternalStore } from 'react';
import { io } from 'socket.io-client';
import type { ApiError } from '#shared/access';
import type { CommandEnvelope, CommandResult, RoomChanged } from '#shared/commands';
import type { Id } from '#shared/contracts';
import type { RoomSnapshot } from '#shared/room';
import { api, ApiClientError, offlineError } from './api';

/**
 * idle: belum ada room dipantau; connecting/disconnected: tidak ada aksi;
 * syncing: tersambung, snapshot sedang diambil ulang; connected: aksi boleh.
 */
export type ConnectionStatus = 'idle' | 'connecting' | 'syncing' | 'connected' | 'disconnected';

export interface RoomEntry {
  snapshot?: RoomSnapshot;
  error?: ApiError;
}

/** State yang boleh dilihat UI. Hanya projection server; tidak ada kredensial. */
export interface RoomState {
  status: ConnectionStatus;
  rooms: Record<Id, RoomEntry>;
}

/** Bagian socket.io-client yang dipakai store; test memberi socket palsu. */
export interface RoomSocket {
  connected: boolean;
  on(event: string, fn: (...args: any[]) => void): unknown;
  off(event: string, fn: (...args: any[]) => void): unknown;
  emit(event: string, payload: unknown, ack?: (response: any) => void): unknown;
  disconnect(): unknown;
}

type SubscribeAck = { ok: true; eventSequence: number } | { ok: false; error: ApiError };

const defaultSocket = (): RoomSocket =>
  io({ path: '/socket.io', withCredentials: true, transports: ['websocket', 'polling'] }) as unknown as RoomSocket;

let createSocket: () => RoomSocket = defaultSocket;
let socket: RoomSocket | undefined;
let detach: (() => void) | undefined;
let state: RoomState = { status: 'idle', rooms: {} };
const listeners = new Set<() => void>();
const watchers = new Map<Id, number>();
/** Nomor request snapshot terakhir per campaign; respons lama diabaikan. */
const latestFetch = new Map<Id, number>();
let fetchCounter = 0;

/** Ping peta sementara dari peserta lain; tidak masuk snapshot. */
export interface MapPing {
  campaignId: Id;
  sceneId: Id;
  x: number;
  y: number;
  accountId: Id;
}
const pingListeners = new Set<(ping: MapPing) => void>();

export function onMapPing(listener: (ping: MapPing) => void): () => void {
  pingListeners.add(listener);
  return () => pingListeners.delete(listener);
}

function setState(next: RoomState): void {
  state = next;
  for (const listener of listeners) listener();
}

function patchRoom(campaignId: Id, entry: RoomEntry | undefined): void {
  const rooms = { ...state.rooms };
  if (entry) rooms[campaignId] = entry;
  else delete rooms[campaignId];
  setState({ ...state, rooms });
}

function setStatus(status: ConnectionStatus): void {
  if (state.status !== status) setState({ ...state, status });
}

export const roomStore = {
  getState: (): RoomState => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

async function fetchSnapshot(campaignId: Id): Promise<void> {
  const ticket = ++fetchCounter;
  latestFetch.set(campaignId, ticket);
  try {
    const snapshot = await api.snapshot(campaignId);
    if (latestFetch.get(campaignId) !== ticket || !watchers.has(campaignId)) return;
    patchRoom(campaignId, { snapshot });
  } catch (error) {
    if (latestFetch.get(campaignId) !== ticket || !watchers.has(campaignId)) return;
    const apiError = error instanceof ApiClientError ? error.error : { code: 'INTERNAL', params: {} };
    // Offline sementara: pertahankan snapshot terakhir; error akses menghapusnya.
    const keep = apiError.code === 'OFFLINE' ? state.rooms[campaignId]?.snapshot : undefined;
    patchRoom(campaignId, keep ? { snapshot: keep, error: apiError } : { error: apiError });
  }
}

function subscribeRoom(campaignId: Id): void {
  socket?.emit('room:subscribe', { campaignId }, (ack: SubscribeAck | undefined) => {
    if (ack && !ack.ok) patchRoom(campaignId, { error: ack.error });
  });
}

/** Setelah (re)connect: subscribe ulang lalu ambil snapshot sebelum aksi diizinkan. */
async function resync(): Promise<void> {
  setStatus('syncing');
  const campaigns = [...watchers.keys()];
  for (const campaignId of campaigns) subscribeRoom(campaignId);
  await Promise.all(campaigns.map(fetchSnapshot));
  if (socket?.connected && state.status === 'syncing') setStatus('connected');
}

function ensureSocket(): void {
  if (socket) return;
  const current = createSocket();
  socket = current;
  const onConnect = () => void resync();
  const onDisconnect = () => setStatus('disconnected');
  const onChanged = (message: RoomChanged) => {
    if (!message || !watchers.has(message.campaignId)) return;
    const known = state.rooms[message.campaignId]?.snapshot?.eventSequence ?? -1;
    if (message.eventSequence > known) void fetchSnapshot(message.campaignId);
  };
  const onRevoked = ({ campaignId }: { campaignId: Id }) => {
    if (watchers.has(campaignId)) patchRoom(campaignId, { error: { code: 'FORBIDDEN', params: {} } });
  };
  current.on('connect', onConnect);
  current.on('disconnect', onDisconnect);
  current.on('room:changed', onChanged);
  const onPing = (ping: MapPing) => {
    if (ping && watchers.has(ping.campaignId)) for (const listener of pingListeners) listener(ping);
  };
  current.on('room:access-revoked', onRevoked);
  current.on('map:ping', onPing);
  detach = () => {
    current.off('map:ping', onPing);
    current.off('connect', onConnect);
    current.off('disconnect', onDisconnect);
    current.off('room:changed', onChanged);
    current.off('room:access-revoked', onRevoked);
  };
  setStatus(current.connected ? 'syncing' : 'connecting');
  if (current.connected) void resync();
}

/** Mulai memantau room; kembalikan fungsi pelepas (reference counted). */
export function watchRoom(campaignId: Id): () => void {
  const count = watchers.get(campaignId) ?? 0;
  watchers.set(campaignId, count + 1);
  if (count === 0) {
    ensureSocket();
    if (socket?.connected) subscribeRoom(campaignId);
    void fetchSnapshot(campaignId);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (watchers.get(campaignId) ?? 1) - 1;
    if (left > 0) {
      watchers.set(campaignId, left);
      return;
    }
    watchers.delete(campaignId);
    latestFetch.delete(campaignId);
    if (socket?.connected) socket.emit('room:unsubscribe', { campaignId });
    patchRoom(campaignId, undefined);
  };
}

/** Ambil ulang snapshot, mis. setelah mutasi REST yang tidak diumumkan ke room. */
export function refreshRoom(campaignId: Id): Promise<void> {
  return watchers.has(campaignId) ? fetchSnapshot(campaignId) : Promise.resolve();
}

/**
 * Kirim command hanya saat tersambung dan sudah resync. Saat offline command
 * ditolak di client, tidak dikirim dan tidak diantrekan.
 */
export async function sendCommand(command: CommandEnvelope): Promise<CommandResult> {
  if (state.status !== 'connected' || !socket?.connected) throw offlineError();
  return api.command(command);
}

export function configureRoomStore(options: { createSocket?: () => RoomSocket }): void {
  if (options.createSocket) createSocket = options.createSocket;
}

/** Putus socket dan hapus seluruh state room (logout / antar test). */
export function resetRoomStore(): void {
  detach?.();
  detach = undefined;
  const current = socket;
  socket = undefined;
  current?.disconnect();
  watchers.clear();
  latestFetch.clear();
  createSocket = defaultSocket;
  setState({ status: 'idle', rooms: {} });
}

export function useRoomState(): RoomState {
  return useSyncExternalStore(roomStore.subscribe, roomStore.getState, roomStore.getState);
}

export function useConnectionStatus(): ConnectionStatus {
  return useRoomState().status;
}

export function useRoomEntry(campaignId: Id): RoomEntry | undefined {
  useEffect(() => watchRoom(campaignId), [campaignId]);
  return useRoomState().rooms[campaignId];
}

export function useRoom(campaignId: Id): RoomSnapshot | undefined {
  return useRoomEntry(campaignId)?.snapshot;
}
