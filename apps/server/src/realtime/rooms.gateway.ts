import type { IncomingMessage } from 'node:http';
import type { TLSSocket } from 'node:tls';
import { type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { ApiError, Principal } from '#shared/access';
import { roomSubscribeSchema, type RoomChanged } from '#shared/commands';
import { DomainError } from '../common/domain-error.js';
import { DomainEvents } from '../common/domain-events.js';
import { currentSequence } from '../commands/events.js';
import { DatabaseService } from '../db/database.service.js';
import { readCookie, SESSION_COOKIE } from '../features/auth/principal.js';
import { AuthService } from '../features/auth/service.js';
import { hashSecret } from '../features/campaigns/access.js';
import { CampaignsService } from '../features/campaigns/service.js';

interface SocketData {
  principal: Principal;
  token: string;
}

type SubscribeAck = { ok: true; eventSequence: number } | { ok: false; error: ApiError };

const campaignRoom = (campaignId: string) => `campaign:${campaignId}`;
const accountRoom = (accountId: string) => `account:${accountId}`;
const sessionRoom = (tokenHash: string) => `session:${tokenHash}`;

/** Handshake hanya dari origin yang sama dengan host (cek sebelum koneksi dibuat). */
export function allowSameOrigin(req: IncomingMessage, callback: (err: string | null, ok: boolean) => void): void {
  const origin = req.headers.origin;
  const host = req.headers.host;
  let ok = false;
  if (origin && host) {
    const protocol = (req.socket as TLSSocket).encrypted ? 'https' : 'http';
    try {
      ok = new URL(origin).origin === new URL(`${protocol}://${host}`).origin;
    } catch {
      ok = false;
    }
  }
  callback(null, ok);
}

@WebSocketGateway({ path: '/socket.io', serveClient: false, allowRequest: allowSameOrigin })
export class RoomsGateway implements OnGatewayConnection, OnModuleInit, OnModuleDestroy {
  @WebSocketServer() server!: Server;
  private readonly unsubscribe: Array<() => void> = [];

  constructor(
    private readonly auth: AuthService,
    private readonly campaigns: CampaignsService,
    private readonly database: DatabaseService,
    private readonly events: DomainEvents,
  ) {}

  onModuleInit(): void {
    this.unsubscribe.push(
      this.events.on('room.changed', (event) => {
        const message: RoomChanged = { campaignId: event.campaignId, eventSequence: event.eventSequence };
        this.server?.to(campaignRoom(event.campaignId)).emit('room:changed', message);
      }),
      this.events.on('member.removed', ({ campaignId, accountId }) => {
        if (!this.server) return;
        this.server.in(accountRoom(accountId)).socketsLeave(campaignRoom(campaignId));
        this.server.to(accountRoom(accountId)).emit('room:access-revoked', { campaignId });
      }),
      this.events.on('session.revoked', ({ tokenHash }) => {
        this.server?.in(sessionRoom(tokenHash)).disconnectSockets(true);
      }),
    );
  }

  onModuleDestroy(): void {
    for (const off of this.unsubscribe.splice(0)) off();
  }

  /** Sesi diperiksa saat handshake; tanpa sesi valid socket langsung diputus. */
  handleConnection(socket: Socket): void {
    const token = readCookie(socket.handshake.headers.cookie, SESSION_COOKIE);
    const principal = this.auth.resolveSession(token);
    if (!principal || !token) {
      socket.disconnect(true);
      return;
    }
    (socket.data as SocketData) = { principal, token };
    void socket.join([accountRoom(principal.accountId), sessionRoom(hashSecret(token))]);
  }

  @SubscribeMessage('room:subscribe')
  subscribe(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): SubscribeAck {
    try {
      const data = socket.data as SocketData | undefined;
      // Sesi dicek ulang: logout/expiry setelah handshake tetap berlaku.
      if (!data || !this.auth.resolveSession(data.token)) throw new DomainError('UNAUTHENTICATED', 401);
      const parsed = roomSubscribeSchema.safeParse(body);
      if (!parsed.success) throw new DomainError('VALIDATION_FAILED', 400);
      const { campaignId } = parsed.data;
      this.campaigns.requireMember(data.principal, campaignId);
      void socket.join(campaignRoom(campaignId));
      return { ok: true, eventSequence: currentSequence(this.database.getHandle(), campaignId) };
    } catch (error) {
      if (error instanceof DomainError) return { ok: false, error: error.toApiError() };
      return { ok: false, error: { code: 'INTERNAL', params: {} } };
    }
  }

  @SubscribeMessage('room:unsubscribe')
  leave(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): { ok: true } {
    const parsed = roomSubscribeSchema.safeParse(body);
    if (parsed.success) void socket.leave(campaignRoom(parsed.data.campaignId));
    return { ok: true };
  }
}
