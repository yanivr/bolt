import { formatMatchCode, isMatchCode, normalizeMatchCode } from '@bolt/shared';

/**
 * Invite links (Section 3.2): `/join/<code>` on this game's own origin, so a friend opening the
 * link on another device lands on the join screen with the code filled in. The server answers
 * every client-side route with the app shell.
 */

const JOIN_PATH = /^\/join\/([^/?#]+)\/?$/i;

let pending: string | null = null;
let read = false;

function readOnce(): void {
  if (read) return;
  read = true;
  try {
    // The server redirects `/join/<code>` to `/?join=<code>`; a static host may not.
    const fromQuery = new URLSearchParams(window.location.search).get('join');
    const match = JOIN_PATH.exec(window.location.pathname);
    const raw = fromQuery ?? (match?.[1] ? decodeURIComponent(match[1]) : null);
    if (raw !== null) pending = normalizeMatchCode(raw);
  } catch {
    pending = null;
  }
}

/** True when the page was opened at an invite link. */
export function openedAtInvite(): boolean {
  readOnce();
  return pending !== null;
}

/**
 * The code from the invite link the page was opened at, once. The address bar goes back to the
 * root so a refresh does not try to join the same lobby again.
 */
export function takeInviteCode(): string | null {
  readOnce();
  const code = pending;
  pending = null;
  if (code !== null) {
    try {
      const query = new URLSearchParams(window.location.search);
      query.delete('join');
      const rest = query.toString();
      window.history.replaceState(null, '', rest ? `/?${rest}` : '/');
    } catch {
      // A sandboxed frame: the address stays, which is harmless.
    }
  }
  return code;
}

export function inviteLink(code: string): string {
  return `${window.location.origin}/join/${code}`;
}

export function displayCode(code: string): string {
  return isMatchCode(code) ? formatMatchCode(code) : code;
}
