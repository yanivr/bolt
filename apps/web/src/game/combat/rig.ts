import type {
  AccessoryDefinition,
  CarAtlasManifest,
  ChassisSpriteManifest,
  ModuleKind,
  MountedPartSprite,
  PartAnchor,
  ResolvedBuild,
  StatusFamily,
} from '@bolt/shared';
import {
  BEHAVIOR_KIND,
  CAR_HEADINGS,
  COMPONENT_FIRST_WHEEL,
  STATUS_FAMILIES,
  TAU,
} from '@bolt/shared';
import { HEIGHT_LIFT } from '../vfx/EffectPool.js';
import { BodyMotion, HeadingLatch } from '../rendering/frame.js';

/**
 * Everything the combat presentation needs to know about one car, with no Phaser in it: where
 * its components are (the rig), what the simulation last said about it, and the visual state
 * the renderer copies onto the sprites each frame.
 */

export const MAX_PARTS = 16;
export const MAX_WHEELS = 6;
/** Height above the road, in authored units, at which a hit on the bodywork is drawn. */
export const BODY_HEIGHT = 7;

export type RigPart = {
  def: AccessoryDefinition;
  kind: ModuleKind;
  sprite: MountedPartSprite;
  muzzles: PartAnchor[];
  pivot: PartAnchor | null;
  /** True for the one weapon whose head follows its aim. */
  tracks: boolean;
};

const DEFAULT_MOUNT_HEIGHT = 10;
const ORIGIN: PartAnchor = { x: 0, y: 0, z: 3 };

export class CarRig {
  readonly parts: RigPart[] = [];
  readonly chassis: ChassisSpriteManifest;
  readonly halfLength: number;
  readonly halfWidth: number;
  readonly wheelCount: number;
  /** Chassis-local position of the steering rack, between the steered wheels. */
  readonly rackY: number;

  constructor(cars: CarAtlasManifest, build: ResolvedBuild) {
    const chassis = cars.chassis[build.chassis.id];
    if (!chassis) throw new Error(`No sprites for ${build.chassis.id}`);
    this.chassis = chassis;
    this.halfLength = build.chassis.bodyHalfLength;
    this.halfWidth = build.chassis.bodyHalfWidth;
    this.wheelCount = Math.min(MAX_WHEELS, chassis.wheelAnchors.length);
    const steered = chassis.wheelAnchors.filter((w) => w.steers);
    this.rackY =
      steered.length > 0
        ? steered.reduce((sum, w) => sum + w.y, 0) / steered.length
        : -this.halfLength * 0.6;
    const heights = chassis.mountHeights ?? {};
    build.parts.slice(0, MAX_PARTS).forEach((placed) => {
      const art = cars.parts?.[placed.def.id];
      this.parts.push({
        def: placed.def,
        kind: BEHAVIOR_KIND[placed.def.behaviorId] ?? 'passive',
        sprite: {
          instanceId: placed.instance.instanceId,
          partId: placed.def.id,
          x: placed.x,
          y: placed.y,
          z: heights[placed.mount.id] ?? DEFAULT_MOUNT_HEIGHT,
          quarterTurns: placed.instance.rotationQuarterTurns,
        },
        muzzles: art?.muzzles && art.muzzles.length > 0 ? art.muzzles : [ORIGIN],
        pivot: art?.pivot ?? null,
        tracks: placed.def.behaviorId === 'turret_burst',
      });
    });
  }

  /** Index of the first part built on a primitive, or -1. */
  partOfKind(kind: ModuleKind): number {
    return this.parts.findIndex((p) => p.kind === kind);
  }
}

export type Vec2 = { x: number; y: number };

const STATUS_SLOTS = STATUS_FAMILIES.length;
const statusIndex = new Map<StatusFamily, number>(STATUS_FAMILIES.map((f, i) => [f, i]));
export function statusSlot(family: StatusFamily): number {
  return statusIndex.get(family) ?? 0;
}

/** What put a status on a car, worked out on the client (the event does not say). */
export const SOURCE_NONE = 0;
export const SOURCE_OIL = 1;
export const SOURCE_FROST = 2;
export const SOURCE_FOAM = 3;
export const SOURCE_MINE = 4;

export class CarState {
  rig: CarRig | null = null;
  present = false;
  // --- As drawn this frame ---
  /** Sprite origin in world units, on the device pixel grid. */
  x = 0;
  y = 0;
  /** Exact heading, and the heading of the authored frame being shown. */
  heading = 0;
  frameHeading = 0;
  vx = 0;
  vy = 0;
  steer = 0;
  braking = false;
  roll = 0;
  bodyShiftX = 0;
  bodyShiftY = 0;
  readonly latch = new HeadingLatch();
  readonly body = new BodyMotion();

  // --- What the simulation last said ---
  chassis = 1;
  chassisMax = 1;
  readonly integrity = new Float32Array(2 + MAX_WHEELS + MAX_PARTS).fill(100);
  /** Tick each status runs out, 0 when it is not active; and its magnitude. */
  readonly statusUntil = new Float64Array(STATUS_SLOTS);
  readonly statusMagnitude = new Float32Array(STATUS_SLOTS);
  readonly moduleState = new Uint8Array(MAX_PARTS);
  readonly moduleAim = new Float32Array(MAX_PARTS);
  readonly moduleUp = new Uint8Array(MAX_PARTS);
  ko = false;
  /** What the grip loss and the slow came from: oil or frost, foam or a mine. */
  gripSource = SOURCE_NONE;
  slowSource = SOURCE_NONE;

  // --- Animation state, advanced every frame ---
  /** Height above the road in pixels: a jump, a bounce off a blast. */
  lift = 0;
  liftVelocity = 0;
  /** Extra body offset from a hit, in screen pixels, and seconds left of it. */
  recoilX = 0;
  recoilY = 0;
  recoilTime = 0;
  /** Seconds a component stays flashed white, by component index. */
  readonly flash = new Float32Array(2 + MAX_WHEELS + MAX_PARTS);
  bodyFlash = 0;
  /** Recoil of a part along its own facing, pixels, decaying. */
  readonly partKick = new Float32Array(MAX_PARTS);
  /** Extra turn of a part's sprite, radians: a hammer's swing, a sentry's pivot. */
  readonly partTurn = new Float32Array(MAX_PARTS);
  readonly partTurnFrom = new Float32Array(MAX_PARTS);
  readonly partTurnTo = new Float32Array(MAX_PARTS);
  readonly partTurnTime = new Float32Array(MAX_PARTS);
  readonly partTurnSpan = new Float32Array(MAX_PARTS);
  readonly partHidden = new Uint8Array(MAX_PARTS);
  /** Charge-up of a part: seconds done, seconds in all, and which look. 0 when idle. */
  readonly chargeAge = new Float32Array(MAX_PARTS);
  readonly chargeSpan = new Float32Array(MAX_PARTS);
  /** Seconds since a wheel was fitted, for the drop-in; -1 when settled. */
  readonly wheelDrop = new Float32Array(MAX_WHEELS).fill(-1);
  /** Per-emitter clocks, so smoke and sparks are spaced in time and not per frame. */
  readonly timers = new Float32Array(24);
  /** Where on the car it is burning, chassis-local, and whether that is known. */
  burnX = 0;
  burnY = 0;
  /** Seconds a silhouette outline is held over the effects (Section 13.3, heavy blasts). */
  outline = 0;
  shieldPhase = 0;
  shieldRipple = 0;
  shieldRippleAngle = 0;
  /** Where the foam stuck, as seeds for the clumps. */
  foamSeed = 0;
  /** Seconds of victory sparkle left. */
  sparkle = 0;
  hop = 0;

  reset(): void {
    this.integrity.fill(100);
    this.statusUntil.fill(0);
    this.statusMagnitude.fill(0);
    this.moduleState.fill(0);
    this.moduleAim.fill(0);
    this.moduleUp.fill(0);
    this.ko = false;
    this.gripSource = SOURCE_NONE;
    this.slowSource = SOURCE_NONE;
    this.lift = 0;
    this.liftVelocity = 0;
    this.recoilTime = 0;
    this.flash.fill(0);
    this.bodyFlash = 0;
    this.partKick.fill(0);
    this.partTurn.fill(0);
    this.partTurnTime.fill(0);
    this.partTurnSpan.fill(0);
    this.partHidden.fill(0);
    this.chargeAge.fill(0);
    this.chargeSpan.fill(0);
    this.wheelDrop.fill(-1);
    this.timers.fill(0);
    this.outline = 0;
    this.shieldRipple = 0;
    this.sparkle = 0;
    this.hop = 0;
    this.chassis = 1;
    this.chassisMax = 1;
    this.latch.reset();
    this.body.reset();
  }

  has(family: StatusFamily, tick: number): boolean {
    return this.statusUntil[statusSlot(family)]! > tick;
  }

  /** Section 8.1 state of a component: 0 healthy, 1 damaged, 2 critical, 3 disabled. */
  condition(component: number): number {
    const v = this.integrity[component]!;
    return v > 65 ? 0 : v > 20 ? 1 : v > 0 ? 2 : 3;
  }

  /** Chassis damage tier: 0 sound, 1 scuffed, 2 battered, 3 wrecked or limping. */
  damageTier(): number {
    const share = this.chassis / Math.max(1, this.chassisMax);
    return share > 0.7 ? 0 : share > 0.4 ? 1 : share > 0.12 ? 2 : 3;
  }

  /** Screen offset of a chassis-local point at a height, from the car's drawn origin. */
  local(lx: number, ly: number, z: number, out: Vec2): Vec2 {
    const c = Math.cos(this.frameHeading);
    const s = Math.sin(this.frameHeading);
    out.x = lx * c - ly * s + this.bodyShiftX;
    out.y = lx * s + ly * c - z * HEIGHT_LIFT - this.lift + this.bodyShiftY;
    return out;
  }

  /** Heading, on screen, of the frame a part is drawn with: car, quarter turns, aim, swing. */
  partHeading(index: number): number {
    const rig = this.rig;
    const part = rig?.parts[index];
    if (!part) return this.frameHeading;
    const step = TAU / CAR_HEADINGS;
    const base = part.tracks
      ? this.frameHeading + this.moduleAim[index]!
      : this.frameHeading + (part.sprite.quarterTurns * TAU) / 4;
    return Math.round((base + this.partTurn[index]!) / step) * step;
  }

  /** Screen offset of the centre of a mounted part. */
  partOffset(index: number, out: Vec2): Vec2 {
    const part = this.rig?.parts[index];
    if (!part) {
      out.x = 0;
      out.y = 0;
      return out;
    }
    this.local(part.sprite.x, part.sprite.y, part.sprite.z, out);
    out.x = Math.round(out.x);
    out.y = Math.round(out.y);
    return out;
  }

  /** Screen offset of a part's muzzle, with the part's recoil taken off. */
  muzzleOffset(index: number, barrel: number, out: Vec2): Vec2 {
    const part = this.rig?.parts[index];
    this.partOffset(index, out);
    if (!part) return out;
    const anchor = part.muzzles[barrel % part.muzzles.length]!;
    const heading = this.partHeading(index);
    // The baker's own arithmetic (`partAnchorOffset`), written out so nothing is allocated.
    const c = Math.cos(heading);
    const s = Math.sin(heading);
    const kick = this.partKick[index]!;
    out.x += anchor.x * c - anchor.y * s - s * kick;
    out.y += anchor.x * s + anchor.y * c - HEIGHT_LIFT * anchor.z + c * kick;
    return out;
  }

  /** Chassis-local position and height of a component, for effects that sit on it. */
  componentLocal(component: number, out: { x: number; y: number; z: number }): void {
    const rig = this.rig;
    out.x = 0;
    out.y = 0;
    out.z = BODY_HEIGHT;
    if (!rig) return;
    if (component === 0) {
      out.x = rig.chassis.engineAnchor.x;
      out.y = rig.chassis.engineAnchor.y;
      out.z = 9;
    } else if (component === 1) {
      out.y = rig.rackY;
      out.z = 8;
    } else if (component < COMPONENT_FIRST_WHEEL + rig.wheelCount) {
      const w = rig.chassis.wheelAnchors[component - COMPONENT_FIRST_WHEEL]!;
      out.x = w.x;
      out.y = w.y;
      out.z = 2;
    } else {
      const part = rig.parts[component - COMPONENT_FIRST_WHEEL - rig.wheelCount];
      if (part) {
        out.x = part.sprite.x;
        out.y = part.sprite.y;
        out.z = part.sprite.z + 3;
      }
    }
  }

  /** Component index of a mounted part. */
  partComponent(part: number): number {
    return COMPONENT_FIRST_WHEEL + (this.rig?.wheelCount ?? 0) + part;
  }
}
