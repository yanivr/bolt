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
  allowedRotations,
  emptyTotals,
  applyModifier,
  engineMount,
  mountAccepts,
  rectAround,
  rectsConflict,
  rotatedFootprint,
  wheelKitMass,
  wheelKitPrice,
  wheelRect,
} from '@bolt/shared';
import { describe, expect, it } from 'vitest';

/**
 * Catalog integrity. The expected values below are transcribed from Sections 6.4 and 11.2
 * to 11.7 of docs/MASTER_SPEC.md by hand, as an independent list: nothing here is derived
 * from the data under test.
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

// Section 11.2: id | display name | cost | mass kg
const SPEC_CHASSIS = rows(`
chassis_beetle | Beetle | 150 | 250
chassis_needle | Needle | 135 | 180
chassis_turtle | Turtle | 215 | 460
chassis_spider | Spider | 235 | 420
chassis_crab | Crab | 195 | 330
chassis_cobra | Cobra | 170 | 295
chassis_scorpion | Scorpion | 180 | 310
chassis_buggy | Buggy | 165 | 240
chassis_chameleon | Chameleon | 195 | 275
chassis_brick | Brick | 245 | 560
chassis_trike | Trike | 120 | 145
chassis_arrow | Arrow | 180 | 230
chassis_wagon | Wagon | 190 | 390
chassis_rammer | Rammer | 220 | 455
chassis_drifter | Drifter | 155 | 260
chassis_kangaroo | Kangaroo | 190 | 325
chassis_horseshoe | Horseshoe | 195 | 350
chassis_pickup | Pickup | 185 | 365
chassis_twins | Twins | 230 | 490
chassis_platform | Platform | 210 | 390
`);

// Section 6.4: family | wheels | bias letters | mounts | recommended | max | handling
const SPEC_LAYOUT = rows(`
Beetle | 4 | F B T U | 5 | 460 | 730 | Forgiving and compact
Needle | 4 | F T | 4 | 350 | 560 | High top-speed modifier
Turtle | 4 | F B L R T | 7 | 720 | 1050 | Durable and slow
Spider | 6 | L R T U | 8 | 760 | 1150 | Very stable and wide
Crab | 4 | L R L R T | 8 | 630 | 950 | Side-mounted tricks
Cobra | 4 | F F T B | 6 | 550 | 850 | Straight-line front attack
Scorpion | 4 | B B T U | 6 | 550 | 850 | Rear weapon emphasis
Buggy | 4 | F T B U | 6 | 460 | 780 | Off-road suspension
Chameleon | 4 | X X X X X X X X | 8 | 520 | 790 | Flexible and fragile
Brick | 4 | F B L R T U | 9 | 850 | 1250 | Large and heavy
Trike | 3 | F B T | 4 | 280 | 460 | Agile but unstable
Arrow | 4 | F B T | 4 | 420 | 680 | Excellent drag coefficient
Wagon | 4 | B B U U T | 8 | 720 | 1090 | Support and slow turning
Rammer | 4 | F F L R | 7 | 710 | 1090 | Heavy frontal collision
Drifter | 4 | B L R T | 6 | 490 | 770 | Controlled slip
Kangaroo | 4 | F B U | 5 | 530 | 860 | Bumps and jump support
Horseshoe | 4 | F F L R | 6 | 610 | 940 | Large front cavity
Pickup | 4 | B B U U | 8 | 690 | 1080 | Rear modular cargo
Twins | 4 | L R T T | 8 | 790 | 1180 | Very wide and unusual
Platform | 4 | X X X X X X X X X X | 10 | 680 | 1020 | Maximum freedom, exposed parts
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

describe('catalog: 120 parts with the exact seed values of Section 11', () => {
  it('has exactly twenty parts in each of the six categories, with unique ids', () => {
    expect(PART_CATEGORIES).toHaveLength(6);
    for (const category of PART_CATEGORIES) {
      const list = partsByCategory(category);
      expect(list, category).toHaveLength(20);
      for (const part of list) expect(part.category).toBe(category);
    }
    const ids = allParts().map((p) => p.id);
    expect(ids).toHaveLength(120);
    expect(new Set(ids).size).toBe(120);
    expect(Object.keys(CATALOG.chassis)).toHaveLength(20);
    expect(Object.keys(CATALOG.engines)).toHaveLength(20);
    expect(Object.keys(CATALOG.tires)).toHaveLength(20);
    expect(Object.keys(CATALOG.parts)).toHaveLength(60);
    expect(CATALOG.version).toBe(CATALOG_VERSION);
    expect(CATALOG_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(Object.keys(PAINTS).length).toBeGreaterThanOrEqual(4);
  });

  it('matches every chassis row of Section 11.2', () => expectRows(CHASSIS_LIST, SPEC_CHASSIS));
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
      // Installable on at least five different chassis, so nothing is a one-frame curiosity.
      const homes = CHASSIS_LIST.filter((chassis) =>
        accessoryMounts(chassis).some(
          (mount) =>
            mountAccepts(mount, part) &&
            allowedRotations(mount, part).some((turn) => {
              const size = rotatedFootprint(part.footprint, turn);
              return size.w <= mount.maxFootprint.w && size.h <= mount.maxFootprint.h;
            }),
        ),
      );
      expect(
        homes.length,
        `${part.id} fits on ${homes.map((c) => c.displayName).join(', ')}`,
      ).toBeGreaterThanOrEqual(5);
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

describe('chassis layouts (Sections 6.3 and 6.4)', () => {
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
      // The Chameleon is the one frame the specification describes as asymmetrical.
      if (chassis.id === 'chassis_chameleon') {
        const offCentre = accessoryMounts(chassis).filter((m) => m.x !== 0);
        expect(
          offCentre.some((m) => !accessoryMounts(chassis).some((o) => o.x === -m.x && o.y === m.y)),
        ).toBe(true);
        return;
      }
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

  it('keeps the wheel anchors, body bounds and engine bay the four shipped sprites were drawn for', () => {
    const shipped: Record<string, [number, number, number, number, number, number, number]> = {
      // id: front x, front y, rear x, rear y, half width, half length, engine bay y
      chassis_beetle: [14.5, -17, 14.5, 17.5, 17, 29, 20],
      chassis_arrow: [11.5, -14, 13, 19, 14, 31, 20],
      chassis_turtle: [15.5, -19, 15.5, 19.5, 21, 31, 21],
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
    // The Trike is the smallest body, and Twins is a quarter wider than a typical large frame.
    const areas = CHASSIS_LIST.map((c) => c.bodyHalfWidth * c.bodyHalfLength);
    expect(CHASSIS.chassis_trike!.bodyHalfWidth * CHASSIS.chassis_trike!.bodyHalfLength).toBe(
      Math.min(...areas),
    );
    const others = CHASSIS_LIST.filter(
      (c) => c.id !== 'chassis_twins' && c.id !== 'chassis_crab',
    ).map((c) => c.bodyHalfWidth);
    const typicalLarge =
      [CHASSIS.chassis_turtle!, CHASSIS.chassis_rammer!, CHASSIS.chassis_horseshoe!]
        .map((c) => c.bodyHalfWidth)
        .reduce((a, b) => a + b, 0) / 3;
    expect(CHASSIS.chassis_twins!.bodyHalfWidth).toBeGreaterThan(Math.max(...others));
    expect(CHASSIS.chassis_twins!.bodyHalfWidth / typicalLarge).toBeGreaterThan(1.22);
    expect(CHASSIS.chassis_twins!.bodyHalfWidth / typicalLarge).toBeLessThan(1.32);
  });

  it('expresses each defining modifier of Section 11.2 as data the rules read', () => {
    const totals = (id: string) =>
      aggregateModifiers({
        blueprint: TEMPLATES[0]!.blueprint,
        chassis: CHASSIS[id]!,
        engine: ENGINES.engine_four_cylinder!,
        tires: TIRES.tires_street!,
        parts: [],
        unresolved: [],
      });
    expect(totals('chassis_needle').steering.topSpeed).toBeCloseTo(1.08, 9);
    expect(CHASSIS.chassis_needle!.armorLoadShare).toBeLessThan(
      CHASSIS.chassis_beetle!.armorLoadShare,
    );
    expect(
      accessoryMounts(CHASSIS.chassis_needle!).filter((m) => m.categories.includes('ARMOR')),
    ).toHaveLength(1);
    expect(totals('chassis_turtle').integrity.chassis).toBeCloseTo(1.35, 9);
    expect(totals('chassis_turtle').steering.yaw).toBeCloseTo(0.88, 9);
    expect(CHASSIS.chassis_spider!.wheelCount).toBe(6);
    expect(totals('chassis_spider').steering.stability).toBe(18);
    expect(totals('chassis_crab').aimArcs).toEqual([
      { mounts: ['LEFT', 'RIGHT'], addDegrees: 45, rangeFactor: 1 },
    ]);
    for (const mount of accessoryMounts(CHASSIS.chassis_crab!).filter((m) => m.x !== 0))
      expect([...mount.allowedQuarterTurns].sort()).toEqual([0, 1, 2, 3]);
    expect(
      accessoryMounts(CHASSIS.chassis_cobra!).filter((m) => m.categories[0] === 'FRONT'),
    ).toHaveLength(2);
    expect(totals('chassis_cobra').steering.yaw).toBeCloseTo(0.92, 9);
    expect(
      accessoryMounts(CHASSIS.chassis_scorpion!).filter((m) => m.categories[0] === 'REAR'),
    ).toHaveLength(2);
    expect(totals('chassis_scorpion').aimArcs).toEqual([
      { mounts: ['REAR'], addDegrees: 0, rangeFactor: 1.08 },
    ]);
    expect(totals('chassis_buggy').grip.dirt).toBeCloseTo(1.12, 9);
    expect(totals('chassis_buggy').grip.sand).toBeCloseTo(1.12, 9);
    expect(totals('chassis_buggy').grip.asphalt).toBe(1);
    expect(
      CHASSIS.chassis_buggy!.armorLoadShare / CHASSIS.chassis_beetle!.armorLoadShare,
    ).toBeCloseTo(0.85, 9);
    expect(
      accessoryMounts(CHASSIS.chassis_chameleon!).every((m) => m.categories[0] === 'UNIVERSAL'),
    ).toBe(true);
    expect(totals('chassis_chameleon').integrity.chassis).toBeCloseTo(0.82, 9);
    expect(accessoryMounts(CHASSIS.chassis_brick!)).toHaveLength(9);
    expect(totals('chassis_brick').drag).toBeCloseTo(1.2, 9);
    expect(CHASSIS.chassis_trike!.wheelCount).toBe(3);
    expect(totals('chassis_trike').steering.stability).toBe(-16);
    expect(totals('chassis_arrow').drag).toBeCloseTo(0.84, 9);
    expect(accessoryMounts(CHASSIS.chassis_arrow!)).toHaveLength(4);
    expect(totals('chassis_wagon').steering.turnRadius).toBeCloseTo(1.12, 9);
    expect(totals('chassis_wagon').hardpoints).toEqual([{ category: 'UTILITY', count: 2 }]);
    // "Utility capacity +2": two utility racks that each hold one part more than a mount does.
    const extra = (id: string) =>
      accessoryMounts(CHASSIS[id]!)
        .filter((m) => m.categories[0] === 'UTILITY')
        .reduce((sum, m) => sum + m.capacity - 1, 0);
    expect(extra('chassis_wagon')).toBe(2);
    expect(totals('chassis_rammer').impulse.ram_dealt).toBeCloseTo(1.2, 9);
    expect(CHASSIS.chassis_rammer!.massKg).toBeGreaterThan(450);
    expect(totals('chassis_drifter').slip.factor).toBeCloseTo(1.15, 9);
    expect(totals('chassis_drifter').steering.peakGrip).toBeCloseTo(0.94, 9);
    expect(totals('chassis_kangaroo').impulse.obstacle).toBeCloseTo(0.78, 9);
    const cavity = accessoryMounts(CHASSIS.chassis_horseshoe!).find((m) => m.acceptsAnyWeapon)!;
    expect(cavity.categories[0]).toBe('FRONT');
    for (const chassis of CHASSIS_LIST)
      for (const mount of accessoryMounts(chassis))
        if (mount !== cavity) {
          expect(
            mount.maxFootprint.w * mount.maxFootprint.h,
            `${chassis.id} ${mount.id}`,
          ).toBeLessThan(cavity.maxFootprint.w * cavity.maxFootprint.h);
          expect(mount.acceptsAnyWeapon, `${chassis.id} ${mount.id}`).toBeUndefined();
        }
    expect(totals('chassis_horseshoe').damage.rear).toBeCloseTo(1.2, 9);
    // "Two cargo utilities": two large bed mounts that hold two utilities each.
    const beds = accessoryMounts(CHASSIS.chassis_pickup!).filter(
      (m) => m.categories[0] === 'UTILITY' && m.capacity === 2,
    );
    expect(beds).toHaveLength(2);
    expect(extra('chassis_pickup')).toBe(2);
    expect(totals('chassis_pickup').damage.rear_mounted_part).toBeCloseTo(1.15, 9);
    expect(totals('chassis_twins').steering.stability).toBe(20);
    expect(
      accessoryMounts(CHASSIS.chassis_platform!).filter((m) => m.categories[0] === 'UNIVERSAL'),
    ).toHaveLength(10);
    expect(totals('chassis_platform').integrity.chassis).toBeCloseTo(0.78, 9);
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
