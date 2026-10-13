import { STRINGS } from '@bolt/content';
import type { CodeClient } from './codeApi.js';

/**
 * The Section 16 deletion controls. Everything the game keeps in this browser is under keys
 * starting with `bolt.`; everything it keeps about this guest on the server goes with one
 * `DELETE /api/v1/me`. The server is asked first: once the guest pass is gone from this device,
 * nobody can delete the codes it made.
 */

export const LOCAL_PREFIX = 'bolt.';

type KeyStore = Pick<Storage, 'length' | 'key' | 'removeItem'>;

/** Removes every key of the game from a storage area. Returns how many were removed. */
export function clearGameKeys(storage: KeyStore | null): number {
  if (!storage) return 0;
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(LOCAL_PREFIX)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
  return keys.length;
}

function area(name: 'localStorage' | 'sessionStorage'): KeyStore | null {
  try {
    return window[name];
  } catch {
    return null;
  }
}

/** Clears this device: saved cars, the last car, settings, tutorial marks, the guest pass. */
export function clearDevice(): void {
  clearGameKeys(area('localStorage'));
  clearGameKeys(area('sessionStorage'));
}

export type DeleteOutcome = { ok: true } | { ok: false; text: string };

/** Deletes the guest and its codes on the server, then clears this device. */
export async function deleteEverything(
  client: Pick<CodeClient, 'deleteMe'>,
): Promise<DeleteOutcome> {
  const result = await client.deleteMe();
  if (!result.ok) return { ok: false, text: STRINGS.privacy.serverFailed };
  clearDevice();
  return { ok: true };
}

/** Starts the game again from a blank slate, so nothing held in memory survives the reset. */
export function restartFresh(): void {
  window.location.replace(
    `${window.location.pathname === '/privacy' ? '/' : window.location.pathname}`,
  );
}
