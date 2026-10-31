import { type ReactNode, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { ABILITIES, type CharacterOptions, type DerivedValue, SKILLS } from '#shared/characters';
import { Icon, initials } from '../../app/icons';
import type { CharacterView } from './types';
import { useCharacterLabels } from './labels';

type Labels = ReturnType<typeof useCharacterLabels>;

/**
 * Satu angka sheet beserta asal kontribusinya. Kontribusi pertama adalah nilai dasar
 * (tanpa tanda), berikutnya tambahan bertanda; override DM ditandai terpisah.
 */
export function Stat({
  label,
  stat,
  labels,
  signed = false,
  sub,
  breakdown = true,
}: {
  label: string;
  stat: DerivedValue;
  labels: Labels;
  signed?: boolean;
  sub?: string;
  breakdown?: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="stat" role="group" aria-labelledby={id}>
      <span id={id} className="stat-label">
        {label}
      </span>
      <span className="stat-value">{signed ? labels.signed(stat.value) : stat.value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
      {breakdown && stat.contributions.length > 0 && (
        <ul className="stat-breakdown">
          {stat.contributions.map((part, index) => (
            <li key={index}>
              <span>{labels.source(part)}</span>
              <span className="mono">{index === 0 ? part.value : labels.signed(part.value)}</span>
            </li>
          ))}
          {stat.override !== null && <li className="stat-override">{t('character.overrideNote', { base: stat.base, value: stat.override })}</li>}
        </ul>
      )}
    </div>
  );
}

/** Banner karakter, dipakai sheet dan wizard agar kepala halaman seragam dengan room. */
export function CharacterBanner({ headingId, name, subtitle, children }: { headingId: string; name: string; subtitle: string; children?: ReactNode }) {
  return (
    <header className="room-banner page-banner">
      <span className="sigil sigil-lg" aria-hidden="true">
        {initials(name)}
      </span>
      <div className="room-heading">
        <h1 id={headingId}>{name}</h1>
        {subtitle && <p className="room-meta muted">{subtitle}</p>}
      </div>
      {children && <div className="banner-actions">{children}</div>}
    </header>
  );
}

/** Lembar karakter: semua angka dihitung server dari corpus, tidak diketik ulang di client. */
export function CharacterSheet({ view, options }: { view: CharacterView; options: CharacterOptions }) {
  const { t } = useTranslation();
  const labels = useCharacterLabels(options.names);
  const headingId = useId();
  const { character, derived } = view;
  const draft = character.draft;
  const name = draft.name || t('character.unnamed');
  const subtitle = [draft.speciesId, draft.backgroundId, character.classLevels[0]?.classId ?? draft.classId]
    .filter((id): id is string => Boolean(id))
    .map(labels.name)
    .concat(t('character.level', { level: derived.level }))
    .join(' · ');

  return (
    <article className="character-sheet" aria-labelledby={headingId}>
      <CharacterBanner headingId={headingId} name={name} subtitle={subtitle}>
        {character.status === 'draft' && <span className="badge">{t('character.statusDraft')}</span>}
      </CharacterBanner>

      {derived.warnings.length > 0 && (
        <div className="callout" role="note">
          <h3>{t('character.warnings')}</h3>
          <ul>
            {derived.warnings.map((warning, index) => (
              <li key={index}>{labels.warning(warning)}</li>
            ))}
          </ul>
        </div>
      )}

      <section aria-label={t('character.abilitiesTitle')} className="stat-grid">
        {ABILITIES.map((ability) => {
          const entry = derived.abilities[ability];
          return (
            <Stat
              key={ability}
              label={labels.ability(ability)}
              stat={{ ...entry.score, value: entry.modifier }}
              signed
              sub={t('character.score', { score: entry.score.value })}
              labels={labels}
            />
          );
        })}
      </section>
      <section aria-label={t('character.combatTitle')} className="stat-grid">
        <Stat label={t('character.stat.armorClass')} stat={derived.armorClass} labels={labels} />
        <Stat label={t('character.stat.hitPoints')} stat={derived.hitPoints} labels={labels} />
        <Stat label={t('character.stat.initiative')} stat={derived.initiative} labels={labels} signed />
        <Stat label={t('character.stat.speed')} stat={derived.speed} labels={labels} sub={t('character.feetUnit')} />
        <Stat label={t('character.stat.passivePerception')} stat={derived.passivePerception} labels={labels} />
        <Stat
          label={t('character.stat.proficiencyBonus')}
          stat={{ base: derived.proficiencyBonus, value: derived.proficiencyBonus, override: null, contributions: [] }}
          labels={labels}
          signed
          breakdown={false}
        />
      </section>

      <div className="sheet-columns">
        <section className="card" aria-labelledby={`${headingId}-saves`}>
          <h2 id={`${headingId}-saves`}>
            <Icon name="shield" />
            {t('character.savingThrows')}
          </h2>
          <ul className="row-list">
            {ABILITIES.map((ability) => {
              const save = derived.savingThrows[ability];
              return (
                <li key={ability}>
                  <span className={`prof-dot${save.proficient ? ' is-on' : ''}`} aria-hidden="true" />
                  <span className="row-main">
                    {labels.ability(ability)}
                    {save.proficient && <span className="sr-only"> ({t('character.proficient')})</span>}
                  </span>
                  <span className="row-value">{labels.signed(save.bonus.value)}</span>
                </li>
              );
            })}
          </ul>
        </section>

        {Object.keys(derived.skills).length > 0 && (
          <section className="card" aria-labelledby={`${headingId}-skills`}>
            <h2 id={`${headingId}-skills`}>
              <Icon name="scroll" />
              {t('character.skills')}
            </h2>
            <ul className="row-list">
              {SKILLS.map((skill) => {
                const entry = derived.skills[skill];
                if (!entry) return null;
                return (
                  <li key={skill}>
                    <span className={`prof-dot${entry.proficient ? ' is-on' : ''}`} aria-hidden="true" />
                    <span className="row-main">
                      {labels.skill(skill)} <span className="muted small">({labels.ability(entry.ability)})</span>
                      {entry.proficient && <span className="muted small"> · {entry.sources.map(labels.name).join(', ')}</span>}
                    </span>
                    <span className="row-value">{labels.signed(entry.bonus.value)}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="card" aria-labelledby={`${headingId}-training`}>
          <h2 id={`${headingId}-training`}>
            <Icon name="crown" />
            {t('character.proficiencies')}
          </h2>
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

        {derived.attacks?.length > 0 && (
          <section className="card" aria-labelledby={`${headingId}-attacks`}>
            <h2 id={`${headingId}-attacks`}>
              <Icon name="shield" />
              {t('character.attacks.title')}
            </h2>
            <ul className="row-list">
              {derived.attacks.map((attack) => (
                <li key={attack.itemId}>
                  <span className="row-main">
                    {options.items.find((item) => item.id === attack.itemId)?.name ?? labels.name(attack.itemId)}
                    <span className="muted small">
                      {' '}
                      · {t('character.attacks.damage', { dice: attack.damage.dice, bonus: labels.signed(attack.damage.bonus), type: t(`character.attacks.type.${attack.damage.type}`, { defaultValue: attack.damage.type }) })}
                      {attack.mastery && ` · ${labels.name(attack.mastery)}`}
                      {!attack.proficient && ` · ${t('character.attacks.notProficient')}`}
                    </span>
                  </span>
                  <span className="row-value">{labels.signed(attack.attackBonus.value)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!character.resources?.initialized && (
        <section className="card" aria-labelledby={`${headingId}-inventory`}>
          <h2 id={`${headingId}-inventory`}>
            <Icon name="ticket" />
            {t('character.inventory')}
          </h2>
          <ul className="row-list">
            {derived.inventory.map((item, index) => (
              <li key={index}>
                <span className="row-main">
                  {item.id ? labels.name(item.id) : t(`character.customItem.${item.custom}`)}
                  {item.note && <span className="muted small"> ({item.note})</span>}
                </span>
                <span className="row-value">×{item.quantity}</span>
              </li>
            ))}
            <li>
              <span className="row-main">{t('character.coins')}</span>
              <span className="row-value">{t('character.gp', { amount: derived.gp })}</span>
            </li>
          </ul>
        </section>
        )}

        {(draft.concept || draft.motivation || draft.partyBond) && (
          <section className="card" aria-labelledby={`${headingId}-story`}>
            <h2 id={`${headingId}-story`}>
              <Icon name="user" />
              {t('character.story')}
            </h2>
            <dl className="facts">
              {(['concept', 'motivation', 'partyBond'] as const).map((field) =>
                draft[field] ? (
                  <div key={field}>
                    <dt>{t(`character.field.${field}`)}</dt>
                    <dd>{draft[field]}</dd>
                  </div>
                ) : null,
              )}
            </dl>
          </section>
        )}
      </div>
    </article>
  );
}
