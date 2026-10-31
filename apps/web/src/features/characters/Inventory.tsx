import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type CharacterOptions, type Coin, COINS, type RestPreview } from '#shared/characters';
import type { Id } from '#shared/contracts';
import { api } from '../../app/api';
import { Icon } from '../../app/icons';
import { ErrorMessage, toApiError } from '../../app/ui';
import type { CharacterView } from './types';
import { useCharacterLabels } from './labels';
import { useCharacterCommand } from './useCharacterCommand';

const SHIELD_ID = 'equipment.shield';

interface Props {
  view: CharacterView;
  options: CharacterOptions;
  campaignId: Id;
  reload(): Promise<void>;
  /** Pemilik karakter final atau DM. */
  canEdit: boolean;
}

/** Inventory hidup karakter final: jumlah, koin, attunement dan armor/shield yang dipakai. */
export function Inventory({ view, options, campaignId, reload, canEdit }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const labels = useCharacterLabels(options.names);
  const { send, error, disabled } = useCharacterCommand(campaignId, view.character.id, reload);
  const { resources, draft } = view.character;
  const item = (itemId: Id | null) => (itemId ? options.items.find((candidate) => candidate.id === itemId) : undefined);
  const itemName = (itemId: Id | null, custom?: string) => (itemId ? (item(itemId)?.name ?? labels.name(itemId)) : t(`character.customItem.${custom}`, { defaultValue: custom }));
  const attunedCount = resources.inventory.filter((entry) => entry.attuned).length;
  const armorEntries = resources.inventory.filter((entry) => entry.itemId && entry.itemId !== SHIELD_ID && item(entry.itemId)?.mechanics.category === 'armor');
  const carriesShield = resources.inventory.some((entry) => entry.itemId === SHIELD_ID);

  return (
    <section className="card" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>
        <Icon name="ticket" />
        {t('character.inventory')}
      </h2>
      <ErrorMessage error={error} />
      <ul className="row-list">
        {resources.inventory.map((entry) => {
          const attunable = item(entry.itemId)?.mechanics.attunement === true;
          const name = itemName(entry.itemId, entry.custom);
          return (
            <li key={entry.entryId}>
              <span className="row-main">
                {name}
                {entry.note && <span className="muted small"> ({entry.note})</span>}
                {entry.attuned && <span className="badge badge-accent">{t('character.resources.attuned')}</span>}
              </span>
              <span className="row-value">×{entry.quantity}</span>
              {canEdit && (
                <span className="row-actions">
                  <button type="button" disabled={disabled} aria-label={t('character.resources.less', { name })} onClick={() => void send('character.adjust-item', { entryId: entry.entryId, delta: -1 })}>
                    −
                  </button>
                  <button type="button" disabled={disabled} aria-label={t('character.resources.more', { name })} onClick={() => void send('character.adjust-item', { entryId: entry.entryId, delta: 1 })}>
                    +
                  </button>
                  {attunable && (
                    <button type="button" disabled={disabled} onClick={() => void send('character.set-attunement', { entryId: entry.entryId, attuned: !entry.attuned })}>
                      {t(entry.attuned ? 'character.resources.endAttunement' : 'character.resources.attune')}
                    </button>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="hint">{t('character.resources.attunementCount', { count: attunedCount })}</p>

      <dl className="facts coins">
        {COINS.map((coin) => (
          <div key={coin}>
            <dt>{t(`character.resources.coin.${coin}`)}</dt>
            <dd className="mono">{resources.coins[coin]}</dd>
          </div>
        ))}
      </dl>

      {canEdit && (
        <>
          <CoinForm disabled={disabled} onSubmit={(coin, delta) => void send('character.adjust-coins', { coin, delta })} />
          <AddItemForm options={options} disabled={disabled} onAdd={(payload) => void send('character.add-item', payload)} />
          <div className="field-row">
            <div className="field">
              <label htmlFor={`${id}-armor`}>{t('character.resources.wornArmor')}</label>
              <select
                id={`${id}-armor`}
                value={draft.equippedArmorId ?? ''}
                disabled={disabled}
                onChange={(event) => void send('character.equip', { armorId: event.target.value || null, shield: draft.shieldEquipped })}
              >
                <option value="">{t('character.resources.noArmor')}</option>
                {armorEntries.map((entry) => (
                  <option key={entry.entryId} value={entry.itemId!}>
                    {itemName(entry.itemId)}
                  </option>
                ))}
              </select>
            </div>
            {carriesShield && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={draft.shieldEquipped}
                  disabled={disabled}
                  onChange={(event) => void send('character.equip', { armorId: draft.equippedArmorId, shield: event.target.checked })}
                />
                {t('character.resources.useShield')}
              </label>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function CoinForm({ disabled, onSubmit }: { disabled: boolean; onSubmit(coin: Coin, delta: number): void }) {
  const { t } = useTranslation();
  const id = useId();
  const [coin, setCoin] = useState<Coin>('gp');
  const [amount, setAmount] = useState('');
  const value = Number(amount);
  const valid = Number.isInteger(value) && value > 0;
  const submit = (sign: 1 | -1) => {
    onSubmit(coin, sign * value);
    setAmount('');
  };
  return (
    <div className="field-row">
      <div className="field">
        <label htmlFor={`${id}-coin`}>{t('character.resources.coinType')}</label>
        <select id={`${id}-coin`} value={coin} onChange={(event) => setCoin(event.target.value as Coin)}>
          {COINS.map((option) => (
            <option key={option} value={option}>
              {t(`character.resources.coin.${option}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${id}-amount`}>{t('character.resources.coinAmount')}</label>
        <input id={`${id}-amount`} type="number" min={1} value={amount} onChange={(event) => setAmount(event.target.value)} />
      </div>
      <button type="button" disabled={disabled || !valid} onClick={() => submit(1)}>
        {t('character.resources.receive')}
      </button>
      <button type="button" disabled={disabled || !valid} onClick={() => submit(-1)}>
        {t('character.resources.spend')}
      </button>
    </div>
  );
}

/** Tambah item corpus (dicocokkan dengan nama) atau item bebas. */
function AddItemForm({ options, disabled, onAdd }: { options: CharacterOptions; disabled: boolean; onAdd(payload: Record<string, unknown>): void }) {
  const { t } = useTranslation();
  const id = useId();
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const count = Number(quantity);
  const trimmed = name.trim();
  const match = options.items.find((item) => item.name.toLowerCase() === trimmed.toLowerCase() || item.originalName.toLowerCase() === trimmed.toLowerCase());
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!trimmed || !Number.isInteger(count) || count < 1) return;
    onAdd(match ? { itemId: match.id, quantity: count } : { custom: trimmed, quantity: count });
    setName('');
    setQuantity('1');
  };
  return (
    <form className="field-row" onSubmit={submit}>
      <div className="field">
        <label htmlFor={`${id}-item`}>{t('character.resources.addItem')}</label>
        <input id={`${id}-item`} list={`${id}-items`} value={name} onChange={(event) => setName(event.target.value)} aria-describedby={`${id}-hint`} />
        <datalist id={`${id}-items`}>
          {options.items.map((item) => (
            <option key={item.id} value={item.name} />
          ))}
        </datalist>
        <p id={`${id}-hint`} className="hint">
          {trimmed && !match ? t('character.resources.customHint') : t('character.resources.addHint')}
        </p>
      </div>
      <div className="field">
        <label htmlFor={`${id}-qty`}>{t('character.resources.quantity')}</label>
        <input id={`${id}-qty`} type="number" min={1} value={quantity} onChange={(event) => setQuantity(event.target.value)} />
      </div>
      <button type="submit" disabled={disabled || !trimmed}>
        <Icon name="plus" />
        {t('character.resources.add')}
      </button>
    </form>
  );
}

/** HP, Hit Point Dice dan rest dengan pratinjau sebelum dikonfirmasi. */
export function Vitals({ view, campaignId, reload, canEdit, isDm }: Omit<Props, 'options'> & { isDm: boolean }) {
  const { t } = useTranslation();
  const id = useId();
  const { send, error, setError, disabled } = useCharacterCommand(campaignId, view.character.id, reload);
  const { derived, character } = view;
  const [current, setCurrent] = useState(String(derived.currentHitPoints));
  const [temp, setTemp] = useState(String(derived.temporaryHitPoints));
  const [preview, setPreview] = useState<RestPreview | null>(null);
  const [dice, setDice] = useState<Record<Id, number>>({});
  const canRest = isDm || (canEdit && view.restPolicy === 'players');
  const hpValid = Number.isInteger(Number(current)) && Number(current) >= 0 && Number(current) <= derived.hitPoints.value && Number.isInteger(Number(temp)) && Number(temp) >= 0;

  const openPreview = async (rest: 'short' | 'long') => {
    setError(null);
    try {
      setPreview(await api.restPreview(campaignId, character.id, rest));
      setDice({});
    } catch (cause) {
      setError(toApiError(cause));
    }
  };
  const confirm = async () => {
    if (!preview) return;
    const hitDice = Object.fromEntries(Object.entries(dice).filter(([, count]) => count > 0));
    const result = await send('character.rest', preview.rest === 'short' && Object.keys(hitDice).length ? { rest: 'short', hitDice } : { rest: preview.rest });
    if (result) setPreview(null);
  };

  return (
    <section className="card" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>
        <Icon name="shield" />
        {t('character.resources.vitals')}
      </h2>
      <ErrorMessage error={error} />
      <p className="vitals-hp">
        <strong className="mono">{t('character.resources.hp', { current: derived.currentHitPoints, max: derived.hitPoints.value })}</strong>
        {derived.temporaryHitPoints > 0 && <span className="badge">{t('character.resources.tempHp', { temp: derived.temporaryHitPoints })}</span>}
      </p>
      <ul className="inline-list">
        {derived.hitDice.map((entry) => (
          <li key={entry.classId}>{t('character.resources.hitDice', { remaining: entry.max - entry.spent, max: entry.max, die: entry.die })}</li>
        ))}
      </ul>
      {canEdit && (
        <div className="field-row">
          <div className="field">
            <label htmlFor={`${id}-current`}>{t('character.resources.currentHp')}</label>
            <input id={`${id}-current`} type="number" min={0} max={derived.hitPoints.value} value={current} onChange={(event) => setCurrent(event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={`${id}-temp`}>{t('character.resources.tempHpLabel')}</label>
            <input id={`${id}-temp`} type="number" min={0} value={temp} onChange={(event) => setTemp(event.target.value)} />
          </div>
          <button type="button" disabled={disabled || !hpValid} onClick={() => void send('character.set-hp', { current: Number(current), temp: Number(temp) })}>
            {t('character.resources.saveHp')}
          </button>
        </div>
      )}

      {canRest ? (
        <p className="row-actions">
          <button type="button" disabled={disabled} onClick={() => void openPreview('short')}>
            {t('character.resources.shortRest')}
          </button>
          <button type="button" disabled={disabled} onClick={() => void openPreview('long')}>
            {t('character.resources.longRest')}
          </button>
        </p>
      ) : (
        <p className="hint">{t('character.resources.restByDm')}</p>
      )}
      {isDm && (
        <div className="field">
          <label htmlFor={`${id}-policy`}>{t('character.resources.restPolicy')}</label>
          <select id={`${id}-policy`} value={view.restPolicy} disabled={disabled} onChange={(event) => void send('campaign.set-rest-policy', { policy: event.target.value }, campaignId)}>
            <option value="dm">{t('character.resources.policy.dm')}</option>
            <option value="players">{t('character.resources.policy.players')}</option>
          </select>
        </div>
      )}

      {preview && (
        <div className="callout" role="group" aria-label={t(`character.resources.preview.${preview.rest}`)}>
          <h3>{t(`character.resources.preview.${preview.rest}`)}</h3>
          {preview.changes.length ? (
            <ul>
              {preview.changes.map((change) => (
                <li key={change.key}>
                  <RestChange name={change.key} view={view} /> {String(change.before)} → {String(change.after)}
                </li>
              ))}
            </ul>
          ) : (
            <p>{t('character.resources.noChanges')}</p>
          )}
          {preview.rest === 'short' &&
            derived.hitDice.map((entry) => {
              const left = entry.max - entry.spent;
              return (
                <div key={entry.classId} className="field inline-field">
                  <label htmlFor={`${id}-dice-${entry.classId}`}>{t('character.resources.spendDice', { die: entry.die })}</label>
                  <input
                    id={`${id}-dice-${entry.classId}`}
                    type="number"
                    min={0}
                    max={left}
                    value={dice[entry.classId] ?? 0}
                    onChange={(event) => setDice({ ...dice, [entry.classId]: Math.max(0, Math.min(left, Number(event.target.value) || 0)) })}
                  />
                </div>
              );
            })}
          <p className="row-actions">
            <button type="button" className="primary" disabled={disabled} onClick={() => void confirm()}>
              {t('character.resources.confirmRest')}
            </button>
            <button type="button" disabled={disabled} onClick={() => setPreview(null)}>
              {t('character.features.cancel')}
            </button>
          </p>
        </div>
      )}
    </section>
  );
}

/** Nama perubahan rest: fitur memakai namanya, slot/HP memakai label UI. */
function RestChange({ name, view }: { name: string; view: CharacterView }) {
  const { t } = useTranslation();
  const feature = view.features.find((candidate) => candidate.key === name);
  if (feature) return <span>{feature.name}:</span>;
  const [kind, detail] = name.split(':');
  return <span>{t(`character.resources.change.${kind}`, { level: detail })}:</span>;
}
