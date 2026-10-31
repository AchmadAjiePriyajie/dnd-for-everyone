import { Injectable, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { availableFeatures, spendFeature, validateFeatureUse } from '#rules/class-features';
import { validateWeaponMasteries } from '#rules/weapon-mastery';
import type { ErrorCode } from '#shared/access';
import type { Character, FeatureState } from '#shared/characters';
import type { Id } from '#shared/contracts';
import type { CommandContext } from '../../commands/registry.js';
import { CommandsService } from '../../commands/dispatcher.js';
import { DomainError } from '../../common/domain-error.js';
import { ContentService } from '../../content/content.service.js';
import { CharactersService } from './service.js';

const featureKey = z.string().regex(/^[a-z-]+\.[a-z0-9-]+(\/[a-z0-9-]+)?$/).max(160);
const usePayload = z.strictObject({ featureKey, amount: z.number().int().min(1).max(999).optional() });
const spentPayload = z.strictObject({ featureKey, spent: z.number().int().min(0).max(999) });
const masteryPayload = z.strictObject({ weapons: z.array(z.string().min(1).max(120)).max(12) });
const empty = z.strictObject({});

/** Kode dari packages/rules → error domain; status 409 karena state karakter menentukan hasilnya. */
const RULE_CODES = new Set<ErrorCode>(['FEATURE_NOT_OWNED', 'FEATURE_NOT_TRACKED', 'NO_USES_LEFT', 'AMOUNT_NOT_ALLOWED']);
const ruleError = (code: string) =>
  RULE_CODES.has(code as ErrorCode) ? new DomainError(code as ErrorCode, 409) : new DomainError('VALIDATION_FAILED', 400, { field: code });

/**
 * Command fitur class: memakai fitur/resource (pemilik), memilih Weapon Mastery, dan koreksi DM
 * (Heroic Inspiration, jumlah pemakaian). Efek fitur sendiri tetap diselesaikan di meja.
 */
@Injectable()
export class CharacterFeaturesService implements OnModuleInit {
  constructor(
    private readonly commands: CommandsService,
    private readonly characters: CharactersService,
    private readonly content: ContentService,
  ) {}

  onModuleInit(): void {
    this.commands.registerCommand('character.use-feature', (ctx, payload) => this.useFeature(ctx, payload as z.infer<typeof usePayload>), {
      schema: usePayload,
    });
    this.commands.registerCommand(
      'character.set-weapon-masteries',
      (ctx, payload) => this.setMasteries(ctx, (payload as z.infer<typeof masteryPayload>).weapons),
      { schema: masteryPayload },
    );
    this.commands.registerCommand('character.grant-inspiration', (ctx) => this.grantInspiration(ctx), { schema: empty, roles: ['dm'] });
    this.commands.registerCommand(
      'character.set-feature-spent',
      (ctx, payload) => this.setSpent(ctx, payload as z.infer<typeof spentPayload>),
      { schema: spentPayload, roles: ['dm'] },
    );
  }

  private useFeature(ctx: CommandContext, input: z.infer<typeof usePayload>) {
    const character = this.characters.ownedCharacter(ctx);
    if (character.status !== 'final') throw new DomainError('CHARACTER_NOT_FINAL', 409);
    const catalog = this.content.catalog();
    const check = validateFeatureUse(character, input.featureKey, catalog, input.amount);
    if (!check.ok) throw ruleError(check.issues[0]!);
    const state = spendFeature(character, input.featureKey, catalog, input.amount);
    return this.save(ctx, character, state);
  }

  /**
   * Pemilik boleh mengisi slot kosong; mengganti pilihan yang sudah ada hanya setelah Long Rest
   * (alur rest, Task 9) atau oleh DM.
   */
  private setMasteries(ctx: CommandContext, weapons: Id[]) {
    const isDm = ctx.member.role === 'dm';
    const character = isDm ? this.characters.campaignCharacter(ctx) : this.characters.ownedCharacter(ctx);
    const check = validateWeaponMasteries(character, weapons, this.content.catalog());
    if (!check.ok) throw new DomainError('MASTERY_INVALID', 409, { issue: check.issues[0]! });
    const dropped = character.featureState.weaponMasteries.filter((id) => !weapons.includes(id));
    if (dropped.length && !isDm && character.status === 'final') throw new DomainError('MASTERY_CHANGE_NEEDS_REST', 409);
    return this.save(ctx, character, { ...character.featureState, weaponMasteries: weapons });
  }

  private grantInspiration(ctx: CommandContext) {
    const character = this.characters.campaignCharacter(ctx);
    if (character.featureState.heroicInspiration) throw new DomainError('ALREADY_INSPIRED', 409);
    return this.save(ctx, character, { ...character.featureState, heroicInspiration: true });
  }

  /** Koreksi DM: set jumlah terpakai suatu resource dalam batas maksimum aturan. */
  private setSpent(ctx: CommandContext, input: z.infer<typeof spentPayload>) {
    const character = this.characters.campaignCharacter(ctx);
    const use = availableFeatures(character, this.content.catalog()).find((feature) => feature.key === input.featureKey);
    if (!use) throw new DomainError('FEATURE_NOT_OWNED', 409);
    if (!use.resource) throw new DomainError('FEATURE_NOT_TRACKED', 409);
    if (input.spent > use.resource.max) throw new DomainError('AMOUNT_NOT_ALLOWED', 409, { max: use.resource.max });
    const state = character.featureState;
    if (use.sourceId === use.key) return this.save(ctx, character, { ...state, heroicInspiration: input.spent === 0 });
    const spent = { ...state.spent };
    if (input.spent === 0) delete spent[use.key];
    else spent[use.key] = input.spent;
    return this.save(ctx, character, { ...state, spent });
  }

  private save(ctx: CommandContext, character: Character, state: FeatureState) {
    this.characters.writeFeatureState(ctx, character.id, state);
    return { id: character.id, featureState: { spent: state.spent, weaponMasteries: state.weaponMasteries, heroicInspiration: state.heroicInspiration } };
  }
}
