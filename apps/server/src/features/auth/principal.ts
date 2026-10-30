import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { Principal } from '#shared/access';
import { SESSION_TTL_MS } from './service.js';

export const SESSION_COOKIE = 'dnd_sid';

export interface AuthedRequest extends FastifyRequest {
  principal?: Principal;
  sessionToken?: string;
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      const value = part.slice(eq + 1).trim();
      return value ? decodeURIComponent(value) : undefined;
    }
  }
  return undefined;
}

export const readSessionToken = (req: FastifyRequest): string | undefined => readCookie(req.headers.cookie, SESSION_COOKIE);

/** HttpOnly + SameSite=Lax; Secure saat request datang lewat HTTPS. */
export function sessionCookie(token: string, req: FastifyRequest): string {
  const parts = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${SESSION_TTL_MS / 1000}`];
  if (req.protocol === 'https') parts.push('Secure');
  return parts.join('; ');
}

export function clearedSessionCookie(req: FastifyRequest): string {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (req.protocol === 'https') parts.push('Secure');
  return parts.join('; ');
}

/** Principal yang sudah diverifikasi SessionGuard. */
export const CurrentPrincipal = createParamDecorator((_: unknown, ctx: ExecutionContext): Principal => {
  const principal = ctx.switchToHttp().getRequest<AuthedRequest>().principal;
  if (!principal) throw new Error('CurrentPrincipal used without SessionGuard');
  return principal;
});
