import type { AccountView, ApiError, CampaignSummary } from '#shared/access';
import {
  type CharacterDraft,
  type CharacterOptions,
  type DerivedCharacter,
  emptyDraft,
  emptyFeatureState,
  emptyResources,
  type CharacterResources,
  type RestPreview,
  type SpellcastingState,
  type AdvancementPreview,
  type AdvancementStatus,
  type FeatureState,
  type FeatureUse,
  HEROIC_INSPIRATION,
  type MasteryGrant,
} from '#shared/characters';
import type { NoteView } from '#shared/notes';
import type { ReferenceEntryView, SearchHit } from '#shared/reference';
import type { RoomSnapshot } from '#shared/room';

export interface FakeRequest {
  method: string;
  path: string;
  body: unknown;
}

export interface FakeServerState {
  bootstrapRequired: boolean;
  account: (AccountView & { password: string }) | null;
  authenticated: boolean;
  campaigns: CampaignSummary[];
  snapshots: Record<string, RoomSnapshot>;
  reference: {
    search: (q: string, locale: string, campaignId: string | null) => SearchHit[];
    entries: Record<string, ReferenceEntryView>;
    bookmarks: string[];
  };
  characterOptions: CharacterOptions | null;
  /** Derivasi palsu untuk test UI; aturan sebenarnya diuji di packages/rules. */
  deriveCharacter: ((draft: CharacterDraft) => DerivedCharacter) | null;
  characters: Record<string, FakeCharacterView>;
  /** Catatan yang dikembalikan GET notes/:id (sudah difilter seolah oleh server). */
  notes: Record<string, NoteView>;
  /** Jawaban khusus untuk command non-karakter; undefined = ack biasa. */
  onCommand?: (body: { kind: string; targetId: string; payload: unknown; expectedRevision?: number }) => Response | undefined;
}

export interface FakeCharacterView {
  character: {
    id: string;
    campaignId: string;
    ownerAccountId: string;
    status: 'draft' | 'final';
    classLevels: Array<{ classId: string; level: number }>;
    draft: CharacterDraft;
    rolls: Array<{ dice: number[]; total: number }>;
    overrides: Record<string, number>;
    featureState?: FeatureState;
    resources?: CharacterResources;
    revision: number;
    updatedAt: string;
  };
  derived: DerivedCharacter;
  features?: FeatureUse[];
  masteryGrants?: MasteryGrant[];
  spellcasting?: SpellcastingState;
  restPolicy?: 'dm' | 'players';
  /** Jawaban GET rest-preview. */
  restPreview?: RestPreview;
  advancement?: AdvancementStatus;
  /** Jawaban GET advancement-preview. */
  advancementPreview?: AdvancementPreview;
  allowedMethods: string[];
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const error = (status: number, code: string, params: ApiError['params'] = {}) => json(status, { code, params });

/** Server palsu di dalam proses untuk test komponen; meniru kontrak HTTP host. */
export function installFakeApi(initial: Partial<FakeServerState> = {}) {
  const state: FakeServerState = {
    bootstrapRequired: false,
    account: { accountId: 'acc-dm', username: 'dungeon_master', locale: null, password: 'correct horse battery' },
    authenticated: true,
    campaigns: [],
    snapshots: {},
    reference: { search: () => [], entries: {}, bookmarks: [] },
    characterOptions: null,
    deriveCharacter: null,
    characters: {},
    notes: {},
    ...initial,
  };
  const requests: FakeRequest[] = [];
  const view = (): AccountView => ({
    accountId: state.account!.accountId,
    username: state.account!.username,
    locale: state.account!.locale,
  });

  const handler = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.toString(), 'http://localhost');
    const method = (init.method ?? 'GET').toUpperCase();
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const path = url.pathname;
    requests.push({ method, path, body });

    if (path === '/api/auth/state') return json(200, { bootstrapRequired: state.bootstrapRequired, authenticated: state.authenticated });
    if (path === '/api/auth/login' && method === 'POST') {
      if (!state.account || body.password !== state.account.password) return error(401, 'INVALID_CREDENTIALS');
      state.authenticated = true;
      return json(200, view());
    }
    if (!state.authenticated) return error(401, 'UNAUTHENTICATED');
    if (path === '/api/auth/me') return json(200, view());
    if (path === '/api/auth/me/locale' && method === 'PUT') {
      state.account!.locale = body.locale;
      return json(200, view());
    }
    if (path === '/api/auth/logout') {
      state.authenticated = false;
      return json(200, { ok: true });
    }
    if (path === '/api/campaigns' && method === 'GET') return json(200, state.campaigns);
    if (path === '/api/campaigns' && method === 'POST') {
      const id = `camp-${state.campaigns.length + 1}`;
      state.campaigns.push({ id, title: body.title, ruleset: 'srd-5.2.1-2024', role: 'dm', dmAccountId: view().accountId });
      return json(201, { id });
    }
    if (path === '/api/reference/search') {
      const q = url.searchParams.get('q') ?? '';
      return json(200, q.trim() ? state.reference.search(q, url.searchParams.get('locale')!, url.searchParams.get('campaignId')) : []);
    }
    const entry = /^\/api\/reference\/entries\/([^/]+)$/.exec(path);
    if (entry) {
      const found = state.reference.entries[decodeURIComponent(entry[1]!)];
      return found ? json(200, found) : error(404, 'NOT_FOUND');
    }
    if (path === '/api/reference/bookmarks') return json(200, [...state.reference.bookmarks].sort());
    const bookmark = /^\/api\/reference\/bookmarks\/([^/]+)$/.exec(path);
    if (bookmark) {
      const id = decodeURIComponent(bookmark[1]!);
      state.reference.bookmarks = state.reference.bookmarks.filter((other) => other !== id);
      if (method === 'PUT') state.reference.bookmarks.push(id);
      return new Response(null, { status: 204 });
    }
    const snapshot = /^\/api\/campaigns\/([^/]+)\/snapshot$/.exec(path);
    if (snapshot) {
      const snap = state.snapshots[snapshot[1]!];
      return snap ? json(200, snap) : error(403, 'FORBIDDEN');
    }
    const options = /^\/api\/campaigns\/([^/]+)\/character-options$/.exec(path);
    if (options) return state.characterOptions ? json(200, state.characterOptions) : error(403, 'FORBIDDEN');
    const previewPath = /^\/api\/campaigns\/([^/]+)\/characters\/([^/]+)\/rest-preview$/.exec(path);
    if (previewPath) {
      const found = state.characters[decodeURIComponent(previewPath[2]!)];
      return found ? json(200, found.restPreview ?? { rest: url.searchParams.get('rest'), changes: [] }) : error(403, 'FORBIDDEN');
    }
    const advancementPath = /^\/api\/campaigns\/([^/]+)\/characters\/([^/]+)\/advancement-preview$/.exec(path);
    if (advancementPath) {
      const found = state.characters[decodeURIComponent(advancementPath[2]!)];
      return found?.advancementPreview ? json(200, { ...found.advancementPreview, choice: JSON.parse(url.searchParams.get('choice') ?? '{}') }) : error(403, 'FORBIDDEN');
    }
    const characterPath = /^\/api\/campaigns\/([^/]+)\/characters\/([^/]+)$/.exec(path);
    if (characterPath) {
      const found = state.characters[decodeURIComponent(characterPath[2]!)];
      if (!found) return error(403, 'FORBIDDEN');
      const spellcasting: SpellcastingState = { classes: [], spellbook: null, slots: [], pact: null, concentration: null, issues: [] };
      return json(200, {
        features: [],
        masteryGrants: [],
        spellcasting,
        restPolicy: 'dm',
        advancement: { mode: 'milestone', xp: 0, nextLevelXp: 300, levelsGranted: 0, startingLevel: 1, canAdvance: false },
        ...found,
        character: { featureState: emptyFeatureState(), resources: emptyResources(), advancements: [], pendingAdvancement: null, ...found.character },
      });
    }
    const commandPath = /^\/api\/campaigns\/([^/]+)\/commands$/.exec(path);
    if (commandPath && String(body?.kind).startsWith('character.')) {
      const campaignId = decodeURIComponent(commandPath[1]!);
      const id = body.targetId as string;
      const derive = state.deriveCharacter ?? (() => ({ issues: [] }) as unknown as DerivedCharacter);
      const result = (view: FakeCharacterView) => {
        view.character.revision += 1;
        return json(200, { targetId: id, entityRevision: view.character.revision, eventSequence: 1, value: { id } });
      };
      if (body.kind === 'character.create') {
        if (state.characters[id]) return error(409, 'CHARACTER_EXISTS');
        const draft = emptyDraft();
        state.characters[id] = {
          character: { id, campaignId, ownerAccountId: view().accountId, status: 'draft', classLevels: [], draft, rolls: [], overrides: {}, revision: 0, updatedAt: '' },
          derived: derive(draft),
          allowedMethods: state.characterOptions?.allowedMethods ?? [],
        };
        const snap = state.snapshots[campaignId];
        snap?.characters?.push({ id, ownerAccountId: view().accountId, name: '', status: 'draft', classId: null, speciesId: null, level: 1 });
        return result(state.characters[id]!);
      }
      const found = state.characters[id];
      if (!found) return error(403, 'FORBIDDEN');
      if (body.kind === 'character.save-draft') {
        if (found.character.status === 'final') return error(409, 'CHARACTER_FINAL');
        found.character.draft = body.payload.draft;
        found.derived = derive(found.character.draft);
        return result(found);
      }
      if (body.kind === 'character.transfer') {
        found.character.ownerAccountId = body.payload.toAccountId;
        return result(found);
      }
      if (body.kind === 'character.set-override') {
        if (body.payload.value === null) delete found.character.overrides[body.payload.field];
        else found.character.overrides[body.payload.field] = body.payload.value;
        return result(found);
      }
      if (body.kind === 'character.use-feature') {
        // Meniru server secara kasar: kurangi resource fitur (atau resource yang dibiayai).
        const use = found.features?.find((feature) => feature.key === body.payload.featureKey);
        const target = use?.cost ? found.features?.find((feature) => feature.key === use.cost!.resource) : use;
        const amount = use?.cost?.amount ?? body.payload.amount ?? 1;
        if (!target?.resource) return error(409, 'FEATURE_NOT_OWNED');
        if (target.resource.remaining < amount) return error(409, 'NO_USES_LEFT');
        target.resource.remaining -= amount;
        target.resource.spent += amount;
        if (target.key === HEROIC_INSPIRATION) found.character.featureState = { ...(found.character.featureState ?? emptyFeatureState()), heroicInspiration: false };
        return result(found);
      }
      if (body.kind === 'character.set-weapon-masteries') {
        found.character.featureState = { ...(found.character.featureState ?? emptyFeatureState()), weaponMasteries: body.payload.weapons };
        return result(found);
      }
      if (body.kind === 'character.finalize') {
        if (found.derived.issues.length) return error(422, 'CHARACTER_INCOMPLETE', { count: found.derived.issues.length });
        found.character.status = 'final';
        return result(found);
      }
      // Command karakter lain (resource, level up): cukup dicatat dan di-ack.
      return result(found);
    }
    const notePath = /^\/api\/campaigns\/([^/]+)\/notes\/([^/]+)$/.exec(path);
    if (notePath) {
      const found = state.notes[decodeURIComponent(notePath[2]!)];
      return found ? json(200, found) : error(403, 'FORBIDDEN');
    }
    if (/^\/api\/campaigns\/[^/]+\/commands$/.test(path)) {
      const custom = state.onCommand?.(body);
      if (custom) return custom;
      return json(200, { targetId: body.targetId, entityRevision: 1, eventSequence: 1, value: null });
    }
    return error(404, 'NOT_FOUND');
  };

  const original = globalThis.fetch;
  globalThis.fetch = handler as typeof fetch;
  return { state, requests, restore: () => (globalThis.fetch = original) };
}

type Handler = (...args: any[]) => void;

/** Socket palsu: `serverEmit` memicu handler client; `emit` dicatat dan bisa di-ack. */
export class FakeSocket {
  connected = false;
  readonly emitted: { event: string; payload: unknown }[] = [];
  private readonly handlers = new Map<string, Set<Handler>>();
  ackWith: (event: string, payload: unknown) => unknown = () => ({ ok: true, eventSequence: 0 });

  on(event: string, fn: Handler) {
    const set = this.handlers.get(event) ?? new Set();
    set.add(fn);
    this.handlers.set(event, set);
    return this;
  }
  off(event: string, fn: Handler) {
    this.handlers.get(event)?.delete(fn);
    return this;
  }
  emit(event: string, payload: unknown, ack?: (response: unknown) => void) {
    this.emitted.push({ event, payload });
    ack?.(this.ackWith(event, payload));
    return this;
  }
  disconnect() {
    this.serverEmit('disconnect', 'io client disconnect');
    return this;
  }
  serverEmit(event: string, ...args: unknown[]) {
    if (event === 'connect') this.connected = true;
    if (event === 'disconnect') this.connected = false;
    for (const fn of this.handlers.get(event) ?? []) fn(...args);
  }
}
