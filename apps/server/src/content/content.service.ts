import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ContentNotFoundError, defaultContentDir, loadCatalog } from '#content/catalog';
import { type Glossary, loadGlossary } from '#content/glossary';
import type { ContentAudit, ContentCatalog, ContentEntry } from '#shared/content';
import type { Id, Locale } from '#shared/contracts';
import { APP_OPTIONS, type AppOptions } from '../app-options.js';
import { DomainError } from '../common/domain-error.js';

/** Corpus SRD read-only, dimuat sekali saat start (data rusak menggagalkan start). */
@Injectable()
export class ContentService implements OnModuleInit {
  private readonly logger = new Logger(ContentService.name);
  private catalog_!: ContentCatalog;
  private glossary!: Glossary;

  constructor(@Inject(APP_OPTIONS) private readonly options: AppOptions) {}

  onModuleInit(): void {
    const contentDir = this.options.contentDir ?? defaultContentDir;
    this.catalog_ = loadCatalog(contentDir);
    this.glossary = loadGlossary(contentDir, (id) => this.catalog_.has(id));
    const audit = this.catalog_.auditContent();
    const open = Object.values(audit).reduce((sum, list) => sum + list.length, 0);
    if (open > 0) this.logger.warn(`content audit has ${open} open issue(s); run npm run content:audit`);
  }

  getContent(id: Id, locale: Locale): ContentEntry {
    try {
      return this.catalog_.getContent(id, locale);
    } catch (error) {
      if (error instanceof ContentNotFoundError) throw new DomainError('NOT_FOUND', 404);
      throw error;
    }
  }

  has(id: Id): boolean {
    return this.catalog_.has(id);
  }

  ids(): Id[] {
    return this.catalog_.ids();
  }

  /** Catalog framework-independent untuk fungsi murni (packages/rules). */
  catalog(): ContentCatalog {
    return this.catalog_;
  }

  /** Alias pemula dan panduan aplikasi yang dikurasi; sudah divalidasi terhadap corpus. */
  getGlossary(): Glossary {
    return this.glossary;
  }

  auditContent(): ContentAudit {
    return this.catalog_.auditContent();
  }
}
