import type { EffectPool } from './EffectPool.js';
import { MODE_FIXED, MODE_LOOP, MODE_STRETCH } from './EffectPool.js';
import type { PixelFx } from './PixelFx.js';
import {
  PAL_CYAN,
  PAL_DUST,
  PAL_EMBER,
  PAL_MINT,
  PAL_RED,
  PAL_SPARK,
  PAL_STEEL,
  PAL_VIOLET,
  PLANE_AIR,
  PLANE_GROUND,
  SHAPE_RING,
} from './PixelFx.js';
import { LAYER_FIRE, LAYER_GLOW, LAYER_SMOKE } from './atlas.js';

/**
 * The effect library: every blast and burst as a recipe that puts several strips on several
 * layers (Section 13.3: an explosion combines four to seven contrasting particle families and
 * is never one enlarged emitter). Recipes are pure: they write into the pool and the pixel
 * store and read nothing but their arguments and a seeded generator, so the same event always
 * draws the same burst, and two events draw different ones.
 */

/** Every strip a recipe or the combat stage refers to. Resolved once; a typo fails at start. */
export const ANIMS = [
  'flash_s',
  'flash_m',
  'flash_l',
  'flash_cyan',
  'flash_violet',
  'flash_mint',
  'fireball_a',
  'fireball_b',
  'fireball_s_a',
  'fireball_s_b',
  'bloom',
  'mortar_core',
  'thump',
  'smoke_dark_a',
  'smoke_dark_b',
  'smoke_dark_c',
  'smoke_dark_s',
  'dust_a',
  'dust_b',
  'dust_s',
  'chip_puff',
  'launch_puff',
  'steam',
  'puff_a',
  'puff_b',
  'puff_s',
  'scorch_s',
  'scorch_m',
  'scorch_l',
  'glow_s',
  'glow_m',
  'glow_l',
  'shard_a',
  'shard_b',
  'shard_c',
  'shard_d',
  'shard_hot_a',
  'shard_hot_b',
  'chunk_a',
  'chunk_b',
  'casing',
  'chip_round',
  'wheel_debris',
  'plate_debris',
  'shield_frag_a',
  'shield_frag_b',
  'shield_frag_c',
  'ice_shard_a',
  'ice_shard_b',
  'foam_bit',
  'circuit',
  'pop',
  'clang',
  'ice_burst',
  'foam_splat',
  'zap',
  'muzzle_mg',
  'muzzle_sentry',
  'muzzle_turret',
  'muzzle_shotgun',
  'backblast',
  'muzzle_air',
  'tracer_mg',
  'tracer_sentry',
  'tracer_turret',
  'pellet',
  'rocket',
  'missile',
  'harpoon',
  'boomerang',
  'frost_ball',
  'shell',
  'foam_glob',
  'shadow_blob',
  'flame_a',
  'flame_b',
  'frost_mist',
  'slash',
  'mine',
  'oil_a',
  'oil_b',
  'oil_c',
  'foam_a',
  'foam_b',
  'foam_clump',
  'frost_a',
  'frost_b',
  'fire_a',
  'fire_b',
  'flame_lick',
  'decoy',
  'jet',
  'clamp',
  'icon_wheel',
  'icon_engine',
  'icon_part',
  'icon_steer',
  'mark_lead',
  'aim_dot',
] as const;
export type AnimName = (typeof ANIMS)[number];

/** Where an effect happens. One scratch object, refilled for each event. */
export type At = {
  /** World position. */
  x: number;
  y: number;
  /** Car the hot centre of the effect rides on (-1 for none), and its offset from that car. */
  follow: number;
  ox: number;
  oy: number;
  /** Velocity of whatever was struck, px/s: debris and smoke are thrown from a moving thing. */
  vx: number;
  vy: number;
};

export type RecipeHost = {
  reduceFlashes: boolean;
  /** Camera impulse in world pixels for some seconds (Section 13.7). */
  kick(pixels: number, seconds: number): void;
  /** Smoke over the driver's own lane is thinner (Section 8.5). 0 to 1 by distance. */
  nearPlayer(x: number, y: number): number;
};

const TAU = Math.PI * 2;

export class Recipes {
  readonly a: Record<AnimName, number>;
  private state = 1;
  private readonly smokes: number[];
  private readonly shards: number[];
  private readonly hot: number[];
  private readonly chunks: number[];
  private readonly dusts: number[];

  constructor(
    readonly pool: EffectPool,
    readonly px: PixelFx,
    readonly host: RecipeHost,
  ) {
    const a = {} as Record<AnimName, number>;
    for (const name of ANIMS) a[name] = pool.atlas.id(name);
    this.a = a;
    this.smokes = [a.smoke_dark_a, a.smoke_dark_b, a.smoke_dark_c];
    this.shards = [a.shard_a, a.shard_b, a.shard_c, a.shard_d];
    this.hot = [a.shard_hot_a, a.shard_hot_b];
    this.chunks = [a.chunk_a, a.chunk_b];
    this.dusts = [a.dust_a, a.dust_b];
  }

  /**
   * How much has just gone off near the local driver: each blast adds its weight and it drains
   * in under a second. While it is high, debris, sparks and ground light are thinned, so several
   * effects on top of the player's own car never add up to a curtain (Section 8.5).
   */
  busy = 0;

  /** Call once a frame. */
  tick(dt: number): void {
    this.busy = Math.max(0, this.busy - dt * 2.2);
  }

  /** Registers a blast at a place; nearer the player counts for more. */
  private blast(x: number, y: number, weight: number): void {
    this.busy += weight * (0.25 + 0.75 * this.host.nearPlayer(x, y));
  }

  private crowded(count: number): number {
    return this.busy > 1.5 ? Math.max(1, Math.ceil(count / 2)) : count;
  }

  /** Seeds the cosmetic generator, usually with the event id (Section 13.1). */
  seed(value: number): void {
    this.state = (Math.imul(value | 0, 0x9e3779b1) ^ 0x85ebca6b) >>> 0 || 1;
  }

  /** Next value in [0, 1). */
  r(): number {
    let s = this.state;
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    this.state = s || 1;
    return s / 4294967296;
  }

  // --- Building blocks -------------------------------------------------------------------------

  /**
   * A flash on the additive layer. Under reduced flashes a large flash is replaced by its
   * outline strip and a small one is shown at half strength (Sections 5.13 and 13.3).
   */
  flash(anim: number, at: At, speedUp = 1): number {
    const pool = this.pool;
    let id = anim;
    let alpha = 1;
    if (this.host.reduceFlashes) {
      const fallback = pool.atlas.fallback[anim]!;
      if (fallback >= 0) id = fallback;
      else alpha = 0.5;
    }
    const s = at.follow >= 0 ? pool.spawn(id, at.ox, at.oy, -1, false) : pool.spawn(id, at.x, at.y);
    if (s < 0) return s;
    pool.follow[s] = at.follow;
    pool.alpha[s] = alpha;
    pool.fps[s]! *= speedUp;
    pool.life[s]! /= speedUp;
    return s;
  }

  /** Light on the road: an additive disc that steps down as it dies. */
  glow(anim: number, x: number, y: number, tint: number, alpha: number, seconds: number): void {
    const pool = this.pool;
    const s = pool.spawn(anim, x, y, LAYER_GLOW);
    if (s < 0) return;
    pool.mode[s] = MODE_FIXED;
    pool.tint[s] = tint;
    // Light on the road is kept low: enough to place a flash, never a gray fog over the lane.
    pool.alpha[s] =
      (this.host.reduceFlashes ? alpha * 0.5 : alpha) * (this.busy > 1.5 ? 0.45 : 0.7);
    pool.life[s] = seconds;
    pool.fade[s] = seconds;
  }

  /** A mark left on the road. Decals share a ring of 96: the oldest goes first. */
  decal(anim: number, x: number, y: number, seconds = 10): void {
    const pool = this.pool;
    const s = pool.spawn(anim, x, y);
    if (s < 0) return;
    pool.mode[s] = MODE_FIXED;
    pool.frame0[s] = this.r() < 0.5 ? 0 : 1;
    pool.life[s] = seconds;
    pool.fade[s] = 3;
  }

  /** Dark smoke that drifts and thins. Thinner near the player so the lane stays readable. */
  smoke(x: number, y: number, vx: number, vy: number, delay: number, small = false): void {
    const pool = this.pool;
    const anim = small ? this.a.smoke_dark_s : this.smokes[Math.floor(this.r() * 3)]!;
    const s = pool.spawn(anim, x, y, LAYER_SMOKE);
    if (s < 0) return;
    pool.vx[s] = vx;
    pool.vy[s] = vy;
    pool.drag[s] = 1.6;
    pool.delay[s] = delay;
    pool.alpha[s] = 0.78 - this.host.nearPlayer(x, y) * 0.48;
    pool.fade[s] = pool.life[s]! * 0.35;
  }

  /** Rigid fragments thrown in arcs that bounce and come to rest (Section 13.2, metal shards). */
  debris(
    list: readonly number[],
    count: number,
    at: At,
    speedMin: number,
    speedMax: number,
    lift: number,
    arc = TAU,
    dir = 0,
  ): void {
    const pool = this.pool;
    const n = this.crowded(pool.scaled(count));
    for (let i = 0; i < n; i++) {
      const a = dir + (this.r() - 0.5) * arc;
      const speed = speedMin + this.r() * (speedMax - speedMin);
      const s = pool.spawn(list[Math.floor(this.r() * list.length)]!, at.x, at.y);
      if (s < 0) continue;
      pool.vx[s] = Math.sin(a) * speed + at.vx * 0.4;
      pool.vy[s] = -Math.cos(a) * speed + at.vy * 0.4;
      pool.vz[s] = lift * (0.5 + this.r() * 0.8);
      pool.z[s] = 3;
      pool.gravity[s] = 330;
      pool.bounce[s] = 0.34;
      pool.drag[s] = 0.5;
      pool.mode[s] = MODE_LOOP;
      pool.fps[s] = 10 + this.r() * 10;
      pool.life[s] = 0.45 + this.r() * 0.5;
      pool.fade[s] = 0.16;
      if (this.r() < 0.4) pool.stopOnGround(s);
    }
  }

  /** Hot sparks: 1 to 3 pixel streaks that fall and bounce (Section 13.2). */
  sparks(
    count: number,
    at: At,
    speedMin: number,
    speedMax: number,
    palette = PAL_SPARK,
    arc = TAU,
    dir = 0,
    lift = 60,
  ): void {
    const px = this.px;
    const n = this.crowded(px.scaled(count));
    for (let i = 0; i < n; i++) {
      const a = dir + (this.r() - 0.5) * arc;
      const speed = speedMin + this.r() * (speedMax - speedMin);
      px.pixel(
        at.x,
        at.y,
        Math.sin(a) * speed + at.vx * 0.5,
        -Math.cos(a) * speed + at.vy * 0.5,
        0.1 + this.r() * 0.16,
        palette,
        speed > 90 ? 3 : 2,
        lift * this.r(),
        lift > 0 ? 300 : 0,
        2.2,
        2,
      );
    }
  }

  /** Slow orange embers that hang and wink out. */
  embers(count: number, at: At, spread: number): void {
    const n = this.px.scaled(count);
    for (let i = 0; i < n; i++) {
      const a = this.r() * TAU;
      const d = this.r() * spread;
      this.px.pixel(
        at.x + Math.cos(a) * d,
        at.y + Math.sin(a) * d,
        Math.cos(a) * 14 + at.vx * 0.2,
        Math.sin(a) * 14 - 10 + at.vy * 0.2,
        0.35 + this.r() * 0.7,
        PAL_EMBER,
        1,
        20 + this.r() * 30,
        0,
        1.2,
        2 + this.r() * 6,
      );
    }
  }

  /** A shockwave ring on the road with broken sectors. */
  ring(
    x: number,
    y: number,
    from: number,
    to: number,
    seconds: number,
    palette: number,
    dashes: number,
    delay = 0,
    plane = PLANE_GROUND,
    thickness = 0,
  ): void {
    const px = this.px;
    const s = px.shape(SHAPE_RING, plane, seconds, palette, Math.floor(this.r() * 997) + 1);
    px.sx1[s] = thickness;
    px.sx0[s] = x;
    px.sy0[s] = y;
    px.sA[s] = from;
    px.sB[s] = to;
    px.sC[s] = dashes;
    px.sDelay[s] = delay;
  }

  /** Ground-hugging dust thrown outward in a disc. */
  dustDisc(count: number, at: At, speed: number, small = false): void {
    const pool = this.pool;
    const n = pool.scaled(count);
    for (let i = 0; i < n; i++) {
      const a = ((i + this.r() * 0.7) / n) * TAU;
      const anim = small ? this.a.dust_s : this.dusts[i % 2]!;
      const s = pool.spawn(anim, at.x + Math.cos(a) * 5, at.y + Math.sin(a) * 5);
      if (s < 0) continue;
      const v = speed * (0.6 + this.r() * 0.6);
      pool.vx[s] = Math.cos(a) * v;
      pool.vy[s] = Math.sin(a) * v;
      pool.drag[s] = 3.4;
      pool.alpha[s] = 0.85;
      pool.fade[s] = 0.2;
    }
  }

  // --- The four major examples of Section 13.3 -------------------------------------------------

  /**
   * Small kinetic impact, 0.35 s: a two-frame white and yellow star, a bright core, eight
   * directional sparks, two to four bouncing metal pixels and tight smoke gone inside half a
   * second. `dir` is the heading the round was travelling: sparks leave back along it.
   */
  kinetic(at: At, dir: number, palette = PAL_SPARK, chips = 3): void {
    this.flash(this.a.flash_s, at, 1.2);
    this.sparks(8, at, 60, 170, palette, 2.2, dir + Math.PI, 70);
    const n = 2 + Math.floor(this.r() * chips);
    for (let i = 0; i < n; i++) {
      const a = dir + Math.PI + (this.r() - 0.5) * 2.6;
      this.px.pixel(
        at.x,
        at.y,
        Math.sin(a) * (40 + this.r() * 60) + at.vx * 0.5,
        -Math.cos(a) * (40 + this.r() * 60) + at.vy * 0.5,
        0.35 + this.r() * 0.25,
        PAL_STEEL,
        1,
        70 + this.r() * 60,
        320,
        1,
        3,
      );
    }
    const s = this.pool.spawn(this.a.chip_puff, at.x, at.y);
    if (s >= 0) {
      this.pool.vx[s] = at.vx * 0.5;
      this.pool.vy[s] = at.vy * 0.5 - 6;
      this.pool.drag[s] = 2;
      this.pool.alpha[s] = 0.8;
    }
    this.glow(this.a.glow_s, at.x, at.y, 0xffd9a0, 0.5, 0.1);
  }

  /**
   * Rocket explosion, 0.8 s, four clear layers: a 50 ms flash, an asymmetric fireball, 12 to 18
   * shrapnel sprites behind a segmented shockwave, then gray-black smoke blossoms. A scorch
   * and a pool of light stay on the road. `direct` is false for a burst on the bare road.
   */
  rocketBlast(at: At, radius: number, seedValue: number): void {
    this.seed(seedValue);
    this.blast(at.x, at.y, 1);
    const a = this.a;
    this.flash(a.flash_m, at, 1.4);
    const fire = this.pool.spawn(
      this.r() < 0.5 ? a.fireball_a : a.fireball_b,
      at.x,
      at.y,
      LAYER_FIRE,
    );
    if (fire >= 0) {
      this.pool.vx[fire] = at.vx * 0.3;
      this.pool.vy[fire] = at.vy * 0.3;
      this.pool.drag[fire] = 3;
    }
    // A second, smaller burst a beat later and off to one side: the blast is never one stamp.
    const ang = this.r() * TAU;
    const second = this.pool.spawn(
      this.r() < 0.5 ? a.fireball_s_a : a.fireball_s_b,
      at.x + Math.cos(ang) * radius * 0.5,
      at.y + Math.sin(ang) * radius * 0.5,
      LAYER_FIRE,
    );
    if (second >= 0) {
      this.pool.delay[second] = 0.07;
      this.pool.vx[second] = at.vx * 0.3 + Math.cos(ang) * 22;
      this.pool.vy[second] = at.vy * 0.3 + Math.sin(ang) * 22;
      this.pool.drag[second] = 3;
    }
    this.glow(a.glow_l, at.x, at.y, 0xff8a3c, 0.7, 0.42);
    this.glow(a.glow_m, at.x, at.y, 0xffd9a0, 0.8, 0.16);
    this.ring(at.x, at.y, radius * 0.3, radius * 1.55, 0.3, PAL_SPARK, 14);
    this.debris(this.shards, 13, at, 80, 230, 130);
    this.debris(this.hot, 4, at, 110, 260, 150);
    this.sparks(14, at, 90, 260, PAL_SPARK, TAU, 0, 90);
    this.embers(8, at, radius * 0.7);
    for (let i = 0; i < this.pool.scaled(5); i++) {
      const ang = this.r() * TAU;
      const d = radius * (0.15 + this.r() * 0.45);
      this.smoke(
        at.x + Math.cos(ang) * d,
        at.y + Math.sin(ang) * d,
        Math.cos(ang) * 16 + at.vx * 0.25,
        Math.sin(ang) * 16 - 9 + at.vy * 0.25,
        0.1 + this.r() * 0.26,
      );
    }
    this.decal(a.scorch_m, at.x, at.y);
    this.host.kick(2, 0.1);
  }

  /**
   * Heavy mortar explosion, 1.1 s: a tall column of hot white pixels, nested red and orange
   * shock rings with broken sectors, a broad low dust disc, several debris arcs and smoke
   * that rises in two stages. Under reduced flashes the flash is an outline and the particle
   * counts are halved.
   */
  mortarBlast(at: At, radius: number, seedValue: number): void {
    this.seed(seedValue);
    this.blast(at.x, at.y, 1.4);
    const a = this.a;
    const pool = this.pool;
    const half = this.host.reduceFlashes;
    const n = (count: number) => (half ? Math.ceil(count / 2) : count);
    this.flash(a.flash_l, at, 1.1);
    const core = pool.spawn(a.mortar_core, at.x, at.y, LAYER_FIRE);
    if (core >= 0) pool.life[core]! += 0.02;
    this.glow(a.glow_l, at.x, at.y, 0xff7a30, 0.8, 0.6);
    this.glow(a.glow_m, at.x, at.y, 0xffe0a0, 0.9, 0.22);
    this.ring(at.x, at.y, radius * 0.2, radius * 0.95, 0.34, PAL_SPARK, 10);
    this.ring(at.x, at.y, radius * 0.15, radius * 1.3, 0.42, PAL_EMBER, 14, 0.07);
    this.ring(at.x, at.y, radius * 0.1, radius * 1.65, 0.5, PAL_RED, 18, 0.15);
    this.dustDisc(n(18), at, radius * 2.3);
    this.debris(this.chunks, n(10), at, 60, 190, 230);
    this.debris(this.shards, n(8), at, 90, 250, 190);
    this.debris(this.hot, n(5), at, 120, 280, 210);
    this.sparks(n(22), at, 100, 300, PAL_SPARK, TAU, 0, 130);
    this.embers(n(12), at, radius * 0.8);
    // First stage: smoke rolling out at the foot. Second: a column climbing where the core was.
    for (let i = 0; i < pool.scaled(n(5)); i++) {
      const ang = (i / 5) * TAU + this.r();
      this.smoke(
        at.x + Math.cos(ang) * radius * 0.3,
        at.y + Math.sin(ang) * radius * 0.3,
        Math.cos(ang) * 26,
        Math.sin(ang) * 26,
        0.12 + this.r() * 0.12,
      );
    }
    for (let i = 0; i < pool.scaled(n(5)); i++) {
      const anim = this.smokes[i % 3]!;
      const s = pool.spawn(anim, at.x + (this.r() - 0.5) * 12, at.y - 4, LAYER_SMOKE);
      if (s < 0) continue;
      pool.z[s] = 8 + i * 9;
      pool.vz[s] = 26 + this.r() * 22;
      pool.vx[s] = (this.r() - 0.5) * 14;
      pool.delay[s] = 0.42 + i * 0.07;
      pool.alpha[s] = 0.78 - this.host.nearPlayer(at.x, at.y) * 0.48;
      pool.fade[s] = 0.4;
    }
    this.decal(a.scorch_l, at.x, at.y, 14);
    this.host.kick(3, 0.12);
  }

  /**
   * EMP burst, 0.5 s: staggered concentric cyan and violet outlines out to the pulse's real
   * range, square circuit fragments and electric flecks. No fire, no smoke, no shrapnel.
   */
  empBurst(at: At, range: number, seedValue: number): void {
    this.seed(seedValue);
    const a = this.a;
    const pool = this.pool;
    this.flash(a.flash_cyan, at);
    this.glow(a.glow_l, at.x, at.y, 0x7fe9f5, 0.7, 0.3);
    this.ring(at.x, at.y, 6, range, 0.42, PAL_CYAN, 22, 0, PLANE_AIR);
    this.ring(at.x, at.y, 4, range * 0.82, 0.42, PAL_VIOLET, 16, 0.07, PLANE_AIR);
    this.ring(at.x, at.y, 2, range * 0.62, 0.4, PAL_CYAN, 12, 0.14, PLANE_AIR);
    const count = pool.scaled(12);
    for (let i = 0; i < count; i++) {
      const ang = ((i + this.r() * 0.6) / count) * TAU;
      const s = pool.spawn(a.circuit, at.x + Math.cos(ang) * 10, at.y + Math.sin(ang) * 10);
      if (s < 0) continue;
      const v = range * (1.1 + this.r() * 0.9);
      pool.mode[s] = MODE_FIXED;
      pool.frame0[s] = i % 4;
      pool.vx[s] = Math.cos(ang) * v;
      pool.vy[s] = Math.sin(ang) * v;
      pool.drag[s] = 3.5;
      pool.life[s] = 0.3 + this.r() * 0.22;
      pool.fade[s] = 0.12;
    }
    this.sparks(10, at, 60, 200, PAL_CYAN, TAU, 0, 0);
    this.sparks(8, at, 60, 180, PAL_VIOLET, TAU, 0, 0);
    this.host.kick(1, 0.08);
  }

  /**
   * Repair burst, 0.5 s: a clamp closes on the part, mint weld sparks fall from it, and one
   * subsystem icon pulses over the car. Mechanical, not magical.
   */
  repairBurst(at: At, icon: number, seedValue: number): void {
    this.seed(seedValue);
    const a = this.a;
    const pool = this.pool;
    const clamp = pool.spawn(
      a.clamp,
      at.follow >= 0 ? at.ox : at.x,
      at.follow >= 0 ? at.oy : at.y,
      -1,
      false,
    );
    if (clamp >= 0) pool.follow[clamp] = at.follow;
    this.flash(a.flash_mint, at);
    for (let i = 0; i < this.px.scaled(12); i++) {
      const ang = this.r() * TAU;
      this.px.pixel(
        at.x,
        at.y,
        Math.cos(ang) * (30 + this.r() * 70) + at.vx,
        Math.sin(ang) * (30 + this.r() * 70) + at.vy,
        0.22 + this.r() * 0.25,
        PAL_MINT,
        2,
        50 + this.r() * 60,
        300,
        1.5,
        4,
      );
    }
    const s = pool.spawn(
      icon,
      at.follow >= 0 ? at.ox : at.x,
      (at.follow >= 0 ? at.oy : at.y) - 16,
      -1,
      false,
    );
    if (s >= 0) {
      pool.follow[s] = at.follow;
      pool.mode[s] = MODE_LOOP;
      pool.life[s] = 0.6;
      pool.vy[s] = -14;
      pool.drag[s] = 3;
      pool.delay[s] = 0.12;
    }
    this.glow(a.glow_s, at.x, at.y, 0x67dea7, 0.6, 0.25);
  }

  // --- Other bursts ----------------------------------------------------------------------------

  /** The seeker's focused bloom: tighter and pinker than the rocket, with one hard ring. */
  bloomBlast(at: At, radius: number, seedValue: number): void {
    this.seed(seedValue);
    const a = this.a;
    this.flash(a.flash_s, at, 0.8);
    const s = this.pool.spawn(a.bloom, at.x, at.y, LAYER_FIRE);
    if (s >= 0) {
      this.pool.vx[s] = at.vx * 0.3;
      this.pool.vy[s] = at.vy * 0.3;
      this.pool.drag[s] = 3;
    }
    this.glow(a.glow_m, at.x, at.y, 0xff9ac0, 1, 0.3);
    this.ring(at.x, at.y, radius * 0.2, radius * 1.2, 0.24, PAL_RED, 8);
    this.debris(this.shards, 7, at, 70, 200, 110);
    this.sparks(10, at, 80, 220, PAL_RED, TAU, 0, 70);
    for (let i = 0; i < this.pool.scaled(3); i++)
      this.smoke(
        at.x + (this.r() - 0.5) * radius * 0.6,
        at.y + (this.r() - 0.5) * radius * 0.6,
        at.vx * 0.25,
        at.vy * 0.25 - 10,
        0.14 + this.r() * 0.2,
      );
    this.decal(a.scorch_s, at.x, at.y);
    this.host.kick(2, 0.09);
  }

  /** The mine's low thump: a lens of light at axle height, pavement chunks and a dust skirt. */
  mineThump(at: At, radius: number, seedValue: number): void {
    this.seed(seedValue);
    const a = this.a;
    const s = this.pool.spawn(a.thump, at.x, at.y, LAYER_FIRE);
    if (s >= 0 && this.host.reduceFlashes) this.pool.alpha[s] = 0.75;
    this.glow(a.glow_m, at.x, at.y, 0xffd98a, 1, 0.22);
    this.ring(at.x, at.y, radius * 0.3, radius * 1.4, 0.3, PAL_DUST, 12);
    this.dustDisc(10, at, radius * 2.6);
    this.debris(this.chunks, 9, at, 50, 150, 150);
    this.sparks(6, at, 60, 160, PAL_SPARK, TAU, 0, 40);
    this.smoke(at.x, at.y - 3, at.vx * 0.2, at.vy * 0.2 - 8, 0.2);
    this.smoke(at.x + 6, at.y + 2, at.vx * 0.2, at.vy * 0.2 - 6, 0.3, true);
    this.decal(a.scorch_m, at.x, at.y);
    this.host.kick(2, 0.1);
  }

  /** The turret round's compact orange blast with a ring of round metal chips. */
  compactBlast(at: At, seedValue: number): void {
    this.seed(seedValue);
    const a = this.a;
    this.flash(a.flash_s, at);
    const s =
      at.follow >= 0
        ? this.pool.spawn(
            this.r() < 0.5 ? a.fireball_s_a : a.fireball_s_b,
            at.ox,
            at.oy,
            LAYER_FIRE,
            false,
          )
        : this.pool.spawn(this.r() < 0.5 ? a.fireball_s_a : a.fireball_s_b, at.x, at.y, LAYER_FIRE);
    if (s >= 0) this.pool.follow[s] = at.follow;
    for (let i = 0; i < this.pool.scaled(6); i++) {
      const ang = (i / 6) * TAU + this.r() * 0.4;
      const c = this.pool.spawn(a.chip_round, at.x, at.y);
      if (c < 0) continue;
      this.pool.vx[c] = Math.cos(ang) * 95 + at.vx * 0.5;
      this.pool.vy[c] = Math.sin(ang) * 95 + at.vy * 0.5;
      this.pool.vz[c] = 70;
      this.pool.z[c] = 3;
      this.pool.gravity[c] = 330;
      this.pool.bounce[c] = 0.3;
      this.pool.mode[c] = MODE_LOOP;
      this.pool.life[c] = 0.42;
      this.pool.fade[c] = 0.12;
    }
    this.glow(this.a.glow_s, at.x, at.y, 0xff9a5a, 0.8, 0.16);
  }

  /** A clean pop: an interceptor's kill, a swept mine, a decoy going down, a scrambled missile. */
  popBurst(at: At, palette: number, seedValue: number): void {
    this.seed(seedValue);
    this.pool.spawn(this.a.pop, at.x, at.y, LAYER_FIRE);
    this.sparks(9, at, 60, 190, palette, TAU, 0, 60);
    this.smoke(at.x, at.y, at.vx * 0.2, at.vy * 0.2 - 8, 0.1, true);
    this.glow(this.a.glow_s, at.x, at.y, 0xffe9c0, 0.8, 0.16);
  }

  /** A puff of pale, tintable vapour. */
  puff(
    x: number,
    y: number,
    vx: number,
    vy: number,
    tint: number,
    alpha: number,
    small: boolean,
  ): number {
    const pool = this.pool;
    const anim = small ? this.a.puff_s : this.r() < 0.5 ? this.a.puff_a : this.a.puff_b;
    const s = pool.spawn(anim, x, y, LAYER_SMOKE);
    if (s < 0) return s;
    pool.vx[s] = vx;
    pool.vy[s] = vy;
    pool.drag[s] = 2.6;
    pool.tint[s] = tint;
    pool.alpha[s] = alpha;
    return s;
  }

  /** Stretches a strip over a chosen duration, for effects whose length an event decides. */
  stretch(slot: number, seconds: number): void {
    if (slot < 0) return;
    this.pool.mode[slot] = MODE_STRETCH;
    this.pool.life[slot] = seconds;
  }
}
