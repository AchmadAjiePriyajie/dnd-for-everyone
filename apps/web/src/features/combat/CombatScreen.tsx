import { useCallback, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ApiError } from '#shared/access';
import type { CombatantView, CombatView } from '#shared/combat';
import type { CommandEnvelope } from '#shared/commands';
import type { Id, Locale } from '#shared/contracts';
import type { EncounterView, MonsterInstance } from '#shared/encounters';
import type { Asset, GridPoint, SceneView, Token } from '#shared/scenes';
import { straightPath } from '#rules/movement';
import type { RoomSnapshot } from '#shared/room';
import { api, assetUrl } from '../../app/api';
import { Icon } from '../../app/icons';
import { useBreakpoint } from '../../app/layout';
import { Link, routePath } from '../../app/router';
import { refreshRoom, sendCommand, useConnectionStatus, useRoomEntry } from '../../app/room-store';
import { ErrorMessage, toApiError } from '../../app/ui';
import { BattleMap } from '../scenes/BattleMap';
import { ActionPanel } from './ActionPanel';
import { ActionBar } from './ActionBar';
import { MobileTabs } from './MobileTabs';
import { Notifications } from './Notifications';
import { PlayerCard } from './PlayerCard';
import { CombatantCorrection, ReinforcementForm, type RunCommand } from './CombatForms';
import { DiceTray } from './DiceTray';
import { ResolutionPanel } from './ResolutionPanel';
import { RulesPanel } from './RulesPanel';
import { SidePanel } from './SidePanel';
import { TurnOrder } from './TurnOrder';
import { useActionDraft } from './useActionDraft';
import { VitalsPanel } from './VitalsPanel';

/** Command runner shared by the screen: one envelope at a time, kept for an exact retry when the ACK is lost. */
function useCombatRunner(campaignId: Id, combat: CombatView | null | undefined) {
  const connected = useConnectionStatus() === 'connected';
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState<CommandEnvelope | null>(null);
  const execute = async (command: CommandEnvelope): Promise<boolean> => {
    if (busy || !connected) return false;
    setBusy(true); setError(null); setUncertain(command);
    try {
      await sendCommand(command);
      setUncertain(null);
      await refreshRoom(campaignId);
      return true;
    } catch (cause) {
      const failure = toApiError(cause);
      setError(failure.code === 'OFFLINE' ? { code: 'COMMAND_UNCERTAIN', params: {} } : failure);
      if (failure.code !== 'OFFLINE') setUncertain(null);
      await refreshRoom(campaignId);
      return false;
    } finally { setBusy(false); }
  };
  const disabled = busy || !connected || Boolean(uncertain);
  const run: RunCommand = async (kind, payload = {}, revision) => {
    if (disabled) return false;
    const starting = kind === 'combat.start';
    return execute({ requestId: globalThis.crypto.randomUUID(), campaignId, targetId: starting ? globalThis.crypto.randomUUID() : combat!.id,
      kind, payload, ...(starting ? {} : { expectedRevision: revision ?? combat!.revision }) });
  };
  return { execute, run, error, busy, uncertain, disabled, connected };
}

/** Battle map of the combat's scene, with the same move rules as the scene page. */
function CombatMap({ campaignId, combat, snapshot, selected, onSelect, markedIds }: { campaignId: Id; combat: CombatView; snapshot: RoomSnapshot; selected: Id | null; onSelect(tokenId: Id | null): void; markedIds: Id[] }) {
  const { t } = useTranslation();
  const [scene, setScene] = useState<SceneView | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const isDm = snapshot.you.role === 'dm';
  const sceneId = combat.sceneId;
  const reload = useCallback(async () => { setScene(sceneId ? await api.scene(campaignId, sceneId) : null); }, [campaignId, sceneId]);
  useEffect(() => {
    reload().catch((cause) => setError(toApiError(cause)));
    if (sceneId) api.assets(campaignId).then(setAssets, () => setAssets([]));
  }, [reload, campaignId, sceneId, snapshot.eventSequence]);
  if (!sceneId) return <section className="combat-map card" aria-label={t('screen.map')}><p className="muted">{t('screen.noMap')}</p></section>;
  const canMove = (token: Token) => isDm || (token.ownerAccountId !== null && token.ownerAccountId === snapshot.you.accountId);
  const moveTo = async (token: Token, target: GridPoint) => {
    setError(null);
    try {
      await sendCommand({ requestId: globalThis.crypto.randomUUID(), campaignId, targetId: token.id, kind: 'token.move', payload: { x: target.x, y: target.y, path: straightPath({ x: token.x, y: token.y }, target) } });
      await reload();
    } catch (cause) { setError(toApiError(cause)); }
  };
  const selectedToken = scene?.tokens.find((token) => token.id === selected) ?? null;
  const asset = scene?.assetId ? assets.find((candidate) => candidate.id === scene.assetId) : undefined;
  const activeTokenId = combat.combatants.find((c) => c.id === combat.activeId)?.tokenId ?? null;
  return <section className="combat-map card" aria-label={t('screen.map')}>
    <ErrorMessage error={error} />
    {!scene ? <p aria-busy="true">{t('app.loading')}</p> : <BattleMap scene={scene}
      background={asset ? { url: assetUrl(campaignId, asset.id), width: asset.width, height: asset.height } : null}
      selected={selected} onSelect={onSelect} canMove={canMove} onMove={(token, x, y) => void moveTo(token, { x, y })}
      onCellTap={(cell) => { if (selectedToken && canMove(selectedToken)) void moveTo(selectedToken, cell); }}
      activeTokenId={activeTokenId} markedIds={markedIds} />}
  </section>;
}

/** DM setup when no combat is running: choose an encounter template and optional scene. */
function CombatSetup({ campaignId, snapshot, templates, disabled, run }: { campaignId: Id; snapshot: RoomSnapshot; templates: EncounterView[]; disabled: boolean; run: RunCommand }) {
  const { t } = useTranslation();
  const id = useId();
  const [templateId, setTemplateId] = useState('');
  const [sceneId, setSceneId] = useState('');
  return <section className="card">
    <h2>{t('combat.start')}</h2>
    {templates.length === 0 ? <p>{t('combat.noTemplates')} <Link href={routePath.encounters(campaignId)}>{t('encounters.open')}</Link></p> : (
      <form className="combat-setup" onSubmit={(event) => { event.preventDefault(); void run('combat.start', { templateId: templateId || templates[0]!.id, ...(sceneId ? { sceneId } : {}) }); }}>
        <label htmlFor={`${id}-template`}>{t('combat.template')}</label>
        <select id={`${id}-template`} value={templateId || templates[0]?.id} onChange={(event) => setTemplateId(event.target.value)}>
          {templates.map((item) => <option key={item.id} value={item.id}>{item.template.name}</option>)}
        </select>
        <label htmlFor={`${id}-scene`}>{t('combat.scene')}</label>
        <select id={`${id}-scene`} value={sceneId} onChange={(event) => setSceneId(event.target.value)}>
          <option value="">{t('combat.noScene')}</option>
          {(snapshot.scenes ?? []).map((scene) => <option key={scene.id} value={scene.id}>{scene.name}</option>)}
        </select>
        <p className="small muted">{t('combat.setupHelp')}</p>
        <button className="primary" disabled={disabled}>{t('combat.start')}</button>
      </form>
    )}
  </section>;
}

/** One screen for running combat: turn order (left), map + actions (centre), Resolutions/Dice/Rules (right). */
export function CombatScreen({ campaignId }: { campaignId: Id }) {
  const { t, i18n } = useTranslation();
  const entry = useRoomEntry(campaignId);
  const snapshot = entry?.snapshot;
  const combat = snapshot?.combat;
  const isDm = snapshot?.you.role === 'dm';
  const locale = i18n.language as Locale;
  const breakpoint = useBreakpoint();
  const runner = useCombatRunner(campaignId, combat);
  const [templates, setTemplates] = useState<EncounterView[]>([]);
  const [monsters, setMonsters] = useState<MonsterInstance[]>([]);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [selectedToken, setSelectedToken] = useState<Id | null>(null);
  const [selectedIds, setSelectedIds] = useState<Id[]>([]);
  // Targets disappear from the selection as soon as the projection stops showing them (hidden, removed).
  const visibleKey = combat?.combatants.map((c) => c.id).join('|') ?? '';
  useEffect(() => { setSelectedIds((current) => current.filter((value) => visibleKey.split('|').includes(value))); }, [visibleKey]);
  const [drawer, setDrawer] = useState<'order' | 'tools' | null>(null);
  const [actorChoice, setActorChoice] = useState<Id | null>(null);
  const viewer = snapshot?.you.accountId;
  const actors = combat ? combat.combatants.filter((c) => c.budget && !c.defeated && (isDm || c.ownerAccountId === viewer)) : [];
  const actor = actors.find((c) => c.id === actorChoice) ?? actors.find((c) => c.id === combat?.activeId) ?? actors[0];
  const draft = useActionDraft({ campaignId, combat, actorId: actor?.id, locale, targetIds: selectedIds, setTargetIds: setSelectedIds, disabled: runner.disabled || combat?.status !== 'active' });

  useEffect(() => {
    if (!isDm) return;
    let cancelled = false;
    Promise.all([api.encounters(campaignId), api.monsters(campaignId, locale)]).then(([encounters, choices]) => { if (!cancelled) { setTemplates(encounters); setMonsters(choices); } }, () => undefined);
    return () => { cancelled = true; };
  }, [campaignId, isDm, locale]);
  const battleSceneId = combat?.sceneId;
  const sequence = snapshot?.eventSequence;
  useEffect(() => {
    if (!isDm || !battleSceneId) { setTokens([]); return; }
    let cancelled = false;
    api.scene(campaignId, battleSceneId).then((scene) => { if (!cancelled) setTokens(scene.tokens); }, () => { if (!cancelled) setTokens([]); });
    return () => { cancelled = true; };
  }, [campaignId, isDm, battleSceneId, sequence]);

  if (!snapshot) return <p aria-busy="true">{t('app.loading')}</p>;
  const accountId = snapshot.you.accountId;
  const { disabled, run, execute } = runner;
  const controls = (creature: CombatantView) => isDm || creature.ownerAccountId === accountId;
  const toggle = (id: Id) => setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const rowTools = (creature: CombatantView) => combat ? <>
    {controls(creature) && (creature.budget || creature.hp) ? <details className="row-tools">
      <summary>{t('screen.manage', { name: creature.name })}</summary>
      {creature.budget ? <ActionPanel creature={creature} active={combat.activeId === creature.id} disabled={disabled || combat.status !== 'active'}
        onSpend={(resource, amount) => void run('combat.spend', { combatantId: creature.id, resource, ...(amount === undefined ? {} : { amount }) })} /> : null}
      {creature.hp && creature.vitals ? <VitalsPanel creature={creature} combat={combat} isDm={Boolean(isDm)} disabled={disabled || combat.status === 'ended'} run={run} /> : null}
    </details> : null}
    {isDm && combat.status !== 'ended' ? <CombatantCorrection creature={creature} combat={combat} tokens={tokens} disabled={disabled} run={run} /> : null}
  </> : null;

  const open = (snapshot.resolutions ?? []).filter((r) => combat && r.combatId === combat.id && (r.phase === 'pending' || r.phase === 'awaitingDecision'));
  const waitsForMe = open.some((r) => r.pendingReactions.some((reaction) => reaction.status === 'offered' && combat?.combatants.find((c) => c.id === reaction.combatantId && controls(c))));
  const order = combat ? <TurnOrder combat={combat} selectedIds={selectedIds} onSelect={toggle} tools={rowTools} /> : null;
  const tools = combat ? <SidePanel label={t('screen.tools')} initial={open.length ? 'resolutions' : 'dice'} tabs={[
    { id: 'resolutions', label: t('screen.tab.resolutions'), badge: open.length, attention: waitsForMe || (Boolean(isDm) && open.some((r) => r.phase === 'awaitingDecision')),
      content: open.length || (snapshot.resolutions ?? []).some((r) => r.combatId === combat.id)
        ? <ResolutionPanel campaignId={campaignId} combat={combat} resolutions={snapshot.resolutions ?? []} accountId={accountId} isDm={Boolean(isDm)} disabled={disabled || combat.status === 'ended'} send={execute} />
        : <p className="muted">{t('screen.noResolutions')}</p> },
    { id: 'dice', label: t('screen.tab.dice'), content: <DiceTray campaignId={campaignId} combat={combat} accountId={accountId} isDm={Boolean(isDm)} records={snapshot.rolls ?? []} /> },
    { id: 'rules', label: t('screen.tab.rules'), content: <RulesPanel campaignId={campaignId} /> },
    ...(isDm ? [] : [{ id: 'journal', label: t('screen.tab.journal'), content: <p>{snapshot.session && snapshot.session.status !== 'ended' ? t('session.heading', { number: snapshot.session.number, title: snapshot.session.title }) : t('session.none')} <Link href={routePath.session(campaignId)}>{t('session.journal')}</Link></p> }]),
  ]} /> : null;
  const own = combat?.combatants.find((c) => c.characterId && c.ownerAccountId === accountId);
  const focus = own ?? combat?.combatants.find((c) => c.id === combat.activeId);
  const card = focus && combat ? <PlayerCard creature={focus} campaignId={campaignId} /> : null;
  const notices = combat ? <Notifications campaignId={campaignId} combat={combat} resolutions={snapshot.resolutions ?? []} accountId={accountId} isDm={Boolean(isDm)} disabled={disabled} send={execute} /> : null;
  const marked = combat ? combat.combatants.filter((c) => selectedIds.includes(c.id) && c.tokenId).map((c) => c.tokenId!) : [];
  const selectToken = (tokenId: Id | null) => {
    setSelectedToken(tokenId);
    const target = tokenId && combat ? combat.combatants.find((c) => c.tokenId === tokenId) : undefined;
    // A token click targets only while an action is being prepared; otherwise it just selects the token to move.
    if (target && draft.option) toggle(target.id);
  };
  const bar = combat && combat.status === 'active' ? <ActionBar combat={combat} actors={actors} actor={actor} onActorChange={setActorChoice} draft={draft} targetIds={selectedIds} /> : null;
  const centre = combat ? <div className="combat-centre">
    <CombatMap campaignId={campaignId} combat={combat} snapshot={snapshot} selected={selectedToken} markedIds={marked} onSelect={selectToken} />
    {bar}
    {isDm && combat.status !== 'ended' ? <details className="card"><summary>{t('combat.reinforce')}</summary>
      <ReinforcementForm monsters={monsters} characters={(snapshot.characters ?? []).filter((c) => c.status === 'final' && !combat.combatants.some((a) => a.characterId === c.id))} disabled={disabled} run={run} />
    </details> : null}
  </div> : null;
  const wide = breakpoint === 'wide';

  return <div className={`combat-screen layout-${breakpoint}`}>
    <header className="combat-topbar">
      <Link href={routePath.campaign(campaignId)} className="back-link"><Icon name="arrowLeft" />{t('reference.backToRoom')}</Link>
      <h1>{combat ? combat.name : t('combat.title')}</h1>
      {combat ? <p aria-live="polite" className="small">{t(`combat.status.${combat.status}`)} · {t('combat.round', { round: combat.round })} · {combat.activeId ? t('combat.active', { name: combat.combatants.find((c) => c.id === combat.activeId)?.name ?? '' }) : t('combat.noVisibleTurn')}</p> : null}
      {isDm && combat && combat.status !== 'ended' ? <div className="combat-buttons">
        {combat.status === 'preparing' ? <button className="primary" disabled={disabled} onClick={() => void run('combat.begin')}>{t('combat.begin')}</button> : null}
        {combat.status === 'active' ? <><button className="primary" disabled={disabled} onClick={() => void run('combat.next')}>{t('combat.next')}</button>
          <button disabled={disabled} onClick={() => void run('combat.pause')}>{t('combat.pause')}</button></> : null}
        {combat.status === 'paused' ? <button className="primary" disabled={disabled} onClick={() => void run('combat.resume')}>{t('combat.resume')}</button> : null}
        <button className="danger" disabled={disabled} onClick={() => void run('combat.end')}>{t('combat.end')}</button>
      </div> : null}
      <Link href={routePath.scenes(campaignId)} className="button-link">{t('scenes.open')}</Link>
      {breakpoint === 'medium' && combat ? <div className="combat-buttons">
        <button type="button" aria-expanded={drawer === 'order'} onClick={() => setDrawer(drawer === 'order' ? null : 'order')}>{t('screen.showOrder')}</button>
        <button type="button" aria-expanded={drawer === 'tools'} onClick={() => setDrawer(drawer === 'tools' ? null : 'tools')}>{t('screen.showTools')}</button>
      </div> : null}
    </header>
    <ErrorMessage error={runner.uncertain && runner.error ? runner.error : entry?.error ?? runner.error} />
    {runner.uncertain && !runner.busy ? <button disabled={!runner.connected} onClick={() => void execute(runner.uncertain!)}>{t('combat.retryCommand')}</button> : null}
    {isDm && (!combat || combat.status === 'ended') ? <CombatSetup campaignId={campaignId} snapshot={snapshot} templates={templates} disabled={disabled} run={run} /> : null}
    {notices}
    {!bar && draft.pending && !draft.busy ? <div className="card"><ErrorMessage error={draft.error} /><button type="button" disabled={!draft.connected} onClick={draft.retry}>{t('actions.retry')}</button></div> : null}
    {!combat ? <p className="card muted">{t('combat.noCombat')}</p> : breakpoint === 'narrow'
      ? <MobileTabs label={t('screen.sections')} tabs={[
          { id: 'map', label: t('screen.section.map'), content: <CombatMap campaignId={campaignId} combat={combat} snapshot={snapshot} selected={selectedToken} markedIds={marked} onSelect={selectToken} /> },
          { id: 'character', label: t('screen.section.character'), content: card ?? <p className="muted">{t('combat.noVisibleTurn')}</p> },
          { id: 'actions', label: t('screen.section.actions'), content: bar ?? <p className="muted">{t('combat.noVisibleTurn')}</p> },
          { id: 'turn', label: t('screen.section.turn'), content: order },
          { id: 'more', label: t('screen.section.more'), content: tools },
        ]} />
      : wide
        ? <div className="combat-grid"><div className="combat-left">{order}</div>{centre}<div className="combat-right">{isDm ? null : card}{tools}</div></div>
        : <div className="combat-grid">{centre}
            <div className={`combat-drawer${drawer === 'order' ? ' is-open' : ''}`} hidden={drawer !== 'order'}>{order}</div>
            <div className={`combat-drawer${drawer === 'tools' ? ' is-open' : ''}`} hidden={drawer !== 'tools'}>{isDm ? null : card}{tools}</div>
          </div>}
  </div>;
}
