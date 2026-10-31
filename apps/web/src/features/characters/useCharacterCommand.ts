import { useState } from 'react';
import type { ApiError } from '#shared/access';
import type { JsonValue } from '#shared/contracts';
import type { Id } from '#shared/contracts';
import type { CommandResult } from '#shared/commands';
import { sendCommand, useConnectionStatus } from '../../app/room-store';
import { toApiError } from '../../app/ui';

/**
 * Kirim command karakter lalu muat ulang sheet. `disabled` saat sibuk atau terputus:
 * aksi tidak diantrekan ketika koneksi hilang.
 */
export function useCharacterCommand(campaignId: Id, targetId: Id, reload: () => Promise<void>) {
  const connection = useConnectionStatus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const send = async (kind: string, payload: Record<string, unknown>, target: Id = targetId): Promise<CommandResult | null> => {
    setBusy(true);
    setError(null);
    try {
      const result = await sendCommand({ requestId: globalThis.crypto.randomUUID(), campaignId, targetId: target, kind, payload: payload as JsonValue });
      await reload();
      return result;
    } catch (cause) {
      setError(toApiError(cause));
      return null;
    } finally {
      setBusy(false);
    }
  };

  return { send, error, setError, disabled: busy || connection !== 'connected' };
}
