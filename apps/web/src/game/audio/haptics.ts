/**
 * Vibration (Section 14.4). Used only where `navigator.vibrate` exists and only when the
 * player has turned it on: it is off by default, iOS Safari has no such call, and nothing in
 * the game depends on it. Every pattern doubles something that is also seen and heard.
 */

export const HAPTIC_KINDS = [
  'tap',
  'install',
  'count',
  'go',
  'fire_light',
  'fire_heavy',
  'hit_light',
  'hit_heavy',
  'collision',
  'explosion',
  'warning',
  'ko',
] as const;
export type HapticKind = (typeof HAPTIC_KINDS)[number];

/** Milliseconds: on, off, on, and so on. Short, so a busy fight never becomes a buzz. */
export const HAPTIC_PATTERNS: Readonly<Record<HapticKind, readonly number[]>> = {
  tap: [6],
  install: [12],
  count: [10],
  go: [35],
  fire_light: [8],
  fire_heavy: [18],
  hit_light: [14],
  hit_heavy: [32],
  collision: [28],
  explosion: [40, 30, 22],
  warning: [18, 60, 18],
  ko: [70, 40, 110],
};

/** Least time between two vibrations, so a machine-gun burst is one pulse and not ten. */
export const HAPTIC_MIN_GAP_MS = 70;

type Vibrator = { vibrate?: (pattern: number | number[]) => boolean };

let enabled = false;
let reduced = false;
let lastAt = -Infinity;

function vibrator(): Vibrator | null {
  if (typeof navigator === 'undefined') return null;
  const nav = navigator as unknown as Vibrator;
  return typeof nav.vibrate === 'function' ? nav : null;
}

/** True where the browser can vibrate at all. Use it to hide the setting where it cannot. */
export function hapticsSupported(): boolean {
  return vibrator() !== null;
}

export function hapticsEnabled(): boolean {
  return enabled;
}

/** Turned on by the player in Settings. Off by default (Section 14.4). */
export function setHapticsEnabled(on: boolean): void {
  const was = enabled;
  enabled = on;
  // Cancel a pattern in progress, but only if there could be one: browsers log an error for
  // any vibrate call made before the first touch.
  if (was && !on) vibrator()?.vibrate?.(0);
}

/** Reduced intensity halves every pulse. */
export function setHapticsReduced(on: boolean): void {
  reduced = on;
}

/** The pattern a kind produces at a strength of 0 to 1, in whole milliseconds. Pure. */
export function hapticPattern(kind: HapticKind, strength = 1, lighter = false): number[] {
  const scale = Math.max(0.3, Math.min(1, strength)) * (lighter ? 0.5 : 1);
  return HAPTIC_PATTERNS[kind].map((ms, index) =>
    // Pulses scale with strength; the gaps between them do not.
    index % 2 === 0 ? Math.max(4, Math.round(ms * scale)) : ms,
  );
}

/**
 * Vibrates, if the player enabled it and the device can. Returns whether a pattern was sent.
 * `nowMs` is injectable for tests.
 */
export function haptic(kind: HapticKind, strength = 1, nowMs?: number): boolean {
  if (!enabled) return false;
  const device = vibrator();
  if (!device) return false;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false;
  const now = nowMs ?? (typeof performance !== 'undefined' ? performance.now() : Date.now());
  if (now - lastAt < HAPTIC_MIN_GAP_MS) return false;
  lastAt = now;
  try {
    return device.vibrate?.(hapticPattern(kind, strength, reduced)) ?? false;
  } catch {
    return false;
  }
}

/** For tests. */
export function resetHaptics(): void {
  enabled = false;
  reduced = false;
  lastAt = -Infinity;
}
