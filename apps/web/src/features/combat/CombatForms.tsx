import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CombatantView, CombatView, TurnBudget } from '#shared/combat';
import type { Id, JsonValue } from '#shared/contracts';
import type { MonsterInstance } from '#shared/encounters';
import type { Token } from '#shared/scenes';

export type RunCommand = (kind: string, payload?: JsonValue, revision?: number) => Promise<boolean>;
type Correction = { initiative?: number; tieOrder?: number; hpCurrent?: number; speedFeet?: number; hidden?: boolean; defeated?: boolean; budget?: TurnBudget };

/** DM correction form for one combatant (initiative, HP, speed, hidden/defeated, budget, token link). */
export function CombatantCorrection({ creature, combat, tokens, disabled, run }: { creature: CombatantView; combat: CombatView; tokens: Token[]; disabled: boolean; run: RunCommand }) {
  const { t } = useTranslation();
  const id = useId();
  const [patch, setPatch] = useState<Correction>({});
  const [reason, setReason] = useState('');
  const [hpSourceRevision, setHpSourceRevision] = useState<number | undefined>();
  const [tokenChoice, setTokenChoice] = useState<string | undefined>();
  const selectedToken = tokenChoice ?? creature.tokenId ?? '';
  const title = t('combat.adjust', { name: creature.name });
  const fields = [
    { key: 'initiative' as const, value: creature.initiative, min: -100, max: 999 },
    { key: 'tieOrder' as const, value: creature.tieOrder, min: 0, max: 9999 },
    { key: 'hpCurrent' as const, value: creature.hp?.current ?? 0, min: 0, max: creature.hp?.max ?? 99999 },
    { key: 'speedFeet' as const, value: creature.speedFeet ?? 0, min: 0, max: 9999 },
  ];
  return <details className="combat-correction">
    <summary>{title}</summary>
    <form aria-label={title} className="combat-setup" onSubmit={async (event) => {
      event.preventDefault();
      if (await run('combat.update', { combatantId: creature.id, patch, reason, ...(hpSourceRevision === undefined ? {} : { sourceRevision: hpSourceRevision }) })) { setPatch({}); setReason(''); setHpSourceRevision(undefined); }
    }}>
      {combat.sceneId ? <div className="field">
        <label htmlFor={`${id}-token`}>{t('combat.mapToken')}</label>
        <select id={`${id}-token`} value={selectedToken} onChange={(event) => setTokenChoice(event.target.value)}>
          <option value="">{t('combat.unlinked')}</option>
          {tokens.filter((token) => !combat.combatants.some((c) => c.id !== creature.id && c.tokenId === token.id)).map((token) => <option key={token.id} value={token.id}>{token.label}</option>)}
        </select>
        <button type="button" disabled={disabled || selectedToken === (creature.tokenId ?? '')} onClick={async () => {
          if (await run('combat.bind-token', { combatantId: creature.id, tokenId: selectedToken || null })) setTokenChoice(undefined);
        }}>{t('combat.linkToken')}</button>
      </div> : null}
      {fields.map((field) => <div className="field" key={field.key}>
        <label htmlFor={`${id}-${field.key}`}>{t(`combat.field.${field.key}`)}</label>
        <input id={`${id}-${field.key}`} type="number" min={field.min} max={field.max} step="1" value={patch[field.key] ?? field.value} onChange={(event) => {
          setPatch((current) => ({ ...current, [field.key]: Number(event.target.value) }));
          if (field.key === 'hpCurrent') setHpSourceRevision(creature.characterRevision);
        }} />
      </div>)}
      {(['hidden', 'defeated'] as const).map((field) => <label key={field} className="checkbox-label">
        <input type="checkbox" checked={patch[field] ?? creature[field] ?? false} onChange={(event) => setPatch((current) => ({ ...current, [field]: event.target.checked }))} />{t(`combat.${field}`)}
      </label>)}
      {creature.budget ? <fieldset><legend>{t('combat.correctBudget')}</legend><div className="combat-budget-inputs">
        {(['action', 'bonus', 'reaction', 'movement'] as const).map((resource) => <label key={resource}>
          {t(`combat.resource.${resource}`)}
          <input type="number" min="0" max={resource === 'movement' ? 9999 : 1} step="1" value={(patch.budget ?? creature.budget!)[resource]} onChange={(event) => setPatch((current) => ({ ...current, budget: { ...(current.budget ?? creature.budget!), [resource]: Number(event.target.value) } }))} />
        </label>)}
      </div></fieldset> : null}
      <label htmlFor={`${id}-reason`}>{t('combat.reason')}</label>
      <input id={`${id}-reason`} value={reason} maxLength={500} required onChange={(event) => setReason(event.target.value)} />
      <div className="combat-buttons">
        <button className="primary" disabled={disabled || !reason.trim() || Object.keys(patch).length === 0}>{t('combat.saveCorrection')}</button>
        <button type="button" disabled={disabled || !reason.trim() || creature.defeated || combat.status !== 'active'} onClick={() => void run('combat.set-turn', { combatantId: creature.id, reason })}>{t('combat.setTurn')}</button>
        <button type="button" className="danger" disabled={disabled} onClick={() => void run('combat.remove', { combatantId: creature.id })}>{t('combat.remove')}</button>
      </div>
    </form>
  </details>;
}

/** DM form adding characters or monsters to a running combat. */
export function ReinforcementForm({ monsters, characters, disabled, run }: {
  monsters: MonsterInstance[]; characters: Array<{ id: Id; name: string }>; disabled: boolean; run: RunCommand;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [source, setSource] = useState('');
  const [count, setCount] = useState('1');
  const [initiative, setInitiative] = useState('0');
  const [hidden, setHidden] = useState(false);
  const [hp, setHp] = useState<'average' | 'rolled'>('average');
  const isCharacter = source.startsWith('character:');
  return <section className="card"><h2>{t('combat.reinforce')}</h2>
    <form className="combat-setup" onSubmit={(event) => {
      event.preventDefault();
      void run('combat.reinforce', {
        ...(isCharacter ? { characterId: source.slice(10) } : { monsterId: source.slice(8), count: Number(count), hp }),
        initiative: Number(initiative), hidden,
      });
    }}>
      <label htmlFor={`${id}-source`}>{t('combat.creature')}</label>
      <select id={`${id}-source`} value={source} required onChange={(event) => setSource(event.target.value)}>
        <option value="">{t('combat.chooseCreature')}</option>
        {characters.map((character) => <option key={character.id} value={`character:${character.id}`}>{character.name}</option>)}
        {monsters.map((monster) => <option key={monster.id} value={`monster:${monster.id}`}>{monster.name}</option>)}
      </select>
      {!isCharacter ? <>
        <label htmlFor={`${id}-count`}>{t('combat.count')}</label>
        <input id={`${id}-count`} type="number" min="1" max="50" required value={count} onChange={(event) => setCount(event.target.value)} />
        <label htmlFor={`${id}-hp`}>{t('combat.hpMethod')}</label>
        <select id={`${id}-hp`} value={hp} onChange={(event) => setHp(event.target.value as 'average' | 'rolled')}>
          <option value="average">{t('combat.average')}</option><option value="rolled">{t('combat.rolled')}</option>
        </select>
      </> : null}
      <label htmlFor={`${id}-initiative`}>{t('combat.field.initiative')}</label>
      <input id={`${id}-initiative`} type="number" min="-100" max="999" required value={initiative} onChange={(event) => setInitiative(event.target.value)} />
      <label className="checkbox-label"><input type="checkbox" checked={hidden} onChange={(event) => setHidden(event.target.checked)} />{t('combat.hidden')}</label>
      <button disabled={disabled || !source}>{t('combat.reinforce')}</button>
    </form>
  </section>;
}
