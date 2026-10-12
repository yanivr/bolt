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
  DEEP_GROUND_FLOOR,
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
 * The crawl floor on loose ground (docs/BALANCE_CHANGELOG.md, "The loose-ground crawl floor",
 * and 0.7.1, the deep-ground floor). Rolling resistance on sand, dirt, mud, snow, a shoulder or
 * open ground never takes more than `LOOSE_CREEP.driveShare` of a slow car's own drive, so
 * nobody stalls; on sand and mud the band reaches a trudging pace (`DEEP_GROUND_FLOOR`), on the
 * rest a crawl. Above the band the whole resistance applies as before, and a car with drive to
 * spare is never touched.
 */

const DESERT = conditionsFor('desert_01', 'desert_clear') as BuildConditions;
const DESERT_ENV = environmentFor('desert_clear') as RaceEnvironment;
const saved = { ...LOOSE_CREEP };
const savedDeep = { ...DEEP_GROUND_FLOOR };
function restore(): void {
  Object.assign(LOOSE_CREEP, saved);
  Object.assign(DEEP_GROUND_FLOOR, savedDeep);
}
afterEach(restore);

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

/** Turns the floor off: every speed is at or above every band's `fadeTo`. */
function floorOff(): void {
  LOOSE_CREEP.fadeTo = -1;
  for (const surface of Object.keys(DEEP_GROUND_FLOOR) as SurfaceId[])
    DEEP_GROUND_FLOOR[surface] = { fullBelow: -2, fadeTo: -1 };
}

describe('the crawl floor', () => {
  it('lets a car with less drive than the sand resists trudge, where it used to stand still', () => {
    // Iron Mule: Four-Cylinder and Armored Tires on a Pickup, 38 px/s2 of drive from rest
    // against 42 of sand.
    const mule = paramsOf('example_iron_mule');
    expect(driveForceAt(mule, 0) / mule.massKg).toBeLessThan(SURFACE_ROLLING_DECEL.sand);
    floorOff();
    expect(straight(mule, 'sand', 10).at(-1)).toBe(0);
    restore();
    const speeds = straight(mule, 'sand', 20);
    expect(speeds[29]!).toBeGreaterThan(5);
    expect(speeds.at(-1)!).toBeGreaterThan(110);
    // Slow, not cured: about half the same car's speed on asphalt, and below the trudging band's
    // top, which only a car with drive to spare passes.
    expect(speeds.at(-1)!).toBeLessThan(straight(mule, 'asphalt', 20).at(-1)! * 0.6);
    expect(speeds.at(-1)!).toBeLessThan(DEEP_GROUND_FLOOR.sand!.fadeTo);
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

  it('applies the whole resistance above the band: a trudge on sand and mud, a crawl elsewhere', () => {
    const bands = [
      ['sand', DEEP_GROUND_FLOOR.sand!],
      ['mud', DEEP_GROUND_FLOOR.mud!],
      ['snow', LOOSE_CREEP],
      ['dirt', LOOSE_CREEP],
    ] as const;
    for (const [surface, band] of bands) {
      expect(creepRelief(surface, false, 42, 10, band.fadeTo), surface).toBe(0);
      expect(creepRelief(surface, false, 42, 10, band.fadeTo + 40), surface).toBe(0);
      const half = (band.fullBelow + band.fadeTo) / 2;
      const excess = 42 - LOOSE_CREEP.driveShare * 10;
      expect(creepRelief(surface, false, 42, 10, half), surface).toBeCloseTo(excess / 2, 9);
      expect(creepRelief(surface, false, 42, 10, band.fullBelow - 1), surface).toBeCloseTo(
        excess,
        9,
      );
    }
    // A shoulder beside a paved road keeps the crawl band, whatever the surface.
    expect(creepRelief('asphalt', true, 34, 10, LOOSE_CREEP.fadeTo)).toBe(0);
    // Stronger is never slower: the net push at any speed does not fall as drive rises.
    for (const surface of ['sand', 'mud'] as const)
      for (let v = 0; v <= 200; v += 10) {
        let last = -Infinity;
        for (let drive = 0; drive <= 120; drive += 2) {
          const net = drive - (42 - creepRelief(surface, false, 42, drive, v));
          expect(net, `${surface} ${v} ${drive}`).toBeGreaterThanOrEqual(last - 1e-9);
          last = net;
        }
      }
  });

  it('is bit-identical for every shipped build on paved surfaces, and for strong cars on sand', () => {
    // Drive to spare all the way through the deep-ground band (to 170 px/s on sand). The
    // Sprinter is not on the list: between 160 and 170 px/s its drive falls under what the band
    // leaves alone, so it reaches its top speed on sand a little sooner; the top speed itself is
    // unchanged (next test).
    const strong = ['example_straight_line_rocket', 'example_tiny_trouble', 'example_dust_spider'];
    for (const t of RIVAL_TEMPLATES) {
      const params = paramsOf(t.id);
      for (const surface of ['asphalt', 'cobble', 'metal', 'ice'] as const) {
        const on = straight(params, surface, 12);
        floorOff();
        const off = straight(params, surface, 12);
        restore();
        expect(on, `${t.id} on ${surface}`).toEqual(off);
      }
    }
    for (const id of strong) {
      const on = straight(paramsOf(id), 'sand', 12);
      floorOff();
      const off = straight(paramsOf(id), 'sand', 12);
      restore();
      expect(on, id).toEqual(off);
    }
  });

  it("changes no shipped build's top speed on sand that was above the band", () => {
    for (const t of RIVAL_TEMPLATES) {
      const params = paramsOf(t.id);
      const on = straight(params, 'sand', 40).at(-1)!;
      floorOff();
      const off = straight(params, 'sand', 40).at(-1)!;
      restore();
      if (off >= DEEP_GROUND_FLOOR.sand!.fadeTo) expect(on, t.id).toBeCloseTo(off, 6);
      // A car the band lifts is never lifted past the band's top.
      else expect(on, t.id).toBeLessThan(DEEP_GROUND_FLOOR.sand!.fadeTo);
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
