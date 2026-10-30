import { Global, Module } from '@nestjs/common';
import { APP_OPTIONS, type AppOptions } from '../app-options.js';
import { DatabaseService } from './database.service.js';

@Global()
@Module({
  providers: [
    {
      provide: DatabaseService,
      inject: [APP_OPTIONS],
      useFactory: (options: AppOptions) => DatabaseService.open(options),
    },
  ],
  exports: [DatabaseService],
})
export class DatabaseModule {}
