import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { Principal } from '#shared/access';
import type { TutorialGuide } from '#shared/tutorial';
import { SchemaValidationPipe } from '../../common/schema-validation.pipe.js';
import { CurrentPrincipal } from '../auth/principal.js';
import { SessionGuard } from '../auth/session.guard.js';
import { TutorialService } from './tutorial.js';

const locale = z.enum(['en', 'id']);
const createBody = z.strictObject({ locale });
const guideParams = z.strictObject({ campaignId: z.string().min(1).max(100) });
const guideQuery = z.strictObject({ locale: locale.default('en') });

@Controller('campaigns')
@UseGuards(SessionGuard)
export class TutorialController {
  constructor(private readonly tutorial: TutorialService) {}

  @Post('tutorial')
  create(@CurrentPrincipal() principal: Principal, @Body(new SchemaValidationPipe(createBody)) body: z.infer<typeof createBody>): { id: string } {
    return { id: this.tutorial.createTutorialCampaign(principal, body.locale) };
  }

  @Get(':campaignId/tutorial')
  guide(
    @CurrentPrincipal() principal: Principal,
    @Param(new SchemaValidationPipe(guideParams)) params: z.infer<typeof guideParams>,
    @Query(new SchemaValidationPipe(guideQuery)) query: z.infer<typeof guideQuery>,
  ): TutorialGuide {
    return this.tutorial.guide(principal, params.campaignId, query.locale);
  }
}
