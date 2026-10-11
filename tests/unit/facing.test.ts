import { CATALOG, CATALOG_VERSION, CHASSIS, CHASSIS_LIST, STRINGS, TEMPLATES } from '@bolt/content';
import type {
  AccessoryDefinition,
  ChassisDefinition,
  MountPoint,
  QuarterTurn,
  VehicleBlueprint,
} from '@bolt/shared';
import {
  accessoryMounts,
  allowedRotations,
  fitsMountBox,
  headingFrame,
  mountAccepts,
  occupiedFootprint,
  outwardTurn,
  partBase,
  partDirection,
  partHeadingRad,
  placePart,
  placementProblems,
  refaceBlueprint,
  repairBlueprint,
  rotatePart,
} from '@bolt/shared';
import { describe, expect, it } from 'vitest';
import { parseLibrary, repairSaved } from '../../apps/web/src/garage/blueprintLibrary.js';
import { facingBlocked } from '../../apps/web/src/garage/buildSession.js';
import { car, check, errorCodes } from '../helpers/blueprints.js';
import before from './fixtures/installable-0.4.0.json' with { type: 'json' };

/**
 * Facing is the player's choice, not a side effect of geometry (docs/DECISIONS.md, entry 99).
 * A part says how its direction is decided (`free`, `fixed` or `none`); a mount says which
 * ways a free part may point; and the room a free part takes is a square base, the same at
 * every quarter turn. Quarter turn 0 faces the front of the car, 1 right, 2 rear, 3 left.
 */

const TURNS: QuarterTurn[] = [0, 1, 2, 3];
const PARTS = Object.values(CATALOG.parts);
const FREE = PARTS.filter((p) => p.facing === 'free');
const FIXED = PARTS.filter((p) => p.facing === 'fixed');
const NONE = PARTS.filter((p) => p.facing === 'none');

/** Problems with one part alone on a mount, centred, at a quarter turn. */
function alone(
  chassis: ChassisDefinition,
  mount: MountPoint,
  part: AccessoryDefinition,
  turn: QuarterTurn,
): string[] {
  const placed = placePart(
    {
      instanceId: 'x',
      partId: part.id,
      mountId: mount.id,
      offsetX: 0,
      offsetY: 0,
      rotationQuarterTurns: turn,
    },
    part,
    mount,
  );
  return placementProblems(chassis, [], placed).map((p) => p.code);
}

/** Every chassis, mount and part that can be installed today, as `chassis|mount|part`. */
function installable(): Map<string, QuarterTurn[]> {
  const out = new Map<string, QuarterTurn[]>();
  for (const chassis of CHASSIS_LIST)
    for (const mount of accessoryMounts(chassis))
      for (const part of PARTS) {
        if (!mountAccepts(mount, part)) continue;
        const turns = TURNS.filter((turn) => alone(chassis, mount, part, turn).length === 0);
        if (turns.length > 0) out.set(`${chassis.id}|${mount.id}|${part.id}`, turns);
      }
  return out;
}

describe('part facing data', () => {
  it('names how every accessory faces, as data on the part', () => {
    expect(FREE.map((p) => p.id)).toEqual([
      'weapon_front_mg',
      'weapon_rear_mg',
      'weapon_shotgun',
      'weapon_railshot',
      'weapon_rocket',
      'weapon_homing',
      'weapon_foam',
      'weapon_flame',
      'weapon_frost',
      'weapon_hammer',
      'weapon_harpoon',
      'weapon_air',
      'weapon_boomerang',
      'defense_light_plate',
      'defense_heavy_plate',
    ]);
    expect(Object.fromEntries(FIXED.map((p) => [p.id, p.fixedTurn]))).toEqual({
      // The traps always drop behind the car.
      weapon_mine: 2,
      weapon_oil: 2,
      // The saw and the side shields work outward from whichever flank they are on.
      weapon_saw: 'outward',
      defense_side_panels: 'outward',
      defense_front_bumper: 0,
      defense_rear_bumper: 2,
      defense_minesweeper: 0,
    });
    // Everything else has no direction a player could choose: the weapons that find their
    // own target all round, and every box, tank, sensor and system.
    expect(NONE).toHaveLength(60 - 15 - 7);
    expect(NONE.filter((p) => p.category === 'weapon').map((p) => p.id)).toEqual([
      'weapon_turret',
      'weapon_emp',
      'weapon_tesla',
      'weapon_mortar',
    ]);
    for (const part of PARTS) {
      expect(['free', 'fixed', 'none'], part.id).toContain(part.facing);
      expect(part.fixedTurn !== undefined, part.id).toBe(part.facing === 'fixed');
    }
    // A weapon that fires along its own axis within a cone is always one the player aims or
    // one with a fixed direction, never one without a facing.
    for (const part of NONE.filter((p) => p.category === 'weapon'))
      expect(part.params.coneDegrees, part.id).toBe(360);
  });

  it('gives a free part a square base, the smaller side of its footprint, at every turn', () => {
    for (const part of FREE) {
      const side = Math.min(part.footprint.w, part.footprint.h);
      expect(partBase(part)).toBe(side);
      for (const turn of TURNS)
        expect(occupiedFootprint(part, turn), `${part.id} turn ${turn}`).toEqual({
          w: side,
          h: side,
        });
    }
    const shotgun = CATALOG.parts.weapon_shotgun!;
    expect(shotgun.footprint).toEqual({ w: 8, h: 12 });
    expect(occupiedFootprint(shotgun, 1)).toEqual({ w: 8, h: 8 });
    // Any other part takes its footprint as it lies on the car: turned with it when its
    // fixed turn is a quarter or three quarters, as written otherwise.
    const saw = CATALOG.parts.weapon_saw!;
    expect(saw.footprint).toEqual({ w: 14, h: 6 });
    expect(occupiedFootprint(saw, 1)).toEqual({ w: 6, h: 14 });
    expect(occupiedFootprint(saw, 3)).toEqual({ w: 6, h: 14 });
    expect(occupiedFootprint(CATALOG.parts.defense_rear_bumper!, 2)).toEqual({ w: 14, h: 5 });
    expect(occupiedFootprint(CATALOG.parts.utility_spoiler!, 0)).toEqual({ w: 16, h: 6 });
  });

  it('states for every mount which ways a free part may point, by where the mount is', () => {
    const table = Object.fromEntries(
      CHASSIS_LIST.map((chassis) => [
        chassis.id,
        Object.fromEntries(accessoryMounts(chassis).map((m) => [m.id, m.allowedQuarterTurns])),
      ]),
    );
    const all = [0, 1, 2, 3];
    expect(table).toEqual({
      chassis_beetle: {
        front_center: [0],
        roof_mid: all,
        left_utility: all,
        right_utility: all,
        rear_center: [2],
      },
      chassis_arrow: { front_center: [0], roof_mid: all, roof_rear: all, rear_center: [2] },
      chassis_pickup: {
        roof_cab: all,
        bed_front: all,
        // The bed rails are rear mounts on a side wall: back, or out over the wall.
        left_bed: [2, 3],
        right_bed: [2, 1],
        bed_rear: all,
        rear_center: [2],
      },
      chassis_spider: {
        front_utility: all,
        // Outward first, then along the flank. Never inward across the cabin.
        left_front: [3, 0, 2],
        right_front: [1, 0, 2],
        roof_front: all,
        roof_mid: all,
        left_rear: [3, 0, 2],
        right_rear: [1, 0, 2],
        rear_utility: all,
      },
      chassis_trike: { front_center: [0], roof_mid: all, left_rear: [2], right_rear: [2] },
    });
    for (const chassis of CHASSIS_LIST)
      for (const mount of accessoryMounts(chassis)) {
        const where = `${chassis.id} ${mount.id}`;
        const primary = mount.categories[0];
        if (primary === 'ROOF' || primary === 'UNIVERSAL')
          expect(mount.allowedQuarterTurns, where).toEqual(all);
        if (primary === 'FRONT') expect(mount.allowedQuarterTurns, where).toEqual([0]);
        if (primary === 'REAR') expect(mount.allowedQuarterTurns[0], where).toBe(2);
        if (primary === 'LEFT' || primary === 'RIGHT') {
          expect(mount.allowedQuarterTurns[0], where).toBe(outwardTurn(mount));
          expect(mount.allowedQuarterTurns, where).not.toContain((outwardTurn(mount) + 2) % 4);
        }
      }
  });
});

describe('the fit rule', () => {
  it('lets every free part that fits a roof mount take all four facings there', () => {
    let checked = 0;
    for (const chassis of CHASSIS_LIST)
      for (const mount of accessoryMounts(chassis).filter((m) => m.categories[0] === 'ROOF'))
        for (const part of FREE) {
          if (!mountAccepts(mount, part) || !fitsMountBox(mount, part)) continue;
          expect(allowedRotations(mount, part)).toEqual([0, 1, 2, 3]);
          for (const turn of TURNS) {
            const where = `${part.id} on ${chassis.id} ${mount.id} turn ${turn}`;
            expect(alone(chassis, mount, part, turn), where).toEqual([]);
            const fire = part.triggerMode === 'automatic' ? {} : { assignedActionSlot: 0 as const };
            const whole = check(
              car(chassis.id, [
                { partId: part.id, mountId: mount.id, rotationQuarterTurns: turn, ...fire },
              ]),
            );
            // Budget and weight are another matter: only placement is under test here.
            expect(
              errorCodes(whole).filter((c) => c !== 'NOT_ENOUGH_CREDITS' && c !== 'TOO_HEAVY'),
              where,
            ).toEqual([]);
            checked++;
          }
        }
    // Seven roof mounts across the five frames.
    expect(checked).toBeGreaterThan(7 * 4 * 8);
  });

  it('puts the Road Shotgun on the Trike roof facing any way, where it could only lie sideways', () => {
    const roof = CHASSIS.chassis_trike!.mounts.find((m) => m.id === 'roof_mid')!;
    expect(roof.maxFootprint).toEqual({ w: 14, h: 10 });
    for (const turn of TURNS)
      expect(
        check(
          car('chassis_trike', [
            {
              partId: 'weapon_shotgun',
              mountId: 'roof_mid',
              rotationQuarterTurns: turn,
              assignedActionSlot: 0,
            },
          ]),
        ).issues,
        `turn ${turn}`,
      ).toEqual([]);
    expect((before as Record<string, Record<string, string[]>>).chassis_trike!.roof_mid).toContain(
      'weapon_shotgun',
    );
  });

  it('lets a free part that fits any mount take every facing that mount allows', () => {
    for (const chassis of CHASSIS_LIST)
      for (const mount of accessoryMounts(chassis))
        for (const part of FREE) {
          if (!mountAccepts(mount, part) || !fitsMountBox(mount, part)) continue;
          for (const turn of TURNS) {
            const codes = alone(chassis, mount, part, turn);
            const where = `${part.id} on ${chassis.id} ${mount.id} turn ${turn}`;
            if (mount.allowedQuarterTurns.includes(turn)) expect(codes, where).toEqual([]);
            else expect(codes, where).toEqual(['BAD_ROTATION']);
          }
        }
  });

  it('never lets a fixed part be turned, on any mount it goes on', () => {
    let seen = 0;
    for (const chassis of CHASSIS_LIST)
      for (const mount of accessoryMounts(chassis))
        for (const part of FIXED) {
          if (!mountAccepts(mount, part) || !fitsMountBox(mount, part)) continue;
          const own = part.fixedTurn === 'outward' ? outwardTurn(mount) : part.fixedTurn!;
          expect(allowedRotations(mount, part)).toEqual([own]);
          for (const turn of TURNS) {
            const where = `${part.id} on ${chassis.id} ${mount.id} turn ${turn}`;
            const codes = alone(chassis, mount, part, turn);
            if (turn === own) expect(codes, where).toEqual([]);
            else expect(codes, where).toContain('BAD_ROTATION');
          }
          const blueprint = car(chassis.id, [
            { partId: part.id, mountId: mount.id, instanceId: 'fixed', rotationQuarterTurns: own },
          ]);
          const step = rotatePart(blueprint, CATALOG, 'fixed');
          expect(step.ok, `${part.id} steps`).toBe(false);
          for (const turn of TURNS.filter((t) => t !== own))
            expect(rotatePart(blueprint, CATALOG, 'fixed', turn).ok, `${part.id} to ${turn}`).toBe(
              false,
            );
          seen++;
        }
    expect(seen).toBeGreaterThan(20);
    // The same part on the two flanks of the Spider faces opposite ways, both outward.
    const spider = CHASSIS.chassis_spider!;
    const left = spider.mounts.find((m) => m.id === 'left_front')!;
    const right = spider.mounts.find((m) => m.id === 'right_front')!;
    expect(allowedRotations(left, CATALOG.parts.weapon_saw!)).toEqual([3]);
    expect(allowedRotations(right, CATALOG.parts.weapon_saw!)).toEqual([1]);
    expect(allowedRotations(left, CATALOG.parts.defense_side_panels!)).toEqual([3]);
    // A mine drops behind from a utility bay as well as from a tail mount.
    const sill = CHASSIS.chassis_beetle!.mounts.find((m) => m.id === 'left_utility')!;
    expect(allowedRotations(sill, CATALOG.parts.weapon_mine!)).toEqual([2]);
  });

  it('keeps a part without a facing at quarter turn 0', () => {
    for (const chassis of CHASSIS_LIST)
      for (const mount of accessoryMounts(chassis))
        for (const part of NONE) {
          if (!mountAccepts(mount, part) || !fitsMountBox(mount, part)) continue;
          expect(allowedRotations(mount, part)).toEqual([0]);
          for (const turn of [1, 2, 3] as QuarterTurn[])
            expect(alone(chassis, mount, part, turn), `${part.id} turn ${turn}`).toContain(
              'BAD_ROTATION',
            );
        }
  });

  it('leaves installable everything that was installable under catalog 0.4.0', () => {
    // The fixture was generated from the 0.4.0 rules before the change: every chassis, mount
    // and part for which some allowed turn placed the part, alone and centred, without a
    // problem. All 884 must still be installable.
    const now = installable();
    const was: string[] = [];
    for (const [chassisId, mounts] of Object.entries(
      before as Record<string, Record<string, string[]>>,
    ))
      for (const [mountId, parts] of Object.entries(mounts))
        for (const partId of parts) was.push(`${chassisId}|${mountId}|${partId}`);
    expect(was).toHaveLength(884);
    expect(was.filter((key) => !now.has(key))).toEqual([]);
    // What the square base newly lets in, pinned so a later change is a decision.
    const gained: Record<string, string[]> = {};
    for (const key of [...now.keys()].filter((k) => !was.includes(k))) {
      const [chassisId, mountId, partId] = key.split('|') as [string, string, string];
      (gained[partId] ??= []).push(`${chassisId.replace('chassis_', '')}.${mountId}`);
    }
    const tails = ['pickup.left_bed', 'pickup.right_bed', 'trike.left_rear', 'trike.right_rear'];
    expect(gained).toEqual({
      weapon_railshot: [
        'beetle.front_center',
        'beetle.roof_mid',
        'arrow.front_center',
        'arrow.roof_rear',
        'pickup.roof_cab',
        'spider.roof_front',
        'spider.roof_mid',
        'trike.front_center',
        'trike.roof_mid',
      ],
      weapon_rocket: ['arrow.roof_rear', ...tails],
      weapon_homing: ['arrow.roof_rear'],
      weapon_flame: tails,
      weapon_frost: ['arrow.roof_rear', ...tails],
      weapon_hammer: ['arrow.front_center'],
      weapon_saw: ['pickup.bed_front'],
      weapon_harpoon: ['arrow.roof_rear', ...tails],
      defense_side_panels: ['pickup.bed_front'],
    });
  });
});

describe('firing direction', () => {
  it('is the car heading plus a quarter turn per step, clockwise from up', () => {
    // A car pointing up the screen: front is up, right is right, rear is down, left is left.
    const round = (v: { x: number; y: number }) => ({
      x: Math.round(v.x * 1e9) / 1e9 + 0,
      y: Math.round(v.y * 1e9) / 1e9 + 0,
    });
    expect(round(partDirection(0, 0))).toEqual({ x: 0, y: -1 });
    expect(round(partDirection(0, 1))).toEqual({ x: 1, y: 0 });
    expect(round(partDirection(0, 2))).toEqual({ x: 0, y: 1 });
    expect(round(partDirection(0, 3))).toEqual({ x: -1, y: 0 });
    // A car heading right (a quarter turn clockwise): its left is up the screen.
    expect(round(partDirection(Math.PI / 2, 0))).toEqual({ x: 1, y: 0 });
    expect(round(partDirection(Math.PI / 2, 3))).toEqual({ x: 0, y: -1 });
    expect(partHeadingRad(0, 0)).toBe(0);
    expect(partHeadingRad(0, 1)).toBeCloseTo(Math.PI / 2, 12);
    expect(partHeadingRad(0, 3)).toBeCloseTo(-Math.PI / 2, 12);
    // Wrapped to (-PI, PI], like every heading in the simulation.
    expect(partHeadingRad(Math.PI * 0.75, 2)).toBeCloseTo(-Math.PI * 0.25, 12);
    for (let i = 0; i < 64; i++) {
      const heading = (i / 64) * Math.PI * 2 - Math.PI;
      for (const turn of TURNS) {
        const rad = partHeadingRad(heading, turn);
        expect(rad).toBeGreaterThan(-Math.PI - 1e-12);
        expect(rad).toBeLessThanOrEqual(Math.PI);
        const dir = partDirection(heading, turn);
        expect(dir.x).toBeCloseTo(Math.sin(rad), 9);
        expect(dir.y).toBeCloseTo(-Math.cos(rad), 9);
        expect(Math.hypot(dir.x, dir.y)).toBeCloseTo(1, 12);
        // The compositor draws the part with the sprite frame of that same heading.
        expect(headingFrame(rad)).toBe(headingFrame(heading + (turn * Math.PI) / 2));
      }
    }
  });
});

describe('templates and saved cars', () => {
  it('ships every template legal, with each fixed part at its own turn', () => {
    for (const template of TEMPLATES) {
      const result = check(template.blueprint);
      expect(errorCodes(result), template.id).toEqual([]);
      expect(template.blueprint.catalogVersion).toBe(CATALOG_VERSION);
      expect(refaceBlueprint(template.blueprint, CATALOG), template.id).toBe(template.blueprint);
    }
    const turnOf = (templateId: string, partId: string) =>
      TEMPLATES.find((t) => t.id === templateId)!.blueprint.parts.find((p) => p.partId === partId)!
        .rotationQuarterTurns;
    expect(turnOf('starter_packhorse', 'defense_rear_bumper')).toBe(2);
    expect(turnOf('example_iron_mule', 'weapon_oil')).toBe(2);
    expect(turnOf('example_back_alley_trap', 'weapon_mine')).toBe(2);
  });

  /** Two cars saved under catalog 0.4.0, where a turn was also how a part was made to fit. */
  const oldTrike: VehicleBlueprint = {
    ...car(
      'chassis_trike',
      [
        // Sideways on the roof, because 8 x 12 only fitted a 14 x 10 box that way.
        {
          partId: 'weapon_shotgun',
          mountId: 'roof_mid',
          instanceId: 'shotgun',
          rotationQuarterTurns: 1,
          assignedActionSlot: 0,
        },
        // Sideways on the nose, because 12 x 4 only fitted a 10 x 14 box that way.
        {
          partId: 'defense_light_plate',
          mountId: 'front_center',
          instanceId: 'plate',
          rotationQuarterTurns: 3,
        },
      ],
      { engineId: 'engine_mini_electric' },
    ),
    catalogVersion: '0.4.0',
  };
  const oldPickup: VehicleBlueprint = {
    ...car('chassis_pickup', [
      // Parts that could not rotate were all kept at turn 0, whichever way they worked.
      { partId: 'weapon_mine', mountId: 'bed_front', instanceId: 'mine', assignedActionSlot: 1 },
      { partId: 'defense_rear_bumper', mountId: 'rear_center', instanceId: 'guard' },
      // The turret could be turned, and was; it tracks all round and now has no facing.
      {
        partId: 'weapon_turret',
        mountId: 'bed_rear',
        instanceId: 'turret',
        rotationQuarterTurns: 2,
        assignedActionSlot: 0,
      },
      {
        partId: 'weapon_rear_mg',
        mountId: 'left_bed',
        instanceId: 'sentry',
        rotationQuarterTurns: 2,
      },
    ]),
    catalogVersion: '0.4.0',
  };
  const turns = (bp: VehicleBlueprint) =>
    Object.fromEntries(bp.parts.map((p) => [p.instanceId, p.rotationQuarterTurns]));

  it('migrates a car from catalog 0.4.0 by turning parts, never by removing them', () => {
    for (const old of [oldTrike, oldPickup])
      expect(errorCodes(check(old))).toEqual(
        expect.arrayContaining(['CATALOG_MISMATCH', 'BAD_ROTATION']),
      );
    expect(turns(refaceBlueprint(oldTrike, CATALOG))).toEqual({
      // Still allowed on a roof, so the player's choice stands.
      shotgun: 1,
      // A nose mount faces forward.
      plate: 0,
    });
    const refaced = refaceBlueprint(oldPickup, CATALOG);
    expect(turns(refaced)).toEqual({
      // A mine drops behind and a rear guard faces back, wherever they are mounted.
      mine: 2,
      guard: 2,
      turret: 0,
      // Already facing back on a rail that faces back or out.
      sentry: 2,
    });
    expect(oldPickup.parts.map((p) => p.rotationQuarterTurns)).toEqual([0, 0, 2, 2]);
    // Refacing alone changes nothing else, the catalog stamp included.
    expect(refaced.catalogVersion).toBe('0.4.0');
    expect(refaced.parts.map(({ rotationQuarterTurns: _turn, ...rest }) => rest)).toEqual(
      oldPickup.parts.map(({ rotationQuarterTurns: _turn, ...rest }) => rest),
    );
    // The explicit repair does both and keeps every part and both fire buttons.
    for (const old of [oldTrike, oldPickup]) {
      const repaired = repairBlueprint(old, CATALOG);
      expect(repaired.removed).toEqual([]);
      expect(repaired.ok).toBe(true);
      if (!repaired.ok) continue;
      expect(repaired.spend).toMatchObject({ newSpend: 0, refund: 0 });
      expect(repaired.blueprint.catalogVersion).toBe(CATALOG_VERSION);
      expect(repaired.blueprint.parts).toHaveLength(old.parts.length);
      expect(check(repaired.blueprint).issues.filter((i) => i.severity === 'error')).toEqual([]);
      for (const part of old.parts)
        expect(
          repaired.blueprint.parts.find((p) => p.instanceId === part.instanceId)!
            .assignedActionSlot,
        ).toBe(part.assignedActionSlot);
    }
    expect(turns(repairBlueprint(oldPickup, CATALOG).blueprint)).toEqual({
      mine: 2,
      guard: 2,
      turret: 0,
      sentry: 2,
    });
  });

  it('keeps such a car in My Blueprints, flagged, and repairs it there with nothing lost', () => {
    const stored = JSON.stringify({
      version: 1,
      items: [
        { id: 'b1', blueprint: oldTrike, savedAt: '2026-10-11T08:00:00.000Z' },
        { id: 'b2', blueprint: oldPickup, savedAt: '2026-10-11T08:00:00.000Z' },
      ],
    });
    let entries = parseLibrary(stored, CATALOG);
    expect(entries).toHaveLength(2);
    for (const id of ['b1', 'b2']) {
      const was = entries.find((e) => e.id === id)!;
      expect(was.legal).toBe(false);
      const repair = repairSaved(entries, id, CATALOG);
      expect(repair.ok).toBe(true);
      if (!repair.ok) return;
      expect(repair.removed).toEqual([]);
      expect(repair.rebuiltOn).toBeNull();
      expect(repair.entry.legal).toBe(true);
      expect(repair.entry.blueprint.parts).toHaveLength(was.blueprint.parts.length);
      expect(repair.entry.totalCost).toBe(was.totalCost);
      entries = repair.entries;
    }
  });

  it('leaves a blueprint that is already well faced untouched, and unknown parts alone', () => {
    const fine = car('chassis_beetle', [
      { partId: 'weapon_front_mg', mountId: 'roof_mid', rotationQuarterTurns: 3 },
      { partId: 'weapon_no_such_part', mountId: 'front_center', rotationQuarterTurns: 3 },
      { partId: 'utility_fan', mountId: 'no_such_mount', rotationQuarterTurns: 2 },
    ]);
    expect(refaceBlueprint(fine, CATALOG)).toBe(fine);
    const retired = { ...fine, chassisId: 'chassis_turtle' };
    expect(refaceBlueprint(retired, CATALOG)).toBe(retired);
  });
});

describe('the direction picker', () => {
  const placed = (chassisId: string, partId: string, mountId: string, turn: QuarterTurn = 0) => {
    const chassis = CHASSIS[chassisId]!;
    const mount = chassis.mounts.find((m) => m.id === mountId)!;
    return placePart(
      {
        instanceId: 'x',
        partId,
        mountId,
        offsetX: 0,
        offsetY: 0,
        rotationQuarterTurns: turn,
      },
      CATALOG.parts[partId]!,
      mount,
    );
  };

  it('says in approved copy why a direction is not offered', () => {
    const g = STRINGS.garage;
    const roof = placed('chassis_trike', 'weapon_shotgun', 'roof_mid');
    for (const turn of TURNS) expect(facingBlocked(roof, turn)).toBeNull();
    const nose = placed('chassis_beetle', 'weapon_front_mg', 'front_center');
    expect(facingBlocked(nose, 0)).toBeNull();
    for (const turn of [1, 2, 3] as QuarterTurn[])
      expect(facingBlocked(nose, turn)).toBe('This mount only faces forward.');
    const tail = placed('chassis_beetle', 'weapon_rear_mg', 'rear_center', 2);
    expect(facingBlocked(tail, 0)).toBe('This mount only faces back.');
    const flank = placed('chassis_spider', 'weapon_front_mg', 'left_front', 3);
    expect(facingBlocked(flank, 1)).toBe("This mount can't face right.");
    expect(facingBlocked(flank, 0)).toBeNull();
    const rail = placed('chassis_pickup', 'weapon_front_mg', 'right_bed', 2);
    expect(facingBlocked(rail, 1)).toBeNull();
    expect(facingBlocked(rail, 0)).toBe("This mount can't face forward.");
    // Parts that do not offer the choice at all.
    expect(facingBlocked(placed('chassis_beetle', 'weapon_mine', 'rear_center', 2), 0)).toBe(
      'This part always faces back.',
    );
    expect(facingBlocked(placed('chassis_beetle', 'utility_radar', 'roof_mid'), 1)).toBe(
      g.facingNone,
    );
    for (const text of [
      ...Object.values(g.facingOnly),
      ...Object.values(g.facingBlocked),
      ...Object.values(g.facingFixed),
      g.facingNone,
    ]) {
      expect(text).toMatch(/^This (mount|part) .+\.$/);
      expect(text).not.toMatch(/--|—/);
    }
  });
});
