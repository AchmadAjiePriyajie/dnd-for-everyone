import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Sajikan hasil build Vite dari direktori frontend saja. `wildcard: false` hanya
 * mendaftarkan file yang ada saat start; path lain jatuh ke 404 Nest.
 */
export async function registerWeb(app: NestFastifyApplication, webDir: string | undefined): Promise<void> {
  if (!webDir || !existsSync(join(webDir, 'index.html'))) return;
  await app.register(fastifyStatic, {
    root: webDir,
    prefix: '/',
    wildcard: false,
    index: ['index.html'],
    dotfiles: 'deny',
  });
}

/**
 * Fallback SPA hanya untuk navigasi browser: GET, menerima HTML, tanpa ekstensi
 * file, dan di luar /api serta /socket.io. Asset/API yang tidak ada tetap 404 JSON.
 */
export function isSpaNavigation(req: FastifyRequest): boolean {
  if (req.method !== 'GET') return false;
  const path = req.url.split('?')[0] ?? '';
  if (path === '/api' || path.startsWith('/api/') || path.startsWith('/socket.io')) return false;
  if (/\.[a-z0-9]+$/i.test(path) || path.includes('..') || path.includes('%')) return false;
  return (req.headers.accept ?? '').includes('text/html');
}

export function sendSpaIndex(reply: FastifyReply): void {
  void reply.header('cache-control', 'no-cache').type('text/html; charset=utf-8').sendFile('index.html');
}

export function canServeSpa(reply: FastifyReply): boolean {
  return typeof (reply as { sendFile?: unknown }).sendFile === 'function';
}
