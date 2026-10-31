import { Controller, Delete, Get, HttpCode, Param, Put, Query, UseGuards } from '@nestjs/common';
import type { z } from 'zod';
import type { Principal } from '#shared/access';
import type { Id } from '#shared/contracts';
import { entryParams, entryQuery, type ReferenceEntryView, type SearchHit, searchQuery } from '#shared/reference';
import { SchemaValidationPipe } from '../../common/schema-validation.pipe.js';
import { CurrentPrincipal } from '../auth/principal.js';
import { SessionGuard } from '../auth/session.guard.js';
import { ReferenceService } from './search.js';

@Controller('reference')
@UseGuards(SessionGuard)
export class ReferenceController {
  constructor(private readonly reference: ReferenceService) {}

  @Get('search')
  search(
    @CurrentPrincipal() principal: Principal,
    @Query(new SchemaValidationPipe(searchQuery)) query: z.infer<typeof searchQuery>,
  ): SearchHit[] {
    return this.reference.searchReference(principal, query.q, query.locale, query.campaignId);
  }

  @Get('entries/:id')
  entry(
    @CurrentPrincipal() principal: Principal,
    @Param(new SchemaValidationPipe(entryParams)) params: z.infer<typeof entryParams>,
    @Query(new SchemaValidationPipe(entryQuery)) query: z.infer<typeof entryQuery>,
  ): ReferenceEntryView {
    return this.reference.getReferenceEntry(principal, params.id, query.locale, query.campaignId);
  }

  @Get('bookmarks')
  bookmarks(@CurrentPrincipal() principal: Principal): Id[] {
    return this.reference.listBookmarks(principal);
  }

  @Put('bookmarks/:id')
  @HttpCode(204)
  addBookmark(
    @CurrentPrincipal() principal: Principal,
    @Param(new SchemaValidationPipe(entryParams)) params: z.infer<typeof entryParams>,
  ): void {
    this.reference.addBookmark(principal, params.id, new Date().toISOString());
  }

  @Delete('bookmarks/:id')
  @HttpCode(204)
  removeBookmark(
    @CurrentPrincipal() principal: Principal,
    @Param(new SchemaValidationPipe(entryParams)) params: z.infer<typeof entryParams>,
  ): void {
    this.reference.removeBookmark(principal, params.id);
  }
}
