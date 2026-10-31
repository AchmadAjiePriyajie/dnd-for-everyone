import { Module } from '@nestjs/common';
import { CommandsModule } from '../../commands/commands.module.js';
import { ContentModule } from '../../content/content.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CampaignsModule } from '../campaigns/campaigns.module.js';
import { ReferenceModule } from '../reference/reference.module.js';
import { EncountersController } from './encounters.controller.js';
import { HomebrewService } from './homebrew.js';
import { EncountersService } from './service.js';

@Module({
  imports: [AuthModule, ContentModule, CommandsModule, CampaignsModule, ReferenceModule],
  controllers: [EncountersController],
  providers: [HomebrewService, EncountersService],
  exports: [HomebrewService, EncountersService],
})
export class EncountersModule {}
