import { Module } from '@nestjs/common';
import { ContentModule } from '../../content/content.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ReferenceController } from './reference.controller.js';
import { ReferenceService } from './search.js';

@Module({
  imports: [ContentModule, AuthModule],
  controllers: [ReferenceController],
  providers: [ReferenceService],
  exports: [ReferenceService],
})
export class ReferenceModule {}
