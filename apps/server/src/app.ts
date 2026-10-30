import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { LogLevel } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { AppOptions } from './app-options.js';
import { AppModule } from './app.module.js';
import { registerWeb } from './web.js';

export type { AppOptions } from './app-options.js';

/** Konfigurasi bersama untuk runtime dan test harness. */
export async function configureApp(app: NestFastifyApplication, options: AppOptions): Promise<void> {
  app.setGlobalPrefix('api');
  // Socket.IO memakai server HTTP yang sama (path /socket.io).
  app.useWebSocketAdapter(new IoAdapter(app));
  await registerWeb(app, options.webDir);
}

export async function createApp(
  options: AppOptions,
  logger: false | LogLevel[] = ['error', 'warn', 'log'],
): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forRoot(options), new FastifyAdapter(), {
    logger,
  });
  await configureApp(app, options);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
