import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { LogLevel } from '@nestjs/common';
import type { AppOptions } from './app-options.js';
import { AppModule } from './app.module.js';

export type { AppOptions } from './app-options.js';

/** Konfigurasi bersama untuk runtime dan test harness. */
export function configureApp(app: NestFastifyApplication): void {
  app.setGlobalPrefix('api');
}

export async function createApp(
  options: AppOptions,
  logger: false | LogLevel[] = ['error', 'warn', 'log'],
): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forRoot(options), new FastifyAdapter(), {
    logger,
  });
  configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
