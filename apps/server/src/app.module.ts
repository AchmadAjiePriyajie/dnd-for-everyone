import { type DynamicModule, Global, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { APP_OPTIONS, type AppOptions } from './app-options.js';
import { AppController } from './app.controller.js';
import { CommandsModule } from './commands/commands.module.js';
import { ApiErrorFilter } from './common/api-error.filter.js';
import { DomainEventsModule } from './common/domain-events.js';
import { ContentModule } from './content/content.module.js';
import { DatabaseModule } from './db/database.module.js';
import { AuthModule } from './features/auth/auth.module.js';
import { CampaignsModule } from './features/campaigns/campaigns.module.js';
import { CharactersModule } from './features/characters/characters.module.js';
import { ReferenceModule } from './features/reference/reference.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';

@Global()
@Module({})
class AppOptionsModule {
  static forRoot(options: AppOptions): DynamicModule {
    return {
      module: AppOptionsModule,
      providers: [{ provide: APP_OPTIONS, useValue: options }],
      exports: [APP_OPTIONS],
    };
  }
}

@Module({})
export class AppModule {
  static forRoot(options: AppOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [
        AppOptionsModule.forRoot(options),
        DatabaseModule,
        DomainEventsModule,
        ContentModule,
        AuthModule,
        CampaignsModule,
        ReferenceModule,
        CharactersModule,
        CommandsModule,
        RealtimeModule,
      ],
      controllers: [AppController],
      providers: [{ provide: APP_FILTER, useClass: ApiErrorFilter }],
    };
  }
}
