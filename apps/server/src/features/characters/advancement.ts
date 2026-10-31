import { randomInt } from 'node:crypto';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { advancementStatus, applyAdvancement, MAX_LEVEL, previewAdvancement } from '#rules/advancement';
import type { Principal } from '#shared/access';
import { type AdvancementChoice, advancementChoiceSchema, type AdvancementPreview, type Character } from '#shared/characters';
import type { Id } from '#shared/contracts';
import type { CommandContext } from '../../commands/registry.js';
import { CommandsService } from '../../commands/dispatcher.js';
import { DomainError } from '../../common/domain-error.js';
import { ContentService } from '../../content/content.service.js';
import { CharactersService } from './service.js';

const choicePayload = z.strictObject({ choice: advancementChoiceSchema });
const draftPayload = z.strictObject({ choice: advancementChoiceSchema.nullable() });
const xpPayload = z.strictObject({ amount: z.number().int().min(-1_000_000).max(1_000_000) });
const grantPayload = z.strictObject({ count: z.number().int().min(-20).max(20) });
const settingsPayload = z.strictObject({ mode: z.enum(['milestone', 'xp']), startingLevel: z.number().int().min(1).max(MAX_LEVEL) });
const empty = z.strictObject({});

const level = (character: Character) => character.classLevels.reduce((total, entry) => total + entry.level, 0);

/**
 * Level up: pratinjau, draft pilihan, penerapan (server membuat ulang pratinjau dan melempar HP),
 * pengaturan XP/milestone campaign, serta koreksi DM (memberi XP/level, membatalkan level terakhir).
 */
@Injectable()
export class CharacterAdvancementService implements OnModuleInit {
  constructor(
    private readonly commands: CommandsService,
    private readonly characters: CharactersService,
    private readonly content: ContentService,
  ) {}

  onModuleInit(): void {
    this.commands.registerCommand('character.save-advancement-draft', (ctx, payload) => this.saveDraft(ctx, (payload as z.infer<typeof draftPayload>).choice), {
      schema: draftPayload,
    });
    this.commands.registerCommand('character.advance', (ctx, payload) => this.advance(ctx, (payload as z.infer<typeof choicePayload>).choice), {
      schema: choicePayload,
    });
    this.commands.registerCommand('character.award-xp', (ctx, payload) => this.awardXp(ctx, (payload as z.infer<typeof xpPayload>).amount), {
      schema: xpPayload,
      roles: ['dm'],
    });
    this.commands.registerCommand('character.grant-level', (ctx, payload) => this.grantLevels(ctx, (payload as z.infer<typeof grantPayload>).count), {
      schema: grantPayload,
      roles: ['dm'],
    });
    this.commands.registerCommand('character.revert-advancement', (ctx) => this.revert(ctx), { schema: empty, roles: ['dm'] });
    this.commands.registerCommand(
      'campaign.set-advancement',
      (ctx, payload) => {
        if (ctx.targetId !== ctx.campaignId) throw new DomainError('VALIDATION_FAILED', 400, { field: 'targetId' });
        const settings = payload as z.infer<typeof settingsPayload>;
        ctx.db.prepare('UPDATE campaigns SET advancement_mode = ?, starting_level = ? WHERE id = ?').run(settings.mode, settings.startingLevel, ctx.campaignId);
        return settings;
      },
      { schema: settingsPayload, roles: ['dm'] },
    );
  }

  /** Pratinjau untuk pemilik/DM; tidak mengubah apa pun. */
  preview(principal: Principal, campaignId: Id, characterId: Id, choice: AdvancementChoice): AdvancementPreview {
    const { character } = this.characters.getCharacter(principal, campaignId, characterId);
    if (character.status !== 'final') throw new DomainError('CHARACTER_NOT_FINAL', 409);
    return previewAdvancement(character, choice, this.content.catalog());
  }

  private editable(ctx: CommandContext): Character {
    const character = ctx.member.role === 'dm' ? this.characters.campaignCharacter(ctx) : this.characters.ownedCharacter(ctx);
    if (character.status !== 'final') throw new DomainError('CHARACTER_NOT_FINAL', 409);
    return character;
  }

  private saveDraft(ctx: CommandContext, choice: AdvancementChoice | null) {
    const character = this.characters.ownedCharacter(ctx);
    if (character.status !== 'final') throw new DomainError('CHARACTER_NOT_FINAL', 409);
    this.characters.writeAdvancement(ctx, { ...character, pendingAdvancement: choice });
    return { id: character.id };
  }

  private advance(ctx: CommandContext, choice: AdvancementChoice) {
    const character = this.editable(ctx);
    const isDm = ctx.member.role === 'dm';
    const settings = this.characters.advancementSettings(ctx.db, ctx.campaignId);
    const progress = this.characters.progress(ctx.db, character.id);
    const belowStart = level(character) < settings.startingLevel;
    // DM boleh menaikkan level sebagai koreksi; pemain butuh XP/milestone atau level awal campaign.
    if (!isDm && !advancementStatus(level(character), settings, progress).canAdvance) throw new DomainError('LEVEL_UP_NOT_AVAILABLE', 409);

    const preview = previewAdvancement(character, choice, this.content.catalog());
    if (preview.issues.length) throw new DomainError('ADVANCEMENT_INVALID', 409, { issue: preview.issues[0]! });
    if (preview.required.length) throw new DomainError('ADVANCEMENT_INCOMPLETE', 409, { missing: preview.required.join(',') });
    // Lemparan HP di server; tersimpan di receipt sehingga retry tidak melempar ulang.
    const hpDie = choice.hp === 'roll' ? randomInt(1, preview.hitDie + 1) : preview.hpDie;
    const advanced = applyAdvancement(character, { ...preview, hpDie });
    this.characters.writeAdvancement(ctx, advanced);
    if (settings.mode === 'milestone' && !belowStart && progress.levelsGranted > 0) {
      this.characters.writeProgress(ctx, character.id, { ...progress, levelsGranted: progress.levelsGranted - 1 });
    }
    return { id: character.id, level: preview.level, classId: choice.classId, hpDie: hpDie! };
  }

  private awardXp(ctx: CommandContext, amount: number) {
    const character = this.characters.campaignCharacter(ctx);
    const progress = this.characters.progress(ctx.db, character.id);
    const xp = progress.xp + amount;
    if (xp < 0) throw new DomainError('VALIDATION_FAILED', 400, { field: 'amount' });
    this.characters.writeProgress(ctx, character.id, { ...progress, xp });
    return { id: character.id, xp };
  }

  private grantLevels(ctx: CommandContext, count: number) {
    const character = this.characters.campaignCharacter(ctx);
    const progress = this.characters.progress(ctx.db, character.id);
    const levelsGranted = Math.max(0, Math.min(MAX_LEVEL - level(character), progress.levelsGranted + count));
    this.characters.writeProgress(ctx, character.id, { ...progress, levelsGranted });
    return { id: character.id, levelsGranted };
  }

  /** Koreksi DM: batalkan level terakhir (tercatat sebagai event command seperti semua mutasi). */
  private revert(ctx: CommandContext) {
    const character = this.characters.campaignCharacter(ctx);
    const last = character.advancements.at(-1);
    if (!last) throw new DomainError('NOT_FOUND', 404);
    const classLevels = character.classLevels.flatMap((entry) => {
      if (entry.classId !== last.classId) return [entry];
      if (entry.level <= 1) return [];
      const { subclassId, ...rest } = entry;
      const next = { ...rest, level: entry.level - 1 };
      return [last.subclassId || !subclassId ? next : { ...next, subclassId }];
    });
    this.characters.writeAdvancement(ctx, { ...character, classLevels, advancements: character.advancements.slice(0, -1) });
    return { id: character.id, level: level(character) - 1 };
  }
}
