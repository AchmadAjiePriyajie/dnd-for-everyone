import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { Principal } from '#shared/access';
import type { CombatView } from '#shared/combat';
import { SchemaValidationPipe } from '../../common/schema-validation.pipe.js';
import { CurrentPrincipal } from '../auth/principal.js';
import { SessionGuard } from '../auth/session.guard.js';
import { CombatService } from './service.js';

const params = z.strictObject({ campaignId: z.string().min(1).max(100), combatId: z.string().min(1).max(100) });

@Controller('campaigns/:campaignId/combats')
@UseGuards(SessionGuard)
export class CombatController {
  constructor(private readonly combat: CombatService) {}

  @Get(':combatId')
  get(@CurrentPrincipal() principal: Principal, @Param(new SchemaValidationPipe(params)) input: z.infer<typeof params>): CombatView {
    return this.combat.get(principal, input.campaignId, input.combatId);
  }
}
