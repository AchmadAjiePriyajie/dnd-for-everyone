import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CombatView, PendingReaction, ProposedEffect, Resolution } from '#shared/combat';
import type { CommandEnvelope } from '#shared/commands';
import type { Id, JsonValue } from '#shared/contracts';

type Send = (command: CommandEnvelope) => Promise<boolean>;

/**
 * Durable resolutions from the snapshot. Every button is one command with the resolution (or combat)
 * revision; nothing changes locally until the server snapshot does, and all buttons wait while offline.
 */
export function ResolutionPanel({ campaignId, combat, resolutions, accountId, isDm, disabled, send }: {
  campaignId: Id; combat: CombatView; resolutions: Resolution[]; accountId: Id; isDm: boolean; disabled: boolean; send: Send;
}) {
  const { t } = useTranslation();
  const mine = resolutions.filter((r) => r.combatId === combat.id);
  const open = mine.filter((r) => r.phase === 'pending' || r.phase === 'awaitingDecision');
  const closed = mine.filter((r) => r.phase === 'resolved' || r.phase === 'cancelled').slice(-5).reverse();
  const nameOf = (id: Id) => combat.combatants.find((c) => c.id === id)?.name ?? '?';
  const decide = (resolution: Resolution, payload: JsonValue) => send({ requestId: globalThis.crypto.randomUUID(), campaignId, targetId: resolution.id, kind: 'resolution.decide', payload, expectedRevision: resolution.revision });
  const react = (resolution: Resolution, reaction: PendingReaction) => send({
    requestId: globalThis.crypto.randomUUID(), campaignId, targetId: combat.id, kind: 'combat.act', expectedRevision: combat.revision,
    payload: { combatantId: reaction.combatantId, optionId: reaction.optionId, targetIds: [], respondsTo: resolution.id },
  });
  if (mine.length === 0) return null;
  return <>
    {open.length ? <section className="card resolution-panel" aria-label={t('resolutions.open')}>
      <h2>{t('resolutions.open')}</h2>
      {open.map((resolution) => <article key={resolution.id} className="resolution">
        <h3>{t('resolutions.heading', { actor: nameOf(resolution.actorId), action: resolution.outcome.preview.name })}</h3>
        <p><span className="badge">{t(`resolutions.phase.${resolution.phase}`)}</span> <span className="small muted">{t(`actions.automation.${resolution.outcome.preview.automation}`)}</span></p>
        <ul>{resolution.outcome.attacks.map((attack, index) => <li key={index}>{t(attack.hit === null ? 'actions.hitUnknown' : attack.hit ? 'actions.hit' : 'actions.miss', { target: nameOf(attack.targetId), total: attack.roll.total })}</li>)}
          {resolution.outcome.saves.map((save, index) => <li key={`s${index}`}>{t(save.success === null ? 'actions.saveUnknown' : save.success ? 'actions.saveSuccess' : 'actions.saveFailure', { target: nameOf(save.targetId) })}</li>)}</ul>
        {resolution.pendingReactions.length ? <ul>{resolution.pendingReactions.map((reaction) => {
          const controls = isDm || combat.combatants.find((c) => c.id === reaction.combatantId)?.ownerAccountId === accountId;
          return <li key={`${reaction.combatantId}:${reaction.optionId}`}>
            {reaction.status === 'offered'
              ? t('resolutions.reactionOffer', { name: nameOf(reaction.combatantId), reaction: reaction.name, trigger: reaction.trigger ?? '' })
              : t(reaction.status === 'declared' ? 'resolutions.reactionDeclared' : 'resolutions.reactionDeclined', { name: nameOf(reaction.combatantId), reaction: reaction.name })}
            {reaction.status === 'offered' && controls ? <span className="combat-buttons">
              <button type="button" disabled={disabled} onClick={() => void react(resolution, reaction)}>{t('resolutions.use', { reaction: reaction.name })}</button>
              <button type="button" disabled={disabled} onClick={() => void decide(resolution, { decision: 'decline', combatantId: reaction.combatantId })}>{t('resolutions.decline')}</button>
            </span> : null}
          </li>;
        })}</ul> : null}
        {isDm ? <DmDecision resolution={resolution} nameOf={nameOf} disabled={disabled} decide={(payload) => decide(resolution, payload)} /> : <p className="small muted">{t('resolutions.dmDecides')}</p>}
      </article>)}
    </section> : null}
    {closed.length ? <section className="card resolution-panel" aria-label={t('resolutions.recent')}>
      <h2>{t('resolutions.recent')}</h2>
      {closed.map((resolution) => <ClosedResolution key={resolution.id} resolution={resolution} nameOf={nameOf} isDm={isDm} disabled={disabled} decide={(payload) => decide(resolution, payload)} />)}
    </section> : null}
  </>;
}

function amountLabel(t: (key: string, options?: Record<string, unknown>) => string, target: string, effect: ProposedEffect): string {
  if (effect.input.kind === 'damage') return t('resolutions.amountDamage', { target, type: t(`vitals.damage.${effect.input.damageType}`) });
  return t(effect.input.kind === 'heal' ? 'resolutions.amountHeal' : 'resolutions.amountTemp', { target });
}

function DmDecision({ resolution, nameOf, disabled, decide }: { resolution: Resolution; nameOf: (id: Id) => string; disabled: boolean; decide: (payload: JsonValue) => Promise<boolean> }) {
  const { t } = useTranslation();
  const id = useId();
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [excluded, setExcluded] = useState<number[]>([]);
  const [reason, setReason] = useState('');
  const [refund, setRefund] = useState(false);
  const offered = resolution.pendingReactions.some((r) => r.status === 'offered');
  const effects = resolution.proposed.map((effect, index) => ({ ...effect, input: { ...effect.input, amount: Number(amounts[index] ?? effect.input.amount) } })).filter((_, index) => !excluded.includes(index));
  const valid = effects.every((effect) => Number.isInteger(effect.input.amount) && effect.input.amount >= 0 && effect.input.amount <= 99999);
  return <div className="combat-setup">
    {resolution.proposed.map((effect, index) => {
      const label = amountLabel(t, nameOf(effect.targetId), effect);
      return <div className="field" key={index}>
        <label htmlFor={`${id}-${index}`}>{label}</label>
        <input id={`${id}-${index}`} type="number" min="0" max="99999" step="1" value={amounts[index] ?? String(effect.input.amount)} onChange={(event) => setAmounts((current) => ({ ...current, [index]: event.target.value }))} />
        {effect.decision ? <span className="badge">{t('actions.needsDecision')}</span> : null}
        <label className="checkbox-label"><input type="checkbox" checked={!excluded.includes(index)} onChange={(event) => setExcluded((current) => event.target.checked ? current.filter((value) => value !== index) : [...current, index])} />{t('resolutions.include', { label })}</label>
      </div>;
    })}
    <div className="combat-buttons">
      <button className="primary" type="button" disabled={disabled || !valid} onClick={() => void decide({ decision: 'commit', effects: effects as unknown as JsonValue, ...(offered ? { force: true } : {}) })}>
        {offered ? t('resolutions.forceCommit') : t('resolutions.commit')}
      </button>
    </div>
    <p className="small muted">{t('resolutions.noRefund')}</p>
    <label className="checkbox-label"><input type="checkbox" checked={refund} onChange={(event) => setRefund(event.target.checked)} />{t('resolutions.refund')}</label>
    <label htmlFor={`${id}-reason`}>{t('resolutions.reason')}</label>
    <input id={`${id}-reason`} value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
    <button type="button" className="danger" disabled={disabled || (refund && !reason.trim())}
      onClick={() => void decide({ decision: 'cancel', ...(refund ? { refund: true } : {}), ...(reason.trim() ? { reason: reason.trim() } : {}) })}>{t('resolutions.cancel')}</button>
  </div>;
}

function ClosedResolution({ resolution, nameOf, isDm, disabled, decide }: { resolution: Resolution; nameOf: (id: Id) => string; isDm: boolean; disabled: boolean; decide: (payload: JsonValue) => Promise<boolean> }) {
  const { t } = useTranslation();
  const id = useId();
  const [reason, setReason] = useState('');
  return <article className="resolution">
    <h3>{t('resolutions.heading', { actor: nameOf(resolution.actorId), action: resolution.outcome.preview.name })}</h3>
    <p><span className="badge">{t(`resolutions.phase.${resolution.phase}`)}</span></p>
    <ul>
      {resolution.pendingReactions.map((reaction) => <li key={`r${reaction.combatantId}:${reaction.optionId}`}>{t(reaction.status === 'declared' ? 'resolutions.reactionDeclared' : 'resolutions.reactionDeclined', { name: nameOf(reaction.combatantId), reaction: reaction.name })}</li>)}
      {resolution.committedEffects.map((effect, index) => <li key={index}>{t('resolutions.committed', { target: nameOf(effect.targetId), before: effect.before.current, after: effect.after.current })}</li>)}
      {resolution.concentrationChecks.map((check, index) => <li key={`c${index}`}>{t('resolutions.concentration', { target: nameOf(check.targetId), dc: check.dc })}</li>)}
      {resolution.refund ? <li>{t('resolutions.refunded', { reason: resolution.refund.reason })}</li> : null}
      {resolution.compensation ? <li>{t('resolutions.compensated', { reason: resolution.compensation.reason })}</li> : null}
    </ul>
    {isDm && resolution.phase === 'resolved' && !resolution.compensation && resolution.committedEffects.length ? <div className="combat-buttons">
      <label htmlFor={`${id}-reason`}>{t('resolutions.correctionReason')}</label>
      <input id={`${id}-reason`} value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
      <button type="button" disabled={disabled || !reason.trim()} onClick={() => void decide({ decision: 'compensate', reason: reason.trim() })}>{t('resolutions.compensate')}</button>
    </div> : null}
  </article>;
}
