import { useTranslation } from 'react-i18next';
import type { ActionEffect, ActionOutcome, ActionPreview } from '#shared/combat';
import type { Id } from '#shared/contracts';

const signed = (value: number) => (value >= 0 ? `+${value}` : `${value}`);

export function PreviewDetails({ preview, nameOf }: { preview: ActionPreview; nameOf: (id: Id) => string }) {
  const { t } = useTranslation();
  const costs = [t(`actions.costKind.${preview.cost.turn}`)];
  if (preview.cost.slot) costs.push(t('actions.slotCost', { level: preview.cost.slot.level }));
  if (preview.cost.legendary) costs.push(t('actions.legendaryCost', { count: preview.cost.legendary }));
  return <div className="action-preview" aria-live="polite">
    <h3>{t('actions.preview')}</h3>
    <p><span className="badge">{t(`actions.automation.${preview.automation}`)}</span></p>
    <p>{t('actions.cost', { cost: costs.join(' · ') })}</p>
    {preview.rolls.length ? <ul>{preview.rolls.map((roll, index) => <li key={index}>{roll.kind === 'attack'
      ? (roll.ac === null ? t('actions.rollAttack', { modifier: signed(roll.modifier), target: nameOf(roll.targetId) }) : t('actions.rollAttackAc', { modifier: signed(roll.modifier), target: nameOf(roll.targetId), ac: roll.ac }))
      : t('actions.rollSave', { target: nameOf(roll.targetId), ability: t(`actions.ability.${roll.ability}`), dc: roll.dc })}</li>)}</ul> : null}
    <ul>{preview.effects.map((effect, index) => <li key={index}><EffectText effect={effect} /></li>)}</ul>
    {preview.duration ? <p>{t('actions.duration', { duration: preview.duration })}</p> : null}
    {preview.trigger ? <p>{t('actions.trigger', { trigger: preview.trigger })}</p> : null}
    {preview.issues.length ? <div role="alert"><strong>{t('actions.issues')}</strong><ul>{preview.issues.map((code) => <li key={code}>{t(`actions.issue.${code}`)}</li>)}</ul></div> : null}
    {preview.prompts.length ? <div><strong>{t('actions.prompts')}</strong><ul>{preview.prompts.map((code) => <li key={code}>{t(`actions.prompt.${code}`)}</li>)}</ul></div> : null}
    <details><summary>{t('actions.ruleText')}</summary><p className="pre-wrap">{preview.text}</p></details>
  </div>;
}

export function EffectText({ effect }: { effect: ActionEffect }) {
  const { t } = useTranslation();
  if (effect.kind === 'damage') {
    const type = effect.type ? t(`vitals.damage.${effect.type}`) : '';
    const text = effect.average === null ? t('actions.effectDamage', { dice: effect.dice, type }) : t('actions.effectAverage', { dice: effect.dice, type, average: effect.average });
    return <>{text}{effect.onSave ? ` (${t(effect.onSave === 'half' ? 'actions.halfOnSave' : 'actions.noneOnSave')})` : ''}</>;
  }
  if (effect.kind === 'heal') return <>{t('actions.effectHeal', { dice: effect.dice, bonus: effect.bonus })}</>;
  if (effect.kind === 'concentration') return <>{t(effect.replaces ? 'actions.effectConcentrationReplaces' : 'actions.effectConcentration')}</>;
  if (effect.kind === 'pool') return <>{effect.remaining === null ? t('actions.effectPoolDm') : t('actions.effectPool', { count: effect.remaining })}</>;
  return <>{t('actions.effectManual')}</>;
}

/** Persisted numbers from the server; HP proposals are committed once through the resolution. */
export function OutcomeDetails({ outcome, nameOf }: { outcome: ActionOutcome; nameOf: (id: Id) => string }) {
  const { t } = useTranslation();
  return <div className="action-outcome" aria-live="polite">
    <h3>{t('actions.result')}</h3>
    <ul>
      {outcome.attacks.map((attack, index) => <li key={`a${index}`}>{t(attack.hit === null ? 'actions.hitUnknown' : attack.hit ? 'actions.hit' : 'actions.miss', { target: nameOf(attack.targetId), total: attack.roll.total })}</li>)}
      {outcome.saves.map((save, index) => <li key={`s${index}`}>{t(save.success === null ? 'actions.saveUnknown' : save.success ? 'actions.saveSuccess' : 'actions.saveFailure', { target: nameOf(save.targetId) })}</li>)}
      {outcome.damage.map((damage, index) => <li key={`d${index}`}>{t('actions.damageTotal', { total: damage.total, type: damage.type ? t(`vitals.damage.${damage.type}`) : '' })}</li>)}
      {outcome.heal ? <li>{t('actions.healTotal', { total: outcome.heal.total })}</li> : null}
    </ul>
    {outcome.proposed.length ? <ul>{outcome.proposed.map((effect, index) => <li key={index}>
      {t('actions.proposal', { target: nameOf(effect.targetId), amount: effect.input.amount, kind: t(`vitals.kind.${effect.input.kind}`) })}
      {effect.decision ? <span className="badge">{t('actions.needsDecision')}</span> : null}
    </li>)}</ul> : null}
    {outcome.proposed.length ? <p className="small muted">{t('resolutions.resolveHere')}</p> : null}
  </div>;
}
