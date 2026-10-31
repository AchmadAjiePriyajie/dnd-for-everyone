import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ApiError } from '#shared/access';
import type { CombatantView, CombatView, TurnBudget } from '#shared/combat';
import type { Id, JsonValue, Locale } from '#shared/contracts';
import type { EncounterView, MonsterInstance } from '#shared/encounters';
import type { Token } from '#shared/scenes';
import type { CommandEnvelope } from '#shared/commands';
import { api } from '../../app/api';
import { Icon } from '../../app/icons';
import { Link, routePath } from '../../app/router';
import { refreshRoom, sendCommand, useConnectionStatus, useRoomEntry } from '../../app/room-store';
import { ErrorMessage, toApiError } from '../../app/ui';
import { ActionPanel } from './ActionPanel';
import { DiceTray } from './DiceTray';
import { VitalsPanel } from './VitalsPanel';

type RunCommand = (kind: string, payload?: JsonValue, revision?: number) => Promise<boolean>;
type Correction = { initiative?: number; tieOrder?: number; hpCurrent?: number; speedFeet?: number; hidden?: boolean; defeated?: boolean; budget?: TurnBudget };

export function CombatTracker({ campaignId }: { campaignId: Id }) {
  const { t, i18n } = useTranslation();
  const entry = useRoomEntry(campaignId);
  const snapshot = entry?.snapshot;
  const connected = useConnectionStatus() === 'connected';
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState<CommandEnvelope | null>(null);
  const [templates, setTemplates] = useState<EncounterView[]>([]);
  const [monsters, setMonsters] = useState<MonsterInstance[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [sceneId, setSceneId] = useState('');
  const [tokens, setTokens] = useState<Token[]>([]);
  const isDm = snapshot?.you.role === 'dm';
  const combat = snapshot?.combat;
  const disabled = busy || !connected || Boolean(uncertain);
  const locale = i18n.language as Locale;
  const formId = useId();

  useEffect(() => {
    if (!isDm) return;
    let cancelled = false;
    Promise.all([api.encounters(campaignId), api.monsters(campaignId, locale)]).then(([encounters, choices]) => {
      if (!cancelled) { setTemplates(encounters); setMonsters(choices); }
    }, (cause) => { if (!cancelled) setError(toApiError(cause)); });
    return () => { cancelled = true; };
  }, [campaignId, isDm, locale]);

  const battleSceneId = combat?.sceneId;
  const sequence = snapshot?.eventSequence;
  useEffect(() => {
    if (!isDm || !battleSceneId) { setTokens([]); return; }
    let cancelled = false;
    api.scene(campaignId, battleSceneId).then((scene) => { if (!cancelled) setTokens(scene.tokens); }, (cause) => { if (!cancelled) { setTokens([]); setError(toApiError(cause)); } });
    return () => { cancelled = true; };
  }, [campaignId, isDm, battleSceneId, sequence]);

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
  const run: RunCommand = async (kind, payload = {}, revision) => {
    if (disabled) return false;
    const starting = kind === 'combat.start';
    return execute({ requestId: globalThis.crypto.randomUUID(), campaignId, targetId: starting ? globalThis.crypto.randomUUID() : combat!.id,
      kind, payload, ...(starting ? {} : { expectedRevision: revision ?? combat!.revision }),
    });
  };

  return (
    <div className="combat-page">
      <Link href={routePath.campaign(campaignId)} className="back-link"><Icon name="arrowLeft" />{t('reference.backToRoom')}</Link>
      <header className="page-banner">
        <div><p className="eyebrow">{snapshot?.campaign.title}</p><h1>{t('combat.title')}</h1></div>
        <Link href={routePath.scenes(campaignId)} className="button-link">{t('scenes.open')}</Link>
      </header>
      <ErrorMessage error={uncertain && error ? error : entry?.error ?? error} />
      {uncertain && !busy ? <button disabled={busy || !connected} onClick={() => void execute(uncertain)}>{t('combat.retryCommand')}</button> : null}
      {!snapshot ? <p aria-busy="true">{t('app.loading')}</p> : (
        <>
          <DiceTray campaignId={campaignId} combat={combat} accountId={snapshot.you.accountId} isDm={Boolean(isDm)} records={snapshot.rolls ?? []} />
          {isDm && (!combat || combat.status === 'ended') ? (
            <section className="card">
              <h2>{t('combat.start')}</h2>
              {templates.length === 0 ? <p>{t('combat.noTemplates')} <Link href={routePath.encounters(campaignId)}>{t('encounters.open')}</Link></p> : (
                <form className="combat-setup" onSubmit={(event) => {
                  event.preventDefault();
                  void run('combat.start', { templateId: templateId || templates[0]!.id, ...(sceneId ? { sceneId } : {}) });
                }}>
                  <label htmlFor={`${formId}-template`}>{t('combat.template')}</label>
                  <select id={`${formId}-template`} value={templateId || templates[0]?.id} onChange={(event) => setTemplateId(event.target.value)}>
                    {templates.map((item) => <option key={item.id} value={item.id}>{item.template.name}</option>)}
                  </select>
                  <label htmlFor={`${formId}-scene`}>{t('combat.scene')}</label>
                  <select id={`${formId}-scene`} value={sceneId} onChange={(event) => setSceneId(event.target.value)}>
                    <option value="">{t('combat.noScene')}</option>
                    {(snapshot.scenes ?? []).map((scene) => <option key={scene.id} value={scene.id}>{scene.name}</option>)}
                  </select>
                  <p className="small muted">{t('combat.setupHelp')}</p>
                  <button className="primary" disabled={disabled}>{t('combat.start')}</button>
                </form>
              )}
            </section>
          ) : null}
          {!combat ? <p className="card muted">{t('combat.noCombat')}</p> : (
            <>
              <section className="card combat-header" aria-label={t('combat.summary')}>
                <h2>{combat.name}</h2>
                <p aria-live="polite">{t(`combat.status.${combat.status}`)} · {t('combat.round', { round: combat.round })}</p>
                <p>{combat.activeId ? t('combat.active', { name: combat.combatants.find((c) => c.id === combat.activeId)?.name ?? '' }) : t('combat.noVisibleTurn')}</p>
                {isDm && combat.status !== 'ended' ? <div className="combat-buttons">
                  {combat.status === 'preparing' ? <button className="primary" disabled={disabled} onClick={() => void run('combat.begin')}>{t('combat.begin')}</button> : null}
                  {combat.status === 'active' ? <>
                    <button className="primary" disabled={disabled} onClick={() => void run('combat.next')}>{t('combat.next')}</button>
                    <button disabled={disabled} onClick={() => void run('combat.pause')}>{t('combat.pause')}</button>
                  </> : null}
                  {combat.status === 'paused' ? <button className="primary" disabled={disabled} onClick={() => void run('combat.resume')}>{t('combat.resume')}</button> : null}
                  <button className="danger" disabled={disabled} onClick={() => void run('combat.end')}>{t('combat.end')}</button>
                </div> : null}
              </section>
              <ol className="combat-order" aria-label={t('combat.order')}>
                {combat.combatants.map((creature) => <li key={creature.id} className={`card combatant${combat.activeId === creature.id ? ' is-active' : ''}${creature.defeated ? ' is-defeated' : ''}`} aria-current={combat.activeId === creature.id ? 'step' : undefined}>
                  <div className="combatant-heading">
                    <strong>{creature.name}</strong><span className="badge">{t('combat.initiativeValue', { score: creature.initiative })}</span>
                    {creature.hidden ? <span className="badge">{t('combat.hidden')}</span> : null}
                    {creature.defeated ? <span className="badge">{t('combat.defeated')}</span> : null}
                    {creature.hp ? <span>{t('combat.hp', { current: creature.hp.current, max: creature.hp.max, temp: creature.hp.temp })}</span> : null}
                  </div>
                  {creature.budget && (isDm || creature.ownerAccountId === snapshot.you.accountId) ? <ActionPanel
                    creature={creature} active={combat.activeId === creature.id} disabled={disabled || combat.status !== 'active'}
                    onSpend={(resource, amount) => void run('combat.spend', { combatantId: creature.id, resource, ...(amount === undefined ? {} : { amount }) })}
                  /> : null}
                  {creature.hp && (isDm || creature.ownerAccountId === snapshot.you.accountId) ? <VitalsPanel creature={creature} combat={combat} isDm={Boolean(isDm)} disabled={disabled || combat.status === 'ended'} run={run} /> : null}
                  {isDm && combat.status !== 'ended' ? <CombatantCorrection creature={creature} combat={combat} tokens={tokens} disabled={disabled} run={run} /> : null}
                </li>)}
              </ol>
              {combat.combatants.length === 0 ? <p className="muted">{t('combat.empty')}</p> : null}
              {isDm && combat.status !== 'ended' ? <ReinforcementForm
                monsters={monsters} characters={(snapshot.characters ?? []).filter((c) => c.status === 'final' && !combat.combatants.some((a) => a.characterId === c.id))}
                disabled={disabled} run={run}
              /> : null}
            </>
          )}
        </>
      )}
    </div>
  );
}

function CombatantCorrection({ creature, combat, tokens, disabled, run }: { creature: CombatantView; combat: CombatView; tokens: Token[]; disabled: boolean; run: RunCommand }) {
  const { t } = useTranslation();
  const id = useId();
  const [patch, setPatch] = useState<Correction>({});
  const [reason, setReason] = useState('');
  const [hpSourceRevision, setHpSourceRevision] = useState<number | undefined>();
  const [tokenChoice, setTokenChoice] = useState<string | undefined>();
  const selectedToken = tokenChoice ?? creature.tokenId ?? '';
  const title = t('combat.adjust', { name: creature.name });
  const fields = [
    { key: 'initiative' as const, value: creature.initiative, min: -100, max: 999 },
    { key: 'tieOrder' as const, value: creature.tieOrder, min: 0, max: 9999 },
    { key: 'hpCurrent' as const, value: creature.hp?.current ?? 0, min: 0, max: creature.hp?.max ?? 99999 },
    { key: 'speedFeet' as const, value: creature.speedFeet ?? 0, min: 0, max: 9999 },
  ];
  return <details className="combat-correction">
    <summary>{title}</summary>
    <form aria-label={title} className="combat-setup" onSubmit={async (event) => {
      event.preventDefault();
      if (await run('combat.update', { combatantId: creature.id, patch, reason, ...(hpSourceRevision === undefined ? {} : { sourceRevision: hpSourceRevision }) })) { setPatch({}); setReason(''); setHpSourceRevision(undefined); }
    }}>
      {combat.sceneId ? <div className="field">
        <label htmlFor={`${id}-token`}>{t('combat.mapToken')}</label>
        <select id={`${id}-token`} value={selectedToken} onChange={(event) => setTokenChoice(event.target.value)}>
          <option value="">{t('combat.unlinked')}</option>
          {tokens.filter((token) => !combat.combatants.some((c) => c.id !== creature.id && c.tokenId === token.id)).map((token) => <option key={token.id} value={token.id}>{token.label}</option>)}
        </select>
        <button type="button" disabled={disabled || selectedToken === (creature.tokenId ?? '')} onClick={async () => {
          if (await run('combat.bind-token', { combatantId: creature.id, tokenId: selectedToken || null })) setTokenChoice(undefined);
        }}>{t('combat.linkToken')}</button>
      </div> : null}
      {fields.map((field) => <div className="field" key={field.key}>
        <label htmlFor={`${id}-${field.key}`}>{t(`combat.field.${field.key}`)}</label>
        <input id={`${id}-${field.key}`} type="number" min={field.min} max={field.max} step="1" value={patch[field.key] ?? field.value} onChange={(event) => {
          setPatch((current) => ({ ...current, [field.key]: Number(event.target.value) }));
          if (field.key === 'hpCurrent') setHpSourceRevision(creature.characterRevision);
        }} />
      </div>)}
      {(['hidden', 'defeated'] as const).map((field) => <label key={field} className="checkbox-label">
        <input type="checkbox" checked={patch[field] ?? creature[field] ?? false} onChange={(event) => setPatch((current) => ({ ...current, [field]: event.target.checked }))} />{t(`combat.${field}`)}
      </label>)}
      {creature.budget ? <fieldset><legend>{t('combat.correctBudget')}</legend><div className="combat-budget-inputs">
        {(['action', 'bonus', 'reaction', 'movement'] as const).map((resource) => <label key={resource}>
          {t(`combat.resource.${resource}`)}
          <input type="number" min="0" max={resource === 'movement' ? 9999 : 1} step="1" value={(patch.budget ?? creature.budget!)[resource]} onChange={(event) => setPatch((current) => ({ ...current, budget: { ...(current.budget ?? creature.budget!), [resource]: Number(event.target.value) } }))} />
        </label>)}
      </div></fieldset> : null}
      <label htmlFor={`${id}-reason`}>{t('combat.reason')}</label>
      <input id={`${id}-reason`} value={reason} maxLength={500} required onChange={(event) => setReason(event.target.value)} />
      <div className="combat-buttons">
        <button className="primary" disabled={disabled || !reason.trim() || Object.keys(patch).length === 0}>{t('combat.saveCorrection')}</button>
        <button type="button" disabled={disabled || !reason.trim() || creature.defeated || combat.status !== 'active'} onClick={() => void run('combat.set-turn', { combatantId: creature.id, reason })}>{t('combat.setTurn')}</button>
        <button type="button" className="danger" disabled={disabled} onClick={() => void run('combat.remove', { combatantId: creature.id })}>{t('combat.remove')}</button>
      </div>
    </form>
  </details>;
}

function ReinforcementForm({ monsters, characters, disabled, run }: {
  monsters: MonsterInstance[]; characters: Array<{ id: Id; name: string }>; disabled: boolean; run: RunCommand;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [source, setSource] = useState('');
  const [count, setCount] = useState('1');
  const [initiative, setInitiative] = useState('0');
  const [hidden, setHidden] = useState(false);
  const [hp, setHp] = useState<'average' | 'rolled'>('average');
  const isCharacter = source.startsWith('character:');
  return <section className="card"><h2>{t('combat.reinforce')}</h2>
    <form className="combat-setup" onSubmit={(event) => {
      event.preventDefault();
      void run('combat.reinforce', {
        ...(isCharacter ? { characterId: source.slice(10) } : { monsterId: source.slice(8), count: Number(count), hp }),
        initiative: Number(initiative), hidden,
      });
    }}>
      <label htmlFor={`${id}-source`}>{t('combat.creature')}</label>
      <select id={`${id}-source`} value={source} required onChange={(event) => setSource(event.target.value)}>
        <option value="">{t('combat.chooseCreature')}</option>
        {characters.map((character) => <option key={character.id} value={`character:${character.id}`}>{character.name}</option>)}
        {monsters.map((monster) => <option key={monster.id} value={`monster:${monster.id}`}>{monster.name}</option>)}
      </select>
      {!isCharacter ? <>
        <label htmlFor={`${id}-count`}>{t('combat.count')}</label>
        <input id={`${id}-count`} type="number" min="1" max="50" required value={count} onChange={(event) => setCount(event.target.value)} />
        <label htmlFor={`${id}-hp`}>{t('combat.hpMethod')}</label>
        <select id={`${id}-hp`} value={hp} onChange={(event) => setHp(event.target.value as 'average' | 'rolled')}>
          <option value="average">{t('combat.average')}</option><option value="rolled">{t('combat.rolled')}</option>
        </select>
      </> : null}
      <label htmlFor={`${id}-initiative`}>{t('combat.field.initiative')}</label>
      <input id={`${id}-initiative`} type="number" min="-100" max="999" required value={initiative} onChange={(event) => setInitiative(event.target.value)} />
      <label className="checkbox-label"><input type="checkbox" checked={hidden} onChange={(event) => setHidden(event.target.checked)} />{t('combat.hidden')}</label>
      <button disabled={disabled || !source}>{t('combat.reinforce')}</button>
    </form>
  </section>;
}
