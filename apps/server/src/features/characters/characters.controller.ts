import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { Principal } from '#shared/access';
import { SchemaValidationPipe } from '../../common/schema-validation.pipe.js';
import { CurrentPrincipal } from '../auth/principal.js';
import { SessionGuard } from '../auth/session.guard.js';
import { type CharacterView, CharactersService } from './service.js';

const params = z.strictObject({ campaignId: z.string().min(1).max(100), characterId: z.string().min(1).max(200) });

/** Baca sheet; semua perubahan karakter lewat POST /commands (character.*). */
@Controller('campaigns/:campaignId/characters')
@UseGuards(SessionGuard)
export class CharactersController {
  constructor(private readonly characters: CharactersService) {}

  @Get(':characterId')
  get(
    @CurrentPrincipal() principal: Principal,
    @Param(new SchemaValidationPipe(params)) input: z.infer<typeof params>,
  ): CharacterView {
    return this.characters.getCharacter(principal, input.campaignId, input.characterId);
  }
}
