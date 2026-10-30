import { Module } from '@nestjs/common';
import { AuthModule } from '../features/auth/auth.module.js';
import { CampaignsModule } from '../features/campaigns/campaigns.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { CommandsController } from './commands.controller.js';
import { CommandsService } from './dispatcher.js';

/** Feature modules mengimpor module ini lalu memanggil registerCommand saat onModuleInit. */
@Module({
  imports: [AuthModule, CampaignsModule, RealtimeModule],
  controllers: [CommandsController],
  providers: [CommandsService],
  exports: [CommandsService],
})
export class CommandsModule {}
