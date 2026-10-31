import { Module } from '@nestjs/common';
import { CommandsModule } from '../../commands/commands.module.js';
import { RealtimeModule } from '../../realtime/realtime.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CampaignsModule } from '../campaigns/campaigns.module.js';
import { AssetsService } from './assets.js';
import { ScenesProjection } from './projection.js';
import { ScenesController } from './scenes.controller.js';
import { ScenesService } from './service.js';

@Module({
  imports: [AuthModule, CommandsModule, CampaignsModule, RealtimeModule],
  controllers: [ScenesController],
  providers: [AssetsService, ScenesService, ScenesProjection],
  exports: [AssetsService, ScenesService, ScenesProjection],
})
export class ScenesModule {}
