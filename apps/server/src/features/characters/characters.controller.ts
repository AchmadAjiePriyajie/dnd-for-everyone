import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { localeSchema, type Principal } from '#shared/access';
import type { CharacterOptions, RestPreview } from '#shared/characters';
import { SchemaValidationPipe } from '../../common/schema-validation.pipe.js';
import { CurrentPrincipal } from '../auth/principal.js';
import { SessionGuard } from '../auth/session.guard.js';
import { CharacterResourcesService } from './resources.js';
import { type CharacterView, CharactersService } from './service.js';

const params = z.strictObject({ campaignId: z.string().min(1).max(100), characterId: z.string().min(1).max(200) });
const campaignParams = z.strictObject({ campaignId: z.string().min(1).max(100) });
const localeQuery = z.strictObject({ locale: localeSchema });
const optionalLocale = z.strictObject({ locale: localeSchema.optional() });
const restQuery = z.strictObject({ rest: z.enum(['short', 'long']) });

/** Baca sheet; semua perubahan karakter lewat POST /commands (character.*). */
@Controller('campaigns/:campaignId')
@UseGuards(SessionGuard)
export class CharactersController {
  constructor(
    private readonly characters: CharactersService,
    private readonly resources: CharacterResourcesService,
  ) {}

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
    @Query(new SchemaValidationPipe(optionalLocale)) query: z.infer<typeof optionalLocale>,
  ): CharacterView {
    return this.characters.getCharacter(principal, input.campaignId, input.characterId, query.locale);
  }

  @Get('characters/:characterId/rest-preview')
  restPreview(
    @CurrentPrincipal() principal: Principal,
    @Param(new SchemaValidationPipe(params)) input: z.infer<typeof params>,
    @Query(new SchemaValidationPipe(restQuery)) query: z.infer<typeof restQuery>,
  ): RestPreview {
    return this.resources.previewRest(principal, input.campaignId, input.characterId, query.rest);
  }
}
