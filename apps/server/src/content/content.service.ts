import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ContentNotFoundError, defaultContentDir, loadCatalog } from '#content/catalog';
import type { ContentAudit, ContentCatalog, ContentEntry } from '#shared/content';
import type { Id, Locale } from '#shared/contracts';
import { APP_OPTIONS, type AppOptions } from '../app-options.js';
import { DomainError } from '../common/domain-error.js';

/** Corpus SRD read-only, dimuat sekali saat start (data rusak menggagalkan start). */
@Injectable()
export class ContentService implements OnModuleInit {
  private readonly logger = new Logger(ContentService.name);
  private catalog!: ContentCatalog;

  constructor(@Inject(APP_OPTIONS) private readonly options: AppOptions) {}

  onModuleInit(): void {
    this.catalog = loadCatalog(this.options.contentDir ?? defaultContentDir);
    const audit = this.catalog.auditContent();
    const open = Object.values(audit).reduce((sum, list) => sum + list.length, 0);
    if (open > 0) this.logger.warn(`content audit has ${open} open issue(s); run npm run content:audit`);
  }

  getContent(id: Id, locale: Locale): ContentEntry {
    try {
      return this.catalog.getContent(id, locale);
    } catch (error) {
      if (error instanceof ContentNotFoundError) throw new DomainError('NOT_FOUND', 404);
      throw error;
    }
  }

  has(id: Id): boolean {
    return this.catalog.has(id);
  }

  ids(): Id[] {
    return this.catalog.ids();
  }

  auditContent(): ContentAudit {
    return this.catalog.auditContent();
  }
}
