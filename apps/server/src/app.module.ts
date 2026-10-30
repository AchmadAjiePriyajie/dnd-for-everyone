import { type DynamicModule, Global, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { APP_OPTIONS, type AppOptions } from './app-options.js';
import { AppController } from './app.controller.js';
import { ApiErrorFilter } from './common/api-error.filter.js';
import { DatabaseModule } from './db/database.module.js';
import { AuthModule } from './features/auth/auth.module.js';
import { CampaignsModule } from './features/campaigns/campaigns.module.js';

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
      imports: [AppOptionsModule.forRoot(options), DatabaseModule, AuthModule, CampaignsModule],
      controllers: [AppController],
      providers: [{ provide: APP_FILTER, useClass: ApiErrorFilter }],
    };
  }
}
