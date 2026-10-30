import { Module } from '@nestjs/common';
import { ContentService } from './content.service.js';

/** Membungkus catalog framework-independent; fitur yang butuh konten mengimpor modul ini. */
@Module({
  providers: [ContentService],
  exports: [ContentService],
})
export class ContentModule {}
