import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ProjectionService } from '../../realtime/projection.js';
import { CharactersService } from '../characters/service.js';

/** Cheat sheet party di snapshot DM saja; snapshot player tidak membangunnya sama sekali. */
@Injectable()
export class CheatSheetProjection implements OnModuleInit {
  constructor(
    private readonly projection: ProjectionService,
    private readonly characters: CharactersService,
  ) {}

  onModuleInit(): void {
    this.projection.registerSection('cheatSheet', (db, member) =>
      member.role === 'dm' ? { dm: { cheatSheet: this.characters.cheatSheet(db, member.campaignId) } } : {},
    );
  }
}
