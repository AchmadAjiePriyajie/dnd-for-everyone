import { useEffect, useId, useRef, useState } from 'react';
import { Pager, usePaged } from '../../app/Pager';
import { useTranslation } from 'react-i18next';
import type { ApiError } from '#shared/access';
import type { CommandEnvelope } from '#shared/commands';
import type { Id, JsonValue } from '#shared/contracts';
import type { PlaySession, SessionSummary, SessionView } from '#shared/sessions';
import { api } from '../../app/api';
import { Icon } from '../../app/icons';
import { Link, routePath } from '../../app/router';
import { refreshRoom, sendCommand, useConnectionStatus, useRoomEntry } from '../../app/room-store';
import { ErrorMessage, toApiError } from '../../app/ui';

const AUTOSAVE_MS = 800;
type SaveState = 'saved' | 'unsaved' | 'saving' | 'failed' | 'conflict';

const minutes = (session: PlaySession, now: number) => Math.floor(session.segments.reduce((total, segment) =>
  total + ((segment.end ? Date.parse(segment.end) : session.status === 'active' ? now : Date.parse(segment.start)) - Date.parse(segment.start)), 0) / 60_000);

/** Session page: lifecycle (DM), play time, recap with autosave, journal, rule notes and the structured log. */
export function SessionJournal({ campaignId }: { campaignId: Id }) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const entry = useRoomEntry(campaignId);
  const snapshot = entry?.snapshot;
  const connected = useConnectionStatus() === 'connected';
  const isDm = snapshot?.you.role === 'dm';
  const [history, setHistory] = useState<SessionSummary[]>([]);
  const [selected, setSelected] = useState<Id | null>(null);
  const [view, setView] = useState<SessionView | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const sessionId = selected ?? snapshot?.session?.id ?? null;
  const sequence = snapshot?.eventSequence;

  useEffect(() => {
    let cancelled = false;
    api.sessions(campaignId).then((list) => { if (!cancelled) setHistory(list); }, () => undefined);
    return () => { cancelled = true; };
  }, [campaignId, sequence]);
  useEffect(() => {
    if (!sessionId) { setView(null); return; }
    let cancelled = false;
    api.sessionView(campaignId, sessionId).then((next) => { if (!cancelled) setView(next); }, (cause) => { if (!cancelled) setError(toApiError(cause)); });
    return () => { cancelled = true; };
  }, [campaignId, sessionId, sequence]);

  const send = async (kind: string, payload: JsonValue, targetId: Id, expectedRevision?: number): Promise<boolean> => {
    if (busy || !connected) return false;
    setBusy(true); setError(null);
    const command: CommandEnvelope = { requestId: globalThis.crypto.randomUUID(), campaignId, targetId, kind, payload, ...(expectedRevision === undefined ? {} : { expectedRevision }) };
    try {
      await sendCommand(command);
      await refreshRoom(campaignId);
      if (sessionId) setView(await api.sessionView(campaignId, targetId === sessionId ? sessionId : targetId));
      return true;
    } catch (cause) { setError(toApiError(cause)); return false; } finally { setBusy(false); }
  };
  if (!snapshot) return <p aria-busy="true">{t('app.loading')}</p>;
  const session = view?.session;
  const nameOf = (accountId: Id | null) => snapshot.members.find((m) => m.accountId === accountId)?.username ?? '';
  const disabled = busy || !connected;
  const open = snapshot.session && snapshot.session.status !== 'ended';

  return <div className="session-page">
    <Link href={routePath.campaign(campaignId)} className="back-link"><Icon name="arrowLeft" />{t('reference.backToRoom')}</Link>
    <header className="page-banner"><div><p className="eyebrow">{snapshot.campaign.title}</p><h1>{t('session.title')}</h1></div></header>
    <ErrorMessage error={error} />
    {isDm && !open ? <section className="card">
      <h2>{t('session.start')}</h2>
      <form className="combat-setup" onSubmit={(event) => { event.preventDefault(); const newId = globalThis.crypto.randomUUID(); void send('session.start', title.trim() ? { title: title.trim() } : {}, newId).then((ok) => { if (ok) { setSelected(newId); setTitle(''); } }); }}>
        <label htmlFor={`${id}-title`}>{t('session.sessionTitle')}</label>
        <input id={`${id}-title`} value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} />
        <button className="primary" disabled={disabled}>{t('session.start')}</button>
      </form>
    </section> : null}
    {history.length > 1 ? <section className="card">
      <label htmlFor={`${id}-history`}>{t('session.history')}</label>
      <select id={`${id}-history`} value={sessionId ?? ''} onChange={(event) => setSelected(event.target.value)}>
        {history.map((item) => <option key={item.id} value={item.id}>{t('session.heading', { number: item.number, title: item.title })} · {t(`session.status.${item.status}`)}</option>)}
      </select>
    </section> : null}
    {!sessionId ? <p className="card muted">{t('session.none')}</p> : !session || !view ? <p aria-busy="true">{t('app.loading')}</p> : (
      <section className="card session" aria-label={t('session.heading', { number: session.number, title: session.title })}>
        <h2>{t('session.heading', { number: session.number, title: session.title })}</h2>
        <p><span className="badge">{t(`session.status.${session.status}`)}</span> {t('session.playTime', { minutes: minutes(session, Date.now()) })}</p>
        {view.combat ? <p>{t('session.combatLink', { name: view.combat.name, round: view.round ?? 0 })} <Link href={routePath.combat(campaignId)}>{t('combat.open')}</Link>
          {view.resolutions.some((r) => r.phase === 'pending' || r.phase === 'awaitingDecision') ? ` · ${t('session.openResolutions', { count: view.resolutions.filter((r) => r.phase === 'pending' || r.phase === 'awaitingDecision').length })}` : ''}</p> : null}
        {view.scene ? <p>{t('session.sceneLink', { name: view.scene.name })} <Link href={routePath.scenes(campaignId)}>{t('scenes.open')}</Link></p> : null}
        {isDm && session.status !== 'ended' ? <div className="combat-buttons">
          {session.status === 'active' ? <button disabled={disabled} onClick={() => void send('session.pause', {}, session.id)}>{t('session.pause')}</button> : null}
          {session.status === 'paused' ? <button className="primary" disabled={disabled} onClick={() => void send('session.resume', {}, session.id)}>{t('session.resume')}</button> : null}
          <button className="danger" disabled={disabled} onClick={() => void send('session.end', {}, session.id)}>{t('session.end')}</button>
        </div> : null}
        <Recap key={`${session.id}`} session={session} isDm={isDm} connected={connected} campaignId={campaignId} onSaved={async () => setView(await api.sessionView(campaignId, session.id))} />
        <h3>{t('session.journal')}</h3>
        {session.journal.length === 0 ? <p className="muted">{t('session.noJournal')}</p> : <ul>{session.journal.map((item) => <li key={item.id}>
          <strong>{nameOf(item.accountId)}</strong> {item.visibility === 'private' ? <span className="badge">{t('session.private')}</span> : null} <span className="pre-wrap">{item.text}</span>
        </li>)}</ul>}
        <JournalForm disabled={disabled} onAdd={(text, visibility) => send('session.journal', { text, visibility }, session.id)} />
        {isDm && session.ruleNotes ? <>
          <h3>{t('session.ruleNotes')}</h3>
          <ul>{session.ruleNotes.map((note) => <li key={note.id}>
            <label className="checkbox-label"><input type="checkbox" aria-label={t('session.checked', { text: note.text })} checked={note.resolved} disabled={disabled}
              onChange={(event) => void send('session.rule-note-resolve', { noteId: note.id, resolved: event.target.checked }, session.id)} /><span>{note.text}</span></label>
            {note.ruleId ? <Link href={`${routePath.reference(campaignId)}?entry=${encodeURIComponent(note.ruleId)}`}> {t('session.openRule')}</Link> : null}
          </li>)}</ul>
          <RuleNoteForm disabled={disabled} onAdd={(text) => send('session.rule-note', { text }, session.id)} />
        </> : null}
        <h3>{t('session.log')}</h3>
        <SessionLog view={view} nameOf={nameOf} />
      </section>
    )}
  </div>;
}

/** Debounced autosave with a visible state; a stale revision keeps the draft and offers the latest text. */
function Recap({ session, isDm, connected, campaignId, onSaved }: { session: PlaySession; isDm: boolean; connected: boolean; campaignId: Id; onSaved: () => Promise<void> }) {
  const { t } = useTranslation();
  const id = useId();
  const [shared, setShared] = useState(session.recap.shared);
  const [dm, setDm] = useState(session.recap.dm ?? '');
  const [state, setState] = useState<SaveState>('saved');
  const revision = useRef(session.revision);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => { if (state === 'saved') revision.current = session.revision; }, [session.revision, state]);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (!isDm) return <><h3>{t('session.recap')}</h3>{session.recap.shared ? <p className="pre-wrap">{session.recap.shared}</p> : <p className="muted">{t('session.noRecap')}</p>}</>;
  const save = async (nextShared: string, nextDm: string) => {
    if (!connected) { setState('failed'); return; }
    setState('saving');
    try {
      const result = await sendCommand({ requestId: globalThis.crypto.randomUUID(), campaignId, targetId: session.id, kind: 'session.recap', payload: { shared: nextShared, dm: nextDm }, expectedRevision: revision.current });
      revision.current = result.entityRevision;
      setState('saved');
      await refreshRoom(campaignId);
      await onSaved();
    } catch (cause) { setState(toApiError(cause).code === 'STALE_REVISION' ? 'conflict' : 'failed'); }
  };
  const change = (nextShared: string, nextDm: string) => {
    setShared(nextShared); setDm(nextDm); setState('unsaved');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(nextShared, nextDm), AUTOSAVE_MS);
  };
  return <div className="combat-setup">
    <h3>{t('session.recap')}</h3>
    <label htmlFor={`${id}-shared`}>{t('session.recapShared')}</label>
    <textarea id={`${id}-shared`} rows={4} maxLength={20_000} value={shared} onChange={(event) => change(event.target.value, dm)} />
    <label htmlFor={`${id}-dm`}>{t('session.recapDm')}</label>
    <textarea id={`${id}-dm`} rows={3} maxLength={20_000} value={dm} onChange={(event) => change(shared, event.target.value)} />
    <p className="small" aria-live="polite">{t(`session.save.${state}`)}</p>
    {state === 'failed' ? <button type="button" onClick={() => void save(shared, dm)}>{t('session.saveRetry')}</button> : null}
    {state === 'conflict' ? <button type="button" onClick={() => { revision.current = session.revision; setShared(session.recap.shared); setDm(session.recap.dm ?? ''); setState('saved'); }}>{t('session.loadLatest')}</button> : null}
  </div>;
}

function JournalForm({ disabled, onAdd }: { disabled: boolean; onAdd: (text: string, visibility: 'party' | 'private') => Promise<boolean> }) {
  const { t } = useTranslation();
  const id = useId();
  const [text, setText] = useState('');
  const [visibility, setVisibility] = useState<'party' | 'private'>('party');
  return <form className="combat-setup" onSubmit={(event) => { event.preventDefault(); void onAdd(text.trim(), visibility).then((ok) => { if (ok) setText(''); }); }}>
    <label htmlFor={`${id}-text`}>{t('session.journalEntry')}</label>
    <textarea id={`${id}-text`} rows={2} maxLength={5_000} value={text} onChange={(event) => setText(event.target.value)} />
    <label htmlFor={`${id}-visibility`}>{t('session.visibility')}</label>
    <select id={`${id}-visibility`} value={visibility} onChange={(event) => setVisibility(event.target.value as 'party' | 'private')}>
      <option value="party">{t('session.party')}</option><option value="private">{t('session.privateOption')}</option>
    </select>
    <button disabled={disabled || !text.trim()}>{t('session.addJournal')}</button>
  </form>;
}

function RuleNoteForm({ disabled, onAdd }: { disabled: boolean; onAdd: (text: string) => Promise<boolean> }) {
  const { t } = useTranslation();
  const id = useId();
  const [text, setText] = useState('');
  return <form className="combat-setup" onSubmit={(event) => { event.preventDefault(); void onAdd(text.trim()).then((ok) => { if (ok) setText(''); }); }}>
    <label htmlFor={`${id}-rule`}>{t('session.ruleNote')}</label>
    <input id={`${id}-rule`} value={text} maxLength={1_000} onChange={(event) => setText(event.target.value)} />
    <button disabled={disabled || !text.trim()}>{t('session.addRuleNote')}</button>
  </form>;
}

function SessionLog({ view, nameOf }: { view: SessionView; nameOf: (accountId: Id | null) => string }) {
  const { t, i18n } = useTranslation();
  const paged = usePaged(view.log);
  return <>
    <ol className="session-log">{paged.items.map((item) => <li key={item.sequence}>
      <time dateTime={item.at}>{new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }).format(new Date(item.at))}</time>{' '}
      {i18n.exists(`session.logKind.${item.kind}`) ? t(`session.logKind.${item.kind}`) : t('session.logOther', { kind: item.kind })}
      {item.actorAccountId ? <span className="muted"> · {nameOf(item.actorAccountId)}</span> : null}
    </li>)}</ol>
    <Pager label={t('session.log')} page={paged.page} pages={paged.pages} onPage={paged.setPage} />
  </>;
}
