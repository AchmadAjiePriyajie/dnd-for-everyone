import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { ActionOption, CombatantView, CombatView, RollAudience } from '#shared/combat';
import type { Id } from '#shared/contracts';
import { actionIcon } from '../../app/action-icons';
import { FantasyIcon } from '../../app/fantasy-icons';
import { ErrorMessage } from '../../app/ui';
import { OutcomeDetails, PreviewDetails } from './ActionDetails';
import type { ActionDraft } from './useActionDraft';

const GROUPS = ['action', 'bonus', 'reaction', 'legendary', 'free'] as const;
const RESOURCES = ['action', 'bonus', 'reaction'] as const;

/** Whether the turn resource an option needs is still there (an open Attack/Multiattack pool covers its attacks). */
function usable(actor: CombatantView, option: ActionOption): boolean {
  const budget = actor.budget;
  if (!budget) return false;
  const pool = actor.actions?.pool;
  if (option.cost === 'action' && option.kind !== 'multiattack' && pool && (pool.remaining === null || pool.remaining > 0) && (pool.names === null ? option.kind === 'weapon' : pool.names.includes(option.originalName))) return true;
  if (option.cost === 'action' || option.cost === 'bonus' || option.cost === 'reaction') return budget[option.cost] > 0;
  return true;
}

/**
 * Hotbar under the map: turn resources as symbols, actions as icon tiles grouped by cost. Tiles that cannot
 * be used now are dimmed; choosing a tile shows the server preview, and one button takes the action.
 */
export function ActionBar({ combat, actors, actor, onActorChange, draft, targetIds }: {
  combat: CombatView; actors: CombatantView[]; actor: CombatantView | undefined; onActorChange(id: Id): void; draft: ActionDraft; targetIds: Id[];
}) {
  const { t } = useTranslation();
  const id = useId();
  if (!actor) return null;
  const option = draft.option;
  const nameOf = (target: Id) => combat.combatants.find((c) => c.id === target)?.name ?? '';
  const groups = GROUPS.map((cost) => ({ cost, entries: draft.options.filter((entry) => entry.cost === cost) })).filter((group) => group.entries.length > 0);

  return <section className="card action-bar" aria-label={t('screen.actionBar')}>
    <div className="action-bar-head">
      {actors.length > 1 ? <span className="field-inline">
        <label htmlFor={`${id}-actor`}>{t('actions.actAs')}</label>
        <select id={`${id}-actor`} value={actor.id} onChange={(event) => onActorChange(event.target.value)}>
          {actors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </span> : <strong title={actor.name} className="actor-name">{actor.name}</strong>}
      <span className="turn-resources">
        {RESOURCES.map((resource) => {
          const state = actor.budget![resource] > 0 ? 'available' : 'spent';
          return <span key={resource} className={`resource resource-${resource} is-${state}`} role="img" aria-label={t('screen.resourceState', { resource: t(`combat.resource.${resource}`), state: t(`screen.${state}`) })} />;
        })}
        <span className="small">{t('screen.movement', { left: actor.budget!.movement, speed: actor.speedFeet ?? actor.budget!.movement })}</span>
      </span>
    </div>
    <ErrorMessage error={draft.error} />
    {draft.pending && !draft.busy ? <button type="button" disabled={!draft.connected} onClick={draft.retry}>{t('actions.retry')}</button> : null}
    <div className="action-groups">
      {groups.map((group) => <div key={group.cost} role="group" aria-label={t(`actions.costKind.${group.cost}`)} className="action-group">
        <span className="action-group-label">{t(`actions.costKind.${group.cost}`)}</span>
        <div className="action-tiles">
          {group.entries.map((entry) => {
            const off = draft.offline || !usable(actor, entry);
            return <button key={entry.id} type="button" className={`action-tile${draft.optionId === entry.id ? ' is-chosen' : ''}`} aria-disabled={off} aria-pressed={draft.optionId === entry.id}
              title={`${entry.name}${entry.spell && entry.spell.level > 0 ? ` · ${t('actions.slotCost', { level: entry.spell.level })}` : ''} · ${t(`actions.automation.${entry.automation}`)}`}
              onClick={() => { if (!off) draft.setOptionId(draft.optionId === entry.id ? '' : entry.id); }}>
              <FantasyIcon name={actionIcon(entry)} className="action-tile-icon" />
              <span className="action-tile-name">{entry.name}</span>
            </button>;
          })}
        </div>
      </div>)}
    </div>
    {option ? <div className="action-draft">
      <fieldset role="group" aria-label={t('actions.targets')} className="action-targets">
        <legend>{t('actions.targets')}</legend>
        {combat.combatants.map((target) => <label key={target.id} className="checkbox-label">
          <input type="checkbox" checked={targetIds.includes(target.id)} onChange={() => draft.toggleTarget(target.id)} />{target.name}
        </label>)}
      </fieldset>
      <div className="combat-setup">
        {option.spell && option.spell.level > 0 ? <>
          <label htmlFor={`${id}-slot`}>{t('actions.slot')}</label>
          <select id={`${id}-slot`} value={draft.slotLevel ?? option.spell.level} onChange={(event) => draft.setSlotLevel(Number(event.target.value))}>
            {Array.from({ length: 10 - option.spell.level }, (_, index) => option.spell!.level + index).map((level) => <option key={level} value={level}>{level}</option>)}
          </select>
          <label className="checkbox-label"><input type="checkbox" checked={draft.pact} onChange={(event) => draft.setPact(event.target.checked)} />{t('actions.pact')}</label>
        </> : null}
        {option.damage.some((damage) => damage.average !== null) ? <>
          <label htmlFor={`${id}-damage`}>{t('actions.damageMode')}</label>
          <select id={`${id}-damage`} value={draft.damageMode} onChange={(event) => draft.setDamageMode(event.target.value as 'roll' | 'average')}>
            <option value="roll">{t('actions.roll')}</option><option value="average">{t('actions.average')}</option>
          </select>
        </> : null}
        {option.attack ? <span className="combat-buttons">
          <label className="checkbox-label"><input type="checkbox" checked={draft.advantage} onChange={(event) => draft.setAdvantage(event.target.checked)} />{t('dice.advantage')}</label>
          <label className="checkbox-label"><input type="checkbox" checked={draft.disadvantage} onChange={(event) => draft.setDisadvantage(event.target.checked)} />{t('dice.disadvantage')}</label>
        </span> : null}
        <label htmlFor={`${id}-audience`}>{t('actions.audience')}</label>
        <select id={`${id}-audience`} value={draft.audience} onChange={(event) => draft.setAudience(event.target.value as RollAudience)}>
          <option value="public">{t('dice.public')}</option><option value="dm">{t('dice.private')}</option>
        </select>
      </div>
      {draft.checking && !draft.preview ? <p aria-busy="true">{t('actions.loading')}</p> : null}
      {draft.preview ? <PreviewDetails preview={draft.preview} nameOf={nameOf} /> : null}
      <button className="primary" type="button" disabled={draft.blocked} onClick={draft.confirm}>{t('actions.confirm')}</button>
    </div> : null}
    {draft.outcome ? <OutcomeDetails outcome={draft.outcome} nameOf={nameOf} /> : null}
  </section>;
}
