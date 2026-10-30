import { DomainError } from '../../common/domain-error.js';

/** Pembatas percobaan sederhana dalam memori (satu proses host). */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  private recent(key: string, now: number): number[] {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length) this.hits.set(key, list);
    else this.hits.delete(key);
    return list;
  }

  /** Lempar RATE_LIMITED bila kuota habis, tanpa mencatat percobaan baru. */
  assertAllowed(key: string, now = Date.now()): void {
    const list = this.recent(key, now);
    if (list.length >= this.limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((list[0]! + this.windowMs - now) / 1000));
      throw new DomainError('RATE_LIMITED', 429, { retryAfterSeconds });
    }
  }

  record(key: string, now = Date.now()): void {
    this.hits.set(key, [...this.recent(key, now), now]);
  }

  /** Cek lalu catat; untuk endpoint yang setiap percobaannya dihitung. */
  consume(key: string, now = Date.now()): void {
    this.assertAllowed(key, now);
    this.record(key, now);
  }
}
