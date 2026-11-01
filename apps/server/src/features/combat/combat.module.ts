import { Module } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { CommandsModule } from '../../commands/commands.module.js';
import { ContentModule } from '../../content/content.module.js';
import { RealtimeModule } from '../../realtime/realtime.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CampaignsModule } from '../campaigns/campaigns.module.js';
import { CharactersModule } from '../characters/characters.module.js';
import { ActionsService } from './actions.js';
import { EffectsService } from './effects.js';
import { ResolutionsService } from './resolutions.js';
import { CombatController } from './combat.controller.js';
import { CombatService } from './service.js';
import { RANDOM_INT, RollsService } from './rolls.js';

@Module({
  imports: [AuthModule, CommandsModule, ContentModule, RealtimeModule, CampaignsModule, CharactersModule],
  controllers: [CombatController], providers: [CombatService, EffectsService, RollsService, ResolutionsService, ActionsService, { provide: RANDOM_INT, useValue: randomInt }], exports: [CombatService, EffectsService, RollsService, ResolutionsService, ActionsService],
})
export class CombatModule {}
