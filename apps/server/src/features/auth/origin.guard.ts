import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { DomainError } from '../../common/domain-error.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function originOf(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

/** Origin request harus sama dengan origin host yang dituju (protokol + host header). */
export function isSameOrigin(req: FastifyRequest): boolean {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (!origin || !host) return false;
  const actual = originOf(origin);
  return actual !== undefined && actual === originOf(`${req.protocol}://${host}`);
}

/**
 * Proteksi CSRF untuk mutasi: browser selalu mengirim Origin pada POST/PUT/PATCH/DELETE;
 * request tanpa Origin atau dari origin lain ditolak sebelum handler/pipe berjalan.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    if (SAFE_METHODS.has(req.method) || isSameOrigin(req)) return true;
    throw new DomainError('ORIGIN_REJECTED', 403);
  }
}
