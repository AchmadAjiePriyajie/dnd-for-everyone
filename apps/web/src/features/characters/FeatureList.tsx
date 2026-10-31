import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ApiError } from '#shared/access';
import { type CharacterOptions, type FeatureUse, HEROIC_INSPIRATION } from '#shared/characters';
import type { Id } from '#shared/contracts';
import { Icon } from '../../app/icons';
import { sendCommand, useConnectionStatus } from '../../app/room-store';
import { navigate, routePath } from '../../app/router';
import { ErrorMessage, toApiError } from '../../app/ui';
import { Markdown } from '../reference/Markdown';
import type { CharacterView } from './types';

interface Props {
  view: CharacterView;
  options: CharacterOptions;
  campaignId: Id;
  reload(): Promise<void>;
  /** Pemilik karakter final: boleh memakai fitur dan mengisi slot mastery kosong. */
  canUse: boolean;
  isDm: boolean;
}

/**
 * Fitur class/subclass, Weapon Mastery dan Heroic Inspiration. Pemakaian resource selalu
 * dikonfirmasi dulu; efek fitur diselesaikan di meja sesuai teks aturan yang ditampilkan.
 */
export function FeatureList({ view, options, campaignId, reload, canUse, isDm }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const connection = useConnectionStatus();
  const [pending, setPending] = useState<{ key: string; amount: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const { character, features } = view;
  const disabled = busy || connection !== 'connected';
  const featureName = (key: string) => features.find((feature) => feature.key === key)?.name ?? key;
  const refHref = (entryId: Id) => `${routePath.reference(campaignId)}?entry=${encodeURIComponent(entryId)}`;

  const send = async (kind: string, payload: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await sendCommand({ requestId: globalThis.crypto.randomUUID(), campaignId, targetId: character.id, kind, payload: payload as never });
      setPending(null);
      await reload();
    } catch (cause) {
      setError(toApiError(cause));
    } finally {
      setBusy(false);
    }
  };

  const inspiration = features.find((feature) => feature.key === HEROIC_INSPIRATION);
  const classFeatures = features.filter((feature) => feature.key !== HEROIC_INSPIRATION);

  return (
    <>
      <section className="card features-card" aria-labelledby={`${id}-heading`}>
        <h2 id={`${id}-heading`}>
          <Icon name="crown" />
          {t('character.features.title')}
        </h2>
        <p className="hint">{t('character.features.help')}</p>
        <ErrorMessage error={error} />

        {inspiration && (
          <div className="inspiration" role="group" aria-label={inspiration.name}>
            <span className={`prof-dot${inspiration.resource?.remaining ? ' is-on' : ''}`} aria-hidden="true" />
            <span className="row-main">
              <strong>{inspiration.name}</strong>{' '}
              <span className="muted small">{t(inspiration.resource?.remaining ? 'character.features.inspired' : 'character.features.notInspired')}</span>
            </span>
            {canUse && inspiration.resource?.remaining ? (
              <UseControls feature={inspiration} pending={pending} setPending={setPending} disabled={disabled} send={send} />
            ) : null}
            {isDm && !inspiration.resource?.remaining && (
              <button type="button" disabled={disabled} onClick={() => void send('character.grant-inspiration', {})}>
                <Icon name="plus" />
                {t('character.features.grantInspiration')}
              </button>
            )}
          </div>
        )}

        <ul className="feature-list">
          {classFeatures.map((feature) => (
            <li key={feature.key} className="feature">
              <div className="feature-head">
                <strong>{feature.name}</strong>
                {feature.name !== feature.originalName && <span className="muted small" lang="en">({feature.originalName})</span>}
                <span className="badge">{t('character.features.level', { level: feature.level })}</span>
                {feature.action && <span className="badge">{t(`character.features.action.${feature.action}`)}</span>}
                <span className={`badge${feature.automation === 'tracked' ? ' badge-accent' : ''}`}>{t(`character.features.automation.${feature.automation}`)}</span>
              </div>
              {feature.resource && (
                <p className="feature-resource">
                  <span className="mono">
                    {t(`character.features.remaining.${feature.resource.unit}`, { remaining: feature.resource.remaining, max: feature.resource.max })}
                  </span>
                  <span className="muted small">
                    {' · '}
                    {t('character.features.recovery', {
                      short: t(`character.features.recover.${feature.resource.recovery.short}`),
                      long: t(`character.features.recover.${feature.resource.recovery.long}`),
                    })}
                  </span>
                </p>
              )}
              {feature.cost && (
                <p className="feature-resource muted small">
                  {t('character.features.cost', { amount: feature.cost.amount, resource: featureName(feature.cost.resource) })}
                </p>
              )}
              <div className="feature-actions">
                {canUse && feature.automation === 'tracked' && (
                  <UseControls feature={feature} pending={pending} setPending={setPending} disabled={disabled} send={send} />
                )}
                {isDm && feature.resource && <DmSpent feature={feature} disabled={disabled} send={send} />}
              </div>
              <details>
                <summary>{t('character.features.rules')}</summary>
                <div className="feature-text">
                  <Markdown text={feature.text} refHref={refHref} onRef={(entryId) => navigate(refHref(entryId))} />
                </div>
              </details>
            </li>
          ))}
        </ul>
      </section>
      {view.masteryGrants.length > 0 && (
        <MasteryPicker
          key={character.featureState.weaponMasteries.join()}
          view={view}
          options={options}
          disabled={disabled}
          canEdit={canUse || isDm}
          isDm={isDm}
          send={send}
        />
      )}
    </>
  );
}

type Send = (kind: string, payload: Record<string, unknown>) => Promise<void>;

/** Tombol Pakai → konfirmasi (dengan jumlah untuk resource berupa poin). */
function UseControls({
  feature,
  pending,
  setPending,
  disabled,
  send,
}: {
  feature: FeatureUse;
  pending: { key: string; amount: string } | null;
  setPending(value: { key: string; amount: string } | null): void;
  disabled: boolean;
  send: Send;
}) {
  const { t } = useTranslation();
  const amountId = useId();
  const points = feature.resource?.unit === 'points';
  if (pending?.key !== feature.key) {
    const empty = feature.resource ? feature.resource.remaining === 0 : false;
    return (
      <button type="button" disabled={disabled || empty} onClick={() => setPending({ key: feature.key, amount: '1' })}>
        {t('character.features.use')}
      </button>
    );
  }
  const amount = Number(pending.amount);
  const valid = Number.isInteger(amount) && amount >= 1 && amount <= (feature.resource?.remaining ?? 1);
  return (
    <div className="confirm-row" role="group" aria-label={t('character.features.confirmTitle', { name: feature.name })}>
      {points && (
        <span className="field inline-field">
          <label htmlFor={amountId}>{t('character.features.amount')}</label>
          <input
            id={amountId}
            type="number"
            min={1}
            max={feature.resource?.remaining}
            value={pending.amount}
            onChange={(event) => setPending({ key: feature.key, amount: event.target.value })}
          />
        </span>
      )}
      <span className="small">{t('character.features.confirm', { name: feature.name })}</span>
      <button
        type="button"
        className="primary"
        disabled={disabled || !valid}
        onClick={() => void send('character.use-feature', { featureKey: feature.key, ...(points ? { amount } : {}) })}
      >
        {t('character.features.confirmUse')}
      </button>
      <button type="button" disabled={disabled} onClick={() => setPending(null)}>
        {t('character.features.cancel')}
      </button>
    </div>
  );
}

/** Koreksi DM: jumlah yang sudah terpakai. */
function DmSpent({ feature, disabled, send }: { feature: FeatureUse; disabled: boolean; send: Send }) {
  const { t } = useTranslation();
  const inputId = useId();
  const resource = feature.resource!;
  const [value, setValue] = useState(String(resource.spent));
  const next = Number(value);
  const valid = Number.isInteger(next) && next >= 0 && next <= resource.max && next !== resource.spent;
  return (
    <span className="field inline-field dm-inline">
      <label htmlFor={inputId}>{t('character.features.dmSpent')}</label>
      <input id={inputId} type="number" min={0} max={resource.max} value={value} onChange={(event) => setValue(event.target.value)} />
      <button type="button" disabled={disabled || !valid} onClick={() => void send('character.set-feature-spent', { featureKey: feature.key, spent: next })}>
        {t('character.features.dmSave')}
      </button>
    </span>
  );
}

/** Pilihan Weapon Mastery; aturan jenis senjata per class divalidasi server. */
function MasteryPicker({
  view,
  options,
  disabled,
  canEdit,
  isDm,
  send,
}: {
  view: CharacterView;
  options: CharacterOptions;
  disabled: boolean;
  canEdit: boolean;
  isDm: boolean;
  send: Send;
}) {
  const { t } = useTranslation();
  const id = useId();
  const saved = view.character.featureState.weaponMasteries;
  const [chosen, setChosen] = useState<Id[]>(saved);
  const total = view.masteryGrants.reduce((sum, grant) => sum + grant.count, 0);
  const name = (weaponId: Id) => options.names[weaponId] ?? options.masteryWeapons.find((weapon) => weapon.id === weaponId)?.name ?? weaponId;
  // Pemilik hanya boleh mengisi slot kosong pada karakter final; mengganti pilihan butuh Long Rest.
  const locked = (weaponId: Id) => !isDm && view.character.status === 'final' && saved.includes(weaponId);
  const changed = chosen.length !== saved.length || chosen.some((weaponId) => !saved.includes(weaponId));
  const toggle = (weaponId: Id) =>
    setChosen((current) => (current.includes(weaponId) ? current.filter((other) => other !== weaponId) : [...current, weaponId]));

  return (
    <section className="card" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>
        <Icon name="shield" />
        {t('character.mastery.title')}
      </h2>
      <p className="hint">
        {t('character.mastery.help', { count: total })}{' '}
        {view.masteryGrants.map((grant) => t(`character.mastery.restriction.${grant.restriction}`, { source: name(grant.sourceId), count: grant.count })).join(' ')}
      </p>
      <p>
        <strong>{t('character.mastery.chosen', { count: chosen.length, total })}</strong>
      </p>
      {canEdit ? (
        <fieldset className="choice-grid">
          <legend className="sr-only">{t('character.mastery.title')}</legend>
          {options.masteryWeapons.map((weapon) => {
            const checked = chosen.includes(weapon.id);
            return (
              <label key={weapon.id} className="choice">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled || locked(weapon.id) || (!checked && chosen.length >= total)}
                  onChange={() => toggle(weapon.id)}
                />
                <span className="choice-text">
                  <span className="choice-title">{weapon.name}</span>
                  <span className="muted small">{name(weapon.mechanics.mastery as Id)}</span>
                </span>
              </label>
            );
          })}
        </fieldset>
      ) : (
        <ul className="inline-list">
          {saved.map((weaponId) => (
            <li key={weaponId}>{name(weaponId)}</li>
          ))}
        </ul>
      )}
      {canEdit && (
        <p>
          <button type="button" className="primary" disabled={disabled || !changed} onClick={() => void send('character.set-weapon-masteries', { weapons: chosen })}>
            {t('character.mastery.save')}
          </button>
        </p>
      )}
    </section>
  );
}
