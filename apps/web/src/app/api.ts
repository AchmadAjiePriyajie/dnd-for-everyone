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
import type { ReferenceEntryView, SearchHit } from '#shared/reference';
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
