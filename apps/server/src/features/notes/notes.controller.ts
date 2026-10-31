import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { Principal } from '#shared/access';
import type { NoteSummary, NoteView } from '#shared/notes';
import { SchemaValidationPipe } from '../../common/schema-validation.pipe.js';
import { CurrentPrincipal } from '../auth/principal.js';
import { SessionGuard } from '../auth/session.guard.js';
import { NotesService } from './service.js';

const campaignParams = z.strictObject({ campaignId: z.string().min(1).max(100) });
const noteParams = z.strictObject({ campaignId: z.string().min(1).max(100), noteId: z.string().min(1).max(100) });

/** Baca catatan sesuai hak akses; semua perubahan lewat POST /commands (note.*). */
@Controller('campaigns/:campaignId/notes')
@UseGuards(SessionGuard)
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Get()
  list(@CurrentPrincipal() principal: Principal, @Param(new SchemaValidationPipe(campaignParams)) input: z.infer<typeof campaignParams>): NoteSummary[] {
    return this.notes.visibleNotes(principal, input.campaignId);
  }

  @Get(':noteId')
  get(@CurrentPrincipal() principal: Principal, @Param(new SchemaValidationPipe(noteParams)) input: z.infer<typeof noteParams>): NoteView {
    return this.notes.getNote(principal, input.campaignId, input.noteId);
  }
}
