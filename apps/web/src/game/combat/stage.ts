import type {
  CarAtlasManifest,
  HazardKind,
  HazardSnapshot,
  ProjectileKind,
  ProjectileSnapshot,
  RaceEvent,
  RaceEventType,
  RaceSnapshot,
  ResolvedBuild,
  StatusSnapshot,
} from '@bolt/shared';
import { COMPONENT_FIRST_WHEEL, SIM_DT, TAU, angleDelta, clamp, hash2 } from '@bolt/shared';
import type { SimPose } from '../rendering/frame.js';
import type { PoolQuality } from '../vfx/EffectPool.js';
import { EffectPool, MODE_FIXED, MODE_LOOP } from '../vfx/EffectPool.js';
import type { PixelSink } from '../vfx/PixelFx.js';
import {
  PAL_AMBER,
  PAL_CYAN,
  PAL_DUST,
  PAL_EMBER,
  PAL_FOAM,
  PAL_GOLD,
  PAL_ICE,
  PAL_MINT,
  PAL_OIL,
  PAL_RED,
  PAL_RUBBER,
  PAL_SPARK,
  PAL_STEEL,
  PAL_VIOLET,
  PAL_WHITE,
  PALETTES,
  PLANE_AIR,
  PLANE_GROUND,
  PixelFx,
  SHAPE_BOLT,
  drawBolt,
  drawBrackets,
  drawLine,
  drawRing,
  drawRope,
} from '../vfx/PixelFx.js';
import type { FxAtlas } from '../vfx/atlas.js';
import { LAYER_BODY, LAYER_FIRE, LAYER_FLASH, LAYER_GROUND, LAYER_SMOKE } from '../vfx/atlas.js';
import type { At } from '../vfx/recipes.js';
import { Recipes } from '../vfx/recipes.js';
import type { Vec2 } from './rig.js';
import {
  BODY_HEIGHT,
  CarRig,
  CarState,
  MAX_PARTS,
  SOURCE_FOAM,
  SOURCE_FROST,
  SOURCE_MINE,
  SOURCE_NONE,
  SOURCE_OIL,
  statusSlot,
} from './rig.js';
import { GENERIC_FX, WEAPON_FX } from './weaponFx.js';

/**
 * The combat presentation, without a renderer (Milestone C part 2). It takes what the link
 * delivers (race snapshots and the ordered event stream), keeps a short timeline so that the
 * rival, everything in flight and every effect are shown at one consistent moment, and turns
 * all of it into pooled sprites, pixel shapes and per-car visual state. `CombatView` copies
 * the result onto Phaser objects; the unit tests drive this class directly with real
 * scenario timelines and no browser.
 *
 * Time. Remote things are drawn a little in the past, at `renderTick`, so they can be
 * interpolated between snapshots: exactly one tick behind the newest snapshot when the race
 * runs in the page, about one snapshot interval behind on a server. Events are held until the
 * render clock reaches their tick, so an explosion plays when the rocket that is drawn
 * arrives, not when the message does. The local car is predicted and is the one thing ahead.
 *
 * Place. An event on a car gives a world position at its own tick. That is turned into a
 * point on the car with the car's authoritative pose at that tick, and drawn on the car where
 * the car is drawn now, so a hit on the rear-left wheel lands on the rear-left wheel.
 */

export type StageHost = {
  /** Camera impulse in world pixels (Section 13.7). The camera owns the budget and the setting. */
  kick(pixels: number, seconds: number): void;
  /** Rubber on the road and exhaust puffs go through the driving effects of Milestone A. */
  skid(x: number, y: number, rotation: number, heavy: boolean): void;
  exhaust(x: number, y: number, vx: number, vy: number): void;
};

const HISTORY = 24;
const QUEUE = 512;
const MAX_PROJECTILES = 96;
const MAX_HAZARDS = 64;
const HAZARD_SPRITES = 10;
const MAX_LOCKS = 8;
const MAX_STREAMS = 8;

type PoseSample = { tick: number; x: number; y: number; heading: number; vx: number; vy: number };

class PoseHistory {
  private readonly samples: PoseSample[] = [];
  private head = 0;
  private count = 0;

  constructor() {
    for (let i = 0; i < HISTORY; i++)
      this.samples.push({ tick: 0, x: 0, y: 0, heading: 0, vx: 0, vy: 0 });
  }

  clear(): void {
    this.count = 0;
    this.head = 0;
  }

  push(tick: number, x: number, y: number, heading: number, vx: number, vy: number): void {
    const last = this.count > 0 ? this.samples[(this.head + HISTORY - 1) % HISTORY]! : null;
    if (last && tick <= last.tick) {
      if (tick < last.tick - 4) this.clear();
      else return;
    }
    const s = this.samples[this.head]!;
    s.tick = tick;
    s.x = x;
    s.y = y;
    s.heading = heading;
    s.vx = vx;
    s.vy = vy;
    this.head = (this.head + 1) % HISTORY;
    if (this.count < HISTORY) this.count++;
  }

  get length(): number {
    return this.count;
  }

  /** The pose at a tick: between two samples, or carried along the nearest one's velocity. */
  sample(tick: number, out: SimPose): boolean {
    if (this.count === 0) return false;
    let before: PoseSample | null = null;
    let after: PoseSample | null = null;
    for (let i = 0; i < this.count; i++) {
      const s = this.samples[(this.head + HISTORY - 1 - i) % HISTORY]!;
      if (s.tick <= tick) {
        before = s;
        break;
      }
      after = s;
    }
    if (before && after) {
      const k = (tick - before.tick) / Math.max(1e-6, after.tick - before.tick);
      out.x = before.x + (after.x - before.x) * k;
      out.y = before.y + (after.y - before.y) * k;
      out.heading = before.heading + angleDelta(before.heading, after.heading) * k;
      out.vx = before.vx + (after.vx - before.vx) * k;
      out.vy = before.vy + (after.vy - before.vy) * k;
      return true;
    }
    const s = (before ?? after)!;
    // Outside what is known: coast on the last velocity, for at most a few ticks.
    const dt = clamp(tick - s.tick, -4, 4) * SIM_DT;
    out.x = s.x + s.vx * dt;
    out.y = s.y + s.vy * dt;
    out.heading = s.heading;
    out.vx = s.vx;
    out.vy = s.vy;
    return true;
  }
}

export type ProjectileView = {
  active: boolean;
  id: number;
  kind: ProjectileKind;
  owner: number;
  weapon: string;
  sprite: number;
  shadow: number;
  /** Two most recent records of where the simulation put it. */
  ax: number;
  ay: number;
  atick: number;
  bx: number;
  by: number;
  bvx: number;
  bvy: number;
  btick: number;
  launchTick: number;
  landTick: number;
  launchX: number;
  launchY: number;
  seenTick: number;
  goneTick: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  trail: number;
  returning: boolean;
  shown: boolean;
};

export type HazardView = {
  active: boolean;
  id: number;
  kind: HazardKind;
  owner: number;
  x: number;
  y: number;
  radius: number;
  halfLength: number;
  angle: number;
  armedTick: number;
  endTick: number;
  revealed: boolean;
  seenTick: number;
  goneTick: number;
  age: number;
  sprites: number[];
  count: number;
  pulse: number;
  timer: number;
};

type Lock = {
  active: boolean;
  car: number;
  part: number;
  target: number;
  age: number;
  hot: number;
};

/** A weapon that keeps emitting for a while: a flame cone, a saw's shower of sparks. */
type Stream = {
  active: boolean;
  kind: number;
  car: number;
  part: number;
  left: number;
  dir: number;
  half: number;
  range: number;
  timer: number;
  seed: number;
};
export const STREAM_FLAME = 1;
export const STREAM_SAW = 2;

type Tether = {
  active: boolean;
  car: number;
  part: number;
  target: number;
  /** Where the hook sits on the target, chassis-local. */
  lx: number;
  ly: number;
  rest: number;
  /** Seconds since release, or -1 while attached. */
  retract: number;
};

const scratchPose: SimPose = { x: 0, y: 0, heading: 0, vx: 0, vy: 0 };
const v2a: Vec2 = { x: 0, y: 0 };
const v2b: Vec2 = { x: 0, y: 0 };
const comp = { x: 0, y: 0, z: 0 };

export class CombatStage {
  readonly pool: EffectPool;
  readonly px = new PixelFx();
  readonly fx: Recipes;
  readonly cars: [CarState, CarState] = [new CarState(), new CarState()];
  readonly carX = new Float32Array(2);
  readonly carY = new Float32Array(2);
  /** Scratch position, refilled for each event before a recipe is called. */
  readonly at: At = { x: 0, y: 0, follow: -1, ox: 0, oy: 0, vx: 0, vy: 0 };
  you = 0;
  /** Whole device pixels per world pixel, for snapping. */
  scale = 1;
  reduceFlashes = false;
  clock = 0;
  renderTick = 0;
  latestTick = 0;
  private offset = 0;
  private offsetKnown = false;
  private interval = 2;
  private lastSnapshotTick = -1;
  private readonly history: [PoseHistory, PoseHistory] = [new PoseHistory(), new PoseHistory()];
  private readonly queue: Array<RaceEvent | null> = new Array<RaceEvent | null>(QUEUE).fill(null);
  private queueHead = 0;
  private queueCount = 0;
  readonly projectiles: ProjectileView[] = [];
  private readonly projectileById = new Map<number, ProjectileView>();
  private readonly projectileWeapon = new Map<number, string>();
  readonly hazards: HazardView[] = [];
  private readonly hazardById = new Map<number, HazardView>();
  private readonly locks: Lock[] = [];
  private readonly streams: Stream[] = [];
  readonly tether: Tether = {
    active: false,
    car: 0,
    part: 0,
    target: 0,
    lx: 0,
    ly: 0,
    rest: 0,
    retract: -1,
  };
  /** Events handled so far by type, and effect signatures by weapon: read by the tests. */
  readonly handled: Partial<Record<RaceEventType, number>> = {};
  viewX0 = 0;
  viewY0 = 0;
  viewX1 = 0;
  viewY1 = 0;
  private snapshot: RaceSnapshot | null = null;
  private warnLock = 0;

  constructor(
    readonly atlas: FxAtlas,
    private readonly carsManifest: CarAtlasManifest,
    readonly host: StageHost,
  ) {
    this.pool = new EffectPool(atlas);
    this.fx = new Recipes(this.pool, this.px, {
      reduceFlashes: false,
      kick: (pixels, seconds) => this.host.kick(pixels, seconds),
      nearPlayer: (x, y) => {
        const own = this.cars[this.you]!;
        return own.present ? clamp(1 - Math.hypot(x - own.x, y - own.y) / 80, 0, 1) : 0;
      },
    });
    for (let i = 0; i < MAX_PROJECTILES; i++)
      this.projectiles.push({
        active: false,
        id: 0,
        kind: 'bullet',
        owner: 0,
        weapon: '',
        sprite: -1,
        shadow: -1,
        ax: 0,
        ay: 0,
        atick: 0,
        bx: 0,
        by: 0,
        bvx: 0,
        bvy: 0,
        btick: 0,
        launchTick: 0,
        landTick: 0,
        launchX: 0,
        launchY: 0,
        seenTick: 0,
        goneTick: 0,
        x: 0,
        y: 0,
        z: 0,
        heading: 0,
        trail: 0,
        returning: false,
        shown: false,
      });
    for (let i = 0; i < MAX_HAZARDS; i++)
      this.hazards.push({
        active: false,
        id: 0,
        kind: 'mine',
        owner: 0,
        x: 0,
        y: 0,
        radius: 0,
        halfLength: 0,
        angle: 0,
        armedTick: 0,
        endTick: 0,
        revealed: false,
        seenTick: 0,
        goneTick: 0,
        age: 0,
        sprites: new Array<number>(HAZARD_SPRITES).fill(-1),
        count: 0,
        pulse: 0,
        timer: 0,
      });
    for (let i = 0; i < MAX_LOCKS; i++)
      this.locks.push({ active: false, car: 0, part: 0, target: 0, age: 0, hot: 0 });
    for (let i = 0; i < MAX_STREAMS; i++)
      this.streams.push({
        active: false,
        kind: 0,
        car: 0,
        part: 0,
        left: 0,
        dir: 0,
        half: 0,
        range: 0,
        timer: 0,
        seed: 0,
      });
  }

  get a(): Recipes['a'] {
    return this.fx.a;
  }

  /** Gives a car its rig. Until then nothing is drawn on it. */
  setCar(index: number, build: ResolvedBuild | null): void {
    const car = this.cars[index];
    if (!car) return;
    car.rig =
      build && this.carsManifest.chassis[build.chassis.id]
        ? new CarRig(this.carsManifest, build)
        : null;
  }

  setQuality(quality: PoolQuality): void {
    this.pool.quality = quality;
    this.px.low = quality === 'low';
  }

  get quality(): PoolQuality {
    return this.pool.quality;
  }

  /** Drops everything: the race was restarted or the view torn down. */
  clear(): void {
    this.pool.clear();
    this.px.clear();
    for (const car of this.cars) {
      car.reset();
      car.present = false;
    }
    for (const h of this.history) h.clear();
    this.queueHead = 0;
    this.queueCount = 0;
    this.queue.fill(null);
    for (const p of this.projectiles) p.active = false;
    this.projectileById.clear();
    this.projectileWeapon.clear();
    for (const h of this.hazards) h.active = false;
    this.hazardById.clear();
    for (const l of this.locks) l.active = false;
    for (const s of this.streams) s.active = false;
    this.tether.active = false;
    this.snapshot = null;
    this.lastSnapshotTick = -1;
    this.offsetKnown = false;
    this.warnLock = 0;
  }

  // --- Input from the link -----------------------------------------------------------------------

  onRace(race: RaceSnapshot): void {
    if (race.tick < this.lastSnapshotTick - 8) this.clear();
    const fresh = this.lastSnapshotTick < 0;
    if (!fresh && race.tick > this.lastSnapshotTick)
      this.interval += (clamp(race.tick - this.lastSnapshotTick, 1, 6) - this.interval) * 0.1;
    this.lastSnapshotTick = race.tick;
    this.latestTick = race.tick;
    this.snapshot = race;
    this.you = race.you;
    const rivalIndex = race.you === 0 ? 1 : 0;

    // The server clock as seen from here: the newest snapshot is the best evidence of "now".
    const seen = race.tick - this.clock / SIM_DT;
    if (!this.offsetKnown || Math.abs(seen - this.offset) > 8) {
      this.offset = seen;
      this.offsetKnown = true;
    } else this.offset += (seen - this.offset) * (seen > this.offset ? 0.25 : 0.04);

    const own = this.cars[race.you]!;
    const rival = this.cars[rivalIndex]!;
    const m = race.car.motion;
    this.history[race.you]!.push(race.tick, m.x, m.y, m.headingRad, m.velocityX, m.velocityY);
    const r = race.rival;
    this.history[rivalIndex]!.push(race.tick, r.x, r.y, r.headingRad, r.velocityX, r.velocityY);

    const combat = race.car.combat;
    if (combat) {
      own.chassis = combat.chassis;
      own.chassisMax = combat.chassisMax;
      own.ko = combat.ko;
      this.copyIntegrity(own, combat.components);
      this.copyStatuses(own, combat.statuses);
      for (let i = 0; i < combat.modules.length && i < MAX_PARTS; i++) {
        const mod = combat.modules[i]!;
        own.moduleState[i] = mod.state;
        own.moduleAim[i] = mod.aim;
        own.moduleUp[i] = own.rig?.parts[i]?.kind === 'shield' && mod.pool > 0 ? 1 : 0;
      }
    }
    rival.chassis = r.chassis;
    rival.chassisMax = r.chassisMax;
    rival.ko = r.ko;
    rival.steer = r.steeringInput;
    rival.braking = r.braking;
    this.copyIntegrity(rival, r.components);
    this.copyStatuses(rival, r.statuses);
    for (let i = 0; i < r.modules.length && i < MAX_PARTS; i++) {
      const mod = r.modules[i]!;
      rival.moduleState[i] = mod.state;
      rival.moduleAim[i] = mod.aim;
      rival.moduleUp[i] = mod.up ? 1 : 0;
    }
    rival.present = rival.rig !== null;

    this.syncProjectiles(race);
    this.syncHazards(race);
  }

  private copyIntegrity(car: CarState, values: readonly number[]): void {
    const n = Math.min(values.length, car.integrity.length);
    for (let i = 0; i < n; i++) car.integrity[i] = values[i]!;
  }

  private copyStatuses(car: CarState, statuses: readonly StatusSnapshot[]): void {
    car.statusUntil.fill(0);
    for (const status of statuses) {
      const slot = statusSlot(status.family);
      car.statusUntil[slot] = status.untilTick;
      car.statusMagnitude[slot] = status.magnitude;
    }
  }

  /** Every event, once, in order. It is shown when the render clock reaches its tick. */
  onEvent(event: RaceEvent): void {
    if (event.type === 'shot' && event.projectile > 0) {
      this.projectileWeapon.set(event.projectile, event.weapon);
      if (this.projectileWeapon.size > 256) {
        // Ids only grow, so the smallest keys are the oldest shots.
        for (const key of this.projectileWeapon.keys()) {
          this.projectileWeapon.delete(key);
          if (this.projectileWeapon.size <= 192) break;
        }
      }
      const view = this.projectileById.get(event.projectile);
      if (view) view.weapon = event.weapon;
    }
    if (this.queueCount === QUEUE) {
      // Never drop an event unseen: when the queue is full the oldest is played at once.
      this.dispatch(this.queue[this.queueHead]!);
      this.queue[this.queueHead] = null;
      this.queueHead = (this.queueHead + 1) % QUEUE;
      this.queueCount--;
    }
    this.queue[(this.queueHead + this.queueCount) % QUEUE] = event;
    this.queueCount++;
  }

  // --- One frame ---------------------------------------------------------------------------------

  /**
   * Advances everything by `dt` seconds. `own` is the local car as the race view draws it this
   * frame. `alpha` is the position between the last two simulation ticks when the race runs in
   * the page (so the render clock is exact), or -1 when snapshots come from a server.
   */
  frame(
    dt: number,
    own: {
      x: number;
      y: number;
      heading: number;
      frameHeading: number;
      vx: number;
      vy: number;
      steer: number;
      braking: boolean;
      roll: number;
      bodyShiftX: number;
      bodyShiftY: number;
    },
    alpha: number,
  ): void {
    this.clock += dt;
    this.fx.host.reduceFlashes = this.reduceFlashes;
    this.fx.tick(dt);
    const target =
      alpha >= 0
        ? this.latestTick - 1 + alpha
        : Math.min(this.latestTick + 2, this.clock / SIM_DT + this.offset) - (this.interval + 0.5);
    // The render clock never runs backwards, and never falls far behind after a stall.
    this.renderTick =
      target < this.renderTick && target > this.renderTick - 3 ? this.renderTick : target;

    const me = this.cars[this.you]!;
    me.present = me.rig !== null;
    me.x = own.x;
    me.y = own.y;
    me.heading = own.heading;
    me.frameHeading = own.frameHeading;
    me.vx = own.vx;
    me.vy = own.vy;
    me.steer = own.steer;
    me.braking = own.braking;
    me.roll = own.roll;
    me.bodyShiftX = own.bodyShiftX;
    me.bodyShiftY = own.bodyShiftY;

    const rivalIndex = this.you === 0 ? 1 : 0;
    const rival = this.cars[rivalIndex]!;
    if (rival.present && this.history[rivalIndex]!.sample(this.renderTick, scratchPose)) {
      const s = this.scale;
      const before = rival.heading;
      rival.x = Math.round(scratchPose.x * s) / s;
      rival.y = Math.round(scratchPose.y * s) / s;
      rival.heading = scratchPose.heading;
      rival.vx = scratchPose.vx;
      rival.vy = scratchPose.vy;
      rival.frameHeading = rival.latch.update(rival.heading);
      const speed = Math.hypot(rival.vx, rival.vy);
      rival.roll += dt * clamp(speed / 6, 0, 18);
      const yawRate = dt > 0 ? angleDelta(before, rival.heading) / dt : 0;
      rival.body.update(dt, clamp(yawRate, -4, 4) * speed, 0, speed, this.clock);
      rival.bodyShiftX = rival.body.shiftX;
      rival.bodyShiftY = rival.body.shiftY;
    }
    for (let i = 0; i < 2; i++) {
      this.carX[i] = this.cars[i]!.x;
      this.carY[i] = this.cars[i]!.y;
    }

    this.pool.setView(this.viewX0, this.viewY0, this.viewX1, this.viewY1);

    // Events whose moment has come.
    while (this.queueCount > 0) {
      const event = this.queue[this.queueHead]!;
      if (event.tick > this.renderTick + 1e-3) break;
      this.queue[this.queueHead] = null;
      this.queueHead = (this.queueHead + 1) % QUEUE;
      this.queueCount--;
      this.dispatch(event);
    }

    if (dt > 0) {
      for (let i = 0; i < 2; i++) this.updateCar(i, dt);
      this.updateProjectiles(dt);
      this.updateHazards(dt);
      this.updateStreams(dt);
      this.updateLocks(dt);
      if (this.tether.active && this.tether.retract >= 0) {
        this.tether.retract += dt;
        if (this.tether.retract > 0.22) this.tether.active = false;
      }
    }
    this.pool.update(dt, this.carX, this.carY);
    this.px.update(dt);
  }

  // --- Positions ---------------------------------------------------------------------------------

  /** A plain point in the world. */
  atWorld(x: number, y: number): At {
    const at = this.at;
    at.x = x;
    at.y = y;
    at.follow = -1;
    at.ox = 0;
    at.oy = 0;
    at.vx = 0;
    at.vy = 0;
    return at;
  }

  /** A point on a car, given in chassis-local pixels at a height. */
  atLocal(index: number, lx: number, ly: number, z: number): At {
    const car = this.cars[index]!;
    const at = this.at;
    car.local(lx, ly, z, v2a);
    at.follow = index;
    at.ox = Math.round(v2a.x);
    at.oy = Math.round(v2a.y);
    at.x = car.x + at.ox;
    at.y = car.y + at.oy;
    at.vx = car.vx;
    at.vy = car.vy;
    return at;
  }

  /**
   * A world position reported for a car at a tick, as a point on that car where it is drawn
   * now. Falls back to the plain world point when the car's pose at that tick is unknown.
   */
  atCar(index: number, x: number, y: number, tick: number, z = BODY_HEIGHT): At {
    const car = this.cars[index];
    if (!car || !car.present || !this.history[index]!.sample(tick, scratchPose))
      return this.atWorld(x, y);
    const dx = x - scratchPose.x;
    const dy = y - scratchPose.y;
    const c = Math.cos(scratchPose.heading);
    const s = Math.sin(scratchPose.heading);
    const rig = car.rig!;
    // Onto the body: a point reported a pixel outside the hull is still a hit on the hull.
    const lx = clamp(dx * c + dy * s, -rig.halfWidth - 2, rig.halfWidth + 2);
    const ly = clamp(-dx * s + dy * c, -rig.halfLength - 2, rig.halfLength + 2);
    return this.atLocal(index, lx, ly, z);
  }

  /** The muzzle of a mounted part. Returns the heading the part points along on screen. */
  atMuzzle(index: number, part: number, barrel = 0): number {
    const car = this.cars[index]!;
    const at = this.at;
    car.muzzleOffset(part, barrel, v2a);
    at.follow = index;
    at.ox = Math.round(v2a.x);
    at.oy = Math.round(v2a.y);
    at.x = car.x + at.ox;
    at.y = car.y + at.oy;
    at.vx = car.vx;
    at.vy = car.vy;
    return car.partHeading(part);
  }

  /** The centre of a component, as a point on the car. */
  atComponent(index: number, component: number): At {
    const car = this.cars[index]!;
    car.componentLocal(component, comp);
    return this.atLocal(index, comp.x, comp.y, comp.z);
  }

  // --- Things the weapon table asks for ------------------------------------------------------------

  /** Knocks a part back along its own facing; it eases home by itself. */
  kickPart(index: number, part: number, pixels: number): void {
    const car = this.cars[index];
    if (car && part >= 0 && part < MAX_PARTS) car.partKick[part] = pixels;
  }

  /** Turns a part's sprite from one extra angle to another over some seconds. */
  swingPart(index: number, part: number, from: number, to: number, seconds: number): void {
    const car = this.cars[index];
    if (!car || part < 0 || part >= MAX_PARTS) return;
    car.partTurnFrom[part] = from;
    car.partTurnTo[part] = to;
    car.partTurnTime[part] = 0;
    car.partTurnSpan[part] = Math.max(0.01, seconds);
    car.partTurn[part] = from;
  }

  chargePart(index: number, part: number, seconds: number): void {
    const car = this.cars[index];
    if (!car || part < 0 || part >= MAX_PARTS) return;
    car.chargeAge[part] = 1e-4;
    car.chargeSpan[part] = seconds;
  }

  flashComponent(index: number, component: number, seconds = 0.07): void {
    const car = this.cars[index];
    if (!car) return;
    // The whole body goes white for one frame only: longer reads as a glitch, not a hit.
    if (component < 0) car.bodyFlash = Math.min(seconds, 0.017);
    else if (component < car.flash.length) car.flash[component] = seconds;
  }

  /** A small believable recoil of the whole car away from a blow (Section 13.6). */
  recoilCar(index: number, dx: number, dy: number, pixels: number, bounce = 0): void {
    const car = this.cars[index];
    if (!car) return;
    const m = Math.hypot(dx, dy) || 1;
    car.recoilX = (dx / m) * pixels;
    car.recoilY = (dy / m) * pixels;
    car.recoilTime = 0.11;
    if (bounce > 0 && car.lift <= 0.01) car.liftVelocity = bounce;
  }

  stream(
    kind: number,
    index: number,
    part: number,
    seconds: number,
    dir: number,
    half: number,
    range: number,
    seed: number,
  ): void {
    let slot = this.streams.find((s) => !s.active);
    if (!slot) slot = this.streams[0]!;
    slot.active = true;
    slot.kind = kind;
    slot.car = index;
    slot.part = part;
    slot.left = seconds;
    slot.dir = dir;
    slot.half = half;
    slot.range = range;
    slot.timer = 0;
    slot.seed = seed;
  }

  setLock(index: number, part: number, target: number, locked: boolean): void {
    let slot = this.locks.find((l) => l.active && l.car === index && l.part === part);
    if (!locked) {
      if (slot) slot.active = false;
      return;
    }
    if (!slot) slot = this.locks.find((l) => !l.active) ?? this.locks[0]!;
    slot.active = true;
    slot.car = index;
    slot.part = part;
    slot.target = target;
    slot.age = 0;
    slot.hot = 0;
  }

  /** The projectile a weapon's event refers to, if it is still being drawn. */
  projectile(id: number): ProjectileView | null {
    return this.projectileById.get(id) ?? null;
  }

  endProjectile(id: number): void {
    const view = this.projectileById.get(id);
    if (view) this.dropProjectile(view);
  }

  hazard(id: number): HazardView | null {
    return this.hazardById.get(id) ?? null;
  }

  /** A sprite fixed to a point on a car for a moment. */
  onCar(anim: number, at: At, layer = -1): number {
    const s = this.pool.spawn(
      anim,
      at.follow >= 0 ? at.ox : at.x,
      at.follow >= 0 ? at.oy : at.y,
      layer,
      false,
    );
    if (s >= 0) this.pool.follow[s] = at.follow;
    return s;
  }

  // --- Events ------------------------------------------------------------------------------------

  private dispatch(event: RaceEvent): void {
    this.handled[event.type] = (this.handled[event.type] ?? 0) + 1;
    EVENT_HANDLERS[event.type](this, event as never);
  }

  /** The identity of the weapon an event names, or the generic one for anything else. */
  weapon(id: string): (typeof WEAPON_FX)[string] {
    return WEAPON_FX[id] ?? GENERIC_FX;
  }

  // --- Cars --------------------------------------------------------------------------------------

  private updateCar(index: number, dt: number): void {
    const car = this.cars[index]!;
    const rig = car.rig;
    if (!car.present || !rig) return;
    const tick = this.renderTick;
    const fx = this.fx;
    const pool = this.pool;
    const px = this.px;
    const a = this.a;
    const speed = Math.hypot(car.vx, car.vy);
    fx.seed((Math.floor(this.clock * 60) * 31 + index * 7919) | 0);

    // Timers and eased values.
    if (car.recoilTime > 0) {
      car.recoilTime -= dt;
      if (car.recoilTime <= 0) {
        car.recoilX = 0;
        car.recoilY = 0;
      }
    }
    if (car.bodyFlash > 0) car.bodyFlash -= dt;
    if (car.outline > 0) car.outline -= dt;
    if (car.shieldRipple > 0) car.shieldRipple -= dt;
    if (car.sparkle > 0) car.sparkle -= dt;
    for (let i = 0; i < car.flash.length; i++) if (car.flash[i]! > 0) car.flash[i]! -= dt;
    for (let i = 0; i < rig.parts.length; i++) {
      if (car.partKick[i]! > 0) car.partKick[i] = Math.max(0, car.partKick[i]! - dt * 26);
      if (car.partTurnSpan[i]! > 0) {
        const t = (car.partTurnTime[i]! += dt) / car.partTurnSpan[i]!;
        if (t >= 1) {
          car.partTurn[i] = car.partTurnTo[i]!;
          car.partTurnSpan[i] = 0;
        } else
          car.partTurn[i] = car.partTurnFrom[i]! + (car.partTurnTo[i]! - car.partTurnFrom[i]!) * t;
      }
      if (car.chargeAge[i]! > 0) {
        car.chargeAge[i]! += dt;
        if (car.chargeAge[i]! > car.chargeSpan[i]! + 0.1) car.chargeAge[i] = 0;
      }
    }
    for (let i = 0; i < rig.wheelCount; i++) {
      if (car.wheelDrop[i]! >= 0) {
        car.wheelDrop[i]! += dt;
        if (car.wheelDrop[i]! > 0.22) car.wheelDrop[i] = -1;
      }
    }
    car.shieldPhase += dt * 0.12;

    // Height: a jump is an arc over the status's own length; a bounce is a quick hop.
    const airborne = car.has('airborne', tick);
    if (airborne) {
      const until = car.statusUntil[statusSlot('airborne')]!;
      const span = 14;
      const k = clamp(1 - (until - tick) / span, 0, 1);
      car.lift = Math.round(Math.sin(k * Math.PI) * 13);
      car.liftVelocity = 0;
      car.hop = 1;
    } else {
      if (car.hop > 0) {
        // Down again: dust under all four wheels and a squat.
        car.hop = 0;
        car.lift = 0;
        this.atLocal(index, 0, 0, 0);
        fx.dustDisc(8, this.at, 70, true);
        this.recoilCar(index, 0, 1, 1);
      }
      if (car.liftVelocity !== 0 || car.lift > 0) {
        car.liftVelocity -= 190 * dt;
        car.lift = Math.max(0, car.lift + car.liftVelocity * dt);
        if (car.lift === 0) car.liftVelocity = 0;
      }
    }
    if (car.recoilTime > 0) {
      car.bodyShiftX += Math.round(car.recoilX);
      car.bodyShiftY += Math.round(car.recoilY);
    }

    this.dueCar = car;
    this.dueDt = dt;
    const tier = car.damageTier();

    // --- Engine: smoke that stays low in opacity, then sparks, then a small fire (Section 12.8)
    const engine = car.condition(0);
    if (engine > 0 && this.due(0, engine === 1 ? 0.2 : engine === 2 ? 0.1 : 0.07)) {
      car.componentLocal(0, comp);
      this.atLocal(index, comp.x, comp.y, comp.z);
      const at = this.at;
      const s = pool.spawn(a.smoke_dark_s, at.x + (fx.r() - 0.5) * 3, at.y, LAYER_SMOKE);
      if (s >= 0) {
        pool.vx[s] = car.vx * 0.25 + (fx.r() - 0.5) * 10;
        pool.vy[s] = car.vy * 0.25 - 12;
        pool.drag[s] = 1.5;
        pool.alpha[s] = engine === 1 ? 0.4 : 0.55;
        pool.fade[s] = 0.25;
      }
      if (engine >= 2 && fx.r() < 0.4) fx.sparks(2, at, 30, 90, PAL_SPARK, TAU, 0, 40);
    }
    if (engine === 3 && this.due(1, 0.34)) {
      car.componentLocal(0, comp);
      this.atLocal(index, comp.x + (fx.r() - 0.5) * 5, comp.y + (fx.r() - 0.5) * 5, comp.z);
      const s = this.onCar(a.flame_lick, this.at, LAYER_FIRE);
      if (s >= 0) pool.life[s] = 0.42;
    }

    // --- Steering: the rack spits a spark now and then
    if (car.condition(1) > 0 && this.due(2, car.condition(1) === 1 ? 1.1 : 0.45)) {
      car.componentLocal(1, comp);
      this.atLocal(index, comp.x + (fx.r() - 0.5) * 8, comp.y, comp.z);
      fx.sparks(3, this.at, 30, 80, PAL_AMBER, TAU, 0, 40);
    }

    // --- Wheels: rubber scraps from a damaged one, sparks and smoke from a bare rim
    for (let w = 0; w < rig.wheelCount; w++) {
      const state = car.condition(COMPONENT_FIRST_WHEEL + w);
      if (state === 0 || speed < 14) continue;
      if (!this.due(3 + w, state === 1 ? 0.3 : state === 2 ? 0.14 : 0.05)) continue;
      const anchor = rig.chassis.wheelAnchors[w]!;
      this.atLocal(index, anchor.x, anchor.y, 1);
      const at = this.at;
      if (state === 3) {
        fx.sparks(2, at, 20, 70, PAL_SPARK, 1.4, car.heading + Math.PI, 30);
        if (fx.r() < 0.3) fx.puff(at.x, at.y, car.vx * 0.2, car.vy * 0.2, 0x8b93a8, 0.5, true);
      } else {
        px.pixel(
          at.x,
          at.y,
          -car.vx * 0.2 + (fx.r() - 0.5) * 50,
          -car.vy * 0.2 + (fx.r() - 0.5) * 50,
          0.2 + fx.r() * 0.3,
          PAL_RUBBER,
          1,
          40 + fx.r() * 40,
          300,
          1,
          2,
          -1,
          state === 2 ? 2 : 1,
        );
        if (state === 2 && fx.r() < 0.35)
          fx.puff(at.x, at.y, car.vx * 0.2, car.vy * 0.2, 0x8b93a8, 0.45, true);
      }
    }

    // --- Mounted parts: a damaged one sparks, a critical one smokes, a dead one smoulders
    for (let i = 0; i < rig.parts.length; i++) {
      const state = car.condition(car.partComponent(i));
      if (state === 0 || car.partHidden[i]) continue;
      if (!this.due(9 + (i % 8), state === 1 ? 1.3 : state === 2 ? 0.4 : 0.7)) continue;
      this.atComponent(index, car.partComponent(i));
      const at = this.at;
      if (state === 3) {
        const s = pool.spawn(a.smoke_dark_s, at.x, at.y, LAYER_SMOKE);
        if (s >= 0) {
          pool.vx[s] = car.vx * 0.25;
          pool.vy[s] = car.vy * 0.25 - 10;
          pool.alpha[s] = 0.4;
          pool.fade[s] = 0.25;
        }
      } else {
        fx.sparks(state === 1 ? 2 : 4, at, 30, 90, PAL_SPARK, TAU, 0, 50);
        if (state === 2) fx.puff(at.x, at.y, car.vx * 0.2, car.vy * 0.2 - 8, 0x8b93a8, 0.45, true);
      }
    }

    // --- Chassis tiers: progressive smoke, then flames on a car that is limping
    if (tier >= 2 && this.due(17, tier === 2 ? 0.26 : 0.12)) {
      this.atLocal(
        index,
        (fx.r() - 0.5) * rig.halfWidth,
        (fx.r() - 0.5) * rig.halfLength,
        BODY_HEIGHT,
      );
      const at = this.at;
      const s = pool.spawn(
        tier === 3 && fx.r() < 0.5 ? a.smoke_dark_a : a.smoke_dark_s,
        at.x,
        at.y,
        LAYER_SMOKE,
      );
      if (s >= 0) {
        pool.vx[s] = car.vx * 0.2 + (fx.r() - 0.5) * 8;
        pool.vy[s] = car.vy * 0.2 - 10;
        pool.drag[s] = 1.4;
        pool.alpha[s] = 0.5 - fx.host.nearPlayer(at.x, at.y) * 0.2;
        pool.fade[s] = 0.3;
      }
    }
    if ((tier === 3 || car.ko) && this.due(18, car.ko ? 0.2 : 0.45)) {
      this.atLocal(
        index,
        (fx.r() - 0.5) * rig.halfWidth * 1.2,
        (fx.r() - 0.5) * rig.halfLength * 1.2,
        BODY_HEIGHT,
      );
      const s = this.onCar(a.flame_lick, this.at, LAYER_FIRE);
      if (s >= 0) pool.life[s] = 0.5;
      if (car.ko) fx.sparks(2, this.at, 20, 70, PAL_SPARK, TAU, 0, 40);
    }

    // --- Statuses ----------------------------------------------------------------------------
    if (car.has('burn', tick) && this.due(19, 0.09)) {
      this.atLocal(
        index,
        car.burnX + (fx.r() - 0.5) * 9,
        car.burnY + (fx.r() - 0.5) * 9,
        BODY_HEIGHT,
      );
      const s = this.onCar(a.flame_lick, this.at, LAYER_FIRE);
      if (s >= 0) pool.life[s] = 0.34 + fx.r() * 0.2;
      if (fx.r() < 0.5) fx.embers(1, this.at, 4);
      if (fx.r() < 0.35)
        fx.smoke(this.at.x, this.at.y - 6, car.vx * 0.3, car.vy * 0.3 - 14, 0, true);
    }
    if (car.has('emp', tick) && this.due(20, 0.07)) {
      // Arcs crawl over the bodywork and jump off its corners.
      this.atLocal(
        index,
        (fx.r() - 0.5) * rig.halfWidth * 2,
        (fx.r() - 0.5) * rig.halfLength * 2,
        BODY_HEIGHT,
      );
      fx.sparks(2, this.at, 30, 100, fx.r() < 0.5 ? PAL_CYAN : PAL_VIOLET, TAU, 0, 0);
      if (fx.r() < 0.3) {
        const s = this.onCar(a.zap, this.at, LAYER_FLASH);
        if (s >= 0) pool.alpha[s] = this.reduceFlashes ? 0.6 : 1;
      }
    }
    if (car.has('jam', tick) && this.due(21, 0.06)) {
      const n = rig.parts.length;
      if (n > 0) {
        this.atComponent(index, car.partComponent(Math.floor(fx.r() * n)));
        fx.sparks(2, this.at, 20, 70, PAL_VIOLET, TAU, 0, 0);
      }
    }
    const grip = car.has('grip', tick);
    if (grip && car.gripSource === SOURCE_FROST && this.due(22, 0.12)) {
      const w = rig.chassis.wheelAnchors[Math.floor(fx.r() * rig.wheelCount)]!;
      this.atLocal(index, w.x, w.y, 3);
      px.pixel(
        this.at.x,
        this.at.y,
        -car.vx * 0.1 + (fx.r() - 0.5) * 40,
        -car.vy * 0.1 + (fx.r() - 0.5) * 40,
        0.25 + fx.r() * 0.3,
        PAL_ICE,
        1,
        30,
        200,
        2,
        3,
      );
    }
    if (grip && car.gripSource !== SOURCE_FROST && speed > 30 && this.due(22, 0.05)) {
      // Oil: dark spray off the tires and gray sideways streaks. No fire.
      const wi = Math.floor(fx.r() * rig.wheelCount);
      const w = rig.chassis.wheelAnchors[wi]!;
      this.atLocal(index, w.x, w.y, 1);
      const at = this.at;
      px.pixel(
        at.x,
        at.y,
        -car.vx * 0.3 + (fx.r() - 0.5) * 70,
        -car.vy * 0.3 + (fx.r() - 0.5) * 70,
        0.2 + fx.r() * 0.25,
        PAL_OIL,
        2,
        30 + fx.r() * 30,
        280,
        1,
        1,
        -1,
        2,
      );
      this.host.skid(
        at.x,
        at.y,
        Math.atan2(car.vy, car.vx) + Math.PI / 2 + (fx.r() - 0.5) * 0.5,
        false,
      );
    }
    const slow = car.has('slow', tick);
    if (slow && car.slowSource === SOURCE_FOAM && this.due(11, 0.25)) {
      // Foam sticks in clumps round the wheels for as long as the car is held back.
      for (let w = 0; w < rig.wheelCount; w++) {
        const anchor = rig.chassis.wheelAnchors[w]!;
        this.atLocal(index, anchor.x * 1.1, anchor.y, 3);
        const s = this.onCar(a.foam_clump, this.at);
        if (s < 0) continue;
        pool.mode[s] = MODE_FIXED;
        pool.frame0[s] = (w + car.foamSeed) % 3;
        pool.life[s] = 0.34;
      }
    }
    if (slow && car.slowSource === SOURCE_FOAM && this.due(23, 0.14)) {
      const w = rig.chassis.wheelAnchors[Math.floor(fx.r() * rig.wheelCount)]!;
      this.atLocal(index, w.x, w.y, 2);
      const s = pool.spawn(a.foam_bit, this.at.x, this.at.y);
      if (s >= 0) {
        // Peeling fragments: flung back off the wheel, stretching as they go.
        pool.mode[s] = MODE_FIXED;
        pool.frame0[s] = Math.floor(fx.r() * 4);
        pool.vx[s] = -car.vx * 0.3 + (fx.r() - 0.5) * 40;
        pool.vy[s] = -car.vy * 0.3 + (fx.r() - 0.5) * 40;
        pool.vz[s] = 40;
        pool.gravity[s] = 260;
        pool.life[s] = 0.5;
        pool.fade[s] = 0.15;
      }
    }
    if (car.has('boost', tick)) {
      if (this.due(15, 0.03)) {
        // Short speed streaks beside the car: blue for nitro (Section 12.8).
        this.atLocal(
          index,
          (fx.r() < 0.5 ? -1 : 1) * (rig.halfWidth + 2 + fx.r() * 4),
          (fx.r() - 0.5) * rig.halfLength * 2,
          3,
        );
        px.pixel(this.at.x, this.at.y, -car.vx * 0.5, -car.vy * 0.5, 0.14, PAL_CYAN, 3, 0, 0, 1);
      }
      if (this.due(12, 0.05)) {
        // Bright exhaust flames: a jet at every pipe, pointing aft, flickering between lengths.
        for (const anchor of rig.chassis.exhausts) {
          this.atLocal(index, anchor.x, anchor.y, 3);
          const s = this.onCar(a.jet, this.at);
          if (s < 0) continue;
          pool.aim(s, car.frameHeading + Math.PI);
          pool.tint[s] = car.statusMagnitude[statusSlot('boost')]! > 0.55 ? 0x7fe9f5 : 0xffb454;
          pool.life[s] = 0.07;
          pool.age[s] = fx.r() * 0.1;
          pool.mode[s] = MODE_LOOP;
          if (this.reduceFlashes) pool.alpha[s] = 0.7;
        }
      }
    }
    if (car.has('refit', tick) && this.due(16, 0.06)) {
      // Work in progress: weld sparks from under the car.
      this.atLocal(index, (fx.r() - 0.5) * rig.halfWidth * 2, (fx.r() - 0.5) * rig.halfLength, 3);
      fx.sparks(2, this.at, 30, 90, PAL_MINT, TAU, 0, 50);
    }
    if (car.sparkle > 0 && this.due(14, 0.04)) {
      this.atLocal(
        index,
        (fx.r() - 0.5) * rig.halfWidth * 3,
        (fx.r() - 0.5) * rig.halfLength * 2.4,
        8,
      );
      px.pixel(
        this.at.x,
        this.at.y,
        (fx.r() - 0.5) * 30,
        -20 - fx.r() * 30,
        0.4 + fx.r() * 0.3,
        PAL_GOLD,
        1,
        30,
        0,
        1.5,
        6,
        -1,
        fx.r() < 0.3 ? 2 : 1,
      );
    }

    // The rival's exhaust: the local car's comes from its own telemetry in the race scene.
    if (index !== this.you && !car.ko && this.due(13, speed > 40 ? 0.16 : 0.4)) {
      const fxv = Math.sin(car.heading);
      const fyv = -Math.cos(car.heading);
      for (const anchor of rig.chassis.exhausts) {
        car.local(anchor.x, anchor.y, 3, v2a);
        this.host.exhaust(
          car.x + v2a.x,
          car.y + v2a.y,
          car.vx * 0.35 - fxv * 34,
          car.vy * 0.35 - fyv * 34,
        );
      }
    }
  }

  private dueCar: CarState | null = null;
  private dueDt = 0;

  /** True when an emitter's clock has run out; it is then wound again, a little unevenly. */
  private due(slot: number, every: number): boolean {
    const timers = this.dueCar!.timers;
    timers[slot]! -= this.dueDt;
    if (timers[slot]! > 0) return false;
    timers[slot] = every * (0.75 + this.fx.r() * 0.5);
    return true;
  }

  // --- Projectiles -------------------------------------------------------------------------------

  private syncProjectiles(race: RaceSnapshot): void {
    for (const p of race.projectiles) {
      let view = this.projectileById.get(p.id);
      if (!view) {
        view = this.projectiles.find((v) => !v.active);
        if (!view) continue;
        this.startProjectile(view, p);
      }
      if (p.tick !== view.btick) {
        view.ax = view.bx;
        view.ay = view.by;
        view.atick = view.btick;
        view.bx = p.x;
        view.by = p.y;
        view.bvx = p.vx;
        view.bvy = p.vy;
        view.btick = p.tick;
      }
      view.landTick = p.landTick;
      view.seenTick = race.tick;
      view.goneTick = 0;
    }
    for (const view of this.projectiles)
      if (view.active && view.seenTick < race.tick && view.goneTick === 0)
        view.goneTick = race.tick;
  }

  private startProjectile(view: ProjectileView, p: ProjectileSnapshot): void {
    view.active = true;
    view.id = p.id;
    view.kind = p.kind;
    view.owner = p.owner;
    view.weapon = this.projectileWeapon.get(p.id) ?? '';
    view.sprite = -1;
    view.shadow = -1;
    view.ax = view.bx = p.x;
    view.ay = view.by = p.y;
    view.bvx = p.vx;
    view.bvy = p.vy;
    view.atick = view.btick = p.tick;
    view.launchTick = p.tick;
    view.launchX = p.x;
    view.launchY = p.y;
    view.landTick = p.landTick;
    view.goneTick = 0;
    view.x = p.x;
    view.y = p.y;
    view.z = 0;
    view.heading = Math.atan2(p.vx, -p.vy);
    view.trail = 0;
    view.returning = false;
    view.shown = false;
    this.projectileById.set(p.id, view);
  }

  private dropProjectile(view: ProjectileView): void {
    this.pool.release(view.sprite);
    this.pool.release(view.shadow);
    view.sprite = -1;
    view.shadow = -1;
    view.active = false;
    this.projectileById.delete(view.id);
  }

  private updateProjectiles(dt: number): void {
    const tick = this.renderTick;
    const pool = this.pool;
    const a = this.a;
    for (const view of this.projectiles) {
      if (!view.active) continue;
      if (view.goneTick > 0 && tick >= view.goneTick) {
        this.dropProjectile(view);
        continue;
      }
      if (tick < view.launchTick) continue;
      // Where it is at the render clock: between its two last records, or along its velocity.
      let x: number;
      let y: number;
      if (tick < view.btick && view.atick < view.btick) {
        const k = clamp((tick - view.atick) / (view.btick - view.atick), 0, 1);
        x = view.ax + (view.bx - view.ax) * k;
        y = view.ay + (view.by - view.ay) * k;
      } else {
        const t = (tick - view.btick) * SIM_DT;
        x = view.bx + view.bvx * t;
        y = view.by + view.bvy * t;
      }
      if (Math.abs(view.bvx) + Math.abs(view.bvy) > 1)
        view.heading = Math.atan2(view.bvx, -view.bvy);
      view.x = x;
      view.y = y;
      const fxSet = this.weapon(view.weapon);
      const lobbed = view.kind === 'foam' || view.kind === 'shell';
      if (lobbed && view.landTick > view.launchTick) {
        const k = clamp((tick - view.launchTick) / (view.landTick - view.launchTick), 0, 1);
        view.z = (view.kind === 'shell' ? 90 : 34) * 4 * k * (1 - k);
      }
      if (!view.shown) {
        view.shown = true;
        const anim = fxSet.projectile ?? PROJECTILE_ANIM[view.kind];
        view.sprite = pool.pin(a[anim], x, y, lobbed ? LAYER_FIRE : -1);
        if (lobbed) {
          view.shadow = pool.pin(a.shadow_blob, x, y, LAYER_GROUND);
          if (view.shadow >= 0) pool.mode[view.shadow] = MODE_FIXED;
          if (view.sprite >= 0) pool.mode[view.sprite] = MODE_FIXED;
        }
      }
      const s = view.sprite;
      if (s >= 0) {
        pool.x[s] = Math.round(x * this.scale) / this.scale;
        pool.y[s] = Math.round(y * this.scale) / this.scale;
        pool.z[s] = view.z;
        if (lobbed) {
          // Nearer the camera at the top of its arc: a larger frame, and a smaller shadow.
          const size = clamp(Math.floor((view.z / (view.kind === 'shell' ? 90 : 34)) * 3.99), 0, 3);
          pool.frame0[s] = size;
          const sh = view.shadow;
          if (sh >= 0) {
            pool.x[sh] = pool.x[s]!;
            pool.y[sh] = pool.y[s]!;
            pool.frame0[sh] = 3 - size;
          }
        } else if (this.atlas.directions[pool.anim[s]!]! > 1) pool.aim(s, view.heading);
      }
      view.trail -= dt;
      if (view.trail <= 0 && fxSet.trail) view.trail = fxSet.trail(this, view);
    }
  }

  // --- Hazards -----------------------------------------------------------------------------------

  private syncHazards(race: RaceSnapshot): void {
    for (const h of race.hazards) {
      let view = this.hazardById.get(h.id);
      if (!view) {
        view = this.hazards.find((v) => !v.active);
        if (!view) continue;
        view.active = true;
        view.id = h.id;
        view.kind = h.kind;
        view.age = 0;
        view.count = 0;
        view.pulse = 0;
        view.timer = 0;
        view.x = h.x;
        view.y = h.y;
        view.sprites.fill(-1);
        this.hazardById.set(h.id, view);
      } else if (view.kind !== h.kind) {
        // Oil that caught fire keeps its id and its shape: the sprites are laid again.
        this.clearHazardSprites(view, 0);
        view.kind = h.kind;
        view.age = 0;
      }
      this.readHazard(view, h);
      view.seenTick = race.tick;
      view.goneTick = 0;
    }
    for (const view of this.hazards)
      if (view.active && view.seenTick < race.tick && view.goneTick === 0)
        view.goneTick = race.tick;
  }

  private readHazard(view: HazardView, h: HazardSnapshot): void {
    view.owner = h.owner;
    if (h.kind === 'decoy') {
      view.x += (h.x - view.x) * 0.5;
      view.y += (h.y - view.y) * 0.5;
    } else {
      view.x = h.x;
      view.y = h.y;
    }
    view.radius = h.radius;
    view.halfLength = h.halfLength;
    view.angle = h.angle;
    view.armedTick = h.armedTick;
    view.endTick = h.endTick;
    view.revealed = h.revealed;
  }

  private clearHazardSprites(view: HazardView, fadeSeconds: number): void {
    for (let i = 0; i < view.count; i++) {
      const s = view.sprites[i]!;
      if (fadeSeconds > 0) this.pool.retire(s, fadeSeconds);
      else this.pool.release(s);
      view.sprites[i] = -1;
    }
    view.count = 0;
  }

  /** Ends a hazard's drawing. Its sprites fade unless something else replaces them. */
  endHazard(id: number, fadeSeconds: number): void {
    const view = this.hazardById.get(id);
    if (!view) return;
    this.clearHazardSprites(view, fadeSeconds);
    view.active = false;
    this.hazardById.delete(id);
  }

  /** Places the blobs of an area hazard along its real shape: a strip or a disc. */
  private layHazard(view: HazardView, anims: readonly number[], layer: number): void {
    const pool = this.pool;
    const strip = view.halfLength > 0;
    const count = strip
      ? clamp(Math.round((view.halfLength * 2) / 10) + 1, 3, HAZARD_SPRITES)
      : clamp(Math.round(view.radius / 6), 3, HAZARD_SPRITES);
    const ax = Math.sin(view.angle);
    const ay = -Math.cos(view.angle);
    for (let i = 0; i < count; i++) {
      let x = view.x;
      let y = view.y;
      const jitter = hash2(i, view.id, 5) - 0.5;
      if (strip) {
        const along = (i / (count - 1) - 0.5) * 2 * (view.halfLength - 6);
        const across = jitter * Math.max(0, view.radius - 8) * 1.4;
        x += ax * along - ay * across;
        y += ay * along + ax * across;
      } else if (i > 0) {
        const ang = ((i - 1) / (count - 1)) * TAU + view.id;
        const d = Math.max(0, view.radius - 10) * (0.75 + jitter * 0.3);
        x += Math.cos(ang) * d;
        y += Math.sin(ang) * d;
      }
      const s = pool.pin(anims[(i + view.id) % anims.length]!, Math.round(x), Math.round(y), layer);
      view.sprites[i] = s;
      if (s < 0) continue;
      // Each blob starts a little after the last, so a spill visibly runs along the road.
      pool.delay[s] = strip ? i * 0.035 : i * 0.02;
      // Growth is quick (a spill spreads in a fifth of a second); the idle loop is slow.
      if (layer !== LAYER_FIRE) pool.fps[s] = 14;
      pool.age[s] = hash2(i, view.id, 9) * (layer === LAYER_FIRE ? 0.6 : 0);
    }
    view.count = count;
  }

  private updateHazards(dt: number): void {
    const tick = this.renderTick;
    const pool = this.pool;
    const a = this.a;
    const fx = this.fx;
    for (const view of this.hazards) {
      if (!view.active) continue;
      if (view.goneTick > 0 && tick >= view.goneTick) {
        this.endHazard(view.id, 0.25);
        continue;
      }
      // A trap an enemy laid stays unseen until the server says this driver may see it.
      if (!view.revealed) {
        if (view.count > 0) this.clearHazardSprites(view, 0);
        continue;
      }
      view.age += dt;
      if (view.pulse > 0) view.pulse -= dt;
      fx.seed((view.id * 977 + Math.floor(this.clock * 30)) | 0);
      if (view.count === 0) {
        switch (view.kind) {
          case 'mine': {
            const s = pool.pin(a.mine, Math.round(view.x), Math.round(view.y), LAYER_GROUND);
            view.sprites[0] = s;
            view.count = 1;
            if (s >= 0) {
              pool.mode[s] = MODE_FIXED;
              // It drops from the hatch and settles.
              pool.z[s] = 5;
              pool.vz[s] = 10;
              pool.gravity[s] = 240;
              pool.bounce[s] = 0.3;
            }
            break;
          }
          case 'oil':
            this.layHazard(view, [a.oil_a, a.oil_b, a.oil_c], LAYER_GROUND);
            break;
          case 'foam':
            this.layHazard(view, [a.foam_a, a.foam_b], LAYER_GROUND);
            break;
          case 'frost':
            this.layHazard(view, [a.frost_a, a.frost_b], LAYER_GROUND);
            break;
          case 'fire':
            this.layHazard(view, [a.fire_a, a.fire_b], LAYER_FIRE);
            break;
          default: {
            const s = pool.pin(a.decoy, view.x, view.y, LAYER_BODY);
            const sh = pool.pin(a.shadow_blob, view.x, view.y, LAYER_GROUND);
            view.sprites[0] = s;
            view.sprites[1] = sh;
            view.count = 2;
            if (s >= 0) pool.z[s] = 14;
            if (sh >= 0) {
              pool.mode[sh] = MODE_FIXED;
              pool.frame0[sh] = 1;
            }
          }
        }
      }
      const first = view.sprites[0]!;
      switch (view.kind) {
        case 'mine':
          if (first >= 0) {
            const armed = tick >= view.armedTick;
            // Arming: a quick amber blink. Live: a slower red one. The lamp is the countdown.
            const on = armed
              ? Math.floor(view.age * 3) % 3 === 0
              : Math.floor(view.age * 9) % 2 === 0;
            pool.frame0[first] = armed ? (on ? 3 : 2) : on ? 1 : 0;
          }
          break;
        case 'oil':
        case 'foam':
        case 'frost':
          // A blob plays its growth once and then holds its idle loop.
          for (let i = 0; i < view.count; i++) {
            const s = view.sprites[i]!;
            if (s < 0 || pool.mode[s] !== MODE_LOOP) continue;
            const grow = BLOB_GROW_FRAMES / pool.fps[s]!;
            if (pool.age[s]! >= grow) {
              pool.mode[s] = MODE_FIXED;
              pool.frame0[s] = BLOB_GROW_FRAMES;
            }
          }
          if (view.age > BLOB_GROW_FRAMES / 4 + 0.3) {
            const phase = Math.floor(view.age * 3);
            for (let i = 0; i < view.count; i++) {
              const s = view.sprites[i]!;
              if (s >= 0 && pool.mode[s] === MODE_FIXED)
                pool.frame0[s] =
                  BLOB_GROW_FRAMES +
                  ((phase + i) %
                    Math.max(1, this.atlas.timeFrames[pool.anim[s]!]! - BLOB_GROW_FRAMES));
            }
          }
          if (view.kind === 'frost') {
            view.timer -= dt;
            if (view.timer <= 0) {
              view.timer = 0.3;
              const ang = fx.r() * TAU;
              const d = fx.r() * view.radius;
              this.px.pixel(
                view.x + Math.cos(ang) * d,
                view.y + Math.sin(ang) * d,
                0,
                -6,
                0.3,
                PAL_ICE,
                1,
                0,
                0,
                1,
                2,
                -1,
                1,
              );
            }
          }
          break;
        case 'fire':
          view.timer -= dt;
          if (view.timer <= 0) {
            view.timer = 0.11;
            // Embers and a little smoke rise off the strip; light pools under it.
            const along = (fx.r() - 0.5) * 2 * Math.max(view.halfLength, view.radius);
            const x = view.x + Math.sin(view.angle) * along;
            const y = view.y - Math.cos(view.angle) * along;
            this.px.pixel(
              x,
              y,
              (fx.r() - 0.5) * 20,
              -10,
              0.5 + fx.r() * 0.5,
              PAL_EMBER,
              1,
              40 + fx.r() * 30,
              0,
              1,
              6,
            );
            if (fx.r() < 0.3) fx.smoke(x, y - 10, 0, -14, 0, true);
            if (fx.r() < 0.5) fx.glow(a.glow_m, x, y, 0xff8a3c, 0.5, 0.3);
          }
          break;
        default:
          if (first >= 0) {
            // The drone bobs on its rotors.
            pool.x[first] = view.x;
            pool.y[first] = view.y;
            pool.z[first] = 14 + Math.sin(view.age * 7) * 1.5;
            const sh = view.sprites[1]!;
            if (sh >= 0) {
              pool.x[sh] = view.x;
              pool.y[sh] = view.y + 2;
            }
          }
      }
    }
  }

  // --- Streams, locks ------------------------------------------------------------------------------

  private updateStreams(dt: number): void {
    const pool = this.pool;
    const a = this.a;
    const fx = this.fx;
    for (const s of this.streams) {
      if (!s.active) continue;
      s.left -= dt;
      const car = this.cars[s.car]!;
      if (s.left <= 0 || !car.present) {
        s.active = false;
        continue;
      }
      s.timer -= dt;
      if (s.timer > 0) continue;
      fx.seed((s.seed + Math.floor(this.clock * 120)) | 0);
      const heading = this.atMuzzle(s.car, s.part);
      const at = this.at;
      if (s.kind === STREAM_FLAME) {
        s.timer = 0.022;
        // Staccato: the jet stutters, four beats on and one off.
        if (Math.floor(this.clock * 15) % 5 === 4) continue;
        const dir = heading + (fx.r() - 0.5) * 2 * s.half * 0.8;
        const speed = (s.range / 0.4) * (0.75 + fx.r() * 0.45);
        const f = pool.spawn(fx.r() < 0.5 ? a.flame_a : a.flame_b, at.x, at.y, LAYER_FIRE);
        if (f >= 0) {
          pool.vx[f] = Math.sin(dir) * speed + car.vx;
          pool.vy[f] = -Math.cos(dir) * speed + car.vy;
          pool.drag[f] = 1.2;
          pool.z[f] = 5;
          pool.life[f] = 0.42;
          pool.fps[f] = 19;
        }
        if (fx.r() < 0.25)
          this.px.pixel(
            at.x,
            at.y,
            Math.sin(dir) * speed * 1.2 + car.vx,
            -Math.cos(dir) * speed * 1.2 + car.vy,
            0.3,
            PAL_RUBBER,
            1,
            40,
            200,
            1,
            5,
          );
        if (fx.r() < 0.2)
          fx.glow(
            a.glow_m,
            at.x + Math.sin(heading) * s.range * 0.5,
            at.y - Math.cos(heading) * s.range * 0.5,
            0xff8a3c,
            0.6,
            0.12,
          );
      } else {
        s.timer = 0.012;
        // The saw throws its sparks along the blade's edge, back past the car.
        fx.sparks(3, at, 110, 280, PAL_SPARK, 1.1, car.heading + Math.PI, 70);
      }
    }
  }

  private updateLocks(dt: number): void {
    for (const lock of this.locks) {
      if (!lock.active) continue;
      lock.age += dt;
      if (lock.hot > 0) lock.hot -= dt;
    }
    if (this.warnLock > 0) this.warnLock -= dt;
  }

  /** The driver's own missile warning: the brackets on the local car turn hot. */
  heatLocks(target: number, seconds: number): void {
    for (const lock of this.locks) if (lock.active && lock.target === target) lock.hot = seconds;
    this.warnLock = seconds;
  }

  // --- Drawing the procedural parts ----------------------------------------------------------------

  /** Shapes that lie on the road, under the cars. */
  drawGround(sink: PixelSink): void {
    this.px.rects = 0;
    const tick = this.renderTick;
    for (const view of this.hazards) {
      if (!view.active || !view.revealed) continue;
      if (view.kind === 'mine') {
        // The clear hazard outline of Section 13.4: amber dashes while arming, red when live.
        const armed = tick >= view.armedTick;
        drawRing(
          sink,
          view.x,
          view.y,
          view.radius + 4,
          1,
          armed ? 0xf46b58 : 0xffb454,
          10,
          0.5,
          view.age * (armed ? 0.25 : 0.6),
          1,
        );
        if (view.pulse > 0)
          drawRing(
            sink,
            view.x,
            view.y,
            view.radius + 6 + (1 - view.pulse / 0.8) * 14,
            2,
            0xffe08a,
            0,
            1,
            0,
            1,
          );
      } else if (view.kind === 'fire') {
        // Fire shows its area with a marching outline, not with color alone (Section 8.5).
        const phase = view.age * 14;
        if (view.halfLength > 0) {
          const ax = Math.sin(view.angle);
          const ay = -Math.cos(view.angle);
          const hl = view.halfLength;
          const hw = view.radius;
          const x0 = view.x + ax * hl - ay * hw;
          const y0 = view.y + ay * hl + ax * hw;
          const x1 = view.x + ax * hl + ay * hw;
          const y1 = view.y + ay * hl - ax * hw;
          const x2 = view.x - ax * hl + ay * hw;
          const y2 = view.y - ay * hl - ax * hw;
          const x3 = view.x - ax * hl - ay * hw;
          const y3 = view.y - ay * hl + ax * hw;
          drawLine(sink, x0, y0, x1, y1, 0xffd35a, 1, 3, 3, phase);
          drawLine(sink, x1, y1, x2, y2, 0xffd35a, 1, 3, 3, phase);
          drawLine(sink, x2, y2, x3, y3, 0xffd35a, 1, 3, 3, phase);
          drawLine(sink, x3, y3, x0, y0, 0xffd35a, 1, 3, 3, phase);
        } else
          drawRing(
            sink,
            view.x,
            view.y,
            view.radius,
            1,
            0xffd35a,
            Math.max(8, Math.round(view.radius * 0.5)),
            0.5,
            view.age * 0.3,
            1,
          );
      } else if (view.pulse > 0)
        drawRing(
          sink,
          view.x,
          view.y,
          Math.max(view.radius, view.halfLength) + 4 + (1 - view.pulse / 0.8) * 12,
          2,
          0xffe08a,
          0,
          1,
          0,
          1,
        );
    }
    this.px.draw(sink, PLANE_GROUND, this.carX, this.carY);
  }

  /** Shapes drawn over the cars: beams, bolts, sparks, brackets, ropes, charge lights. */
  drawAir(sink: PixelSink): void {
    const tick = this.renderTick;
    this.px.draw(sink, PLANE_AIR, this.carX, this.carY);

    for (let index = 0; index < 2; index++) {
      const car = this.cars[index]!;
      const rig = car.rig;
      if (!car.present || !rig) continue;

      // Energy shield: a segmented outline that follows the car (Section 12.8).
      let shielded = false;
      for (let i = 0; i < rig.parts.length; i++)
        if (car.moduleUp[i] && rig.parts[i]!.kind === 'shield') shielded = true;
      if (shielded || car.shieldRipple > 0) {
        const rx = rig.halfWidth + 9;
        const ry = rig.halfLength + 9;
        const ripple = car.shieldRipple > 0 ? car.shieldRipple / 0.3 : 0;
        // One step a pixel of outline, so the segments are solid and the gaps are clean.
        const steps = Math.ceil(Math.PI * (rx + ry));
        const c = Math.cos(car.frameHeading);
        const s = Math.sin(car.frameHeading);
        for (let k = 0; k < steps; k++) {
          const u = k / steps;
          const seg = (u * 12 + car.shieldPhase * 12) % 1;
          if (seg > 0.62 && ripple <= 0) continue;
          const ang = u * TAU;
          const grow = 1 + ripple * 0.12;
          const lx = Math.cos(ang) * rx * grow;
          const ly = Math.sin(ang) * ry * grow;
          const near = ripple > 0 && Math.abs(angleDelta(ang, car.shieldRippleAngle)) < 0.9;
          if (!shielded && !near) continue;
          const color = near ? 0xffffff : seg < 0.2 ? 0xc8fbff : 0x46d5e6;
          sink.rect(
            Math.round(car.x + lx * c - ly * s),
            Math.round(car.y + lx * s + ly * c - 5 - car.lift),
            near ? 2 : 1,
            near ? 2 : 1,
            color,
            1,
          );
        }
      }

      for (let i = 0; i < rig.parts.length; i++) {
        const part = rig.parts[i]!;
        // Charge lights: cells that fill toward the muzzle, or posts that light in turn.
        const age = car.chargeAge[i]!;
        if (age > 0) {
          const k = clamp(age / Math.max(0.01, car.chargeSpan[i]!), 0, 1);
          car.partOffset(i, v2a);
          car.muzzleOffset(i, 0, v2b);
          if (part.kind === 'pulse') {
            const lit = Math.ceil(k * 4);
            for (let q = 0; q < 4; q++) {
              const ang = car.frameHeading + Math.PI / 4 + (q * Math.PI) / 2;
              const on = q < lit;
              const bx = Math.round(car.x + v2b.x + Math.cos(ang) * 5);
              const by = Math.round(car.y + v2b.y + 6 + Math.sin(ang) * 4);
              sink.rect(
                bx - 1,
                by - 1,
                2,
                2,
                on ? (q === lit - 1 ? 0xffffff : 0xc9a4ff) : 0x40306e,
                1,
              );
            }
            if (k > 0.5)
              drawRing(
                sink,
                car.x + v2b.x,
                car.y + v2b.y + 4,
                3 + k * 5,
                1,
                0x9a6cf0,
                6,
                0.5,
                age * 2,
                1,
              );
          } else {
            // Six stages climbing the barrel, the last one white.
            const stages = 6;
            const lit = Math.ceil(k * stages);
            for (let q = 0; q < stages; q++) {
              if (q >= lit) break;
              const u = (q + 0.5) / stages;
              const cx = Math.round(car.x + v2a.x + (v2b.x - v2a.x) * u);
              const cy = Math.round(car.y + v2a.y + (v2b.y - v2a.y) * u);
              sink.rect(
                cx - 1,
                cy - 1,
                2,
                2,
                q === lit - 1 ? 0xffffff : q > 3 ? 0xc8fbff : 0x46d5e6,
                1,
              );
            }
            if (k >= 0.8)
              sink.rect(
                Math.round(car.x + v2b.x) - 1,
                Math.round(car.y + v2b.y) - 1,
                3,
                3,
                0xffffff,
                1,
              );
          }
        }
        // The saw's teeth run in stepped frames while the part works.
        if (part.kind === 'contact' && car.condition(car.partComponent(i)) < 3) {
          car.partOffset(i, v2a);
          car.muzzleOffset(i, 0, v2b);
          const cx = v2a.x + (v2b.x - v2a.x) * 0.58;
          const cy = v2a.y + (v2b.y - v2a.y) * 0.58;
          const radius = Math.hypot(v2b.x - v2a.x, v2b.y - v2a.y) * 0.42;
          const step = Math.floor(this.clock * 24);
          for (let q = 0; q < 4; q++) {
            const ang = ((q + (step % 3) / 3) / 4) * TAU;
            sink.rect(
              Math.round(car.x + cx + Math.cos(ang) * radius),
              Math.round(car.y + cy + Math.sin(ang) * radius * 0.85),
              1,
              1,
              q % 2 === 0 ? 0xffffff : 0xc4cad8,
              1,
            );
          }
        }
      }

      // EMP: lightning between the car's own corners while its electronics are down.
      if (car.has('emp', tick)) {
        const seed = Math.floor(this.clock / 0.06) + index * 31;
        car.local(
          (hash2(0, seed, 1) < 0.5 ? -1 : 1) * rig.halfWidth,
          (hash2(0, seed, 2) - 0.5) * 2 * rig.halfLength,
          BODY_HEIGHT,
          v2a,
        );
        car.local(
          (hash2(1, seed, 1) < 0.5 ? -1 : 1) * rig.halfWidth,
          (hash2(1, seed, 2) - 0.5) * 2 * rig.halfLength,
          BODY_HEIGHT,
          v2b,
        );
        drawBolt(
          sink,
          car.x + v2a.x,
          car.y + v2a.y,
          car.x + v2b.x,
          car.y + v2b.y,
          seed,
          PALETTES[seed % 2 === 0 ? PAL_CYAN : PAL_VIOLET]!,
          0.2,
          4,
        );
      }
    }

    // Lock brackets: red corners that close on the target, and blink when a missile is inbound.
    for (const lock of this.locks) {
      if (!lock.active) continue;
      const target = this.cars[lock.target];
      if (!target || !target.present || !target.rig) continue;
      const size =
        Math.max(target.rig.halfLength, target.rig.halfWidth) +
        8 +
        Math.max(0, 1 - lock.age / 0.25) * 14;
      const hot = lock.hot > 0;
      if (hot && Math.floor(this.clock * 12) % 2 === 0) continue;
      drawBrackets(
        sink,
        target.x,
        target.y - 4 - target.lift,
        size,
        hot ? 9 : 6,
        hot ? 0xffffff : 0xff5d5d,
      );
      if (hot) drawBrackets(sink, target.x, target.y - 4 - target.lift, size - 3, 5, 0xff5d5d);
    }

    // The harpoon's line: to the dart while it flies, to the hook once it has caught.
    for (const view of this.projectiles) {
      if (!view.active || !view.shown || view.kind !== 'harpoon') continue;
      const owner = this.cars[view.owner];
      if (!owner?.rig) continue;
      const part = owner.rig.partOfKind('tether');
      if (part < 0) continue;
      owner.muzzleOffset(part, 0, v2a);
      drawRope(sink, owner.x + v2a.x, owner.y + v2a.y, view.x, view.y, 2, 0xd8c8a0, 0x6a5234);
    }
    const tether = this.tether;
    if (tether.active) {
      const owner = this.cars[tether.car]!;
      const target = this.cars[tether.target]!;
      if (owner.present && target.present && owner.rig) {
        owner.muzzleOffset(tether.part, 0, v2a);
        target.local(tether.lx, tether.ly, BODY_HEIGHT, v2b);
        const x0 = owner.x + v2a.x;
        const y0 = owner.y + v2a.y;
        let x1 = target.x + v2b.x;
        let y1 = target.y + v2b.y;
        if (tether.retract >= 0) {
          // Released: the free end flies home.
          const k = clamp(tether.retract / 0.2, 0, 1);
          x1 += (x0 - x1) * k;
          y1 += (y0 - y1) * k;
        }
        const length = Math.hypot(x1 - x0, y1 - y0);
        // Slack when the cars close up, taut when they pull apart: the line bows and straightens.
        const slack = clamp((tether.rest - length) * 0.5, 0, 10) + (tether.retract >= 0 ? 6 : 0);
        drawRope(sink, x0, y0, x1, y1, slack, 0xd8c8a0, 0x6a5234);
      }
    }
  }

  /** Live counts for the performance readout and the stress test. */
  stats(): { sprites: number; pixels: number; shapes: number; rects: number; queued: number } {
    return {
      sprites: this.pool.count(),
      pixels: this.px.pixelsLive,
      shapes: this.px.shapesLive,
      rects: this.px.rects,
      queued: this.queueCount,
    };
  }

  /** The latest snapshot the stage was given. */
  get latest(): RaceSnapshot | null {
    return this.snapshot;
  }

  /** Works out what a grip loss or a slow came from, from what is around the car. */
  classify(index: number, family: 'grip' | 'slow', by: number): number {
    const car = this.cars[index]!;
    const snapshot = this.snapshot;
    const pos = scratchPose;
    if (!this.history[index]!.sample(this.renderTick, pos)) return SOURCE_NONE;
    let near = SOURCE_NONE;
    if (snapshot) {
      for (const h of snapshot.hazards) {
        const reach = Math.max(h.radius, h.halfLength) + (car.rig?.halfLength ?? 30) + 6;
        if (Math.hypot(h.x - pos.x, h.y - pos.y) > reach) continue;
        if (family === 'grip' && h.kind === 'frost') near = SOURCE_FROST;
        else if (family === 'grip' && h.kind === 'oil' && near === SOURCE_NONE) near = SOURCE_OIL;
        else if (family === 'slow' && h.kind === 'foam') near = SOURCE_FOAM;
      }
    }
    if (near !== SOURCE_NONE) return near;
    // Nothing on the road under it: it was hit. The attacker's weapons say with what.
    const attacker = this.cars[by]?.rig;
    if (family === 'grip')
      return attacker && attacker.partOfKind('frost') >= 0 ? SOURCE_FROST : SOURCE_OIL;
    return attacker && attacker.partOfKind('puddle') >= 0 && attacker.partOfKind('mine') < 0
      ? SOURCE_FOAM
      : SOURCE_MINE;
  }
}

/** Growth frames at the head of every area-hazard blob strip (see art/scripts/vfx/hazards.ts). */
export const BLOB_GROW_FRAMES = 3;

const PROJECTILE_ANIM: Record<ProjectileKind, keyof Recipes['a']> = {
  bullet: 'tracer_mg',
  pellet: 'pellet',
  rocket: 'rocket',
  missile: 'missile',
  frost: 'frost_ball',
  harpoon: 'harpoon',
  boomerang: 'boomerang',
  foam: 'foam_glob',
  shell: 'shell',
};

// --- Event handlers: one per event type, checked by the unit tests -----------------------------------

type Handler<T extends RaceEventType> = (
  s: CombatStage,
  e: Extract<RaceEvent, { type: T }>,
) => void;
type HandlerTable = { [T in RaceEventType]: Handler<T> };

function heavyClass(cls: string): boolean {
  return cls === 'heavy' || cls === 'ram';
}

export const EVENT_HANDLERS: HandlerTable = {
  checkpoint(s, e) {
    // A gate passed: two cyan ticks flick out beside the car. Felt, not read.
    const car = s.cars[e.car];
    if (!car?.present || !car.rig) return;
    for (const side of [-1, 1]) {
      s.atLocal(e.car, side * (car.rig.halfWidth + 3), 0, 2);
      s.px.pixel(s.at.x, s.at.y, -car.vx * 0.3, -car.vy * 0.3, 0.16, PAL_CYAN, 3, 0, 0, 1);
    }
  },
  lap(s, e) {
    const car = s.cars[e.car];
    if (car?.present) car.sparkle = Math.max(car.sparkle, 0.5);
  },
  finish(s, e) {
    // Banner sparkle and a small victory hop (Section 12.8).
    const car = s.cars[e.car];
    if (!car?.present) return;
    car.sparkle = Math.max(car.sparkle, e.finished ? 1.4 : 0.3);
    if (e.finished) car.liftVelocity = 46;
  },
  wall(s, e) {
    // The local car's scrapes are drawn from its own telemetry; this is the other car's.
    if (e.car === s.you) return;
    const car = s.cars[e.car];
    if (!car?.present || !car.rig) return;
    s.fx.seed(e.id);
    s.atLocal(e.car, (s.fx.r() < 0.5 ? -1 : 1) * car.rig.halfWidth, -car.rig.halfLength * 0.6, 4);
    s.fx.flash(s.a.flash_s, s.at);
    s.fx.sparks(
      6 + Math.round(clamp(e.speed / 190, 0, 1) * 8),
      s.at,
      60,
      200,
      PAL_SPARK,
      2.4,
      car.heading + Math.PI,
      60,
    );
  },
  position(s, e) {
    // A chevron over the new leader for a moment.
    const car = s.cars[e.leader];
    if (!car?.present) return;
    const slot = s.pool.spawn(s.a.mark_lead, 0, -26, -1, false);
    if (slot < 0) return;
    s.pool.follow[slot] = e.leader;
    s.pool.mode[slot] = MODE_LOOP;
    s.pool.life[slot] = 0.8;
    s.pool.fade[slot] = 0.2;
  },
  windup(s, e) {
    s.weapon(e.weapon).windup?.(s, e);
  },
  shot(s, e) {
    const car = s.cars[e.car];
    if (!car?.present) return;
    s.weapon(e.weapon).shot(s, e);
  },
  beam(s, e) {
    s.weapon(e.weapon).beam?.(s, e);
  },
  area(s, e) {
    s.weapon(e.weapon).area?.(s, e);
  },
  telegraph(s, e) {
    s.weapon(e.weapon).telegraph?.(s, e);
  },
  lock(s, e) {
    // Brackets belong to the seeker; other tracking weapons mark their lock their own way.
    if (!e.locked) s.setLock(e.car, e.part, e.target, false);
    else s.weapon(e.weapon).lock?.(s, e);
  },
  warning(s, e) {
    if (e.kind === 'missile') s.heatLocks(e.car, Math.max(0.3, e.value * SIM_DT));
    else if (e.kind === 'trap') {
      const hazard = s.hazard(e.value);
      if (hazard) hazard.pulse = 0.8;
    } else if (e.kind === 'lock_lost') {
      for (let part = 0; part < MAX_PARTS; part++) s.setLock(e.by, part, e.car, false);
    }
  },
  hit(s, e) {
    const victim = s.cars[e.car];
    if (!victim?.present) return;
    s.fx.seed(e.id);
    const heavy = heavyClass(e.cls);
    // Frame 0: the contact star, from the weapon's own identity (Section 13.6).
    s.atCar(e.car, e.x, e.y, e.tick);
    const attacker = s.cars[e.by];
    const dir = attacker?.present
      ? Math.atan2(victim.x - attacker.x, -(victim.y - attacker.y))
      : victim.heading;
    s.weapon(e.weapon).hit(s, e, dir);
    // Within 50 ms: the struck module, wheel or panel flashes.
    // Bare bodywork flashes only for a heavy blow: a whole car going white for a bullet is noise.
    if (e.cls !== 'burn' && (e.component >= 0 || heavy))
      s.flashComponent(e.car, e.component, heavy ? 0.05 : 0.02);
    // Within 100 ms: a small believable recoil, heavier for a heavy hit.
    if (e.cls !== 'burn')
      s.recoilCar(e.car, Math.sin(dir), -Math.cos(dir), heavy ? 2 : 1, heavy ? 26 : 0);
    // What stood in the way answers too.
    s.atCar(e.car, e.x, e.y, e.tick);
    if (e.shield > 0) {
      victim.shieldRipple = 0.3;
      const local = s.at;
      victim.shieldRippleAngle = Math.atan2(local.oy, local.ox) - victim.frameHeading;
      s.fx.sparks(6, s.at, 50, 150, PAL_CYAN, 2.4, dir + Math.PI, 0);
    }
    if (e.armor > 0 || e.absorbed > 0) {
      // Armor flecks: pale chips knocked off the plate (Section 12.8, heavy hit).
      for (let i = 0; i < s.px.scaled(heavy ? 6 : 3); i++)
        s.px.pixel(
          s.at.x,
          s.at.y,
          (s.fx.r() - 0.5) * 120 + victim.vx * 0.5,
          (s.fx.r() - 0.5) * 120 + victim.vy * 0.5,
          0.3 + s.fx.r() * 0.2,
          PAL_STEEL,
          1,
          50 + s.fx.r() * 50,
          320,
          1,
          4,
          -1,
          2,
        );
    }
    if (e.cls === 'burn') {
      victim.burnX = clampLocal(s, e.car, true);
      victim.burnY = clampLocal(s, e.car, false);
    }
    if (e.car === s.you || e.by === s.you) s.host.kick(heavy ? 2 : 1, heavy ? 0.09 : 0.06);
    if (e.projectile > 0) {
      const view = s.projectile(e.projectile);
      if (view && view.kind !== 'boomerang') s.endProjectile(e.projectile);
    }
  },
  explosion(s, e) {
    s.endProjectile(e.projectile);
    s.atWorld(e.x, e.y);
    // A blast that goes off on a car is thrown from that car.
    for (let i = 0; i < 2; i++) {
      const car = s.cars[i]!;
      if (!car.present) continue;
      const d = Math.hypot(car.x - e.x, car.y - e.y);
      if (d < e.radius + 40 && e.radius >= 50) car.outline = 0.45;
      if (d < 26) {
        s.at.vx = car.vx;
        s.at.vy = car.vy;
      }
    }
    const fx = s.weapon(e.weapon);
    if (fx.explosion) fx.explosion(s, e);
    else s.fx.rocketBlast(s.at, Math.max(30, e.radius), e.id);
  },
  impact(s, e) {
    const view = s.projectile(e.projectile);
    s.atWorld(view && e.on !== 'ground' ? view.x : e.x, view && e.on !== 'ground' ? view.y : e.y);
    if (e.on === 'intercepted') s.fx.popBurst(s.at, PAL_SPARK, e.id);
    else if (e.on === 'scrambled') {
      s.fx.popBurst(s.at, PAL_VIOLET, e.id);
      s.onCar(s.a.zap, s.at, LAYER_FLASH);
    } else s.weapon(e.weapon).impact?.(s, e);
    s.endProjectile(e.projectile);
  },
  status(s, e) {
    const car = s.cars[e.car];
    if (!car?.present || !car.rig) return;
    s.fx.seed(e.id);
    const rig = car.rig;
    if (e.state === 'blocked') {
      // Immunity turned it away: a quick white shrug around the car.
      s.fx.ring(
        car.x,
        car.y - 4,
        rig.halfLength + 4,
        rig.halfLength + 12,
        0.18,
        PAL_WHITE,
        8,
        0,
        PLANE_AIR,
      );
      return;
    }
    const applied = e.state === 'applied';
    switch (e.family) {
      case 'grip': {
        if (!applied) {
          if (car.gripSource === SOURCE_FROST) {
            // The frost lets go: shards drop off the arches.
            for (let w = 0; w < rig.wheelCount; w++) {
              const anchor = rig.chassis.wheelAnchors[w]!;
              s.atLocal(e.car, anchor.x, anchor.y, 4);
              s.fx.debris([s.a.ice_shard_a, s.a.ice_shard_b], 1, s.at, 20, 70, 60);
            }
          }
          car.gripSource = SOURCE_NONE;
          break;
        }
        // A frost shell that is still in the air beside the car is what did it.
        let shell: ProjectileView | null = null;
        for (const view of s.projectiles)
          if (
            view.active &&
            view.kind === 'frost' &&
            view.owner === e.by &&
            Math.hypot(view.x - car.x, view.y - car.y) < 90
          )
            shell = view;
        const source = shell ? SOURCE_FROST : s.classify(e.car, 'grip', e.by);
        const fresh = car.gripSource !== source;
        car.gripSource = source;
        if (shell) {
          s.atCar(e.car, shell.x, shell.y, e.tick);
          s.weapon(shell.weapon).hit(s, null, shell.heading);
          s.endProjectile(shell.id);
        } else if (fresh && source === SOURCE_OIL) {
          // Tire splash: the first wheel into the puddle throws oil forward and aside.
          s.atLocal(e.car, 0, -rig.halfLength * 0.6, 1);
          for (let i = 0; i < s.px.scaled(12); i++)
            s.px.pixel(
              s.at.x + (s.fx.r() - 0.5) * rig.halfWidth * 2,
              s.at.y,
              car.vx * 0.4 + (s.fx.r() - 0.5) * 110,
              car.vy * 0.4 + (s.fx.r() - 0.5) * 110,
              0.25 + s.fx.r() * 0.25,
              PAL_OIL,
              2,
              40 + s.fx.r() * 40,
              280,
              1,
              1,
              -1,
              2,
            );
        }
        break;
      }
      case 'slow': {
        if (!applied) {
          if (car.slowSource === SOURCE_FOAM) {
            s.atLocal(e.car, 0, 0, 3);
            s.fx.debris([s.a.foam_bit], 6, s.at, 20, 60, 50);
          }
          car.slowSource = SOURCE_NONE;
          break;
        }
        const source = s.classify(e.car, 'slow', e.by);
        if (source === SOURCE_FOAM && car.slowSource !== SOURCE_FOAM) car.foamSeed = e.id;
        car.slowSource = source;
        break;
      }
      case 'burn':
        if (applied) {
          s.atLocal(e.car, car.burnX, car.burnY, BODY_HEIGHT);
          s.fx.embers(6, s.at, 8);
        } else {
          // Out: white steam where the flames were.
          for (let i = 0; i < 3; i++) {
            s.atLocal(
              e.car,
              car.burnX + (s.fx.r() - 0.5) * 12,
              car.burnY + (s.fx.r() - 0.5) * 12,
              BODY_HEIGHT,
            );
            const slot = s.onCar(s.a.steam, s.at, LAYER_SMOKE);
            if (slot >= 0) s.pool.delay[slot] = i * 0.06;
          }
        }
        break;
      case 'emp':
        if (applied) {
          // Jump arcs from the pulse to the mounts it shut down (Section 13.3).
          const from = s.cars[e.by];
          const count = Math.min(3, rig.parts.length);
          for (let i = 0; i < Math.max(1, count); i++) {
            if (count > 0) s.atComponent(e.car, car.partComponent(i));
            else s.atLocal(e.car, 0, 0, BODY_HEIGHT);
            const target = s.at;
            const slot = s.px.shape(SHAPE_BOLT, PLANE_AIR, 0.16, PAL_CYAN, e.id + i * 13);
            s.px.sx0[slot] = 0;
            s.px.sy0[slot] = -8;
            s.px.sFollow0[slot] = from?.present ? e.by : e.car;
            s.px.sx1[slot] = target.ox;
            s.px.sy1[slot] = target.oy;
            s.px.sFollow1[slot] = e.car;
            s.px.sA[slot] = 6;
            s.px.sDelay[slot] = 0.1 + i * 0.03;
            const z = s.onCar(s.a.zap, target, LAYER_FLASH);
            if (z >= 0) s.pool.delay[z] = 0.12 + i * 0.03;
          }
        } else {
          // Systems back: the lamps come on with one clean blink.
          s.atLocal(e.car, 0, 0, BODY_HEIGHT);
          s.fx.sparks(4, s.at, 30, 90, PAL_CYAN, TAU, 0, 0);
        }
        break;
      case 'jam':
        if (applied) {
          s.atLocal(e.car, 0, 0, BODY_HEIGHT + 3);
          s.onCar(s.a.zap, s.at, LAYER_FLASH);
        }
        break;
      case 'boost':
        if (applied) {
          // The exhausts bark: a ring of smoke and the first jet.
          for (const anchor of rig.chassis.exhausts) {
            s.atLocal(e.car, anchor.x, anchor.y, 3);
            s.pool.spawn(s.a.launch_puff, s.at.x, s.at.y);
            s.fx.sparks(4, s.at, 60, 160, PAL_CYAN, 1.2, car.heading + Math.PI, 0);
          }
          s.fx.glow(s.a.glow_m, car.x, car.y, 0x7fe9f5, 0.6, 0.25);
        }
        break;
      case 'airborne':
        if (applied) {
          s.atLocal(e.car, 0, 0, 0);
          s.fx.dustDisc(8, s.at, 80, true);
          s.fx.ring(car.x, car.y, 6, rig.halfLength + 8, 0.2, PAL_DUST, 10);
        }
        break;
      case 'refit':
        break;
      default:
        // Immunity granted: a pale shimmer, so the next shove is seen to be shrugged off.
        // Kept small on purpose: it must never outweigh the blow that caused it.
        if (applied)
          for (let corner = 0; corner < 4; corner++) {
            s.atLocal(
              e.car,
              (corner % 2 === 0 ? -1 : 1) * (rig.halfWidth + 3),
              (corner < 2 ? -1 : 1) * (rig.halfLength + 3),
              4,
            );
            s.px.pixel(s.at.ox, s.at.oy, 0, 0, 0.2, PAL_STEEL, 1, 0, 0, 0, 0, e.car, 2);
          }
    }
  },
  impulse(s, e) {
    const car = s.cars[e.car];
    if (!car?.present) return;
    const strength = Math.hypot(e.dx, e.dy);
    s.recoilCar(e.car, e.dx, e.dy, strength > 90 ? 2 : 1, strength > 60 ? 34 : 0);
    s.weapon(e.weapon).impulse?.(s, e);
  },
  component(s, e) {
    const car = s.cars[e.car];
    if (!car?.present || !car.rig) return;
    s.fx.seed(e.id);
    const rig = car.rig;
    s.atComponent(e.car, e.component);
    const at = s.at;
    const wheel =
      e.component >= COMPONENT_FIRST_WHEEL && e.component < COMPONENT_FIRST_WHEEL + rig.wheelCount;
    if (e.repaired) {
      s.flashComponent(e.car, e.component, 0.12);
      return;
    }
    if (e.condition === 'healthy') return;
    // A component got worse: the burst says which one, by where it is and what flies off it.
    s.flashComponent(e.car, e.component, 0.1);
    if (wheel) {
      for (let i = 0; i < s.px.scaled(e.condition === 'disabled' ? 10 : 5); i++)
        s.px.pixel(
          at.x,
          at.y,
          (s.fx.r() - 0.5) * 130 + car.vx * 0.4,
          (s.fx.r() - 0.5) * 130 + car.vy * 0.4,
          0.25 + s.fx.r() * 0.3,
          PAL_RUBBER,
          1,
          50 + s.fx.r() * 60,
          320,
          1,
          2,
          -1,
          2,
        );
      if (e.condition === 'disabled') {
        // The tire comes off the rim and rolls away.
        const slot = s.pool.spawn(s.a.wheel_debris, at.x, at.y);
        if (slot >= 0) {
          const side =
            Math.sign(rig.chassis.wheelAnchors[e.component - COMPONENT_FIRST_WHEEL]!.x) || 1;
          s.pool.vx[slot] = car.vx * 0.6 + Math.cos(car.heading) * side * 60;
          s.pool.vy[slot] = car.vy * 0.6 + Math.sin(car.heading) * side * 60;
          s.pool.vz[slot] = 90;
          s.pool.z[slot] = 3;
          s.pool.gravity[slot] = 330;
          s.pool.bounce[slot] = 0.45;
          s.pool.mode[slot] = MODE_LOOP;
          s.pool.life[slot] = 1.3;
          s.pool.fade[slot] = 0.3;
        }
      }
    } else if (e.component === 0) {
      s.fx.smoke(at.x, at.y, car.vx * 0.3, car.vy * 0.3 - 12, 0);
      s.fx.sparks(e.condition === 'disabled' ? 10 : 5, at, 50, 160, PAL_SPARK, TAU, 0, 70);
      if (e.condition !== 'damaged') s.onCar(s.a.fireball_s_a, at, LAYER_FIRE);
    } else {
      s.fx.sparks(e.condition === 'disabled' ? 8 : 4, at, 40, 150, PAL_SPARK, TAU, 0, 60);
      if (e.condition === 'disabled') {
        s.fx.debris([s.a.shard_a, s.a.shard_b, s.a.shard_d], 4, at, 50, 140, 110);
        s.pool.spawn(s.a.chip_puff, at.x, at.y);
      }
    }
  },
  shield(s, e) {
    const car = s.cars[e.car];
    if (!car?.present || !car.rig) return;
    s.fx.seed(e.id);
    const rig = car.rig;
    const part = rig.parts[e.part];
    const kind = part?.kind ?? 'shield';
    if (kind === 'shield') {
      if (e.state === 'down') {
        car.moduleUp[e.part] = 0;
        // The bubble breaks into angular fragments that fly outward (Section 13.2).
        const frags = [s.a.shield_frag_a, s.a.shield_frag_b, s.a.shield_frag_c];
        const count = s.pool.scaled(9);
        for (let i = 0; i < count; i++) {
          const ang = (i / count) * TAU;
          const lx = Math.cos(ang) * (rig.halfWidth + 9);
          const ly = Math.sin(ang) * (rig.halfLength + 9);
          s.atLocal(e.car, lx, ly, 6);
          const slot = s.pool.spawn(frags[i % 3]!, s.at.x, s.at.y);
          if (slot < 0) continue;
          const out = Math.atan2(s.at.oy, s.at.ox);
          s.pool.vx[slot] = Math.cos(out) * 70 + car.vx * 0.7;
          s.pool.vy[slot] = Math.sin(out) * 70 + car.vy * 0.7;
          s.pool.drag[slot] = 2.5;
          s.pool.alpha[slot] = s.reduceFlashes ? 0.7 : 1;
        }
        s.atLocal(e.car, 0, 0, 6);
        s.fx.sparks(10, s.at, 60, 180, PAL_CYAN, TAU, 0, 0);
        car.shieldRipple = 0;
      } else if (e.state === 'up') {
        car.moduleUp[e.part] = 1;
        // Recharged: the outline closes in from wide and locks.
        s.fx.ring(
          car.x,
          car.y - 5,
          rig.halfLength + 26,
          rig.halfLength + 9,
          0.3,
          PAL_CYAN,
          12,
          0,
          PLANE_AIR,
        );
      }
      return;
    }
    if (part) s.atComponent(e.car, car.partComponent(e.part));
    else s.atLocal(e.car, 0, 0, BODY_HEIGHT);
    if (kind === 'breakaway') {
      if (e.state === 'broken') {
        // The plate has soaked all it can: it tears off and tumbles away.
        car.partHidden[e.part] = 1;
        const slot = s.pool.spawn(s.a.plate_debris, s.at.x, s.at.y);
        if (slot >= 0) {
          s.pool.vx[slot] = car.vx * 0.5 + (s.fx.r() - 0.5) * 120;
          s.pool.vy[slot] = car.vy * 0.5 + (s.fx.r() - 0.5) * 120;
          s.pool.vz[slot] = 130;
          s.pool.z[slot] = 8;
          s.pool.gravity[slot] = 330;
          s.pool.bounce[slot] = 0.4;
          s.pool.mode[slot] = MODE_LOOP;
          s.pool.life[slot] = 1.2;
          s.pool.fade[slot] = 0.3;
        }
        s.fx.debris([s.a.shard_b, s.a.shard_d], 5, s.at, 50, 150, 110);
        s.fx.flash(s.a.flash_s, s.at);
      } else {
        s.flashComponent(e.car, car.partComponent(e.part), 0.08);
        s.fx.sparks(5, s.at, 40, 140, PAL_STEEL, TAU, 0, 60);
      }
      return;
    }
    // Reactive foam: the cell bursts outward and takes the edge off the blow.
    if (e.state === 'down') {
      s.fx.debris([s.a.foam_bit], 9, s.at, 40, 130, 100);
      const puff = s.fx.puff(s.at.x, s.at.y, car.vx * 0.3, car.vy * 0.3, 0xfffdf2, 0.9, false);
      if (puff >= 0) s.pool.layerOf(puff);
      for (let i = 0; i < s.px.scaled(8); i++)
        s.px.pixel(
          s.at.x,
          s.at.y,
          (s.fx.r() - 0.5) * 140 + car.vx * 0.4,
          (s.fx.r() - 0.5) * 140 + car.vy * 0.4,
          0.3,
          PAL_FOAM,
          1,
          60,
          300,
          1,
          5,
          -1,
          2,
        );
    } else s.flashComponent(e.car, car.partComponent(e.part), 0.1);
  },
  hazard(s, e) {
    s.fx.seed(e.id);
    const view = s.hazard(e.hazard);
    const x = view ? view.x : e.x;
    const y = view ? view.y : e.y;
    s.atWorld(x, y);
    switch (e.state) {
      case 'placed':
        if (e.kind === 'decoy') {
          s.pool.spawn(s.a.launch_puff, x, y);
          s.fx.sparks(5, s.at, 40, 120, PAL_MINT, TAU, 0, 40);
        } else if (e.kind === 'frost' || e.kind === 'foam') {
          // The patch spreads with a breath of cold mist, or a wet slap of foam.
          for (let i = 0; i < 4; i++)
            s.fx.puff(
              x + (s.fx.r() - 0.5) * 16,
              y + (s.fx.r() - 0.5) * 16,
              (s.fx.r() - 0.5) * 30,
              (s.fx.r() - 0.5) * 30,
              e.kind === 'frost' ? 0xd8f6ff : 0xfffdf2,
              0.7,
              true,
            );
        }
        break;
      case 'armed':
        // Live: one amber pulse runs out from the mine.
        if (view?.revealed) s.fx.ring(x, y, 3, (view.radius || 10) + 8, 0.22, PAL_AMBER, 0);
        break;
      case 'triggered':
        // The blast itself comes with its `explosion` event; the mine just goes.
        s.endHazard(e.hazard, 0);
        break;
      case 'cleared':
        // Swept or shot: a controlled pop and a kick of dust, well short of a real blast.
        s.fx.popBurst(s.at, PAL_SPARK, e.id);
        s.fx.dustDisc(6, s.at, 60, true);
        s.fx.debris([s.a.shard_d, s.a.chunk_b], 4, s.at, 40, 120, 90);
        s.fx.decal(s.a.scorch_s, x, y);
        s.endHazard(e.hazard, 0);
        break;
      case 'ignited':
        // Oil catching: flame runs the length of the strip.
        if (view) {
          const n = Math.max(3, Math.round(Math.max(view.halfLength, view.radius) / 9));
          for (let i = 0; i < n; i++) {
            const along = (i / (n - 1) - 0.5) * 2 * Math.max(view.halfLength, view.radius);
            const fxSlot = s.pool.spawn(
              i % 2 ? s.a.fireball_s_a : s.a.fireball_s_b,
              x + Math.sin(view.angle) * along,
              y - Math.cos(view.angle) * along,
              LAYER_FIRE,
            );
            if (fxSlot >= 0) s.pool.delay[fxSlot] = i * 0.04;
          }
        }
        s.fx.glow(s.a.glow_l, x, y, 0xff9a4c, 0.9, 0.4);
        break;
      case 'melted':
        // Frost under a flame: gone in a hiss of steam.
        for (let i = 0; i < 4; i++) {
          const slot = s.pool.spawn(
            s.a.steam,
            x + (s.fx.r() - 0.5) * 20,
            y + (s.fx.r() - 0.5) * 14,
            LAYER_SMOKE,
          );
          if (slot >= 0) s.pool.delay[slot] = i * 0.05;
        }
        s.endHazard(e.hazard, 0.2);
        break;
      default:
        // Expired: it wears off the road.
        if (view?.revealed) {
          if (e.kind === 'foam') s.fx.debris([s.a.foam_bit], 5, s.at, 10, 40, 30);
          else if (e.kind === 'fire') s.fx.smoke(x, y - 6, 0, -12, 0, true);
          else if (e.kind === 'decoy') s.fx.popBurst(s.at, PAL_MINT, e.id);
        }
        s.endHazard(e.hazard, e.kind === 'decoy' ? 0 : 0.5);
    }
  },
  tether(s, e) {
    const t = s.tether;
    if (e.state === 'attached') {
      const owner = s.cars[e.car];
      const target = s.cars[e.target];
      if (!owner?.present || !target?.present || !target.rig) return;
      // The hook bites the side of the target that faces the thrower.
      const dx = owner.x - target.x;
      const dy = owner.y - target.y;
      const c = Math.cos(target.heading);
      const sn = Math.sin(target.heading);
      const m = Math.hypot(dx, dy) || 1;
      t.active = true;
      t.car = e.car;
      t.part = e.part;
      t.target = e.target;
      t.lx = clamp(
        ((dx * c + dy * sn) / m) * target.rig.halfWidth,
        -target.rig.halfWidth,
        target.rig.halfWidth,
      );
      t.ly = clamp(
        ((-dx * sn + dy * c) / m) * target.rig.halfLength,
        -target.rig.halfLength,
        target.rig.halfLength,
      );
      t.rest = m;
      t.retract = -1;
      for (const view of s.projectiles)
        if (view.active && view.kind === 'harpoon' && view.owner === e.car)
          s.endProjectile(view.id);
      s.fx.seed(e.id);
      s.atLocal(e.target, t.lx, t.ly, BODY_HEIGHT);
      s.fx.flash(s.a.flash_s, s.at);
      s.fx.sparks(8, s.at, 50, 160, PAL_STEEL, TAU, 0, 60);
      s.recoilCar(e.target, dx, dy, 1);
    } else if (t.active && t.car === e.car) t.retract = 0;
  },
  utility(s, e) {
    const car = s.cars[e.car];
    if (!car?.present || !car.rig) return;
    s.fx.seed(e.id);
    UTILITY_FX[car.rig.parts[e.part]?.kind ?? 'passive']?.(s, e, car);
  },
  misfire(s, e) {
    // A harmless misfire: a spit of sparks and a gray cough at the muzzle, and no shot.
    if (!s.cars[e.car]?.present) return;
    s.fx.seed(e.id);
    const heading = s.atMuzzle(e.car, e.part);
    s.fx.sparks(5, s.at, 30, 110, PAL_AMBER, 1.6, heading, 40);
    s.fx.puff(s.at.x, s.at.y, s.at.vx * 0.5, s.at.vy * 0.5 - 8, 0x8b93a8, 0.6, true);
    s.kickPart(e.car, e.part, 1);
  },
  refused(s, e) {
    // The button did nothing: the part answers with one dull red blip, on the car, not the HUD.
    if (e.part < 0 || !s.cars[e.car]?.present) return;
    s.atMuzzle(e.car, e.part);
    s.px.pixel(s.at.ox, s.at.oy, 0, 0, 0.12, PAL_RED, 1, 0, 0, 0, 0, e.car, 2);
  },
  ko(s, e) {
    const car = s.cars[e.car];
    if (!car?.present || !car.rig) return;
    s.fx.seed(e.id);
    // Rare true knockout: a last burst, parts falling, and the car stays as a smoking wreck.
    s.atLocal(e.car, 0, 0, BODY_HEIGHT);
    s.fx.compactBlast(s.at, e.id);
    s.fx.debris([s.a.shard_a, s.a.shard_b, s.a.shard_c, s.a.plate_debris], 10, s.at, 40, 160, 120);
    s.fx.sparks(14, s.at, 50, 180, PAL_SPARK, TAU, 0, 80);
    for (let i = 0; i < 3; i++)
      s.fx.smoke(s.at.x + (s.fx.r() - 0.5) * 16, s.at.y + (s.fx.r() - 0.5) * 16, 0, -10, i * 0.1);
    s.host.kick(2, 0.1);
  },
  result(s, e) {
    const car = s.cars[e.winner];
    if (car?.present) car.sparkle = Math.max(car.sparkle, 2);
  },
};

function clampLocal(s: CombatStage, index: number, wantX: boolean): number {
  // The point `atCar` just resolved, back in chassis-local pixels (it is stored as an offset).
  const car = s.cars[index]!;
  const c = Math.cos(car.frameHeading);
  const sn = Math.sin(car.frameHeading);
  const ox = s.at.ox - car.bodyShiftX;
  const oy = s.at.oy + BODY_HEIGHT * 0.806 + car.lift - car.bodyShiftY;
  return wantX ? ox * c + oy * sn : -ox * sn + oy * c;
}

type UtilityEvent = Extract<RaceEvent, { type: 'utility' }>;
type UtilityHandler = (s: CombatStage, e: UtilityEvent, car: CarState) => void;

const repairIcon = (s: CombatStage, car: CarState, component: number): number => {
  if (component === 0) return s.a.icon_engine;
  if (component === 1) return s.a.icon_steer;
  if (component < COMPONENT_FIRST_WHEEL + (car.rig?.wheelCount ?? 4)) return s.a.icon_wheel;
  return s.a.icon_part;
};

const repair: UtilityHandler = (s, e, car) => {
  const rig = car.rig!;
  const wheel =
    e.value >= COMPONENT_FIRST_WHEEL && e.value < COMPONENT_FIRST_WHEEL + rig.wheelCount;
  s.atComponent(e.car, e.value);
  if (e.state === 'started') {
    // The clamp goes on and the welding starts; the burst comes when the repair lands.
    s.onCar(s.a.clamp, s.at);
    s.fx.sparks(6, s.at, 30, 100, PAL_MINT, TAU, 0, 50);
    if (wheel && car.condition(e.value) === 3) {
      // Spare wheel: what is left of the old one is knocked off first.
      const slot = s.pool.spawn(s.a.wheel_debris, s.at.x, s.at.y);
      if (slot >= 0) {
        const side = Math.sign(rig.chassis.wheelAnchors[e.value - COMPONENT_FIRST_WHEEL]!.x) || 1;
        s.pool.vx[slot] = car.vx * 0.5 + Math.cos(car.heading) * side * 70;
        s.pool.vy[slot] = car.vy * 0.5 + Math.sin(car.heading) * side * 70;
        s.pool.vz[slot] = 70;
        s.pool.z[slot] = 3;
        s.pool.gravity[slot] = 330;
        s.pool.bounce[slot] = 0.45;
        s.pool.mode[slot] = MODE_LOOP;
        s.pool.life[slot] = 1.1;
        s.pool.fade[slot] = 0.3;
      }
    }
  } else if (e.state === 'done') {
    s.fx.repairBurst(s.at, repairIcon(s, car, e.value), e.id);
    s.flashComponent(e.car, e.value, 0.12);
    // The replacement snaps in: the wheel drops onto its hub.
    if (wheel) car.wheelDrop[e.value - COMPONENT_FIRST_WHEEL] = 0;
  } else {
    s.fx.sparks(4, s.at, 30, 90, PAL_RED, TAU, 0, 40);
  }
};

const boost: UtilityHandler = (s, e, car) => {
  if (e.state !== 'started') return;
  s.atMuzzle(e.car, e.part);
  s.fx.sparks(6, s.at, 50, 150, PAL_CYAN, 1.4, car.heading + Math.PI, 0);
};

const UTILITY_FX: Partial<Record<string, UtilityHandler>> = {
  spare: repair,
  repair,
  nitro: boost,
  boost,
  decoy(s, e, car) {
    if (e.state !== 'started') return;
    s.atComponent(e.car, car.partComponent(e.part));
    s.pool.spawn(s.a.launch_puff, s.at.x, s.at.y);
    s.kickPart(e.car, e.part, 2);
  },
  hop(s, e, car) {
    if (e.state !== 'started') return;
    // The pad fires: a hard ring of dust and the car leaves the ground (its `airborne` status).
    s.atLocal(e.car, 0, 0, 0);
    s.fx.flash(s.a.flash_s, s.at);
    s.fx.dustDisc(10, s.at, 110, true);
    void car;
  },
  winch(s, e, car) {
    if (e.state !== 'started' || !car.rig) return;
    // The cable goes out ahead and hauls: sparks at the drum, a taut line for the pull.
    s.atLocal(e.car, 0, -car.rig.halfLength, 4);
    s.fx.sparks(8, s.at, 40, 140, PAL_STEEL, 1.2, car.heading, 40);
    s.fx.dustDisc(5, s.at, 50, true);
  },
  capacitor(s, e, car) {
    if (e.state !== 'started') return;
    s.atComponent(e.car, car.partComponent(e.part));
    s.onCar(s.a.flash_cyan, s.at, LAYER_FLASH);
    s.fx.sparks(6, s.at, 40, 120, PAL_CYAN, TAU, 0, 0);
  },
};
