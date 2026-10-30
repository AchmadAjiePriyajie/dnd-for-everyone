import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../apps/server/src/app.module.js';
import { configureApp, type AppOptions } from '../../apps/server/src/app.js';

export interface TestServer {
  app: NestFastifyApplication;
  dataDir: string;
  close(): Promise<void>;
}

/** Direktori data sementara yang terisolasi per test. */
export async function makeDataDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dnd-test-'));
}

export async function removeDataDir(dataDir: string): Promise<void> {
  await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

/**
 * Boot aplikasi lewat @nestjs/testing dengan konfigurasi yang sama seperti createApp,
 * lalu tunggu Fastify `.ready()` agar `app.inject()` aman dipakai.
 */
export async function startTestServer(options: Partial<AppOptions> = {}): Promise<TestServer> {
  const dataDir = options.dataDir ?? (await makeDataDir());
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot({ ...options, dataDir })],
  }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    logger: false,
  });
  configureApp(app);
  try {
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  } catch (error) {
    await app.close().catch(() => undefined);
    throw error;
  }
  return { app, dataDir, close: () => app.close() };
}
