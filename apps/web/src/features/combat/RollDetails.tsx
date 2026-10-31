import { useTranslation } from 'react-i18next';
import type { ActionOutcome, RollRecord } from '#shared/combat';

/** Render persisted numeric outcomes, never roll again when locale or props change. */
export function RollDetails({ record }: { record: RollRecord }) {
  const { t } = useTranslation();
  if (record.kind === 'action') {
    const outcome = record.result as ActionOutcome;
    return <article className="roll-details" aria-label={t('dice.details')}>
      <strong>{outcome.preview.name}</strong>
      <span className="badge">{record.audience === 'dm' ? t('dice.private') : t('dice.public')}</span>
      <p className="small">{t(`actions.automation.${outcome.preview.automation}`)}</p>
      <ul>
        {outcome.attacks.map((attack, index) => <li key={`a${index}`}>{t('dice.kind.attack')}: {attack.roll.total}{attack.hit === null ? '' : ` · ${t(attack.hit ? 'dice.success' : 'dice.failure')}`}</li>)}
        {outcome.damage.map((damage, index) => <li key={`d${index}`}>{t('actions.damageTotal', { total: damage.total, type: damage.type ? t(`vitals.damage.${damage.type}`) : '' })}</li>)}
        {outcome.heal ? <li>{t('actions.healTotal', { total: outcome.heal.total })}</li> : null}
      </ul>
    </article>;
  }
  const result = record.result as Exclude<RollRecord['result'], ActionOutcome>;
  return <article className="roll-details" aria-label={t('dice.details')}>
    <strong>{t('dice.total', { total: result.total })}</strong>
    <span className="badge">{record.audience === 'dm' ? t('dice.private') : t('dice.public')}</span>
    {'expression' in result ? <>
      <p className="mono">{result.expression}</p>
      <ul>{result.dice.map((die, index) => <li key={index}>{die.sign < 0 ? '−' : '+'} {die.rolls.length}d{die.sides}: {die.rolls.join(', ')}</li>)}</ul>
    </> : <p>{t(`dice.kind.${result.kind}`)} · {t('dice.kept', { rolls: result.rolls.join(', '), kept: result.kept })}</p>}
    <p>{t('dice.modifierValue', { modifier: result.modifier })}</p>
    {result.critical ? <p>{t('dice.criticalResult')}</p> : null}
    {'success' in result && result.success !== undefined ? <p>{t(result.success ? 'dice.success' : 'dice.failure')}</p> : null}
  </article>;
}
