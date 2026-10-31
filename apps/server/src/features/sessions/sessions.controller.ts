import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { Principal } from '#shared/access';
import type { SessionSummary, SessionView } from '#shared/sessions';
import { SchemaValidationPipe } from '../../common/schema-validation.pipe.js';
import { CurrentPrincipal } from '../auth/principal.js';
import { SessionGuard } from '../auth/session.guard.js';
import { SessionsService } from './service.js';

const id = z.string().min(1).max(100);
const campaignParams = z.strictObject({ campaignId: id });
const sessionParams = z.strictObject({ campaignId: id, sessionId: id });

@Controller('campaigns/:campaignId/sessions')
@UseGuards(SessionGuard)
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get()
  list(@CurrentPrincipal() principal: Principal, @Param(new SchemaValidationPipe(campaignParams)) input: z.infer<typeof campaignParams>): SessionSummary[] {
    return this.sessions.list(principal, input.campaignId);
  }

  /** Committed state for this member: session record, linked combat/scene, open resolutions and the log. */
  @Get(':sessionId/resume')
  resume(@CurrentPrincipal() principal: Principal, @Param(new SchemaValidationPipe(sessionParams)) input: z.infer<typeof sessionParams>): SessionView {
    return this.sessions.resumeSession(principal, input.campaignId, input.sessionId);
  }
}
