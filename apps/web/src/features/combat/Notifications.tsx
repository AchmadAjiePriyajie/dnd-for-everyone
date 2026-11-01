import { useTranslation } from 'react-i18next';
import type { CombatView, Resolution } from '#shared/combat';
import type { CommandEnvelope } from '#shared/commands';
import type { Id } from '#shared/contracts';

/** Things that need this viewer now (reactions offered to their creatures); shown above any tab. */
export function Notifications({ campaignId, combat, resolutions, accountId, isDm, disabled, send }: {
  campaignId: Id; combat: CombatView; resolutions: Resolution[]; accountId: Id; isDm: boolean; disabled: boolean; send(command: CommandEnvelope): Promise<boolean>;
}) {
  const { t } = useTranslation();
  const mine = (combatantId: Id) => { const creature = combat.combatants.find((c) => c.id === combatantId); return Boolean(creature && (creature.ownerAccountId === accountId || (isDm && !creature.characterId))); };
  const offers = resolutions.filter((r) => r.combatId === combat.id && r.phase === 'pending')
    .flatMap((resolution) => resolution.pendingReactions.filter((reaction) => reaction.status === 'offered' && mine(reaction.combatantId)).map((reaction) => ({ resolution, reaction })));
  if (offers.length === 0) return null;
  return <section className="card notifications" aria-label={t('screen.notifications')} aria-live="polite">
    {offers.map(({ resolution, reaction }) => <div key={`${resolution.id}:${reaction.combatantId}:${reaction.optionId}`} className="notice">
      <strong>{t('screen.reactionAvailable', { reaction: reaction.name })}</strong>
      {reaction.trigger ? <span className="small"> {reaction.trigger}</span> : null}
      <span className="combat-buttons">
        <button type="button" className="primary" disabled={disabled} onClick={() => void send({ requestId: globalThis.crypto.randomUUID(), campaignId, targetId: combat.id, kind: 'combat.act', expectedRevision: combat.revision,
          payload: { combatantId: reaction.combatantId, optionId: reaction.optionId, targetIds: [], respondsTo: resolution.id } })}>{t('resolutions.use', { reaction: reaction.name })}</button>
        <button type="button" disabled={disabled} onClick={() => void send({ requestId: globalThis.crypto.randomUUID(), campaignId, targetId: resolution.id, kind: 'resolution.decide', expectedRevision: resolution.revision,
          payload: { decision: 'decline', combatantId: reaction.combatantId } })}>{t('resolutions.decline')}</button>
      </span>
    </div>)}
  </section>;
}
