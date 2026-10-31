import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import type { Principal } from '#shared/access';
import type { CommandResult } from '#shared/commands';
import type { RoomSnapshot } from '#shared/room';
import { DomainError } from '../common/domain-error.js';
import { CurrentPrincipal } from '../features/auth/principal.js';
import { SessionGuard } from '../features/auth/session.guard.js';
import { ProjectionService } from '../realtime/projection.js';
import { CommandsService } from './dispatcher.js';

@Controller('campaigns/:campaignId')
@UseGuards(SessionGuard)
export class CommandsController {
  constructor(
    private readonly commands: CommandsService,
    private readonly projection: ProjectionService,
  ) {}

  /** Ingress tunggal mutasi gameplay; campaign pada body harus sama dengan path. */
  @Post('commands')
  @HttpCode(200)
  execute(
    @CurrentPrincipal() principal: Principal,
    @Param('campaignId') campaignId: string,
    @Body() body: unknown,
  ): CommandResult {
    if ((body as { campaignId?: unknown } | null)?.campaignId !== campaignId) {
      // Akses tetap dicek dulu agar campaign asing tidak terbedakan.
      this.projection.projectRoom(principal, campaignId);
      throw new DomainError('VALIDATION_FAILED', 400, { field: 'campaignId' });
    }
    return this.commands.executeCommand(principal, body);
  }

  @Get('snapshot')
  snapshot(@CurrentPrincipal() principal: Principal, @Param('campaignId') campaignId: string): RoomSnapshot {
    return this.projection.projectRoom(principal, campaignId);
  }
}
