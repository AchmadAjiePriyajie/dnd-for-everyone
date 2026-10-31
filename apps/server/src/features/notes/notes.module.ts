import { Module } from '@nestjs/common';
import { CommandsModule } from '../../commands/commands.module.js';
import { RealtimeModule } from '../../realtime/realtime.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CampaignsModule } from '../campaigns/campaigns.module.js';
import { CharactersModule } from '../characters/characters.module.js';
import { ReferenceModule } from '../reference/reference.module.js';
import { NotesController } from './notes.controller.js';
import { CheatSheetProjection } from './projection.js';
import { NotesService } from './service.js';

@Module({
  imports: [AuthModule, CommandsModule, CampaignsModule, RealtimeModule, ReferenceModule, CharactersModule],
  controllers: [NotesController],
  providers: [NotesService, CheatSheetProjection],
  exports: [NotesService],
})
export class NotesModule {}
