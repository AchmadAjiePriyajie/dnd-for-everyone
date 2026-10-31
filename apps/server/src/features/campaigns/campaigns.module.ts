import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CampaignsController } from './campaigns.controller.js';
import { CampaignsService } from './service.js';

@Module({
  imports: [AuthModule],
  controllers: [CampaignsController],
  providers: [CampaignsService],
  exports: [CampaignsService],
})
export class CampaignsModule {}
