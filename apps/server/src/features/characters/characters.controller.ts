import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { localeSchema, type Principal } from '#shared/access';
import type { CharacterOptions } from '#shared/characters';
import { SchemaValidationPipe } from '../../common/schema-validation.pipe.js';
import { CurrentPrincipal } from '../auth/principal.js';
import { SessionGuard } from '../auth/session.guard.js';
import { type CharacterView, CharactersService } from './service.js';

const params = z.strictObject({ campaignId: z.string().min(1).max(100), characterId: z.string().min(1).max(200) });
const campaignParams = z.strictObject({ campaignId: z.string().min(1).max(100) });
const localeQuery = z.strictObject({ locale: localeSchema });

/** Baca sheet; semua perubahan karakter lewat POST /commands (character.*). */
@Controller('campaigns/:campaignId')
@UseGuards(SessionGuard)
export class CharactersController {
  constructor(private readonly characters: CharactersService) {}

  @Get('character-options')
  options(
    @CurrentPrincipal() principal: Principal,
    @Param(new SchemaValidationPipe(campaignParams)) input: z.infer<typeof campaignParams>,
    @Query(new SchemaValidationPipe(localeQuery)) query: z.infer<typeof localeQuery>,
  ): CharacterOptions {
    return this.characters.characterOptions(principal, input.campaignId, query.locale);
  }

  @Get('characters/:characterId')
  get(
    @CurrentPrincipal() principal: Principal,
    @Param(new SchemaValidationPipe(params)) input: z.infer<typeof params>,
  ): CharacterView {
    return this.characters.getCharacter(principal, input.campaignId, input.characterId);
  }
}
