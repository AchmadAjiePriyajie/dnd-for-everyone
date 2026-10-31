import { z } from 'zod';
import type { Id, JsonValue } from './contracts.js';

/**
 * Satu mutasi gameplay. `expectedRevision` adalah revision entity target
 * (bukan nomor seluruh room); dihilangkan bila command tidak peka konflik.
 */
export interface CommandEnvelope {
  requestId: string;
  campaignId: Id;
  targetId: Id;
  kind: string;
  expectedRevision?: number;
  payload: JsonValue;
}

/** Hasil command; retry dengan requestId+payload sama mengembalikan objek identik. */
export interface CommandResult {
  targetId: Id;
  entityRevision: number;
  eventSequence: number;
  value: JsonValue;
}

/** Notifikasi realtime setelah commit: hanya penunjuk, tanpa payload. */
export interface RoomChanged {
  campaignId: Id;
  eventSequence: number;
}

export const commandEnvelopeSchema = z.strictObject({
  requestId: z.string().min(1).max(100),
  campaignId: z.string().min(1).max(100),
  targetId: z.string().min(1).max(200),
  kind: z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/).max(100),
  expectedRevision: z.number().int().min(0).optional(),
  payload: z.json(),
});

export const roomSubscribeSchema = z.strictObject({ campaignId: z.string().min(1).max(100) });
