import { useCallback, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ApiError } from '#shared/access';
import type { Id, JsonValue } from '#shared/contracts';
import { HOMEBREW_KINDS, type HomebrewKind, type HomebrewView } from '#shared/encounters';
import { api } from '../../app/api';
import { Icon } from '../../app/icons';
import { Link, routePath } from '../../app/router';
import { sendCommand, useRoomEntry } from '../../app/room-store';
import { ErrorMessage, toApiError } from '../../app/ui';
import { Markdown } from '../reference/Markdown';

/** Kerangka mekanik awal per jenis; bentuknya sama dengan corpus SRD dan divalidasi server. */
const TEMPLATES: Record<HomebrewKind, Record<string, JsonValue>> = {
  monster: {
    size: ['medium'],
    creatureTypes: ['humanoid'],
    alignment: 'neutral',
    ac: 12,
    initiative: 1,
    hp: { average: 11, formula: '2d8+2' },
    speed: { walk: 30 },
    abilities: { str: 10, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
    saves: { str: 0, dex: 1, con: 1, int: 0, wis: 0, cha: 0 },
    senses: {},
    passivePerception: 10,
    cr: '1/4',
    xp: 50,
    proficiencyBonus: 2,
  },
  spell: {
    level: 1,
    school: 'evocation',
    classes: ['class.wizard'],
    castingTime: { amount: 1, unit: 'action' },
    ritual: false,
    range: { type: 'feet', distance: 60 },
    components: { verbal: true, somatic: true, material: false },
    duration: { type: 'instantaneous', concentration: false },
  },
  equipment: { category: 'gear', cost: { amount: 1, unit: 'gp' }, weight: 1 },
  'magic-item': { category: 'wondrous-item', rarity: 'uncommon', attunement: false },
  feat: { category: 'general', prerequisiteLevel: 4 },
  species: {},
  background: {},
  subclass: {},
};

/**
 * Homebrew campaign: semua anggota dapat mengusulkan; DM menyetujui sebelum dipakai party.
 * Mekanik ditulis sebagai JSON terstruktur (tanpa kode); formula hanya dadu/angka/variabel whitelist.
 */
export function HomebrewEditor({ campaignId }: { campaignId: Id }) {
  const { t } = useTranslation();
  const id = useId();
  const snapshot = useRoomEntry(campaignId)?.snapshot;
  const isDm = snapshot?.you.role === 'dm';
  const [entries, setEntries] = useState<HomebrewView[]>([]);
  const [editing, setEditing] = useState<{ id: Id; revision: number | null } | null>(null);
  const [kind, setKind] = useState<HomebrewKind>('monster');
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [body, setBody] = useState('');
  const [mechanics, setMechanics] = useState(() => JSON.stringify(TEMPLATES.monster, null, 2));
  const [sourceId, setSourceId] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => setEntries(await api.homebrew(campaignId)), [campaignId]);
  useEffect(() => {
    reload().catch((cause) => setError(toApiError(cause)));
  }, [reload, snapshot?.eventSequence]);

  let parsed: Record<string, JsonValue> | null = null;
  try {
    const value = JSON.parse(mechanics) as unknown;
    parsed = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, JsonValue>) : null;
  } catch {
    parsed = null;
  }

  const run = async (kindName: string, targetId: Id, payload: Record<string, unknown>, expectedRevision?: number | null) => {
    setBusy(true);
    setError(null);
    try {
      await sendCommand({
        requestId: globalThis.crypto.randomUUID(),
        campaignId,
        targetId,
        kind: kindName,
        payload: payload as JsonValue,
        ...(expectedRevision === null || expectedRevision === undefined ? {} : { expectedRevision }),
      });
      await reload();
      return true;
    } catch (cause) {
      setError(toApiError(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const startNew = () => {
    setEditing({ id: `hb-${globalThis.crypto.randomUUID()}`, revision: null });
    setName('');
    setSummary('');
    setBody('');
    setMechanics(JSON.stringify(TEMPLATES[kind], null, 2));
  };
  const edit = (entry: HomebrewView) => {
    setEditing({ id: entry.id, revision: entry.revision });
    setKind(entry.kind);
    setName(entry.name);
    setSummary(entry.summary);
    setBody(entry.body);
    setMechanics(JSON.stringify(entry.mechanics, null, 2));
  };
  const save = async () => {
    if (!editing || !parsed) return;
    const ok = await run('homebrew.save', editing.id, { draft: { kind, name, summary, body, mechanics: parsed } }, editing.revision);
    if (ok) setEditing(null);
  };

  return (
    <div className="room">
      <Link href={routePath.campaign(campaignId)} className="back-link">
        <Icon name="arrowLeft" />
        {t('reference.backToRoom')}
      </Link>
      <h1>{t('homebrew.title')}</h1>
      <p className="hint">{isDm ? t('homebrew.helpDm') : t('homebrew.helpPlayer')}</p>
      <ErrorMessage error={error} />
      <div className="notes-layout">
        <section className="card" aria-labelledby={`${id}-list`}>
          <h2 id={`${id}-list`}>{t('homebrew.entries')}</h2>
          <p>
            <button type="button" className="primary" onClick={startNew}>
              <Icon name="plus" />
              {t('homebrew.new')}
            </button>
          </p>
          {entries.length === 0 && <p className="muted">{t('homebrew.empty')}</p>}
          <ul className="row-list">
            {entries.map((entry) => (
              <li key={entry.id}>
                <span className="row-main">
                  {entry.name} <span className="muted small">· {t(`homebrew.kind.${entry.kind}`)}</span>
                </span>
                <span className={`badge${entry.status === 'approved' ? '' : ' badge-accent'}`}>{t(`homebrew.status.${entry.status}`)}</span>
                {(isDm || entry.authorAccountId === snapshot?.you.accountId) && (
                  <button type="button" onClick={() => edit(entry)}>
                    {t('homebrew.edit')}
                  </button>
                )}
                {isDm && entry.status === 'pending' && (
                  <button type="button" disabled={busy} onClick={() => void run('homebrew.approve', entry.id, {}, entry.revision)}>
                    {t('homebrew.approve', { name: entry.name })}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {isDm && (
            <div className="field-row">
              <div className="field">
                <label htmlFor={`${id}-source`}>{t('homebrew.duplicateLabel')}</label>
                <input id={`${id}-source`} value={sourceId} placeholder="monster.goblin-boss" onChange={(event) => setSourceId(event.target.value.trim())} />
              </div>
              <button type="button" disabled={busy || !sourceId} onClick={() => void run('homebrew.duplicate', `hb-${globalThis.crypto.randomUUID()}`, { sourceId }).then((ok) => ok && setSourceId(''))}>
                {t('homebrew.duplicate')}
              </button>
            </div>
          )}
        </section>

        {editing && (
          <section className="card" aria-labelledby={`${id}-editor`}>
            <h2 id={`${id}-editor`}>{t('homebrew.editor')}</h2>
            <div className="field-row">
              <div className="field">
                <label htmlFor={`${id}-kind`}>{t('homebrew.kindLabel')}</label>
                <select
                  id={`${id}-kind`}
                  value={kind}
                  onChange={(event) => {
                    const next = event.target.value as HomebrewKind;
                    setKind(next);
                    if (editing.revision === null) setMechanics(JSON.stringify(TEMPLATES[next], null, 2));
                  }}
                >
                  {HOMEBREW_KINDS.map((option) => (
                    <option key={option} value={option}>
                      {t(`homebrew.kind.${option}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor={`${id}-name`}>{t('homebrew.name')}</label>
                <input id={`${id}-name`} value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
              </div>
            </div>
            <div className="field">
              <label htmlFor={`${id}-summary`}>{t('homebrew.summary')}</label>
              <input id={`${id}-summary`} value={summary} maxLength={500} onChange={(event) => setSummary(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor={`${id}-body`}>{t('homebrew.body')}</label>
              <textarea id={`${id}-body`} rows={6} value={body} onChange={(event) => setBody(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor={`${id}-mechanics`}>{t('homebrew.mechanics')}</label>
              <textarea id={`${id}-mechanics`} className="mono" rows={12} value={mechanics} onChange={(event) => setMechanics(event.target.value)} aria-describedby={`${id}-mechanics-hint`} />
              <p id={`${id}-mechanics-hint`} className={parsed ? 'hint' : 'error'}>
                {parsed ? t('homebrew.mechanicsHint') : t('homebrew.mechanicsInvalid')}
              </p>
            </div>
            <details>
              <summary>{t('notes.preview')}</summary>
              <div className="reference-body">
                <Markdown text={body} refHref={(entryId) => `${routePath.reference(campaignId)}?entry=${encodeURIComponent(entryId)}`} onRef={() => undefined} />
              </div>
            </details>
            <p className="row-actions">
              <button type="button" className="primary" disabled={busy || !parsed || !name.trim()} onClick={() => void save()}>
                {isDm ? t('homebrew.saveDm') : t('homebrew.propose')}
              </button>
              <button type="button" onClick={() => setEditing(null)}>
                {t('notes.close')}
              </button>
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
