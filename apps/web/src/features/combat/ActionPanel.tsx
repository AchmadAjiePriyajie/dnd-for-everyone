import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CombatantView, TurnResource } from '#shared/combat';
import { cannotAct, cannotMove } from '#rules/damage';

/** Budget buttons submit commands; only committed snapshots change displayed totals. */
export function ActionPanel({ creature, active, disabled, onSpend }: {
  creature: CombatantView; active: boolean; disabled: boolean;
  onSpend: (resource: TurnResource, amount?: number) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [feet, setFeet] = useState('5');
  const budget = creature.budget;
  if (!budget) return null;
  const actionDisabled = disabled || creature.defeated || Boolean(creature.hp && cannotAct({ hp: creature.hp, vitals: creature.vitals }));
  const movementDisabled = disabled || creature.defeated || Boolean(creature.hp && cannotMove({ hp: creature.hp, vitals: creature.vitals }));
  return (
    <fieldset className="combat-actions" aria-label={t('combat.actionsFor', { name: creature.name })}>
      <legend>{t('combat.actions')}</legend>
      <div className="combat-buttons">
        {(['action', 'bonus', 'reaction'] as const).map((resource) => (
          <span key={resource}>
            <span className="small muted">{t(`combat.resource.${resource}`)}: {budget[resource]}/1</span>
            <button type="button" disabled={actionDisabled || budget[resource] === 0 || (resource !== 'reaction' && !active)} onClick={() => onSpend(resource)}>
              {t(`combat.use.${resource}`)}
            </button>
          </span>
        ))}
      </div>
      <p className="small">{t('combat.movementLeft', { feet: budget.movement })}</p>
      <div className="combat-buttons">
        <label htmlFor={`${id}-feet`}>{t('combat.movementAmount')}</label>
        <input id={`${id}-feet`} type="number" min="1" max="9999" step="1" value={feet} onChange={(event) => setFeet(event.target.value)} />
        <button type="button" disabled={movementDisabled || !active || !Number.isInteger(Number(feet)) || Number(feet) < 1 || Number(feet) > budget.movement} onClick={() => onSpend('movement', Number(feet))}>
          {t('combat.use.movement')}
        </button>
      </div>
    </fieldset>
  );
}
