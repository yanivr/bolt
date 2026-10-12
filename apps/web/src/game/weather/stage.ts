import type {
  SurfaceId,
  TerrainLight,
  TrackPoint,
  TrackRuntime,
  WeatherPreset,
} from '@bolt/shared';
import {
  SURFACE_IDS,
  TAU,
  angleDelta,
  clamp,
  createGround,
  createLocation,
  groundAt,
  hash2,
  hazardState,
  locate,
  mulberry32,
  sampleBranch,
  shapeOutline,
  zoneSurfaceAt,
} from '@bolt/shared';
import type { CarState } from '../combat/rig.js';
import type { WeatherAtlas } from './atlas.js';
import {
  WL_AIR,
  WL_COUNT,
  WL_GLOW,
  WL_GROUND,
  WL_KICK,
  WL_SCREEN,
  WL_SHINE,
  WL_WET,
} from './atlas.js';
import type { FieldView } from './field.js';
import {
  FieldRuntime,
  SPLASH_BIG,
  SPLASH_MUD,
  SPLASH_NONE,
  SPLASH_RING,
  drawField,
} from './field.js';
import type { WeatherLayerId, WeatherPlan } from './plan.js';
import { planWeather } from './plan.js';
import { DrawList, PM_FIXED, PM_LOOP, WeatherPool } from './pool.js';
import { ProtectedZone, edgeWeight, stepped } from './readability.js';

/**
 * The moving weather and environment layer (Milestone D), without a renderer: rain in three
 * planes with splashes, spray and rooster tails, wet marks and reflections of every light on
 * wet ground, lightning; snow, frost, ice glints and cold fog; blowing sand, dust bands,
 * tumbleweeds, dust devils and heat shimmer; leaves, light shafts, pollen, mist and drips;
 * steam on the vents' timetable, smelter sparks, embers and chimney smoke; what every surface
 * throws up under each car's wheels; and the visibility haze. `WeatherView` copies the draw
 * list onto Phaser objects; the unit tests drive this class directly.
 *
 * Cosmetic only: it reads the track data, the published preset, the two cars as the combat
 * stage draws them and the lights the combat stage is showing, and writes nothing back. The
 * planes are pure functions of time and camera (`field.ts`); everything else draws from one
 * generator seeded from the course, so the same frames give the same picture.
 */

export type WeatherOptions = {
  seed?: number;
  /** Baked lamp positions (`TerrainManifest.lights`), reflected on wet road. */
  lamps?: readonly TerrainLight[];
  reducedMotion?: boolean;
};

export type WeatherFrame = {
  dt: number;
  /** Race ticks since GO: the hazard timetable's clock. */
  clockTicks: number;
  /** The view in world pixels: its top-left on the device grid, and its size. */
  viewX: number;
  viewY: number;
  viewW: number;
  viewH: number;
  /** Index of the local car. */
  you: number;
  reduceFlashes: boolean;
  low: boolean;
  /** The Section 19.5 stress scenario: heaviest rain, both cars throwing spray flat out. */
  stress?: boolean;
};

/** Bright moments the combat stage is drawing (flashes, blasts), for reflections. */
export class LightList {
  static readonly CAPACITY = 16;
  count = 0;
  readonly x = new Float32Array(LightList.CAPACITY);
  readonly y = new Float32Array(LightList.CAPACITY);
  /** Reflection length class, 0 to 3. */
  readonly size = new Uint8Array(LightList.CAPACITY);
  readonly tint = new Uint32Array(LightList.CAPACITY);
  clear(): void {
    this.count = 0;
  }
  add(x: number, y: number, size: number, tint: number): void {
    if (this.count >= LightList.CAPACITY) return;
    const i = this.count++;
    this.x[i] = x;
    this.y[i] = y;
    this.size[i] = size;
    this.tint[i] = tint;
  }
}

const MAX_WHEELS = 6;
const SURF_NONE = -1;
const NIGHT_HEAD = 0xfff0c8;
const BRAKE = 0xff4433;
const TAIL = 0xa8241c;
const HAZE_W = 52;
const HAZE_H = 44;
const LIGHTNING_MIN_GAP = 20;
const LEAF_NAMES = ['leaf_green', 'leaf_olive', 'leaf_amber'] as const;

type Anchor = { x: number; y: number; h: number };
type Vent = { index: number; x: number; y: number; r: number };

const v2 = { x: 0, y: 0 };

function surfaceCode(s: SurfaceId): number {
  return SURFACE_IDS.indexOf(s);
}
const S_ASPHALT = surfaceCode('asphalt');
const S_COBBLE = surfaceCode('cobble');
const S_SAND = surfaceCode('sand');
const S_DIRT = surfaceCode('dirt');
const S_MUD = surfaceCode('mud');
const S_SNOW = surfaceCode('snow');
const S_ICE = surfaceCode('ice');
const S_METAL = surfaceCode('metal');

export class WeatherStage {
  readonly plan: WeatherPlan;
  readonly pool: WeatherPool;
  readonly list = new DrawList();
  readonly zone = new ProtectedZone();
  readonly fields: FieldRuntime[];
  clock = 0;
  /** Lightning: alpha of the sky flash this frame (additive, never white), and its tint. */
  flash = 0;
  readonly flashTint = 0xa8b8ff;
  flashes = 0;
  lastFlashAt = -1e9;
  private nextFlash: number;
  private flashStart = -1;
  reducedMotion: boolean;
  private readonly rng: () => number;
  private readonly seed: number;
  private readonly loc = createLocation();
  private readonly ground = createGround();
  private readonly a: Record<string, number> = {};
  private readonly shiny: boolean[];
  private density = 1;
  private speedScale = 1;
  private frameIn: WeatherFrame | null = null;
  // Per car: emission accumulators and where each rear wheel last left a mark.
  private readonly acc = new Float32Array(2 * MAX_WHEELS * 8);
  private readonly markX = new Float32Array(2 * MAX_WHEELS).fill(NaN);
  private readonly markY = new Float32Array(2 * MAX_WHEELS).fill(NaN);
  private readonly wheelSurface = new Int8Array(2 * MAX_WHEELS).fill(SURF_NONE);
  private readonly carSurface = new Int8Array(2).fill(SURF_NONE);
  private readonly vaporTimer = new Float32Array(2);
  // Ambient emitters' clocks.
  private readonly timers = new Float32Array(256);
  private readonly anchors: Record<string, Anchor[]> = {};
  private readonly vents: Vent[] = [];
  private readonly trees: Anchor[] = [];
  private readonly emberPoints: Anchor[] = [];
  private readonly mistPoints: Anchor[] = [];
  private readonly lightPoints: Anchor[] = [];
  private readonly dripSources: Anchor[] = [];
  private readonly heatX = new Float32Array(32);
  private readonly heatY = new Float32Array(32);
  private readonly lamps: readonly TerrainLight[];
  /** Surfaces per 16 px cell, -2 until asked (`coarseSurfaceAt`). */
  private readonly coarse: Int8Array;
  private readonly coarseCols: number;
  private readonly coarseRows: number;
  /** The track's segment grid cell when the shortcut for walled tracks applies, else 0. */
  private readonly bucketCell: number;
  private readonly lampWet: Int8Array;
  private readonly fieldView: FieldView = { x: 0, y: 0, w: 0, h: 0 };
  private readonly splashAnims: { ring: number; big: number; mud: number };
  private readonly probe = (x: number, y: number) => this.splashAt(x, y);
  /** Frame offset of the haze drifts: lying along the wind. */
  private readonly hazeDir: number;
  private readonly veilMask = (sx: number, sy: number) => {
    const f = this.frameIn!;
    const e = edgeWeight(sx / f.viewW, sy / f.viewH);
    if (e <= 0) return 0;
    const x = f.viewX + sx;
    const y = f.viewY + sy;
    return e * this.zone.allowance(x - 8, y - 8, x + 8, y + 8);
  };

  constructor(
    readonly atlas: WeatherAtlas,
    readonly track: TrackRuntime,
    readonly preset: WeatherPreset,
    options: WeatherOptions = {},
  ) {
    this.plan = planWeather(preset, track.def);
    this.pool = new WeatherPool(atlas);
    this.reducedMotion = options.reducedMotion ?? false;
    let h = 0x811c9dc5;
    for (const ch of `${track.def.id}/${preset.id}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    this.seed = options.seed ?? h >>> 0;
    this.rng = mulberry32(this.seed);
    for (const name of atlas.names) this.a[name] = atlas.id(name);
    this.fields = this.plan.planes.map(
      (p, i) => new FieldRuntime(p, atlas, this.seed, i, Math.ceil(p.count * 2.4) + 1),
    );
    this.splashAnims = {
      ring: this.id('splash_ring'),
      big: this.id('splash_big'),
      mud: this.id('splash_mud'),
    };
    this.shiny = SURFACE_IDS.map((s) => this.plan.shiny.has(s));
    for (const anchor of track.def.anchors) {
      const list = (this.anchors[anchor.kind] ??= []);
      for (const p of anchor.points)
        list.push({ x: p.x, y: p.y, h: hash2(Math.round(p.x), Math.round(p.y), 5) });
    }
    track.def.hazards.forEach((hz, index) => {
      if (hz.kind !== 'steam_vent') return;
      const outline: TrackPoint[] =
        hz.shape.type === 'circle'
          ? [{ x: hz.shape.x, y: hz.shape.y }]
          : shapeOutline(hz.shape, track.branches);
      let cx = 0;
      let cy = 0;
      for (const p of outline) {
        cx += p.x;
        cy += p.y;
      }
      cx /= Math.max(1, outline.length);
      cy /= Math.max(1, outline.length);
      let r = hz.shape.type === 'circle' ? hz.shape.radius : 0;
      for (const p of outline) r = Math.max(r, Math.hypot(p.x - cx, p.y - cy));
      this.vents.push({ index, x: cx, y: cy, r: Math.max(16, r) });
    });
    for (const o of track.def.obstacles)
      if (o.kind === 'tree') this.trees.push({ x: o.x, y: o.y, h: o.radius });
    const pts = (kind: string) => this.anchors[kind] ?? [];
    this.emberPoints.push(...pts('glow'), ...pts('sparks'), ...pts('chimney'));
    this.mistPoints.push(...pts('mist'), ...(this.plan.layers.has('rain') ? pts('water') : []));
    this.lightPoints.push(...pts('glow'), ...pts('canopy'));
    this.lamps = options.lamps ?? [];
    this.coarseCols = Math.ceil(track.def.worldWidth / 16);
    this.coarseRows = Math.ceil(track.def.worldHeight / 16);
    this.coarse = new Int8Array(this.coarseCols * this.coarseRows).fill(-2);
    // The runtime buckets segments on a 96 px grid (docs/TRACK_API.md); use it only if the
    // grid really is that size.
    this.bucketCell =
      track.walled && Math.ceil(track.def.worldWidth / 96) === track.gridCols ? 96 : 0;
    this.lampWet = new Int8Array(this.lamps.length).fill(-1);
    this.nextFlash = 14 + this.rng() * 10;
    const haze0 = this.id('haze_0');
    this.hazeDir = atlas.directionFrame(haze0, Math.atan2(this.plan.windX || 1, -this.plan.windY));
  }

  has(id: WeatherLayerId): boolean {
    return this.plan.layers.has(id);
  }

  private id(name: string): number {
    const v = this.a[name];
    if (v === undefined) throw new Error(`Weather animation "${name}" is not in the atlas`);
    return v;
  }

  clear(): void {
    this.pool.clear();
    this.markX.fill(NaN);
    this.markY.fill(NaN);
    this.acc.fill(0);
    this.flash = 0;
    this.flashStart = -1;
  }

  // --- The ground ---------------------------------------------------------------------------------

  /** Surface code under a world point, or SURF_NONE inside a solid (a walled track's walls). */
  surfaceCodeAt(x: number, y: number): number {
    const track = this.track;
    if (this.bucketCell > 0) {
      // A walled track's empty grid cell is far from every corridor, so inside a block:
      // answer at once instead of letting `locate` scan every segment.
      const c = Math.floor(x / this.bucketCell);
      const r = Math.floor(y / this.bucketCell);
      if (c < 0 || r < 0 || c >= track.gridCols || r >= track.gridRows) return SURF_NONE;
      if (track.grid[r * track.gridCols + c]!.length === 0) return SURF_NONE;
    }
    locate(track, x, y, this.loc);
    if (track.walled && this.loc.edge > 0) return SURF_NONE;
    groundAt(track, this.loc, x, y, 0, this.ground);
    return surfaceCode(this.ground.surface);
  }

  private wetAt(code: number): boolean {
    return code >= 0 && this.shiny[code]! && this.plan.wetness >= 0.3;
  }

  /**
   * The surface at a point, looked up once per 16 px cell and remembered: good enough for
   * where a raindrop lands or a flash is reflected, and it keeps `locate` out of the hot path.
   */
  coarseSurfaceAt(x: number, y: number): number {
    const c = Math.floor(x / 16);
    const r = Math.floor(y / 16);
    if (c < 0 || r < 0 || c >= this.coarseCols || r >= this.coarseRows) return SURF_NONE;
    const i = r * this.coarseCols + c;
    let v = this.coarse[i]!;
    if (v === -2) {
      v = this.surfaceCodeAt(c * 16 + 8, r * 16 + 8);
      this.coarse[i] = v;
    }
    return v;
  }

  /** What a far raindrop does where it lands. */
  private splashAt(x: number, y: number): number {
    const code = this.coarseSurfaceAt(x, y);
    if (code === SURF_NONE || code === S_SNOW || code === S_SAND) return SPLASH_NONE;
    if (code === S_DIRT || code === S_MUD) return SPLASH_MUD;
    // Standing water: one drop in eight lands in a puddle, more in a downpour.
    return hash2(Math.round(x), Math.round(y), 13) < 0.06 + this.plan.wetness * 0.08
      ? SPLASH_BIG
      : SPLASH_RING;
  }

  // --- One frame ----------------------------------------------------------------------------------

  frame(f: WeatherFrame, cars: readonly CarState[], lights: LightList | null): void {
    this.frameIn = f;
    const dt = f.dt;
    this.clock += dt;
    this.pool.low = f.low;
    this.density = (f.low ? 0.5 : 1) * (this.reducedMotion ? 0.5 : 1);
    this.speedScale = this.reducedMotion ? 0.6 : 1;
    this.pool.setView(f.viewX, f.viewY, f.viewX + f.viewW, f.viewY + f.viewH);
    const own = cars[f.you];
    const rival = cars[f.you === 0 ? 1 : 0];
    this.zone.set(
      !!own?.present,
      own?.x ?? 0,
      own?.y ?? 0,
      own?.vx ?? 0,
      own?.vy ?? 0,
      own?.heading ?? 0,
      !!rival?.present,
      rival?.x ?? 0,
      rival?.y ?? 0,
    );

    if (dt > 0) {
      for (let c = 0; c < cars.length && c < 2; c++) this.emitCar(c, cars[c]!, dt, !!f.stress);
      this.emitAmbient(dt, f.clockTicks);
      this.pool.update(dt);
    }
    this.updateLightning(f);

    const list = this.list;
    list.begin();
    this.drawPool();
    const view = this.fieldView;
    view.x = f.viewX;
    view.y = f.viewY;
    view.w = f.viewW;
    view.h = f.viewH;
    for (const rt of this.fields) {
      // Distant rain goes first when frames are short (Section 19.5).
      const far = rt.plane.id === 'rain_far' && f.low ? 0.7 : 1;
      drawField(
        rt,
        this.atlas,
        list,
        this.clock,
        view,
        this.density * far,
        this.speedScale,
        rt.plane.splash ? this.probe : null,
        rt.plane.splash ? this.splashAnims : null,
        rt.plane.veil ? this.veilMask : null,
      );
    }
    this.drawStateless(cars, lights);
  }

  // --- Cars ---------------------------------------------------------------------------------------

  private emitCar(c: number, car: CarState, dt: number, stress: boolean): void {
    const rig = car.rig;
    if (!car.present || !rig) {
      for (let w = 0; w < MAX_WHEELS; w++) this.markX[c * MAX_WHEELS + w] = NaN;
      return;
    }
    const pool = this.pool;
    const plan = this.plan;
    const rng = this.rng;
    const speed = Math.hypot(car.vx, car.vy);
    const travel = speed > 1 ? Math.atan2(car.vx, -car.vy) : car.heading;
    const back = travel + Math.PI;
    const bx = Math.sin(back);
    const by = -Math.cos(back);
    const sx = -by;
    const sy = bx;
    const slip = speed > 25 ? Math.abs(Math.sin(angleDelta(car.heading, travel))) : 0;
    const wetness = stress ? 1 : plan.wetness;
    const d = this.density;
    const anchors = rig.chassis.wheelAnchors;
    this.carSurface[c] = stress ? S_ASPHALT : this.surfaceCodeAt(car.x, car.y);

    for (let w = 0; w < anchors.length && w < MAX_WHEELS; w++) {
      const anchor = anchors[w]!;
      if (anchor.steers) continue;
      const slot = c * MAX_WHEELS + w;
      car.local(anchor.x, anchor.y, 0, v2);
      const x = car.x + v2.x;
      const y = car.y + v2.y;
      const code = stress ? S_ASPHALT : this.surfaceCodeAt(x, y);
      this.wheelSurface[slot] = code;
      if (code === SURF_NONE || speed < 4) {
        this.markX[slot] = NaN;
        continue;
      }
      const acc = slot * 8;
      const emit = (k: number, rate: number): number => {
        this.acc[acc + k]! += rate * d * dt;
        const n = Math.floor(this.acc[acc + k]!);
        this.acc[acc + k]! -= n;
        return Math.min(n, 4);
      };
      const wet =
        (stress || this.wetAt(code) || (code === S_DIRT && wetness >= 0.3)) && this.has('spray');
      const fast = stress ? 1.3 : clamp((speed - 40) / 180, 0, 1.3);

      // Water: a mist puff, droplets, and the rooster tail behind a fast car.
      if (wet) {
        const k = wetness * fast * (stress ? 1.4 : 1);
        const muddy = code === S_DIRT || code === S_MUD;
        for (let n = emit(0, 24 * k); n > 0; n--) {
          const s = pool.spawn(this.id('spray_puff'), x + bx * 4 + (rng() - 0.5) * 3, y + by * 4);
          if (s < 0) continue;
          const side = (rng() - 0.5) * 60;
          pool.vx[s] = car.vx * 0.22 + bx * 34 + sx * side;
          pool.vy[s] = car.vy * 0.22 + by * 34 + sy * side;
          pool.drag[s] = 3;
          pool.alpha[s] = 0.9;
          if (muddy) pool.tint[s] = 0xc9b292;
        }
        for (let n = emit(1, 14 * k); n > 0; n--) {
          const s = pool.spawn(this.id('spray_drops'), x + bx * 3, y + by * 3);
          if (s < 0) continue;
          pool.vx[s] = car.vx * 0.3 + bx * 50 + sx * (rng() - 0.5) * 70;
          pool.vy[s] = car.vy * 0.3 + by * 50 + sy * (rng() - 0.5) * 70;
          pool.drag[s] = 2;
          if (muddy) pool.tint[s] = 0xb89c78;
        }
        if ((stress || speed > 150) && wetness >= 0.5) {
          for (let n = emit(2, 20 * (stress ? 1 : clamp((speed - 150) / 110, 0, 1))); n > 0; n--) {
            const anim = this.id('rooster');
            const s = pool.spawn(anim, x, y);
            if (s < 0) continue;
            pool.mode[s] = PM_LOOP;
            pool.frame0[s] = this.atlas.directionFrame(anim, back);
            pool.life[s] = 0.16;
            pool.vx[s] = car.vx * 0.8;
            pool.vy[s] = car.vy * 0.8;
            pool.alpha[s] = 0.9;
            pool.fade[s] = 0.08;
            if (muddy) pool.tint[s] = 0xc9b292;
          }
        }
      }

      // What each surface throws up (Section 13.2: surface-dependent flicks, dust, grit).
      if (!stress && this.has('surface_particles')) {
        if (code === S_SAND) {
          const storm = this.has('sand_streaks') ? 0.5 : 0;
          for (let n = emit(3, 15 * clamp((speed - 25) / 160, 0, 1.4) * (1 + slip)); n > 0; n--) {
            const s = pool.spawn(this.id('dust_plume'), x + bx * 3, y + by * 3);
            if (s < 0) continue;
            const side = (rng() - 0.5) * 50;
            pool.vx[s] = car.vx * 0.15 + bx * 26 + sx * side + plan.windX * storm;
            pool.vy[s] = car.vy * 0.15 + by * 26 + sy * side + plan.windY * storm;
            pool.drag[s] = 1.8;
            pool.alpha[s] = 0.92;
          }
        } else if (code === S_DIRT && !wet) {
          for (let n = emit(3, 12 * clamp((speed - 30) / 180, 0, 1.2) * (1 + slip)); n > 0; n--) {
            const s = pool.spawn(this.id('dirt_puff'), x + bx * 3, y + by * 3);
            if (s < 0) continue;
            pool.vx[s] = car.vx * 0.15 + bx * 22 + sx * (rng() - 0.5) * 40;
            pool.vy[s] = car.vy * 0.15 + by * 22 + sy * (rng() - 0.5) * 40;
            pool.drag[s] = 2.2;
            pool.alpha[s] = 0.9;
          }
        }
        if (code === S_MUD || (code === S_DIRT && wet)) {
          const rate = 24 * clamp((speed - 20) / 150, 0, 1.3) * (1 + slip * 1.5);
          for (let n = emit(4, rate); n > 0; n--)
            this.fling(this.id('mud_fleck'), x, y, car, bx, by, sx, sy, 3, 60, 0.25);
          if (code === S_MUD)
            for (let n = emit(5, 4 * fast); n > 0; n--) {
              const s = pool.spawn(this.id('dirt_puff'), x + bx * 3, y + by * 3);
              if (s < 0) continue;
              pool.vx[s] = car.vx * 0.12 + bx * 18;
              pool.vy[s] = car.vy * 0.12 + by * 18;
              pool.drag[s] = 2.5;
              pool.tint[s] = 0x8f7458;
            }
        } else if (code === S_COBBLE) {
          const rate =
            32 * Math.max(0, slip - 0.18) * (speed > 60 ? 1 : 0) + 3 * clamp(speed / 250, 0, 1);
          for (let n = emit(4, rate); n > 0; n--)
            this.fling(this.id('gravel'), x, y, car, bx, by, sx, sy, 2, 45, 0.35);
        } else if (code === S_SNOW) {
          for (let n = emit(3, 14 * clamp((speed - 25) / 170, 0, 1.4) * (1 + slip)); n > 0; n--) {
            const s = pool.spawn(this.id('snow_kick'), x + bx * 3, y + by * 3);
            if (s < 0) continue;
            const side = (rng() - 0.5) * 46;
            pool.vx[s] = car.vx * 0.16 + bx * 24 + sx * side + plan.windX * 0.25;
            pool.vy[s] = car.vy * 0.16 + by * 24 + sy * side + plan.windY * 0.25;
            pool.drag[s] = 2;
          }
          for (let n = emit(4, 6 * fast); n > 0; n--)
            this.fling(this.id('ice_chip'), x, y, car, bx, by, sx, sy, 2, 50, 0.3);
        } else if (code === S_ICE) {
          for (let n = emit(4, 26 * Math.max(0, slip - 0.12) * (speed > 40 ? 1 : 0)); n > 0; n--)
            this.fling(this.id('ice_chip'), x, y, car, bx, by, sx, sy, 2, 50, 0.3);
        } else if (code === S_METAL) {
          for (let n = emit(4, 40 * Math.max(0, slip - 0.28) * (speed > 70 ? 1 : 0)); n > 0; n--)
            this.fling(this.id('spark'), x, y, car, bx, by, sx, sy, 3, 40, 0.3);
        }
      }

      // Marks: a wet line, a groove in snow, a rut in sand or mud, every 9 pixels driven.
      let mark = -1;
      let life = 0;
      if (code === S_SNOW && this.has('snow_tracks')) {
        mark = this.id('track_snow');
        life = 4.5;
      } else if (code === S_SAND && this.has('sand_tracks')) {
        mark = this.id('track_sand');
        life = 3;
      } else if (code === S_MUD || (code === S_DIRT && wetness >= 0.3)) {
        mark = this.id('track_mud');
        life = 3;
      } else if (wet && wetness >= 0.4 && this.has('wet_tracks') && code !== S_DIRT) {
        mark = this.id('track_wet');
        life = 2.4;
      }
      const lx = this.markX[slot]!;
      const ly = this.markY[slot]!;
      if (mark < 0) {
        this.markX[slot] = NaN;
      } else if (Number.isNaN(lx) || Math.hypot(x - lx, y - ly) > 40) {
        this.markX[slot] = x;
        this.markY[slot] = y;
      } else if (Math.hypot(x - lx, y - ly) >= 9) {
        const s = pool.spawn(mark, (x + lx) / 2, (y + ly) / 2, WL_WET);
        if (s >= 0) {
          pool.mode[s] = PM_FIXED;
          pool.frame0[s] = this.atlas.directionFrame(mark, Math.atan2(x - lx, -(y - ly)));
          pool.life[s] = life;
          pool.fade[s] = life * 0.4;
        }
        this.markX[slot] = x;
        this.markY[slot] = y;
      }
    }

    // Breath-like tailpipe steam in the cold (Section 12.10).
    if (this.has('tailpipe_vapor') && (this.vaporTimer[c]! -= dt) <= 0) {
      this.vaporTimer[c] = (speed > 60 ? 0.22 : 0.4) / Math.max(0.25, d);
      for (const ex of rig.chassis.exhausts) {
        car.local(ex.x, ex.y, 2, v2);
        const s = pool.spawn(this.id('steam_s'), car.x + v2.x, car.y + v2.y, WL_KICK);
        if (s < 0) continue;
        pool.vx[s] = car.vx * 0.3 + bx * 18 + (rng() - 0.5) * 8;
        pool.vy[s] = car.vy * 0.3 + by * 18 - 8;
        pool.drag[s] = 2.2;
        pool.alpha[s] = 0.6;
      }
    }
  }

  /** A particle thrown up off a wheel that falls back and bounces. */
  private fling(
    anim: number,
    x: number,
    y: number,
    car: CarState,
    bx: number,
    by: number,
    sx: number,
    sy: number,
    frames: number,
    up: number,
    bounce: number,
  ): void {
    const rng = this.rng;
    const pool = this.pool;
    const s = pool.spawn(anim, x + (rng() - 0.5) * 3, y + (rng() - 0.5) * 3, WL_KICK);
    if (s < 0) return;
    const out = 40 + rng() * 60;
    const side = (rng() - 0.5) * 70;
    pool.mode[s] = PM_FIXED;
    pool.frame0[s] = Math.floor(rng() * frames);
    pool.vx[s] = car.vx * 0.3 + bx * out + sx * side;
    pool.vy[s] = car.vy * 0.3 + by * out + sy * side;
    pool.vz[s] = up + rng() * up;
    pool.z[s] = 1;
    pool.gravity[s] = 380;
    pool.bounce[s] = bounce;
    pool.drag[s] = 1.2;
    pool.life[s] = 0.45 + rng() * 0.25;
    pool.fade[s] = 0.12;
  }

  // --- The environment ----------------------------------------------------------------------------

  /** True when an emitter's clock has run out; it is then wound again, a little unevenly. */
  private due(slot: number, every: number, dt: number): boolean {
    const t = this.timers;
    t[slot]! -= dt;
    if (t[slot]! > 0) return false;
    t[slot] = every * (0.7 + this.rng() * 0.6);
    return true;
  }

  private inView(x: number, y: number, margin: number): boolean {
    return this.pool.inView(x, y, margin);
  }

  private emitAmbient(dt: number, clockTicks: number): void {
    const pool = this.pool;
    const rng = this.rng;
    const plan = this.plan;
    const d = this.density;
    let slot = 0;

    // Steam vents on their timetable: a lazy wisp when quiet, puffs that grow through the
    // warning (they are part of the telegraph, so they are never thinned), then the blast.
    if (this.has('steam_vents'))
      for (const v of this.vents) {
        const base = slot;
        slot += 3;
        if (!this.inView(v.x, v.y, 160)) continue;
        const state = hazardState(this.track.hazards[v.index]!, clockTicks);
        const every = state.phase === 'idle' ? 0.55 : state.phase === 'warning' ? 0.07 : 0.035;
        if (this.due(base, every, dt)) {
          const big = state.phase === 'active';
          const anim = big
            ? rng() < 0.5
              ? this.id('steam_l')
              : this.id('steam_m')
            : state.phase === 'warning' && rng() < 0.5
              ? this.id('steam_m')
              : this.id('steam_s');
          const a = rng() * TAU;
          const r = v.r * (state.phase === 'warning' ? 0.75 : 0.45) * rng();
          const s = pool.spawn(
            anim,
            v.x + Math.cos(a) * r,
            v.y + Math.sin(a) * r * 0.7,
            WL_AIR,
            200,
          );
          if (s >= 0) {
            pool.vx[s] = plan.windX * 0.2 + (rng() - 0.5) * 14;
            pool.vy[s] = big ? -55 - rng() * 25 : state.phase === 'warning' ? -26 : -14;
            pool.z[s] = big ? 4 : 0;
            pool.drag[s] = 0.8;
            pool.alpha[s] = big ? 0.66 : state.phase === 'warning' ? 0.6 : 0.42;
          }
        }
        if (
          state.phase !== 'idle' &&
          this.due(base + 1, state.phase === 'active' ? 0.12 : 0.26, dt)
        ) {
          // A low cloud spreading over the grate: what the car will drive into.
          const s = pool.spawn(
            this.id('fog_puff'),
            v.x + (rng() - 0.5) * v.r,
            v.y + (rng() - 0.5) * v.r * 0.6,
            WL_GROUND,
            200,
          );
          if (s >= 0) {
            pool.vx[s] = (rng() - 0.5) * 30;
            pool.vy[s] = (rng() - 0.5) * 16;
            pool.drag[s] = 1.5;
            pool.alpha[s] = state.phase === 'active' ? 0.6 : 0.4;
            pool.tint[s] = 0xf2f6ff;
          }
        }
      }

    // The smelter: showers of sparks that bounce, and embers.
    if (this.has('smelter_sparks'))
      for (const p of this.anchors.sparks ?? []) {
        const base = slot++;
        if (!this.inView(p.x, p.y, 120)) continue;
        if (!this.due(base, 1.1, dt)) continue;
        const n = Math.round((8 + rng() * 8) * Math.max(0.5, d));
        for (let k = 0; k < n; k++) {
          const s = pool.spawn(this.id('spark'), p.x + (rng() - 0.5) * 8, p.y, WL_KICK, 160);
          if (s < 0) break;
          const a = rng() * TAU;
          const sp = 30 + rng() * 70;
          pool.mode[s] = PM_FIXED;
          pool.frame0[s] = Math.floor(rng() * 3);
          pool.vx[s] = Math.cos(a) * sp;
          pool.vy[s] = Math.sin(a) * sp * 0.6;
          pool.z[s] = 10;
          pool.vz[s] = 50 + rng() * 90;
          pool.gravity[s] = 320;
          pool.bounce[s] = 0.3;
          pool.life[s] = 0.5 + rng() * 0.3;
          pool.fade[s] = 0.15;
        }
      }
    if (this.has('embers'))
      for (const p of this.emberPoints) {
        const base = slot++;
        if (!this.inView(p.x, p.y, 120) || !this.due(base, 0.3 / d, dt)) continue;
        const s = pool.spawn(
          this.id('ember'),
          p.x + (rng() - 0.5) * 30,
          p.y + (rng() - 0.5) * 12,
          WL_GLOW,
          160,
        );
        if (s < 0) continue;
        pool.mode[s] = PM_FIXED;
        pool.frame0[s] = Math.floor(rng() * 3);
        pool.vx[s] = plan.windX * 0.3 + (rng() - 0.5) * 14;
        pool.vy[s] = -16 - rng() * 18;
        pool.life[s] = 1.2 + rng() * 0.8;
        pool.fade[s] = 0.5;
      }
    if (this.has('chimney_smoke'))
      for (const p of this.anchors.chimney ?? []) {
        const base = slot++;
        if (!this.inView(p.x, p.y, 160) || !this.due(base, 0.24 / Math.max(0.5, d), dt)) continue;
        const s = pool.spawn(this.id('smoke_wisp'), p.x + (rng() - 0.5) * 4, p.y, WL_AIR, 200);
        if (s < 0) continue;
        pool.vx[s] = plan.windX * 0.6 + (rng() - 0.5) * 6;
        pool.vy[s] = plan.windY * 0.4 - 22;
        pool.alpha[s] = 0.72;
      }

    // Snow guns blow plumes of snow downwind; cold fog drifts off the drifts.
    if (this.has('snow_guns')) {
      const wl = Math.hypot(plan.windX, plan.windY) || 1;
      const ux = plan.windX / wl || 1;
      const uy = plan.windY / wl;
      for (const p of this.anchors.snow_gun ?? []) {
        const base = slot;
        slot += 2;
        if (!this.inView(p.x, p.y, 200)) continue;
        if (this.due(base, 0.05 / d, dt)) {
          const s = pool.spawn(this.id('flake'), p.x, p.y, WL_AIR, 200);
          if (s >= 0) {
            pool.mode[s] = PM_FIXED;
            pool.frame0[s] = 1 + Math.floor(rng() * 4);
            pool.vx[s] = ux * (80 + rng() * 40) + (rng() - 0.5) * 30;
            pool.vy[s] = uy * (80 + rng() * 40) + (rng() - 0.5) * 30 - 10;
            pool.z[s] = 8;
            pool.drag[s] = 0.9;
            pool.life[s] = 0.9 + rng() * 0.5;
            pool.fade[s] = 0.3;
          }
        }
        if (this.due(base + 1, 0.35 / d, dt)) {
          const s = pool.spawn(this.id('snow_kick'), p.x + ux * 10, p.y + uy * 10, WL_AIR, 200);
          if (s >= 0) {
            pool.vx[s] = ux * 50;
            pool.vy[s] = uy * 50 - 6;
            pool.drag[s] = 1.2;
            pool.alpha[s] = 0.8;
          }
        }
      }
    }
    if (this.has('cold_fog'))
      for (const p of this.anchors.snow_drift ?? []) {
        const base = slot++;
        if (!this.inView(p.x, p.y, 200) || !this.due(base, 0.7 / d, dt)) continue;
        const s = pool.spawn(
          this.id('fog_puff'),
          p.x + (rng() - 0.5) * 120,
          p.y + (rng() - 0.5) * 60,
          WL_GROUND,
          200,
        );
        if (s < 0) continue;
        pool.vx[s] = plan.windX * 0.5;
        pool.vy[s] = plan.windY * 0.5;
        pool.alpha[s] = 0.42;
      }

    // Ice glints on the frozen ground (Section 13.5: hard-edged icy sheen).
    if (this.has('ice_glints') && this.track.zoneSurface) {
      const f = this.frameIn!;
      const want = 120 * d * dt;
      const tries = Math.min(6, Math.floor(want) + (rng() < want % 1 ? 1 : 0));
      for (let k = 0; k < tries; k++) {
        const x = f.viewX + rng() * f.viewW;
        const y = f.viewY + rng() * f.viewH;
        if (zoneSurfaceAt(this.track, x, y) !== 'ice') continue;
        const s = pool.spawn(this.id('ice_glint'), Math.round(x), Math.round(y), WL_SHINE, 0);
        if (s >= 0) pool.alpha[s] = 0.9;
      }
    }

    // Leaf showers where the track marks them (Section 12.10: leaf bursts).
    if (this.has('leaves'))
      for (const p of this.anchors.leaves ?? []) {
        const base = slot++;
        if (!this.inView(p.x, p.y, 160) || !this.due(base, 0.3 / d, dt)) continue;
        const s = pool.spawn(
          this.id(LEAF_NAMES[Math.floor(rng() * 3)]!),
          p.x + (rng() - 0.5) * 160,
          p.y + (rng() - 0.5) * 60,
          WL_AIR,
          160,
        );
        if (s < 0) continue;
        pool.mode[s] = PM_LOOP;
        pool.frame0[s] = 0;
        pool.life[s] = 2.4 + rng();
        pool.vx[s] = plan.windX * 2 + (rng() - 0.5) * 16;
        pool.vy[s] = 14 + rng() * 10;
        pool.fade[s] = 0.5;
      }

    // Rain in the forest: drips under the canopy and round the trees, runoff under the bridge.
    if (this.has('canopy_drips') && this.due(slot++, 0.08 / d, dt)) {
      const f = this.frameIn!;
      const sources = this.dripSources;
      sources.length = 0;
      for (const p of this.anchors.canopy ?? []) if (this.inView(p.x, p.y, 120)) sources.push(p);
      for (const t of this.trees) if (this.inView(t.x, t.y, 40)) sources.push(t);
      if (sources.length > 0) {
        const src = sources[Math.floor(rng() * sources.length)]!;
        const r = src.h > 1 ? src.h * 1.6 : 110;
        const x = Math.round(src.x + (rng() - 0.5) * 2 * r);
        const y = Math.round(src.y + (rng() - 0.5) * 2 * r * 0.7);
        if (x > f.viewX && x < f.viewX + f.viewW) {
          const drop = pool.spawn(this.id('drip'), x, y, WL_AIR, 0);
          if (drop >= 0) pool.alpha[drop] = 1;
          const ring = pool.spawn(this.id('splash_ring'), x, y, WL_GROUND, 0);
          if (ring >= 0) pool.delay[ring] = 0.2;
        }
      }
    }
    if (this.has('runoff'))
      for (const p of this.anchors.waterfall ?? []) {
        const base = slot++;
        if (!this.inView(p.x, p.y, 120) || !this.due(base, 0.12 / d, dt)) continue;
        const s = pool.spawn(
          this.id('spray_puff'),
          p.x + (rng() - 0.5) * 40,
          p.y + (rng() - 0.5) * 10,
          WL_GROUND,
          120,
        );
        if (s < 0) continue;
        pool.vx[s] = (rng() - 0.5) * 20;
        pool.vy[s] = 10 + rng() * 14;
        pool.drag[s] = 1;
        pool.alpha[s] = 0.85;
      }
  }

  // --- Lightning ----------------------------------------------------------------------------------

  /**
   * A heavy storm's sky flash: never with Reduce Flashes or Reduced Motion, never within 20
   * seconds of the last, never white (a blue-violet wash of at most 16 percent, additive), in
   * two pulses over a quarter of a second.
   */
  private updateLightning(f: WeatherFrame): void {
    this.flash = 0;
    if (!this.has('lightning') || f.reduceFlashes || this.reducedMotion) {
      this.flashStart = -1;
      return;
    }
    if (this.flashStart < 0 && this.clock >= this.nextFlash) {
      this.flashStart = this.clock;
      this.lastFlashAt = this.clock;
      this.flashes++;
      this.nextFlash = this.clock + LIGHTNING_MIN_GAP + this.rng() * 16;
    }
    if (this.flashStart >= 0) {
      const t = this.clock - this.flashStart;
      if (t < 0.07) this.flash = 0.16;
      else if (t < 0.13) this.flash = 0;
      else if (t < 0.24) this.flash = 0.1;
      else this.flashStart = -1;
    }
  }

  // --- Drawing ------------------------------------------------------------------------------------

  private drawPool(): void {
    const pool = this.pool;
    const atlas = this.atlas;
    const list = this.list;
    for (let l = 0; l < WL_COUNT; l++) {
      for (let i = pool.layerStart[l]!; i < pool.layerEnd[l]!; i++) {
        if (!pool.active[i] || pool.delay[i]! > 0) continue;
        const a = pool.anim[i]!;
        const x = Math.round(pool.x[i]! - atlas.anchorX[a]!);
        const y = Math.round(pool.y[i]! - pool.z[i]! - atlas.anchorY[a]!);
        list.push(l, pool.frameOf(i), x, y, pool.alphaOf(i), pool.tint[i]!);
      }
    }
  }

  /** A sprite at a world point by its anchor, on the ground's pixel grid. */
  private put(
    layer: number,
    anim: number,
    frame: number,
    x: number,
    y: number,
    alpha: number,
    tint = 0xffffff,
  ): void {
    const atlas = this.atlas;
    this.list.push(
      layer,
      atlas.frameBase[anim]! + frame,
      Math.round(x - atlas.anchorX[anim]!),
      Math.round(y - atlas.anchorY[anim]!),
      alpha,
      tint,
    );
  }

  /** A sprite fixed to the screen, by its top-left corner in whole world pixels of the screen. */
  private putScreen(
    layer: number,
    anim: number,
    frame: number,
    sx: number,
    sy: number,
    alpha: number,
    tint = 0xffffff,
  ): void {
    const f = this.frameIn!;
    this.list.push(
      layer,
      this.atlas.frameBase[anim]! + frame,
      f.viewX + Math.round(sx),
      f.viewY + Math.round(sy),
      alpha,
      tint,
    );
  }

  private drawStateless(cars: readonly CarState[], lights: LightList | null): void {
    const f = this.frameIn!;
    const t = this.clock;
    const plan = this.plan;
    const atlas = this.atlas;
    const motion = this.reducedMotion ? 0 : 1;
    const x0 = f.viewX;
    const y0 = f.viewY;
    const x1 = f.viewX + f.viewW;
    const y1 = f.viewY + f.viewH;
    const near = (x: number, y: number, m: number) =>
      x > x0 - m && x < x1 + m && y > y0 - m && y < y1 + m;
    const wl = Math.hypot(plan.windX, plan.windY);
    const ux = wl > 1 ? plan.windX / wl : 1;
    const uy = wl > 1 ? plan.windY / wl : 0;

    // Tumbleweeds roll downwind across the road from their anchors, bouncing, now and then.
    if (this.has('tumbleweeds')) {
      const tw = this.id('tumbleweed');
      const sh = this.id('tumble_shadow');
      (this.anchors.tumbleweed ?? []).forEach((p, j) => {
        const period = 10 + p.h * 4;
        const k = (t + p.h * period) % period;
        if (k > 7) return;
        const speed = 66 * this.speedScale;
        const x = p.x - ux * 230 + ux * speed * k;
        const y = p.y - uy * 230 + uy * speed * k;
        if (!near(x, y, 30)) return;
        const z = Math.abs(Math.sin(k * 4.4)) * 5 * motion;
        this.put(WL_GROUND, sh, 0, x, y + 5, 1);
        this.put(WL_GROUND, tw, Math.floor(k * 14 + j) % atlas.timeFrames[tw]!, x, y - z, 1);
      });
    }
    if (this.has('dust_devils')) {
      const dd = this.id('dust_devil');
      for (const p of this.anchors.dust_devil ?? []) {
        const period = 26;
        const k = (t + p.h * period) % period;
        if (k > 16) continue;
        const x = p.x + Math.sin(t * 0.3 + p.h * 9) * 40 * motion;
        const y = p.y + Math.cos(t * 0.23 + p.h * 7) * 25 * motion;
        if (!near(x, y, 50)) continue;
        const edge = Math.min(k, 16 - k) / 2;
        const alpha = edge < 1 ? (Math.ceil(edge * 3) / 3) * 0.8 : 0.8;
        this.put(WL_GROUND, dd, Math.floor(t * 10) % atlas.timeFrames[dd]!, x, y, alpha);
      }
    }
    // Dust bands: ribbons of sand blowing across the road along the wind, on a world lattice.
    if (this.has('dust_bands')) {
      const band = this.id('dust_band');
      const dir = atlas.directionFrame(band, Math.atan2(ux, -uy));
      const cell = 180;
      const drift = t * 70 * this.speedScale * motion;
      const ox = ux * drift;
      const oy = uy * drift;
      const cx0 = Math.floor((x0 - 64 - ox) / cell);
      const cy0 = Math.floor((y0 - 64 - oy) / cell);
      const storm = this.has('visibility_haze') && plan.haze && plan.haze.maxAlpha > 0.3;
      for (let cy = cy0; cy * cell + oy < y1 + 64; cy++)
        for (let cx = cx0; cx * cell + ox < x1 + 64; cx++) {
          if (hash2(cx, cy, this.seed + 21) > (storm ? 0.75 : 0.4) * this.density * 2) continue;
          const x = cx * cell + ox + hash2(cx, cy, this.seed + 22) * cell;
          const y = cy * cell + oy + hash2(cx, cy, this.seed + 23) * cell;
          this.put(WL_GROUND, band, dir, x, y, storm ? 0.5 : 0.34, 0xffffff);
        }
    }
    // Mist pockets drift in the shaded bends, sparse and off the racing line.
    if (this.has('mist')) {
      const rainy = this.has('rain');
      const points = this.mistPoints;
      for (let j = 0; j < points.length; j++) {
        const p = points[j]!;
        const x = p.x + Math.sin(t * 0.08 * motion + p.h * 6) * 34;
        const y = p.y + Math.cos(t * 0.06 * motion + p.h * 4) * 10;
        if (!near(x, y, 60)) continue;
        this.put(WL_GROUND, this.id(j % 2 ? 'mist_1' : 'mist_0'), 0, x, y, rainy ? 0.4 : 0.3);
      }
    }
    // Light shafts through the trees, faint and slowly breathing.
    if (this.has('light_shafts')) {
      const cell = 300;
      for (let cy = Math.floor((y0 - 90) / cell); cy * cell < y1 + 90; cy++)
        for (let cx = Math.floor((x0 - 50) / cell); cx * cell < x1 + 50; cx++) {
          const hsh = hash2(cx, cy, this.seed + 31);
          if (hsh > 0.42) continue;
          const x = cx * cell + hash2(cx, cy, this.seed + 32) * cell;
          const y = cy * cell + hash2(cx, cy, this.seed + 33) * cell;
          const pulse = motion ? Math.floor(t / 2.2 + hsh * 7) % 3 : 1;
          this.put(
            WL_SHINE,
            this.id(hsh < 0.21 ? 'light_shaft_0' : 'light_shaft_1'),
            0,
            x,
            y,
            [0.1, 0.14, 0.18][pulse]!,
          );
        }
    }
    if (this.has('pollen') || this.has('fireflies')) {
      const fly = this.has('fireflies');
      const anim = this.id(fly ? 'firefly' : 'mote');
      for (const p of this.lightPoints) {
        if (!near(p.x, p.y, 140)) continue;
        for (let k = 0; k < 8; k++) {
          const h = hash2(k, Math.round(p.x), Math.round(p.y));
          const r = 30 + h * 90;
          const x = p.x + Math.sin(t * (0.3 + h * 0.4) * motion + h * 40) * r;
          const y = p.y + Math.cos(t * (0.25 + h * 0.3) * motion + h * 30) * r * 0.6;
          const frame = fly ? Math.floor(t * 6 + h * 4) % 4 : Math.floor(t * 2 + h * 9) % 3;
          this.put(WL_GLOW, anim, frame, x, y, 1);
        }
      }
    }
    // Heat: distant flicker over hot road far ahead, and at the haze anchors.
    if (this.has('heat_haze')) {
      const shimmer = this.id('heat_shimmer');
      const frame = motion ? Math.floor(t * 9) % atlas.timeFrames[shimmer]! : 0;
      const own = cars[f.you];
      let n = 0;
      if (this.preset.weather === 'dry_heat' && own?.present) {
        locate(this.track, own.x, own.y, this.loc);
        const branch = this.track.branches[this.loc.branch]!;
        for (let ahead = 200; ahead <= 440; ahead += 80) {
          const p = sampleBranch(branch, this.loc.s + ahead);
          this.heatX[n] = p.x;
          this.heatY[n++] = p.y;
        }
      }
      for (const p of this.anchors.heat_haze ?? [])
        if (n < this.heatX.length) {
          this.heatX[n] = p.x;
          this.heatY[n++] = p.y;
        }
      for (let k = 0; k < n; k++) {
        const x = this.heatX[k]!;
        const y = this.heatY[k]!;
        if (!near(x, y, 20)) continue;
        if (own?.present && Math.hypot(x - own.x, y - own.y) < 170) continue;
        this.put(WL_SHINE, shimmer, frame, x, y, 0.5);
      }
    }

    if (this.has('reflections')) this.drawReflections(cars, lights);
    if (plan.haze) this.drawHaze();
    if (this.has('frost_vignette')) this.drawFrost();
  }

  /**
   * Light on wet ground (Sections 12.9 and 13.5): each car's headlights, its brake lights (and
   * at night its tail lights), every flash and blast the combat stage is drawing, and the
   * baked street lamps, as short blocky streaks running down the screen from the light, only
   * where the ground holds water. The bake supplies no wetness mask, so the ground's surface
   * from the track data decides: asphalt, cobble, metal and ice reflect; sand, dirt, mud and
   * snow do not.
   */
  private drawReflections(cars: readonly CarState[], lights: LightList | null): void {
    const plan = this.plan;
    const night = plan.night;
    const strength = clamp(plan.wetness, 0, 1);
    for (let c = 0; c < cars.length && c < 2; c++) {
      const car = cars[c]!;
      const rig = car.rig;
      if (!car.present || !rig || !this.wetAt(this.carSurface[c]!)) continue;
      const head = this.id('refl_1');
      for (const anchor of rig.chassis.headlightAnchors) {
        car.local(anchor.x, anchor.y, 0, v2);
        this.put(
          WL_SHINE,
          head,
          Math.floor(this.clock * 7 + c) % 2,
          car.x + v2.x,
          car.y + v2.y + 2,
          (night ? 0.95 : 0.5) * strength,
          NIGHT_HEAD,
        );
      }
      const tailAnim = this.id(car.braking ? 'refl_1' : 'refl_0');
      if (car.braking || night)
        for (const anchor of rig.chassis.brakeLightAnchors) {
          car.local(anchor.x, anchor.y, 0, v2);
          this.put(
            WL_SHINE,
            tailAnim,
            Math.floor(this.clock * 7 + c + 1) % 2,
            car.x + v2.x,
            car.y + v2.y + 2,
            (car.braking ? 1 : 0.7) * strength,
            car.braking ? BRAKE : TAIL,
          );
        }
    }
    if (lights)
      for (let i = 0; i < lights.count; i++) {
        const x = lights.x[i]!;
        const y = lights.y[i]!;
        if (!this.wetAt(this.coarseSurfaceAt(x, y))) continue;
        const anim = this.id(`refl_${lights.size[i]!}`);
        const alpha = (this.frameIn!.reduceFlashes ? 0.5 : 1) * strength;
        this.put(
          WL_SHINE,
          anim,
          Math.floor(this.clock * 14 + i) % 2,
          x,
          y + 2,
          alpha,
          lights.tint[i]!,
        );
      }
    const f = this.frameIn!;
    for (let i = 0; i < this.lamps.length; i++) {
      const lamp = this.lamps[i]!;
      if (lamp.x < f.viewX - 10 || lamp.x > f.viewX + f.viewW + 10) continue;
      if (lamp.y < f.viewY - 40 || lamp.y > f.viewY + f.viewH + 10) continue;
      if (this.lampWet[i]! < 0)
        this.lampWet[i] = this.wetAt(this.surfaceCodeAt(lamp.x, lamp.y)) ? 1 : 0;
      if (!this.lampWet[i]) continue;
      // One lamp in three, so a row of street lights breaks into a few streaks, not a fence.
      if (hash2(Math.round(lamp.x), Math.round(lamp.y), 71) > 0.34) continue;
      const tint = parseInt(lamp.color.replace('#', ''), 16) || 0xffe0a0;
      const alpha = stepped(clamp(lamp.intensity, 0.3, 1) * strength * 0.6, 0.15);
      const len = hash2(Math.round(lamp.x), Math.round(lamp.y), 73) < 0.5 ? 'refl_2' : 'refl_1';
      this.put(
        WL_SHINE,
        this.id(len),
        Math.floor(this.clock * 5 + i) % 2,
        lamp.x,
        lamp.y + 3,
        alpha,
        tint,
      );
    }
    // The storm's flash lights the wet road for a moment.
  }

  /**
   * The visibility modifier, shown (Section 9.2): blobs of the weather's color at the edges and
   * corners of the screen, in fixed alpha steps, drifting with the wind (not under Reduced
   * Motion). Each blob's alpha is cut to nothing near the local car, along the road ahead of
   * it and round the rival (`ProtectedZone`), so the haze reduces contrast where the player is
   * not looking and never where they are.
   */
  private drawHaze(): void {
    const haze = this.plan.haze!;
    const f = this.frameIn!;
    const zone = this.zone;
    const step = 0.06;
    const drift = this.reducedMotion ? 0 : this.clock * 0.45;
    const ox = this.plan.windX * drift;
    const oy = this.plan.windY * drift;
    const m = 30;
    const bw = f.viewW + m * 2;
    const bh = f.viewH + m * 2;
    // About two hundred drifts at most: a wider view spaces them further apart instead.
    const k = Math.max(1, Math.sqrt(((bw / HAZE_W) * (bh / HAZE_H)) / 200));
    const cols = Math.ceil(bw / (HAZE_W * k));
    const rows = Math.ceil(bh / (HAZE_H * k));
    const sw = bw / cols;
    const sh = bh / rows;
    const w2 = 32;
    const h2 = 32;
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) {
        const sx = ((((i * sw - ox) % bw) + bw) % bw) - m + hash2(i, j, 41) * 8;
        const sy = ((((j * sh - oy) % bh) + bh) % bh) - m + hash2(i, j, 43) * 8;
        const e = edgeWeight(sx / f.viewW, sy / f.viewH);
        if (e <= 0) continue;
        const wx = f.viewX + sx;
        const wy = f.viewY + sy;
        const allow = zone.allowance(wx - w2, wy - h2, wx + w2, wy + h2);
        const alpha = stepped(haze.maxAlpha * e * allow * (0.8 + 0.2 * hash2(i, j, 47)), step);
        if (alpha <= 0) continue;
        const anim = this.id(`haze_${Math.floor(hash2(i, j, 49) * 3)}`);
        this.putScreen(WL_SCREEN, anim, this.hazeDir, sx - 32, sy - 32, alpha, haze.tint);
      }
  }

  /** Frost growing in from the screen's border, left out near either car. */
  private drawFrost(): void {
    const f = this.frameIn!;
    const zone = this.zone;
    const base = this.preset.weather === 'snowfall' ? 0.7 : 0.6;
    const edge = (name: string, sx: number, sy: number, w: number, h: number, alpha: number) => {
      const allow = zone.allowance(f.viewX + sx, f.viewY + sy, f.viewX + sx + w, f.viewY + sy + h);
      const a = stepped(alpha * allow, 0.1);
      if (a > 0) this.putScreen(WL_SCREEN, this.id(name), 0, sx, sy, a);
    };
    const w = Math.ceil(f.viewW);
    const h = Math.ceil(f.viewH);
    // Densest in the corners, thinning toward the middle of each edge, gone at its centre.
    const keep = (t: number, k: number, salt: number) =>
      hash2(k, salt, 61) < 1.15 - Math.min(t, 1 - t) * 3.2;
    for (let x = 40, k = 0; x < w - 80; x += 40, k++) {
      const t = (x + 20) / w;
      const v = hash2(k, 1, 63) < 0.5 ? 0 : 1;
      if (keep(t, k, 1)) edge(`frost_top_${v}`, x, 0, 40, 12, base);
      if (keep(t, k, 2)) edge(`frost_bottom_${1 - v}`, x, h - 12, 40, 12, base);
    }
    for (let y = 40, k = 0; y < h - 80; y += 40, k++) {
      const t = (y + 20) / h;
      const v = hash2(k, 2, 63) < 0.5 ? 0 : 1;
      if (keep(t, k, 3)) edge(`frost_left_${v}`, 0, y, 12, 40, base);
      if (keep(t, k, 4)) edge(`frost_right_${1 - v}`, w - 12, y, 12, 40, base);
    }
    edge('frost_corner_tl', 0, 0, 40, 40, base + 0.1);
    edge('frost_corner_tr', w - 40, 0, 40, 40, base + 0.1);
    edge('frost_corner_bl', 0, h - 40, 40, 40, base + 0.1);
    edge('frost_corner_br', w - 40, h - 40, 40, 40, base + 0.1);
  }

  stats(): Record<string, number> {
    return {
      wxSprites: this.list.total(),
      wxParticles: this.pool.count(),
      wxDropped: this.list.dropped,
      wxRecycled: this.pool.recycled,
      wxFlashes: this.flashes,
    };
  }
}
