import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { emptyDefenses, emptyVitals } from '#rules/damage';
import { CONDITIONS, DAMAGE_TYPES, type CombatantView, type CombatView, type DamageInput, type DamageType, type DefenseProfile, type RollAudience, type VitalState } from '#shared/combat';
import type { JsonValue } from '#shared/contracts';

type Run = (kind: string, payload?: JsonValue, revision?: number) => Promise<boolean>;
export function VitalsPanel({ creature, combat, isDm, disabled, run }: { creature: CombatantView; combat: CombatView; isDm: boolean; disabled: boolean; run: Run }) {
  const { t } = useTranslation();
  const id = useId();
  const [amount, setAmount] = useState('1');
  const [kind, setKind] = useState<DamageInput['kind']>('damage');
  const [damageType, setDamageType] = useState<DamageType>('bludgeoning');
  const [critical, setCritical] = useState(false);
  const [replaceTemp, setReplaceTemp] = useState(false);
  const [audience, setAudience] = useState<RollAudience>(creature.hidden ? 'dm' : 'public');
  const [draft, setDraft] = useState<VitalState | null>(null);
  const [hpVersion, setHpVersion] = useState<{ combat: number; source?: number } | null>(null);
  const [conditionsVersion, setConditionsVersion] = useState<{ combat: number; source?: number } | null>(null);
  const current = creature.vitals ?? emptyVitals(creature.characterId ? 'saves' : 'instant');
  const vitals = draft ?? current;
  const source = (snapshot: { source?: number } | null) => snapshot?.source ?? creature.characterRevision;
  const payload = (extra: Record<string, unknown>, snapshot: { source?: number } | null = null): JsonValue => ({ combatantId: creature.id, ...extra, ...(source(snapshot) === undefined ? {} : { sourceRevision: source(snapshot) }) }) as JsonValue;
  const beginEdit = () => setHpVersion((value) => value ?? { combat: combat.revision, source: creature.characterRevision });
  const update = (patch: Partial<VitalState>) => { setConditionsVersion((value) => value ?? { combat: combat.revision, source: creature.characterRevision }); setDraft((value) => ({ ...(value ?? current), ...patch })); };
  const resetConditions = () => { setConditionsVersion(null); setDraft(null); };
  const dying = creature.hp?.current === 0 && current.deathMode === 'saves' && !current.deathSaves.dead && !current.deathSaves.stable;
  return <section className="vitals-panel" aria-label={t('vitals.for', { name: creature.name })}>
    <p>{t('vitals.deathTally', { successes: current.deathSaves.successes, failures: current.deathSaves.failures })}{current.deathSaves.dead ? ` · ${t('vitals.dead')}` : current.deathSaves.stable ? ` · ${t('vitals.stable')}` : ''}</p>
    <p>{[...current.conditions, ...(current.zeroHpUnconscious && !current.conditions.includes('condition.unconscious') ? ['condition.unconscious'] : [])].map((condition) => t(`vitals.condition.${condition.split('.')[1]}`)).join(', ')}</p>
    {dying ? <div className="combat-buttons">
      <label htmlFor={`${id}-audience`}>{t('dice.audience')}</label><select id={`${id}-audience`} value={audience} onChange={(event) => setAudience(event.target.value as RollAudience)}><option value="public">{t('dice.public')}</option><option value="dm">{t('dice.private')}</option></select>
      <button disabled={disabled || combat.status !== 'active' || combat.activeId !== creature.id || (current.lastDeathSaveCombatId === combat.id && current.lastDeathSaveTurn === combat.turn)} onClick={() => void run('combat.death-save', payload({ audience }))}>{t('vitals.deathSave')}</button>
      {isDm ? <button disabled={disabled} onClick={() => void run('combat.stabilize', payload({}, null))}>{t('vitals.stabilize')}</button> : null}
    </div> : null}
    {isDm ? <details>
      <summary>{t('vitals.manage')}</summary>
      <form className="combat-setup" onSubmit={async (event) => {
        event.preventDefault();
        const input: DamageInput = kind === 'damage' ? { kind, amount: Number(amount), damageType, ...(critical ? { critical } : {}) } : kind === 'temp' ? { kind, amount: Number(amount), replaceTemp } : { kind, amount: Number(amount) };
        if (await run('combat.apply-hp', payload({ input }, hpVersion), hpVersion?.combat)) setHpVersion(null);
      }}>
        <label htmlFor={`${id}-kind`}>{t('vitals.change')}</label><select id={`${id}-kind`} value={kind} onChange={(event) => { beginEdit(); setKind(event.target.value as DamageInput['kind']); }}>{(['damage', 'heal', 'temp'] as const).map((value) => <option key={value} value={value}>{t(`vitals.kind.${value}`)}</option>)}</select>
        <label htmlFor={`${id}-amount`}>{t('vitals.amount')}</label><input id={`${id}-amount`} type="number" min="0" max="99999" step="1" required value={amount} onChange={(event) => { beginEdit(); setAmount(event.target.value); }} />
        {kind === 'damage' ? <>
          <label htmlFor={`${id}-type`}>{t('vitals.damageType')}</label><select id={`${id}-type`} value={damageType} onChange={(event) => { beginEdit(); setDamageType(event.target.value as DamageType); }}>{DAMAGE_TYPES.map((type) => <option key={type} value={type}>{t(`vitals.damage.${type}`)}</option>)}</select>
          <label><input type="checkbox" checked={critical} onChange={(event) => { beginEdit(); setCritical(event.target.checked); }} />{t('vitals.criticalDamage')}</label>
        </> : null}
        {kind === 'temp' ? <label><input type="checkbox" checked={replaceTemp} onChange={(event) => { beginEdit(); setReplaceTemp(event.target.checked); }} />{t('vitals.replaceTemp')}</label> : null}
        <button disabled={disabled}>{t('vitals.apply')}</button>
        {hpVersion ? <button type="button" onClick={() => { setHpVersion(null); setAmount('1'); }}>{t('vitals.reloadHp')}</button> : null}
      </form>
      <form className="combat-setup" onSubmit={async (event) => { event.preventDefault(); if (await run('combat.conditions', payload({ conditions: vitals.conditions, exhaustion: vitals.exhaustion, deathMode: vitals.deathMode, ...(draft?.defenses ? { defenses: draft.defenses } : {}) }, conditionsVersion), conditionsVersion?.combat)) resetConditions(); }}>
        <label htmlFor={`${id}-conditions`}>{t('vitals.conditions')}</label><select id={`${id}-conditions`} multiple size={5} value={vitals.conditions} onChange={(event) => update({ conditions: Array.from(event.target.selectedOptions, (option) => option.value) })}>{CONDITIONS.map((condition) => <option key={condition} value={condition}>{t(`vitals.condition.${condition.split('.')[1]}`)}</option>)}</select>
        <label htmlFor={`${id}-exhaustion`}>{t('vitals.exhaustion')}</label><input id={`${id}-exhaustion`} type="number" min="0" max="6" step="1" value={vitals.exhaustion} onChange={(event) => update({ exhaustion: Number(event.target.value) })} />
        {!creature.characterId ? <label><input type="checkbox" checked={vitals.deathMode === 'saves'} onChange={(event) => update({ deathMode: event.target.checked ? 'saves' : 'instant' })} />{t('vitals.monsterSaves')}</label> : null}
        <p className="small muted">{t('vitals.manualHelp')}</p>
        <details><summary>{t('vitals.defenses')}</summary>
          {(['resistances', 'vulnerabilities', 'immunities'] as const).map((field) => <label key={field}>{t(`vitals.${field}`)}<select multiple size={4} value={(vitals.defenses ?? emptyDefenses())[field]} onChange={(event) => update({ defenses: { ...(vitals.defenses ?? emptyDefenses()), [field]: Array.from(event.target.selectedOptions, (option) => option.value) as DefenseProfile[typeof field] } })}>{DAMAGE_TYPES.map((type) => <option key={type} value={type}>{t(`vitals.damage.${type}`)}</option>)}</select></label>)}
          <label>{t('vitals.conditionImmunities')}<select multiple size={4} value={vitals.defenses?.conditionImmunities ?? []} onChange={(event) => update({ defenses: { ...(vitals.defenses ?? emptyDefenses()), conditionImmunities: Array.from(event.target.selectedOptions, (option) => option.value) } })}>{CONDITIONS.map((condition) => <option key={condition} value={condition}>{t(`vitals.condition.${condition.split('.')[1]}`)}</option>)}</select></label>
        </details>
        <div className="combat-buttons"><button disabled={disabled || !draft}>{t('vitals.saveConditions')}</button>{draft || conditionsVersion ? <button type="button" onClick={resetConditions}>{t('vitals.reload')}</button> : null}</div>
      </form>
    </details> : null}
  </section>;
}
