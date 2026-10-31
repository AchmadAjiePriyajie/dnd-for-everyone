import { Module } from '@nestjs/common';
import { CommandsModule } from '../../commands/commands.module.js';
import { ContentModule } from '../../content/content.module.js';
import { RealtimeModule } from '../../realtime/realtime.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CampaignsModule } from '../campaigns/campaigns.module.js';
import { CharactersController } from './characters.controller.js';
import { CharacterAdvancementService } from './advancement.js';
import { CharacterFeaturesService } from './features.js';
import { CharacterResourcesService } from './resources.js';
import { CharactersService } from './service.js';

@Module({
  imports: [AuthModule, ContentModule, CommandsModule, CampaignsModule, RealtimeModule],
  controllers: [CharactersController],
  providers: [CharactersService, CharacterFeaturesService, CharacterResourcesService, CharacterAdvancementService],
  exports: [CharactersService],
})
export class CharactersModule {}
