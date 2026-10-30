import type { ContentCatalog } from '#shared/content';
import type { Id } from '#shared/contracts';
import {
  ABILITIES,
  type AbilityKey,
  type Character,
  type CharacterDraft,
  type Contribution,
  type DerivedCharacter,
  type DerivedValue,
  type DerivedWarning,
  type DraftIssue,
  type InventoryItem,
  type OverrideField,
  SKILLS,
  type SkillKey,
  type ToolChoice,
} from '#shared/characters';
import { ABILITY_SCORE_CAP, abilityModifier, SKILL_ABILITIES, STANDARD_LANGUAGES, validateBaseScores } from './abilities.ts';

/** Bentuk mekanik corpus yang dibaca di sini (lihat ingest_characters.py / ingest_equipment.py). */
interface ClassMechanics {
  hitDie: number;
  savingThrows: AbilityKey[];
  skillChoices: { count: number; from?: SkillKey[] };
  weaponProficiencies: { categories: string[]; martialWithProperty?: Id[] };
  armorTraining: string[];
  toolProficiencies?: ToolProficiencies;
  startingEquipment: EquipmentOption[];
  progression: Array<{ level: number; proficiencyBonus: number }>;
}
interface BackgroundMechanics {
  abilityScores: AbilityKey[];
  feat: Id;
  featOption?: string;
  skills: SkillKey[];
  toolProficiencies: ToolProficiencies;
  startingEquipment: EquipmentOption[];
}
interface SpeciesMechanics {
  size: string[];
  speed: number;
  darkvision?: number;
  hpPerLevel?: number;
  skillChoice?: { count: number; from?: SkillKey[] };
  originFeatChoice?: boolean;
}
interface FeatMechanics {
  category: string;
  repeatable?: boolean;
  initiativeProficiency?: boolean;
  hpPerLevel?: number;
  proficiencyChoice?: number;
}
interface ToolProficiencies {
  fixed: Id[];
  choices: Array<{ count: number; from: Array<'artisans-tools' | 'musical-instrument' | 'gaming-set'> }>;
}
interface EquipmentOption {
  option: string;
  items: Array<{ id?: Id; quantity: number; note?: string; choice?: string; custom?: string }>;
  gp: number;
}
interface ArmorMechanics {
  category: 'light' | 'medium' | 'heavy' | 'shield';
  baseAc: number;
  dexCap: number | null;
  strength?: number;
}

const SHIELD_ID = 'equipment.shield';
/** Penalti Speed bila Strength di bawah syarat armor Heavy. */
const ARMOR_STRENGTH_SPEED_PENALTY = 10;
const DEFAULT_SCORE = 10;
const BASE_AC = 10;
const PASSIVE_BASE = 10;

function mechanicsOf<T>(catalog: ContentCatalog, id: Id | null, kind: string): T | null {
  if (!id || !id.startsWith(`${kind}.`) || !catalog.has(id)) return null;
  return catalog.getContent(id, 'en').mechanics as unknown as T | null;
}

const sum = (contributions: Contribution[]) => contributions.reduce((total, item) => total + item.value, 0);

function value(contributions: Contribution[], override: number | undefined = undefined): DerivedValue {
  const base = sum(contributions);
  return { base, value: override ?? base, override: override ?? null, contributions };
}

/** Lembar karakter turunan beserta asal setiap angka; `issues` kosong = siap difinalisasi. */
export function deriveCharacter(character: Character, catalog: ContentCatalog): DerivedCharacter {
  const draft = character.draft;
  const issues: DraftIssue[] = [];
  const warnings: DerivedWarning[] = [];
  const issue = (field: string, code: DraftIssue['code'], params?: DraftIssue['params']) =>
    issues.push(params ? { field, code, params } : { field, code });

  const classId = character.classLevels[0]?.classId ?? draft.classId;
  const cls = mechanicsOf<ClassMechanics>(catalog, classId, 'class');
  const background = mechanicsOf<BackgroundMechanics>(catalog, draft.backgroundId, 'background');
  const species = mechanicsOf<SpeciesMechanics>(catalog, draft.speciesId, 'species');
  const level = Math.max(1, character.classLevels.reduce((total, entry) => total + entry.level, 0));

  if (!draft.name.trim()) issue('name', 'REQUIRED');
  if (!draft.speciesId) issue('speciesId', 'REQUIRED');
  else if (!species) issue('speciesId', 'INVALID', { value: draft.speciesId });
  if (!draft.backgroundId) issue('backgroundId', 'REQUIRED');
  else if (!background) issue('backgroundId', 'INVALID', { value: draft.backgroundId });
  if (!classId) issue('classId', 'REQUIRED');
  else if (!cls) issue('classId', 'INVALID', { value: classId });

  if (species) {
    if (species.size.length > 1 && !draft.size) issue('size', 'REQUIRED');
    else if (draft.size && !species.size.includes(draft.size)) issue('size', 'INVALID', { value: draft.size });
  }

  // ---------------------------------------------------------------- ability scores
  if (!draft.abilityMethod) issue('abilityMethod', 'REQUIRED');
  else issues.push(...validateBaseScores(draft.abilityMethod, draft.baseScores, character.rolls));

  const increase: Partial<Record<AbilityKey, number>> = {};
  if (!draft.backgroundIncrease) issue('backgroundIncrease', 'REQUIRED');
  else if (background) {
    const allowed = background.abilityScores;
    if (draft.backgroundIncrease.mode === '1-1-1') {
      for (const ability of allowed) increase[ability] = 1;
    } else {
      const { plus2, plus1 } = draft.backgroundIncrease;
      const bad = [plus2, plus1].find((ability) => !allowed.includes(ability));
      if (bad) issue('backgroundIncrease', 'INVALID', { value: bad });
      else if (plus2 === plus1) issue('backgroundIncrease', 'INVALID', { value: plus1 });
      else {
        increase[plus2] = 2;
        increase[plus1] = 1;
      }
    }
  }

  const abilities = {} as DerivedCharacter['abilities'];
  for (const ability of ABILITIES) {
    const base = draft.baseScores[ability] ?? DEFAULT_SCORE;
    const contributions: Contribution[] = [{ source: 'base', value: base }];
    const bonus = Math.min(increase[ability] ?? 0, Math.max(0, ABILITY_SCORE_CAP - base));
    if (bonus > 0 && draft.backgroundId) contributions.push({ source: draft.backgroundId, value: bonus });
    const score = value(contributions);
    abilities[ability] = { score, modifier: abilityModifier(score.value) };
  }
  const mod = (ability: AbilityKey) => abilities[ability].modifier;
  const modifier = (ability: AbilityKey): Contribution => ({ source: 'rule.ability-modifier', detail: ability, value: mod(ability) });

  const proficiencyBonus = cls?.progression.find((step) => step.level === level)?.proficiencyBonus ?? 2;
  const proficiency: Contribution = { source: 'rule.proficiency', value: proficiencyBonus };

  // ---------------------------------------------------------------- feats
  const feats: Id[] = [];
  if (background?.feat) feats.push(background.feat);
  if (species?.originFeatChoice) {
    const extra = mechanicsOf<FeatMechanics>(catalog, draft.extraOriginFeatId, 'feat');
    if (!draft.extraOriginFeatId) issue('extraOriginFeatId', 'REQUIRED');
    else if (!extra || extra.category !== 'origin') issue('extraOriginFeatId', 'INVALID', { value: draft.extraOriginFeatId });
    else if (feats.includes(draft.extraOriginFeatId) && !extra.repeatable) issue('extraOriginFeatId', 'INVALID', { value: draft.extraOriginFeatId });
    else feats.push(draft.extraOriginFeatId);
  } else if (draft.extraOriginFeatId) issue('extraOriginFeatId', 'NOT_ALLOWED');
  const featMechanics = feats.map((id) => [id, mechanicsOf<FeatMechanics>(catalog, id, 'feat') ?? { category: 'origin' }] as const);
  if (background?.featOption) warnings.push({ code: 'FEAT_CHOICES_PENDING', params: { feat: background.feat } });

  // ---------------------------------------------------------------- skills
  const skillSources = new Map<SkillKey, Id[]>();
  const grant = (skill: SkillKey, source: Id) => skillSources.set(skill, [...(skillSources.get(skill) ?? []), source]);
  for (const skill of background?.skills ?? []) grant(skill, draft.backgroundId!);

  const pickSkills = (field: string, picks: SkillKey[], choice: { count: number; from?: SkillKey[] } | undefined, source: Id | null) => {
    const expected = choice?.count ?? 0;
    if (picks.length !== expected) issue(field, 'COUNT', { expected });
    for (const skill of picks) {
      if ((choice?.from && !choice.from.includes(skill)) || skillSources.has(skill)) issue(field, 'INVALID', { value: skill });
      else if (source) grant(skill, source);
    }
  };
  if (cls) pickSkills('classSkills', draft.classSkills, cls.skillChoices, classId);
  else issue('classSkills', 'REQUIRED');
  if (species) pickSkills('speciesSkills', draft.speciesSkills, species.skillChoice, draft.speciesId);
  const skilled = featMechanics.find(([, feat]) => feat.proficiencyChoice);
  pickSkills('featSkills', draft.featSkills, skilled ? { count: skilled[1].proficiencyChoice! } : undefined, skilled?.[0] ?? null);

  const skills = {} as DerivedCharacter['skills'];
  for (const skill of SKILLS) {
    const ability = SKILL_ABILITIES[skill];
    const sources = skillSources.get(skill) ?? [];
    const proficient = sources.length > 0;
    skills[skill] = { ability, proficient, sources, bonus: value(proficient ? [modifier(ability), proficiency] : [modifier(ability)]) };
  }
  const savingThrows = {} as DerivedCharacter['savingThrows'];
  for (const ability of ABILITIES) {
    const proficient = cls?.savingThrows.includes(ability) ?? false;
    savingThrows[ability] = { proficient, bonus: value(proficient ? [modifier(ability), proficiency] : [modifier(ability)]) };
  }

  // ---------------------------------------------------------------- languages
  if (draft.languages.length !== 2) issue('languages', draft.languages.length ? 'COUNT' : 'REQUIRED', { expected: 2 });
  for (const language of draft.languages) {
    if (!STANDARD_LANGUAGES.includes(language) || draft.languages.indexOf(language) !== draft.languages.lastIndexOf(language)) {
      issue('languages', 'INVALID', { value: language });
    }
  }

  // ---------------------------------------------------------------- tools
  const toolSlots = [...(cls?.toolProficiencies?.choices ?? []), ...(background?.toolProficiencies.choices ?? [])].flatMap((choice) =>
    Array.from({ length: choice.count }, () => choice.from),
  );
  if (draft.toolChoices.length !== toolSlots.length) issue('toolChoices', 'COUNT', { expected: toolSlots.length });
  const remaining = [...toolSlots];
  for (const tool of draft.toolChoices) {
    const slot = remaining.findIndex((groups) => fitsToolGroup(tool, groups, catalog));
    if (slot === -1) issue('toolChoices', 'INVALID', { value: 'id' in tool ? tool.id : tool.group });
    else remaining.splice(slot, 1);
  }
  const fixedTools = [...(cls?.toolProficiencies?.fixed ?? []), ...(background?.toolProficiencies.fixed ?? [])];
  const tools: ToolChoice[] = [...new Set(fixedTools)].map((id) => ({ id }));
  for (const tool of draft.toolChoices) tools.push(tool);

  // ---------------------------------------------------------------- equipment
  const inventory: InventoryItem[] = [];
  let gp = 0;
  const addOption = (field: string, options: EquipmentOption[] | undefined, chosen: string | null, source: Id | null) => {
    if (!chosen) return issue(field, 'REQUIRED');
    if (!options || !source) return;
    const option = options.find((candidate) => candidate.option === chosen);
    if (!option) return issue(field, 'INVALID', { value: chosen });
    gp += option.gp;
    for (const item of option.items) addItem(inventory, resolveItem(item, draft.toolChoices), source);
  };
  addOption('classEquipment', cls?.startingEquipment, draft.classEquipment, classId);
  addOption('backgroundEquipment', background?.startingEquipment, draft.backgroundEquipment, draft.backgroundId);
  const owns = (id: Id) => inventory.some((item) => item.id === id);

  // ---------------------------------------------------------------- armor class & speed
  const training = cls?.armorTraining ?? [];
  const armorClass: Contribution[] = [];
  const speed: Contribution[] = [];
  if (species && draft.speciesId) speed.push({ source: draft.speciesId, value: species.speed });
  const armor = draft.equippedArmorId ? mechanicsOf<{ armor?: ArmorMechanics }>(catalog, draft.equippedArmorId, 'equipment')?.armor : undefined;
  if (draft.equippedArmorId && (!armor || armor.category === 'shield')) {
    issue('equippedArmorId', 'INVALID', { value: draft.equippedArmorId });
  } else if (armor && draft.equippedArmorId) {
    if (!owns(draft.equippedArmorId)) issue('equippedArmorId', 'NOT_ALLOWED');
    if (!training.includes(armor.category)) warnings.push({ code: 'ARMOR_UNTRAINED', params: { armor: draft.equippedArmorId } });
    armorClass.push({ source: draft.equippedArmorId, value: armor.baseAc });
    if (armor.category !== 'heavy') {
      armorClass.push({ ...modifier('dex'), value: armor.dexCap === null ? mod('dex') : Math.min(mod('dex'), armor.dexCap) });
    }
    if (armor.strength && abilities.str.score.value < armor.strength) {
      warnings.push({ code: 'ARMOR_STRENGTH', params: { armor: draft.equippedArmorId, strength: armor.strength } });
      speed.push({ source: draft.equippedArmorId, value: -ARMOR_STRENGTH_SPEED_PENALTY });
    }
  }
  if (!armorClass.length) armorClass.push({ source: 'rule.base-ac', value: BASE_AC }, modifier('dex'));
  if (draft.shieldEquipped) {
    const shield = mechanicsOf<{ armor?: ArmorMechanics }>(catalog, SHIELD_ID, 'equipment')?.armor;
    if (!owns(SHIELD_ID)) issue('shieldEquipped', 'NOT_ALLOWED');
    if (!training.includes('shield')) warnings.push({ code: 'SHIELD_UNTRAINED', params: { armor: SHIELD_ID } });
    if (shield) armorClass.push({ source: SHIELD_ID, value: shield.baseAc });
  }

  // ---------------------------------------------------------------- hit points & initiative
  const hitPoints: Contribution[] = [];
  if (cls && classId) {
    // Level 1: nilai maksimum Hit Point Die. Level berikutnya ditangani Task 10 (advancement).
    hitPoints.push({ source: classId, value: cls.hitDie });
    hitPoints.push({ ...modifier('con'), value: mod('con') * level });
  }
  if (species?.hpPerLevel && draft.speciesId) hitPoints.push({ source: draft.speciesId, value: species.hpPerLevel * level });
  for (const [id, feat] of featMechanics) if (feat.hpPerLevel) hitPoints.push({ source: id, value: feat.hpPerLevel * level });
  const initiative: Contribution[] = [modifier('dex')];
  for (const [id, feat] of featMechanics) if (feat.initiativeProficiency) initiative.push({ source: id, value: proficiencyBonus });

  const perception = skills.perception;
  const passive: Contribution[] = [{ source: 'rule.passive', value: PASSIVE_BASE }, ...perception.bonus.contributions];

  const override = (field: OverrideField) => character.overrides[field];
  const hp = value(hitPoints, override('hitPoints'));
  if (hp.value < 1 && hitPoints.length) hp.value = 1;

  return {
    level,
    proficiencyBonus,
    abilities,
    savingThrows,
    skills,
    armorClass: value(armorClass, override('armorClass')),
    hitPoints: hp,
    initiative: value(initiative, override('initiative')),
    speed: value(speed, override('speed')),
    passivePerception: value(passive, override('passivePerception')),
    darkvision: species?.darkvision ?? null,
    armorTraining: training,
    weaponProficiencies: { categories: cls?.weaponProficiencies.categories ?? [], martialWithProperty: cls?.weaponProficiencies.martialWithProperty ?? [] },
    tools,
    languages: ['Common', ...draft.languages],
    feats,
    inventory,
    gp,
    warnings,
    issues,
  };
}

function fitsToolGroup(tool: ToolChoice, groups: string[], catalog: ContentCatalog): boolean {
  if ('group' in tool) return groups.includes(tool.group);
  const mechanics = mechanicsOf<{ tool?: { artisan?: boolean } }>(catalog, tool.id, 'equipment');
  return groups.includes('artisans-tools') && mechanics?.tool?.artisan === true;
}

/** Item paket awal → item inventory; item "pilihan" mengikuti alat yang dipilih pemain. */
function resolveItem(item: EquipmentOption['items'][number], toolChoices: ToolChoice[]): Omit<InventoryItem, 'sources'> {
  if (item.custom) return { id: null, custom: item.custom, quantity: item.quantity };
  if (item.choice === 'musical-instrument' || item.choice === 'gaming-set') {
    const chosen = toolChoices.find((tool) => 'group' in tool && tool.group === item.choice);
    const variant = chosen && 'group' in chosen ? chosen.variant : undefined;
    return { id: `equipment.${item.choice}`, quantity: item.quantity, ...(variant ? { note: variant } : {}) };
  }
  if (item.choice === 'tool-proficiency') {
    const chosen = toolChoices[0];
    if (chosen && 'id' in chosen) return { id: chosen.id, quantity: item.quantity };
    if (chosen) return { id: `equipment.${chosen.group}`, quantity: item.quantity, note: chosen.variant };
    return { id: null, custom: 'tool-proficiency', quantity: item.quantity };
  }
  return { id: item.id ?? null, quantity: item.quantity, ...(item.note ? { note: item.note } : {}) };
}

function addItem(inventory: InventoryItem[], item: Omit<InventoryItem, 'sources'>, source: Id): void {
  const existing = inventory.find((other) => other.id === item.id && other.custom === item.custom && other.note === item.note);
  if (existing) {
    existing.quantity += item.quantity;
    if (!existing.sources.includes(source)) existing.sources.push(source);
    return;
  }
  inventory.push({ ...item, sources: [source] });
}

