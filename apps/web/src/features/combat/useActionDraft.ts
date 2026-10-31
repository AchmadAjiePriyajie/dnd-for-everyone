import { useEffect, useMemo, useState } from 'react';
import type { ApiError } from '#shared/access';
import type { ActionInput, ActionOption, ActionOutcome, ActionPreview, CombatView, RollAudience } from '#shared/combat';
import type { CommandEnvelope } from '#shared/commands';
import type { Id, JsonValue, Locale } from '#shared/contracts';
import { api } from '../../app/api';
import { refreshRoom, sendCommand, useConnectionStatus } from '../../app/room-store';
import { toApiError } from '../../app/ui';

/**
 * Draft of one guided action: options of the actor, server preview (no cost) and one combat.act.
 * Targets are owned by the caller so the map, turn order and checkboxes share one selection.
 */
export function useActionDraft({ campaignId, combat, actorId, locale, targetIds, setTargetIds, disabled }: {
  campaignId: Id; combat: CombatView; actorId: Id | undefined; locale: Locale; targetIds: Id[]; setTargetIds(ids: Id[]): void; disabled: boolean;
}) {
  const connected = useConnectionStatus() === 'connected';
  const [options, setOptions] = useState<ActionOption[]>([]);
  const [optionId, setOptionIdState] = useState('');
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

  const setOptionId = (next: string) => { setOptionIdState(next); setSlotLevel(null); setPact(false); setOutcome(null); setError(null); };
  const toggleTarget = (id: Id) => setTargetIds(targetIds.includes(id) ? targetIds.filter((value) => value !== id) : [...targetIds, id]);
  const offline = disabled || busy || !connected || Boolean(pending);
  const blocked = offline || checking || !preview || preview.issues.length > 0;

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
  const retry = () => { if (pending && connected) void submit(pending); };

  return {
    options, option, optionId, setOptionId, targetIds, toggleTarget, slotLevel, setSlotLevel, pact, setPact, damageMode, setDamageMode,
    advantage, setAdvantage, disadvantage, setDisadvantage, audience, setAudience, preview, checking, confirm, pending, retry, busy,
    outcome, error, blocked, offline, connected,
  };
}
