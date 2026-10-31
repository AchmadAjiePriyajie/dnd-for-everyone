import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { CombatantView, CombatView } from '#shared/combat';
import type { Id } from '#shared/contracts';

const RESOURCES = ['action', 'bonus', 'reaction'] as const;

/** Compact state of one creature: HP meter or coarse standing, conditions, Concentration and turn resources. */
export function CombatantSummary({ creature }: { creature: CombatantView }) {
  const { t } = useTranslation();
  const conditions = creature.vitals?.conditions ?? creature.conditions ?? [];
  return <div className="combatant-summary">
    {creature.hp ? <div className="hp-line">
      <meter min={0} max={creature.hp.max} low={creature.hp.max / 2 + 0.01} high={creature.hp.max} optimum={creature.hp.max} value={creature.hp.current}
        aria-label={t('screen.hpMeter', { current: creature.hp.current, max: creature.hp.max })} />
      <span className="small">{t('combat.hp', { current: creature.hp.current, max: creature.hp.max, temp: creature.hp.temp })}</span>
    </div> : null}
    {creature.standing ? <span className={`badge standing-${creature.standing}`}>{t(`screen.standing.${creature.standing}`)}</span> : null}
    {conditions.length || creature.concentration ? <div className="chips">
      {conditions.map((condition) => <span key={condition} className="chip">{t(`vitals.condition.${condition.replace('condition.', '')}`)}</span>)}
      {creature.concentration ? <span className="chip chip-concentration">{t('screen.concentration')}</span> : null}
    </div> : null}
    {creature.budget ? <div className="turn-resources">
      {RESOURCES.map((resource) => {
        const state = creature.budget![resource] > 0 ? 'available' : 'spent';
        return <span key={resource} className={`resource resource-${resource} is-${state}`} role="img" aria-label={t('screen.resourceState', { resource: t(`combat.resource.${resource}`), state: t(`screen.${state}`) })} />;
      })}
      <span className="small muted">{t('screen.movement', { left: creature.budget.movement, speed: creature.speedFeet ?? creature.budget.movement })}</span>
    </div> : null}
  </div>;
}

/** Initiative list; DM/owner tools stay folded inside each row until opened. */
export function TurnOrder({ combat, selectedIds, onSelect, tools }: {
  combat: CombatView;
  selectedIds: Id[];
  onSelect(id: Id): void;
  tools(creature: CombatantView): ReactNode;
}) {
  const { t } = useTranslation();
  return <section className="turn-order card" aria-label={t('screen.turnOrder')}>
    <h2>{t('screen.turnOrder')} <span className="small muted">{t('combat.round', { round: combat.round })}</span></h2>
    {combat.combatants.length === 0 ? <p className="muted">{t('combat.empty')}</p> : null}
    <ol>
      {combat.combatants.map((creature) => {
        const active = combat.activeId === creature.id;
        return <li key={creature.id} aria-current={active ? 'step' : undefined}
          className={`turn-row${active ? ' is-active' : ''}${creature.defeated ? ' is-defeated' : ''}${selectedIds.includes(creature.id) ? ' is-selected' : ''}`}>
          <div className="turn-row-head">
            <span className="initiative" aria-label={t('combat.initiativeValue', { score: creature.initiative })}>{creature.initiative}</span>
            <button type="button" className="turn-name" title={creature.name} aria-pressed={selectedIds.includes(creature.id)} onClick={() => onSelect(creature.id)}>{creature.name}</button>
            {creature.hidden ? <span className="badge">{t('combat.hidden')}</span> : null}
            {creature.defeated ? <span className="badge">{t('combat.defeated')}</span> : null}
          </div>
          <CombatantSummary creature={creature} />
          {tools(creature)}
        </li>;
      })}
    </ol>
  </section>;
}
