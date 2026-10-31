import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ApiError } from '#shared/access';
import type { ActionEffect, ActionInput, ActionOption, ActionOutcome, ActionPreview, CombatantView, CombatView, ProposedEffect, RollAudience } from '#shared/combat';
import type { CommandEnvelope } from '#shared/commands';
import type { Id, JsonValue, Locale } from '#shared/contracts';
import { api } from '../../app/api';
import { refreshRoom, sendCommand, useConnectionStatus } from '../../app/room-store';
import { ErrorMessage, toApiError } from '../../app/ui';

type RunCommand = (kind: string, payload?: JsonValue, revision?: number) => Promise<boolean>;
const signed = (value: number) => (value >= 0 ? `+${value}` : `${value}`);

/**
 * Guided action: choose an option, preview it on the server (no cost), then send one combat.act.
 * The server rebuilds the preview from its own state; HP changes come back as DM proposals.
 */
export function ActionWizard({ campaignId, combat, accountId, isDm, disabled, run }: {
  campaignId: Id; combat: CombatView; accountId: Id; isDm: boolean; disabled: boolean; run: RunCommand;
}) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const locale = i18n.language as Locale;
  const connected = useConnectionStatus() === 'connected';
  const actors = combat.combatants.filter((c) => c.budget && !c.defeated && (isDm || c.ownerAccountId === accountId));
  const fallback = actors.find((c) => c.id === combat.activeId) ?? actors[0];
  const [actorChoice, setActorChoice] = useState<Id | null>(null);
  const actor = actors.find((c) => c.id === actorChoice) ?? fallback;
  const [options, setOptions] = useState<ActionOption[]>([]);
  const [optionId, setOptionId] = useState('');
  const [targetIds, setTargetIds] = useState<Id[]>([]);
  const [slotLevel, setSlotLevel] = useState<number | null>(null);
  const [pact, setPact] = useState(false);
  const [damageMode, setDamageMode] = useState<'roll' | 'average'>('roll');
  const [advantage, setAdvantage] = useState(false);
  const [disadvantage, setDisadvantage] = useState(false);
  const [audience, setAudience] = useState<RollAudience>('public');
  const [preview, setPreview] = useState<ActionPreview | null>(null);
  const [checking, setChecking] = useState(false);
  const [pending, setPending] = useState<CommandEnvelope | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [outcome, setOutcome] = useState<ActionOutcome | null>(null);
  const actorId = actor?.id;
  const option = options.find((entry) => entry.id === optionId);

  useEffect(() => {
    if (!actorId) { setOptions([]); return; }
    let cancelled = false;
    api.actionOptions(campaignId, combat.id, actorId, locale).then((list) => { if (!cancelled) setOptions(list); }, (cause) => { if (!cancelled) setError(toApiError(cause)); });
    return () => { cancelled = true; };
  }, [campaignId, combat.id, actorId, locale, combat.revision]);

  const input = useMemo((): ActionInput | null => {
    if (!actorId || !option) return null;
    return {
      combatantId: actorId, optionId: option.id, targetIds,
      ...(option.spell && option.spell.level > 0 ? { slotLevel: slotLevel ?? option.spell.level, ...(pact ? { pact: true } : {}) } : {}),
      ...(option.damage.some((damage) => damage.average !== null) ? { damageMode } : {}),
      ...(option.attack && advantage ? { advantage: true } : {}), ...(option.attack && disadvantage ? { disadvantage: true } : {}),
      audience,
    };
  }, [actorId, option, targetIds, slotLevel, pact, damageMode, advantage, disadvantage, audience]);

  useEffect(() => {
    if (!input) { setPreview(null); return; }
    let cancelled = false;
    setChecking(true);
    api.actionPreview(campaignId, combat.id, input, locale).then((result) => { if (!cancelled) { setPreview(result); setChecking(false); } },
      (cause) => { if (!cancelled) { setPreview(null); setChecking(false); setError(toApiError(cause)); } });
    return () => { cancelled = true; };
  }, [campaignId, combat.id, input, locale, combat.revision]);

  if (!actor) return null;
  const nameOf = (target: Id) => combat.combatants.find((c) => c.id === target)?.name ?? '';
  const choose = (next: Id) => { setOptionId(next); setTargetIds([]); setSlotLevel(null); setPact(false); setOutcome(null); setError(null); };
  const blocked = disabled || busy || !connected || Boolean(pending) || checking || !preview || preview.issues.length > 0;

  const submit = async (command: CommandEnvelope) => {
    setBusy(true); setError(null); setPending(command);
    try {
      const response = await sendCommand(command);
      setOutcome((response.value as unknown as { outcome: ActionOutcome }).outcome);
      setPending(null);
      await refreshRoom(campaignId);
    } catch (cause) {
      const failure = toApiError(cause);
      setError(failure.code === 'OFFLINE' ? { code: 'COMMAND_UNCERTAIN', params: {} } : failure);
      if (failure.code !== 'OFFLINE') setPending(null);
    } finally { setBusy(false); }
  };
  const confirm = () => {
    if (!input || blocked) return;
    void submit({ requestId: globalThis.crypto.randomUUID(), campaignId, targetId: combat.id, kind: 'combat.act', payload: input as unknown as JsonValue, expectedRevision: combat.revision });
  };
  const groups = (['action', 'bonus', 'reaction', 'legendary', 'free'] as const).map((cost) => ({ cost, entries: options.filter((entry) => entry.cost === cost) })).filter((group) => group.entries.length > 0);

  return (
    <section className="card action-wizard" aria-label={t('actions.for', { name: actor.name })}>
      <h2>{t('actions.title')}</h2>
      <ErrorMessage error={error} />
      {pending && !busy ? <button type="button" disabled={!connected} onClick={() => void submit(pending)}>{t('actions.retry')}</button> : null}
      <div className="combat-setup">
        {actors.length > 1 ? <>
          <label htmlFor={`${id}-actor`}>{t('dice.actor')}</label>
          <select id={`${id}-actor`} value={actor.id} onChange={(event) => { setActorChoice(event.target.value); choose(''); }}>
            {actors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </> : null}
        <label htmlFor={`${id}-option`}>{t('actions.option')}</label>
        <select id={`${id}-option`} value={optionId} onChange={(event) => choose(event.target.value)}>
          <option value="">{t('actions.choose')}</option>
          {groups.map((group) => <optgroup key={group.cost} label={t(`actions.costKind.${group.cost}`)}>
            {group.entries.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}{entry.spell ? ` (${entry.spell.level})` : ''}</option>)}
          </optgroup>)}
        </select>
        {option ? <>
          <fieldset>
            <legend>{t('actions.targets')}</legend>
            {combat.combatants.length === 0 ? <p className="muted">{t('actions.noTargets')}</p> : combat.combatants.map((target) => (
              <label key={target.id} className="checkbox-label">
                <input type="checkbox" checked={targetIds.includes(target.id)} onChange={(event) => setTargetIds((current) => event.target.checked ? [...current, target.id] : current.filter((value) => value !== target.id))} />
                {target.name}
              </label>
            ))}
          </fieldset>
          {option.spell && option.spell.level > 0 ? <>
            <label htmlFor={`${id}-slot`}>{t('actions.slot')}</label>
            <select id={`${id}-slot`} value={slotLevel ?? option.spell.level} onChange={(event) => setSlotLevel(Number(event.target.value))}>
              {Array.from({ length: 10 - option.spell.level }, (_, index) => option.spell!.level + index).map((level) => <option key={level} value={level}>{level}</option>)}
            </select>
            <label className="checkbox-label"><input type="checkbox" checked={pact} onChange={(event) => setPact(event.target.checked)} />{t('actions.pact')}</label>
          </> : null}
          {option.damage.some((damage) => damage.average !== null) ? <>
            <label htmlFor={`${id}-damage`}>{t('actions.damageMode')}</label>
            <select id={`${id}-damage`} value={damageMode} onChange={(event) => setDamageMode(event.target.value as 'roll' | 'average')}>
              <option value="roll">{t('actions.roll')}</option><option value="average">{t('actions.average')}</option>
            </select>
          </> : null}
          {option.attack ? <div className="combat-buttons">
            <label className="checkbox-label"><input type="checkbox" checked={advantage} onChange={(event) => setAdvantage(event.target.checked)} />{t('dice.advantage')}</label>
            <label className="checkbox-label"><input type="checkbox" checked={disadvantage} onChange={(event) => setDisadvantage(event.target.checked)} />{t('dice.disadvantage')}</label>
          </div> : null}
          <label htmlFor={`${id}-audience`}>{t('actions.audience')}</label>
          <select id={`${id}-audience`} value={audience} onChange={(event) => setAudience(event.target.value as RollAudience)}>
            <option value="public">{t('dice.public')}</option><option value="dm">{t('dice.private')}</option>
          </select>
        </> : null}
      </div>
      {option && checking && !preview ? <p aria-busy="true">{t('actions.loading')}</p> : null}
      {option && preview ? <PreviewDetails preview={preview} nameOf={nameOf} /> : null}
      {option ? <button className="primary" type="button" disabled={blocked} onClick={confirm}>{t('actions.confirm')}</button> : null}
      {outcome ? <OutcomeDetails outcome={outcome} nameOf={nameOf} combat={combat} isDm={isDm} disabled={disabled} run={run} /> : null}
    </section>
  );
}

function PreviewDetails({ preview, nameOf }: { preview: ActionPreview; nameOf: (id: Id) => string }) {
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

function EffectText({ effect }: { effect: ActionEffect }) {
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

/** Persisted numbers from the server; the DM applies each proposal explicitly. */
function OutcomeDetails({ outcome, nameOf, combat, isDm, disabled, run }: {
  outcome: ActionOutcome; nameOf: (id: Id) => string; combat: CombatView; isDm: boolean; disabled: boolean; run: RunCommand;
}) {
  const { t } = useTranslation();
  const [applied, setApplied] = useState<number[]>([]);
  const target = (id: Id): CombatantView | undefined => combat.combatants.find((c) => c.id === id);
  const apply = async (effect: ProposedEffect, index: number) => {
    const creature = target(effect.targetId);
    const ok = await run('combat.apply-hp', { combatantId: effect.targetId, input: effect.input as unknown as JsonValue, ...(creature?.characterId && creature.characterRevision !== undefined ? { sourceRevision: creature.characterRevision } : {}) });
    if (ok) setApplied((current) => [...current, index]);
  };
  return <div className="action-outcome" aria-live="polite">
    <h3>{t('actions.result')}</h3>
    <ul>
      {outcome.attacks.map((attack, index) => <li key={`a${index}`}>{t(attack.hit === null ? 'actions.hitUnknown' : attack.hit ? 'actions.hit' : 'actions.miss', { target: nameOf(attack.targetId), total: attack.roll.total })}</li>)}
      {outcome.saves.map((save, index) => <li key={`s${index}`}>{t(save.success === null ? 'actions.saveUnknown' : save.success ? 'actions.saveSuccess' : 'actions.saveFailure', { target: nameOf(save.targetId) })}</li>)}
      {outcome.damage.map((damage, index) => <li key={`d${index}`}>{t('actions.damageTotal', { total: damage.total, type: damage.type ? t(`vitals.damage.${damage.type}`) : '' })}</li>)}
      {outcome.heal ? <li>{t('actions.healTotal', { total: outcome.heal.total })}</li> : null}
    </ul>
    {outcome.proposed.length ? <>
      <p className="small muted">{t('actions.applyHelp')}</p>
      <ul>{outcome.proposed.map((effect, index) => <li key={index}>
        {t('actions.proposal', { target: nameOf(effect.targetId), amount: effect.input.amount, kind: t(`vitals.kind.${effect.input.kind}`) })}
        {effect.decision ? <span className="badge">{t('actions.needsDecision')}</span> : null}
        {isDm ? <button type="button" disabled={disabled || applied.includes(index)} onClick={() => void apply(effect, index)}>{t('actions.apply', { target: nameOf(effect.targetId) })}</button> : null}
      </li>)}</ul>
    </> : null}
  </div>;
}
