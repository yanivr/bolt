import { CHASSIS, CHASSIS_BEETLE, DEFAULT_LOADOUT, ENGINES, PAINTS, STRINGS, TIRES, TIRES_STREET, resolveLoadout } from '@bolt/content';
import { STARTING_CREDITS, deriveVehicleParams, wheelKitMass, wheelKitPrice } from '@bolt/shared';
import { describe, expect, it } from 'vitest';

function allStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) allStrings(v, out);
  return out;
}

describe('catalog seed data', () => {
  it('prices the default loadout at 370 credits (Section 6.3)', () => {
    const r = resolveLoadout(DEFAULT_LOADOUT);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.totalCost).toBe(370);
      expect(r.totalCost).toBeLessThanOrEqual(STARTING_CREDITS);
      expect(r.params.massKg).toBe(250 + 95 + 48);
    }
  });

  it('adjusts wheel kit price and mass for three, four and six wheels', () => {
    expect(wheelKitPrice(TIRES_STREET, 4)).toBe(80);
    expect(wheelKitPrice(TIRES_STREET, 3)).toBe(60);
    expect(wheelKitPrice(TIRES_STREET, 6)).toBe(120);
    expect(wheelKitPrice({ ...TIRES_STREET, price: 125 }, 3)).toBe(Math.round((125 * 3) / 4));
    expect(wheelKitMass(TIRES_STREET, 6)).toBe(72);
  });

  it('gives every chassis one wheel anchor per wheel and named mounts for its bias', () => {
    for (const chassis of Object.values(CHASSIS)) {
      expect(chassis.wheelAnchors).toHaveLength(chassis.wheelCount);
      expect(new Set(chassis.wheelAnchors.map((w) => w.id)).size).toBe(chassis.wheelCount);
      expect(new Set(chassis.mounts.map((m) => m.id)).size).toBe(chassis.mounts.length);
      expect(chassis.mounts.some((m) => m.categories.includes('ENGINE'))).toBe(true);
      expect(chassis.maxLoadKg).toBeGreaterThan(chassis.recommendedLoadKg);
      expect(chassis.wheelAnchors.some((w) => w.steers)).toBe(true);
      for (const w of chassis.wheelAnchors) {
        expect(Math.abs(w.x)).toBeLessThanOrEqual(chassis.bodyHalfWidth + 4);
        expect(Math.abs(w.y)).toBeLessThanOrEqual(chassis.bodyHalfLength);
      }
    }
    expect(CHASSIS_BEETLE.mounts.filter((m) => !m.categories.includes('ENGINE'))).toHaveLength(5);
    expect(CHASSIS_BEETLE.price).toBe(150);
    expect(CHASSIS_BEETLE.recommendedLoadKg).toBe(460);
    expect(CHASSIS_BEETLE.maxLoadKg).toBe(730);
  });

  it('rejects unknown and prototype-polluting part ids', () => {
    for (const bad of ['chassis_nope', '__proto__', 'constructor', 'toString', '']) {
      expect(resolveLoadout({ ...DEFAULT_LOADOUT, chassisId: bad }).ok).toBe(false);
      expect(resolveLoadout({ ...DEFAULT_LOADOUT, engineId: bad }).ok).toBe(false);
      expect(resolveLoadout({ ...DEFAULT_LOADOUT, tireKitId: bad }).ok).toBe(false);
      expect(resolveLoadout({ ...DEFAULT_LOADOUT, paintId: bad }).ok).toBe(false);
    }
  });

  it('derives coefficients from catalog data only', () => {
    for (const chassis of Object.values(CHASSIS)) {
      for (const engine of Object.values(ENGINES)) {
        for (const tires of Object.values(TIRES)) {
          const p = deriveVehicleParams(chassis, engine, tires);
          for (const v of Object.values(p)) if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
          expect(p.colliderRadius + p.colliderOffset).toBeCloseTo(chassis.bodyHalfLength, 6);
        }
      }
    }
    expect(Object.keys(PAINTS).length).toBeGreaterThanOrEqual(2);
  });
});

describe('player-facing copy (Section 18)', () => {
  const copy = [
    ...allStrings(STRINGS),
    ...Object.values(CHASSIS).flatMap((c) => [c.displayName, c.description, c.drawback]),
    ...Object.values(ENGINES).flatMap((c) => [c.displayName, c.description, c.drawback]),
    ...Object.values(TIRES).flatMap((c) => [c.displayName, c.description, c.drawback]),
  ];

  it('uses the approved lines exactly', () => {
    expect(STRINGS.tagline).toBe('Build smart. Drive hard.');
    expect(STRINGS.home.raceAi).toBe('Race AI');
    expect(STRINGS.race.go).toBe('GO!');
    expect(STRINGS.race.leaveConfirm).toBe("Leave this race? You won't be able to finish it.");
    expect(STRINGS.connection.lost).toBe('Connection lost. Trying to bring you back...');
    expect(STRINGS.race.pauseNote).toBe('The race keeps going while this menu is open.');
    expect(STRINGS.race.steerHint).toBe('Drag to steer. Pull down to brake.');
  });

  it('has no em dashes, double hyphens or promotional filler', () => {
    for (const line of copy) {
      expect(line).not.toMatch(/—|–|--/);
      expect(line.toLowerCase()).not.toMatch(/unleash|next-level|epic|ultimate/);
      expect(line.trim()).toBe(line);
      expect(line.length).toBeGreaterThan(0);
    }
  });
});
