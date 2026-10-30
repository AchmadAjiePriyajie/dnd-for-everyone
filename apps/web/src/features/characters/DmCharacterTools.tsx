import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ApiError, MemberView } from '#shared/access';
import { OVERRIDE_FIELDS, type OverrideField } from '#shared/characters';
import type { Id } from '#shared/contracts';
import { sendCommand, useConnectionStatus } from '../../app/room-store';
import { ErrorMessage, toApiError } from '../../app/ui';
import type { CharacterView } from './types';

/** Alat khusus DM: transfer kepemilikan eksplisit dan koreksi angka (nilai aturan tetap terlihat). */
export function DmCharacterTools({ view, members, campaignId, reload }: { view: CharacterView; members: MemberView[]; campaignId: Id; reload(): Promise<void> }) {
  const { t } = useTranslation();
  const id = useId();
  const connection = useConnectionStatus();
  const { character, derived } = view;
  const [owner, setOwner] = useState('');
  const [values, setValues] = useState<Partial<Record<OverrideField, string>>>(() =>
    Object.fromEntries(Object.entries(character.overrides).map(([field, value]) => [field, String(value)])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const send = async (commands: Array<{ kind: string; payload: Record<string, unknown> }>) => {
    setBusy(true);
    setError(null);
    try {
      for (const command of commands) {
        await sendCommand({ requestId: globalThis.crypto.randomUUID(), campaignId, targetId: character.id, kind: command.kind, payload: command.payload as never });
      }
      await reload();
    } catch (cause) {
      setError(toApiError(cause));
    } finally {
      setBusy(false);
    }
  };

  const changes = OVERRIDE_FIELDS.flatMap((field) => {
    const raw = values[field]?.trim() ?? '';
    const next = raw === '' ? null : Number(raw);
    const current = character.overrides[field] ?? null;
    return next === current || (next !== null && !Number.isInteger(next)) ? [] : [{ kind: 'character.set-override', payload: { field, value: next } }];
  });
  const disabled = busy || connection !== 'connected';

  return (
    <section className="card dm-tools" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>{t('character.dm.title')}</h2>
      <ErrorMessage error={error} />
      <div className="inline-field">
        <label htmlFor={`${id}-owner`}>{t('character.dm.newOwner')}</label>
        <select id={`${id}-owner`} value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="">—</option>
          {members
            .filter((member) => member.accountId !== character.ownerAccountId)
            .map((member) => (
              <option key={member.accountId} value={member.accountId}>
                {member.username}
              </option>
            ))}
        </select>
        <button type="button" disabled={disabled || !owner} onClick={() => void send([{ kind: 'character.transfer', payload: { toAccountId: owner } }])}>
          {t('character.dm.transfer')}
        </button>
      </div>
      <p className="muted small">{t('character.dm.overrideHelp')}</p>
      <div className="ability-assign">
        {OVERRIDE_FIELDS.map((field) => (
          <div key={field} className="inline-field">
            <label htmlFor={`${id}-${field}`}>{t(`character.stat.${field}`)}</label>
            <input
              id={`${id}-${field}`}
              type="number"
              inputMode="numeric"
              placeholder={String(derived[field].base)}
              value={values[field] ?? ''}
              onChange={(e) => setValues((current) => ({ ...current, [field]: e.target.value }))}
            />
          </div>
        ))}
      </div>
      <button type="button" disabled={disabled || changes.length === 0} onClick={() => void send(changes)}>
        {t('character.dm.saveOverrides')}
      </button>
    </section>
  );
}
