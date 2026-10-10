import { CATALOG, TIRES, TIRE_LIST, baselineBlueprint } from '@bolt/content';
import type { RaceEnvironment, SurfaceId, VehicleParams, WeatherId } from '@bolt/shared';
import {
  MAX_COMBINED_GRIP,
  SHOULDER_GRIP_FACTOR,
  SIM_DT,
  SURFACE_GRIP,
  SURFACE_IDS,
  WEATHER_IDS,
  WET_WEATHER,
  aggregateModifiers,
  resolveBlueprint,
  surfaceGrip,
} from '@bolt/shared';
import { describe, expect, it } from 'vitest';
import { stepSteer } from '../feel/handling.js';
import {
  CLEAR,
  FULL,
  RAIN,
  gripOn,
  rig,
  sprint,
  statsOf,
  stoppingDistance,
  withTires,
} from '../helpers/rig.js';

/**
 * Section 11.4: twenty wheel kits. For each one: dry and wet grip on asphalt against the
 * published tables, and its specialised surface or weather behaviour, measured in the
 * simulator (the grip the integrator reports, stopping distances, top speeds, wall strikes).
 */

// Transcribed from Section 11.4: clear-weather asphalt grip.
const SPEC_GRIP: Record<string, number> = {
  tires_slick: 1.22,
  tires_street: 1.0,
  tires_rain: 0.96,
  tires_sand: 0.86,
  tires_mud: 0.86,
  tires_snow: 0.92,
  tires_ice: 0.87,
  tires_soft: 1.15,
  tires_hard: 0.94,
  tires_drift: 0.92,
  tires_armored: 0.9,
  tires_solid: 0.88,
  tires_balloon: 0.85,
  tires_monster: 0.91,
  tires_micro: 1.03,
  tires_halftrack: 0.83,
  tires_track: 0.78,
  tires_magnetic: 0.91,
  tires_adaptive: 1.02,
  tires_blades: 0.93,
};
// Transcribed from Section 9.2: asphalt grip in clear weather and in rain.
const ASPHALT_CLEAR = 1.0;
const ASPHALT_RAIN = 0.73;
/** Wet-weather factors named in Section 11.4. Every other kit has none. */
const SPEC_WET: Record<string, number> = { tires_slick: 0.75, tires_rain: 1.35 };
/**
 * Adaptive Tires give one fifth of the best specialist bonus for each terrain and for wet
 * weather. The specialist bonuses are the ones transcribed from Section 11.4.
 */
const SPEC_BEST_BONUS: Partial<Record<SurfaceId, number>> = {
  sand: 0.55,
  mud: 0.55,
  snow: 0.48,
  ice: 0.58,
  metal: 0.45,
  dirt: 0.35,
};
const SPEC_BEST_WET_BONUS = 0.35;
const adaptive = (surface: SurfaceId, wet: boolean) =>
  (1 + 0.2 * (SPEC_BEST_BONUS[surface] ?? 0)) * (wet ? 1 + 0.2 * SPEC_BEST_WET_BONUS : 1);

/**
 * The same car on Street Tires: this kit's mass, braking and rolling terms with the street
 * kit's grip and no powered tire effect. Comparing against it isolates the rubber.
 */
function streetTwin(params: VehicleParams): VehicleParams {
  const street = withTires('tires_street');
  return {
    ...params,
    tireGrip: street.tireGrip,
    tireSurfaceGrip: street.tireSurfaceGrip,
    tireWetGripFactor: street.tireWetGripFactor,
    tireDryGrip: street.tireDryGrip,
    tireWetSurfaceGrip: street.tireWetSurfaceGrip,
    power: { ...params.power, consumers: [] },
  };
}

const env = (weather: WeatherId): RaceEnvironment => ({
  weather,
  wetness: WET_WEATHER[weather] ? 1 : 0,
});
const totalsOf = (tireKitId: string) =>
  aggregateModifiers(resolveBlueprint(baselineBlueprint({ tireKitId }), CATALOG)!);

describe.each(TIRE_LIST)('$displayName', (kit) => {
  const params = withTires(kit.id);
  const street = streetTwin(params);

  it('has its table grip on dry asphalt and the right grip in the rain, in the simulator', () => {
    const dry = SPEC_GRIP[kit.id]! * ASPHALT_CLEAR;
    const wet =
      SPEC_GRIP[kit.id]! *
      ASPHALT_RAIN *
      (SPEC_WET[kit.id] ?? 1) *
      (kit.id === 'tires_adaptive' ? adaptive('asphalt', true) : 1);
    expect(gripOn(params, CLEAR, 'asphalt')).toBeCloseTo(dry, 9);
    expect(gripOn(params, RAIN, 'asphalt')).toBeCloseTo(wet, 9);
    // More grip stops shorter: the ordering against Street Tires holds on the road itself.
    const d = (p: VehicleParams, e: RaceEnvironment) => stoppingDistance(p, e, 'asphalt');
    if (dry > 1.005) expect(d(params, CLEAR)).toBeLessThan(d(street, CLEAR));
    if (dry < 0.995) expect(d(params, CLEAR)).toBeGreaterThan(d(street, CLEAR));
    if (wet > ASPHALT_RAIN * 1.005) expect(d(params, RAIN)).toBeLessThan(d(street, RAIN));
    if (wet < ASPHALT_RAIN * 0.995) expect(d(params, RAIN)).toBeGreaterThan(d(street, RAIN));
    // Rain is never better than dry on the same rubber.
    expect(d(params, RAIN)).toBeGreaterThan(d(params, CLEAR));
  });

  it('follows the Section 9.2 table on every surface in every weather, within the cap', () => {
    const totals = totalsOf(kit.id);
    for (const weather of WEATHER_IDS) {
      for (const surface of SURFACE_IDS) {
        const table = SURFACE_GRIP[weather][surface];
        let expected =
          table *
          totals.grip[surface] *
          (WET_WEATHER[weather] ? totals.gripWet[surface] : totals.gripDry[surface]);
        if (kit.id === 'tires_magnetic' && surface === 'metal') expected *= 1.45;
        if (kit.id === 'tires_adaptive') expected *= adaptive(surface, WET_WEATHER[weather]);
        const got = surfaceGrip(params, env(weather), surface, false);
        expect(got, `${weather} ${surface}`).toBeCloseTo(Math.min(MAX_COMBINED_GRIP, expected), 9);
        expect(got).toBeGreaterThan(0);
        expect(got).toBeLessThanOrEqual(MAX_COMBINED_GRIP);
      }
    }
  });
});

describe('wheel kit specialities (Section 11.4)', () => {
  const p = (id: string) => withTires(id);
  const twin = (id: string) => streetTwin(p(id));
  const g = (id: string, e: RaceEnvironment, s: SurfaceId) => gripOn(p(id), e, s);
  const others = (id: string) => TIRE_LIST.filter((t) => t.id !== id).map((t) => t.id);

  it('Slicks: the most dry grip there is, and a 25% penalty in the rain', () => {
    expect(g('tires_slick', CLEAR, 'asphalt')).toBe(
      Math.max(...TIRE_LIST.map((t) => g(t.id, CLEAR, 'asphalt'))),
    );
    expect(g('tires_slick', RAIN, 'asphalt') / (1.22 * 0.73)).toBeCloseTo(0.75, 9);
    // In the rain it is worse than plain Street Tires, which it beats handily in the dry.
    expect(g('tires_slick', RAIN, 'asphalt')).toBeLessThan(g('tires_street', RAIN, 'asphalt'));
    expect(stoppingDistance(p('tires_slick'), RAIN, 'asphalt')).toBeGreaterThan(
      stoppingDistance(twin('tires_slick'), RAIN, 'asphalt') * 1.05,
    );
    for (const weather of ['heavy_rain', 'snowfall'] as const)
      expect(
        surfaceGrip(p('tires_slick'), env(weather), 'asphalt', false) /
          (1.22 * SURFACE_GRIP[weather].asphalt),
      ).toBeCloseTo(0.75, 9);
    for (const weather of ['clear', 'sandstorm', 'dry_heat', 'clear_frost'] as const)
      expect(
        surfaceGrip(p('tires_slick'), env(weather), 'asphalt', false) /
          SURFACE_GRIP[weather].asphalt,
      ).toBeCloseTo(1.22, 9);
  });

  it('Street Tires: the consistent baseline, exactly the published table', () => {
    for (const weather of WEATHER_IDS)
      for (const surface of SURFACE_IDS)
        expect(surfaceGrip(p('tires_street'), env(weather), surface, false)).toBe(
          SURFACE_GRIP[weather][surface],
        );
    expect(TIRES.tires_street!.modifiers).toHaveLength(2);
  });

  it('Rain Runners: 35% more grip in the rain, the best wet-road kit', () => {
    expect(g('tires_rain', RAIN, 'asphalt') / (0.96 * 0.73)).toBeCloseTo(1.35, 9);
    expect(g('tires_rain', RAIN, 'asphalt')).toBe(
      Math.max(...TIRE_LIST.map((t) => g(t.id, RAIN, 'asphalt'))),
    );
    expect(g('tires_rain', CLEAR, 'asphalt')).toBeLessThan(g('tires_street', CLEAR, 'asphalt'));
    // In the simulator: a much shorter stop on a wet road than the same car on Street Tires.
    expect(stoppingDistance(p('tires_rain'), RAIN, 'asphalt')).toBeLessThan(
      stoppingDistance(twin('tires_rain'), RAIN, 'asphalt') * 0.85,
    );
  });

  it.each([
    ['tires_sand', 'sand', 1.55],
    ['tires_mud', 'mud', 1.55],
    ['tires_snow', 'snow', 1.48],
  ] as const)('%s: %s grip x%s, and it rolls freely there', (id, surface, factor) => {
    expect(g(id, CLEAR, surface) / (SPEC_GRIP[id]! * SURFACE_GRIP.clear[surface])).toBeCloseTo(
      factor,
      9,
    );
    // Its own surface is where it leads the whole catalog, apart from kits that share it.
    const rivals = TIRE_LIST.filter(
      (t) => t.id !== id && !(surface === 'mud' && t.id === 'tires_track'),
    );
    for (const rival of rivals)
      expect(g(id, CLEAR, surface), rival.id).toBeGreaterThan(g(rival.id, CLEAR, surface));
    // On any other surface it is an ordinary, slightly loose tire.
    expect(g(id, CLEAR, 'asphalt')).toBeLessThan(g('tires_street', CLEAR, 'asphalt'));
    // In the simulator: a shorter stop than the same car on street rubber, and, because it
    // rolls freely there, a higher top speed than Street Tires manage on that surface.
    expect(stoppingDistance(p(id), CLEAR, surface)).toBeLessThan(
      stoppingDistance(twin(id), CLEAR, surface) * 0.9,
    );
    expect(sprint(p(id), CLEAR, surface).topMph).toBeGreaterThan(
      sprint(p('tires_street'), CLEAR, surface).topMph * 1.05,
    );
  });

  it('Ice Spikes: 58% more grip on ice, and a friction penalty on pavement', () => {
    expect(g('tires_ice', CLEAR, 'ice') / (0.87 * 0.29)).toBeCloseTo(1.58, 9);
    for (const id of others('tires_ice'))
      expect(g('tires_ice', CLEAR, 'ice'), id).toBeGreaterThan(g(id, CLEAR, 'ice'));
    expect(stoppingDistance(p('tires_ice'), CLEAR, 'ice')).toBeLessThan(
      stoppingDistance(twin('tires_ice'), CLEAR, 'ice') * 0.8,
    );
    // The studs drag on asphalt: slower flat out than a kit of similar mass, but not on ice.
    const onRoad = sprint(p('tires_ice'));
    const similar = sprint(p('tires_snow'));
    expect(onRoad.topMph).toBeLessThan(similar.topMph - 2);
    expect(onRoad.toSixty!).toBeGreaterThan(similar.toSixty! + 0.2);
    expect(p('tires_ice').rollingAdd).toEqual({ asphalt: 6, cobble: 6, metal: 6 });
    // More traction off the line on ice than the same car on street rubber.
    expect(sprint(p('tires_ice'), CLEAR, 'ice').distance2s).toBeGreaterThan(
      sprint(twin('tires_ice'), CLEAR, 'ice').distance2s * 1.15,
    );
  });

  it('Soft Compound: 15% more grip that wears away after 90 seconds', () => {
    // Grip under the car after the tires have done a given number of seconds of driving.
    const after = (seconds: number) => {
      const r = rig(p('tires_soft'));
      r.state.velocityX = -150;
      r.state.tireWearSeconds = seconds;
      r.run(FULL, SIM_DT);
      return r.telemetry.grip;
    };
    expect(after(0)).toBeCloseTo(1.15, 9);
    expect(after(89)).toBeCloseTo(1.15, 9);
    expect(after(105)).toBeCloseTo(1.15 * (1 - (0.15 * (15 + SIM_DT)) / 30), 6);
    expect(after(120)).toBeCloseTo(1.15 * 0.85, 9);
    expect(after(170)).toBeCloseTo(1.15 * 0.85, 9);
    // Worn, it is a little worse than fresh Street Tires.
    expect(after(125)).toBeLessThan(g('tires_street', CLEAR, 'asphalt'));
    // Wear is time spent driving: it counts on the move and not on the grid.
    const driven = rig(p('tires_soft'));
    driven.run(FULL, 10);
    expect(driven.state.tireWearSeconds).toBeGreaterThan(9);
    expect(driven.state.tireWearSeconds).toBeLessThanOrEqual(10);
    const parked = rig(p('tires_soft'));
    parked.run({ steer: 0, brake: 1, coast: false }, 0.2);
    expect(parked.state.tireWearSeconds).toBe(0);
    // No other kit wears.
    for (const id of others('tires_soft')) expect(p(id).wearRampSeconds, id).toBe(0);
  });

  it('Hard Compound: wheels take 22% less damage', () => {
    expect(totalsOf('tires_hard').damage.wheel).toBeCloseTo(0.78, 9);
    const hard = statsOf(baselineBlueprint({ tireKitId: 'tires_hard' }));
    const plain = statsOf(baselineBlueprint({ tireKitId: 'tires_street' }));
    expect(hard.details.defense.effectiveHp - plain.details.defense.effectiveHp).toBeCloseTo(
      0.22 * 35,
      6,
    );
    expect(hard.scores.defense).toBeGreaterThan(plain.scores.defense);
  });

  it('Drift Rings: lets go sooner, slides further, and keeps more grip while it does', () => {
    const drift = p('tires_drift');
    const street = p('tires_street');
    expect(drift.slipRecovery).toBeCloseTo(1.14, 9);
    expect(drift.slipStiffness / street.slipStiffness).toBeCloseTo(0.6, 9);
    expect(drift.yawAlign / street.yawAlign).toBeCloseTo(1.15, 9);
    // Full lock at speed on the skid pad: a bigger slip angle, held without spinning, and the
    // car still corners.
    for (const speed of [160, 220]) {
      const a = stepSteer(drift, speed, 1);
      const b = stepSteer(street, speed, 1);
      expect(a.peakSlipDeg, `slip at ${speed}`).toBeGreaterThan(b.peakSlipDeg + 1.5);
      expect(a.peakSlipDeg, `slip at ${speed}`).toBeLessThan(22);
      expect(a.endSpeed, `speed kept at ${speed}`).toBeGreaterThan(speed * 0.95);
      expect(a.yawDeg, `yaw at ${speed}`).toBeGreaterThan(b.yawDeg * 0.75);
    }
    // Other kits leave slide behaviour alone.
    for (const id of others('tires_drift')) expect(p(id).slipRecovery, id).toBe(1);
  });

  it('Armored Tires: wheel integrity up 55%', () => {
    expect(totalsOf('tires_armored').integrity.wheels).toBeCloseTo(1.55, 9);
    expect(
      statsOf(baselineBlueprint({ tireKitId: 'tires_armored' })).scores.defense,
    ).toBeGreaterThan(statsOf(baselineBlueprint()).scores.defense + 4);
    // The weight shows on the clock.
    expect(sprint(p('tires_armored')).toSixty!).toBeGreaterThan(
      sprint(p('tires_street')).toSixty! + 0.4,
    );
  });

  it('Solid Core: puncture effects cut by 85%', () => {
    expect(totalsOf('tires_solid').damage.puncture).toBeCloseTo(0.15, 9);
    for (const id of others('tires_solid'))
      expect(totalsOf(id).damage.puncture, id).toBeUndefined();
    expect(statsOf(baselineBlueprint({ tireKitId: 'tires_solid' })).scores.defense).toBeGreaterThan(
      statsOf(baselineBlueprint()).scores.defense,
    );
  });

  /** Speed kept through a wall strike at a fixed angle and speed. */
  function wallStrike(params: VehicleParams): { kept: number; struck: boolean } {
    const r = rig(params);
    r.run(FULL, 6);
    const before = r.telemetry.speed;
    r.state.headingRad += 0.35;
    const { velocityX: vx, velocityY: vy } = r.state;
    r.state.velocityX = vx * Math.cos(0.35) - vy * Math.sin(0.35);
    r.state.velocityY = vx * Math.sin(0.35) + vy * Math.cos(0.35);
    let struck = false;
    let after = before;
    for (let i = 0; i < 240 && !struck; i++) {
      r.run(FULL, SIM_DT);
      if (r.telemetry.wallImpactSpeed > 0) {
        struck = true;
        after = r.telemetry.speed;
      }
    }
    return { kept: after / before, struck };
  }

  it('Balloon Tires: obstacle impulse down 25%', () => {
    expect(p('tires_balloon').obstacleImpulse).toBeCloseTo(0.75, 9);
    const soft = wallStrike(p('tires_balloon'));
    const plain = wallStrike(p('tires_street'));
    expect(soft.struck && plain.struck).toBe(true);
    // The same strike costs measurably less speed.
    expect(1 - soft.kept).toBeLessThan((1 - plain.kept) * 0.9);
  });

  it('Monster Wheels: at home off the road, with a higher ride', () => {
    const monster = p('tires_monster');
    expect(monster.shoulderPenalty).toBe(0);
    // No grip lost on the shoulder, where every ordinary kit loses 12 percent.
    expect(surfaceGrip(monster, CLEAR, 'dirt', true)).toBe(
      surfaceGrip(monster, CLEAR, 'dirt', false),
    );
    expect(
      surfaceGrip(p('tires_street'), CLEAR, 'dirt', true) /
        surfaceGrip(p('tires_street'), CLEAR, 'dirt', false),
    ).toBeCloseTo(SHOULDER_GRIP_FACTOR, 9);
    expect(monster.obstacleImpulse).toBeCloseTo(0.8, 9);
    for (const surface of ['sand', 'dirt', 'mud', 'snow'] as const)
      expect(monster.rollingFactor[surface]).toBeCloseTo(0.8, 9);
    expect(1 - wallStrike(monster).kept).toBeLessThan(1 - wallStrike(p('tires_street')).kept);
    // Increased ride height: less stable than the same car on Street Tires.
    const tall = statsOf(baselineBlueprint({ tireKitId: 'tires_monster' })).indicators.stability;
    const low = statsOf(baselineBlueprint()).indicators.stability;
    expect(tall.highCenterPenalty).toBe(6);
    expect(tall.score).toBeLessThan(low.score - 5);
  });

  it('Micro Wheels: 3% more road speed, and obstacles punish it', () => {
    const micro = p('tires_micro');
    expect(micro.roadSpeedFactor).toBeCloseTo(1.03, 9);
    // Same mass as the car it is compared with, so the difference is the kit alone.
    const same = { ...micro, roadSpeedFactor: 1 };
    expect(sprint(micro).topMph / sprint(same).topMph).toBeGreaterThan(1.025);
    expect(sprint(micro).topMph / sprint(same).topMph).toBeLessThan(1.035);
    // The bonus is for paved roads only.
    expect(sprint(micro, CLEAR, 'dirt').topMph).toBeCloseTo(sprint(same, CLEAR, 'dirt').topMph, 9);
    expect(micro.obstacleImpulse).toBeCloseTo(1.3, 9);
    expect(1 - wallStrike(micro).kept).toBeGreaterThan(
      (1 - wallStrike(p('tires_street')).kept) * 1.1,
    );
    expect(
      surfaceGrip(micro, CLEAR, 'asphalt', true) / surfaceGrip(micro, CLEAR, 'asphalt', false),
    ).toBeCloseTo(1 - 0.12 * 1.8, 9);
  });

  it('Half Tracks: 35% more traction on dirt and mud', () => {
    for (const surface of ['dirt', 'mud'] as const) {
      expect(
        g('tires_halftrack', CLEAR, surface) / (0.83 * SURFACE_GRIP.clear[surface]),
      ).toBeCloseTo(1.35, 9);
      expect(g('tires_halftrack', CLEAR, surface)).toBeGreaterThan(
        g('tires_street', CLEAR, surface) * 1.1,
      );
      expect(stoppingDistance(p('tires_halftrack'), CLEAR, surface)).toBeLessThan(
        stoppingDistance(twin('tires_halftrack'), CLEAR, surface),
      );
    }
    expect(g('tires_halftrack', CLEAR, 'sand') / (0.83 * SURFACE_GRIP.clear.sand)).toBeCloseTo(
      1,
      9,
    );
    expect(
      statsOf(baselineBlueprint({ tireKitId: 'tires_halftrack' })).indicators.stability
        .stabilizationBonus,
    ).toBeCloseTo(4 + 15 * (0.83 - 1), 9);
  });

  it('Full Tracks: 55% more grip in mud, and 20% off top speed on the road', () => {
    expect(g('tires_track', CLEAR, 'mud') / (0.78 * 0.52)).toBeCloseTo(1.55, 9);
    const tracks = p('tires_track');
    expect(tracks.roadSpeedFactor).toBeCloseTo(0.8, 9);
    const free = { ...tracks, roadSpeedFactor: 1 };
    const ratio = sprint(tracks).topMph / sprint(free).topMph;
    expect(ratio).toBeGreaterThan(0.79);
    expect(ratio).toBeLessThan(0.82);
    // Off the road the limit does not apply.
    expect(sprint(tracks, CLEAR, 'mud').topMph).toBeCloseTo(sprint(free, CLEAR, 'mud').topMph, 9);
    expect(stoppingDistance(tracks, CLEAR, 'mud')).toBeLessThan(
      stoppingDistance(twin('tires_track'), CLEAR, 'mud'),
    );
    expect(TIRES.tires_track!.massKg).toBe(Math.max(...TIRE_LIST.map((t) => t.massKg)));
  });

  it('Magnetic Rollers: 45% more grip on metal while it has its 5 power a second', () => {
    const magnetic = p('tires_magnetic');
    expect(magnetic.power.consumers).toEqual([
      { draw: 5, priority: 1, effect: { surfaceGrip: { metal: 0.45 } } },
    ]);
    expect(g('tires_magnetic', CLEAR, 'metal') / (0.91 * 0.97)).toBeCloseTo(1.45, 9);
    expect(g('tires_magnetic', CLEAR, 'asphalt')).toBeCloseTo(0.91, 9);
    for (const id of others('tires_magnetic'))
      expect(g('tires_magnetic', CLEAR, 'metal'), id).toBeGreaterThan(g(id, CLEAR, 'metal'));
    // Without power the magnets are dead weight: no generation, flat battery.
    const dead = { ...magnetic, power: { ...magnetic.power, generation: 0 } };
    const r = rig(dead, CLEAR, 'metal');
    r.state.batteryEnergy = 0;
    r.run(FULL, 1);
    expect(r.telemetry.grip).toBeCloseTo(0.91 * 0.97, 9);
    expect(r.telemetry.lowPower).toBe(true);
    // Half power, half the bonus.
    const half = { ...magnetic, power: { ...magnetic.power, generation: 2.5 } };
    const h = rig(half, CLEAR, 'metal');
    h.state.batteryEnergy = 0;
    h.run(FULL, 1);
    expect(h.telemetry.grip).toBeCloseTo(0.91 * 0.97 * (1 + 0.45 / 2), 9);
    expect(
      statsOf(baselineBlueprint({ tireKitId: 'tires_magnetic' })).indicators.energy.drawPerSecond,
    ).toBe(5);
  });

  it('Adaptive Tires: a fifth of every specialist bonus, for 6 power a second', () => {
    const adapt = p('tires_adaptive');
    expect(adapt.power.consumers).toHaveLength(1);
    expect(adapt.power.consumers[0]).toMatchObject({ draw: 6, priority: 1 });
    // The bonuses in the data are exactly one fifth of the best the specialist kits offer,
    // read here from those kits' own modifiers.
    const best: Partial<Record<SurfaceId, number>> = {};
    let bestWet = 0;
    for (const kit of TIRE_LIST) {
      if (kit.id === 'tires_adaptive') continue;
      for (const mod of kit.modifiers) {
        if (mod.type === 'ModifyGripBySurface' && mod.surfaces)
          for (const s of mod.surfaces) best[s] = Math.max(best[s] ?? 0, mod.factor - 1);
        if (mod.type === 'ModifyGripBySurface' && mod.when === 'wet')
          bestWet = Math.max(bestWet, mod.factor - 1);
        if (mod.type === 'ModifyPowerPriority' && mod.effect?.surfaceGrip)
          for (const [s, bonus] of Object.entries(mod.effect.surfaceGrip))
            best[s as SurfaceId] = Math.max(best[s as SurfaceId] ?? 0, bonus);
      }
    }
    expect(Object.keys(best).sort()).toEqual(Object.keys(SPEC_BEST_BONUS).sort());
    for (const surface of SURFACE_IDS)
      expect(best[surface] ?? 0, surface).toBeCloseTo(SPEC_BEST_BONUS[surface] ?? 0, 9);
    expect(bestWet).toBeCloseTo(SPEC_BEST_WET_BONUS, 9);
    const effect = adapt.power.consumers[0]!.effect;
    for (const surface of SURFACE_IDS)
      expect(effect.surfaceGrip![surface] ?? 0, surface).toBeCloseTo(0.2 * (best[surface] ?? 0), 9);
    expect(effect.wetGrip).toBeCloseTo(0.2 * bestWet, 9);
    for (const surface of SURFACE_IDS) {
      expect(g('tires_adaptive', CLEAR, surface), surface).toBeCloseTo(
        1.02 * SURFACE_GRIP.clear[surface] * adaptive(surface, false),
        9,
      );
      expect(g('tires_adaptive', RAIN, surface), surface).toBeCloseTo(
        1.02 * SURFACE_GRIP.rain[surface] * adaptive(surface, true),
        9,
      );
    }
    // Better than Street Tires everywhere off the dry road, and never as good as the
    // specialist on its own ground.
    for (const [surface, specialist] of [
      ['sand', 'tires_sand'],
      ['mud', 'tires_mud'],
      ['snow', 'tires_snow'],
      ['ice', 'tires_ice'],
      ['metal', 'tires_magnetic'],
    ] as const) {
      expect(g('tires_adaptive', CLEAR, surface), surface).toBeGreaterThan(
        g('tires_street', CLEAR, surface) * 1.08,
      );
      expect(g('tires_adaptive', CLEAR, surface), surface).toBeLessThan(
        g(specialist, CLEAR, surface),
      );
    }
    expect(g('tires_adaptive', RAIN, 'asphalt')).toBeGreaterThan(
      g('tires_street', RAIN, 'asphalt') * 1.08,
    );
    expect(g('tires_adaptive', RAIN, 'asphalt')).toBeLessThan(g('tires_rain', RAIN, 'asphalt'));
    // Unpowered it is an ordinary 1.02 tire.
    const dead = { ...adapt, power: { ...adapt.power, generation: 0 } };
    const r = rig(dead, CLEAR, 'ice');
    r.state.batteryEnergy = 0;
    r.run(FULL, 1);
    expect(r.telemetry.grip).toBeCloseTo(1.02 * 0.29, 9);
    expect(
      statsOf(baselineBlueprint({ tireKitId: 'tires_adaptive' })).indicators.energy.drawPerSecond,
    ).toBe(6);
  });

  it('Razor Wheels: contact-side damage, and less wheel integrity', () => {
    expect(totalsOf('tires_blades').integrity.wheels).toBeCloseTo(0.8, 9);
    expect(TIRES.tires_blades!.params).toMatchObject({
      contactDamage: 6,
      contactCooldownSeconds: 1.2,
    });
    for (const id of others('tires_blades'))
      expect(TIRES[id]!.params!.contactDamage, id).toBeUndefined();
    expect(statsOf(baselineBlueprint({ tireKitId: 'tires_blades' })).scores.defense).toBeLessThan(
      statsOf(baselineBlueprint()).scores.defense,
    );
  });
});
