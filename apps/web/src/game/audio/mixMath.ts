import type { BusId } from './recipe.js';

/**
 * The arithmetic of the mixer, free of the Web Audio API so it can be tested in Node:
 * distance and pan, ducking, who is stolen when the voice pool is full, rate limits and the
 * gear model that turns road speed into engine speed.
 */

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export const dbToGain = (db: number) => Math.pow(10, db / 20);
export const gainToDb = (gain: number) => 20 * Math.log10(Math.max(gain, 1e-9));

/** Hard limits. Documented in docs/AUDIO_GUIDE.md and asserted in the browser tests. */
export const CAPS = {
  /** One-shot and loop voices alive at once, over every bus but music. */
  totalVoices: 20,
  bus: {
    engine: 2,
    weapons: 8,
    impacts: 7,
    ambience: 6,
    alerts: 2,
    ui: 4,
    music: 16,
  } satisfies Record<BusId, number>,
  /** Most layers in a recipe, and the most nodes one layer can need. */
  layersPerVoice: 5,
  nodesPerLayer: 8,
  /** Most nodes in the fixed driving graphs: two engines of up to 32 nodes and the tires. */
  engineNodes: 72,
  /** Small impacts allowed in a burst, and how fast the allowance refills, per second. */
  impactBurst: 4,
  impactRefillPerSecond: 12,
} as const;

/** Priority at and above which a voice is never stolen and never refused for lack of room. */
export const PROTECTED_PRIORITY = 100;

// --- Space ---------------------------------------------------------------------------------

export const SPACE = {
  /** World pixels inside which a sound is at full level. */
  near: 90,
  /** World pixels at which it is gone. */
  far: 760,
  /** Sideways distance that puts a sound fully to one side. */
  panWidth: 360,
  /** Section 14.3: "modestly from the left or right". The widest a sound is ever panned. */
  panLimit: 0.65,
  /** Things the rival does are a little quieter than the same thing done by the player. */
  rivalTrim: 0.8,
} as const;

/** Level of a sound `distance` world pixels from the listener, 0 to 1. */
export function distanceGain(distance: number): number {
  if (!(distance > SPACE.near)) return 1;
  if (distance >= SPACE.far) return 0;
  const t = (SPACE.far - distance) / (SPACE.far - SPACE.near);
  return t * t;
}

/** Stereo position, -1 left to 1 right, of a sound `dx` world pixels to the listener's right. */
export function panFor(dx: number): number {
  return clamp(dx / SPACE.panWidth, -1, 1) * SPACE.panLimit;
}

export type Placement = { gain: number; pan: number };

/** Whose sound it is: the player's own, the rival car's, or something out in the world. */
export type Source = 'own' | 'rival' | 'world';

/**
 * Where a sound at a world position sits for a listener at the player's car. The player's own
 * sounds are centred at full level wherever the event says they happened.
 */
export function place(
  listenerX: number,
  listenerY: number,
  x: number,
  y: number,
  source: Source,
  out: Placement = { gain: 1, pan: 0 },
): Placement {
  if (source === 'own') {
    out.gain = 1;
    out.pan = 0;
    return out;
  }
  const dx = x - listenerX;
  const dy = y - listenerY;
  out.gain = distanceGain(Math.hypot(dx, dy)) * (source === 'rival' ? SPACE.rivalTrim : 1);
  out.pan = panFor(dx);
  return out;
}

// --- Ducking -------------------------------------------------------------------------------

export type DuckTargets = { music: number; engine: number; ambience: number };

/**
 * Bus levels while a sound of the given strength (a recipe's `duck`, 0 to 1) plays. A full
 * duck takes the music down about 10 dB and the engines about 4 dB (Section 14.3).
 */
export function duckTargets(strength: number): DuckTargets {
  const s = clamp(strength, 0, 1);
  return { music: 1 - 0.68 * s, engine: 1 - 0.36 * s, ambience: 1 - 0.28 * s };
}

/** Seconds a duck is held before it lets go, from the length of the sound that caused it. */
export function duckHold(strength: number, soundSeconds: number): number {
  return clamp(0.1 + soundSeconds * 0.5, 0.12, 0.7) * (0.5 + 0.5 * clamp(strength, 0, 1));
}

// --- Voice stealing ------------------------------------------------------------------------

export type VoiceSlot = { pri: number; start: number; bus: BusId; id: string };
export type StealDecision =
  { action: 'play' } | { action: 'steal'; index: number } | { action: 'drop' };

function weakest(voices: readonly VoiceSlot[], accept: (v: VoiceSlot) => boolean): number {
  let best = -1;
  for (let i = 0; i < voices.length; i++) {
    const v = voices[i]!;
    if (!accept(v) || v.pri >= PROTECTED_PRIORITY) continue;
    if (best < 0) best = i;
    else {
      const b = voices[best]!;
      if (v.pri < b.pri || (v.pri === b.pri && v.start < b.start)) best = i;
    }
  }
  return best;
}

/**
 * Decides whether a new voice may start. In order: a sound over its own copy limit replaces
 * its oldest copy; a full bus gives up its weakest voice; a full pool gives up its weakest
 * voice anywhere outside the music. "Weakest" is lowest priority, then oldest. A new sound
 * weaker than everything it could replace is dropped instead. Music has its own count and is
 * never stolen for effects.
 */
export function decideVoice(
  voices: readonly VoiceSlot[],
  incoming: { pri: number; bus: BusId; id: string; poly?: number },
): StealDecision {
  if (incoming.poly !== undefined) {
    let copies = 0;
    let oldest = -1;
    for (let i = 0; i < voices.length; i++) {
      const v = voices[i]!;
      if (v.id !== incoming.id) continue;
      copies++;
      if (oldest < 0 || v.start < voices[oldest]!.start) oldest = i;
    }
    if (copies >= incoming.poly && oldest >= 0) return { action: 'steal', index: oldest };
  }
  let inBus = 0;
  let total = 0;
  for (const v of voices) {
    if (v.bus === incoming.bus) inBus++;
    if (v.bus !== 'music') total++;
  }
  const busFull = inBus >= CAPS.bus[incoming.bus];
  const poolFull = incoming.bus !== 'music' && total >= CAPS.totalVoices;
  if (!busFull && !poolFull) return { action: 'play' };
  const index = busFull
    ? weakest(voices, (v) => v.bus === incoming.bus)
    : weakest(voices, (v) => v.bus !== 'music');
  if (index < 0) return { action: 'drop' };
  if (voices[index]!.pri > incoming.pri && incoming.pri < PROTECTED_PRIORITY)
    return { action: 'drop' };
  return { action: 'steal', index };
}

// --- Rate limiting -------------------------------------------------------------------------

/** Refuses a key that was allowed less than its interval ago. Times are seconds. */
export class RateLimiter {
  private readonly last = new Map<string, number>();

  allow(key: string, now: number, minIntervalMs: number): boolean {
    const before = this.last.get(key);
    if (before !== undefined && now >= before && (now - before) * 1000 < minIntervalMs - 1e-6)
      return false;
    this.last.set(key, now);
    return true;
  }

  reset(): void {
    this.last.clear();
  }
}

/** An allowance that refills over time: lets a burst through, then holds the rate. */
export class TokenBucket {
  private tokens: number;
  private at = 0;

  constructor(
    private readonly capacity: number,
    private readonly perSecond: number,
  ) {
    this.tokens = capacity;
  }

  take(now: number): boolean {
    if (now < this.at) this.at = now;
    this.tokens = Math.min(this.capacity, this.tokens + (now - this.at) * this.perSecond);
    this.at = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  reset(): void {
    this.tokens = this.capacity;
    this.at = 0;
  }
}

// --- Engine speed --------------------------------------------------------------------------

export type GearState = { gear: number };

const GEAR_BOUNDS = [0, 0.24, 0.46, 0.7, 1.2];

/**
 * Normalized engine speed, 0.2 to 1.05, from road speed as a share of top speed. With gears,
 * engine speed falls at each upshift, which is what sells acceleration to the ear; without
 * (electric motors, turbines) it simply follows the road. `state` remembers the gear, with
 * hysteresis so it does not hunt.
 */
export function engineSpeed(speedShare: number, gears: number, state: GearState): number {
  const frac = Math.max(0, speedShare);
  if (gears <= 1) return clamp(0.2 + 0.85 * frac, 0.2, 1.05);
  const top = Math.min(gears, GEAR_BOUNDS.length - 1);
  if (state.gear < 1) state.gear = 1;
  if (state.gear > top) state.gear = top;
  if (state.gear < top && frac > GEAR_BOUNDS[state.gear]! + 0.02) state.gear++;
  else if (state.gear > 1 && frac < GEAR_BOUNDS[state.gear - 1]! - 0.05) state.gear--;
  const lo = GEAR_BOUNDS[state.gear - 1]!;
  const hi = GEAR_BOUNDS[state.gear]!;
  return clamp(0.28 + 0.72 * ((frac - lo) / (hi - lo)), 0.2, 1.05);
}

/** Smoothstep. */
export function smooth(lo: number, hi: number, v: number): number {
  const t = clamp((v - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
}

export { clamp };
