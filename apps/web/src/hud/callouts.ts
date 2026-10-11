import { STRINGS } from '@bolt/content';
import type { RaceEvent } from '@bolt/shared';
import { COMPONENT_ENGINE } from '@bolt/shared';
import type { HudLoadout } from './model.js';
import { formatRaceTime } from './model.js';

/**
 * Short callouts for the big moments of a race (Sections 13.6 and 18.1). Two rules keep them
 * from becoming a combat log: at most two are on screen, and a new one has to wait a moment
 * after the last. What is said is decided here from the event alone, so it can be tested.
 */

/** `good` for what the driver did, `bad` for what was done to the car, `info` for the race. */
export type CalloutTone = 'good' | 'bad' | 'info';

export type CalloutOffer = {
  /** Offers with the same key are the same news: a second one inside the repeat window is dropped. */
  key: string;
  text: string;
  detail?: string;
  tone: CalloutTone;
  /** Higher wins a place when both are taken. */
  priority: number;
};

export type Callout = CalloutOffer & { id: number; shownMs: number; untilMs: number };

export const CALLOUT_MAX = 2;
export const CALLOUT_LIFE_MS = 1900;
/** Shortest time between two callouts appearing. */
export const CALLOUT_GAP_MS = 350;
/** The same news is not repeated inside this window. */
export const CALLOUT_REPEAT_MS = 3000;
/** How long an offer that found no room may wait for one. */
const CALLOUT_PATIENCE_MS = 900;

export class CalloutQueue {
  private shown: Callout[] = [];
  private waiting: { offer: CalloutOffer; atMs: number } | null = null;
  private lastShownMs = -Infinity;
  private readonly lastByKey = new Map<string, number>();
  private nextId = 1;

  reset(): void {
    this.shown = [];
    this.waiting = null;
    this.lastShownMs = -Infinity;
    this.lastByKey.clear();
  }

  /** Offers a callout. It may be shown now, shown shortly, or dropped. */
  offer(offer: CalloutOffer, nowMs: number): void {
    const last = this.lastByKey.get(offer.key);
    if (last !== undefined && nowMs - last < CALLOUT_REPEAT_MS) return;
    this.expire(nowMs);
    if (this.canShow(nowMs)) {
      this.show(offer, nowMs);
      return;
    }
    // No room, or too soon: bump the lowest callout for something more important, otherwise
    // hold the most important offer for a moment.
    const lowest = this.shown.reduce<Callout | null>(
      (min, c) => (!min || c.priority < min.priority ? c : min),
      null,
    );
    if (
      this.shown.length >= CALLOUT_MAX &&
      lowest &&
      offer.priority > lowest.priority &&
      nowMs - this.lastShownMs >= CALLOUT_GAP_MS
    ) {
      this.shown = this.shown.filter((c) => c !== lowest);
      this.show(offer, nowMs);
      return;
    }
    if (!this.waiting || offer.priority >= this.waiting.offer.priority)
      this.waiting = { offer, atMs: nowMs };
  }

  /** The callouts to draw at `nowMs`, oldest first. The same array is returned until it changes. */
  visible(nowMs: number): readonly Callout[] {
    this.expire(nowMs);
    if (this.waiting) {
      if (nowMs - this.waiting.atMs > CALLOUT_PATIENCE_MS) this.waiting = null;
      else if (this.canShow(nowMs)) {
        const { offer } = this.waiting;
        this.waiting = null;
        this.show(offer, nowMs);
      }
    }
    return this.shown;
  }

  private canShow(nowMs: number): boolean {
    return this.shown.length < CALLOUT_MAX && nowMs - this.lastShownMs >= CALLOUT_GAP_MS;
  }

  private show(offer: CalloutOffer, nowMs: number): void {
    this.shown = [
      ...this.shown,
      { ...offer, id: this.nextId++, shownMs: nowMs, untilMs: nowMs + CALLOUT_LIFE_MS },
    ];
    this.lastShownMs = nowMs;
    this.lastByKey.set(offer.key, nowMs);
  }

  private expire(nowMs: number): void {
    if (this.shown.some((c) => c.untilMs <= nowMs))
      this.shown = this.shown.filter((c) => c.untilMs > nowMs);
  }
}

export type CalloutContext = {
  you: number;
  loadout: HudLoadout;
  /** Names of the other car's components by index, as far as they are known. */
  rivalNames: readonly string[];
  laps: number;
  /** Race time of the newest snapshot, so the opening shuffle off the grid is not news. */
  raceTimeMs: number;
};

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));
}

/** A hit has to take this much off the other car before it is called out. */
const DIRECT_HIT_DAMAGE = 12;
/** Lead changes in the first seconds are the grid sorting itself out. */
const LEAD_NEWS_AFTER_MS = 4000;

/** The callout an event deserves, or null: most events are shown by the car, not by words. */
export function calloutFor(event: RaceEvent, ctx: CalloutContext): CalloutOffer | null {
  const c = STRINGS.hud.callout;
  const { you, loadout } = ctx;
  const mine = (index: number) => loadout.components[index];
  switch (event.type) {
    case 'hit': {
      if (event.car === you) {
        const comp = mine(event.component);
        if (comp?.kind === 'wheel')
          return {
            key: 'wheel-hit',
            text: c.wheelHit,
            detail: comp.name,
            tone: 'bad',
            priority: 5,
          };
        if (event.component === COMPONENT_ENGINE)
          return { key: 'engine-hit', text: c.engineHit, tone: 'bad', priority: 5 };
        return null;
      }
      if (event.by !== you) return null;
      const worth = event.damage + event.chassis;
      if (worth < DIRECT_HIT_DAMAGE || (event.cls !== 'direct' && event.cls !== 'heavy'))
        return null;
      const name = ctx.rivalNames[event.component];
      return {
        key: 'direct-hit',
        text: c.directHit,
        ...(name ? { detail: fill(c.rivalPart, { part: name }) } : {}),
        tone: 'good',
        priority: 3,
      };
    }
    case 'component': {
      if (event.condition !== 'disabled' || event.repaired) return null;
      if (event.car === you) {
        const comp = mine(event.component);
        return {
          key: `lost-${event.component}`,
          text: c.partLost,
          ...(comp ? { detail: comp.name } : {}),
          tone: 'bad',
          priority: 7,
        };
      }
      const name = ctx.rivalNames[event.component];
      return {
        key: `destroyed-${event.component}`,
        text: c.destroyed,
        ...(name ? { detail: fill(c.rivalPart, { part: name }) } : {}),
        tone: 'good',
        priority: 6,
      };
    }
    case 'utility': {
      if (event.car !== you || event.state !== 'done') return null;
      if (event.utility === 'utility_spare')
        return {
          key: 'wheel-replaced',
          text: c.wheelReplaced,
          ...(mine(event.value) ? { detail: mine(event.value)!.name } : {}),
          tone: 'good',
          priority: 6,
        };
      if (event.utility === 'utility_repair')
        return {
          key: `repaired-${event.value}`,
          text: c.repaired,
          ...(mine(event.value) ? { detail: mine(event.value)!.name } : {}),
          tone: 'good',
          priority: 6,
        };
      return null;
    }
    case 'status': {
      if (event.car !== you || event.state !== 'applied') return null;
      if (event.family === 'emp')
        return { key: 'emp', text: c.systemsDown, tone: 'bad', priority: 8 };
      if (event.family === 'jam') return { key: 'jam', text: c.jammed, tone: 'bad', priority: 6 };
      if (event.family === 'burn') return { key: 'burn', text: c.onFire, tone: 'bad', priority: 6 };
      return null;
    }
    case 'shield':
      if (event.car !== you || event.state !== 'down') return null;
      return { key: 'shield-down', text: c.shieldDown, tone: 'bad', priority: 4 };
    case 'misfire': {
      if (event.car !== you) return null;
      const part = loadout.parts[event.part];
      return {
        key: `misfire-${event.part}`,
        text: c.misfire,
        ...(part ? { detail: part.name } : {}),
        tone: 'bad',
        priority: 3,
      };
    }
    case 'lap': {
      if (event.car !== you) return null;
      const next = event.lap + 1;
      if (next > ctx.laps) return null;
      return {
        key: `lap-${next}`,
        text: next === ctx.laps ? c.finalLap : fill(c.lap, { lap: next }),
        detail: formatRaceTime(event.lapTimeMs),
        tone: 'info',
        priority: next === ctx.laps ? 7 : 4,
      };
    }
    case 'position': {
      if (ctx.raceTimeMs < LEAD_NEWS_AFTER_MS) return null;
      return event.leader === you
        ? { key: 'lead', text: c.leadTaken, tone: 'good', priority: 5 }
        : { key: 'lead', text: c.leadLost, tone: 'bad', priority: 5 };
    }
    case 'ko':
      return event.car === you
        ? { key: 'ko', text: c.knockedOut, tone: 'bad', priority: 9 }
        : { key: 'ko', text: c.knockedOut, detail: STRINGS.hud.rival, tone: 'good', priority: 9 };
    default:
      return null;
  }
}
