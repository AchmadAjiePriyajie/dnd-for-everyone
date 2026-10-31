import { z } from 'zod';
import type { Id, Locale } from './contracts.js';

export type Role = 'dm' | 'player';

export interface Principal {
  accountId: Id;
}

export interface Member {
  campaignId: Id;
  accountId: Id;
  role: Role;
}

/** Error API netral bahasa: client menerjemahkan `code` dengan `params`. */
export interface ApiError {
  code: string;
  params: Record<string, string | number>;
}

export const ErrorCodes = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  FORBIDDEN: 'FORBIDDEN',
  ORIGIN_REJECTED: 'ORIGIN_REJECTED',
  BOOTSTRAP_CLOSED: 'BOOTSTRAP_CLOSED',
  INVITE_INVALID: 'INVITE_INVALID',
  USERNAME_TAKEN: 'USERNAME_TAKEN',
  CANNOT_REMOVE_DM: 'CANNOT_REMOVE_DM',
  MEMBER_NOT_FOUND: 'MEMBER_NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  UNKNOWN_COMMAND: 'UNKNOWN_COMMAND',
  REQUEST_ID_REUSED: 'REQUEST_ID_REUSED',
  STALE_REVISION: 'STALE_REVISION',
  NOT_FOUND: 'NOT_FOUND',
  CHARACTER_EXISTS: 'CHARACTER_EXISTS',
  CHARACTER_INCOMPLETE: 'CHARACTER_INCOMPLETE',
  CHARACTER_FINAL: 'CHARACTER_FINAL',
  ALREADY_ROLLED: 'ALREADY_ROLLED',
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
  CHARACTER_NOT_FINAL: 'CHARACTER_NOT_FINAL',
  FEATURE_NOT_OWNED: 'FEATURE_NOT_OWNED',
  FEATURE_NOT_TRACKED: 'FEATURE_NOT_TRACKED',
  NO_USES_LEFT: 'NO_USES_LEFT',
  AMOUNT_NOT_ALLOWED: 'AMOUNT_NOT_ALLOWED',
  ALREADY_INSPIRED: 'ALREADY_INSPIRED',
  MASTERY_INVALID: 'MASTERY_INVALID',
  MASTERY_CHANGE_NEEDS_REST: 'MASTERY_CHANGE_NEEDS_REST',
  INVENTORY_NEGATIVE: 'INVENTORY_NEGATIVE',
  COINS_NEGATIVE: 'COINS_NEGATIVE',
  ENTRY_NOT_FOUND: 'ENTRY_NOT_FOUND',
  ATTUNEMENT_LIMIT: 'ATTUNEMENT_LIMIT',
  ATTUNEMENT_NOT_REQUIRED: 'ATTUNEMENT_NOT_REQUIRED',
  ATTUNEMENT_CLASS: 'ATTUNEMENT_CLASS',
  LOADOUT_INVALID: 'LOADOUT_INVALID',
  SPELLS_INVALID: 'SPELLS_INVALID',
  NO_SLOT_LEFT: 'NO_SLOT_LEFT',
  NOT_CONCENTRATION: 'NOT_CONCENTRATION',
  SPELL_NOT_PREPARED: 'SPELL_NOT_PREPARED',
  REST_NEEDS_HP: 'REST_NEEDS_HP',
  REST_NEEDS_DM: 'REST_NEEDS_DM',
  NO_HIT_DICE: 'NO_HIT_DICE',
  HP_INVALID: 'HP_INVALID',
  LEVEL_UP_NOT_AVAILABLE: 'LEVEL_UP_NOT_AVAILABLE',
  REVISION_REQUIRED: 'REVISION_REQUIRED',
  NOTE_LINK_INVALID: 'NOTE_LINK_INVALID',
  HOMEBREW_INVALID: 'HOMEBREW_INVALID',
  HOMEBREW_FORMULA: 'HOMEBREW_FORMULA',
  MONSTER_UNAVAILABLE: 'MONSTER_UNAVAILABLE',
  ADVANCEMENT_INVALID: 'ADVANCEMENT_INVALID',
  ADVANCEMENT_INCOMPLETE: 'ADVANCEMENT_INCOMPLETE',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export const usernameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_.-]{3,32}$/);
export const passwordSchema = z.string().min(8).max(256);
export const localeSchema = z.enum(['en', 'id']);
export const inviteCodeSchema = z.string().trim().min(1).max(128);

export const credentialsBody = z.strictObject({ username: usernameSchema, password: passwordSchema });
export const loginBody = z.strictObject({ username: z.string().trim().min(1).max(64), password: z.string().min(1).max(256) });
export const registerBody = z.strictObject({
  invite: inviteCodeSchema,
  username: usernameSchema,
  password: passwordSchema,
});
export const joinBody = z.strictObject({ invite: inviteCodeSchema });
export const localeBody = z.strictObject({ locale: localeSchema });
export const createCampaignBody = z.strictObject({ title: z.string().trim().min(1).max(120) });

export interface AuthState {
  bootstrapRequired: boolean;
  authenticated: boolean;
}

export interface AccountView {
  accountId: Id;
  username: string;
  locale: Locale | null;
}

export interface CampaignSummary {
  id: Id;
  title: string;
  ruleset: string;
  role: Role;
  dmAccountId: Id;
}

export interface MemberView {
  accountId: Id;
  username: string;
  role: Role;
}

export interface InviteView {
  id: Id;
  createdAt: string;
  revoked: boolean;
}

/** Kode undangan hanya dikembalikan sekali saat dibuat; server menyimpan hash-nya. */
export interface CreatedInvite extends InviteView {
  code: string;
}
