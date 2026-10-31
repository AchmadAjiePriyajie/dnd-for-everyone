import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ApiError } from '#shared/access';
import {
  ABILITIES,
  type AbilityKey,
  type CharacterDraft,
  type CharacterOption,
  type CharacterOptions,
  SKILLS,
  type SkillKey,
  type ToolChoice,
} from '#shared/characters';
import type { Id } from '#shared/contracts';
import { pointBuyCost, POINT_BUY_BUDGET, STANDARD_ARRAY } from '#rules/abilities';
import { Icon } from '../../app/icons';
import { sendCommand, useConnectionStatus } from '../../app/room-store';
import { ErrorMessage, toApiError } from '../../app/ui';
import { CharacterBanner, Stat } from './CharacterSheet';
import type { CharacterView } from './types';
import { useCharacterLabels } from './labels';

const STEPS = ['concept', 'species', 'background', 'class', 'abilities', 'equipment', 'review'] as const;
type Step = (typeof STEPS)[number];
const AUTOSAVE_MS = 500;

type ToolGroupKey = 'artisans-tools' | 'musical-instrument' | 'gaming-set';
interface ToolProfs {
  fixed: Id[];
  choices: Array<{ count: number; from: ToolGroupKey[] }>;
}
interface EquipOption {
  option: 'A' | 'B' | 'C';
  items: Array<{ id?: Id; quantity: number; note?: string; choice?: string; custom?: string }>;
  gp: number;
}
interface ClassM {
  hitDie: number;
  skillChoices: { count: number; from?: SkillKey[] };
  toolProficiencies?: ToolProfs;
  startingEquipment: EquipOption[];
}
interface BackgroundM {
  abilityScores: AbilityKey[];
  feat: Id;
  skills: SkillKey[];
  toolProficiencies: ToolProfs;
  startingEquipment: EquipOption[];
}
interface SpeciesM {
  size: string[];
  speed: number;
  skillChoice?: { count: number; from?: SkillKey[] };
  originFeatChoice?: boolean;
}

const find = <T,>(list: CharacterOption[], id: Id | null) => (id ? (list.find((entry) => entry.id === id)?.mechanics as T | undefined) : undefined);
const newRequestId = () => globalThis.crypto.randomUUID();

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

/**
 * Wizard pembuatan karakter. Draft lokal disimpan otomatis lewat command
 * `character.save-draft` (dengan revision agar tab lain tidak tertimpa diam-diam);
 * angka dan masalah pada Tinjau selalu berasal dari server.
 */
export function CharacterWizard({
  view,
  options,
  campaignId,
  reload,
}: {
  view: CharacterView;
  options: CharacterOptions;
  campaignId: Id;
  reload(): Promise<void>;
}) {
  const { t } = useTranslation();
  const labels = useCharacterLabels(options.names);
  const connection = useConnectionStatus();
  const characterId = view.character.id;
  const [draft, setDraft] = useState<CharacterDraft>(view.character.draft);
  const [step, setStep] = useState<Step>('concept');
  const [save, setSave] = useState<SaveState>('idle');
  const [error, setError] = useState<ApiError | null>(null);
  const revision = useRef(view.character.revision);
  const latest = useRef(draft);
  const tabsId = useId();

  const update = (patch: Partial<CharacterDraft>) => {
    setDraft((current) => {
      const next = { ...current, ...patch };
      latest.current = next;
      return next;
    });
    setSave('dirty');
  };

  const run = useCallback(
    async (kind: string, payload: Record<string, unknown> = {}) => {
      const result = await sendCommand({ requestId: newRequestId(), campaignId, targetId: characterId, kind, expectedRevision: revision.current, payload: payload as never });
      revision.current = result.entityRevision;
      return result;
    },
    [campaignId, characterId],
  );

  const flush = useCallback(async () => {
    const snapshot = latest.current;
    setSave('saving');
    setError(null);
    try {
      await run('character.save-draft', { draft: snapshot });
      await reload();
      setSave(latest.current === snapshot ? 'saved' : 'dirty');
      return true;
    } catch (cause) {
      setError(toApiError(cause));
      setSave('error');
      return false;
    }
  }, [run, reload]);

  // Autosave setelah jeda mengetik; saat offline draft tetap lokal dan disimpan setelah tersambung.
  useEffect(() => {
    if (save !== 'dirty' || connection !== 'connected') return;
    const timer = setTimeout(() => void flush(), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [save, draft, connection, flush]);

  const cls = find<ClassM>(options.classes, draft.classId);
  const background = find<BackgroundM>(options.backgrounds, draft.backgroundId);
  const species = find<SpeciesM>(options.species, draft.speciesId);
  const derived = view.derived;
  const index = STEPS.indexOf(step);

  const finalize = async () => {
    if (save === 'dirty' && !(await flush())) return;
    try {
      await run('character.finalize');
      await reload();
    } catch (cause) {
      setError(toApiError(cause));
    }
  };

  const saveBadge = save === 'error' ? 'badge badge-error' : save === 'saved' ? 'badge badge-ok' : save === 'saving' || save === 'dirty' ? 'badge badge-saving' : 'badge';
  const headingId = `${tabsId}-title`;
  const subtitle = [draft.speciesId, draft.backgroundId, draft.classId]
    .filter((id): id is string => Boolean(id))
    .map(labels.name)
    .join(' · ');

  return (
    <div className="wizard">
      <CharacterBanner headingId={headingId} name={draft.name || t('character.newCharacter')} subtitle={subtitle}>
        <span className="badge">{t('character.statusDraft')}</span>
        <span className={saveBadge} role="status">
          {t(`character.save.${save}`)}
        </span>
      </CharacterBanner>
      <ErrorMessage error={error} />
      {error?.code === 'STALE_REVISION' && (
        <button type="button" onClick={() => window.location.reload()}>
          {t('character.reloadLatest')}
        </button>
      )}
      <div role="tablist" aria-label={t('character.steps')} className="wizard-steps">
        {STEPS.map((name, position) => (
          <button
            key={name}
            type="button"
            role="tab"
            id={`${tabsId}-${name}`}
            aria-selected={step === name}
            aria-controls={`${tabsId}-panel`}
            onClick={() => setStep(name)}
          >
            <span className="step-number" aria-hidden="true">
              {position + 1}
            </span>
            {t(`character.step.${name}`)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${step}`} className="card wizard-panel">
        {step === 'concept' && <ConceptStep draft={draft} update={update} />}
        {step === 'species' && <SpeciesStep draft={draft} update={update} options={options} species={species} labels={labels} />}
        {step === 'background' && <BackgroundStep draft={draft} update={update} options={options} background={background} labels={labels} />}
        {step === 'class' && <ClassStep draft={draft} update={update} options={options} cls={cls} background={background} labels={labels} />}
        {step === 'abilities' && (
          <AbilitiesStep
            draft={draft}
            update={update}
            view={view}
            labels={labels}
            onRoll={async () => {
              try {
                if (save === 'dirty') await flush();
                await run('character.roll-abilities');
                await reload();
              } catch (cause) {
                setError(toApiError(cause));
              }
            }}
          />
        )}
        {step === 'equipment' && (
          <EquipmentStep draft={draft} update={update} options={options} cls={cls} background={background} view={view} labels={labels} />
        )}
        {step === 'review' && (
          <section aria-labelledby={`${tabsId}-review`}>
            <h2 id={`${tabsId}-review`}>
              <Icon name="check" />
              {t('character.step.review')}
            </h2>
            {derived.issues.length === 0 ? (
              <p className="callout callout-ok">{t('character.readyToFinalize')}</p>
            ) : (
              <div className="callout">
                <h3>{t('character.issuesTitle')}</h3>
                <ul aria-label={t('character.issuesTitle')}>
                  {derived.issues.map((issue, i) => (
                    <li key={i}>{labels.issue(issue)}</li>
                  ))}
                </ul>
              </div>
            )}
            {derived.warnings.length > 0 && (
              <div className="callout" role="note">
                <h3>{t('character.warnings')}</h3>
                <ul>
                  {derived.warnings.map((warning, i) => (
                    <li key={i}>{labels.warning(warning)}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="stat-grid">
              <Stat label={t('character.stat.armorClass')} stat={derived.armorClass} labels={labels} breakdown={false} />
              <Stat label={t('character.stat.hitPoints')} stat={derived.hitPoints} labels={labels} breakdown={false} />
              <Stat label={t('character.stat.initiative')} stat={derived.initiative} labels={labels} signed breakdown={false} />
              <Stat label={t('character.stat.speed')} stat={derived.speed} labels={labels} sub={t('character.feetUnit')} breakdown={false} />
            </div>
            <button
              type="button"
              className="primary"
              disabled={derived.issues.length > 0 || save === 'saving' || save === 'dirty'}
              onClick={() => void finalize()}
            >
              <Icon name="check" />
              {t('character.finalize')}
            </button>
          </section>
        )}
      </div>
      <nav className="wizard-nav" aria-label={t('character.steps')}>
        <button type="button" disabled={index === 0} onClick={() => setStep(STEPS[index - 1]!)}>
          <Icon name="arrowLeft" />
          {t('character.back')}
        </button>
        <button type="button" className={index < STEPS.length - 1 ? 'primary' : undefined} disabled={index === STEPS.length - 1} onClick={() => setStep(STEPS[index + 1]!)}>
          {t('character.next')}
        </button>
      </nav>
    </div>
  );
}

type Labels = ReturnType<typeof useCharacterLabels>;
type Update = (patch: Partial<CharacterDraft>) => void;

function ConceptStep({ draft, update }: { draft: CharacterDraft; update: Update }) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <>
      <p className="step-intro">{t('character.help.concept')}</p>
      <div className="field">
        <label htmlFor={`${id}-name`}>{t('character.field.name')}</label>
        <input id={`${id}-name`} value={draft.name} maxLength={80} autoComplete="off" onChange={(e) => update({ name: e.target.value })} />
      </div>
      {(['concept', 'motivation', 'partyBond'] as const).map((field) => (
        <div key={field} className="field">
          <label htmlFor={`${id}-${field}`}>{t(`character.field.${field}`)}</label>
          <textarea id={`${id}-${field}`} value={draft[field]} maxLength={2000} rows={3} onChange={(e) => update({ [field]: e.target.value })} />
        </div>
      ))}
    </>
  );
}

function Choice({ type, name, checked, disabled, onChange, title, detail, original }: { type: 'radio' | 'checkbox'; name?: string; checked: boolean; disabled?: boolean; onChange(): void; title: string; detail?: string; original?: string }) {
  return (
    <label className="choice">
      <input type={type} name={name} checked={checked} disabled={disabled} onChange={onChange} />
      <span className="choice-text">
        <span className="choice-title">
          {title}
          {original && original !== title && (
            <span className="muted small" lang="en">
              {' '}
              ({original})
            </span>
          )}
        </span>
        {detail && <span className="muted small">{detail}</span>}
      </span>
    </label>
  );
}

function OptionRadios({ legend, list, value, onChange, describe }: { legend: string; list: CharacterOption[]; value: Id | null; onChange(id: Id): void; describe?(entry: CharacterOption): string }) {
  const name = useId();
  return (
    <fieldset>
      <legend>{legend}</legend>
      <div className="choice-grid">
        {list.map((entry) => (
          <Choice
            key={entry.id}
            type="radio"
            name={name}
            checked={value === entry.id}
            onChange={() => onChange(entry.id)}
            title={entry.name}
            original={entry.originalName}
            detail={describe?.(entry)}
          />
        ))}
      </div>
    </fieldset>
  );
}

function SkillPicker({ legend, count, from, value, taken, onChange, labels }: { legend: string; count: number; from?: SkillKey[]; value: SkillKey[]; taken: SkillKey[]; onChange(next: SkillKey[]): void; labels: Labels }) {
  return (
    <fieldset>
      <legend>{legend}</legend>
      <div className="choice-grid">
        {(from ?? [...SKILLS]).map((skill) => {
          const checked = value.includes(skill);
          return (
            <Choice
              key={skill}
              type="checkbox"
              checked={checked}
              disabled={!checked && (taken.includes(skill) || value.length >= count)}
              onChange={() => onChange(checked ? value.filter((other) => other !== skill) : [...value, skill])}
              title={labels.skill(skill)}
            />
          );
        })}
      </div>
    </fieldset>
  );
}

function SpeciesStep({ draft, update, options, species, labels }: { draft: CharacterDraft; update: Update; options: CharacterOptions; species?: SpeciesM; labels: Labels }) {
  const { t } = useTranslation();
  const sizeId = useId();
  const featId = useId();
  return (
    <>
      <p className="step-intro">{t('character.help.species')}</p>
      <OptionRadios
        legend={t('character.field.speciesId')}
        list={options.species}
        value={draft.speciesId}
        onChange={(id) => update({ speciesId: id, size: null, speciesSkills: [], extraOriginFeatId: null })}
        describe={(entry) => `${t('character.stat.speed')} ${t('character.feet', { distance: (entry.mechanics as unknown as SpeciesM).speed })}`}
      />
      <div className="field-row">
        {species && species.size.length > 1 && (
          <div className="field">
            <label htmlFor={sizeId}>{t('character.field.size')}</label>
            <select id={sizeId} value={draft.size ?? ''} onChange={(e) => update({ size: (e.target.value || null) as CharacterDraft['size'] })}>
              <option value="">—</option>
              {species.size.map((size) => (
                <option key={size} value={size}>
                  {t(`character.size.${size}`)}
                </option>
              ))}
            </select>
          </div>
        )}
        {species?.originFeatChoice && (
          <div className="field">
            <label htmlFor={featId}>{t('character.field.extraOriginFeatId')}</label>
            <select id={featId} value={draft.extraOriginFeatId ?? ''} onChange={(e) => update({ extraOriginFeatId: e.target.value || null })}>
              <option value="">—</option>
              {options.originFeats.map((feat) => (
                <option key={feat.id} value={feat.id}>
                  {feat.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      {species?.skillChoice && (
        <SkillPicker
          legend={t('character.chooseSkills', { count: species.skillChoice.count })}
          count={species.skillChoice.count}
          from={species.skillChoice.from}
          value={draft.speciesSkills}
          taken={[...draft.classSkills, ...draft.featSkills]}
          onChange={(speciesSkills) => update({ speciesSkills })}
          labels={labels}
        />
      )}
    </>
  );
}

function BackgroundStep({ draft, update, options, background, labels }: { draft: CharacterDraft; update: Update; options: CharacterOptions; background?: BackgroundM; labels: Labels }) {
  const { t } = useTranslation();
  const id = useId();
  const increase = draft.backgroundIncrease;
  return (
    <>
      <p className="step-intro">{t('character.help.background')}</p>
      <OptionRadios
        legend={t('character.field.backgroundId')}
        list={options.backgrounds}
        value={draft.backgroundId}
        onChange={(backgroundId) => update({ backgroundId, backgroundIncrease: null, backgroundEquipment: null })}
        describe={(entry) => {
          const mechanics = entry.mechanics as unknown as BackgroundM;
          return `${mechanics.abilityScores.map(labels.ability).join(', ')} · ${labels.name(mechanics.feat)}`;
        }}
      />
      {background && (
        <fieldset>
          <legend>{t('character.field.backgroundIncrease')}</legend>
          <div className="choice-grid">
            <Choice
              type="radio"
              name={`${id}-mode`}
              checked={increase?.mode === '2-1'}
              onChange={() => update({ backgroundIncrease: { mode: '2-1', plus2: background.abilityScores[0]!, plus1: background.abilityScores[1]! } })}
              title={t('character.increase21')}
            />
            <Choice
              type="radio"
              name={`${id}-mode`}
              checked={increase?.mode === '1-1-1'}
              onChange={() => update({ backgroundIncrease: { mode: '1-1-1' } })}
              title={t('character.increase111', { abilities: background.abilityScores.map(labels.ability).join(', ') })}
            />
          </div>
        </fieldset>
      )}
      {background && increase?.mode === '2-1' && (
        <div className="field-row">
          {(['plus2', 'plus1'] as const).map((slot) => (
            <div key={slot} className="field">
              <label htmlFor={`${id}-${slot}`}>{t(`character.${slot}`)}</label>
              <select id={`${id}-${slot}`} value={increase[slot]} onChange={(e) => update({ backgroundIncrease: { ...increase, [slot]: e.target.value as AbilityKey } })}>
                {background.abilityScores.map((ability) => (
                  <option key={ability} value={ability}>
                    {labels.ability(ability)}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
      {background && (
        <p className="hint">{t('character.backgroundGrants', { skills: background.skills.map(labels.skill).join(', '), feat: labels.name(background.feat) })}</p>
      )}
    </>
  );
}

function ClassStep({ draft, update, options, cls, background, labels }: { draft: CharacterDraft; update: Update; options: CharacterOptions; cls?: ClassM; background?: BackgroundM; labels: Labels }) {
  const { t } = useTranslation();
  return (
    <>
      <p className="step-intro">{t('character.help.class')}</p>
      <OptionRadios
        legend={t('character.field.classId')}
        list={options.classes}
        value={draft.classId}
        onChange={(classId) => update({ classId, classSkills: [], classEquipment: null, equippedArmorId: null, shieldEquipped: false, toolChoices: [] })}
        describe={(entry) => t('character.hitDie', { die: (entry.mechanics as unknown as ClassM).hitDie })}
      />
      {cls && (
        <SkillPicker
          legend={t('character.chooseSkills', { count: cls.skillChoices.count })}
          count={cls.skillChoices.count}
          from={cls.skillChoices.from}
          value={draft.classSkills}
          taken={[...(background?.skills ?? []), ...draft.speciesSkills, ...draft.featSkills]}
          onChange={(classSkills) => update({ classSkills })}
          labels={labels}
        />
      )}
    </>
  );
}

function AbilitiesStep({ draft, update, view, labels, onRoll }: { draft: CharacterDraft; update: Update; view: CharacterView; labels: Labels; onRoll(): void }) {
  const { t } = useTranslation();
  const id = useId();
  const method = draft.abilityMethod;
  const rolls = view.character.rolls;
  const values = method === 'standard-array' ? STANDARD_ARRAY : method === 'roll' ? rolls.map((roll) => roll.total) : [];
  const complete = ABILITIES.every((ability) => draft.baseScores[ability] !== undefined);
  const setScore = (ability: AbilityKey, raw: string) => {
    const next = { ...draft.baseScores };
    if (raw === '') delete next[ability];
    else next[ability] = Number(raw);
    update({ baseScores: next });
  };
  return (
    <>
      <p className="step-intro">{t('character.help.abilities')}</p>
      <fieldset>
        <legend>{t('character.field.abilityMethod')}</legend>
        <div className="choice-grid">
          {view.allowedMethods.map((option) => (
            <Choice
              key={option}
              type="radio"
              name={`${id}-method`}
              checked={method === option}
              onChange={() => update({ abilityMethod: option, baseScores: {} })}
              title={t(`character.method.${option}`)}
            />
          ))}
        </div>
      </fieldset>
      {method === 'roll' && rolls.length === 0 && (
        <p>
          <button type="button" className="primary" onClick={onRoll}>
            <Icon name="d20" />
            {t('character.rollScores')}
          </button>
        </p>
      )}
      {method === 'roll' && rolls.length > 0 && (
        <p className="hint">{t('character.rolled', { totals: rolls.map((roll) => `${roll.total} (${roll.dice.join(', ')})`).join(' · ') })}</p>
      )}
      {method && (method !== 'roll' || rolls.length > 0) && (
        <div className="field-row">
          {ABILITIES.map((ability) => (
            <div key={ability} className="field">
              <label htmlFor={`${id}-${ability}`}>{labels.ability(ability)}</label>
              {method === 'point-buy' ? (
                <input
                  id={`${id}-${ability}`}
                  type="number"
                  inputMode="numeric"
                  min={8}
                  max={15}
                  value={draft.baseScores[ability] ?? ''}
                  onChange={(e) => setScore(ability, e.target.value)}
                />
              ) : (
                <select id={`${id}-${ability}`} value={draft.baseScores[ability] ?? ''} onChange={(e) => setScore(ability, e.target.value)}>
                  <option value="">—</option>
                  {[...new Set(values)].map((score) => (
                    <option key={score} value={score}>
                      {score}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ))}
        </div>
      )}
      {method === 'point-buy' && complete && (
        <p className="hint">{t('character.pointBuyUsed', { cost: pointBuyCost(draft.baseScores as Record<AbilityKey, number>), budget: POINT_BUY_BUDGET })}</p>
      )}
    </>
  );
}

function EquipmentStep({ draft, update, options, cls, background, view, labels }: { draft: CharacterDraft; update: Update; options: CharacterOptions; cls?: ClassM; background?: BackgroundM; view: CharacterView; labels: Labels }) {
  const { t } = useTranslation();
  const id = useId();
  // Nama item bisa memuat koma (mis. "Clothes, Traveler’s"), jadi pemisahnya " · ".
  const describe = (option: EquipOption) =>
    [
      ...option.items.map((item) => {
        const label = item.id ? labels.name(item.id) : item.custom ? t(`character.customItem.${item.custom}`) : t(`character.toolGroup.${item.choice}`);
        return `${item.quantity > 1 ? `${item.quantity}× ` : ''}${label}${item.note ? ` (${item.note})` : ''}`;
      }),
      t('character.gp', { amount: option.gp }),
    ].join(' · ');
  const toolSlots = [...(cls?.toolProficiencies?.choices ?? []), ...(background?.toolProficiencies.choices ?? [])].flatMap((choice) =>
    Array.from({ length: choice.count }, () => choice.from),
  );
  const setTool = (index: number, tool: ToolChoice | null) => {
    const next = [...draft.toolChoices];
    if (tool) next[index] = tool;
    else next.splice(index, 1);
    update({ toolChoices: next.filter(Boolean) });
  };
  const armorItems = view.derived.inventory.filter((item) => item.id && item.id in options.armor);
  const hasShield = view.derived.inventory.some((item) => item.id === 'equipment.shield');
  const featSkills = options.originFeats.find(
    (feat) => view.derived.feats.includes(feat.id) && (feat.mechanics as { proficiencyChoice?: number }).proficiencyChoice,
  );

  return (
    <>
      <p className="step-intro">{t('character.help.equipment')}</p>
      {(
        [
          ['classEquipment', cls?.startingEquipment],
          ['backgroundEquipment', background?.startingEquipment],
        ] as const
      ).map(([field, choices]) =>
        choices ? (
          <fieldset key={field}>
            <legend>{t(`character.field.${field}`)}</legend>
            <div className="choice-grid">
              {choices.map((option) => (
                <Choice
                  key={option.option}
                  type="radio"
                  name={`${id}-${field}`}
                  checked={draft[field] === option.option}
                  onChange={() => update({ [field]: option.option })}
                  title={t('character.equipmentOption', { option: option.option })}
                  detail={describe(option)}
                />
              ))}
            </div>
          </fieldset>
        ) : null,
      )}
      {toolSlots.length > 0 && (
        <div className="field-row">
          {toolSlots.map((groups, index) => {
            const current = draft.toolChoices[index];
            const groupChoice = current && 'group' in current ? current.group : null;
            const singleGroup = groups.length === 1 && groups[0] !== 'artisans-tools' ? (groups[0] as 'musical-instrument' | 'gaming-set') : null;
            const group = singleGroup ?? groupChoice;
            return (
              <div key={index} className="field">
                <label htmlFor={`${id}-tool-${index}`}>
                  {singleGroup ? t('character.toolVariant', { group: t(`character.toolGroup.${singleGroup}`) }) : t('character.toolChoice', { number: index + 1 })}
                </label>
                {!singleGroup && (
                  <select
                    id={`${id}-tool-${index}`}
                    value={current ? ('id' in current ? current.id : `group:${current.group}`) : ''}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (!value) return setTool(index, null);
                      if (value.startsWith('group:')) return setTool(index, { group: value.slice(6) as 'musical-instrument' | 'gaming-set', variant: '' });
                      setTool(index, { id: value });
                    }}
                  >
                    <option value="">—</option>
                    {groups.includes('artisans-tools') &&
                      options.artisanTools.map((tool) => (
                        <option key={tool.id} value={tool.id}>
                          {tool.name}
                        </option>
                      ))}
                    {groups
                      .filter((g): g is 'musical-instrument' | 'gaming-set' => g !== 'artisans-tools')
                      .map((g) => (
                        <option key={g} value={`group:${g}`}>
                          {t(`character.toolGroup.${g}`)}
                        </option>
                      ))}
                  </select>
                )}
                {group && (
                  <input
                    id={singleGroup ? `${id}-tool-${index}` : undefined}
                    aria-label={singleGroup ? undefined : t('character.toolVariant', { group: t(`character.toolGroup.${group}`) })}
                    value={current && 'group' in current ? current.variant : ''}
                    maxLength={40}
                    placeholder={t('character.toolVariantHint')}
                    onChange={(e) => setTool(index, { group, variant: e.target.value })}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="field-row">
        <div className="field">
          <label htmlFor={`${id}-armor`}>{t('character.field.equippedArmorId')}</label>
          <select id={`${id}-armor`} value={draft.equippedArmorId ?? ''} onChange={(e) => update({ equippedArmorId: e.target.value || null })}>
            <option value="">{t('character.noArmor')}</option>
            {armorItems.map((item) => (
              <option key={item.id} value={item.id!}>
                {labels.name(item.id!)}
              </option>
            ))}
          </select>
        </div>
        {[0, 1].map((slot) => (
          <div key={slot} className="field">
            <label htmlFor={`${id}-lang-${slot}`}>{t('character.languageSlot', { number: slot + 1 })}</label>
            <select
              id={`${id}-lang-${slot}`}
              value={draft.languages[slot] ?? ''}
              onChange={(e) => {
                const next = [...draft.languages];
                next[slot] = e.target.value;
                update({ languages: next.filter(Boolean) });
              }}
            >
              <option value="">—</option>
              {options.languages.map((language) => (
                <option key={language} value={language}>
                  {language}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <p className="hint">{t('character.chooseLanguages')}</p>
      {hasShield && (
        <div className="choice-grid">
          <Choice type="checkbox" checked={draft.shieldEquipped} onChange={() => update({ shieldEquipped: !draft.shieldEquipped })} title={t('character.field.shieldEquipped')} />
        </div>
      )}
      {featSkills && (
        <SkillPicker
          legend={t('character.featSkills', { feat: featSkills.name, count: (featSkills.mechanics as { proficiencyChoice: number }).proficiencyChoice })}
          count={(featSkills.mechanics as { proficiencyChoice: number }).proficiencyChoice}
          value={draft.featSkills}
          taken={[...draft.classSkills, ...draft.speciesSkills, ...(background?.skills ?? [])]}
          onChange={(next) => update({ featSkills: next })}
          labels={labels}
        />
      )}
    </>
  );
}
