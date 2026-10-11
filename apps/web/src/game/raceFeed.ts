import type { RaceEvent, RaceSnapshot } from '@bolt/shared';

/**
 * One place where everything outside the race scene hears about the race: the HUD, the sound
 * and the effects each subscribe here instead of reaching into the scene or the link. The
 * scene publishes every race snapshot and every event exactly once, in order.
 */
export type RaceFeedListener = {
  /** Every authoritative race snapshot (15 Hz), with the page clock at arrival. */
  onRace?: (race: RaceSnapshot, nowMs: number) => void;
  /** Every discrete event, once, in id order. `race` is the latest snapshot, if any. */
  onEvent?: (event: RaceEvent, race: RaceSnapshot | null) => void;
  /** The race view was torn down or restarted: drop anything still playing. */
  onReset?: () => void;
};

const listeners = new Set<RaceFeedListener>();
let latest: RaceSnapshot | null = null;

export const raceFeed = {
  subscribe(listener: RaceFeedListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** The most recent race snapshot, or null before the first one. */
  get latest(): RaceSnapshot | null {
    return latest;
  },
  publishRace(race: RaceSnapshot, nowMs: number): void {
    latest = race;
    for (const l of listeners) l.onRace?.(race, nowMs);
  },
  publishEvent(event: RaceEvent): void {
    for (const l of listeners) l.onEvent?.(event, latest);
  },
  reset(): void {
    latest = null;
    for (const l of listeners) l.onReset?.();
  },
};
