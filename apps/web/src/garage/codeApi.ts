import type {
  CreateBlueprintResponse,
  MyBlueprintsResponse,
  PublicBlueprintResponse,
  VehicleBlueprint,
} from '@bolt/shared';
import {
  buildHash,
  createBlueprintResponseSchema,
  myBlueprintsResponseSchema,
  publicBlueprintResponseSchema,
  sha256Hex,
} from '@bolt/shared';

/**
 * The client half of the car code endpoints (Section 15.7). Every response is parsed with the
 * shared schemas before it is used. Nothing here throws: a call resolves to a value or to a
 * reason the screens turn into approved copy. My Blueprints never waits on any of it to keep
 * a car; codes are an addition to the local library, not its storage.
 */

/**
 * The guest token's key in local storage. It belongs to `network/api.ts`, which does not export
 * it; `tests/unit/dbCodeClient.test.ts` keeps the two in step.
 */
export const GUEST_TOKEN_KEY = 'bolt.guest.v1';
/** Server records whose deletion has not reached the server yet (offline when deleted). */
export const PENDING_DELETES_KEY = 'bolt.codes.pending.v1';
const MAX_PENDING = 100;
const TIMEOUT_MS = 8000;

export type CodeFailure =
  | 'offline'
  | 'invalid'
  | 'not_found'
  | 'rate_limited'
  | 'outdated'
  | 'illegal'
  | 'unauthorized'
  | 'unavailable';

export type CodeResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      reason: CodeFailure;
      /** The server's own sentence, when it sent one. */ message?: string;
    };

type Fetcher = typeof fetch;

export type CodeClientDeps = {
  fetch?: Fetcher;
  /** Base URL of the game server (`serverOrigin` in the page, see `garage/codes.ts`). */
  origin: () => string;
  /** Resolves a usable guest token, creating a guest when there is none. */
  token: () => Promise<string>;
  storage?: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
};

function browserStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function failureFor(status: number, lookup: boolean): CodeFailure {
  if (status === 404) return 'not_found';
  if (status === 400) return lookup ? 'invalid' : 'illegal';
  if (status === 401) return 'unauthorized';
  if (status === 409) return 'outdated';
  if (status === 422) return 'illegal';
  if (status === 429) return 'rate_limited';
  return 'unavailable';
}

export function createCodeClient(deps: CodeClientDeps) {
  const doFetch: Fetcher = deps.fetch ?? ((...args) => fetch(...args));
  const origin = deps.origin;
  const storage = deps.storage ?? browserStorage;
  const freshToken = deps.token;
  let cached: Promise<string> | null = null;
  const token = (renew = false): Promise<string> => {
    if (renew || !cached) {
      cached = freshToken();
      cached.catch(() => {
        cached = null;
      });
    }
    return cached;
  };

  async function send<T>(
    path: string,
    init: RequestInit,
    parse: ((body: unknown) => T) | null,
    options: { auth: boolean; lookup?: boolean; bearer?: string },
  ): Promise<CodeResult<T>> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const headers = new Headers(init.headers);
        if (init.body !== undefined) headers.set('Content-Type', 'application/json');
        if (options.auth) {
          const bearer = options.bearer ?? (await token(attempt > 0));
          headers.set('Authorization', `Bearer ${bearer}`);
        }
        const response = await doFetch(`${origin()}${path}`, {
          ...init,
          headers,
          signal: controller.signal,
        });
        if (response.status === 401 && options.auth && !options.bearer && attempt === 0) continue;
        if (!response.ok) {
          let message: string | undefined;
          try {
            const body = (await response.json()) as { error?: { message?: unknown } };
            if (typeof body.error?.message === 'string') message = body.error.message.slice(0, 200);
          } catch {
            // No body worth reading.
          }
          return {
            ok: false,
            reason: failureFor(response.status, options.lookup ?? false),
            ...(message ? { message } : {}),
          };
        }
        if (!parse) return { ok: true, value: undefined as T };
        const parsed = parse(await response.json());
        return { ok: true, value: parsed };
      } catch {
        // Unreachable, timed out, or a response that is not what the contract says.
        return { ok: false, reason: 'offline' };
      } finally {
        clearTimeout(timer);
      }
    }
    return { ok: false, reason: 'unauthorized' };
  }

  const pending = (): string[] => {
    try {
      const raw = JSON.parse(storage()?.getItem(PENDING_DELETES_KEY) ?? '[]') as unknown;
      return Array.isArray(raw)
        ? raw.filter((id): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id))
        : [];
    } catch {
      return [];
    }
  };
  const writePending = (ids: string[]) => {
    try {
      const store = storage();
      if (!store) return;
      if (ids.length === 0) store.removeItem(PENDING_DELETES_KEY);
      else store.setItem(PENDING_DELETES_KEY, JSON.stringify(ids.slice(-MAX_PENDING)));
    } catch {
      // The deletion will be retried only while this page stays open.
    }
  };

  const client = {
    /** Validates, stores and issues a code. The same car and request id give the same code. */
    create(
      blueprint: VehicleBlueprint,
      requestId: string,
    ): Promise<CodeResult<CreateBlueprintResponse>> {
      return send(
        '/api/v1/blueprints',
        { method: 'POST', body: JSON.stringify({ requestId, blueprint }) },
        (body) => createBlueprintResponseSchema.parse(body),
        { auth: true },
      );
    },

    /** The public car behind a canonical code. */
    lookup(code: string): Promise<CodeResult<PublicBlueprintResponse>> {
      return send(
        `/api/v1/blueprints/${encodeURIComponent(code)}`,
        { method: 'GET' },
        (body) => publicBlueprintResponseSchema.parse(body),
        { auth: false, lookup: true },
      );
    },

    /** This guest's live codes on the server. Only asked when a guest already exists. */
    listMine(): Promise<CodeResult<MyBlueprintsResponse>> {
      const stored = storedGuestToken(storage);
      if (!stored) return Promise.resolve({ ok: true, value: { blueprints: [] } });
      return send(
        '/api/v1/me/blueprints',
        { method: 'GET' },
        (body) => myBlueprintsResponseSchema.parse(body),
        { auth: true },
      );
    },

    /**
     * Deletes one of this guest's codes. When the server cannot be reached the id is kept and
     * the deletion is sent with the next call that gets through, so a car deleted offline does
     * not leave its code working for ever.
     */
    async remove(id: string): Promise<CodeResult<void>> {
      const result = await send<void>(`/api/v1/me/blueprints/${id}`, { method: 'DELETE' }, null, {
        auth: true,
      });
      if (result.ok || result.reason === 'not_found') {
        writePending(pending().filter((p) => p !== id));
        return { ok: true, value: undefined };
      }
      if (result.reason === 'offline' || result.reason === 'unavailable')
        writePending([...pending().filter((p) => p !== id), id]);
      return result;
    },

    /** Sends deletions that could not be sent before. */
    async flushPending(): Promise<void> {
      for (const id of pending()) {
        const result = await send<void>(`/api/v1/me/blueprints/${id}`, { method: 'DELETE' }, null, {
          auth: true,
        });
        if (!result.ok && result.reason !== 'not_found') return;
        writePending(pending().filter((p) => p !== id));
      }
    },

    /**
     * Section 16 deletion: removes this guest and every code it made from the server. A
     * browser without a stored guest has nothing on the server, which counts as done. The
     * stored token is used as it is, never renewed, so this can never create a guest.
     */
    async deleteMe(): Promise<CodeResult<void>> {
      const stored = storedGuestToken(storage);
      if (!stored) return { ok: true, value: undefined };
      const result = await send<void>('/api/v1/me', { method: 'DELETE' }, null, {
        auth: true,
        bearer: stored,
      });
      // A token the server no longer honors has nothing left behind it.
      if (!result.ok && result.reason === 'unauthorized') return { ok: true, value: undefined };
      if (result.ok) cached = null;
      return result;
    },

    hasGuest(): boolean {
      return storedGuestToken(storage) !== null;
    },

    /**
     * Renews an existing guest session (the server rotates a token close to expiry), so a
     * player who keeps visiting keeps the right to delete their codes. Never creates a guest.
     */
    async renew(): Promise<void> {
      if (!storedGuestToken(storage)) return;
      try {
        await token(true);
      } catch {
        // Offline: the session is renewed on the next visit that reaches the server.
      }
    },
  };
  return client;
}

function storedGuestToken(storage: () => Pick<Storage, 'getItem'> | null): string | null {
  try {
    const token = storage()?.getItem(GUEST_TOKEN_KEY) ?? null;
    return token && /^[A-Za-z0-9._-]{16,512}$/.test(token) ? token : null;
  } catch {
    return null;
  }
}

export type CodeClient = ReturnType<typeof createCodeClient>;

/**
 * The create call's request id for one card holding one build under one name and paint: the
 * same press retried, or the same card shared twice, asks for the same code; a renamed or
 * repainted card asks for a new one.
 */
export function requestIdFor(entry: { id: string; blueprint: VehicleBlueprint }): string {
  const { name, paintId } = entry.blueprint;
  const digest = sha256Hex(`${buildHash(entry.blueprint)}|${name}|${paintId}`).slice(0, 32);
  return `${entry.id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24)}_${digest}`;
}
