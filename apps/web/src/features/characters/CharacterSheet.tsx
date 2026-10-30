import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { ABILITIES, type CharacterOptions, type DerivedValue, SKILLS } from '#shared/characters';
import type { CharacterView } from './types';
import { useCharacterLabels } from './labels';

type Labels = ReturnType<typeof useCharacterLabels>;

/** Satu angka sheet beserta asal kontribusinya; override DM ditandai terpisah. */
function Stat({ label, stat, labels }: { label: string; stat: DerivedValue; labels: Labels }) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="stat" role="group" aria-labelledby={id}>
      <span id={id} className="stat-label">
        {label}
      </span>
      <span className="stat-value">{stat.value}</span>
      <ul className="stat-breakdown">
        {stat.contributions.map((part, index) => (
          <li key={index}>
            <span>{labels.source(part)}</span> <span className="mono">{labels.signed(part.value)}</span>
          </li>
        ))}
        {stat.override !== null && <li className="stat-override">{t('character.overrideNote', { base: stat.base, value: stat.override })}</li>}
      </ul>
    </div>
  );
}

/** Lembar karakter: semua angka dihitung server dari corpus, tidak diketik ulang di client. */
export function CharacterSheet({ view, options }: { view: CharacterView; options: CharacterOptions }) {
  const { t } = useTranslation();
  const labels = useCharacterLabels(options.names);
  const headingId = useId();
  const { character, derived } = view;
  const draft = character.draft;
  const subtitle = [draft.speciesId, draft.backgroundId, character.classLevels[0]?.classId ?? draft.classId]
    .filter((id): id is string => Boolean(id))
    .map(labels.name)
    .join(' · ');

  return (
    <article className="card character-sheet" aria-labelledby={headingId}>
      <header>
        <h1 id={headingId}>{draft.name || t('character.unnamed')}</h1>
        <p className="muted">
          {subtitle} · {t('character.level', { level: derived.level })}
          {character.status === 'draft' && <span className="badge">{t('character.statusDraft')}</span>}
        </p>
      </header>
      {derived.warnings.length > 0 && (
        <ul className="notice-list" aria-label={t('character.warnings')}>
          {derived.warnings.map((warning, index) => (
            <li key={index}>{labels.warning(warning)}</li>
          ))}
        </ul>
      )}
      <section aria-label={t('character.abilitiesTitle')} className="ability-grid">
        {ABILITIES.map((ability) => (
          <Stat key={ability} label={labels.ability(ability)} stat={derived.abilities[ability].score} labels={labels} />
        ))}
      </section>
      <div className="stat-grid">
        <Stat label={t('character.stat.armorClass')} stat={derived.armorClass} labels={labels} />
        <Stat label={t('character.stat.hitPoints')} stat={derived.hitPoints} labels={labels} />
        <Stat label={t('character.stat.initiative')} stat={derived.initiative} labels={labels} />
        <Stat label={t('character.stat.speed')} stat={derived.speed} labels={labels} />
        <Stat label={t('character.stat.passivePerception')} stat={derived.passivePerception} labels={labels} />
        <div className="stat">
          <span className="stat-label">{t('character.stat.proficiencyBonus')}</span>
          <span className="stat-value">{labels.signed(derived.proficiencyBonus)}</span>
        </div>
      </div>
      <div className="sheet-columns">
        <section>
          <h2>{t('character.savingThrows')}</h2>
          <ul className="check-list">
            {ABILITIES.map((ability) => (
              <li key={ability}>
                <span aria-hidden="true">{derived.savingThrows[ability].proficient ? '●' : '○'}</span> {labels.ability(ability)}{' '}
                <span className="mono">{labels.signed(derived.savingThrows[ability].bonus.value)}</span>
                {derived.savingThrows[ability].proficient && <span className="sr-only"> ({t('character.proficient')})</span>}
              </li>
            ))}
          </ul>
        </section>
        {Object.keys(derived.skills).length > 0 && (
          <section>
            <h2>{t('character.skills')}</h2>
            <ul className="check-list">
              {SKILLS.map((skill) => {
                const entry = derived.skills[skill];
                if (!entry) return null;
                return (
                  <li key={skill}>
                    <span aria-hidden="true">{entry.proficient ? '●' : '○'}</span> {labels.skill(skill)}{' '}
                    <span className="muted small">({labels.ability(entry.ability)})</span>{' '}
                    <span className="mono">{labels.signed(entry.bonus.value)}</span>
                    {entry.proficient && <span className="muted small"> · {entry.sources.map(labels.name).join(', ')}</span>}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        <section>
          <h2>{t('character.proficiencies')}</h2>
          <dl className="facts">
            <dt>{t('character.armorTraining')}</dt>
            <dd>{derived.armorTraining.length ? derived.armorTraining.map((kind) => t(`character.armor.${kind}`)).join(', ') : t('character.none')}</dd>
            <dt>{t('character.weapons')}</dt>
            <dd>{derived.weaponProficiencies.categories.map((kind) => t(`character.weapon.${kind}`)).join(', ') || t('character.none')}</dd>
            <dt>{t('character.languages')}</dt>
            <dd>
              <ul className="inline-list">
                {derived.languages.map((language) => (
                  <li key={language}>{language}</li>
                ))}
              </ul>
            </dd>
            <dt>{t('character.feats')}</dt>
            <dd>{derived.feats.map(labels.name).join(', ') || t('character.none')}</dd>
            {derived.darkvision && (
              <>
                <dt>{t('character.darkvision')}</dt>
                <dd>{t('character.feet', { distance: derived.darkvision })}</dd>
              </>
            )}
          </dl>
        </section>
        <section>
          <h2>{t('character.inventory')}</h2>
          <ul>
            {derived.inventory.map((item, index) => (
              <li key={index}>
                {item.quantity > 1 && `${item.quantity}× `}
                {item.id ? labels.name(item.id) : t(`character.customItem.${item.custom}`)}
                {item.note && <span className="muted"> ({item.note})</span>}
              </li>
            ))}
            <li>{t('character.gp', { amount: derived.gp })}</li>
          </ul>
        </section>
      </div>
      {(draft.concept || draft.motivation || draft.partyBond) && (
        <section>
          <h2>{t('character.story')}</h2>
          <dl className="facts">
            {draft.concept && (
              <>
                <dt>{t('character.field.concept')}</dt>
                <dd>{draft.concept}</dd>
              </>
            )}
            {draft.motivation && (
              <>
                <dt>{t('character.field.motivation')}</dt>
                <dd>{draft.motivation}</dd>
              </>
            )}
            {draft.partyBond && (
              <>
                <dt>{t('character.field.partyBond')}</dt>
                <dd>{draft.partyBond}</dd>
              </>
            )}
          </dl>
        </section>
      )}
    </article>
  );
}
