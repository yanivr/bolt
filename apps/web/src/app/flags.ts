import { BUILD_SECONDS } from '@bolt/shared';

/**
 * Query-string switches for tests and reviews. Each one is ignored in a production build
 * unless `?debug=1` is also present, so a player cannot stumble into them from a shared link.
 */

function query(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

export function debugEnabled(): boolean {
  return import.meta.env.DEV || query().get('debug') === '1';
}

/**
 * Seconds on the garage build clock. `?buildSeconds=5` shortens it so the end-to-end tests
 * can watch the lock without waiting a minute, and lengthens it for slow machines.
 */
export function buildSeconds(): number {
  if (!debugEnabled()) return BUILD_SECONDS;
  const raw = Number(query().get('buildSeconds'));
  return Number.isFinite(raw) && raw >= 1 && raw <= 3600 ? Math.round(raw) : BUILD_SECONDS;
}
