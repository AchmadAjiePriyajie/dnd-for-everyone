import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { localeSchema, type Principal } from '#shared/access';
import { type AdvancementPreview, advancementChoiceSchema, type CharacterOptions, type RestPreview } from '#shared/characters';
import { SchemaValidationPipe } from '../../common/schema-validation.pipe.js';
import { CurrentPrincipal } from '../auth/principal.js';
import { SessionGuard } from '../auth/session.guard.js';
import { CharacterAdvancementService } from './advancement.js';
import { CharacterResourcesService } from './resources.js';
import { type CharacterView, CharactersService } from './service.js';

const params = z.strictObject({ campaignId: z.string().min(1).max(100), characterId: z.string().min(1).max(200) });
const campaignParams = z.strictObject({ campaignId: z.string().min(1).max(100) });
const localeQuery = z.strictObject({ locale: localeSchema });
const optionalLocale = z.strictObject({ locale: localeSchema.optional() });
const restQuery = z.strictObject({ rest: z.enum(['short', 'long']) });
/** Pilihan level up dikirim sebagai JSON di query karena pratinjau adalah GET tanpa efek. */
const previewQuery = z.strictObject({ choice: z.string().max(2000).transform((raw, ctx) => {
  try {
    return advancementChoiceSchema.parse(JSON.parse(raw));
  } catch {
    ctx.addIssue({ code: 'custom', message: 'choice' });
    return z.NEVER;
  }
}) });

/** Baca sheet; semua perubahan karakter lewat POST /commands (character.*). */
@Controller('campaigns/:campaignId')
@UseGuards(SessionGuard)
export class CharactersController {
  constructor(
    private readonly characters: CharactersService,
    private readonly resources: CharacterResourcesService,
    private readonly advancement: CharacterAdvancementService,
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

  @Get('characters/:characterId/advancement-preview')
  advancementPreview(
    @CurrentPrincipal() principal: Principal,
    @Param(new SchemaValidationPipe(params)) input: z.infer<typeof params>,
    @Query(new SchemaValidationPipe(previewQuery)) query: z.infer<typeof previewQuery>,
  ): AdvancementPreview {
    return this.advancement.preview(principal, input.campaignId, input.characterId, query.choice);
  }
}
