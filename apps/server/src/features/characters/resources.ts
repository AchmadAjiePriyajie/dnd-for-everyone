import { randomInt, randomUUID } from 'node:crypto';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { deriveCharacter } from '#rules/character-stats';
import { addItem, adjustCoins, adjustItem, setAttunement, validateLoadout } from '#rules/equipment';
import { applyRest, type HitDieRoll, previewRest } from '#rules/rests';
import { setConcentration, spendSlot, validateSpells } from '#rules/spellcasting';
import { ErrorCodes, type ErrorCode, type Principal } from '#shared/access';
import { type Character, type CharacterResources, COINS, type RestPreview } from '#shared/characters';
import type { Id } from '#shared/contracts';
import type { CommandContext } from '../../commands/registry.js';
import { CommandsService } from '../../commands/dispatcher.js';
import { DomainError } from '../../common/domain-error.js';
import { ContentService } from '../../content/content.service.js';
import { CharactersService } from './service.js';

const contentId = z.string().regex(/^[a-z-]+\.[a-z0-9]+(-[a-z0-9]+)*$/).max(120);
const entryId = z.string().min(1).max(80);
const addItemPayload = z
  .strictObject({ itemId: contentId.optional(), custom: z.string().trim().min(1).max(80).optional(), quantity: z.number().int().min(1).max(9999), note: z.string().max(80).optional() })
  .refine((input) => !input.itemId !== !input.custom, { message: 'itemId xor custom' });
const adjustItemPayload = z.strictObject({ entryId, delta: z.number().int().min(-9999).max(9999) });
const attunePayload = z.strictObject({ entryId, attuned: z.boolean() });
const coinsPayload = z.strictObject({ coin: z.enum(COINS), delta: z.number().int().min(-1_000_000).max(1_000_000) });
const equipPayload = z.strictObject({ armorId: contentId.nullable(), shield: z.boolean() });
const classSpells = z.strictObject({ classId: contentId, cantrips: z.array(contentId).max(10), prepared: z.array(contentId).max(30) });
const spellsPayload = z.strictObject({ spells: z.array(classSpells).max(8), spellbook: z.array(contentId).max(120).optional() });
const slotPayload = z.strictObject({ level: z.number().int().min(1).max(9), pact: z.boolean().optional() });
const concentrationPayload = z.strictObject({ spellId: contentId.nullable() });
const hpPayload = z.strictObject({ current: z.number().int().min(0).max(9999), temp: z.number().int().min(0).max(9999) });
const restKind = z.enum(['short', 'long']);
const restPayload = z.strictObject({ rest: restKind, hitDice: z.record(contentId, z.number().int().min(1).max(20)).optional() });
const policyPayload = z.strictObject({ policy: z.enum(['dm', 'players']) });

const KNOWN = new Set<string>(Object.values(ErrorCodes));

/** Error kode dari packages/rules (`throw new Error(code)`) → error domain yang aman untuk client. */
function domain<T>(run: () => T): T {
  try {
    return run();
  } catch (cause) {
    if (cause instanceof DomainError) throw cause;
    const code = cause instanceof Error ? cause.message : '';
    if (KNOWN.has(code)) throw new DomainError(code as ErrorCode, 409);
    throw new DomainError('VALIDATION_FAILED', 400, { field: code || 'payload' });
  }
}

/**
 * Command inventory, koin, attunement, equipment, spell, slot, HP dan rest. Pemilik dan DM boleh
 * mengubah karakter final; rest mengikuti kebijakan rest campaign. Pemakaian dalam combat
 * baru di-commit oleh resolution (Task 18).
 */
@Injectable()
export class CharacterResourcesService implements OnModuleInit {
  constructor(
    private readonly commands: CommandsService,
    private readonly characters: CharactersService,
    private readonly content: ContentService,
  ) {}

  onModuleInit(): void {
    const register = <S extends z.ZodType>(kind: string, schema: S, handler: (ctx: CommandContext, character: Character, input: z.infer<S>) => unknown) =>
      this.commands.registerCommand(kind, (ctx, payload) => handler(ctx, this.editable(ctx), payload as z.infer<S>) as never, { schema });

    register('character.add-item', addItemPayload, (ctx, character, input) =>
      this.saveResources(ctx, character, domain(() => addItem(character.resources, input, randomUUID()))),
    );
    register('character.adjust-item', adjustItemPayload, (ctx, character, input) => {
      const resources = domain(() => adjustItem(character.resources, input.entryId, input.delta));
      return this.saveResources(ctx, character, resources, true);
    });
    register('character.set-attunement', attunePayload, (ctx, character, input) =>
      this.saveResources(ctx, character, domain(() => setAttunement(character, input.entryId, input.attuned, this.catalog()))),
    );
    register('character.adjust-coins', coinsPayload, (ctx, character, input) =>
      this.saveResources(ctx, character, domain(() => adjustCoins(character.resources, input.coin, input.delta))),
    );
    register('character.equip', equipPayload, (ctx, character, input) => {
      const next = { ...character, draft: { ...character.draft, equippedArmorId: input.armorId, shieldEquipped: input.shield } };
      const armor = input.armorId ? (this.catalog().has(input.armorId) ? this.catalog().getContent(input.armorId, 'en').mechanics?.armor : undefined) : null;
      if (armor === undefined || (armor && (armor as { category: string }).category === 'shield')) {
        throw new DomainError('VALIDATION_FAILED', 400, { field: 'armorId' });
      }
      this.requireLoadout(next);
      this.characters.writeEquipment(ctx, character, input.armorId, input.shield);
      // AC/serangan dihitung ulang dari equipment; override DM tidak disentuh.
      return { id: character.id, armorClass: deriveCharacter(next, this.catalog()).armorClass.value };
    });
    register('character.set-spells', spellsPayload, (ctx, character, input) => {
      const resources: CharacterResources = { ...character.resources, spells: input.spells, spellbook: input.spellbook ?? character.resources.spellbook };
      // Spell yang tidak lagi disiapkan tidak bisa tetap di-concentrate.
      const known = resources.spells.some((entry) => entry.cantrips.includes(resources.concentration ?? '') || entry.prepared.includes(resources.concentration ?? ''));
      if (!known) resources.concentration = null;
      const check = validateSpells({ ...character, resources }, this.catalog());
      if (!check.ok) throw new DomainError('SPELLS_INVALID', 409, { issue: check.issues[0]! });
      return this.saveResources(ctx, character, resources);
    });
    register('character.spend-slot', slotPayload, (ctx, character, input) =>
      this.saveResources(ctx, character, domain(() => spendSlot(character, this.catalog(), input.level, input.pact ?? false))),
    );
    register('character.set-concentration', concentrationPayload, (ctx, character, input) =>
      this.saveResources(ctx, character, domain(() => setConcentration(character, this.catalog(), input.spellId))),
    );
    register('character.set-hp', hpPayload, (ctx, character, input) => {
      const max = deriveCharacter(character, this.catalog()).hitPoints.value;
      if (input.current > max) throw new DomainError('HP_INVALID', 409, { max });
      return this.saveResources(ctx, character, { ...character.resources, hp: { damage: max - input.current, temp: input.temp } });
    });
    register('character.rest', restPayload, (ctx, character, input) => this.rest(ctx, character, input));
    this.commands.registerCommand(
      'campaign.set-rest-policy',
      (ctx, payload) => {
        if (ctx.targetId !== ctx.campaignId) throw new DomainError('VALIDATION_FAILED', 400, { field: 'targetId' });
        const { policy } = payload as z.infer<typeof policyPayload>;
        ctx.db.prepare('UPDATE campaigns SET rest_policy = ? WHERE id = ?').run(policy, ctx.campaignId);
        return { policy };
      },
      { schema: policyPayload, roles: ['dm'] },
    );
  }

  /** Pratinjau rest tanpa lemparan Hit Point Dice (lemparan baru terjadi saat dikonfirmasi). */
  previewRest(principal: Principal, campaignId: Id, characterId: Id, rest: 'short' | 'long'): RestPreview {
    const { character } = this.characters.getCharacter(principal, campaignId, characterId);
    return domain(() => previewRest(character, this.catalog(), rest));
  }

  private rest(ctx: CommandContext, character: Character, input: z.infer<typeof restPayload>) {
    if (ctx.member.role !== 'dm' && this.characters.restPolicy(ctx.db, ctx.campaignId) !== 'players') throw new DomainError('REST_NEEDS_DM', 403);
    if (input.rest === 'long' && input.hitDice && Object.keys(input.hitDice).length) throw new DomainError('VALIDATION_FAILED', 400, { field: 'hitDice' });
    const dice = deriveCharacter(character, this.catalog()).hitDice;
    // Lemparan server disimpan di receipt: retry requestId yang sama tidak melempar ulang.
    const rolls: HitDieRoll[] = [];
    for (const [classId, count] of Object.entries(input.hitDice ?? {})) {
      const die = dice.find((entry) => entry.classId === classId)?.die;
      if (!die) throw new DomainError('NO_HIT_DICE', 409);
      for (let index = 0; index < count; index++) rolls.push({ classId, roll: randomInt(1, die + 1) });
    }
    const rested = domain(() => applyRest(character, this.catalog(), input.rest, rolls));
    this.characters.writeFeatureState(ctx, character.id, rested.featureState);
    this.characters.writeResources(ctx, character.id, rested.resources);
    const derived = deriveCharacter(rested, this.catalog());
    return { id: character.id, rest: input.rest, rolls, hitPoints: derived.currentHitPoints };
  }

  /** Karakter final yang boleh diubah actor: DM untuk semua karakter campaign, player hanya miliknya. */
  private editable(ctx: CommandContext): Character {
    const character = ctx.member.role === 'dm' ? this.characters.campaignCharacter(ctx) : this.characters.ownedCharacter(ctx);
    if (character.status !== 'final') throw new DomainError('CHARACTER_NOT_FINAL', 409);
    return character;
  }

  private requireLoadout(character: Character): void {
    const check = validateLoadout(character, this.catalog());
    if (!check.ok) throw new DomainError('LOADOUT_INVALID', 409, { issue: check.issues[0]! });
  }

  /**
   * Simpan resource. `unequipGone`: armor/shield yang habis dari inventory otomatis dilepas,
   * agar AC tidak lagi memakai item yang sudah tidak dibawa.
   */
  private saveResources(ctx: CommandContext, character: Character, resources: CharacterResources, unequipGone = false) {
    let next: Character = { ...character, resources };
    if (unequipGone) {
      const carries = (id: Id) => resources.inventory.some((entry) => entry.itemId === id);
      const armorId = next.draft.equippedArmorId && carries(next.draft.equippedArmorId) ? next.draft.equippedArmorId : null;
      const shield = next.draft.shieldEquipped && carries('equipment.shield');
      if (armorId !== next.draft.equippedArmorId || shield !== next.draft.shieldEquipped) {
        this.characters.writeEquipment(ctx, character, armorId, shield);
        next = { ...next, draft: { ...next.draft, equippedArmorId: armorId, shieldEquipped: shield } };
      }
    }
    this.requireLoadout(next);
    this.characters.writeResources(ctx, character.id, resources);
    return { id: character.id };
  }

  private catalog() {
    return this.content.catalog();
  }
}
