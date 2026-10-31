import { useTranslation } from 'react-i18next';
import type { RollRecord } from '#shared/combat';

/** Render persisted numeric outcomes, never roll again when locale or props change. */
export function RollDetails({ record }: { record: RollRecord }) {
  const { t } = useTranslation();
  const result = record.result;
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
