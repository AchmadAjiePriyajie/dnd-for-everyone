import type { DatabaseSync } from 'node:sqlite';
import type { z } from 'zod';
import type { Id, JsonValue } from '#shared/contracts';
import type { Member, Principal, Role } from '#shared/access';

/** Konteks handler: `now` dari server; handler sinkron, tanpa I/O jaringan dalam transaksi. */
export interface CommandContext {
  db: DatabaseSync;
  principal: Principal;
  member: Member;
  now: string;
  campaignId: Id;
  targetId: Id;
  requestId: string;
}

export type CommandHandler = (ctx: CommandContext, payload: JsonValue) => JsonValue;

export interface CommandOptions {
  /** Role yang boleh menjalankan command; default semua anggota. */
  roles?: Role[];
  /** Validasi payload khusus kind, dijalankan sebelum transaksi. */
  schema?: z.ZodType;
}

export interface CommandRegistration extends CommandOptions {
  kind: string;
  handler: CommandHandler;
}

export class CommandRegistry {
  private readonly handlers = new Map<string, CommandRegistration>();

  register(kind: string, handler: CommandHandler, options: CommandOptions = {}): void {
    if (this.handlers.has(kind)) throw new Error(`Command kind "${kind}" is already registered`);
    this.handlers.set(kind, { kind, handler, ...options });
  }

  get(kind: string): CommandRegistration | undefined {
    return this.handlers.get(kind);
  }
}
