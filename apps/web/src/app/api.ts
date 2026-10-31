import type {
  AccountView,
  ApiError,
  AuthState,
  CampaignSummary,
  CreatedInvite,
  Member,
} from '#shared/access';
import type { CommandEnvelope, CommandResult } from '#shared/commands';
import type { Id, Locale } from '#shared/contracts';
import type { AdvancementChoice, AdvancementPreview, CharacterOptions, RestPreview } from '#shared/characters';
import type { EncounterView, HomebrewView, MonsterInstance } from '#shared/encounters';
import type { NoteView } from '#shared/notes';
import type { Asset, AssetVisibility, SceneView } from '#shared/scenes';
import type { ReferenceEntryView, SearchHit } from '#shared/reference';
import type { CharacterView } from '../features/characters/types';
import type { RoomSnapshot } from '#shared/room';

/** Error dari host atau jaringan; `error.code` diterjemahkan UI lewat `errors.<code>`. */
export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly error: ApiError,
  ) {
    super(error.code);
    this.name = 'ApiClientError';
  }
}

export const offlineError = (): ApiClientError => new ApiClientError(0, { code: 'OFFLINE', params: {} });

function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ApiError).code === 'string' &&
    typeof (value as ApiError).params === 'object'
  );
}

/** URL unduh asset; browser mengirim cookie sesi, server memeriksa membership dan visibility. */
export const assetUrl = (campaignId: Id, assetId: Id) => `${campaignPath(campaignId)}/assets/${encodeURIComponent(assetId)}`;

/** Upload biner mentah (bukan JSON); tipe file diperiksa ulang server dari isinya. */
async function upload<T>(path: string, file: Blob): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { accept: 'application/json', 'content-type': file.type }, body: file });
  } catch {
    throw offlineError();
  }
  const data: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new ApiClientError(response.status, isApiError(data) ? { code: data.code, params: data.params ?? {} } : { code: response.status === 413 ? 'PAYLOAD_TOO_LARGE' : 'INTERNAL', params: {} });
  }
  return data as T;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw offlineError();
  }
  const data: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new ApiClientError(
      response.status,
      isApiError(data) ? { code: data.code, params: data.params ?? {} } : { code: 'INTERNAL', params: {} },
    );
  }
  return data as T;
}

const campaignPath = (campaignId: Id) => `/api/campaigns/${encodeURIComponent(campaignId)}`;

const referenceQuery = (params: Record<string, string | undefined>) =>
  new URLSearchParams(Object.entries(params).filter((pair): pair is [string, string] => pair[1] !== undefined)).toString();

export const api = {
  authState: () => request<AuthState>('GET', '/api/auth/state'),
  me: () => request<AccountView>('GET', '/api/auth/me'),
  login: (username: string, password: string) => request<AccountView>('POST', '/api/auth/login', { username, password }),
  bootstrap: (username: string, password: string) =>
    request<AccountView>('POST', '/api/auth/bootstrap', { username, password }),
  register: (invite: string, username: string, password: string) =>
    request<AccountView>('POST', '/api/auth/register', { invite, username, password }),
  logout: () => request<{ ok: true }>('POST', '/api/auth/logout'),
  setLocale: (locale: Locale) => request<AccountView>('PUT', '/api/auth/me/locale', { locale }),

  campaigns: () => request<CampaignSummary[]>('GET', '/api/campaigns'),
  createCampaign: (title: string) => request<{ id: Id }>('POST', '/api/campaigns', { title }),
  joinCampaign: (invite: string) => request<Member>('POST', '/api/campaigns/join', { invite }),
  createInvite: (campaignId: Id) => request<CreatedInvite>('POST', `${campaignPath(campaignId)}/invites`),
  revokeInvite: (campaignId: Id, inviteId: Id) =>
    request<{ ok: true }>('DELETE', `${campaignPath(campaignId)}/invites/${encodeURIComponent(inviteId)}`),
  removeMember: (campaignId: Id, accountId: Id) =>
    request<{ ok: true }>('DELETE', `${campaignPath(campaignId)}/members/${encodeURIComponent(accountId)}`),

  characterOptions: (campaignId: Id, locale: Locale) =>
    request<CharacterOptions>('GET', `${campaignPath(campaignId)}/character-options?locale=${locale}`),
  character: (campaignId: Id, characterId: Id, locale: Locale) =>
    request<CharacterView>('GET', `${campaignPath(campaignId)}/characters/${encodeURIComponent(characterId)}?locale=${locale}`),
  monsters: (campaignId: Id, locale: Locale) => request<MonsterInstance[]>('GET', `${campaignPath(campaignId)}/monsters?locale=${locale}`),
  encounters: (campaignId: Id) => request<EncounterView[]>('GET', `${campaignPath(campaignId)}/encounters`),
  homebrew: (campaignId: Id) => request<HomebrewView[]>('GET', `${campaignPath(campaignId)}/homebrew`),
  scene: (campaignId: Id, sceneId: Id) => request<SceneView>('GET', `${campaignPath(campaignId)}/scenes/${encodeURIComponent(sceneId)}`),
  ping: (campaignId: Id, sceneId: Id, x: number, y: number) => request<void>('POST', `${campaignPath(campaignId)}/scenes/${encodeURIComponent(sceneId)}/ping`, { x, y }),
  assets: (campaignId: Id) => request<Asset[]>('GET', `${campaignPath(campaignId)}/assets`),
  uploadAsset: (campaignId: Id, file: Blob, name: string, visibility: AssetVisibility) =>
    upload<Asset>(`${campaignPath(campaignId)}/assets?${new URLSearchParams({ name, visibility })}`, file),
  note: (campaignId: Id, noteId: Id) => request<NoteView>('GET', `${campaignPath(campaignId)}/notes/${encodeURIComponent(noteId)}`),
  restPreview: (campaignId: Id, characterId: Id, rest: 'short' | 'long') =>
    request<RestPreview>('GET', `${campaignPath(campaignId)}/characters/${encodeURIComponent(characterId)}/rest-preview?rest=${rest}`),
  advancementPreview: (campaignId: Id, characterId: Id, choice: AdvancementChoice) =>
    request<AdvancementPreview>(
      'GET',
      `${campaignPath(campaignId)}/characters/${encodeURIComponent(characterId)}/advancement-preview?choice=${encodeURIComponent(JSON.stringify(choice))}`,
    ),
  referenceSearch: (q: string, locale: Locale, campaignId?: Id) =>
    request<SearchHit[]>('GET', `/api/reference/search?${referenceQuery({ q, locale, campaignId })}`),
  referenceEntry: (id: Id, locale: Locale, campaignId?: Id) =>
    request<ReferenceEntryView>('GET', `/api/reference/entries/${encodeURIComponent(id)}?${referenceQuery({ locale, campaignId })}`),
  bookmarks: () => request<Id[]>('GET', '/api/reference/bookmarks'),
  addBookmark: (id: Id) => request<void>('PUT', `/api/reference/bookmarks/${encodeURIComponent(id)}`),
  removeBookmark: (id: Id) => request<void>('DELETE', `/api/reference/bookmarks/${encodeURIComponent(id)}`),

  snapshot: (campaignId: Id) => request<RoomSnapshot>('GET', `${campaignPath(campaignId)}/snapshot`),
  command: (command: CommandEnvelope) =>
    request<CommandResult>('POST', `${campaignPath(command.campaignId)}/commands`, command),
};
