import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ApiError } from '#shared/access';
import { ABILITIES, type AbilityKey, type AdvancementChoice, type AdvancementPreview, type CharacterOptions, SKILLS } from '#shared/characters';
import type { Id } from '#shared/contracts';
import { api } from '../../app/api';
import { Icon } from '../../app/icons';
import { ErrorMessage, toApiError } from '../../app/ui';
import type { CharacterView } from './types';
import { useCharacterLabels } from './labels';
import { useCharacterCommand } from './useCharacterCommand';

interface Props {
  view: CharacterView;
  options: CharacterOptions;
  campaignId: Id;
  reload(): Promise<void>;
  owner: boolean;
  isDm: boolean;
}

const PREVIEW_DELAY_MS = 300;

/**
 * Level up dengan pratinjau sebelum/sesudah. Pilihan yang belum lengkap disimpan sebagai draft
 * (pemilik); server membuat ulang pratinjau dan melempar HP saat dikonfirmasi.
 */
export function LevelUpWizard({ view, options, campaignId, reload, owner, isDm }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const labels = useCharacterLabels(options.names);
  const { send, error, disabled } = useCharacterCommand(campaignId, view.character.id, reload);
  const { character, advancement } = view;
  const currentClass = character.classLevels[0]?.classId ?? '';
  const [open, setOpen] = useState(Boolean(character.pendingAdvancement));
  const [choice, setChoice] = useState<AdvancementChoice>(() => character.pendingAdvancement ?? { classId: currentClass, hp: 'fixed' });
  const [preview, setPreview] = useState<AdvancementPreview | null>(null);
  const [previewError, setPreviewError] = useState<ApiError | null>(null);
  const [xp, setXp] = useState('');
  const level = character.classLevels.reduce((total, entry) => total + entry.level, 0);
  const className = (classId: Id) => options.classes.find((entry) => entry.id === classId)?.name ?? labels.name(classId);
  const subjectLabel = (subject: string) =>
    (ABILITIES as readonly string[]).includes(subject)
      ? labels.ability(subject)
      : (SKILLS as readonly string[]).includes(subject)
        ? labels.skill(subject)
        : subject.startsWith('class.')
          ? className(subject)
          : name(subject);
  const name = (entryId: Id) => [...options.subclasses, ...options.feats].find((entry) => entry.id === entryId)?.name ?? labels.name(entryId);

  // Pratinjau setiap pilihan berubah; draft disimpan untuk pemilik agar pulih setelah reload.
  const firstRun = useRef(true);
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      api.advancementPreview(campaignId, character.id, choice).then(
        (result) => {
          setPreview(result);
          setPreviewError(null);
        },
        (cause) => setPreviewError(toApiError(cause)),
      );
      if (owner && !firstRun.current) void send('character.save-advancement-draft', { choice });
      firstRun.current = false;
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
    // `send` berubah tiap render; pratinjau cukup mengikuti pilihan.
  }, [open, choice, campaignId, character.id, owner]);

  const update = (patch: Partial<AdvancementChoice>) => setChoice((current) => ({ ...current, ...patch }));
  const setIncrease = (ability: AbilityKey, value: number) =>
    setChoice((current) => {
      const increases = { ...(current.feat?.increases ?? {}) };
      if (value) increases[ability] = value;
      else delete increases[ability];
      return { ...current, feat: { featId: current.feat?.featId ?? '', increases } };
    });
  const subclasses = options.subclasses.filter((entry) => entry.mechanics.class === choice.classId);
  const feats = options.feats.filter((entry) => (preview?.featCategory === 'fighting-style' ? entry.mechanics.category === 'fighting-style' : true));
  const ready = preview && !preview.issues.length && !preview.required.length;
  const canLevel = advancement.canAdvance || isDm;

  return (
    <section className="card" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>
        <Icon name="crown" />
        {t('character.levelUp.title')}
      </h2>
      <ErrorMessage error={error} />
      <p>
        {advancement.mode === 'xp'
          ? t('character.levelUp.xpStatus', { xp: advancement.xp, next: advancement.nextLevelXp ?? '—' })
          : t('character.levelUp.milestoneStatus', { count: advancement.levelsGranted })}
        {level < advancement.startingLevel && <> · {t('character.levelUp.startingLevel', { level: advancement.startingLevel })}</>}
      </p>

      {isDm && (
        <div className="dm-inline">
          <p className="row-actions">
            <button type="button" disabled={disabled} onClick={() => void send('character.grant-level', { count: 1 })}>
              <Icon name="plus" />
              {t('character.levelUp.grantLevel')}
            </button>
            <button type="button" disabled={disabled || !character.advancements.length} onClick={() => void send('character.revert-advancement', {})}>
              {t('character.levelUp.revert')}
            </button>
          </p>
          <div className="field-row">
            <div className="field">
              <label htmlFor={`${id}-xp`}>{t('character.levelUp.awardXp')}</label>
              <input id={`${id}-xp`} type="number" value={xp} onChange={(event) => setXp(event.target.value)} />
            </div>
            <button
              type="button"
              disabled={disabled || !Number.isInteger(Number(xp)) || !Number(xp)}
              onClick={() => void send('character.award-xp', { amount: Number(xp) }).then(() => setXp(''))}
            >
              {t('character.levelUp.saveXp')}
            </button>
            <div className="field">
              <label htmlFor={`${id}-mode`}>{t('character.levelUp.mode')}</label>
              <select
                id={`${id}-mode`}
                value={advancement.mode}
                disabled={disabled}
                onChange={(event) => void send('campaign.set-advancement', { mode: event.target.value, startingLevel: advancement.startingLevel }, campaignId)}
              >
                <option value="milestone">{t('character.levelUp.modeMilestone')}</option>
                <option value="xp">{t('character.levelUp.modeXp')}</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor={`${id}-start`}>{t('character.levelUp.startingLevelLabel')}</label>
              <select
                id={`${id}-start`}
                value={advancement.startingLevel}
                disabled={disabled}
                onChange={(event) => void send('campaign.set-advancement', { mode: advancement.mode, startingLevel: Number(event.target.value) }, campaignId)}
              >
                {Array.from({ length: 20 }, (_, index) => index + 1).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {!open ? (
        <p>
          <button type="button" className="primary" disabled={disabled || !canLevel || level >= 20} onClick={() => setOpen(true)}>
            {t('character.levelUp.start', { level: level + 1 })}
          </button>
        </p>
      ) : (
        <div className="level-up">
          <div className="field-row">
            <div className="field">
              <label htmlFor={`${id}-class`}>{t('character.levelUp.class')}</label>
              <select id={`${id}-class`} value={choice.classId} onChange={(event) => setChoice({ classId: event.target.value, hp: choice.hp })}>
                {options.classes.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                    {character.classLevels.some((level) => level.classId === entry.id) ? '' : ` (${t('character.levelUp.multiclass')})`}
                  </option>
                ))}
              </select>
            </div>
            <fieldset className="field">
              <legend>{t('character.levelUp.hp')}</legend>
              {(['fixed', 'roll'] as const).map((method) => (
                <label key={method} className="check">
                  <input type="radio" name={`${id}-hp`} checked={choice.hp === method} onChange={() => update({ hp: method })} />
                  {t(`character.levelUp.hpMethod.${method}`, { value: preview ? preview.hitDie / 2 + 1 : '', die: preview?.hitDie ?? '' })}
                </label>
              ))}
            </fieldset>
          </div>

          {(preview?.required.includes('subclass') || choice.subclassId) && (
            <div className="field">
              <label htmlFor={`${id}-subclass`}>{t('character.levelUp.subclass')}</label>
              <select id={`${id}-subclass`} value={choice.subclassId ?? ''} onChange={(event) => update({ subclassId: event.target.value || undefined })}>
                <option value="">—</option>
                {subclasses.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {preview?.featCategory && (
            <div className="field">
              <label htmlFor={`${id}-feat`}>{t(`character.levelUp.feat.${preview.featCategory}`)}</label>
              <select
                id={`${id}-feat`}
                value={choice.feat?.featId ?? ''}
                onChange={(event) => update({ feat: event.target.value ? { featId: event.target.value, increases: {} } : undefined })}
              >
                <option value="">—</option>
                {feats.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
              {choice.feat?.featId && (
                <div className="field-row">
                  {ABILITIES.map((ability) => (
                    <div key={ability} className="field">
                      <label htmlFor={`${id}-inc-${ability}`}>{labels.ability(ability)}</label>
                      <select id={`${id}-inc-${ability}`} value={choice.feat?.increases[ability] ?? 0} onChange={(event) => setIncrease(ability, Number(event.target.value))}>
                        {[0, 1, 2].map((value) => (
                          <option key={value} value={value}>
                            {value ? `+${value}` : '—'}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {(preview?.required.includes('skill') || choice.skill) && (
            <div className="field">
              <label htmlFor={`${id}-skill`}>{t('character.levelUp.skill')}</label>
              <select id={`${id}-skill`} value={choice.skill ?? ''} onChange={(event) => update({ skill: (event.target.value || undefined) as AdvancementChoice['skill'] })}>
                <option value="">—</option>
                {SKILLS.map((skill) => (
                  <option key={skill} value={skill}>
                    {labels.skill(skill)}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="field">
            <label htmlFor={`${id}-notes`}>{t('character.levelUp.notes')}</label>
            <textarea id={`${id}-notes`} value={choice.notes ?? ''} maxLength={500} onChange={(event) => update({ notes: event.target.value || undefined })} />
            <p className="hint">{t('character.levelUp.notesHint')}</p>
          </div>

          <ErrorMessage error={previewError} />
          {preview && (
            <div className="callout" role="group" aria-label={t('character.levelUp.preview')}>
              <h3>{t('character.levelUp.preview')}</h3>
              {preview.issues.length > 0 && (
                <ul className="issues">
                  {preview.issues.map((issue) => {
                    const [code, subject] = issue.split(':');
                    return <li key={issue}>{t(`character.levelUp.issue.${code}`, { subject: subject ? subjectLabel(subject) : '' })}</li>;
                  })}
                </ul>
              )}
              {preview.required.length > 0 && <p>{t('character.levelUp.required', { list: preview.required.map((slot) => t(`character.levelUp.slot.${slot}`)).join(', ') })}</p>}
              <dl className="facts">
                <dt>{t('character.levelUp.levelRow')}</dt>
                <dd>
                  {preview.before.level} → {preview.after.level} ({className(choice.classId)} {preview.classLevel})
                </dd>
                <dt>{t('character.stat.hitPoints')}</dt>
                <dd>
                  {preview.before.hitPoints} → {preview.hpDie === null ? t('character.levelUp.afterRoll') : preview.after.hitPoints}
                </dd>
                <dt>{t('character.stat.proficiencyBonus')}</dt>
                <dd>
                  {labels.signed(preview.before.proficiencyBonus)} → {labels.signed(preview.after.proficiencyBonus)}
                </dd>
                {(preview.before.slots.length > 0 || preview.after.slots.length > 0) && (
                  <>
                    <dt>{t('character.levelUp.slots')}</dt>
                    <dd>
                      {preview.before.slots.join('/') || '—'} → {preview.after.slots.join('/') || '—'}
                    </dd>
                  </>
                )}
                {preview.after.pact && (
                  <>
                    <dt>{t('character.levelUp.pact')}</dt>
                    <dd>
                      {preview.before.pact ? `${preview.before.pact.max}×${preview.before.pact.level}` : '—'} → {preview.after.pact.max}×{preview.after.pact.level}
                    </dd>
                  </>
                )}
                {preview.newFeatures.length > 0 && (
                  <>
                    <dt>{t('character.levelUp.newFeatures')}</dt>
                    <dd>{preview.newFeatures.map((feature) => feature.name).join(', ')}</dd>
                  </>
                )}
              </dl>
            </div>
          )}
          <p className="row-actions">
            <button
              type="button"
              className="primary"
              disabled={disabled || !ready || !canLevel}
              onClick={() =>
                void send('character.advance', { choice }).then((result) => {
                  if (!result) return;
                  setOpen(false);
                  setPreview(null);
                  setChoice({ classId: choice.classId, hp: choice.hp });
                })
              }
            >
              {t('character.levelUp.confirm')}
            </button>
            <button type="button" disabled={disabled} onClick={() => setOpen(false)}>
              {t('character.features.cancel')}
            </button>
          </p>
        </div>
      )}
    </section>
  );
}
