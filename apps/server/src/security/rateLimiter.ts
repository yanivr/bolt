import { isIP } from 'node:net';

/**
 * Small fixed-window rate limiter keyed by client address. It is deliberately in-process:
 * the launch target is a single authoritative node (Section 15.11), so shared state would
 * only add a dependency.
 */

export type RateLimitRule = {
  /** Length of one counting window in milliseconds. */
  windowMs: number;
  /** Requests allowed per key within one window. */
  max: number;
};

export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Whole seconds until the current window ends. Always at least 1. */
  retryAfterSeconds: number;
};

export type RateLimiter = {
  hit(key: string): RateLimitDecision;
  /** Drops expired windows. Called on a timer so idle keys do not accumulate. */
  sweep(): void;
  size(): number;
};

type Window = { count: number; resetAt: number };

/** Upper bound on tracked keys. Reaching it resets the table rather than growing forever. */
const MAX_TRACKED_KEYS = 50_000;

export function createRateLimiter(rule: RateLimitRule, now: () => number = Date.now): RateLimiter {
  const windows = new Map<string, Window>();
  const windowMs = Math.max(1, rule.windowMs);
  const max = Math.max(1, Math.floor(rule.max));

  const sweep = (): void => {
    const t = now();
    for (const [key, window] of windows) {
      if (window.resetAt <= t) windows.delete(key);
    }
  };

  return {
    hit(key) {
      const t = now();
      let window = windows.get(key);
      if (!window || window.resetAt <= t) {
        if (!window && windows.size >= MAX_TRACKED_KEYS) {
          sweep();
          // Still full of live windows: forgetting them briefly loosens the limit, which is
          // the safer failure than unbounded memory or locking out every new visitor.
          if (windows.size >= MAX_TRACKED_KEYS) windows.clear();
        }
        window = { count: 0, resetAt: t + windowMs };
        windows.set(key, window);
      }
      window.count += 1;
      return {
        allowed: window.count <= max,
        limit: max,
        remaining: Math.max(0, max - window.count),
        retryAfterSeconds: Math.max(1, Math.ceil((window.resetAt - t) / 1000)),
      };
    },
    sweep,
    size: () => windows.size,
  };
}

/**
 * Normalizes a socket or forwarded address into a rate-limit key. IPv6 clients usually hold
 * a whole /64, so the key keeps only that prefix; otherwise one host could rotate through
 * addresses and never be limited.
 */
export function rateLimitKey(address: string | undefined): string {
  if (!address) return 'unknown';
  let ip = address.trim();
  const zone = ip.indexOf('%');
  if (zone !== -1) ip = ip.slice(0, zone);
  if (ip.toLowerCase().startsWith('::ffff:') && isIP(ip.slice(7)) === 4) return ip.slice(7);
  if (isIP(ip) !== 6) return ip.slice(0, 64);

  const [head = '', tail = ''] = ip.toLowerCase().split('::') as [string, string?];
  const headGroups = head === '' ? [] : head.split(':');
  const tailGroups = tail === '' ? [] : tail.split(':');
  const expanded = ip.includes('::')
    ? [
        ...headGroups,
        ...new Array<string>(Math.max(0, 8 - headGroups.length - tailGroups.length)).fill('0'),
        ...tailGroups,
      ]
    : headGroups;
  return (
    expanded
      .slice(0, 4)
      .map((group) => group.replace(/^0+(?=.)/, ''))
      .join(':') + '::/64'
  );
}
