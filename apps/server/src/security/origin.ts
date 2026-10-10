import type { IncomingMessage } from 'node:http';
import { normalizeOrigin } from '../config.js';

/**
 * Browser origin policy shared by the HTTP API, the matchmaking endpoint and WebSocket
 * upgrades. CORS headers alone do not protect sockets, so all three ask the same question.
 */

export type OriginPolicy = {
  /**
   * Requests without an Origin header come from non-browser clients or same-origin
   * navigation and are allowed; the guest token is what authorizes anything that matters.
   */
  allows(origin: string | undefined, host: string | undefined): boolean;
  /** True only for an allow-listed cross-origin caller, which needs explicit CORS headers. */
  isListed(origin: string | undefined): boolean;
};

export function createOriginPolicy(allowedOrigins: readonly string[]): OriginPolicy {
  const listed = new Set(allowedOrigins.map(normalizeOrigin));
  const isListed = (origin: string | undefined): boolean =>
    origin !== undefined && listed.has(normalizeOrigin(origin));

  return {
    isListed,
    allows(origin, host) {
      if (origin === undefined || origin === '') return true;
      if (isListed(origin)) return true;
      // The page was served by this very host, which is the single-port production layout.
      // Only the host is compared because a TLS-terminating proxy changes the scheme.
      if (!host) return false;
      try {
        return new URL(origin).host.toLowerCase() === host.toLowerCase();
      } catch {
        return false;
      }
    },
  };
}

/**
 * Address of the caller for rate limiting. Forwarded headers are honored only when a trusted
 * proxy sits in front, and then only the right-most entry, which that proxy appended itself;
 * everything to its left is client-supplied and trivially forged.
 */
export function clientAddress(req: IncomingMessage, trustProxy: boolean): string | undefined {
  if (trustProxy) {
    const header = req.headers['x-forwarded-for'];
    const value = Array.isArray(header) ? header[header.length - 1] : header;
    const last = value?.split(',').pop()?.trim();
    if (last) return last;
  }
  return req.socket.remoteAddress;
}
