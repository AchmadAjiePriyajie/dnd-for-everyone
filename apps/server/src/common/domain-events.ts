import { Global, Injectable, Module } from '@nestjs/common';
import type { Id } from '#shared/contracts';

/** Kejadian setelah commit yang perlu diteruskan ke realtime; tidak memuat data rahasia. */
export interface DomainEventMap {
  'room.changed': { campaignId: Id; eventSequence: number };
  'member.removed': { campaignId: Id; accountId: Id };
  'session.revoked': { tokenHash: string };
}

type Listener<K extends keyof DomainEventMap> = (event: DomainEventMap[K]) => void;

/**
 * Bus sinkron dalam proses. Dipublikasikan hanya setelah transaksi commit,
 * sehingga listener tidak pernah melihat perubahan yang bisa di-rollback.
 */
@Injectable()
export class DomainEvents {
  private readonly listeners = new Map<keyof DomainEventMap, Set<Listener<never>>>();

  on<K extends keyof DomainEventMap>(kind: K, listener: Listener<K>): () => void {
    const set = this.listeners.get(kind) ?? new Set();
    set.add(listener as Listener<never>);
    this.listeners.set(kind, set);
    return () => set.delete(listener as Listener<never>);
  }

  publish<K extends keyof DomainEventMap>(kind: K, event: DomainEventMap[K]): void {
    for (const listener of this.listeners.get(kind) ?? []) (listener as Listener<K>)(event);
  }
}

@Global()
@Module({ providers: [DomainEvents], exports: [DomainEvents] })
export class DomainEventsModule {}
