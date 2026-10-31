import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller.js';
import { OriginGuard } from './origin.guard.js';
import { AuthService } from './service.js';
import { SessionGuard } from './session.guard.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, SessionGuard, { provide: APP_GUARD, useClass: OriginGuard }],
  exports: [AuthService, SessionGuard],
})
export class AuthModule {}
