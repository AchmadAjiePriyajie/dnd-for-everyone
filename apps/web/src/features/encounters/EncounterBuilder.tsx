import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { evaluateEncounter } from '#rules/encounter-budget';
import type { ApiError } from '#shared/access';
import type { Id, JsonValue, Locale } from '#shared/contracts';
import type { EncounterEstimate, EncounterTemplate, EncounterView, MonsterInstance } from '#shared/encounters';
import { api } from '../../app/api';
import { Icon } from '../../app/icons';
import { Link, routePath } from '../../app/router';
import { sendCommand, useRoomEntry } from '../../app/room-store';
import { ErrorMessage, toApiError } from '../../app/ui';

/** "1/4" → 0.25; tanpa CR → NaN (tidak lolos filter CR, tidak memicu risiko CR). */
const crValue = (cr: string | null) => {
  if (cr === null) return Number.NaN;
  const [top, bottom] = cr.split('/');
  return bottom ? Number(top) / Number(bottom) : Number(top);
};

const emptyTemplate = (): EncounterTemplate => ({ name: '', target: 'moderate', party: { mode: 'levels', levels: [1, 1, 1, 1] }, monsters: [], difficultTerrain: false, notes: '' });

/**
 * Penyusun encounter DM: cari/filter monster SRD dan homebrew, pilih party, lihat budget 2024
 * (tanpa multiplier) dan risiko. Server menghitung ulang estimasi saat disimpan.
 */
export function EncounterBuilder({ campaignId }: { campaignId: Id }) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const locale = i18n.language as Locale;
  const snapshot = useRoomEntry(campaignId)?.snapshot;
  const [monsters, setMonsters] = useState<MonsterInstance[]>([]);
  const [saved, setSaved] = useState<EncounterView[]>([]);
  const [editing, setEditing] = useState<{ id: Id; revision: number | null; template: EncounterTemplate }>(() => ({ id: globalThis.crypto.randomUUID(), revision: null, template: emptyTemplate() }));
  const [query, setQuery] = useState('');
  const [maxCr, setMaxCr] = useState('');
  const [levelsText, setLevelsText] = useState('1, 1, 1, 1');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => setSaved(await api.encounters(campaignId)), [campaignId]);
  useEffect(() => {
    api.monsters(campaignId, locale).then(setMonsters, (cause) => setError(toApiError(cause)));
    reload().catch((cause) => setError(toApiError(cause)));
  }, [campaignId, locale, reload]);

  const template = editing.template;
  const update = (patch: Partial<EncounterTemplate>) => setEditing((current) => ({ ...current, template: { ...current.template, ...patch } }));
  const byId = useMemo(() => new Map(monsters.map((monster) => [monster.id, monster])), [monsters]);
  const filtered = monsters
    .filter((monster) => !query.trim() || `${monster.name} ${monster.originalName}`.toLowerCase().includes(query.trim().toLowerCase()))
    .filter((monster) => !maxCr || crValue(monster.cr) <= Number(maxCr))
    .slice(0, 40);
  const finalCharacters = (snapshot?.characters ?? []).filter((character) => character.status === 'final');

  // Estimasi langsung di client memakai fungsi aturan yang sama; error input = koreksi, bukan difficulty.
  let estimate: EncounterEstimate | null = null;
  let issue: string | null = null;
  try {
    const levels =
      template.party.mode === 'levels'
        ? template.party.levels
        : finalCharacters.filter((character) => (template.party as { characterIds: Id[] }).characterIds.includes(character.id)).map((character) => character.level);
    estimate = evaluateEncounter(
      levels,
      template.monsters.map((entry) => {
        const monster = byId.get(entry.monsterId);
        const cr = monster ? crValue(monster.cr) : Number.NaN;
        return { xp: monster?.xp ?? Number.NaN, count: entry.count, ...(Number.isNaN(cr) ? {} : { cr }) };
      }),
      { difficultTerrain: template.difficultTerrain },
    );
  } catch (cause) {
    issue = cause instanceof Error ? cause.message : 'INVALID';
  }

  const setLevels = (text: string) => {
    setLevelsText(text);
    const levels = text
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    update({ party: { mode: 'levels', levels } });
  };
  const addMonster = (monsterId: Id) => {
    const existing = template.monsters.find((entry) => entry.monsterId === monsterId);
    update({
      monsters: existing
        ? template.monsters.map((entry) => (entry.monsterId === monsterId ? { ...entry, count: entry.count + 1 } : entry))
        : [...template.monsters, { monsterId, count: 1, hp: 'average' }],
    });
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await sendCommand({
        requestId: globalThis.crypto.randomUUID(),
        campaignId,
        targetId: editing.id,
        kind: 'encounter.save',
        payload: { template } as unknown as JsonValue,
        ...(editing.revision === null ? {} : { expectedRevision: editing.revision }),
      });
      setEditing((current) => ({ ...current, revision: result.entityRevision }));
      await reload();
    } catch (cause) {
      setError(toApiError(cause));
    } finally {
      setBusy(false);
    }
  };
  const targetBudget = estimate ? estimate.budget[template.target] : null;

  return (
    <div className="room">
      <Link href={routePath.campaign(campaignId)} className="back-link">
        <Icon name="arrowLeft" />
        {t('reference.backToRoom')}
      </Link>
      <h1>{t('encounters.title')}</h1>
      <ErrorMessage error={error} />
      <div className="notes-layout">
        <section className="card" aria-labelledby={`${id}-monsters`}>
          <h2 id={`${id}-monsters`}>{t('encounters.monsters')}</h2>
          <div className="field-row">
            <div className="field">
              <label htmlFor={`${id}-q`}>{t('encounters.search')}</label>
              <input id={`${id}-q`} type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor={`${id}-cr`}>{t('encounters.maxCr')}</label>
              <select id={`${id}-cr`} value={maxCr} onChange={(event) => setMaxCr(event.target.value)}>
                <option value="">{t('encounters.anyCr')}</option>
                {['0.25', '0.5', '1', '2', '3', '5', '8', '10', '15', '20', '30'].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <ul className="row-list">
            {filtered.map((monster) => (
              <li key={monster.id}>
                <span className="row-main">
                  {monster.name} {monster.homebrew && <span className="badge">{t('encounters.homebrew')}</span>}
                  <span className="muted small"> · CR {monster.cr ?? '—'} · {monster.xp ?? '—'} XP</span>
                </span>
                <button type="button" aria-label={t('encounters.add', { name: monster.name })} onClick={() => addMonster(monster.id)}>
                  <Icon name="plus" />
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="card" aria-labelledby={`${id}-builder`}>
          <h2 id={`${id}-builder`}>{t('encounters.builder')}</h2>
          <div className="field-row">
            <div className="field">
              <label htmlFor={`${id}-name`}>{t('encounters.name')}</label>
              <input id={`${id}-name`} value={template.name} maxLength={120} onChange={(event) => update({ name: event.target.value })} />
            </div>
            <div className="field">
              <label htmlFor={`${id}-target`}>{t('encounters.target')}</label>
              <select id={`${id}-target`} value={template.target} onChange={(event) => update({ target: event.target.value as EncounterTemplate['target'] })}>
                {(['low', 'moderate', 'high'] as const).map((level) => (
                  <option key={level} value={level}>
                    {t(`encounters.label.${level}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <fieldset className="field">
            <legend>{t('encounters.party')}</legend>
            <label className="check">
              <input type="radio" name={`${id}-party`} checked={template.party.mode === 'levels'} onChange={() => setLevels(levelsText)} />
              {t('encounters.partyLevels')}
            </label>
            {template.party.mode === 'levels' && (
              <div className="field">
                <label htmlFor={`${id}-levels`}>{t('encounters.levels')}</label>
                <input id={`${id}-levels`} value={levelsText} onChange={(event) => setLevels(event.target.value)} />
              </div>
            )}
            {finalCharacters.length > 0 && (
              <label className="check">
                <input
                  type="radio"
                  name={`${id}-party`}
                  checked={template.party.mode === 'characters'}
                  onChange={() => update({ party: { mode: 'characters', characterIds: finalCharacters.map((character) => character.id) } })}
                />
                {t('encounters.partyCharacters')}
              </label>
            )}
            {template.party.mode === 'characters' &&
              finalCharacters.map((character) => {
                const ids = (template.party as { characterIds: Id[] }).characterIds;
                return (
                  <label key={character.id} className="check">
                    <input
                      type="checkbox"
                      checked={ids.includes(character.id)}
                      onChange={(event) =>
                        update({ party: { mode: 'characters', characterIds: event.target.checked ? [...ids, character.id] : ids.filter((other) => other !== character.id) } })
                      }
                    />
                    {character.name} ({t('character.level', { level: character.level })})
                  </label>
                );
              })}
          </fieldset>

          <ul className="row-list">
            {template.monsters.map((entry) => (
              <li key={entry.monsterId}>
                <span className="row-main">{byId.get(entry.monsterId)?.name ?? entry.monsterId}</span>
                <label className="inline-field">
                  <span className="sr-only">{t('encounters.count', { name: byId.get(entry.monsterId)?.name ?? entry.monsterId })}</span>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={entry.count}
                    onChange={(event) =>
                      update({ monsters: template.monsters.map((other) => (other.monsterId === entry.monsterId ? { ...other, count: Number(event.target.value) } : other)) })
                    }
                  />
                </label>
                <select
                  aria-label={t('encounters.hpMode')}
                  value={entry.hp}
                  onChange={(event) =>
                    update({ monsters: template.monsters.map((other) => (other.monsterId === entry.monsterId ? { ...other, hp: event.target.value as 'average' | 'rolled' } : other)) })
                  }
                >
                  <option value="average">{t('encounters.hpAverage')}</option>
                  <option value="rolled">{t('encounters.hpRolled')}</option>
                </select>
                <button type="button" onClick={() => update({ monsters: template.monsters.filter((other) => other.monsterId !== entry.monsterId) })}>
                  {t('encounters.remove')}
                </button>
              </li>
            ))}
          </ul>
          <label className="check">
            <input type="checkbox" checked={template.difficultTerrain} onChange={(event) => update({ difficultTerrain: event.target.checked })} />
            {t('encounters.terrain')}
          </label>
          <div className="field">
            <label htmlFor={`${id}-notes`}>{t('encounters.notes')}</label>
            <textarea id={`${id}-notes`} value={template.notes} maxLength={5000} onChange={(event) => update({ notes: event.target.value })} />
          </div>

          <div className="callout" role="group" aria-label={t('encounters.estimate')}>
            <h3>{t('encounters.estimate')}</h3>
            {estimate ? (
              <>
                <p>
                  <strong>{t(`encounters.label.${estimate.label}`)}</strong> · {t('encounters.total', { xp: estimate.totalXp })} ·{' '}
                  {t('encounters.targetBudget', { target: t(`encounters.label.${template.target}`), xp: targetBudget })}
                </p>
                <p className="muted small">
                  {t('encounters.budgets', { low: estimate.budget.low, moderate: estimate.budget.moderate, high: estimate.budget.high })} ·{' '}
                  {targetBudget !== null && targetBudget - estimate.totalXp >= 0
                    ? t('encounters.left', { xp: targetBudget - estimate.totalXp })
                    : t('encounters.over', { xp: estimate.totalXp - (targetBudget ?? 0) })}
                </p>
                {estimate.risks.length > 0 && (
                  <ul>
                    {estimate.risks.map((risk) => (
                      <li key={risk}>{t(`encounters.risk.${risk}`)}</li>
                    ))}
                  </ul>
                )}
                <p className="hint">{t('encounters.guidance')}</p>
              </>
            ) : (
              <p>{t(`encounters.issue.${issue}`, { defaultValue: issue ?? '' })}</p>
            )}
          </div>
          <p className="row-actions">
            <button type="button" className="primary" disabled={busy || !template.name.trim()} onClick={() => void save()}>
              {t('encounters.save')}
            </button>
            <button type="button" onClick={() => setEditing({ id: globalThis.crypto.randomUUID(), revision: null, template: emptyTemplate() })}>
              {t('encounters.new')}
            </button>
          </p>
        </section>
      </div>

      <section className="card" aria-labelledby={`${id}-saved`}>
        <h2 id={`${id}-saved`}>{t('encounters.saved')}</h2>
        <ul className="row-list">
          {saved.map((entry) => (
            <li key={entry.id}>
              <span className="row-main">
                {entry.template.name}{' '}
                <span className="muted small">
                  · {entry.estimate ? `${t(`encounters.label.${entry.estimate.label}`)} (${entry.estimate.totalXp} XP)` : entry.issues.join(', ')}
                </span>
              </span>
              <button type="button" onClick={() => setEditing({ id: entry.id, revision: entry.revision, template: entry.template })}>
                {t('encounters.edit')}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
