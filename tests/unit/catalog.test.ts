import {
  ACCESSORIES,
  CATALOG,
  CATALOG_VERSION,
  CHASSIS,
  CHASSIS_LIST,
  DEFENSE_LIST,
  ENGINES,
  ENGINE_LIST,
  PAINTS,
  PART_CATEGORIES,
  STRINGS,
  TEMPLATES,
  TIRES,
  TIRE_LIST,
  UTILITY_LIST,
  WEAPON_LIST,
  allParts,
  getPart,
  partCard,
  partsByCategory,
} from '@bolt/content';
import type { AnyPartDefinition, MountCategory } from '@bolt/shared';
import {
  BLUEPRINT_ISSUE_COPY,
  OVERWEIGHT_HINT,
  PART_CLEARANCE_PX,
  STATS_WARNING_COPY,
  TURRET_BLOCKED_COPY,
  accessoryMounts,
  aggregateModifiers,
  fitsMountBox,
  emptyTotals,
  applyModifier,
  engineMount,
  mountAccepts,
  rectAround,
  rectsConflict,
  validateBlueprint,
  wheelKitMass,
  wheelKitPrice,
  wheelRect,
} from '@bolt/shared';
import { describe, expect, it } from 'vitest';

/**
 * Catalog integrity. The expected values below are transcribed by hand as an independent
 * list: nothing here is derived from the data under test. Engines, wheel kits, weapons,
 * defenses and utilities are the rows of Sections 11.3 to 11.7 of docs/MASTER_SPEC.md. The
 * chassis rows are the five frames of the product-owner decision of October 11, 2026
 * (docs/DECISIONS.md, entry 87) with the values recorded in docs/BALANCE_CHANGELOG.md 0.4.0.
 */

function allNumbers(value: unknown, out: number[] = []): number[] {
  if (typeof value === 'number') out.push(value);
  else if (value && typeof value === 'object')
    for (const v of Object.values(value)) allNumbers(v, out);
  return out;
}

function rows(table: string): string[][] {
  return table
    .trim()
    .split('\n')
    .map((line) => line.split('|').map((cell) => cell.trim()));
}

// The five chassis, in garage order: id | display name | cost | mass kg
const SPEC_CHASSIS = rows(`
chassis_beetle | Beetle | 150 | 250
chassis_arrow | Arrow | 180 | 230
chassis_pickup | Pickup | 185 | 390
chassis_spider | Spider | 235 | 420
chassis_trike | Trike | 120 | 145
`);

// family | wheels | bias letters | mounts | recommended | max | handling
const SPEC_LAYOUT = rows(`
Beetle | 4 | F B T U | 5 | 460 | 730 | Balanced and forgiving
Arrow | 4 | F B T | 4 | 360 | 600 | Lowest drag, fastest
Pickup | 4 | T X X B B | 6 | 780 | 1200 | Heavy hauler
Spider | 6 | L R T U | 8 | 700 | 1050 | Very stable, slow to turn
Trike | 3 | F B T | 4 | 280 | 460 | Quick but easy to tip
`);

const LETTER: Record<string, MountCategory> = {
  F: 'FRONT',
  B: 'REAR',
  L: 'LEFT',
  R: 'RIGHT',
  T: 'ROOF',
  U: 'UTILITY',
  X: 'UNIVERSAL',
};

// Section 11.3: id | display name | cost | mass | force index | heat/s
const SPEC_ENGINES = rows(`
engine_mini_electric | Mini Electric | 75 | 45 | 62 | 4
engine_four_cylinder | Four-Cylinder | 140 | 95 | 100 | 8
engine_v6 | V6 | 175 | 120 | 128 | 11
engine_v8 | V8 | 220 | 155 | 158 | 15
engine_v12 | V12 | 290 | 180 | 183 | 19
engine_small_turbo | Small Turbo | 145 | 88 | 118 | 14
engine_twin_turbo | Twin Turbo | 255 | 148 | 168 | 21
engine_supercharger | Supercharger | 225 | 155 | 157 | 17
engine_diesel | Torque Diesel | 175 | 175 | 142 | 11
engine_electric_sport | Sport Electric | 225 | 112 | 152 | 13
engine_electric_eco | Eco Electric | 115 | 85 | 91 | 5
engine_hybrid | Hybrid | 195 | 138 | 129 | 9
engine_rotary | Rotary | 165 | 73 | 122 | 17
engine_turbine | Turbine | 250 | 135 | 146 | 19
engine_rocket | Rocket Engine | 280 | 130 | 192 | 26
engine_twin | Twin Drive | 270 | 190 | 166 | 20
engine_spring | Spring Drive | 130 | 85 | 110 | 7
engine_offroad | Trail Engine | 175 | 125 | 123 | 10
engine_resilient | Ironheart | 185 | 155 | 110 | 9
engine_experimental | Wildcard Motor | 235 | 98 | 162 | 23
`);
/** Electrical draw named in the Character column. */
const SPEC_ENGINE_DRAW: Record<string, number> = {
  engine_mini_electric: 5,
  engine_electric_sport: 14,
  engine_electric_eco: 6,
};

// Section 11.4: id | display name | cost per four | mass per four | grip
const SPEC_TIRES = rows(`
tires_slick | Slicks | 110 | 48 | 1.22
tires_street | Street Tires | 80 | 48 | 1.00
tires_rain | Rain Runners | 110 | 54 | 0.96
tires_sand | Sand Paddles | 125 | 75 | 0.86
tires_mud | Mud Claws | 120 | 76 | 0.86
tires_snow | Snow Treads | 110 | 59 | 0.92
tires_ice | Ice Spikes | 125 | 63 | 0.87
tires_soft | Soft Compound | 115 | 50 | 1.15
tires_hard | Hard Compound | 90 | 55 | 0.94
tires_drift | Drift Rings | 100 | 52 | 0.92
tires_armored | Armored Tires | 150 | 102 | 0.90
tires_solid | Solid Core | 140 | 88 | 0.88
tires_balloon | Balloon Tires | 105 | 72 | 0.85
tires_monster | Monster Wheels | 145 | 120 | 0.91
tires_micro | Micro Wheels | 65 | 32 | 1.03
tires_halftrack | Half Tracks | 155 | 150 | 0.83
tires_track | Full Tracks | 190 | 210 | 0.78
tires_magnetic | Magnetic Rollers | 165 | 108 | 0.91
tires_adaptive | Adaptive Tires | 190 | 95 | 1.02
tires_blades | Razor Wheels | 145 | 85 | 0.93
`);

// Section 11.5: id | display name | cost | mass | mode | cooldown
const SPEC_WEAPONS = rows(`
weapon_front_mg | Front Machine Gun | 70 | 26 | M | 1.4
weapon_rear_mg | Rear Sentry | 85 | 33 | A | 3.2
weapon_turret | Swivel Turret | 130 | 68 | H | 3.0
weapon_shotgun | Road Shotgun | 90 | 40 | M | 4.0
weapon_railshot | Needle Railgun | 165 | 78 | H | 7.0
weapon_rocket | Straight Rocket | 100 | 55 | M | 5.0
weapon_homing | Seeker Missile | 170 | 66 | H | 9.0
weapon_mine | Road Mine | 65 | 30 | M | 6.5
weapon_oil | Oil Slick | 60 | 31 | M | 7.0
weapon_foam | Sticky Foam | 80 | 45 | M | 7.5
weapon_emp | EMP Pulse | 145 | 75 | M | 13.0
weapon_tesla | Tesla Arc | 100 | 46 | A | 6.0
weapon_flame | Flame Spitter | 115 | 58 | M | 5.0
weapon_frost | Frost Cannon | 110 | 55 | M | 6.0
weapon_hammer | Crash Hammer | 105 | 90 | M | 5.0
weapon_saw | Side Saw | 90 | 60 | A | 3.0
weapon_harpoon | Grapple Harpoon | 130 | 66 | M | 8.0
weapon_air | Air Cannon | 85 | 46 | M | 6.0
weapon_boomerang | Steel Boomerang | 110 | 51 | M | 7.0
weapon_mortar | Arc Mortar | 175 | 98 | H | 11.0
`);

// Section 11.6: id | display name | cost | mass
const SPEC_DEFENSES = rows(`
defense_light_plate | Light Plates | 45 | 45
defense_heavy_plate | Heavy Plating | 110 | 145
defense_front_bumper | Crash Bumper | 65 | 90
defense_rear_bumper | Rear Guard | 55 | 75
defense_side_panels | Side Shields | 70 | 95
defense_wheel_cage | Wheel Cage | 90 | 83
defense_engine_case | Engine Shell | 95 | 88
defense_ceramic | Ceramic Panels | 85 | 65
defense_breakaway | Breakaway Armor | 70 | 61
defense_composite | Composite Shell | 130 | 115
defense_energy_shield | Energy Shield | 145 | 68
defense_faraday | Faraday Cage | 95 | 73
defense_heatguard | Heat Guard | 65 | 54
defense_antimissile | Missile Interceptor | 160 | 82
defense_minesweeper | Mine Sweeper | 105 | 91
defense_fireproof | Fireproof Lining | 75 | 64
defense_oilproof | Grip Coating | 65 | 48
defense_damper | Shock Dampers | 90 | 92
defense_steer_assist | Steering Stabilizer | 80 | 49
defense_reactive | Reactive Foam | 115 | 79
`);

// Section 11.7: id | display name | cost | mass | trigger
const SPEC_UTILITIES = rows(`
utility_spare | Spare Wheel | 40 | 37 | manual
utility_repair | Repair Kit | 65 | 28 | manual
utility_fan | Cooling Fan | 55 | 35 | passive
utility_radiator | Racing Radiator | 90 | 79 | passive
utility_battery | Extra Battery | 65 | 48 | passive
utility_generator | Auxiliary Generator | 80 | 82 | passive
utility_capacitor | Burst Capacitor | 80 | 45 | automatic
utility_nitro | Nitro Tank | 90 | 55 | manual
utility_overdrive | Emergency Booster | 115 | 73 | manual
utility_traction | Traction Computer | 95 | 36 | passive
utility_gyro | Gyro Stabilizer | 80 | 57 | passive
utility_radar | Radar | 45 | 28 | passive
utility_minesensor | Mine Detector | 55 | 27 | automatic
utility_decoy | Decoy Drone | 85 | 44 | manual
utility_jump | Jump Pad | 120 | 100 | manual
utility_winch | Recovery Winch | 55 | 54 | manual
utility_ballast | Sliding Ballast | 95 | 90 | automatic
utility_spoiler | Active Wing | 100 | 68 | automatic
utility_targeting | Turret Computer | 75 | 30 | passive
utility_solar | Solar Panel | 65 | 45 | passive
`);

const MODE = { M: 'manual', A: 'automatic', H: 'hybrid' } as const;

function expectRows(list: AnyPartDefinition[], spec: string[][]): void {
  expect(list.map((p) => p.id)).toEqual(spec.map((r) => r[0]));
  for (const [id, name, cost, mass] of spec) {
    const part = getPart(id!)!;
    expect(part, id).toBeDefined();
    expect(part.displayName, id).toBe(name);
    expect(part.price, `${id} price`).toBe(Number(cost));
    expect(part.massKg, `${id} mass`).toBe(Number(mass));
  }
}

describe('catalog: 105 parts, five chassis and the exact seed values of Sections 11.3 to 11.7', () => {
  it('has exactly five chassis and twenty parts in each other category, with unique ids', () => {
    expect(PART_CATEGORIES).toHaveLength(6);
    for (const category of PART_CATEGORIES) {
      const list = partsByCategory(category);
      expect(list, category).toHaveLength(category === 'chassis' ? 5 : 20);
      for (const part of list) expect(part.category).toBe(category);
    }
    const ids = allParts().map((p) => p.id);
    expect(ids).toHaveLength(105);
    expect(new Set(ids).size).toBe(105);
    expect(Object.keys(CATALOG.chassis)).toEqual([
      'chassis_beetle',
      'chassis_arrow',
      'chassis_pickup',
      'chassis_spider',
      'chassis_trike',
    ]);
    expect(CHASSIS_LIST.map((c) => c.id)).toEqual(Object.keys(CATALOG.chassis));
    expect(Object.keys(CATALOG.engines)).toHaveLength(20);
    expect(Object.keys(CATALOG.tires)).toHaveLength(20);
    expect(Object.keys(CATALOG.parts)).toHaveLength(60);
    expect(CATALOG.version).toBe(CATALOG_VERSION);
    expect(CATALOG_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(Object.keys(PAINTS).length).toBeGreaterThanOrEqual(4);
  });

  it('matches every row of the five-chassis table', () => {
    expect(CHASSIS_LIST).toHaveLength(SPEC_CHASSIS.length);
    expectRows(CHASSIS_LIST, SPEC_CHASSIS);
  });
  it('matches every engine row of Section 11.3', () => {
    expectRows(ENGINE_LIST, SPEC_ENGINES);
    for (const [id, , , , force, heat] of SPEC_ENGINES) {
      const engine = ENGINES[id!]!;
      expect(engine.forceIndex, `${id} force`).toBe(Number(force));
      expect(engine.heatPerSecond, `${id} heat`).toBe(Number(heat));
      expect(engine.powerDraw, `${id} draw`).toBe(SPEC_ENGINE_DRAW[id!] ?? 0);
      expect(engine.compatibleMounts).toEqual(['ENGINE']);
    }
  });
  it('matches every wheel kit row of Section 11.4', () => {
    expectRows(TIRE_LIST, SPEC_TIRES);
    for (const [id, , , , grip] of SPEC_TIRES)
      expect(TIRES[id!]!.grip, `${id} grip`).toBe(Number(grip));
    expect(TIRES.tires_magnetic!.powerDraw).toBe(5);
    expect(TIRES.tires_adaptive!.powerDraw).toBe(6);
  });
  it('matches every weapon row of Section 11.5', () => {
    expectRows(WEAPON_LIST, SPEC_WEAPONS);
    for (const [id, , , , mode, cooldown] of SPEC_WEAPONS) {
      const weapon = ACCESSORIES[id!]!;
      expect(weapon.triggerMode, `${id} mode`).toBe(MODE[mode as keyof typeof MODE]);
      expect(weapon.params.cooldownSeconds, `${id} cooldown`).toBe(Number(cooldown));
      // Section 8.4: a 1.2 second floor on active fire commands.
      expect(Number(cooldown)).toBeGreaterThanOrEqual(1.2);
    }
  });
  it('matches every defense row of Section 11.6', () => expectRows(DEFENSE_LIST, SPEC_DEFENSES));
  it('matches every utility row of Section 11.7', () => {
    expectRows(UTILITY_LIST, SPEC_UTILITIES);
    for (const [id, , , , trigger] of SPEC_UTILITIES)
      expect(ACCESSORIES[id!]!.triggerMode, `${id} trigger`).toBe(trigger);
  });

  it('gives every part the fields a part card and the rules need', () => {
    for (const part of allParts()) {
      const where = part.id;
      expect(part.id, where).toMatch(/^[a-z0-9_]+$/);
      expect(part.spriteKey, where).toBe(part.id);
      expect(part.soundKey.length, where).toBeGreaterThan(0);
      expect(part.description.length, where).toBeGreaterThan(10);
      expect(part.drawback.length, where).toBeGreaterThan(10);
      expect(part.description, where).not.toBe(part.drawback);
      expect(Number.isInteger(part.price) && part.price > 0, where).toBe(true);
      expect(part.massKg, where).toBeGreaterThan(0);
      expect(part.footprint.w, where).toBeGreaterThan(0);
      expect(part.footprint.h, where).toBeGreaterThan(0);
      expect(Number.isInteger(part.footprint.w) && Number.isInteger(part.footprint.h), where).toBe(
        true,
      );
      if (part.category !== 'chassis') {
        expect(part.compatibleMounts.length, where).toBeGreaterThan(0);
        expect(part.params, where).toBeDefined();
        expect(part.triggerMode, where).toBeDefined();
      }
      for (const [key, value] of Object.entries(part.params ?? {})) {
        expect(['number', 'string', 'boolean'], `${where}.${key}`).toContain(typeof value);
        if (typeof value === 'number') expect(Number.isFinite(value), `${where}.${key}`).toBe(true);
      }
      for (const action of part.actions ?? [])
        for (const [key, value] of Object.entries(action))
          if (typeof value === 'number')
            expect(Number.isFinite(value), `${where} ${action.type}.${key}`).toBe(true);
      if (part.maxPerCar !== undefined) expect(part.maxPerCar, where).toBeGreaterThanOrEqual(1);
      // Every modifier folds into finite totals.
      const totals = emptyTotals();
      for (const mod of part.modifiers) applyModifier(totals, mod, { sourceId: part.id });
      expect(allNumbers(totals).every(Number.isFinite), where).toBe(true);
      // The AddMass primitive carries exactly the listed mass.
      expect(totals.massKg, `${where} AddMass`).toBeCloseTo(part.massKg, 9);
      const card = partCard(part);
      expect(card.price).toBe(part.price);
      expect(card.benefit).toBe(part.description);
      expect(card.downside).toBe(part.drawback);
      expect(Number.isFinite(card.powerPerSecond) && Number.isFinite(card.heatPerSecond)).toBe(
        true,
      );
    }
  });

  it('sizes weapons 8 to 24 pixels and gives every accessory a behavior and a place', () => {
    for (const part of Object.values(ACCESSORIES)) {
      expect(part.behaviorId.length, part.id).toBeGreaterThan(0);
      expect(['full', 'shared'], part.id).toContain(part.hardpointUse);
      expect([0, 1, 2], part.id).toContain(part.heightLevel);
      if (part.category === 'weapon') {
        // Section 12.4: weapons range 8 to 24 logical pixels in body footprint.
        expect(Math.max(part.footprint.w, part.footprint.h), part.id).toBeGreaterThanOrEqual(8);
        expect(Math.max(part.footprint.w, part.footprint.h), part.id).toBeLessThanOrEqual(24);
        expect(
          part.actions?.some((a) => a.type === 'StartCooldown'),
          part.id,
        ).toBe(true);
      }
      // Every accessory has a home on at least one of the five frames.
      const homes = CHASSIS_LIST.filter((chassis) =>
        accessoryMounts(chassis).some(
          (mount) => mountAccepts(mount, part) && fitsMountBox(mount, part),
        ),
      );
      expect(
        homes.length,
        `${part.id} fits on ${homes.map((c) => c.displayName).join(', ')}`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it('never resolves inherited property names as parts', () => {
    for (const bad of [
      '__proto__',
      'constructor',
      'toString',
      'hasOwnProperty',
      '',
      'chassis_nope',
    ])
      expect(getPart(bad), bad).toBeUndefined();
  });
});

describe('chassis layouts (Section 6.3 and the five-chassis decision)', () => {
  it.each(SPEC_LAYOUT)(
    '%s: %s wheels, bias %s, %s mounts, load %s / %s kg',
    (family, wheels, bias, count, recommended, max, handling) => {
      const chassis = CHASSIS_LIST.find((c) => c.displayName === family)!;
      expect(chassis, family).toBeDefined();
      expect(chassis.wheelCount).toBe(Number(wheels));
      expect(chassis.wheelAnchors).toHaveLength(Number(wheels));
      expect(new Set(chassis.wheelAnchors.map((w) => w.id)).size).toBe(Number(wheels));
      expect(chassis.recommendedLoadKg).toBe(Number(recommended));
      expect(chassis.maxLoadKg).toBe(Number(max));
      expect(chassis.handling).toBe(handling);

      // The accessory count excludes the engine and wheel mounts.
      const mounts = accessoryMounts(chassis);
      expect(mounts).toHaveLength(Number(count));
      expect(engineMount(chassis)).toBeDefined();
      expect(chassis.mounts).toHaveLength(Number(count) + 1);
      expect(new Set(chassis.mounts.map((m) => m.id)).size).toBe(chassis.mounts.length);
      for (const mount of chassis.mounts) expect(mount.id).toMatch(/^[a-z]+(_[a-z]+)*$/);

      // The bias letters name every primary category present, each at least as many times as
      // it is listed, and nothing else.
      const primary = mounts.map((m) => m.categories[0]!);
      const wanted = bias!.split(' ').map((letter) => LETTER[letter]!);
      expect(new Set(primary)).toEqual(new Set(wanted));
      for (const category of new Set(wanted)) {
        const listed = wanted.filter((c) => c === category).length;
        const present = primary.filter((c) => c === category).length;
        expect(present, `${family} ${category}`).toBeGreaterThanOrEqual(listed);
      }
    },
  );

  it.each(CHASSIS_LIST)(
    '$displayName keeps every mount clear of the wheels and of other mounts',
    (chassis) => {
      const mounts = accessoryMounts(chassis);
      for (const mount of mounts) {
        const box = rectAround(mount.x, mount.y, mount.maxFootprint.w, mount.maxFootprint.h);
        for (const wheel of chassis.wheelAnchors)
          expect(
            rectsConflict(box, wheelRect(wheel), PART_CLEARANCE_PX),
            `${mount.id} against ${wheel.id}`,
          ).toBe(false);
        for (const other of mounts) {
          if (other === mount) continue;
          const otherBox = rectAround(other.x, other.y, other.maxFootprint.w, other.maxFootprint.h);
          expect(
            rectsConflict(box, otherBox, PART_CLEARANCE_PX),
            `${mount.id} against ${other.id}`,
          ).toBe(false);
        }
        // Bumpers, booms and claws may overhang the body outline, by at most 4 px.
        expect(box.x0).toBeGreaterThanOrEqual(-chassis.bodyHalfWidth - 4);
        expect(box.x1).toBeLessThanOrEqual(chassis.bodyHalfWidth + 4);
        expect(box.y0).toBeGreaterThanOrEqual(-chassis.bodyHalfLength - 4);
        expect(box.y1).toBeLessThanOrEqual(chassis.bodyHalfLength + 4);
        expect(mount.regionHalfW).toBeGreaterThanOrEqual(0);
        expect(mount.regionHalfH).toBeGreaterThanOrEqual(0);
        expect(mount.capacity).toBeGreaterThanOrEqual(1);
        expect(mount.allowedQuarterTurns.length).toBeGreaterThanOrEqual(1);
        expect(new Set(mount.allowedQuarterTurns).size).toBe(mount.allowedQuarterTurns.length);
      }
    },
  );

  it.each(CHASSIS_LIST)(
    '$displayName has mirrored wheels and mirrored left and right mounts',
    (chassis) => {
      // Wheels: every anchor off the centre line has a twin on the other side.
      for (const wheel of chassis.wheelAnchors) {
        if (wheel.x === 0) continue;
        const twin = chassis.wheelAnchors.find((w) => w.x === -wheel.x && w.y === wheel.y);
        expect(twin, wheel.id).toBeDefined();
        expect(twin!.steers).toBe(wheel.steers);
        expect(twin!.driven).toBe(wheel.driven);
      }
      expect(chassis.wheelAnchors.some((w) => w.steers)).toBe(true);
      expect(chassis.wheelAnchors.some((w) => w.driven)).toBe(true);
      const swap = (c: MountCategory): MountCategory =>
        c === 'LEFT' ? 'RIGHT' : c === 'RIGHT' ? 'LEFT' : c;
      for (const mount of accessoryMounts(chassis)) {
        if (mount.x === 0) continue;
        const twin = accessoryMounts(chassis).find((m) => m.x === -mount.x && m.y === mount.y);
        expect(twin, `${mount.id} has no mirror`).toBeDefined();
        expect(twin!.maxFootprint).toEqual(mount.maxFootprint);
        expect(twin!.categories).toEqual(mount.categories.map(swap));
        expect(twin!.capacity).toBe(mount.capacity);
        expect([twin!.regionHalfW, twin!.regionHalfH]).toEqual([
          mount.regionHalfW,
          mount.regionHalfH,
        ]);
        expect(twin!.id).toBe(
          mount.id.replace(/left|right/, (side) => (side === 'left' ? 'right' : 'left')),
        );
      }
    },
  );

  it('keeps the wheel anchors, body bounds and engine bay the first three sprites were drawn for', () => {
    const shipped: Record<string, [number, number, number, number, number, number, number]> = {
      // id: front x, front y, rear x, rear y, half width, half length, engine bay y
      chassis_beetle: [14.5, -17, 14.5, 17.5, 17, 29, 20],
      chassis_arrow: [11.5, -14, 13, 19, 14, 31, 20],
    };
    for (const [id, [fx, fy, rx, ry, hw, hl, bay]] of Object.entries(shipped)) {
      const c = CHASSIS[id]!;
      expect(c.wheelAnchors.map((w) => [w.id, w.x, w.y, w.steers, w.driven])).toEqual([
        ['front_left', -fx, fy, true, false],
        ['front_right', fx, fy, true, false],
        ['rear_left', -rx, ry, false, true],
        ['rear_right', rx, ry, false, true],
      ]);
      expect([c.bodyHalfWidth, c.bodyHalfLength]).toEqual([hw, hl]);
      expect([engineMount(c)!.x, engineMount(c)!.y]).toEqual([0, bay]);
    }
    const spider = CHASSIS.chassis_spider!;
    expect(spider.wheelAnchors.map((w) => [w.x, w.y])).toEqual([
      [-22.5, -24],
      [22.5, -24],
      [-24.5, 0],
      [24.5, 0],
      [-22.5, 24],
      [22.5, 24],
    ]);
    expect([spider.bodyHalfWidth, spider.bodyHalfLength, engineMount(spider)!.y]).toEqual([
      24, 34, 24,
    ]);
  });

  it('sizes bodies as Section 12.4 describes', () => {
    const beetle = CHASSIS.chassis_beetle!;
    expect([beetle.bodyHalfWidth * 2, beetle.bodyHalfLength * 2]).toEqual([34, 58]);
    for (const chassis of CHASSIS_LIST) {
      expect(chassis.bodyHalfWidth * 2, chassis.id).toBeLessThanOrEqual(56);
      expect(chassis.bodyHalfLength * 2, chassis.id).toBeLessThanOrEqual(80);
      expect(chassis.footprint).toEqual({
        w: chassis.bodyHalfWidth * 2,
        h: chassis.bodyHalfLength * 2,
      });
      expect(
        CHASSIS[chassis.defaultEngineId] ?? ENGINES[chassis.defaultEngineId],
        chassis.id,
      ).toBeDefined();
      for (const wheel of chassis.wheelAnchors) {
        expect(Math.abs(wheel.x), chassis.id).toBeLessThanOrEqual(chassis.bodyHalfWidth + 4);
        expect(Math.abs(wheel.y), chassis.id).toBeLessThanOrEqual(chassis.bodyHalfLength);
      }
    }
    // The Trike is the smallest body and the Spider the widest.
    const areas = CHASSIS_LIST.map((c) => c.bodyHalfWidth * c.bodyHalfLength);
    expect(CHASSIS.chassis_trike!.bodyHalfWidth * CHASSIS.chassis_trike!.bodyHalfLength).toBe(
      Math.min(...areas),
    );
    expect(CHASSIS.chassis_spider!.bodyHalfWidth).toBe(
      Math.max(...CHASSIS_LIST.map((c) => c.bodyHalfWidth)),
    );
  });

  it('expresses each defining modifier as data the rules read', () => {
    const totals = (id: string) =>
      aggregateModifiers({
        blueprint: TEMPLATES[0]!.blueprint,
        chassis: CHASSIS[id]!,
        engine: ENGINES.engine_four_cylinder!,
        tires: TIRES.tires_street!,
        parts: [],
        unresolved: [],
      });
    expect(totals('chassis_beetle').drag).toBe(1);
    expect(totals('chassis_beetle').steering.stability).toBe(0);
    expect(CHASSIS.chassis_spider!.wheelCount).toBe(6);
    expect(totals('chassis_spider').steering.stability).toBe(18);
    expect(totals('chassis_spider').steering.yaw).toBeCloseTo(0.94, 9);
    expect(totals('chassis_spider').drag).toBeCloseTo(1.1, 9);
    expect(CHASSIS.chassis_trike!.wheelCount).toBe(3);
    expect(totals('chassis_trike').steering.stability).toBe(-16);
    expect(totals('chassis_trike').steering.yaw).toBeCloseTo(1.08, 9);
    expect(totals('chassis_trike').drag).toBe(1);
    expect(totals('chassis_arrow').drag).toBeCloseTo(0.84, 9);
    expect(accessoryMounts(CHASSIS.chassis_arrow!)).toHaveLength(4);
    expect(totals('chassis_pickup').drag).toBeCloseTo(1.08, 9);
    expect(totals('chassis_pickup').hardpoints).toEqual([{ category: 'UNIVERSAL', count: 1 }]);
    // The rack behind the cab holds one small part more than a mount does.
    const racks = accessoryMounts(CHASSIS.chassis_pickup!).filter(
      (m) => m.categories[0] === 'UNIVERSAL' && m.capacity === 2,
    );
    expect(racks.map((m) => m.id)).toEqual(['bed_front']);
    expect(totals('chassis_pickup').damage.rear_mounted_part).toBeCloseTo(1.15, 9);
    // No frame keeps a special any-weapon cavity; the Pickup bed is an ordinary UNIVERSAL mount.
    for (const chassis of CHASSIS_LIST)
      for (const mount of accessoryMounts(chassis))
        expect(mount.acceptsAnyWeapon, `${chassis.id} ${mount.id}`).toBeUndefined();
    for (const chassis of CHASSIS_LIST)
      expect(chassis.armorLoadShare, chassis.id).toBe(CHASSIS.chassis_beetle!.armorLoadShare);
  });
});

/**
 * The product-owner decision of October 11, 2026: five chassis, each clearly best at one
 * thing and paying for it in a number the garage shows. These are the claims the chassis
 * cards make, checked against the data.
 */
describe('five chassis, each with a clear strength and a clear cost', () => {
  const [beetle, arrow, pickup, spider, trike] = [
    CHASSIS.chassis_beetle!,
    CHASSIS.chassis_arrow!,
    CHASSIS.chassis_pickup!,
    CHASSIS.chassis_spider!,
    CHASSIS.chassis_trike!,
  ];
  const others = (c: typeof beetle) => CHASSIS_LIST.filter((o) => o !== c);
  const primaries = (c: typeof beetle) => new Set(accessoryMounts(c).map((m) => m.categories[0]));
  const largest = (c: typeof beetle) =>
    Math.max(...accessoryMounts(c).map((m) => m.maxFootprint.w * m.maxFootprint.h));

  it('keeps mount counts the garage can lay out without scrolling', () => {
    expect(accessoryMounts(beetle)).toHaveLength(5);
    expect(accessoryMounts(arrow)).toHaveLength(4);
    expect(accessoryMounts(pickup)).toHaveLength(6);
    expect(accessoryMounts(spider)).toHaveLength(8);
    expect(accessoryMounts(trike).length).toBeGreaterThanOrEqual(3);
    expect(accessoryMounts(trike).length).toBeLessThanOrEqual(4);
    for (const chassis of CHASSIS_LIST)
      expect(accessoryMounts(chassis).length, chassis.id).toBeLessThanOrEqual(8);
  });

  it('Beetle: the cheapest four-wheel frame, the only one with a nose, roof, side and tail mount', () => {
    for (const other of others(beetle).filter((c) => c.wheelCount >= 4))
      expect(beetle.price, other.id).toBeLessThanOrEqual(other.price - 30);
    const all = ['FRONT', 'ROOF', 'UTILITY', 'REAR'] as const;
    expect(all.every((c) => primaries(beetle).has(c))).toBe(true);
    for (const other of others(beetle))
      expect(
        all.every((c) => primaries(other).has(c)),
        other.id,
      ).toBe(false);
    // The cost: it leads nothing else.
    expect(beetle.dragFactor).toBeGreaterThan(arrow.dragFactor);
    expect(beetle.maxLoadKg).toBeLessThan(pickup.maxLoadKg);
    expect(beetle.stabilityOffset).toBeLessThan(spider.stabilityOffset);
    expect(beetle.price).toBeGreaterThan(trike.price);
  });

  it('Arrow: the lowest drag by a wide margin, for the fewest mounts and a small load limit', () => {
    for (const other of others(arrow))
      expect(arrow.dragFactor, other.id).toBeLessThanOrEqual(other.dragFactor - 0.15);
    expect(accessoryMounts(arrow).length).toBe(
      Math.min(...CHASSIS_LIST.map((c) => accessoryMounts(c).length)),
    );
    for (const other of others(arrow).filter((c) => c.wheelCount >= 4))
      expect(arrow.maxLoadKg, other.id).toBeLessThanOrEqual(other.maxLoadKg - 100);
    expect(primaries(arrow).has('UTILITY')).toBe(false);
  });

  it('Pickup: the highest load and the largest mount, for weight, drag and no nose mount', () => {
    for (const other of others(pickup)) {
      expect(pickup.maxLoadKg, other.id).toBeGreaterThanOrEqual(other.maxLoadKg + 150);
      expect(pickup.recommendedLoadKg, other.id).toBeGreaterThan(other.recommendedLoadKg);
      expect(largest(pickup), other.id).toBeGreaterThan(largest(other));
    }
    for (const id of ['bed_front', 'bed_rear'])
      expect(accessoryMounts(pickup).find((m) => m.id === id)!.categories).toEqual(['UNIVERSAL']);
    // The bed is the only home of the largest weapon.
    const mortar = ACCESSORIES.weapon_mortar!;
    const fits = (c: typeof beetle) =>
      accessoryMounts(c).some(
        (m) =>
          mountAccepts(m, mortar) &&
          mortar.footprint.w <= m.maxFootprint.w &&
          mortar.footprint.h <= m.maxFootprint.h,
      );
    expect(CHASSIS_LIST.filter(fits).map((c) => c.id)).toEqual(['chassis_pickup']);
    expect(primaries(pickup).has('FRONT')).toBe(false);
    expect(pickup.massKg).toBeGreaterThan(beetle.massKg + 100);
    expect(pickup.dragFactor).toBeGreaterThan(beetle.dragFactor);
  });

  it('Spider: the most stable and the most mounts, for the highest price, drag and six wheels', () => {
    for (const other of others(spider)) {
      expect(spider.stabilityOffset, other.id).toBeGreaterThanOrEqual(other.stabilityOffset + 18);
      expect(accessoryMounts(spider).length, other.id).toBeGreaterThan(
        accessoryMounts(other).length,
      );
      expect(spider.price, other.id).toBeGreaterThan(other.price);
      expect(spider.dragFactor, other.id).toBeGreaterThan(other.dragFactor);
      expect(spider.yawFactor, other.id).toBeLessThan(other.yawFactor);
      expect(primaries(other).has('LEFT'), other.id).toBe(false);
    }
    expect(primaries(spider).has('LEFT') && primaries(spider).has('RIGHT')).toBe(true);
  });

  it('Trike: the cheapest and lightest, for the least stability, strength and load', () => {
    for (const other of others(trike)) {
      expect(trike.price, other.id).toBeLessThanOrEqual(other.price - 30);
      expect(trike.massKg, other.id).toBeLessThan(other.massKg - 80);
      expect(trike.stabilityOffset, other.id).toBeLessThan(other.stabilityOffset - 10);
      expect(trike.stabilityThreshold, other.id).toBeGreaterThan(other.stabilityThreshold);
      expect(trike.baseIntegrity, other.id).toBeLessThan(other.baseIntegrity);
      expect(trike.maxLoadKg, other.id).toBeLessThan(other.maxLoadKg);
    }
    // Three wheels: a wheel kit costs a quarter less than on a four-wheel frame.
    expect(partCard(TIRES.tires_street!, trike.wheelCount).price).toBe(60);
    expect(partCard(TIRES.tires_street!, spider.wheelCount).price).toBe(120);
  });

  it('gives every chassis a legal starter car, and uses only these five anywhere', () => {
    const starters = TEMPLATES.filter((t) => t.group === 'starter');
    expect(starters).toHaveLength(5);
    expect(new Set(starters.map((t) => t.blueprint.chassisId))).toEqual(
      new Set(CHASSIS_LIST.map((c) => c.id)),
    );
    const used = new Set(TEMPLATES.map((t) => t.blueprint.chassisId));
    expect(used).toEqual(new Set(CHASSIS_LIST.map((c) => c.id)));
    for (const template of TEMPLATES) {
      const result = validateBlueprint(template.blueprint, CATALOG);
      expect(result.ok, template.name).toBe(true);
      expect(
        result.issues.filter((i) => i.severity === 'error'),
        template.name,
      ).toEqual([]);
    }
    expect(TEMPLATES.find((t) => t.id === 'baseline')!.blueprint.chassisId).toBe('chassis_beetle');
    expect(TEMPLATES.find((t) => t.id === 'starter_rookie')!.blueprint.chassisId).toBe(
      'chassis_beetle',
    );
  });
});

describe('wheel kit price and mass by wheel count (Section 6.3)', () => {
  it.each(TIRE_LIST)(
    '$displayName is priced round(price * wheels / 4) for 3, 4 and 6 wheels',
    (kit) => {
      const spec = SPEC_TIRES.find((r) => r[0] === kit.id)!;
      const price = Number(spec[2]);
      const mass = Number(spec[3]);
      for (const wheels of [3, 4, 6]) {
        expect(wheelKitPrice(kit, wheels)).toBe(Math.round((price * wheels) / 4));
        expect(wheelKitMass(kit, wheels)).toBeCloseTo((mass * wheels) / 4, 9);
        expect(partCard(kit, wheels).price).toBe(Math.round((price * wheels) / 4));
      }
      expect(wheelKitPrice(kit, 4)).toBe(price);
      expect(
        Number.isInteger(wheelKitPrice(kit, 3)) && Number.isInteger(wheelKitPrice(kit, 6)),
      ).toBe(true);
    },
  );

  it('rounds half credits the way the formula says', () => {
    // 125 * 6 / 4 = 187.5 and 65 * 3 / 4 = 48.75.
    expect(wheelKitPrice(TIRES.tires_sand!, 6)).toBe(188);
    expect(wheelKitPrice(TIRES.tires_micro!, 3)).toBe(49);
    expect(wheelKitPrice(TIRES.tires_street!, 3)).toBe(60);
    expect(wheelKitPrice(TIRES.tires_street!, 6)).toBe(120);
  });
});

function allStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (value && typeof value === 'object')
    for (const v of Object.values(value)) allStrings(v, out);
  return out;
}

describe('player-facing copy (Section 18)', () => {
  const copy = [
    ...allStrings(STRINGS),
    ...allParts().flatMap((p) => [p.displayName, p.description, p.drawback]),
    ...CHASSIS_LIST.map((c) => c.handling),
    ...Object.values(PAINTS).map((p) => p.displayName),
    ...TEMPLATES.flatMap((t) => [t.name, t.description, t.blueprint.name]),
    ...Object.values(BLUEPRINT_ISSUE_COPY),
    ...Object.values(STATS_WARNING_COPY),
    TURRET_BLOCKED_COPY,
    OVERWEIGHT_HINT,
  ];

  it('uses the approved lines exactly', () => {
    expect(STRINGS.tagline).toBe('Build smart. Drive hard.');
    expect(STRINGS.home.raceAi).toBe('Race AI');
    expect(STRINGS.race.go).toBe('GO!');
    expect(STRINGS.race.leaveConfirm).toBe("Leave this race? You won't be able to finish it.");
    expect(STRINGS.connection.lost).toBe('Connection lost. Trying to bring you back...');
    expect(STRINGS.race.pauseNote).toBe('The race keeps going while this menu is open.');
    // Direction steering is the default control (docs/DECISIONS.md), so the first-race hint
    // describes it. The Section 4 wording is kept for the wheel-style option it still fits.
    expect(STRINGS.race.steerHint).toBe('Drag toward where you want to go. Pull back to brake.');
    expect(STRINGS.race.steerHintWheel).toBe('Drag to steer. Pull down to brake.');
    // Sections 6.6 and 18.1 for the garage.
    expect(BLUEPRINT_ISSUE_COPY.NOT_ENOUGH_CREDITS).toBe('Not enough credits');
    expect(BLUEPRINT_ISSUE_COPY.NO_COMPATIBLE_MOUNT).toBe('No compatible mount');
    expect(TURRET_BLOCKED_COPY).toBe('This part blocks your turret');
    expect(BLUEPRINT_ISSUE_COPY.TOO_HEAVY).toBe('Too much weight');
    expect(BLUEPRINT_ISSUE_COPY.ONE_PER_CAR).toBe('One per car');
    expect(BLUEPRINT_ISSUE_COPY.MISSING_ESSENTIAL).toBe(
      'Your car needs an engine and a complete set of wheels.',
    );
    expect(OVERWEIGHT_HINT).toBe('Too heavy for this chassis. Remove weight or swap frames.');
    expect(BLUEPRINT_ISSUE_COPY.PART_BLOCKS_ANOTHER).toBe('This part blocks another attachment.');
    expect(BLUEPRINT_ISSUE_COPY.CATALOG_MISMATCH).toBe(
      'This build uses older part values. Review it before racing.',
    );
    expect(STATS_WARNING_COPY.RUNS_HOT).toBe(
      'This build runs hot. Add cooling or manage your throttle.',
    );
    expect(STATS_WARNING_COPY.LOW_POWER).toBe('Not enough power for every system at once.');
  });

  it('has no em dashes, double hyphens or promotional filler', () => {
    expect(copy.length).toBeGreaterThan(500);
    for (const line of copy) {
      expect(line, line).not.toMatch(/—|–|--/);
      expect(line.toLowerCase(), line).not.toMatch(
        /unleash|next-level|next level|\bepic\b|ultimate|thrilling|experience the/,
      );
      expect(line.trim(), line).toBe(line);
      expect(line.length).toBeGreaterThan(0);
      expect(line, line).not.toMatch(/ {2}|!!/);
    }
  });

  it('writes part cards in sentence case with a full stop, and names in title case', () => {
    for (const part of allParts()) {
      for (const line of [part.description, part.drawback]) {
        expect(line, `${part.id}: ${line}`).toMatch(/^[A-Z0-9]/);
        expect(line, `${part.id}: ${line}`).toMatch(/\.$/);
        expect(line.length, `${part.id}: ${line}`).toBeLessThanOrEqual(96);
        expect(line, `${part.id}: ${line}`).not.toMatch(/!/);
      }
      expect(part.displayName, part.id).toMatch(/^[A-Z0-9]/);
    }
  });
});
