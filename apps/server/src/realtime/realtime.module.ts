import { Module } from '@nestjs/common';
import { AuthModule } from '../features/auth/auth.module.js';
import { CampaignsModule } from '../features/campaigns/campaigns.module.js';
import { ProjectionService } from './projection.js';
import { RoomsGateway } from './rooms.gateway.js';

@Module({
  imports: [AuthModule, CampaignsModule],
  providers: [RoomsGateway, ProjectionService],
  exports: [ProjectionService],
})
export class RealtimeModule {}
