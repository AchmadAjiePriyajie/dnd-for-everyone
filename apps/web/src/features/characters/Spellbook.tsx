import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CharacterOption, CharacterOptions, ClassSpells } from '#shared/characters';
import type { Id } from '#shared/contracts';
import { Icon } from '../../app/icons';
import { ErrorMessage } from '../../app/ui';
import type { CharacterView } from './types';
import { useCharacterLabels } from './labels';
import { useCharacterCommand } from './useCharacterCommand';

const WIZARD = 'class.wizard';

interface Props {
  view: CharacterView;
  options: CharacterOptions;
  campaignId: Id;
  reload(): Promise<void>;
  canEdit: boolean;
}

interface SpellMeta {
  level: number;
  classes: Id[];
  concentration: boolean;
}
const meta = (spell: CharacterOption) => spell.mechanics as unknown as SpellMeta;

/**
 * Spellcasting per class: DC/attack, slot (termasuk Pact Magic), Concentration, serta pilihan cantrip,
 * spell yang disiapkan dan spellbook Wizard yang dipisah. Batas jumlah/level divalidasi server.
 */
export function Spellbook({ view, options, campaignId, reload, canEdit }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const labels = useCharacterLabels(options.names);
  const { send, error, disabled } = useCharacterCommand(campaignId, view.character.id, reload);
  const casting = view.spellcasting;
  const [pendingSlot, setPendingSlot] = useState<string | null>(null);
  const spellName = (spellId: Id) => options.spells.find((spell) => spell.id === spellId)?.name ?? spellId;
  if (!casting.classes.length) return null;

  const prepared = casting.classes.flatMap((entry) => [...entry.cantrips, ...entry.prepared]);
  const concentrationSpells = [...new Set(prepared)].filter((spellId) => {
    const spell = options.spells.find((candidate) => candidate.id === spellId);
    return spell ? meta(spell).concentration : false;
  });
  const slotButton = (key: string, level: number, remaining: number, pact: boolean) =>
    canEdit &&
    (pendingSlot === key ? (
      <span className="confirm-row">
        <button type="button" className="primary" disabled={disabled} onClick={() => void send('character.spend-slot', { level, ...(pact ? { pact: true } : {}) }).then(() => setPendingSlot(null))}>
          {t('character.features.confirmUse')}
        </button>
        <button type="button" disabled={disabled} onClick={() => setPendingSlot(null)}>
          {t('character.features.cancel')}
        </button>
      </span>
    ) : (
      <button type="button" disabled={disabled || remaining < 1} onClick={() => setPendingSlot(key)}>
        {t('character.spells.useSlot')}
      </button>
    ));

  return (
    <section className="card" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>
        <Icon name="scroll" />
        {t('character.spells.title')}
      </h2>
      <ErrorMessage error={error} />
      {casting.issues.length > 0 && (
        <div className="callout" role="note">
          <ul>
            {casting.issues.map((issue) => {
              const [code, subject] = issue.split(':');
              return <li key={issue}>{t(`character.spells.issue.${code}`, { subject: subject?.startsWith('spell.') ? spellName(subject) : labels.name(subject ?? '') })}</li>;
            })}
          </ul>
        </div>
      )}
      <dl className="facts">
        {casting.classes.map((entry) => (
          <div key={entry.classId}>
            <dt>{labels.name(entry.classId)}</dt>
            <dd>
              {t('character.spells.stats', { ability: labels.ability(entry.ability), dc: entry.saveDc, attack: labels.signed(entry.attackBonus) })}
            </dd>
          </div>
        ))}
      </dl>

      <ul className="row-list">
        {casting.slots.map((slot) => (
          <li key={slot.level}>
            <span className="row-main">{t('character.spells.slot', { level: slot.level })}</span>
            <span className="row-value">{t('character.spells.remaining', { remaining: slot.remaining, max: slot.max })}</span>
            {slotButton(`slot-${slot.level}`, slot.level, slot.remaining, false)}
          </li>
        ))}
        {casting.pact && (
          <li>
            <span className="row-main">{t('character.spells.pact', { level: casting.pact.level })}</span>
            <span className="row-value">{t('character.spells.remaining', { remaining: casting.pact.remaining, max: casting.pact.max })}</span>
            {slotButton('pact', casting.pact.level, casting.pact.remaining, true)}
          </li>
        )}
      </ul>

      <div className="field">
        <span className="stat-label">{t('character.spells.concentration')}</span>
        <p>
          {casting.concentration ? spellName(casting.concentration) : t('character.none')}{' '}
          {canEdit && casting.concentration && (
            <button type="button" disabled={disabled} onClick={() => void send('character.set-concentration', { spellId: null })}>
              {t('character.spells.endConcentration')}
            </button>
          )}
        </p>
        {canEdit && concentrationSpells.length > 0 && (
          <p className="row-actions">
            {concentrationSpells
              .filter((spellId) => spellId !== casting.concentration)
              .map((spellId) => (
                <button key={spellId} type="button" disabled={disabled} onClick={() => void send('character.set-concentration', { spellId })}>
                  {t('character.spells.concentrateOn', { name: spellName(spellId) })}
                </button>
              ))}
          </p>
        )}
      </div>

      {canEdit && <Preparation key={JSON.stringify([view.character.resources.spells, view.character.resources.spellbook])} view={view} options={options} disabled={disabled} send={send} />}
    </section>
  );
}

function Preparation({ view, options, disabled, send }: { view: CharacterView; options: CharacterOptions; disabled: boolean; send: ReturnType<typeof useCharacterCommand>['send'] }) {
  const { t } = useTranslation();
  const labels = useCharacterLabels(options.names);
  const casting = view.spellcasting;
  const [choices, setChoices] = useState<ClassSpells[]>(() =>
    casting.classes.map((entry) => ({ classId: entry.classId, cantrips: entry.cantrips, prepared: entry.prepared })),
  );
  const [spellbook, setSpellbook] = useState<Id[]>(casting.spellbook ?? []);
  const toggle = (list: Id[], spellId: Id) => (list.includes(spellId) ? list.filter((other) => other !== spellId) : [...list, spellId]);
  const update = (classId: Id, field: 'cantrips' | 'prepared', spellId: Id) =>
    setChoices((current) => current.map((entry) => (entry.classId === classId ? { ...entry, [field]: toggle(entry[field], spellId) } : entry)));

  return (
    <>
      {casting.classes.map((entry) => {
        const choice = choices.find((candidate) => candidate.classId === entry.classId)!;
        const onList = options.spells.filter((spell) => meta(spell).classes.includes(entry.classId));
        const cantrips = onList.filter((spell) => meta(spell).level === 0);
        // Wizard menyiapkan dari spellbook; class lain dari daftar class sampai level slot tertinggi.
        const leveled = onList.filter(
          (spell) => meta(spell).level >= 1 && meta(spell).level <= entry.maxSpellLevel && (entry.classId !== WIZARD || spellbook.includes(spell.id)),
        );
        return (
          <details key={entry.classId} className="spell-prep">
            <summary>{t('character.spells.prepareFor', { name: labels.name(entry.classId) })}</summary>
            {entry.cantripsMax > 0 && (
              <SpellChecklist
                legend={t('character.spells.cantrips', { count: choice.cantrips.length, max: entry.cantripsMax })}
                spells={cantrips}
                chosen={choice.cantrips}
                max={entry.cantripsMax}
                disabled={disabled}
                onToggle={(spellId) => update(entry.classId, 'cantrips', spellId)}
              />
            )}
            <SpellChecklist
              legend={t('character.spells.prepared', { count: choice.prepared.length, max: entry.preparedMax })}
              spells={leveled}
              chosen={choice.prepared}
              max={entry.preparedMax}
              disabled={disabled}
              onToggle={(spellId) => update(entry.classId, 'prepared', spellId)}
            />
            {entry.classId === WIZARD && (
              <SpellChecklist
                legend={t('character.spells.spellbook', { count: spellbook.length })}
                spells={onList.filter((spell) => meta(spell).level >= 1 && meta(spell).level <= entry.maxSpellLevel)}
                chosen={spellbook}
                disabled={disabled}
                onToggle={(spellId) => setSpellbook((current) => toggle(current, spellId))}
              />
            )}
          </details>
        );
      })}
      <p>
        <button
          type="button"
          className="primary"
          disabled={disabled}
          onClick={() => void send('character.set-spells', { spells: choices, ...(casting.spellbook ? { spellbook } : {}) })}
        >
          {t('character.spells.save')}
        </button>
      </p>
    </>
  );
}

function SpellChecklist({
  legend,
  spells,
  chosen,
  max,
  disabled,
  onToggle,
}: {
  legend: string;
  spells: CharacterOption[];
  chosen: Id[];
  max?: number;
  disabled: boolean;
  onToggle(spellId: Id): void;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="choice-grid">
      <legend>{legend}</legend>
      {spells.map((spell) => {
        const checked = chosen.includes(spell.id);
        return (
          <label key={spell.id} className="choice">
            <input type="checkbox" checked={checked} disabled={disabled || (!checked && max !== undefined && chosen.length >= max)} onChange={() => onToggle(spell.id)} />
            <span className="choice-text">
              <span className="choice-title">{spell.name}</span>
              <span className="muted small">
                {meta(spell).level === 0 ? t('character.spells.cantrip') : t('character.spells.level', { level: meta(spell).level })}
                {meta(spell).concentration && ` · ${t('character.spells.concentrationShort')}`}
              </span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
