import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { Principal } from '#shared/access';
import { actionInputSchema, type ActionOption, type ActionPreview, type CombatView } from '#shared/combat';
import { SchemaValidationPipe } from '../../common/schema-validation.pipe.js';
import { CurrentPrincipal } from '../auth/principal.js';
import { SessionGuard } from '../auth/session.guard.js';
import { ActionsService } from './actions.js';
import { CombatService } from './service.js';

const id = z.string().min(1).max(100);
const params = z.strictObject({ campaignId: id, combatId: id });
const actorParams = z.strictObject({ campaignId: id, combatId: id, combatantId: id });
const locale = z.enum(['en', 'id']).default('en');
const optionsQuery = z.strictObject({ locale });
const previewQuery = z.strictObject({
  locale,
  input: z.string().max(4000).transform((raw, ctx) => {
    try {
      return actionInputSchema.parse(JSON.parse(raw));
    } catch {
      ctx.addIssue({ code: 'custom', message: 'input' });
      return z.NEVER;
    }
  }),
});

@Controller('campaigns/:campaignId/combats')
@UseGuards(SessionGuard)
export class CombatController {
  constructor(private readonly combat: CombatService, private readonly actions: ActionsService) {}

  @Get(':combatId')
  get(@CurrentPrincipal() principal: Principal, @Param(new SchemaValidationPipe(params)) input: z.infer<typeof params>): CombatView {
    return this.combat.get(principal, input.campaignId, input.combatId);
  }

  /** Options of a combatant the caller controls (owner or DM). */
  @Get(':combatId/combatants/:combatantId/actions')
  options(
    @CurrentPrincipal() principal: Principal,
    @Param(new SchemaValidationPipe(actorParams)) input: z.infer<typeof actorParams>,
    @Query(new SchemaValidationPipe(optionsQuery)) query: z.infer<typeof optionsQuery>,
  ): ActionOption[] {
    return this.actions.options(principal, input.campaignId, input.combatId, input.combatantId, query.locale);
  }

  /** Side-effect free preview; combat.act re-validates against server state. */
  @Get(':combatId/actions/preview')
  preview(
    @CurrentPrincipal() principal: Principal,
    @Param(new SchemaValidationPipe(params)) input: z.infer<typeof params>,
    @Query(new SchemaValidationPipe(previewQuery)) query: z.infer<typeof previewQuery>,
  ): ActionPreview {
    return this.actions.preview(principal, input.campaignId, input.combatId, query.input, query.locale);
  }
}
