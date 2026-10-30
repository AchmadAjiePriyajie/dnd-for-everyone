import { type DynamicModule, Global, Module } from '@nestjs/common';
import { APP_OPTIONS, type AppOptions } from './app-options.js';
import { AppController } from './app.controller.js';
import { DatabaseModule } from './db/database.module.js';

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
      imports: [AppOptionsModule.forRoot(options), DatabaseModule],
      controllers: [AppController],
    };
  }
}
