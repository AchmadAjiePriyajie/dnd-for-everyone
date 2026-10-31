import { Module } from '@nestjs/common';
import { CommandsModule } from '../../commands/commands.module.js';
import { ContentModule } from '../../content/content.module.js';
import { RealtimeModule } from '../../realtime/realtime.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CampaignsModule } from '../campaigns/campaigns.module.js';
import { CharactersModule } from '../characters/characters.module.js';
import { CombatController } from './combat.controller.js';
import { CombatService } from './service.js';

@Module({
  imports: [AuthModule, CommandsModule, ContentModule, RealtimeModule, CampaignsModule, CharactersModule],
  controllers: [CombatController], providers: [CombatService], exports: [CombatService],
})
export class CombatModule {}
