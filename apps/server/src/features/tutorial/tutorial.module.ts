import { Module } from '@nestjs/common';
import { CommandsModule } from '../../commands/commands.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CampaignsModule } from '../campaigns/campaigns.module.js';
import { TutorialController } from './tutorial.controller.js';
import { TutorialService } from './tutorial.js';

@Module({ imports: [AuthModule, CommandsModule, CampaignsModule], controllers: [TutorialController], providers: [TutorialService] })
export class TutorialModule {}
