import { useId, useState } from 'react';
import { Pager, usePaged } from '../../app/Pager';
import { useTranslation } from 'react-i18next';
import type { ApiError } from '#shared/access';
import { d20InputSchema, type CombatView, type D20Input, type RollAudience, type RollRecord } from '#shared/combat';
import type { CommandEnvelope } from '#shared/commands';
import type { Id } from '#shared/contracts';
import { refreshRoom, sendCommand, useConnectionStatus } from '../../app/room-store';
import { ErrorMessage, toApiError } from '../../app/ui';
import { RollDetails } from './RollDetails';

export function DiceTray({ campaignId, combat, accountId, isDm, records }: {
  campaignId: Id; combat?: CombatView | null; accountId: Id; isDm: boolean; records: RollRecord[];
}) {
  const { t } = useTranslation();
  const id = useId();
  const connected = useConnectionStatus() === 'connected';
  const [expression, setExpression] = useState('1d20');
  const [critical, setCritical] = useState(false);
  const [kind, setKind] = useState<D20Input['kind']>('check');
  const [modifier, setModifier] = useState('0');
  const [dc, setDc] = useState('');
  const [advantage, setAdvantage] = useState(false);
  const [disadvantage, setDisadvantage] = useState(false);
  const [audience, setAudience] = useState<RollAudience>('public');
  const [actorId, setActorId] = useState('');
  const [pending, setPending] = useState<CommandEnvelope | null>(null);
  const [last, setLast] = useState<RollRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const disabled = !connected || busy;

  const submit = async (command: CommandEnvelope) => {
    if (disabled) return;
    setPending(command); setBusy(true); setError(null);
    try {
      const response = await sendCommand(command);
      const value = response.value as unknown as { id: Id; result: RollRecord['result'] };
      const payload = command.payload as unknown as { audience: RollAudience; actor?: RollRecord['actor'] };
      setLast({ id: value.id, accountId, audience: payload.audience, kind: 'kind' in value.result ? value.result.kind : 'dice', result: value.result, createdAt: new Date().toISOString(), ...(payload.actor ? { actor: payload.actor } : {}) });
      setPending(null);
      await refreshRoom(campaignId);
    } catch (cause) {
      const failure = toApiError(cause);
      setError(failure.code === 'OFFLINE' ? { code: 'COMMAND_UNCERTAIN', params: {} } : failure);
      if (failure.code !== 'OFFLINE') setPending(null);
    } finally { setBusy(false); }
  };
  const roll = (d20: boolean) => {
    const actor = combat && actorId ? { combatId: combat.id, combatantId: actorId, expectedRevision: combat.revision } : undefined;
    const input: D20Input = { kind, modifier: Number(modifier), advantage, disadvantage, ...(dc === '' ? {} : { dc: Number(dc) }) };
    if (d20 && !d20InputSchema.safeParse(input).success) { setError({ code: 'D20_INVALID', params: {} }); return; }
    void submit({ requestId: globalThis.crypto.randomUUID(), campaignId, targetId: globalThis.crypto.randomUUID(), kind: d20 ? 'roll.d20' : 'roll.dice',
      payload: { ...(d20 ? { input } : { expression, critical }), audience, ...(actor ? { actor } : {}) },
    });
  };
  const shown = last && !records.some((r) => r.id === last.id) ? [...records, last] : records;
  const history = usePaged([...shown].reverse());
  return <section className="card dice-tray" aria-label={t('dice.title')}>
    <h2>{t('dice.title')}</h2>
    <p className="small muted">{t('dice.manualHelp')}</p>
    <div className="combat-setup">
      <label htmlFor={`${id}-audience`}>{t('dice.audience')}</label>
      <select id={`${id}-audience`} value={audience} onChange={(event) => setAudience(event.target.value as RollAudience)}><option value="public">{t('dice.public')}</option><option value="dm">{t('dice.private')}</option></select>
      {combat ? <>
        <label htmlFor={`${id}-actor`}>{t('dice.actor')}</label>
        <select id={`${id}-actor`} value={actorId} onChange={(event) => setActorId(event.target.value)}>
          <option value="">{t('dice.generic')}</option>
          {combat.combatants.filter((c) => isDm || c.ownerAccountId === accountId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </> : null}
    </div>
    <ErrorMessage error={error} />
    {pending && !busy ? <div className="combat-buttons"><button disabled={disabled} onClick={() => void submit(pending)}>{t('dice.retry')}</button><button disabled={busy} onClick={() => setPending(null)}>{t('dice.discardRetry')}</button></div> : null}
    <form className="combat-setup" onSubmit={(event) => { event.preventDefault(); roll(false); }}>
      <label htmlFor={`${id}-expression`}>{t('dice.expression')}</label>
      <input id={`${id}-expression`} className="mono" maxLength={100} required value={expression} onChange={(event) => setExpression(event.target.value)} />
      <label><input type="checkbox" checked={critical} onChange={(event) => setCritical(event.target.checked)} />{t('dice.critical')}</label>
      <button className="primary" disabled={disabled || Boolean(pending)}>{t('dice.roll')}</button>
    </form>
    <form className="combat-setup" onSubmit={(event) => { event.preventDefault(); roll(true); }}>
      <label htmlFor={`${id}-kind`}>{t('dice.testKind')}</label>
      <select id={`${id}-kind`} value={kind} onChange={(event) => setKind(event.target.value as D20Input['kind'])}>{(['check', 'attack', 'save', 'initiative'] as const).map((value) => <option key={value} value={value}>{t(`dice.kind.${value}`)}</option>)}</select>
      <label htmlFor={`${id}-modifier`}>{t('dice.modifier')}</label><input id={`${id}-modifier`} type="number" min="-100" max="100" step="1" required value={modifier} onChange={(event) => setModifier(event.target.value)} />
      <label htmlFor={`${id}-dc`}>{t('dice.dc')}</label><input id={`${id}-dc`} type="number" min="0" max="999" step="1" value={dc} onChange={(event) => setDc(event.target.value)} />
      <div className="combat-buttons"><label><input type="checkbox" checked={advantage} onChange={(event) => setAdvantage(event.target.checked)} />{t('dice.advantage')}</label><label><input type="checkbox" checked={disadvantage} onChange={(event) => setDisadvantage(event.target.checked)} />{t('dice.disadvantage')}</label></div>
      <button disabled={disabled || Boolean(pending)}>{t('dice.rollD20')}</button>
    </form>
    <div className="roll-history" aria-live="polite">{history.items.map((record) => <RollDetails key={record.id} record={record} />)}</div>
    <Pager label={t('dice.title')} page={history.page} pages={history.pages} onPage={history.setPage} />
  </section>;
}
