import type { GuestSessionResponse, HealthResponse } from '@bolt/shared';
import { PROTOCOL_VERSION } from '@bolt/shared';

const TOKEN_KEY = 'bolt.guest.v1';

/**
 * Base URL of the game server. Same origin by default (the server serves the client in
 * production and Vite proxies in development); `VITE_SERVER_URL` overrides it.
 */
export function serverOrigin(): string {
  const configured = import.meta.env.VITE_SERVER_URL as string | undefined;
  return configured && configured.length > 0
    ? configured.replace(/\/$/, '')
    : window.location.origin;
}

function readStoredToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function storeToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Private browsing or blocked storage: the guest simply lives for this page load.
  }
}

async function fetchJson<T>(path: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${serverOrigin()}${path}`, {
      ...init,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as T;
  } finally {
    window.clearTimeout(timer);
  }
}

export type ServerProbe = { reachable: true; versionOk: boolean } | { reachable: false };

export async function probeServer(): Promise<ServerProbe> {
  try {
    const health = await fetchJson<HealthResponse>('/api/v1/health', { method: 'GET' }, 2500);
    return { reachable: true, versionOk: health.protocolVersion === PROTOCOL_VERSION };
  } catch {
    return { reachable: false };
  }
}

/** Issues or refreshes the anonymous guest session. No account, no personal data. */
export async function ensureGuest(): Promise<GuestSessionResponse> {
  const existing = readStoredToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (existing) headers.Authorization = `Bearer ${existing}`;
  const guest = await fetchJson<GuestSessionResponse>(
    '/api/v1/guest',
    { method: 'POST', headers, body: '{}' },
    5000,
  );
  storeToken(guest.token);
  return guest;
}

/** Local reset: forget the guest identity stored in this browser. */
export function forgetGuest(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing stored, nothing to clear.
  }
}
