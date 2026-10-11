import {
  BASELINE_BLUEPRINT,
  CATALOG,
  CATALOG_VERSION,
  CHASSIS,
  CHASSIS_LIST,
  EXAMPLE_TEMPLATES,
  ROOKIE_BLUEPRINT,
  STARTER_TEMPLATES,
  TEMPLATES,
  baselineBlueprint,
  resolveBuild,
} from '@bolt/content';
import type { BlueprintPart, QuarterTurn, VehicleBlueprint } from '@bolt/shared';
import {
  BLUEPRINT_ISSUE_CODES,
  BLUEPRINT_ISSUE_COPY,
  MAX_BLUEPRINT_BYTES,
  MAX_BLUEPRINT_PARTS,
  OVERWEIGHT_HINT,
  STARTING_CREDITS,
  TURRET_BLOCKED_COPY,
  accessoryMounts,
  allowedRotations,
  armorLimitKg,
  blueprintCost,
  blueprintSchema,
  buildHash,
  canonicalizeBlueprint,
  installPart,
  installedLoadKg,
  mechanicalJson,
  resolveBlueprint,
  occupiedFootprint,
  sanitizeBlueprintName,
  serializeBlueprint,
  totalMassKg,
  validateBlueprint,
  validateUntrustedBlueprint,
} from '@bolt/shared';
import { describe, expect, it } from 'vitest';
import {
  car,
  check,
  errorCodes,
  fittingRotation,
  probeFor,
  warningCodes,
} from '../helpers/blueprints.js';

function install(blueprint: VehicleBlueprint, partId: string, mountId?: string): VehicleBlueprint {
  const result = installPart(blueprint, CATALOG, partId, mountId ? { mountId } : undefined);
  if (!result.ok) throw new Error(`install ${partId} failed: ${result.issue.code}`);
  return result.blueprint;
}

describe('canonical form and mechanical hash (Section 15.6)', () => {
  const purchases: Array<[string, string]> = [
    ['weapon_front_mg', 'front_center'],
    ['utility_fan', 'left_utility'],
    ['utility_repair', 'right_utility'],
    ['weapon_rear_mg', 'rear_center'],
    ['utility_radar', 'roof_mid'],
  ];
  const buy = (order: number[]) =>
    order.reduce((bp, i) => install(bp, purchases[i]![0], purchases[i]![1]), baselineBlueprint());

  it('gives the same hash for the same car bought in different orders', () => {
    const a = buy([0, 1, 2, 3, 4]);
    const b = buy([4, 2, 0, 3, 1]);
    const c = buy([3, 4, 1, 0, 2]);
    // The purchase order really did differ: instance ids land on different parts.
    expect(a.parts.find((p) => p.partId === 'utility_radar')!.instanceId).not.toBe(
      b.parts.find((p) => p.partId === 'utility_radar')!.instanceId,
    );
    expect(buildHash(a)).toBe(buildHash(b));
    expect(buildHash(a)).toBe(buildHash(c));
    expect(mechanicalJson(a)).toBe(mechanicalJson(b));
    expect(buildHash(a)).toMatch(/^[0-9a-f]{64}$/);
    // Same result however the array happens to be ordered on the way in.
    expect(buildHash({ ...a, parts: [...a.parts].reverse() })).toBe(buildHash(a));
    expect(check(a).ok && check(b).ok).toBe(true);
  });

  it('sorts parts by mount and then part id, on integer offsets, with stable JSON', () => {
    const messy: VehicleBlueprint = {
      ...buy([4, 2, 0, 3, 1]),
    };
    messy.parts = messy.parts.map((p) => ({ ...p, offsetX: p.offsetX + 0.3, offsetY: -0.2 }));
    const canonical = canonicalizeBlueprint(messy);
    expect(canonical.parts.map((p) => p.mountId)).toEqual(
      [...canonical.parts.map((p) => p.mountId)].sort(),
    );
    for (const part of canonical.parts) {
      expect(Number.isInteger(part.offsetX) && Number.isInteger(part.offsetY)).toBe(true);
      expect(Object.is(part.offsetY, -0)).toBe(false);
    }
    expect(serializeBlueprint(messy)).toBe(serializeBlueprint(canonical));
    expect(serializeBlueprint(canonicalizeBlueprint(canonical))).toBe(
      serializeBlueprint(canonical),
    );
    expect(Object.keys(JSON.parse(serializeBlueprint(messy)) as object)).toEqual([
      'formatVersion',
      'catalogVersion',
      'name',
      'chassisId',
      'engineId',
      'tireKitId',
      'paintId',
      'parts',
      'createdAt',
    ]);
    // Sub-pixel noise snaps away, so it cannot change the hash.
    expect(buildHash(messy)).toBe(buildHash(buy([0, 1, 2, 3, 4])));
    // Two parts on one mount sort by part id.
    const rack = canonicalizeBlueprint(
      car('chassis_pickup', [
        { partId: 'utility_repair', mountId: 'bed_front', offsetX: 5 },
        { partId: 'utility_fan', mountId: 'bed_front', offsetX: -5 },
      ]),
    );
    expect(rack.parts.map((p) => p.partId)).toEqual(['utility_fan', 'utility_repair']);
  });

  it('ignores name, paint, creation time and instance ids', () => {
    const a = buy([0, 1, 2, 3, 4]);
    const hash = buildHash(a);
    expect(buildHash({ ...a, name: 'Another Name' })).toBe(hash);
    expect(buildHash({ ...a, paintId: 'paint_mint' })).toBe(hash);
    expect(buildHash({ ...a, createdAt: '2031-01-01T12:00:00Z' })).toBe(hash);
    expect(
      buildHash({ ...a, parts: a.parts.map((p, i) => ({ ...p, instanceId: `renamed-${i}` })) }),
    ).toBe(hash);
  });

  it('changes with every mechanical change', () => {
    const a = buy([0, 1, 2, 3, 4]);
    const hash = buildHash(a);
    const variants: Record<string, VehicleBlueprint> = {
      engine: { ...a, engineId: 'engine_v6' },
      tires: { ...a, tireKitId: 'tires_slick' },
      chassis: { ...a, chassisId: 'chassis_arrow' },
      catalog: { ...a, catalogVersion: '9.9.9' },
      removed: { ...a, parts: a.parts.slice(1) },
      added: install(
        { ...a, parts: a.parts.filter((p) => p.partId !== 'utility_radar') },
        'utility_gyro',
        'roof_mid',
      ),
      swappedPart: {
        ...a,
        parts: a.parts.map((p) =>
          p.partId === 'utility_fan' ? { ...p, partId: 'utility_battery' } : p,
        ),
      },
      offsetX: {
        ...a,
        parts: a.parts.map((p, i) => (i === 0 ? { ...p, offsetX: p.offsetX + 1 } : p)),
      },
      offsetY: {
        ...a,
        parts: a.parts.map((p, i) => (i === 0 ? { ...p, offsetY: p.offsetY - 1 } : p)),
      },
      rotation: {
        ...a,
        parts: a.parts.map((p) =>
          p.partId === 'weapon_front_mg' ? { ...p, rotationQuarterTurns: 1 as QuarterTurn } : p,
        ),
      },
      mount: {
        ...a,
        parts: a.parts.map((p) => (p.partId === 'utility_fan' ? { ...p, mountId: 'roof_mid' } : p)),
      },
      slot: {
        ...a,
        parts: a.parts.map((p) =>
          p.partId === 'weapon_front_mg' ? { ...p, assignedActionSlot: 1 as const } : p,
        ),
      },
      noSlot: {
        ...a,
        parts: a.parts.map((p) => {
          if (p.partId !== 'weapon_front_mg') return p;
          const { assignedActionSlot: _slot, ...rest } = p;
          return rest;
        }),
      },
    };
    const seen = new Set([hash]);
    for (const [what, variant] of Object.entries(variants)) {
      const h = buildHash(variant);
      expect(h, what).not.toBe(hash);
      expect(seen.has(h), `${what} collides`).toBe(false);
      seen.add(h);
    }
    // Automatic mode on a hybrid is mechanical too.
    const turret = car('chassis_beetle', [
      { partId: 'weapon_turret', mountId: 'roof_mid', assignedActionSlot: 0 },
    ]);
    const auto = car('chassis_beetle', [
      { partId: 'weapon_turret', mountId: 'roof_mid', autoMode: true },
    ]);
    expect(buildHash(turret)).not.toBe(buildHash(auto));
  });

  it('gives every shipped template a distinct hash that the validator reports', () => {
    const hashes = new Set<string>();
    for (const template of TEMPLATES) {
      const result = check(template.blueprint);
      expect(result.ok, template.id).toBe(true);
      if (result.ok) {
        expect(result.buildHash).toBe(buildHash(template.blueprint));
        hashes.add(result.buildHash);
      }
    }
    // The baseline appears once as a template and is the only possible duplicate.
    expect(hashes.size).toBe(TEMPLATES.length);
  });
});

describe('shipped blueprints (Sections 6.3 and 11.9, on the five chassis)', () => {
  // After Section 11.9, rebuilt on the five chassis: chassis, engine, wheel kit, the extras.
  // Four are the specification's builds as written; the Iron Mule stands in for the Sticky
  // Turtle and Back-Alley Trap moved from the Scorpion to the Beetle.
  const SPEC_EXAMPLES: Record<string, [string, string, string, string[]]> = {
    'Straight-Line Rocket': [
      'Arrow',
      'V8',
      'Slicks',
      ['Nitro Tank', 'Cooling Fan', 'Front Machine Gun'],
    ],
    'Iron Mule': [
      'Pickup',
      'Four-Cylinder',
      'Armored Tires',
      ['Arc Mortar', 'Oil Slick', 'Energy Shield', 'Repair Kit'],
    ],
    'Dust Spider': ['Spider', 'Trail Engine', 'Sand Paddles', ['Air Cannon', 'Gyro Stabilizer']],
    'Rain Runner': ['Beetle', 'Sport Electric', 'Rain Runners', ['Rear Sentry', 'Energy Shield']],
    'Back-Alley Trap': [
      'Beetle',
      'Hybrid',
      'Street Tires',
      ['Road Mine', 'Rear Sentry', 'Mine Detector'],
    ],
    'Tiny Trouble': ['Trike', 'Rotary', 'Micro Wheels', ['Road Shotgun', 'Cooling Fan']],
  };

  it('prices the baseline car at 370 and the Rookie starter at 480', () => {
    const baseline = check(BASELINE_BLUEPRINT);
    expect(baseline.ok).toBe(true);
    expect(baseline.totalCost).toBe(370);
    expect(blueprintCost(BASELINE_BLUEPRINT, CATALOG)).toMatchObject({
      chassis: 150,
      engine: 140,
      tires: 80,
      parts: 0,
      total: 370,
    });
    expect([
      BASELINE_BLUEPRINT.chassisId,
      BASELINE_BLUEPRINT.engineId,
      BASELINE_BLUEPRINT.tireKitId,
    ]).toEqual(['chassis_beetle', 'engine_four_cylinder', 'tires_street']);
    const rookie = check(ROOKIE_BLUEPRINT);
    expect(rookie.ok).toBe(true);
    expect(rookie.totalCost).toBe(480);
    expect(ROOKIE_BLUEPRINT.parts.map((p) => p.partId).sort()).toEqual([
      'utility_spare',
      'weapon_front_mg',
    ]);
    expect(rookie.creditsLeft).toBe(520);
  });

  it('ships a starter car for every chassis, and the six example builds', () => {
    expect(STARTER_TEMPLATES.map((t) => [t.name, t.blueprint.chassisId])).toEqual([
      ['Rookie', 'chassis_beetle'],
      ['Sprinter', 'chassis_arrow'],
      ['Packhorse', 'chassis_pickup'],
      ['Longlegs', 'chassis_spider'],
      ['Tinker', 'chassis_trike'],
    ]);
    expect(EXAMPLE_TEMPLATES.map((t) => t.name)).toEqual(Object.keys(SPEC_EXAMPLES));
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
    for (const template of TEMPLATES) {
      expect(template.name.length).toBeGreaterThan(0);
      expect(template.description).toMatch(/^[A-Z].*\.$/);
      expect(template.blueprint.name).toBe(template.name);
    }
  });

  it.each(Object.entries(SPEC_EXAMPLES))(
    '%s is the build the table lists',
    (name, [chassis, engine, tires, extras]) => {
      const template = EXAMPLE_TEMPLATES.find((t) => t.name === name)!;
      const build = resolveBlueprint(template.blueprint, CATALOG)!;
      expect(build.chassis.displayName).toBe(chassis);
      expect(build.engine.displayName).toBe(engine);
      expect(build.tires.displayName).toBe(tires);
      expect(build.parts.map((p) => p.def.displayName).sort()).toEqual([...extras].sort());
    },
  );

  it.each(TEMPLATES)('$name is a legal, server-valid build with nothing inactive', (template) => {
    const result = check(template.blueprint);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.totalCost).toBeLessThanOrEqual(STARTING_CREDITS);
    if (!result.ok) return;
    expect(result.loadKg).toBeLessThanOrEqual(result.build.chassis.maxLoadKg);
    expect(result.loadKg).toBe(installedLoadKg(result.build));
    expect(totalMassKg(result.build)).toBe(result.build.chassis.massKg + result.loadKg);
    // The same verdict through the untrusted boundary and through the server's helper.
    expect(
      validateUntrustedBlueprint(JSON.parse(JSON.stringify(template.blueprint)), CATALOG).ok,
    ).toBe(true);
    expect(validateUntrustedBlueprint(serializeBlueprint(template.blueprint), CATALOG).ok).toBe(
      true,
    );
    expect(resolveBuild(template.blueprint).ok).toBe(true);
  });
});

describe('untrusted blueprints are parsed strictly (Sections 10.3 and 19.6)', () => {
  const good = JSON.parse(serializeBlueprint(ROOKIE_BLUEPRINT)) as Record<string, unknown> & {
    parts: Array<Record<string, unknown>>;
  };
  const withPart = (patch: Record<string, unknown>) => ({
    ...good,
    parts: [{ ...good.parts[0], ...patch }, good.parts[1]],
  });
  const refused = (value: unknown) => {
    const result = validateUntrustedBlueprint(value, CATALOG);
    return !result.ok && result.issues.length === 1 && result.issues[0]!.code === 'MALFORMED';
  };

  it('accepts a well-formed blueprint and returns its canonical form', () => {
    expect(blueprintSchema.safeParse(good).success).toBe(true);
    const result = validateUntrustedBlueprint(good, CATALOG);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.blueprint).toEqual(canonicalizeBlueprint(ROOKIE_BLUEPRINT));
  });

  it('refuses forged totals and any other field the client has no business sending', () => {
    for (const extra of [
      { totalCost: 0 },
      { creditsLeft: 9999 },
      { massKg: 1 },
      { buildHash: 'f'.repeat(64) },
      { params: { driveForce: 1e9 } },
      { stats: { speed: 100 } },
    ])
      expect(refused({ ...good, ...extra }), JSON.stringify(extra)).toBe(true);
    for (const extra of [
      { price: -500 },
      { massKg: 0 },
      { cost: 0 },
      { integrity: 9999 },
      { ammo: 99 },
    ])
      expect(refused(withPart(extra)), JSON.stringify(extra)).toBe(true);
  });

  it('refuses negative, non-finite and non-numeric values', () => {
    for (const value of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      '3',
      null,
      1e9,
      -1e9,
      [1],
      {},
    ])
      for (const key of ['offsetX', 'offsetY'])
        expect(refused(withPart({ [key]: value })), `${key}=${String(value)}`).toBe(true);
    for (const turns of [4, -1, 1.5, '1', null, Number.NaN, 90])
      expect(refused(withPart({ rotationQuarterTurns: turns })), `turns=${String(turns)}`).toBe(
        true,
      );
    for (const slot of [2, -1, 0.5, '0', true, null])
      expect(refused(withPart({ assignedActionSlot: slot })), `slot=${String(slot)}`).toBe(true);
    for (const auto of [1, 'true', null]) expect(refused(withPart({ autoMode: auto }))).toBe(true);
    for (const version of [0, 2, '1', 1.5, null, undefined])
      expect(refused({ ...good, formatVersion: version }), `format=${String(version)}`).toBe(true);
  });

  it('refuses ids, names and dates outside their closed character sets', () => {
    for (const id of [
      'Engine Four',
      'engine-v6',
      'ENGINE_V6',
      '../etc/passwd',
      'a'.repeat(49),
      '',
      7,
      null,
      'engine_v6\n',
    ])
      for (const key of ['chassisId', 'engineId', 'tireKitId', 'paintId'])
        expect(refused({ ...good, [key]: id }), `${key}=${String(id)}`).toBe(true);
    for (const id of ['Part One', 'weapon/mg', '', 5]) {
      expect(refused(withPart({ partId: id }))).toBe(true);
      expect(refused(withPart({ mountId: id }))).toBe(true);
    }
    for (const id of ['', 'a b', 'x'.repeat(25), '<p1>', 5])
      expect(refused(withPart({ instanceId: id }))).toBe(true);
    for (const name of [
      '',
      ' ',
      ' Leading',
      'Trailing ',
      '<script>alert(1)</script>',
      '"quoted"',
      'a/b',
      'semi;colon',
      'back`tick',
      'x'.repeat(25),
      'emoji \u{1F3CE}',
      'new\nline',
      5,
      null,
    ])
      expect(refused({ ...good, name }), `name=${String(name)}`).toBe(true);
    for (const name of [
      'A',
      'Mk 2',
      "Dad's Car",
      'No. 7!',
      'R&D #4',
      'Wait... what?',
      'x'.repeat(24),
    ])
      expect(refused({ ...good, name }), name).toBe(false);
    for (const createdAt of [
      'yesterday',
      '',
      '2026-13-45T99:99:99Z<script>',
      12345,
      null,
      'x'.repeat(41),
    ])
      expect(refused({ ...good, createdAt }), `createdAt=${String(createdAt)}`).toBe(true);
    for (const catalogVersion of ['', 'v 1', '1.0.0<', 'x'.repeat(25), 3])
      expect(refused({ ...good, catalogVersion })).toBe(true);
  });

  it('cleans a typed name into the allowed set', () => {
    expect(sanitizeBlueprintName('  <b>Speedy</b>  ')).toBe('bSpeedyb');
    expect(sanitizeBlueprintName('Mk   2')).toBe('Mk 2');
    expect(sanitizeBlueprintName('<<<>>>')).toBe('My Car');
    expect(sanitizeBlueprintName('x'.repeat(60))).toHaveLength(24);
    expect(
      blueprintSchema.shape.name.safeParse(sanitizeBlueprintName('"; DROP TABLE cars')).success,
    ).toBe(true);
  });

  it('refuses oversized payloads and things that are not blueprints at all', () => {
    const many = {
      ...good,
      parts: Array.from({ length: MAX_BLUEPRINT_PARTS + 1 }, (_, i) => ({
        ...good.parts[0],
        instanceId: `p${i}`,
      })),
    };
    expect(refused(many)).toBe(true);
    expect(refused('x'.repeat(MAX_BLUEPRINT_BYTES + 1))).toBe(true);
    expect(refused({ ...good, padding: 'x'.repeat(MAX_BLUEPRINT_BYTES) })).toBe(true);
    expect(refused(JSON.stringify(good) + ' '.repeat(MAX_BLUEPRINT_BYTES))).toBe(true);
    const circular: Record<string, unknown> = { ...good };
    circular.self = circular;
    for (const junk of [
      null,
      undefined,
      0,
      1,
      true,
      'not json',
      '{"half":',
      [],
      [good],
      () => good,
      circular,
      10n,
      Symbol('x'),
    ])
      expect(refused(junk), String(typeof junk)).toBe(true);
    expect(refused({ ...good, parts: 'none' })).toBe(true);
    expect(refused({ ...good, parts: [null] })).toBe(true);
    const { engineId: _engine, ...noEngine } = good;
    expect(refused(noEngine)).toBe(true);
  });

  it('treats prototype-polluting keys and ids as unknown, and leaves prototypes alone', () => {
    const polluted = JSON.parse(
      `{"__proto__":{"polluted":true},${serializeBlueprint(ROOKIE_BLUEPRINT).slice(1)}`,
    ) as unknown;
    expect(validateUntrustedBlueprint(polluted, CATALOG).ok).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    for (const id of [
      '__proto__',
      'constructor',
      'to_string',
      'has_own_property',
      'prototype',
      'value_of',
    ]) {
      for (const slot of ['chassisId', 'engineId', 'tireKitId', 'paintId'] as const) {
        const result = validateUntrustedBlueprint({ ...good, [slot]: id }, CATALOG);
        expect(result.ok, `${slot}=${id}`).toBe(false);
        expect(
          result.issues.some((i) => i.code === 'UNKNOWN_PART' || i.code === 'MALFORMED'),
          `${slot}=${id}`,
        ).toBe(true);
      }
      const part = validateUntrustedBlueprint(withPart({ partId: id }), CATALOG);
      expect(part.ok).toBe(false);
      const mount = validateUntrustedBlueprint(withPart({ mountId: id }), CATALOG);
      expect(mount.ok).toBe(false);
    }
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
  });
});

describe('validateBlueprint: essentials, budget and catalog (Sections 6.1 and 10.3)', () => {
  it('names an unknown chassis, engine, wheel kit or paint', () => {
    for (const slot of ['chassisId', 'engineId', 'tireKitId', 'paintId'] as const) {
      const result = check({ ...BASELINE_BLUEPRINT, [slot]: 'part_from_nowhere' });
      expect(result.ok).toBe(false);
      const issue = result.issues.find((i) => i.code === 'UNKNOWN_PART')!;
      expect(issue.slot).toBe(slot.replace('Id', '').replace('tireKit', 'tires'));
      expect(issue.partId).toBe('part_from_nowhere');
    }
  });

  it('says what is missing when a mandatory slot holds something that is not that kind of part', () => {
    for (const [slot, wrong] of [
      ['engineId', 'tires_street'],
      ['tireKitId', 'engine_v6'],
      ['chassisId', 'weapon_front_mg'],
      ['engineId', 'utility_fan'],
    ] as const) {
      const result = check({ ...BASELINE_BLUEPRINT, [slot]: wrong });
      expect(result.ok).toBe(false);
      const issue = result.issues.find((i) => i.code === 'MISSING_ESSENTIAL')!;
      expect(issue, `${slot}=${wrong}`).toBeDefined();
      expect(issue.message).toBe('Your car needs an engine and a complete set of wheels.');
    }
  });

  it('refuses a blueprint built against another catalog version', () => {
    const result = check({ ...ROOKIE_BLUEPRINT, catalogVersion: '0.2.0' });
    expect(errorCodes(result)).toEqual(['CATALOG_MISMATCH']);
    expect(result.issues[0]!.message).toBe(
      'This build uses older part values. Review it before racing.',
    );
    expect(result.issues[0]!.detail).toEqual({ blueprint: '0.2.0', catalog: CATALOG_VERSION });
    // And against a catalog that has moved on, the same blueprint is the stale one.
    expect(
      errorCodes(validateBlueprint(ROOKIE_BLUEPRINT, { ...CATALOG, version: '9.0.0' })),
    ).toEqual(['CATALOG_MISMATCH']);
  });

  it('never lets a car over 1,000 credits through, counting from catalog prices only', () => {
    // Pickup 185 + V12 290 + Full Tracks 190 = 665, then expensive parts until it tips over.
    const rich = car(
      'chassis_pickup',
      [
        { partId: 'weapon_mortar', mountId: 'bed_rear', autoMode: true },
        { partId: 'defense_antimissile', mountId: 'roof_cab' },
        { partId: 'utility_radar', mountId: 'bed_front' },
      ],
      { engineId: 'engine_v12', tireKitId: 'tires_track' },
    );
    const result = check(rich);
    expect(result.totalCost).toBe(185 + 290 + 190 + 175 + 160 + 45);
    expect(errorCodes(result)).toContain('NOT_ENOUGH_CREDITS');
    const issue = result.issues.find((i) => i.code === 'NOT_ENOUGH_CREDITS')!;
    expect(issue.message).toBe('Not enough credits');
    expect(issue.detail).toEqual({ totalCost: 1045, budget: 1000, over: 45 });
    expect(result.creditsLeft).toBe(-45);
    // Exactly 1,000 is legal: 185 + 290 + 190 + 175 + 160.
    const exact = car(
      'chassis_pickup',
      [
        { partId: 'weapon_mortar', mountId: 'bed_rear', autoMode: true },
        { partId: 'defense_antimissile', mountId: 'roof_cab' },
      ],
      { engineId: 'engine_v12', tireKitId: 'tires_track' },
    );
    expect(check(exact).totalCost).toBe(1000);
    expect(errorCodes(check(exact))).not.toContain('NOT_ENOUGH_CREDITS');
  });

  it('prices six-wheel and three-wheel cars with the adjusted wheel kit', () => {
    expect(check(car('chassis_spider')).totalCost).toBe(235 + 140 + 120);
    expect(check(car('chassis_trike', [], { engineId: 'engine_four_cylinder' })).totalCost).toBe(
      120 + 140 + 60,
    );
    expect(check(car('chassis_spider', [], { tireKitId: 'tires_sand' })).totalCost).toBe(
      235 + 140 + 188,
    );
  });

  it('reports duplicate instance ids and unknown part ids on the instance at fault', () => {
    const twice = car('chassis_beetle', [
      { partId: 'utility_fan', mountId: 'left_utility', instanceId: 'same' },
      { partId: 'utility_repair', mountId: 'right_utility', instanceId: 'same' },
    ]);
    const duplicate = check(twice);
    expect(errorCodes(duplicate)).toEqual(['DUPLICATE_INSTANCE']);
    expect(duplicate.issues[0]!.instanceId).toBe('same');
    const ghost = check(
      car('chassis_beetle', [{ partId: 'weapon_death_ray', mountId: 'roof_mid' }]),
    );
    expect(errorCodes(ghost)).toEqual(['UNKNOWN_PART']);
    expect(ghost.issues[0]).toMatchObject({
      instanceId: 't1',
      partId: 'weapon_death_ray',
      mountId: 'roof_mid',
    });
    // A chassis, engine or wheel kit id is not something you can bolt to a mount.
    for (const id of ['engine_v8', 'tires_slick', 'chassis_trike'])
      expect(
        errorCodes(check(car('chassis_beetle', [{ partId: id, mountId: 'roof_mid' }]))),
      ).toEqual(['UNKNOWN_PART']);
  });

  it('gives every issue a known code, player copy and a pointer to what is wrong', () => {
    const mess = car('chassis_trike', [
      { partId: 'defense_heavy_plate', mountId: 'front_center' },
      { partId: 'weapon_mortar', mountId: 'roof_mid' },
      { partId: 'nope', mountId: 'roof_mid' },
      { partId: 'utility_fan', mountId: 'engine_bay' },
      { partId: 'utility_fan', mountId: 'nowhere' },
    ]);
    const result = check(mess);
    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeGreaterThanOrEqual(4);
    for (const issue of result.issues) {
      expect(BLUEPRINT_ISSUE_CODES).toContain(issue.code);
      expect(issue.message.length).toBeGreaterThan(0);
      expect(['error', 'warning']).toContain(issue.severity);
    }
    // Stable order: validating twice gives the same list.
    expect(check(mess).issues).toEqual(result.issues);
    expect(Object.keys(BLUEPRINT_ISSUE_COPY).sort()).toEqual([...BLUEPRINT_ISSUE_CODES].sort());
  });
});

describe('validateBlueprint: every hardpoint (Section 19.1)', () => {
  const cases = CHASSIS_LIST.flatMap((chassis) =>
    accessoryMounts(chassis).map((mount) => ({
      chassis,
      mount,
      name: `${chassis.displayName} ${mount.id}`,
    })),
  );

  it('covers every accessory mount of every chassis', () => {
    expect(cases).toHaveLength(
      // Beetle, Arrow, Pickup, Spider, Trike.
      5 + 4 + 6 + 8 + 4,
    );
  });

  it.each(cases)(
    '$name: accepts a fitting part, each allowed rotation, and offsets inside its region',
    ({ chassis, mount }) => {
      const { part, turn } = probeFor(mount);
      const at = (patch: Partial<BlueprintPart>) =>
        check(
          car(chassis.id, [
            { partId: part.id, mountId: mount.id, rotationQuarterTurns: turn, ...patch },
          ]),
        );
      const centred = at({});
      expect(centred.issues, `${part.id} at rotation ${turn}`).toEqual([]);
      expect(centred.ok).toBe(true);

      // Facing: every turn the part may take here is accepted, every other turn is refused.
      // Room does not depend on the turn asked for.
      for (const candidate of [0, 1, 2, 3] as QuarterTurn[]) {
        const result = at({ rotationQuarterTurns: candidate });
        const allowed = allowedRotations(mount, part).includes(candidate);
        const size = occupiedFootprint(part, candidate);
        const fits = size.w <= mount.maxFootprint.w && size.h <= mount.maxFootprint.h;
        expect(errorCodes(result).includes('BAD_ROTATION'), `rotation ${candidate}`).toBe(!allowed);
        expect(errorCodes(result).includes('PART_TOO_LARGE'), `rotation ${candidate}`).toBe(!fits);
        if (allowed && fits) expect(result.ok, `rotation ${candidate}`).toBe(true);
      }

      // Bounded offset: the corners of the region are inside it, one pixel further is not.
      for (const [sx, sy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [-1, -1],
      ] as const) {
        const inside = at({ offsetX: sx * mount.regionHalfW, offsetY: sy * mount.regionHalfH });
        expect(errorCodes(inside), `offset ${sx},${sy}`).not.toContain('OUT_OF_REGION');
        // Nudged to the edge a part may come too close to a wheel, and nothing else.
        expect(
          errorCodes(inside).filter((c) => c !== 'OVERLAPS_WHEEL'),
          `offset ${sx},${sy}`,
        ).toEqual([]);
        const outside = at({
          offsetX: sx * (mount.regionHalfW + 1),
          offsetY: sy * (mount.regionHalfH + 1),
        });
        expect(errorCodes(outside), `offset beyond ${sx},${sy}`).toContain('OUT_OF_REGION');
        expect(outside.issues.find((i) => i.code === 'OUT_OF_REGION')).toMatchObject({
          instanceId: 't1',
          mountId: mount.id,
        });
      }

      // Slot overlap: a second copy on the same spot is refused, one way or another.
      const doubled = check(
        car(chassis.id, [
          { partId: part.id, mountId: mount.id, rotationQuarterTurns: turn },
          { partId: part.id, mountId: mount.id, rotationQuarterTurns: turn },
        ]),
      );
      expect(doubled.ok).toBe(false);
      expect(
        errorCodes(doubled).some((c) => c === 'MOUNT_OCCUPIED' || c === 'PART_BLOCKS_ANOTHER'),
      ).toBe(true);
      const blocked = doubled.issues.find(
        (i) => i.code === 'MOUNT_OCCUPIED' || i.code === 'PART_BLOCKS_ANOTHER',
      )!;
      expect(blocked.instanceId).toBe('t2');
      expect(blocked.otherInstanceId).toBe('t1');
    },
  );

  it('refuses sockets that do not exist, the engine bay, and parts of the wrong kind', () => {
    const nowhere = check(car('chassis_beetle', [{ partId: 'utility_fan', mountId: 'roof_rear' }]));
    expect(errorCodes(nowhere)).toEqual(['UNKNOWN_MOUNT']);
    expect(nowhere.issues[0]).toMatchObject({
      instanceId: 't1',
      mountId: 'roof_rear',
      message: 'No compatible mount',
    });
    // A mount id from another chassis is still not a mount on this one.
    expect(
      errorCodes(check(car('chassis_beetle', [{ partId: 'utility_fan', mountId: 'rear_boom' }]))),
    ).toEqual(['UNKNOWN_MOUNT']);
    expect(
      errorCodes(check(car('chassis_beetle', [{ partId: 'utility_fan', mountId: 'engine_bay' }]))),
    ).toEqual(['NO_COMPATIBLE_MOUNT']);
    // A side saw only mounts on a side; the Beetle has none, and its roof will not do.
    const saw = check(car('chassis_beetle', [{ partId: 'weapon_saw', mountId: 'roof_mid' }]));
    expect(errorCodes(saw)).toEqual(['NO_COMPATIBLE_MOUNT']);
    expect(saw.issues[0]!.message).toBe('No compatible mount');
    // Plates need an armor-capable mount.
    expect(
      errorCodes(
        check(car('chassis_beetle', [{ partId: 'defense_light_plate', mountId: 'roof_mid' }])),
      ),
    ).toEqual(['NO_COMPATIBLE_MOUNT']);
    expect(
      check(car('chassis_beetle', [{ partId: 'defense_light_plate', mountId: 'front_center' }])).ok,
    ).toBe(true);
  });

  it('refuses a part that is too large for its mount, with the sizes', () => {
    const mortar = check(
      car('chassis_beetle', [{ partId: 'weapon_mortar', mountId: 'roof_mid', autoMode: true }]),
    );
    expect(errorCodes(mortar)).toEqual(['PART_TOO_LARGE']);
    expect(mortar.issues[0]!.detail).toEqual({ w: 16, h: 16, maxW: 14, maxH: 14 });
    // A part the player aims stands on a square base, the smaller side of its footprint, and
    // its barrel may reach past the mount. The 8 x 18 railgun therefore goes on the Beetle's
    // 16 x 12 hood as well as the Arrow's spine; before catalog 0.5.0 only the spine took it.
    for (const [chassisId, mountId] of [
      ['chassis_beetle', 'front_center'],
      ['chassis_arrow', 'roof_mid'],
    ] as const)
      expect(
        check(car(chassisId, [{ partId: 'weapon_railshot', mountId, assignedActionSlot: 0 }])).ok,
        chassisId,
      ).toBe(true);
    // A machine gun on an 8-wide flank pod may face out, forward or back: its base is 8 x 8
    // whichever way it points, so no turn is ever too large.
    const pod = CHASSIS.chassis_spider!.mounts.find((m) => m.id === 'right_front')!;
    expect(pod.maxFootprint).toEqual({ w: 8, h: 14 });
    for (const turn of [0, 1, 2] as QuarterTurn[])
      expect(
        check(
          car('chassis_spider', [
            {
              partId: 'weapon_front_mg',
              mountId: 'right_front',
              rotationQuarterTurns: turn,
              assignedActionSlot: 0,
            },
          ]),
        ).ok,
        `turn ${turn}`,
      ).toBe(true);
    // A part with a fixed facing takes its footprint as it lies: the 14 x 5 Crash Bumper is
    // too wide for the Trike's 10-wide nose.
    const bumper = check(
      car('chassis_trike', [{ partId: 'defense_front_bumper', mountId: 'front_center' }]),
    );
    expect(errorCodes(bumper)).toContain('PART_TOO_LARGE');
    expect(bumper.issues.find((i) => i.code === 'PART_TOO_LARGE')!.detail).toEqual({
      w: 14,
      h: 5,
      maxW: 10,
      maxH: 14,
    });
  });

  it('refuses a part pointed back across the cabin, and one that cannot turn at all', () => {
    // A front mount will not take a gun facing the driver; a right mount will not take one
    // facing left across the car.
    expect(
      errorCodes(
        check(
          car('chassis_beetle', [
            {
              partId: 'weapon_front_mg',
              mountId: 'front_center',
              rotationQuarterTurns: 2,
              assignedActionSlot: 0,
            },
          ]),
        ),
      ),
    ).toEqual(['BAD_ROTATION']);
    expect(
      check(
        car('chassis_beetle', [
          { partId: 'weapon_rear_mg', mountId: 'rear_center', rotationQuarterTurns: 2 },
        ]),
      ).ok,
    ).toBe(true);
    expect(
      errorCodes(
        check(
          car('chassis_beetle', [
            { partId: 'weapon_rear_mg', mountId: 'rear_center', rotationQuarterTurns: 0 },
          ]),
        ),
      ),
    ).toEqual(['BAD_ROTATION']);
    // Parts for which orientation means nothing must stay at rotation 0.
    for (const turn of [1, 2, 3] as QuarterTurn[])
      expect(
        errorCodes(
          check(
            car('chassis_beetle', [
              { partId: 'utility_radar', mountId: 'roof_mid', rotationQuarterTurns: turn },
            ]),
          ),
        ),
      ).toEqual(['BAD_ROTATION']);
  });

  it('keeps parts clear of the wheels', () => {
    // The Beetle's sill pods sit between the axles; pushed forward a part reaches the wheel.
    const mount = CHASSIS.chassis_beetle!.mounts.find((m) => m.id === 'left_utility')!;
    expect(
      check(car('chassis_beetle', [{ partId: 'utility_nitro', mountId: 'left_utility' }])).ok,
    ).toBe(true);
    const nudged = check(
      car('chassis_beetle', [
        { partId: 'utility_nitro', mountId: 'left_utility', offsetY: -mount.regionHalfH },
      ]),
    );
    expect(errorCodes(nudged)).toEqual(['OVERLAPS_WHEEL']);
    expect(nudged.issues[0]).toMatchObject({
      instanceId: 't1',
      mountId: 'left_utility',
      detail: { wheelId: 'front_left' },
    });
    const back = check(
      car('chassis_beetle', [
        { partId: 'utility_nitro', mountId: 'left_utility', offsetY: mount.regionHalfH },
      ]),
    );
    expect(back.issues[0]).toMatchObject({
      code: 'OVERLAPS_WHEEL',
      detail: { wheelId: 'rear_left' },
    });
  });

  it('keeps two pixels between parts on neighbouring mounts', () => {
    // Spider roof mounts are in a row two pixels apart. Each part fits on its own.
    const row = (offsetFront: number, offsetMid: number) =>
      check(
        car('chassis_spider', [
          { partId: 'utility_nitro', mountId: 'roof_front', offsetY: offsetFront },
          {
            partId: 'weapon_turret',
            mountId: 'roof_mid',
            offsetY: offsetMid,
            assignedActionSlot: 0,
          },
        ]),
      );
    expect(row(0, 0).ok).toBe(true);
    const squeezed = row(2, -2);
    expect(errorCodes(squeezed)).toEqual(['PART_BLOCKS_ANOTHER']);
    // The turret is the victim, so the highlight goes on the part in its way, in the words
    // Section 6.6 gives for exactly this case.
    expect(squeezed.issues[0]).toMatchObject({
      instanceId: 't1',
      otherInstanceId: 't2',
      message: TURRET_BLOCKED_COPY,
    });
    // Between two ordinary parts the general line is used.
    const plain = check(
      car('chassis_spider', [
        { partId: 'utility_nitro', mountId: 'roof_front', offsetY: 2 },
        { partId: 'utility_radar', mountId: 'roof_mid', offsetY: -2 },
      ]),
    );
    expect(plain.issues.find((i) => i.code === 'PART_BLOCKS_ANOTHER')!.message).toBe(
      'This part blocks another attachment.',
    );
  });

  it('lets small parts share a rack and gives a large part the whole hardpoint (Section 6.6)', () => {
    const rack = (parts: Array<[string, number]>) =>
      check(
        car(
          'chassis_pickup',
          parts.map(([partId, offsetX]) => ({
            partId,
            mountId: 'bed_front',
            offsetX,
            ...(partId === 'weapon_front_mg' ? { assignedActionSlot: 0 as const } : {}),
          })),
        ),
      );
    // A small weapon beside a radar: allowed.
    expect(
      rack([
        ['weapon_front_mg', -5],
        ['utility_radar', 5],
      ]).issues,
    ).toEqual([]);
    // The same two on top of each other: they collide.
    expect(
      errorCodes(
        rack([
          ['weapon_front_mg', 0],
          ['utility_radar', 0],
        ]),
      ),
    ).toEqual(['PART_BLOCKS_ANOTHER']);
    // A third small part: the rack holds two.
    const three = rack([
      ['utility_fan', -5],
      ['utility_radar', 5],
      ['utility_repair', 0],
    ]);
    expect(errorCodes(three)).toContain('MOUNT_OCCUPIED');
    expect(three.issues.find((i) => i.code === 'MOUNT_OCCUPIED')).toMatchObject({
      mountId: 'bed_front',
      message: 'This mount is full.',
    });
    // A large jump jack occupies the full rack.
    expect(CATALOG.parts.utility_jump!.hardpointUse).toBe('full');
    expect(rack([['utility_jump', 0]]).ok).toBe(true);
    expect(
      errorCodes(
        rack([
          ['utility_jump', 0],
          ['utility_radar', 5],
        ]),
      ),
    ).toContain('MOUNT_OCCUPIED');
    // An ordinary mount holds one part however small.
    const single = check(
      car('chassis_beetle', [
        { partId: 'utility_radar', mountId: 'roof_mid', offsetX: -2 },
        { partId: 'utility_repair', mountId: 'roof_mid', offsetX: 2 },
      ]),
    );
    expect(errorCodes(single)).toContain('MOUNT_OCCUPIED');
  });

  it('enforces the weight cap of every chassis, counting installed mass and not the frame', () => {
    for (const chassis of CHASSIS_LIST) {
      // The frame alone, with the default engine and street tires, is always within its limits.
      const bare = check(baselineBlueprint({ chassisId: chassis.id }));
      expect(bare.ok, chassis.id).toBe(true);
      expect(bare.loadKg, chassis.id).toBeLessThan(chassis.recommendedLoadKg);
      // The same parts against a catalog where this frame's limit is one kilogram too low.
      const tight = {
        ...CATALOG,
        chassis: {
          ...CATALOG.chassis,
          [chassis.id]: { ...chassis, maxLoadKg: Math.ceil(bare.loadKg) - 1 },
        },
      };
      const over = validateBlueprint(baselineBlueprint({ chassisId: chassis.id }), tight);
      expect(errorCodes(over), chassis.id).toEqual(['TOO_HEAVY']);
      expect(over.issues[0]).toMatchObject({ message: 'Too much weight', hint: OVERWEIGHT_HINT });
      const exact = {
        ...CATALOG,
        chassis: {
          ...CATALOG.chassis,
          [chassis.id]: { ...chassis, maxLoadKg: Math.ceil(bare.loadKg) },
        },
      };
      expect(
        validateBlueprint(baselineBlueprint({ chassisId: chassis.id }), exact).ok,
        chassis.id,
      ).toBe(true);
    }
    // A real overweight car: a Trike (maximum 460 kg) under a V12, tracks and two heavy parts.
    const heavy = check(
      car(
        'chassis_trike',
        [
          { partId: 'weapon_hammer', mountId: 'front_center' },
          { partId: 'utility_jump', mountId: 'left_rear' },
        ],
        { engineId: 'engine_twin', tireKitId: 'tires_track' },
      ),
    );
    expect(errorCodes(heavy)).toContain('TOO_HEAVY');
    const issue = heavy.issues.find((i) => i.code === 'TOO_HEAVY')!;
    expect(issue.detail!.loadKg).toBe(190 + (210 * 3) / 4 + 90 + 100);
    expect(issue.detail!.maxLoadKg).toBe(460);
    expect(issue.detail!.overKg).toBe(190 + 157.5 + 190 - 460);
  });
});

describe('validateBlueprint: per-car limits (Sections 6.1, 8.3, 11.5 and 11.7)', () => {
  it('allows one of each unique part', () => {
    const two = check(
      car('chassis_spider', [
        { partId: 'utility_gyro', mountId: 'rear_utility' },
        { partId: 'utility_gyro', mountId: 'roof_front' },
      ]),
    );
    expect(errorCodes(two)).toEqual(['ONE_PER_CAR']);
    expect(two.issues[0]).toMatchObject({
      instanceId: 't2',
      message: 'One per car',
      detail: { limit: 1 },
    });
    const unique = Object.values(CATALOG.parts).filter((p) => p.maxPerCar === 1);
    expect(unique.length).toBeGreaterThan(25);
    for (const part of unique) {
      // Two copies in the Pickup's bed, which takes any part.
      const pair = check(
        car('chassis_pickup', [
          { partId: part.id, mountId: 'bed_rear' },
          { partId: part.id, mountId: 'bed_front' },
        ]),
      );
      expect(errorCodes(pair), part.id).toContain('ONE_PER_CAR');
    }
  });

  it('allows one spare wheel, two repair kits, and three repair units in all', () => {
    const kits = (count: number, spare: boolean) =>
      check(
        car('chassis_pickup', [
          ...['left_bed', 'right_bed', 'bed_front']
            .slice(0, count)
            .map((mountId) => ({ partId: 'utility_repair', mountId })),
          ...(spare ? [{ partId: 'utility_spare', mountId: 'bed_rear' }] : []),
        ]),
      );
    expect(kits(2, true).ok).toBe(true);
    const three = kits(3, false);
    expect(errorCodes(three)).toEqual(['TOO_MANY_REPAIR_ITEMS']);
    expect(three.issues[0]!.message).toBe('A car can carry one spare wheel and two repair kits.');
    expect(errorCodes(kits(3, true))).toContain('TOO_MANY_REPAIR_ITEMS');
    const spares = check(
      car('chassis_pickup', [
        { partId: 'utility_spare', mountId: 'bed_rear' },
        { partId: 'utility_spare', mountId: 'bed_front' },
      ]),
    );
    expect(errorCodes(spares)).toEqual(['ONE_PER_CAR']);
    expect(CATALOG.parts.utility_spare!.maxPerCar).toBe(1);
    expect(CATALOG.parts.utility_repair!.maxPerCar).toBe(2);
  });

  it('allows six offensive modules and no more, whatever the mounts allow', () => {
    // Rear Sentries are automatic, so no fire-button rule gets in the way. A Pickup has room
    // for seven: two share the rack, and the rails and tailgate point theirs backward.
    const spots: Array<[string, QuarterTurn, number]> = [
      ['bed_front', 0, -5],
      ['bed_front', 0, 5],
      ['bed_rear', 0, 0],
      ['left_bed', 2, 0],
      ['right_bed', 2, 0],
      ['rear_center', 2, 0],
      ['roof_cab', 0, 0],
    ];
    const guns = (count: number) =>
      check(
        car(
          'chassis_pickup',
          spots.slice(0, count).map(([mountId, turn, offsetX]) => ({
            partId: 'weapon_rear_mg',
            mountId,
            offsetX,
            rotationQuarterTurns: turn,
          })),
          { engineId: 'engine_mini_electric', tireKitId: 'tires_micro' },
        ),
      );
    expect(guns(6).issues).toEqual([]);
    const seven = guns(7);
    expect(seven.totalCost).toBeLessThanOrEqual(STARTING_CREDITS);
    expect(errorCodes(seven)).toEqual(['TOO_MANY_WEAPONS']);
    // Parts are judged in canonical order (by mount), so the seventh there is the one flagged.
    const last = canonicalizeBlueprint(
      car(
        'chassis_pickup',
        spots.map(([mountId]) => ({ partId: 'weapon_rear_mg', mountId })),
      ),
    ).parts[6]!;
    expect(seven.issues[0]).toMatchObject({
      instanceId: last.instanceId,
      mountId: last.mountId,
      detail: { limit: 6 },
    });
  });

  it('allows two fire buttons, one weapon each, and warns about weapons left without one', () => {
    const three = (slots: Array<0 | 1 | undefined>) =>
      check(
        car(
          'chassis_pickup',
          (
            [
              ['bed_front', -5],
              ['bed_front', 5],
              ['bed_rear', 0],
            ] as const
          ).map(([mountId, offsetX], i) => ({
            partId: 'weapon_front_mg',
            mountId,
            offsetX,
            rotationQuarterTurns: 0 as QuarterTurn,
            ...(slots[i] !== undefined ? { assignedActionSlot: slots[i] } : {}),
          })),
        ),
      );
    // Two on buttons, the third inactive: legal, with an explicit warning before Ready.
    const legal = three([0, 1, undefined]);
    expect(legal.ok).toBe(true);
    expect(warningCodes(legal)).toEqual(['WEAPON_INACTIVE']);
    expect(legal.issues[0]).toMatchObject({ severity: 'warning', instanceId: 't3' });
    // Two weapons on the same button is a third manual weapon by another name.
    const clash = three([0, 0, 1]);
    expect(errorCodes(clash)).toEqual(['TOO_MANY_MANUAL_WEAPONS']);
    const issue = clash.issues.find((i) => i.code === 'TOO_MANY_MANUAL_WEAPONS')!;
    expect(issue.detail).toEqual({ limit: 2, slot: 0 });
    expect([issue.instanceId, issue.otherInstanceId].sort()).toEqual(['t1', 't2']);
    expect(issue.message).toBe('Only two weapons can have a fire button.');
  });

  it('gives fire buttons only to manual and hybrid weapons, and automatic mode only to hybrids', () => {
    const one = (partId: string, mountId: string, patch: Partial<BlueprintPart>) =>
      check(car('chassis_pickup', [{ partId, mountId, ...patch }]));
    expect(errorCodes(one('weapon_tesla', 'bed_rear', { assignedActionSlot: 0 }))).toEqual([
      'BAD_ACTION_SLOT',
    ]);
    expect(errorCodes(one('utility_nitro', 'bed_rear', { assignedActionSlot: 1 }))).toEqual([
      'BAD_ACTION_SLOT',
    ]);
    expect(errorCodes(one('defense_energy_shield', 'bed_rear', { assignedActionSlot: 0 }))).toEqual(
      ['BAD_ACTION_SLOT'],
    );
    expect(errorCodes(one('weapon_front_mg', 'bed_rear', { autoMode: true }))).toContain(
      'BAD_AUTO_MODE',
    );
    expect(errorCodes(one('utility_fan', 'bed_rear', { autoMode: true }))).toEqual([
      'BAD_AUTO_MODE',
    ]);
    // A hybrid can take a button or run itself, not both.
    expect(one('weapon_turret', 'bed_rear', { assignedActionSlot: 1 }).issues).toEqual([]);
    expect(one('weapon_turret', 'bed_rear', { autoMode: true }).issues).toEqual([]);
    expect(
      errorCodes(one('weapon_turret', 'bed_rear', { assignedActionSlot: 1, autoMode: true })),
    ).toEqual(['BAD_AUTO_MODE']);
    expect(warningCodes(one('weapon_turret', 'bed_rear', {}))).toEqual(['WEAPON_INACTIVE']);
    // Automatic weapons need nothing.
    expect(one('weapon_tesla', 'bed_rear', {}).issues).toEqual([]);
  });
});

describe('validateBlueprint: chassis specials', () => {
  it('lets the Pickup bed take any weapon, however large or wherever it normally goes', () => {
    const bed = CHASSIS.chassis_pickup!.mounts.find((m) => m.id === 'bed_rear')!;
    for (const weapon of Object.values(CATALOG.parts).filter((p) => p.category === 'weapon')) {
      const fire = weapon.triggerMode === 'automatic' ? {} : { assignedActionSlot: 0 as const };
      // The railgun is longer than the bed is deep and lies across it.
      const turn = fittingRotation(bed, weapon);
      expect(turn, weapon.id).not.toBeNull();
      const result = check(
        car('chassis_pickup', [
          { partId: weapon.id, mountId: 'bed_rear', rotationQuarterTurns: turn!, ...fire },
        ]),
      );
      expect(result.issues, weapon.id).toEqual([]);
    }
    // The mortar goes nowhere else on the frame, and nowhere at all on the other four.
    for (const mountId of ['roof_cab', 'bed_front', 'left_bed', 'rear_center'])
      expect(
        errorCodes(
          check(car('chassis_pickup', [{ partId: 'weapon_mortar', mountId, autoMode: true }])),
        ).length,
        mountId,
      ).toBeGreaterThan(0);
    expect(
      errorCodes(
        check(
          car('chassis_beetle', [
            { partId: 'weapon_mortar', mountId: 'front_center', autoMode: true },
          ]),
        ),
      ),
    ).toContain('NO_COMPATIBLE_MOUNT');
    // The ordinary mounts of the Pickup still take only their own kind.
    expect(
      errorCodes(
        check(car('chassis_pickup', [{ partId: 'utility_solar', mountId: 'rear_center' }])),
      ),
    ).toEqual(['NO_COMPATIBLE_MOUNT']);
  });

  it('never lets a side gun point back across the cabin', () => {
    // The Spider has the only side mounts. A gun on the right may face out, forward or back.
    for (const turn of [0, 1, 2] as QuarterTurn[])
      expect(
        check(
          car('chassis_spider', [
            {
              partId: 'weapon_rear_mg',
              mountId: 'right_front',
              rotationQuarterTurns: turn,
            },
          ]),
        ).issues.filter((i) => i.code === 'BAD_ROTATION'),
        `turn ${turn}`,
      ).toEqual([]);
    expect(
      errorCodes(
        check(
          car('chassis_spider', [
            { partId: 'weapon_tesla', mountId: 'right_front' },
            {
              partId: 'weapon_front_mg',
              mountId: 'left_front',
              rotationQuarterTurns: 1,
              assignedActionSlot: 0,
            },
          ]),
        ),
      ),
    ).toContain('BAD_ROTATION');
  });

  it('gives the Pickup rack room for two small parts and the bed floor to one large one', () => {
    const bed = check(
      car('chassis_pickup', [
        { partId: 'utility_generator', mountId: 'bed_front', offsetX: -5 },
        { partId: 'utility_battery', mountId: 'bed_front', offsetX: 5 },
        { partId: 'utility_nitro', mountId: 'bed_rear' },
        { partId: 'utility_jump', mountId: 'bed_rear' },
      ]),
    );
    // Two small utilities share the rack; the bed floor holds one part, however small.
    expect(errorCodes(bed)).toContain('MOUNT_OCCUPIED');
    expect(
      check(
        car('chassis_pickup', [
          { partId: 'utility_jump', mountId: 'bed_rear' },
          { partId: 'utility_generator', mountId: 'bed_front', offsetX: -5 },
          { partId: 'utility_battery', mountId: 'bed_front', offsetX: 5 },
        ]),
      ).issues,
    ).toEqual([]);
  });

  it('limits armor to the same share of the load limit on every frame', () => {
    expect(armorLimitKg(CHASSIS.chassis_beetle!)).toBe(Math.round(730 * 0.45));
    expect(armorLimitKg(CHASSIS.chassis_arrow!)).toBe(Math.round(600 * 0.45));
    expect(armorLimitKg(CHASSIS.chassis_pickup!)).toBe(Math.round(1200 * 0.45));
    expect(armorLimitKg(CHASSIS.chassis_spider!)).toBe(Math.round(1050 * 0.45));
    expect(armorLimitKg(CHASSIS.chassis_trike!)).toBe(Math.round(460 * 0.45));
    // The Beetle carries two heavy plates (290 kg of 329) but not a third piece.
    const beetle = (extra: boolean) =>
      check(
        car('chassis_beetle', [
          { partId: 'defense_heavy_plate', mountId: 'front_center' },
          { partId: 'defense_heavy_plate', mountId: 'rear_center', rotationQuarterTurns: 2 },
          ...(extra ? [{ partId: 'defense_breakaway', mountId: 'roof_mid' }] : []),
        ]),
      );
    expect(beetle(false).ok).toBe(true);
    const tooMuch = beetle(true);
    expect(errorCodes(tooMuch)).toEqual(['TOO_MUCH_ARMOR']);
    expect(tooMuch.issues[0]).toMatchObject({
      instanceId: 't3',
      detail: { armorKg: 351, limitKg: 329 },
    });
    // The same three pieces are within the allowance of a Pickup.
    expect(
      errorCodes(
        check(
          car('chassis_pickup', [
            { partId: 'defense_heavy_plate', mountId: 'bed_rear' },
            { partId: 'defense_heavy_plate', mountId: 'rear_center', rotationQuarterTurns: 2 },
            { partId: 'defense_breakaway', mountId: 'roof_cab' },
          ]),
        ),
      ),
    ).toEqual([]);
  });
});
