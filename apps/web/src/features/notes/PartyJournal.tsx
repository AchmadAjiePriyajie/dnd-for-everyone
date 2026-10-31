import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ApiError } from '#shared/access';
import type { Id } from '#shared/contracts';
import { NOTE_KINDS, type NoteView } from '#shared/notes';
import { api } from '../../app/api';
import { Icon } from '../../app/icons';
import { Link, navigate, routePath } from '../../app/router';
import { useRoomEntry } from '../../app/room-store';
import { ErrorMessage, toApiError } from '../../app/ui';
import { Markdown } from '../reference/Markdown';
import { StoryEditor } from './StoryEditor';

const selectedFromLocation = (): Id | null => new URLSearchParams(window.location.search).get('note');

/**
 * Cerita dan journal party. Player hanya menerima catatan yang dibagikan kepadanya (difilter server);
 * DM melihat semua catatan, menulis, dan mengatur siapa yang boleh membaca.
 */
export function NotesPage({ campaignId }: { campaignId: Id }) {
  const { t } = useTranslation();
  const id = useId();
  const entry = useRoomEntry(campaignId);
  const snapshot = entry?.snapshot;
  const [selected, setSelected] = useState<Id | null>(selectedFromLocation);
  const [view, setView] = useState<NoteView | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [editing, setEditing] = useState<{ noteId: Id; initial: NoteView | null } | null>(null);
  const sequence = snapshot?.eventSequence;

  useEffect(() => {
    if (!selected) {
      setView(null);
      return;
    }
    api.note(campaignId, selected).then(
      (note) => {
        setView(note);
        setError(null);
      },
      (cause) => setError(toApiError(cause)),
    );
  }, [campaignId, selected, sequence]);

  const open = (noteId: Id) => {
    setSelected(noteId);
    setEditing(null);
    window.history.replaceState(null, '', routePath.notes(campaignId, noteId));
  };
  if (!snapshot) return <p className="muted">{t('app.loading')}</p>;
  const isDm = snapshot.you.role === 'dm';
  const notes = snapshot.notes ?? [];
  const title = (noteId: Id) => notes.find((note) => note.id === noteId)?.title ?? noteId;
  const refHref = (entryId: Id) => `${routePath.reference(campaignId)}?entry=${encodeURIComponent(entryId)}`;

  return (
    <div className="room">
      <Link href={routePath.campaign(campaignId)} className="back-link">
        <Icon name="arrowLeft" />
        {t('reference.backToRoom')}
      </Link>
      <div className="notes-layout">
        <nav className="card" aria-labelledby={`${id}-list`}>
          <h1 id={`${id}-list`}>{isDm ? t('notes.titleDm') : t('notes.titleParty')}</h1>
          {isDm && (
            <p>
              <button type="button" className="primary" onClick={() => setEditing({ noteId: globalThis.crypto.randomUUID(), initial: null })}>
                <Icon name="plus" />
                {t('notes.new')}
              </button>
            </p>
          )}
          {notes.length === 0 && <p className="muted">{isDm ? t('notes.emptyDm') : t('notes.emptyParty')}</p>}
          {NOTE_KINDS.filter((kind) => notes.some((note) => note.kind === kind)).map((kind) => (
            <div key={kind}>
              <h2 className="eyebrow">{t(`notes.kind.${kind}`)}</h2>
              <ul className="row-list">
                {notes
                  .filter((note) => note.kind === kind)
                  .map((note) => (
                    <li key={note.id}>
                      <button type="button" className="link-button" aria-current={note.id === selected ? 'true' : undefined} onClick={() => open(note.id)}>
                        {note.title}
                      </button>
                      {isDm && note.visibility && (
                        <span className="badge">
                          <Icon name={note.visibility.mode === 'dm' ? 'eyeOff' : 'eye'} />
                          {t(`notes.badge.${note.visibility.mode}`)}
                        </span>
                      )}
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </nav>

        {editing ? (
          <StoryEditor
            key={editing.noteId}
            campaignId={campaignId}
            noteId={editing.noteId}
            initial={editing.initial}
            notes={notes}
            members={snapshot.members}
            onClose={() => {
              setEditing(null);
              open(editing.noteId);
            }}
          />
        ) : (
          <article className="card note-reader" aria-labelledby={`${id}-note`}>
            <ErrorMessage error={error} />
            {!view ? (
              <p className="muted">{t('notes.pick')}</p>
            ) : (
              <>
                <p className="eyebrow">{t(`notes.kind.${view.kind}`)}</p>
                <h2 id={`${id}-note`}>{view.title}</h2>
                {view.quest && <span className="badge">{t(`notes.quest.${view.quest.status}`)}</span>}
                {view.scene?.readAloud && (
                  <blockquote className="read-aloud">
                    <p className="eyebrow">{t('notes.scene.readAloud')}</p>
                    {view.scene.readAloud}
                  </blockquote>
                )}
                <div className="reference-body">
                  <Markdown text={view.body} refHref={refHref} onRef={(entryId) => navigate(refHref(entryId))} />
                </div>
                {isDm && view.scene && 'triggers' in view.scene && (
                  <dl className="facts dm-only">
                    {(['triggers', 'outcomes', 'rewards'] as const).map((field) =>
                      view.scene && 'triggers' in view.scene && view.scene[field] ? (
                        <div key={field}>
                          <dt>{t(`notes.scene.${field}`)}</dt>
                          <dd>{view.scene[field]}</dd>
                        </div>
                      ) : null,
                    )}
                    {view.scene.statBlocks.length > 0 && (
                      <div>
                        <dt>{t('notes.scene.statBlocks')}</dt>
                        <dd>
                          <ul className="inline-list">
                            {view.scene.statBlocks.map((monster) => (
                              <li key={monster}>
                                <Link href={refHref(monster)}>{monster}</Link>
                              </li>
                            ))}
                          </ul>
                        </dd>
                      </div>
                    )}
                  </dl>
                )}
                {isDm && view.dmNotes && (
                  <div className="callout dm-only">
                    <h3>{t('notes.dmNotes')}</h3>
                    <p>{view.dmNotes}</p>
                  </div>
                )}
                {view.links.length > 0 && (
                  <nav aria-label={t('notes.links')}>
                    <h3>{t('notes.links')}</h3>
                    <ul className="inline-list">
                      {view.links.map((link) => (
                        <li key={link}>
                          <button type="button" className="link-button" onClick={() => open(link)}>
                            {title(link)}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </nav>
                )}
                {isDm && (
                  <p>
                    <button type="button" onClick={() => setEditing({ noteId: view.id, initial: view })}>
                      {t('notes.edit')}
                    </button>
                  </p>
                )}
              </>
            )}
          </article>
        )}
      </div>
    </div>
  );
}
