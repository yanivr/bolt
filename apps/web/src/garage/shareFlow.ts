import { CATALOG, STRINGS } from '@bolt/content';
import type { VehicleBlueprint } from '@bolt/shared';
import { buildHash, carCodeLink, validateBlueprint } from '@bolt/shared';
import { serverOrigin } from '../network/api.js';
import type { LibraryEntry } from './blueprintLibrary.js';
import type { CodeFailure } from './codeApi.js';
import { requestIdFor } from './codeApi.js';
import { codes } from './codes.js';
import { setShareDeletedHandler, useLibrary } from './libraryStore.js';

/**
 * Getting a code for a saved car, and handing it on: the clipboard, the system share sheet,
 * a link. The local card is always saved first and never depends on any of this succeeding.
 */

// Deleting a card that was shared deletes its server record too (Section 16), or queues the
// deletion until the server can be reached.
setShareDeletedHandler((share) => void codes.remove(share.id));

export type ShareOutcome = { ok: true; code: string } | { ok: false; text: string };

/** Approved or established copy for a failed call. */
export function failureText(reason: CodeFailure, serverMessage?: string): string {
  const c = STRINGS.codes;
  switch (reason) {
    case 'invalid':
    case 'not_found':
      return c.invalid;
    case 'outdated':
      return c.outdated;
    case 'illegal':
      return c.notLegal;
    case 'rate_limited':
      return serverMessage ?? STRINGS.codes.offline;
    case 'offline':
    case 'unavailable':
    case 'unauthorized':
      return c.offline;
  }
}

/** The code of a saved card, issuing one when it has none. */
export async function codeForEntry(entryId: string): Promise<ShareOutcome> {
  const entry = useLibrary.getState().entries.find((e) => e.id === entryId);
  if (!entry) return { ok: false, text: STRINGS.codes.invalid };
  if (entry.share) return { ok: true, code: entry.share.code };
  if (!entry.legal) return { ok: false, text: STRINGS.codes.notLegal };
  const result = await codes.create(entry.blueprint, requestIdFor(entry));
  if (!result.ok) return { ok: false, text: failureText(result.reason, result.message) };
  useLibrary
    .getState()
    .attachShare(
      entry.id,
      { code: result.value.code, id: result.value.id },
      entry.buildHash,
      entry.blueprint.name,
    );
  void codes.flushPending();
  return { ok: true, code: result.value.code };
}

/** The card in My Blueprints that holds this exact car (build, name and paint), if any. */
export function savedEntryFor(blueprint: VehicleBlueprint): LibraryEntry | undefined {
  const hash = buildHash(blueprint);
  return useLibrary
    .getState()
    .entries.find(
      (e) =>
        e.buildHash === hash &&
        e.blueprint.name === blueprint.name &&
        e.blueprint.paintId === blueprint.paintId,
    );
}

/**
 * Saves a car to My Blueprints unless it is already there. Returns the card, or why not:
 * the library is full.
 */
export function ensureSaved(
  blueprint: VehicleBlueprint,
): { ok: true; entry: LibraryEntry; added: boolean } | { ok: false; text: string } {
  const existing = savedEntryFor(blueprint);
  if (existing) return { ok: true, entry: existing, added: false };
  const result = useLibrary.getState().save(blueprint);
  if (result.ok) return { ok: true, entry: result.entry, added: true };
  if (result.reason === 'duplicate') {
    const again = savedEntryFor(blueprint);
    if (again) return { ok: true, entry: again, added: false };
  }
  return { ok: false, text: STRINGS.codes.full };
}

export function isLegal(blueprint: VehicleBlueprint): boolean {
  return validateBlueprint(blueprint, CATALOG).ok;
}

/** The link that opens Load Code on another device. */
export function shareLink(code: string): string {
  return carCodeLink(serverOrigin(), code);
}

/**
 * Copies text. The asynchronous clipboard needs a secure origin; on plain HTTP (a phone on the
 * local network) the old selection command still works in most browsers. False when neither
 * did, and the screen then asks the player to copy the code by hand from the selectable text.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission refused: try the fallback.
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    area.style.left = '-1000px';
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** True where the system share sheet exists (most phones). */
export function canNativeShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

/** Opens the system share sheet. A player closing it is not an error. */
export async function nativeShare(code: string): Promise<'shared' | 'cancelled' | 'failed'> {
  try {
    await navigator.share({
      title: STRINGS.productName,
      text: STRINGS.codes.shareText.replace('{code}', code),
      url: shareLink(code),
    });
    return 'shared';
  } catch (error) {
    return error instanceof DOMException && error.name === 'AbortError' ? 'cancelled' : 'failed';
  }
}
