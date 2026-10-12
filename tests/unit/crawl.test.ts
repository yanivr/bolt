import {
  RIVAL_TEMPLATES,
  TIRE_LIST,
  DEFAULT_LOADOUT,
  conditionsFor,
  environmentFor,
  raceEntry,
  resolveLoadout,
} from '@bolt/content';
import type {
  BuildConditions,
  RaceEnvironment,
  SurfaceId,
  TrackDefinition,
  VehicleParams,
} from '@bolt/shared';
import {
  LOOSE_CREEP,
  SURFACE_ROLLING_DECEL,
  buildTrack,
  createDriveSession,
  createMotionState,
  createPowertrainOutput,
  createTelemetry,
  creepRelief,
  driveForceAt,
  rollingDecel,
  stepDriveSession,
  stepStraight,
} from '@bolt/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { makeOpenField } from '../helpers/openField.js';
import { makeProvingGround } from '../helpers/tracks.js';

/**
 * The crawl floor on loose ground (docs/BALANCE_CHANGELOG.md, "The loose-ground crawl floor").
 * Rolling resistance on sand, dirt, mud, snow, a shoulder or open ground never takes more than
 * `LOOSE_CREEP.driveShare` of a creeping car's own drive, so nobody stalls; above `fadeTo` the
 * whole resistance applies as before, and a car with drive to spare is never touched.
 */

const DESERT = conditionsFor('desert_01', 'desert_clear') as BuildConditions;
const DESERT_ENV = environmentFor('desert_clear') as RaceEnvironment;
const saved = { ...LOOSE_CREEP };
afterEach(() => Object.assign(LOOSE_CREEP, saved));

function paramsOf(templateId: string): VehicleParams {
  return raceEntry(RIVAL_TEMPLATES.find((t) => t.id === templateId)!.blueprint, DESERT)!.params;
}

function straight(params: VehicleParams, surface: SurfaceId, seconds: number): number[] {
  const state = createMotionState(0, 0, 0, params);
  const power = createPowertrainOutput();
  const telemetry = createTelemetry();
  const speeds: number[] = [];
  let v = 0;
  for (let i = 0; i < Math.round(seconds * 30); i++) {
    v = stepStraight(state, v, params, DESERT_ENV, surface, 1 / 30, power, telemetry);
    speeds.push(v);
  }
  return speeds;
}

/** Turns the floor off: every speed is at or above `fadeTo`. */
function floorOff(): void {
  LOOSE_CREEP.fadeTo = -1;
}

describe('the crawl floor', () => {
  it('lets a car with less drive than the sand resists crawl, where it used to stand still', () => {
    // Iron Mule: Four-Cylinder and Armored Tires on a Pickup, 38 px/s2 of drive from rest
    // against 42 of sand.
    const mule = paramsOf('example_iron_mule');
    expect(driveForceAt(mule, 0) / mule.massKg).toBeLessThan(SURFACE_ROLLING_DECEL.sand);
    floorOff();
    expect(straight(mule, 'sand', 10).at(-1)).toBe(0);
    Object.assign(LOOSE_CREEP, saved);
    const speeds = straight(mule, 'sand', 20);
    expect(speeds[29]!).toBeGreaterThan(5);
    expect(speeds.at(-1)!).toBeGreaterThan(35);
    // A crawl, not a cure: far slower than the same car on asphalt.
    expect(speeds.at(-1)!).toBeLessThan(straight(mule, 'asphalt', 20).at(-1)! * 0.4);
  });

  it('keeps the net push at a creep at least the rest of the drive share', () => {
    for (const surface of ['sand', 'mud', 'snow', 'dirt'] as const)
      for (const drive of [10, 30, 50]) {
        const ground = 70;
        const relief = creepRelief(surface, false, ground, drive, 5);
        expect(ground - relief).toBeCloseTo(LOOSE_CREEP.driveShare * drive, 9);
        expect(drive - (ground - relief)).toBeGreaterThan(0);
      }
    // A shoulder of any surface counts as loose ground; the road itself does not.
    expect(creepRelief('asphalt', true, 34, 20, 5)).toBeGreaterThan(0);
    for (const surface of ['asphalt', 'cobble', 'metal', 'ice'] as const)
      expect(creepRelief(surface, false, 60, 10, 5)).toBe(0);
  });

  it('applies the whole resistance above the creeping speed', () => {
    expect(creepRelief('sand', false, 42, 10, LOOSE_CREEP.fadeTo)).toBe(0);
    expect(creepRelief('sand', false, 42, 10, LOOSE_CREEP.fadeTo + 40)).toBe(0);
    const half = (LOOSE_CREEP.fullBelow + LOOSE_CREEP.fadeTo) / 2;
    const excess = 42 - LOOSE_CREEP.driveShare * 10;
    expect(creepRelief('sand', false, 42, 10, half)).toBeCloseTo(excess / 2, 9);
    expect(creepRelief('sand', false, 42, 10, LOOSE_CREEP.fullBelow - 1)).toBeCloseTo(excess, 9);
  });

  it('is bit-identical for every shipped build on paved surfaces, and for strong cars on sand', () => {
    const strong = ['starter_sprinter', 'example_straight_line_rocket', 'example_tiny_trouble'];
    for (const t of RIVAL_TEMPLATES) {
      const params = paramsOf(t.id);
      for (const surface of ['asphalt', 'cobble', 'metal', 'ice'] as const) {
        const on = straight(params, surface, 12);
        floorOff();
        const off = straight(params, surface, 12);
        Object.assign(LOOSE_CREEP, saved);
        expect(on, `${t.id} on ${surface}`).toEqual(off);
      }
    }
    for (const id of strong) {
      const on = straight(paramsOf(id), 'sand', 12);
      floorOff();
      const off = straight(paramsOf(id), 'sand', 12);
      Object.assign(LOOSE_CREEP, saved);
      expect(on, id).toEqual(off);
    }
  });

  it('is bit-identical in the full integrator for the default car on the proving ground', () => {
    const run = (def: TrackDefinition): number[] => {
      const r = resolveLoadout(DEFAULT_LOADOUT);
      if (!r.ok) throw new Error('default loadout');
      const session = createDriveSession(buildTrack(def), DESERT_ENV, r.params);
      const out: number[] = [];
      for (let i = 0; i < 30 * 15; i++) {
        stepDriveSession(session, { steer: i % 90 < 45 ? 0.3 : -0.2, brake: 0, coast: false });
        out.push(session.motion.x, session.motion.y, session.motion.velocityX);
      }
      return out;
    };
    const ground = makeProvingGround('asphalt');
    const on = run(ground);
    floorOff();
    expect(run(ground)).toEqual(on);
  });

  it('gets a stalled car moving again off the road on open ground', () => {
    const track = buildTrack(makeOpenField({ offroad: 'sand' }));
    const mule = paramsOf('example_iron_mule');
    const drive = (): number => {
      const session = createDriveSession(track, DESERT_ENV, mule);
      // Off the road, south of it, pointing south: open sand all the way.
      session.motion.x = 6000;
      session.motion.y = 3400;
      session.motion.headingRad = Math.PI;
      for (let i = 0; i < 30 * 12; i++)
        stepDriveSession(session, { steer: 0, brake: 0, coast: false });
      return Math.hypot(session.motion.x - 6000, session.motion.y - 3400);
    };
    const moved = drive();
    floorOff();
    const before = drive();
    expect(before).toBeLessThan(5);
    expect(moved).toBeGreaterThan(150);
  });

  it('leaves Sand Paddles clearly the best kit on sand, and wrong tires a real penalty', () => {
    const top = (tireKitId: string): number => {
      const r = resolveLoadout({ ...DEFAULT_LOADOUT, tireKitId });
      if (!r.ok) throw new Error(tireKitId);
      return straight(r.params, 'sand', 25).at(-1)!;
    };
    const speeds = TIRE_LIST.map((t) => [t.id, top(t.id)] as const).sort((a, b) => b[1] - a[1]);
    expect(speeds[0]![0]).toBe('tires_sand');
    expect(top('tires_sand')).toBeGreaterThan(top('tires_street') * 1.2);
    // The resistance on sand for street tires is unchanged once the car is moving.
    const street = resolveLoadout({ ...DEFAULT_LOADOUT, tireKitId: 'tires_street' });
    if (!street.ok) throw new Error('street');
    expect(rollingDecel(street.params, 'sand', false)).toBe(SURFACE_ROLLING_DECEL.sand);
  });
});
