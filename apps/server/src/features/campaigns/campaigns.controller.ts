import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import {
  type CampaignSummary,
  createCampaignBody,
  type CreatedInvite,
  type InviteView,
  joinBody,
  type Member,
  type MemberView,
  type Principal,
} from '#shared/access';
import { SchemaValidationPipe } from '../../common/schema-validation.pipe.js';
import { CurrentPrincipal } from '../auth/principal.js';
import { AuthService } from '../auth/service.js';
import { SessionGuard } from '../auth/session.guard.js';
import { CampaignsService } from './service.js';

@Controller('campaigns')
@UseGuards(SessionGuard)
export class CampaignsController {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  list(@CurrentPrincipal() principal: Principal): CampaignSummary[] {
    return this.campaigns.list(principal);
  }

  @Post()
  create(
    @CurrentPrincipal() principal: Principal,
    @Body(new SchemaValidationPipe(createCampaignBody)) body: z.infer<typeof createCampaignBody>,
  ): { id: string } {
    return { id: this.campaigns.createCampaign(principal, body.title) };
  }

  @Post('join')
  @HttpCode(200)
  join(
    @CurrentPrincipal() principal: Principal,
    @Body(new SchemaValidationPipe(joinBody)) body: z.infer<typeof joinBody>,
    @Req() req: FastifyRequest,
  ): Member {
    this.auth.joinLimiter.consume(req.ip);
    return this.campaigns.joinWithInvite(principal, body.invite);
  }

  @Get(':campaignId')
  get(@CurrentPrincipal() principal: Principal, @Param('campaignId') campaignId: string): CampaignSummary {
    return this.campaigns.get(principal, campaignId);
  }

  @Get(':campaignId/members')
  members(@CurrentPrincipal() principal: Principal, @Param('campaignId') campaignId: string): MemberView[] {
    return this.campaigns.members(principal, campaignId);
  }

  @Delete(':campaignId/members/:accountId')
  removeMember(
    @CurrentPrincipal() principal: Principal,
    @Param('campaignId') campaignId: string,
    @Param('accountId') accountId: string,
  ): { ok: true } {
    this.campaigns.removeMember(principal, campaignId, accountId);
    return { ok: true };
  }

  @Get(':campaignId/invites')
  invites(@CurrentPrincipal() principal: Principal, @Param('campaignId') campaignId: string): InviteView[] {
    return this.campaigns.invites(principal, campaignId);
  }

  @Post(':campaignId/invites')
  createInvite(@CurrentPrincipal() principal: Principal, @Param('campaignId') campaignId: string): CreatedInvite {
    return this.campaigns.createInvite(principal, campaignId);
  }

  @Delete(':campaignId/invites/:inviteId')
  revokeInvite(
    @CurrentPrincipal() principal: Principal,
    @Param('campaignId') campaignId: string,
    @Param('inviteId') inviteId: string,
  ): { ok: true } {
    this.campaigns.revokeInvite(principal, campaignId, inviteId);
    return { ok: true };
  }
}
