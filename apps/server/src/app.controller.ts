import { Controller, Get } from '@nestjs/common';
import type { HealthStatus } from '#shared/contracts';
import { DatabaseService } from './db/database.service.js';

@Controller()
export class AppController {
  constructor(private readonly database: DatabaseService) {}

  @Get('health')
  health(): HealthStatus {
    const row = this.database
      .getHandle()
      .prepare("SELECT value FROM host_meta WHERE key = 'host_id'")
      .get() as { value: string };
    return { status: 'ok', hostId: row.value };
  }
}
