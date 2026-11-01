import { Module } from '@nestjs/common';
import { CommandsModule } from '../../commands/commands.module.js';
import { RealtimeModule } from '../../realtime/realtime.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CampaignsModule } from '../campaigns/campaigns.module.js';
import { CombatModule } from '../combat/combat.module.js';
import { ScenesModule } from '../scenes/scenes.module.js';
import { SessionsService } from './service.js';
import { SessionsController } from './sessions.controller.js';

@Module({
  imports: [AuthModule, CommandsModule, CampaignsModule, RealtimeModule, CombatModule, ScenesModule],
  controllers: [SessionsController],
  providers: [SessionsService],
  exports: [SessionsService],
})
export class SessionsModule {}
