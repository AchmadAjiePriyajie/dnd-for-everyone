import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from './app.js';

const dataDir = resolve(process.env.DATA_DIR ?? 'data');
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 3000);

// Build Vite berada di dist/web, berdampingan dengan dist/apps/server.
const webDir = resolve(process.env.WEB_DIR ?? resolve(import.meta.dirname, '../../../web'));

const app = await createApp({ dataDir, ...(existsSync(webDir) ? { webDir } : {}) });
app.enableShutdownHooks();
await app.listen({ host, port });

const address = app.getHttpServer().address() as AddressInfo;
console.log(`READY http://${host}:${address.port}`);
