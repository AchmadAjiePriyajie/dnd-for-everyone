import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { localeSchema, type Principal } from '#shared/access';
import type { EncounterView, HomebrewView, MonsterInstance } from '#shared/encounters';
import { SchemaValidationPipe } from '../../common/schema-validation.pipe.js';
import { CurrentPrincipal } from '../auth/principal.js';
import { SessionGuard } from '../auth/session.guard.js';
import { HomebrewService } from './homebrew.js';
import { EncountersService } from './service.js';

const campaignParams = z.strictObject({ campaignId: z.string().min(1).max(100) });
const entryParams = z.strictObject({ campaignId: z.string().min(1).max(100), id: z.string().min(1).max(120) });
const localeQuery = z.strictObject({ locale: localeSchema });

/** Baca encounter (DM) dan homebrew (sesuai hak akses); perubahan lewat POST /commands. */
@Controller('campaigns/:campaignId')
@UseGuards(SessionGuard)
export class EncountersController {
  constructor(
    private readonly encounters: EncountersService,
    private readonly homebrew: HomebrewService,
  ) {}

  @Get('encounters')
  list(@CurrentPrincipal() principal: Principal, @Param(new SchemaValidationPipe(campaignParams)) input: z.infer<typeof campaignParams>): EncounterView[] {
    return this.encounters.list(principal, input.campaignId);
  }

  @Get('monsters')
  monsters(
    @CurrentPrincipal() principal: Principal,
    @Param(new SchemaValidationPipe(campaignParams)) input: z.infer<typeof campaignParams>,
    @Query(new SchemaValidationPipe(localeQuery)) query: z.infer<typeof localeQuery>,
  ): MonsterInstance[] {
    return this.encounters.monsters(principal, input.campaignId, query.locale);
  }

  @Get('homebrew')
  homebrewList(@CurrentPrincipal() principal: Principal, @Param(new SchemaValidationPipe(campaignParams)) input: z.infer<typeof campaignParams>): HomebrewView[] {
    return this.homebrew.list(principal, input.campaignId);
  }

  @Get('homebrew/:id')
  homebrewEntry(@CurrentPrincipal() principal: Principal, @Param(new SchemaValidationPipe(entryParams)) input: z.infer<typeof entryParams>): HomebrewView {
    return this.homebrew.get(principal, input.campaignId, input.id);
  }
}
