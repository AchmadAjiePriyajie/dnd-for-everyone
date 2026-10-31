import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ApiError, MemberView } from '#shared/access';
import type { Id, JsonValue } from '#shared/contracts';
import { NOTE_KINDS, type NoteDraft, type NoteSummary, type NoteView, QUEST_STATUSES } from '#shared/notes';
import { api } from '../../app/api';
import { Icon } from '../../app/icons';
import { routePath } from '../../app/router';
import { sendCommand } from '../../app/room-store';
import { ErrorMessage, toApiError } from '../../app/ui';
import { Markdown } from '../reference/Markdown';
import { generateNpcName } from './names';

/** Jeda autosave setelah ketikan terakhir. */
export const AUTOSAVE_DELAY_MS = 500;

const emptyScene = (): NonNullable<NoteDraft['scene']> => ({ readAloud: '', triggers: '', outcomes: '', rewards: '', statBlocks: [] });

export const draftFromView = (view: NoteView | null): NoteDraft => ({
  kind: view?.kind ?? 'scene',
  title: view?.title ?? '',
  body: view?.body ?? '',
  dmNotes: view?.dmNotes ?? '',
  scene: view?.scene && 'triggers' in view.scene ? view.scene : view?.kind === 'scene' || !view ? emptyScene() : null,
  quest: view?.quest ?? null,
  links: view?.links ?? [],
  visibility: view?.visibility ?? { mode: 'dm' },
});

type SaveState = 'idle' | 'saving' | 'saved' | 'conflict' | 'error';

interface Props {
  campaignId: Id;
  noteId: Id;
  initial: NoteView | null;
  notes: NoteSummary[];
  members: MemberView[];
  onClose(): void;
}

/**
 * Editor catatan DM dengan autosave berbasis revisi. Konflik (tab lain menyimpan lebih dulu) atau
 * gagal simpan tidak pernah membuang ketikan: draft tetap di layar sampai DM memilih tindakan.
 */
export function StoryEditor({ campaignId, noteId, initial, notes, members, onClose }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const [draft, setDraft] = useState<NoteDraft>(() => draftFromView(initial));
  const [state, setState] = useState<SaveState>('idle');
  const [error, setError] = useState<ApiError | null>(null);
  const revision = useRef<number | null>(initial ? initial.revision : null);
  const dirty = useRef(false);
  const players = members.filter((member) => member.role === 'player');

  const save = async (value: NoteDraft, expected: number | null = revision.current) => {
    setState('saving');
    try {
      const result = await sendCommand({
        requestId: globalThis.crypto.randomUUID(),
        campaignId,
        targetId: noteId,
        kind: 'note.save',
        payload: { draft: value } as unknown as JsonValue,
        ...(expected === null ? {} : { expectedRevision: expected }),
      });
      revision.current = result.entityRevision;
      dirty.current = false;
      setError(null);
      setState('saved');
    } catch (cause) {
      const apiError = toApiError(cause);
      setError(apiError);
      setState(apiError.code === 'STALE_REVISION' ? 'conflict' : 'error');
    }
  };

  useEffect(() => {
    if (!dirty.current || state === 'conflict' || !draft.title.trim()) return;
    const timer = setTimeout(() => void save(draft), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
    // Simpan hanya mengikuti perubahan draft; status konflik menahan autosave.
  }, [draft, state === 'conflict']);

  const update = (patch: Partial<NoteDraft>) => {
    dirty.current = true;
    setDraft((current) => ({ ...current, ...patch }));
  };
  const updateScene = (patch: Partial<NonNullable<NoteDraft['scene']>>) => update({ scene: { ...(draft.scene ?? emptyScene()), ...patch } });
  const loadLatest = async () => {
    const latest = await api.note(campaignId, noteId);
    revision.current = latest.revision;
    dirty.current = false;
    setDraft(draftFromView(latest));
    setError(null);
    setState('idle');
  };
  const overwrite = async () => {
    const latest = await api.note(campaignId, noteId);
    await save(draft, latest.revision);
  };
  const setVisibilityMember = (accountId: Id, checked: boolean) => {
    const current = draft.visibility.mode === 'members' ? draft.visibility.accountIds : [];
    const accountIds = checked ? [...current, accountId] : current.filter((other) => other !== accountId);
    update({ visibility: accountIds.length ? { mode: 'members', accountIds } : { mode: 'dm' } });
  };
  const refHref = (entryId: Id) => `${routePath.reference(campaignId)}?entry=${encodeURIComponent(entryId)}`;

  return (
    <section className="card story-editor" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>{initial ? t('notes.edit') : t('notes.new')}</h2>
      <p className="save-status" role="status">
        {t(`notes.save.${state}`)}
      </p>
      {state === 'conflict' && (
        <div className="callout" role="alert">
          <p>{t('notes.conflict')}</p>
          <p className="row-actions">
            <button type="button" onClick={() => void loadLatest()}>
              {t('notes.loadLatest')}
            </button>
            <button type="button" className="primary" onClick={() => void overwrite()}>
              {t('notes.overwrite')}
            </button>
          </p>
        </div>
      )}
      {state === 'error' && (
        <>
          <ErrorMessage error={error} />
          <p>
            <button type="button" onClick={() => void save(draft)}>
              {t('notes.retry')}
            </button>
          </p>
        </>
      )}

      <div className="field-row">
        <div className="field">
          <label htmlFor={`${id}-kind`}>{t('notes.kindLabel')}</label>
          <select
            id={`${id}-kind`}
            value={draft.kind}
            onChange={(event) => {
              const kind = event.target.value as NoteDraft['kind'];
              update({ kind, scene: kind === 'scene' ? (draft.scene ?? emptyScene()) : null, quest: kind === 'quest' ? (draft.quest ?? { status: 'open' }) : null });
            }}
          >
            {NOTE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(`notes.kind.${kind}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${id}-title`}>{t('notes.title')}</label>
          <input id={`${id}-title`} value={draft.title} maxLength={160} onChange={(event) => update({ title: event.target.value })} />
        </div>
        {draft.kind === 'npc' && (
          <button type="button" onClick={() => update({ title: generateNpcName() })}>
            {t('notes.generateName')}
          </button>
        )}
        {draft.kind === 'quest' && (
          <div className="field">
            <label htmlFor={`${id}-quest`}>{t('notes.questStatus')}</label>
            <select id={`${id}-quest`} value={draft.quest?.status ?? 'open'} onChange={(event) => update({ quest: { status: event.target.value as (typeof QUEST_STATUSES)[number] } })}>
              {QUEST_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t(`notes.quest.${status}`)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="field">
        <label htmlFor={`${id}-body`}>{t('notes.body')}</label>
        <textarea id={`${id}-body`} value={draft.body} rows={6} onChange={(event) => update({ body: event.target.value })} aria-describedby={`${id}-body-hint`} />
        <p id={`${id}-body-hint`} className="hint">
          {t('notes.bodyHint')}
        </p>
      </div>
      {draft.kind === 'scene' && draft.scene && (
        <fieldset className="scene-fields">
          <legend>{t('notes.sceneLegend')}</legend>
          {(['readAloud', 'triggers', 'outcomes', 'rewards'] as const).map((field) => (
            <div key={field} className="field">
              <label htmlFor={`${id}-${field}`}>{t(`notes.scene.${field}`)}</label>
              <textarea id={`${id}-${field}`} rows={3} value={draft.scene![field]} onChange={(event) => updateScene({ [field]: event.target.value })} />
            </div>
          ))}
          <div className="field">
            <label htmlFor={`${id}-statblocks`}>{t('notes.scene.statBlocks')}</label>
            <input
              id={`${id}-statblocks`}
              value={draft.scene.statBlocks.join(', ')}
              placeholder="monster.goblin-warrior"
              onChange={(event) =>
                updateScene({ statBlocks: event.target.value.split(',').map((value) => value.trim()).filter((value) => /^monster\.[a-z0-9-]+$/.test(value)) })
              }
            />
          </div>
        </fieldset>
      )}
      <div className="field">
        <label htmlFor={`${id}-dm`}>{t('notes.dmNotes')}</label>
        <textarea id={`${id}-dm`} value={draft.dmNotes} rows={3} onChange={(event) => update({ dmNotes: event.target.value })} />
      </div>

      <fieldset className="field">
        <legend>{t('notes.links')}</legend>
        <div className="choice-grid">
          {notes
            .filter((other) => other.id !== noteId)
            .map((other) => (
              <label key={other.id} className="check">
                <input
                  type="checkbox"
                  checked={draft.links.includes(other.id)}
                  onChange={(event) => update({ links: event.target.checked ? [...draft.links, other.id] : draft.links.filter((link) => link !== other.id) })}
                />
                {other.title}
              </label>
            ))}
        </div>
      </fieldset>

      <fieldset className="field">
        <legend>
          <Icon name={draft.visibility.mode === 'dm' ? 'eyeOff' : 'eye'} />
          {t('notes.visibility')}
        </legend>
        <label className="check">
          <input type="radio" name={`${id}-vis`} checked={draft.visibility.mode === 'dm'} onChange={() => update({ visibility: { mode: 'dm' } })} />
          {t('notes.visibilityDm')}
        </label>
        <label className="check">
          <input type="radio" name={`${id}-vis`} checked={draft.visibility.mode === 'party'} onChange={() => update({ visibility: { mode: 'party' } })} />
          {t('notes.visibilityParty')}
        </label>
        <p className="hint">{t('notes.visibilityMembers')}</p>
        {players.map((member) => (
          <label key={member.accountId} className="check">
            <input
              type="checkbox"
              checked={draft.visibility.mode === 'members' && draft.visibility.accountIds.includes(member.accountId)}
              onChange={(event) => setVisibilityMember(member.accountId, event.target.checked)}
            />
            {member.username}
          </label>
        ))}
      </fieldset>

      <details>
        <summary>{t('notes.preview')}</summary>
        <div className="reference-body">
          <Markdown text={draft.body} refHref={refHref} onRef={() => undefined} />
        </div>
      </details>
      <p>
        <button type="button" onClick={onClose}>
          {t('notes.close')}
        </button>
      </p>
    </section>
  );
}
