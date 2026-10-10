import {
  CATALOG,
  CATALOG_VERSION,
  CHASSIS_LIST,
  CITY_01,
  ENGINE_LIST,
  TIRE_LIST,
  conditionsFor,
} from '@bolt/content';
import type { BlueprintPart, QuarterTurn, VehicleBlueprint } from '@bolt/shared';
import {
  SIM_DT,
  buildHash,
  buildTrack,
  canonicalizeBlueprint,
  computeBuildStats,
  createDriveSession,
  deriveVehicleParams,
  installPart,
  mulberry32,
  repairBlueprint,
  stepDriveSession,
  validateBlueprint,
  validateUntrustedBlueprint,
} from '@bolt/shared';
import { describe, expect, it } from 'vitest';

/**
 * Fuzzing the validator (Section 20, Milestone B gate: "automatically validate every SKU,
 * build unusual cars"). Thousands of random blueprints, legal and not. The validator must
 * never throw, must never accept a car that is over budget, over weight or has overlapping
 * parts, and every car it does accept must drive for twenty seconds with finite state.
 *
 * The acceptance checks below recompute cost, load and overlap from the catalog with their
 * own few lines of arithmetic, so they do not share a bug with the code under test.
 */

const PARTS = Object.values(CATALOG.parts);
const track = buildTrack(CITY_01);
const conditions = conditionsFor('city_01', 'city_clear_night')!;
const env = { weather: 'clear' as const, wetness: 0 };

function pick<T>(rng: () => number, list: readonly T[]): T {
  return list[Math.floor(rng() * list.length)]!;
}

/** Independent re-derivation of the three hard limits for an accepted blueprint. */
function independentlyLegal(bp: VehicleBlueprint): string | null {
  const chassis = CATALOG.chassis[bp.chassisId]!;
  const engine = CATALOG.engines[bp.engineId]!;
  const tires = CATALOG.tires[bp.tireKitId]!;
  let cost =
    chassis.price + engine.price + Math.round((tires.price * chassis.wheelAnchors.length) / 4);
  let load = engine.massKg + (tires.massKg * chassis.wheelAnchors.length) / 4;
  const boxes: Array<[number, number, number, number]> = [];
  for (const instance of bp.parts) {
    const part = CATALOG.parts[instance.partId]!;
    const mount = chassis.mounts.find((m) => m.id === instance.mountId)!;
    cost += part.price;
    load += part.massKg;
    const sideways = instance.rotationQuarterTurns % 2 === 1;
    const w = sideways ? part.footprint.h : part.footprint.w;
    const h = sideways ? part.footprint.w : part.footprint.h;
    const x = mount.x + instance.offsetX;
    const y = mount.y + instance.offsetY;
    boxes.push([x - w / 2, y - h / 2, x + w / 2, y + h / 2]);
    if (w > mount.maxFootprint.w || h > mount.maxFootprint.h)
      return `${instance.instanceId} too large`;
    if (
      Math.abs(instance.offsetX) > mount.regionHalfW ||
      Math.abs(instance.offsetY) > mount.regionHalfH
    )
      return `${instance.instanceId} out of region`;
  }
  if (cost > 1000) return `cost ${cost}`;
  if (load > chassis.maxLoadKg) return `load ${load}`;
  const closer = (a: [number, number, number, number], b: [number, number, number, number]) =>
    Math.max(a[0] - b[2], b[0] - a[2]) < 2 && Math.max(a[1] - b[3], b[1] - a[3]) < 2;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++)
      if (closer(boxes[i]!, boxes[j]!)) return `parts ${i} and ${j} overlap`;
    for (const wheel of chassis.wheelAnchors)
      if (closer(boxes[i]!, [wheel.x - 4, wheel.y - 7, wheel.x + 4, wheel.y + 7]))
        return `part ${i} overlaps ${wheel.id}`;
  }
  if (new Set(bp.parts.map((p) => p.instanceId)).size !== bp.parts.length)
    return 'duplicate instance';
  if (bp.parts.filter((p) => CATALOG.parts[p.partId]!.category === 'weapon').length > 6)
    return 'seven weapons';
  if (bp.parts.filter((p) => p.assignedActionSlot !== undefined).length > 2)
    return 'three fire buttons';
  return null;
}

/** Twenty seconds on Neon Cut under random controls. Returns the first non-finite field. */
function drives(bp: VehicleBlueprint, rng: () => number): string | null {
  const check = validateBlueprint(bp, CATALOG);
  if (!check.ok) return 'not legal';
  const params = deriveVehicleParams(check.build, conditions);
  for (const [key, value] of Object.entries(params))
    if (typeof value === 'number' && !Number.isFinite(value)) return `params.${key}`;
  if (!(params.massKg > 0) || !(params.driveForce > 0)) return 'no mass or force';
  const session = createDriveSession(track, env, params);
  session.phase = 'RACING';
  session.countdownTicks = 0;
  let input = { steer: 0, brake: 0, coast: false };
  for (let i = 0; i < Math.round(20 / SIM_DT); i++) {
    if (i % 20 === 0)
      input = { steer: rng() * 2 - 1, brake: rng() < 0.2 ? rng() : 0, coast: rng() < 0.05 };
    stepDriveSession(session, input);
  }
  for (const [key, value] of Object.entries(session.motion))
    if (typeof value === 'number' && !Number.isFinite(value)) return `motion.${key}`;
  if (!(session.motion.batteryEnergy >= 0) || !(session.motion.coreHeat >= 0))
    return 'negative state';
  return null;
}

function randomEssentials(rng: () => number): VehicleBlueprint {
  return {
    formatVersion: 1,
    catalogVersion: CATALOG_VERSION,
    name: 'Fuzz',
    chassisId: pick(rng, CHASSIS_LIST).id,
    engineId: pick(rng, ENGINE_LIST).id,
    tireKitId: pick(rng, TIRE_LIST).id,
    paintId: 'paint_signal',
    parts: [],
    createdAt: '2026-10-10T00:00:00Z',
  };
}

describe('blueprint fuzz', () => {
  it('builds 1,500 random cars with the editing helpers: every accepted edit is legal and drives', () => {
    const rng = mulberry32(20261010);
    let withParts = 0;
    let refused = 0;
    const hashes = new Set<string>();
    for (let n = 0; n < 1500; n++) {
      let bp = randomEssentials(rng);
      const base = validateBlueprint(bp, CATALOG);
      const tries = 1 + Math.floor(rng() * 9);
      for (let i = 0; i < tries; i++) {
        const result = installPart(bp, CATALOG, pick(rng, PARTS).id);
        if (result.ok) bp = result.blueprint;
        else {
          refused++;
          expect(result.blueprint).toBe(bp);
        }
      }
      const verdict = validateBlueprint(bp, CATALOG);
      // Essentials alone can already be too dear or too heavy (a V12 on a Trike on tracks).
      // The helpers never make such a draft worse, and never break a legal one.
      if (base.ok) {
        expect(verdict.ok, JSON.stringify(bp)).toBe(true);
        expect(independentlyLegal(bp), JSON.stringify(bp)).toBeNull();
        expect(drives(bp, rng), JSON.stringify(bp)).toBeNull();
        expect(computeBuildStats(bp, CATALOG, conditions)!.legal).toBe(true);
        hashes.add(buildHash(bp));
        if (bp.parts.length > 0) withParts++;
      } else {
        expect(verdict.ok).toBe(false);
        expect(bp.parts.length === 0 || verdict.totalCost >= base.totalCost).toBe(true);
      }
    }
    expect(withParts).toBeGreaterThan(1000);
    expect(refused).toBeGreaterThan(1000);
    expect(hashes.size).toBeGreaterThan(1300);
  }, 120_000);

  it('validates 4,000 hostile and sloppy blueprints without ever throwing or accepting an illegal car', () => {
    const rng = mulberry32(8675309);
    const junkIds = [
      '',
      'nope',
      '__proto__',
      'constructor',
      'chassis_beetle',
      'engine_v8',
      'tires_slick',
      'x'.repeat(60),
    ];
    let accepted = 0;
    let rejected = 0;
    const codes = new Map<string, number>();
    for (let n = 0; n < 4000; n++) {
      const bp = randomEssentials(rng);
      const chassis = CATALOG.chassis[bp.chassisId]!;
      const wild = rng() < 0.45;
      const count = Math.floor(rng() * (wild ? 8 : 5));
      const parts: BlueprintPart[] = [];
      for (let i = 0; i < count; i++) {
        const mount = pick(rng, chassis.mounts);
        // Mostly a part this mount could take, so a fair share of cars come out legal.
        const fitting = PARTS.filter(
          (p) =>
            (mount.categories.includes('UNIVERSAL') ||
              p.compatibleMounts.some((c) => mount.categories.includes(c))) &&
            p.footprint.w <= mount.maxFootprint.w &&
            p.footprint.h <= mount.maxFootprint.h,
        );
        const part = !wild && fitting.length > 0 ? pick(rng, fitting) : pick(rng, PARTS);
        const instance: BlueprintPart = {
          instanceId: wild && rng() < 0.1 ? 'dup' : `f${i}`,
          partId: wild && rng() < 0.08 ? pick(rng, junkIds) : part.id,
          mountId:
            wild && rng() < 0.08 ? pick(rng, [...junkIds, 'engine_bay', 'roof_mid']) : mount.id,
          offsetX: wild ? Math.round((rng() - 0.5) * 16) + (rng() < 0.1 ? 0.37 : 0) : 0,
          offsetY: wild ? Math.round((rng() - 0.5) * 16) : 0,
          rotationQuarterTurns: (wild
            ? Math.floor(rng() * 4)
            : part.rotatable
              ? mount.allowedQuarterTurns[0]!
              : 0) as QuarterTurn,
        };
        if (part.category === 'weapon' && part.triggerMode !== 'automatic' && rng() < 0.7)
          instance.assignedActionSlot = rng() < 0.5 ? 0 : 1;
        if (wild && rng() < 0.1) instance.autoMode = true;
        if (wild && rng() < 0.05) instance.assignedActionSlot = 1;
        parts.push(instance);
      }
      bp.parts = parts;
      if (wild && rng() < 0.05) bp.catalogVersion = '0.2.0';
      if (wild && rng() < 0.05) bp.engineId = pick(rng, junkIds);
      if (wild && rng() < 0.05) bp.chassisId = pick(rng, junkIds);
      if (wild && rng() < 0.03) bp.name = '<img src=x onerror=alert(1)>';

      let verdict;
      expect(() => {
        verdict = validateBlueprint(bp, CATALOG);
      }, JSON.stringify(bp)).not.toThrow();
      const result = verdict as unknown as ReturnType<typeof validateBlueprint>;
      // Through the untrusted door the answer is the same or stricter, and also never throws.
      const untrusted = validateUntrustedBlueprint(JSON.parse(JSON.stringify(bp)), CATALOG);
      if (untrusted.ok) expect(result.ok).toBe(true);
      // Stats and repair cope with whatever this is.
      expect(() => computeBuildStats(bp, CATALOG, conditions)).not.toThrow();
      const repaired = repairBlueprint(bp, CATALOG);
      if (repaired.ok) expect(validateBlueprint(repaired.blueprint, CATALOG).ok).toBe(true);

      if (!result.ok) {
        rejected++;
        expect(result.issues.some((i) => i.severity === 'error')).toBe(true);
        for (const issue of result.issues) codes.set(issue.code, (codes.get(issue.code) ?? 0) + 1);
        continue;
      }
      accepted++;
      // What was accepted is canonical, within every limit by independent arithmetic, and drives.
      expect(result.blueprint).toEqual(canonicalizeBlueprint(bp));
      expect(independentlyLegal(result.blueprint), JSON.stringify(result.blueprint)).toBeNull();
      expect(result.totalCost).toBeLessThanOrEqual(1000);
      expect(drives(result.blueprint, rng), JSON.stringify(result.blueprint)).toBeNull();
    }
    // The fuzz exercised both verdicts and a wide spread of reasons.
    expect(accepted).toBeGreaterThan(600);
    expect(rejected).toBeGreaterThan(1500);
    for (const code of [
      'UNKNOWN_PART',
      'UNKNOWN_MOUNT',
      'NO_COMPATIBLE_MOUNT',
      'PART_TOO_LARGE',
      'BAD_ROTATION',
      'OUT_OF_REGION',
      'MOUNT_OCCUPIED',
      'PART_BLOCKS_ANOTHER',
      'OVERLAPS_WHEEL',
      'DUPLICATE_INSTANCE',
      'ONE_PER_CAR',
      'TOO_MANY_MANUAL_WEAPONS',
      'BAD_ACTION_SLOT',
      'BAD_AUTO_MODE',
      'NOT_ENOUGH_CREDITS',
      'TOO_HEAVY',
      'CATALOG_MISMATCH',
      'MISSING_ESSENTIAL',
      'BAD_NAME',
    ])
      expect(codes.get(code) ?? 0, code).toBeGreaterThan(0);
  }, 120_000);

  it('never throws on values that are not blueprints at all', () => {
    const rng = mulberry32(42);
    const atoms = [
      null,
      undefined,
      0,
      -1,
      1e308,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '',
      'x',
      true,
      false,
      [],
      {},
      [[]],
      { parts: {} },
      { __proto__: null },
    ];
    const keys = [
      'formatVersion',
      'catalogVersion',
      'name',
      'chassisId',
      'engineId',
      'tireKitId',
      'paintId',
      'parts',
      'createdAt',
      'instanceId',
      'partId',
      'mountId',
      'offsetX',
      'offsetY',
      'rotationQuarterTurns',
      'assignedActionSlot',
      'autoMode',
      '__proto__',
      'constructor',
    ];
    const random = (depth: number): unknown => {
      const roll = rng();
      if (depth > 3 || roll < 0.35) return pick(rng, atoms);
      if (roll < 0.55)
        return Array.from({ length: Math.floor(rng() * 4) }, () => random(depth + 1));
      const object: Record<string, unknown> = {};
      for (let i = 0; i < Math.floor(rng() * 8); i++) object[pick(rng, keys)] = random(depth + 1);
      return object;
    };
    for (let n = 0; n < 3000; n++) {
      const value = random(0);
      let result;
      expect(() => {
        result = validateUntrustedBlueprint(value, CATALOG);
      }).not.toThrow();
      expect((result as unknown as { ok: boolean }).ok).toBe(false);
    }
    expect(({} as Record<string, unknown>).parts).toBeUndefined();
  });
});
