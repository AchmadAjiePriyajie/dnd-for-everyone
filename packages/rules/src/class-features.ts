import type { ContentCatalog, ValidationResult } from '#shared/content';
import type { Id, Locale } from '#shared/contracts';
import {
  type AbilityKey,
  type Character,
  type FeatureAction,
  type FeatureRecovery,
  type FeatureState,
  type FeatureUse,
  HEROIC_INSPIRATION,
} from '#shared/characters';
import { deriveCharacter } from './character-stats.ts';

/** Jumlah pemakaian/poin menurut teks fitur. */
type Uses =
  /** Pasangan [mulai level class, jumlah], mis. Action Surge [[2,1],[17,2]]. */
  | { fixed: Array<[number, number]> }
  /** Kolom tabel fitur class, mis. "rages". */
  | { column: string }
  /** Modifier ability (minimum sekali). */
  | { ability: AbilityKey }
  /** Pool = n × level class, mis. Lay On Hands. */
  | { perLevel: number };

interface FeatureRule {
  action?: FeatureAction;
  uses?: Uses;
  unit?: 'uses' | 'points';
  recovery?: { short: FeatureRecovery; long: FeatureRecovery };
  /** Menghabiskan resource fitur lain. */
  cost?: { resource: string; amount: number };
  /** Fitur lain yang mengubah recovery fitur ini begitu dimiliki (Font of Inspiration). */
  improvedBy?: { feature: string; recovery: { short: FeatureRecovery; long: FeatureRecovery } };
}

const once: Uses = { fixed: [[1, 1]] };
const SHORT_ONE = { short: 'one', long: 'all' } as const;
const SHORT_ALL = { short: 'all', long: 'all' } as const;
const LONG = { short: 'none', long: 'all' } as const;

/**
 * Action dan resource per fitur, disalin dari teks SRD 5.2.1 (kalimat "As a Bonus Action",
 * "You regain one expended use when you finish a Short Rest", dst.). Fitur yang tidak tercantum
 * hanya punya teks referensi. Fitur dengan pilihan rumit (Mystic Arcanum, Signature Spells,
 * Natural Recovery, Overchannel) sengaja manual sampai spellcasting tersedia.
 */
export const FEATURE_RULES: Record<string, FeatureRule> = {
  'class.barbarian/rage': { action: 'bonus-action', uses: { column: 'rages' }, recovery: SHORT_ONE },
  'class.barbarian/persistent-rage': { action: 'special', uses: once, recovery: LONG },
  'class.bard/bardic-inspiration': {
    action: 'bonus-action',
    uses: { ability: 'cha' },
    recovery: LONG,
    improvedBy: { feature: 'class.bard/font-of-inspiration', recovery: SHORT_ALL },
  },
  'class.bard/countercharm': { action: 'reaction' },
  'class.cleric/channel-divinity': { action: 'magic-action', uses: { column: 'channel-divinity' }, recovery: SHORT_ONE },
  'class.cleric/divine-intervention': { action: 'magic-action', uses: once, recovery: LONG },
  'class.druid/wild-shape': { action: 'bonus-action', uses: { column: 'wild-shape' }, recovery: SHORT_ONE },
  'class.druid/wild-companion': { action: 'magic-action', cost: { resource: 'class.druid/wild-shape', amount: 1 } },
  'class.druid/wild-resurgence': { action: 'no-action', uses: once, recovery: LONG },
  'class.druid/archdruid': { action: 'no-action', uses: once, recovery: LONG },
  'class.fighter/second-wind': { action: 'bonus-action', uses: { column: 'second-wind' }, recovery: SHORT_ONE },
  'class.fighter/action-surge': { action: 'no-action', uses: { fixed: [[2, 1], [17, 2]] }, recovery: SHORT_ALL },
  'class.fighter/tactical-mind': { action: 'no-action', cost: { resource: 'class.fighter/second-wind', amount: 1 } },
  'class.fighter/indomitable': { action: 'no-action', uses: { fixed: [[9, 1], [13, 2], [17, 3]] }, recovery: LONG },
  'class.monk/martial-arts': { action: 'bonus-action' },
  'class.monk/monks-focus': { action: 'bonus-action', uses: { column: 'focus-points' }, unit: 'points', recovery: SHORT_ALL },
  'class.monk/uncanny-metabolism': { action: 'special', uses: once, recovery: LONG },
  'class.monk/deflect-attacks': { action: 'reaction' },
  'class.monk/slow-fall': { action: 'reaction' },
  'class.monk/stunning-strike': { action: 'no-action', cost: { resource: 'class.monk/monks-focus', amount: 1 } },
  'class.paladin/lay-on-hands': { action: 'bonus-action', uses: { perLevel: 5 }, unit: 'points', recovery: LONG },
  'class.paladin/paladins-smite': { action: 'bonus-action', uses: once, recovery: LONG },
  'class.paladin/channel-divinity': { action: 'special', uses: { column: 'channel-divinity' }, recovery: SHORT_ONE },
  'class.paladin/faithful-steed': { action: 'magic-action', uses: once, recovery: LONG },
  'class.paladin/abjure-foes': { action: 'magic-action', cost: { resource: 'class.paladin/channel-divinity', amount: 1 } },
  'class.ranger/favored-enemy': { action: 'bonus-action', uses: { column: 'favored-enemy' }, recovery: LONG },
  'class.ranger/tireless': { action: 'magic-action', uses: { ability: 'wis' }, recovery: LONG },
  'class.ranger/natures-veil': { action: 'bonus-action', uses: { ability: 'wis' }, recovery: LONG },
  'class.rogue/cunning-action': { action: 'bonus-action' },
  'class.rogue/steady-aim': { action: 'bonus-action' },
  'class.rogue/uncanny-dodge': { action: 'reaction' },
  'class.rogue/stroke-of-luck': { action: 'no-action', uses: once, recovery: SHORT_ALL },
  'class.sorcerer/innate-sorcery': { action: 'bonus-action', uses: { fixed: [[1, 2]] }, recovery: LONG },
  'class.sorcerer/font-of-magic': { action: 'bonus-action', uses: { column: 'sorcery-points' }, unit: 'points', recovery: LONG },
  'class.sorcerer/sorcerous-restoration': { action: 'special', uses: once, recovery: LONG },
  'class.warlock/magical-cunning': { action: 'special', uses: once, recovery: LONG },
  'class.warlock/contact-patron': { action: 'magic-action', uses: once, recovery: LONG },
  'class.wizard/arcane-recovery': { action: 'special', uses: once, recovery: LONG },
  'subclass.circle-of-the-land/lands-aid': { action: 'magic-action', cost: { resource: 'class.druid/wild-shape', amount: 1 } },
  'subclass.circle-of-the-land/natures-sanctuary': { action: 'magic-action', cost: { resource: 'class.druid/wild-shape', amount: 1 } },
  'subclass.college-of-lore/cutting-words': { action: 'reaction', cost: { resource: 'class.bard/bardic-inspiration', amount: 1 } },
  'subclass.college-of-lore/peerless-skill': { action: 'no-action', cost: { resource: 'class.bard/bardic-inspiration', amount: 1 } },
  'subclass.draconic-sorcery/dragon-wings': { action: 'bonus-action', uses: once, recovery: LONG },
  'subclass.draconic-sorcery/dragon-companion': { action: 'magic-action', uses: once, recovery: LONG },
  'subclass.fiend-patron/dark-ones-own-luck': { action: 'no-action', uses: { ability: 'cha' }, recovery: LONG },
  'subclass.fiend-patron/hurl-through-hell': { action: 'no-action', uses: once, recovery: LONG },
  'subclass.hunter/superior-hunters-defense': { action: 'reaction' },
  'subclass.life-domain/preserve-life': { action: 'magic-action', cost: { resource: 'class.cleric/channel-divinity', amount: 1 } },
  'subclass.oath-of-devotion/sacred-weapon': { action: 'no-action', cost: { resource: 'class.paladin/channel-divinity', amount: 1 } },
  'subclass.oath-of-devotion/holy-nimbus': { action: 'bonus-action', uses: once, recovery: LONG },
  'subclass.path-of-the-berserker/retaliation': { action: 'reaction' },
  'subclass.path-of-the-berserker/intimidating-presence': { action: 'bonus-action', uses: once, recovery: LONG },
  'subclass.thief/fast-hands': { action: 'bonus-action' },
  'subclass.warrior-of-the-open-hand/wholeness-of-body': { action: 'bonus-action', uses: { ability: 'wis' }, recovery: LONG },
  'subclass.warrior-of-the-open-hand/quivering-palm': { action: 'no-action', cost: { resource: 'class.monk/monks-focus', amount: 4 } },
};

/** Fitur yang menurut aturan multiclass tidak bertumpuk bila diperoleh dari beberapa class. */
const NON_STACKING = new Set(['extra-attack']);

interface ClassFeatureMechanics {
  progression?: Array<{ level: number; columns?: Record<string, string> }>;
  features: Array<{ level: number; id: string }>;
  class?: Id;
}

interface Section {
  name: string;
  text: string;
}

const sectionCache = new WeakMap<ContentCatalog, Map<string, Section[]>>();

/** Bagian "Level N: Nama" pada body entri, berurutan sama dengan `mechanics.features`. */
function sections(catalog: ContentCatalog, id: Id, locale: Locale): Section[] {
  let cache = sectionCache.get(catalog);
  if (!cache) sectionCache.set(catalog, (cache = new Map()));
  const cacheKey = `${id}:${locale}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const parts = catalog.getContent(id, locale).body.split(/^(?=#{3,5} \S+ \d+: )/m).slice(1);
  const result = parts.map((part) => {
    const newline = part.indexOf('\n');
    const heading = newline === -1 ? part : part.slice(0, newline);
    return { name: heading.slice(heading.indexOf(': ') + 2).trim(), text: newline === -1 ? '' : part.slice(newline + 1).trim() };
  });
  cache.set(cacheKey, result);
  return result;
}

function mechanicsOf(catalog: ContentCatalog, id: Id): ClassFeatureMechanics | null {
  if (!catalog.has(id)) return null;
  return catalog.getContent(id, 'en').mechanics as unknown as ClassFeatureMechanics | null;
}

const RECOVERY_NONE = { short: 'none', long: 'none' } as const;

/**
 * Fitur class/subclass yang sudah dimiliki karakter pada level class-nya, plus Heroic Inspiration.
 * Batas pemakaian dihitung dari corpus; state hanya menyimpan yang sudah dihabiskan.
 */
export function availableFeatures(character: Character, catalog: ContentCatalog, locale: Locale = 'en'): FeatureUse[] {
  const derived = deriveCharacter(character, catalog);
  const spent = character.featureState.spent;
  const uses: FeatureUse[] = [];
  const owned = new Set<string>();
  const seen = new Set<string>();

  const collect = (sourceId: Id, classId: Id, classLevel: number) => {
    const mechanics = mechanicsOf(catalog, sourceId);
    const classMechanics = mechanicsOf(catalog, classId);
    if (!mechanics || !classMechanics) return;
    const localized = sections(catalog, sourceId, locale);
    const original = sections(catalog, sourceId, 'en');
    const columns = classMechanics.progression?.find((step) => step.level === classLevel)?.columns ?? {};
    mechanics.features.forEach((feature, index) => {
      if (feature.level > classLevel) return;
      if (NON_STACKING.has(feature.id)) {
        if (seen.has(feature.id)) return;
        seen.add(feature.id);
      }
      const key = `${sourceId}/${feature.id}`;
      const rule = FEATURE_RULES[key];
      owned.add(key);
      let resource: FeatureUse['resource'] = null;
      if (rule?.uses) {
        const max = maxUses(rule.uses, classLevel, columns, (ability) => derived.abilities[ability].modifier);
        const used = Math.min(spent[key] ?? 0, max);
        resource = { max, spent: used, remaining: max - used, unit: rule.unit ?? 'uses', recovery: rule.recovery ?? RECOVERY_NONE };
      }
      uses.push({
        key,
        sourceId,
        featureId: feature.id,
        level: feature.level,
        name: localized[index]?.name ?? original[index]?.name ?? feature.id,
        originalName: original[index]?.name ?? feature.id,
        action: rule?.action ?? null,
        automation: rule?.uses || rule?.cost ? 'tracked' : 'manual',
        resource,
        cost: rule?.cost ?? null,
        text: localized[index]?.text ?? '',
      });
    });
  };

  for (const { classId, level, subclassId } of character.classLevels) {
    collect(classId, classId, level);
    if (subclassId && mechanicsOf(catalog, subclassId)?.class === classId) collect(subclassId, classId, level);
  }
  // Recovery yang ditingkatkan fitur lain (mis. Font of Inspiration) berlaku setelah fitur itu dimiliki.
  for (const use of uses) {
    const improved = FEATURE_RULES[use.key]?.improvedBy;
    if (improved && use.resource && owned.has(improved.feature)) use.resource.recovery = improved.recovery;
  }

  const inspiration = catalog.getContent(HEROIC_INSPIRATION, locale);
  const inspired = character.featureState.heroicInspiration;
  uses.push({
    key: HEROIC_INSPIRATION,
    sourceId: HEROIC_INSPIRATION,
    featureId: 'heroic-inspiration',
    level: 1,
    name: inspiration.name,
    originalName: inspiration.originalName,
    action: 'no-action',
    automation: 'tracked',
    // Punya atau tidak; diperoleh dari DM atau fitur tertentu, tidak pulih otomatis pada rest.
    resource: { max: 1, spent: inspired ? 0 : 1, remaining: inspired ? 1 : 0, unit: 'uses', recovery: RECOVERY_NONE },
    cost: null,
    text: inspiration.body,
  });
  return uses;
}

function maxUses(uses: Uses, classLevel: number, columns: Record<string, string>, modifier: (ability: AbilityKey) => number): number {
  if ('fixed' in uses) return uses.fixed.reduce((count, [from, value]) => (classLevel >= from ? value : count), 0);
  if ('column' in uses) {
    const value = Number.parseInt(columns[uses.column] ?? '', 10);
    return Number.isFinite(value) ? value : 0;
  }
  if ('ability' in uses) return Math.max(1, modifier(uses.ability));
  return uses.perLevel * classLevel;
}

/**
 * Validasi memakai fitur. `amount` hanya untuk resource berupa poin (Lay On Hands, Focus Points).
 * Ruling: katalog ikut sebagai parameter karena kepemilikan fitur dibaca dari corpus.
 */
export function validateFeatureUse(character: Character, featureId: Id, catalog: ContentCatalog, amount?: number): ValidationResult {
  const plan = spendPlan(character, featureId, catalog, amount);
  return 'issue' in plan ? { ok: false, issues: [plan.issue] } : { ok: true, issues: [] };
}

function spendPlan(character: Character, key: string, catalog: ContentCatalog, amount?: number): { resource: string; amount: number } | { issue: string } {
  const features = availableFeatures(character, catalog);
  const use = features.find((feature) => feature.key === key);
  if (!use) return { issue: 'FEATURE_NOT_OWNED' };
  if (use.cost) {
    if (amount !== undefined && amount !== use.cost.amount) return { issue: 'AMOUNT_NOT_ALLOWED' };
    const target = features.find((feature) => feature.key === use.cost!.resource);
    if (!target?.resource) return { issue: 'FEATURE_NOT_OWNED' };
    if (target.resource.remaining < use.cost.amount) return { issue: 'NO_USES_LEFT' };
    return { resource: target.key, amount: use.cost.amount };
  }
  if (!use.resource) return { issue: 'FEATURE_NOT_TRACKED' };
  const spend = amount ?? 1;
  if (!Number.isInteger(spend) || spend < 1 || (use.resource.unit !== 'points' && spend !== 1)) return { issue: 'AMOUNT_NOT_ALLOWED' };
  if (use.resource.remaining < spend) return { issue: 'NO_USES_LEFT' };
  return { resource: use.key, amount: spend };
}

/** State baru setelah memakai fitur; melempar Error(kode) bila tidak valid. */
export function spendFeature(character: Character, featureId: Id, catalog: ContentCatalog, amount?: number): FeatureState {
  const plan = spendPlan(character, featureId, catalog, amount);
  if ('issue' in plan) throw new Error(plan.issue);
  const state = character.featureState;
  if (plan.resource === HEROIC_INSPIRATION) return { ...state, heroicInspiration: false };
  return { ...state, spent: { ...state.spent, [plan.resource]: (state.spent[plan.resource] ?? 0) + plan.amount } };
}

/** Pemulihan per fitur menurut sumbernya; dipakai alur rest (Task 9). */
export function recoverFeatures(character: Character, catalog: ContentCatalog, rest: 'short' | 'long'): FeatureState {
  const spent = { ...character.featureState.spent };
  for (const use of availableFeatures(character, catalog)) {
    if (!use.resource || use.key === HEROIC_INSPIRATION || !(use.key in spent)) continue;
    const recovery = use.resource.recovery[rest];
    const remaining = recovery === 'all' ? 0 : recovery === 'one' ? use.resource.spent - 1 : use.resource.spent;
    if (remaining > 0) spent[use.key] = remaining;
    else delete spent[use.key];
  }
  return { ...character.featureState, spent };
}
