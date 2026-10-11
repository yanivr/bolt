import {
  CATALOG,
  CHASSIS_LIST,
  EXAMPLE_TEMPLATES,
  ROOKIE_BLUEPRINT,
  TEMPLATES,
  baselineBlueprint,
  conditionsFor,
} from '@bolt/content';
import type { BuildConditions, BuildStats } from '@bolt/shared';
import {
  SURFACE_IDS,
  WEATHER_IDS,
  compareBuildStats,
  computeBuildStats,
  installPart,
  simulateStraight,
  swapEngine,
  swapTires,
} from '@bolt/shared';
import { describe, expect, it } from 'vitest';
import { car } from '../helpers/blueprints.js';
import { paramsOf, statsOf } from '../helpers/rig.js';

const DRY = conditionsFor('city_01', 'city_clear_night')!;
const WET = conditionsFor('city_01', 'city_rain_night')!;
const template = (name: string) => TEMPLATES.find((t) => t.name === name)!.blueprint;

function allNumbers(
  value: unknown,
  path = '',
  out: Array<[string, number]> = [],
): Array<[string, number]> {
  if (typeof value === 'number') out.push([path, value]);
  else if (value && typeof value === 'object')
    for (const [key, v] of Object.entries(value)) allNumbers(v, `${path}.${key}`, out);
  return out;
}

describe('computeBuildStats (Section 6.2)', () => {
  it('reports the five indicators with raw numbers, gauges, status and plain-English lines', () => {
    const stats = statsOf(ROOKIE_BLUEPRINT, DRY);
    expect(Object.keys(stats.indicators)).toEqual([
      'budget',
      'load',
      'energy',
      'heat',
      'stability',
    ]);
    for (const [name, indicator] of Object.entries(stats.indicators)) {
      expect(indicator.gauge, name).toBeGreaterThanOrEqual(0);
      expect(indicator.gauge, name).toBeLessThanOrEqual(1);
      expect(['ok', 'caution', 'over'], name).toContain(indicator.status);
      expect(indicator.lines.length, name).toBeGreaterThanOrEqual(2);
      for (const line of indicator.lines) {
        expect(line, line).toMatch(/^[A-Z0-9].*\.$/);
        expect(line, line).not.toMatch(/—|--|NaN|undefined|Infinity|\d\.\d{3,}/);
      }
    }
    expect(stats.indicators.budget).toMatchObject({
      credits: 1000,
      spent: 480,
      left: 520,
      gauge: 0.48,
      status: 'ok',
    });
    expect(stats.indicators.budget.lines).toContain('480 of 1000 credits spent, 520 left.');
    expect(stats.indicators.load).toMatchObject({
      loadKg: 95 + 48 + 26 + 37,
      recommendedKg: 460,
      maxKg: 730,
      totalMassKg: 456,
    });
    expect(stats.indicators.energy).toMatchObject({
      generationPerSecond: 10,
      batteryCapacity: 40,
      batterySeconds: null,
      status: 'ok',
    });
    expect(stats.indicators.energy.drawPerSecond).toBeCloseTo(2 / 1.4, 9);
    expect(stats.indicators.heat.productionPerSecond).toBeCloseTo(8 + 2 / 1.4, 9);
    expect(stats.indicators.heat.coolingPerSecond).toBeCloseTo(8 * 1.6, 9);
    expect(stats.indicators.stability.score).toBeGreaterThan(55);
    expect(stats.legal).toBe(true);
    expect(stats.warnings).toEqual([]);
    expect(stats.buildHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reports five whole-number scores from 0 to 100 with the measurements behind them', () => {
    for (const t of TEMPLATES) {
      for (const conditions of [DRY, WET]) {
        const stats = statsOf(t.blueprint, conditions);
        expect(Object.keys(stats.scores)).toEqual([
          'speed',
          'control',
          'defense',
          'firepower',
          'utility',
        ]);
        for (const [name, score] of Object.entries(stats.scores)) {
          expect(Number.isInteger(score), `${t.id} ${name}`).toBe(true);
          expect(score, `${t.id} ${name}`).toBeGreaterThanOrEqual(0);
          expect(score, `${t.id} ${name}`).toBeLessThanOrEqual(100);
        }
        for (const [path, value] of allNumbers(stats))
          expect(Number.isFinite(value), `${t.id}${path}`).toBe(true);
        for (const detail of Object.values(stats.details))
          for (const line of detail.lines) {
            expect(line).toMatch(/^[A-Z0-9].*\.$/);
            expect(line).not.toMatch(/—|--|NaN|undefined|Infinity/);
          }
      }
    }
  });

  it('derives Speed from the real integrator on the published surfaces and weather', () => {
    const stats = statsOf(baselineBlueprint(), DRY);
    const params = paramsOf(baselineBlueprint(), DRY);
    const env = { weather: 'clear' as const, wetness: 0 };
    const asphalt = simulateStraight(params, env, 'asphalt');
    const cobble = simulateStraight(params, env, 'cobble');
    // Neon Cut is 80 percent asphalt and 20 percent cobblestone.
    expect(stats.details.speed.topSpeedMph).toBeCloseTo(
      (0.8 * asphalt.topSpeed + 0.2 * cobble.topSpeed) * 0.3125,
      9,
    );
    expect(stats.details.speed.zeroToSixtySeconds).toBeCloseTo(
      0.8 * asphalt.zeroToSixty! + 0.2 * cobble.zeroToSixty!,
      9,
    );
    expect(asphalt.zeroToSixty).toBeCloseTo(3.97, 1);
    expect(asphalt.topSpeed * 0.3125).toBeCloseTo(84.5, 0);
    // With no surface mix published, the score assumes asphalt.
    expect(statsOf(baselineBlueprint()).details.speed.topSpeedMph).toBeCloseTo(
      asphalt.topSpeed * 0.3125,
      9,
    );
    // A car that cannot reach 60 MPH says so instead of inventing a number.
    const crawler = statsOf(
      baselineBlueprint({
        chassisId: 'chassis_spider',
        engineId: 'engine_mini_electric',
        tireKitId: 'tires_track',
      }),
      DRY,
    );
    expect(crawler.details.speed.zeroToSixtySeconds).toBeNull();
    expect(crawler.details.speed.lines).toContain('Does not reach 60 MPH on these surfaces.');
    expect(crawler.scores.speed).toBeLessThan(10);
  });

  it('ranks the example builds the way their descriptions promise', () => {
    const dry = Object.fromEntries(
      EXAMPLE_TEMPLATES.map((t) => [t.name, statsOf(t.blueprint, DRY)]),
    );
    const wet = Object.fromEntries(
      EXAMPLE_TEMPLATES.map((t) => [t.name, statsOf(t.blueprint, WET)]),
    );
    const best = (table: Record<string, BuildStats>, pick: (s: BuildStats) => number) =>
      Object.entries(table).sort((a, b) => pick(b[1]) - pick(a[1]))[0]![0];
    const worst = (table: Record<string, BuildStats>, pick: (s: BuildStats) => number) =>
      Object.entries(table).sort((a, b) => pick(a[1]) - pick(b[1]))[0]![0];
    expect(best(dry, (s) => s.scores.speed)).toBe('Straight-Line Rocket');
    expect(best(dry, (s) => s.scores.defense)).toBe('Iron Mule');
    expect(worst(dry, (s) => s.scores.speed)).toBe('Iron Mule');
    expect(best(dry, (s) => s.indicators.stability.score)).toBe('Dust Spider');
    expect(worst(dry, (s) => s.indicators.stability.score)).toBe('Tiny Trouble');
    expect(best(dry, (s) => -(s.details.speed.zeroToSixtySeconds ?? 99))).toBe('Tiny Trouble');
    // Slicks lose more Control in the rain than any other example; Rain Runners lose least.
    const controlLoss = (name: string) => dry[name]!.scores.control - wet[name]!.scores.control;
    for (const name of Object.keys(dry)) {
      if (name !== 'Straight-Line Rocket')
        expect(controlLoss('Straight-Line Rocket'), name).toBeGreaterThan(controlLoss(name));
      if (name !== 'Rain Runner')
        expect(controlLoss('Rain Runner'), name).toBeLessThan(controlLoss(name));
    }
    expect(best(wet, (s) => s.details.control.cornerGrip)).toBe('Rain Runner');
    // The electrical tradeoff is flagged for the Rain Runner and for nobody else.
    for (const [name, stats] of Object.entries(wet))
      expect(
        stats.warnings.some((w) => w.code === 'LOW_POWER'),
        name,
      ).toBe(name === 'Rain Runner');
    // The dust build belongs on sand: there it beats the same car on Street Tires in Control.
    const desert: BuildConditions = {
      weather: 'sandstorm',
      timeOfDay: 'day',
      surfaceMix: { sand: 0.7, dirt: 0.3 },
    };
    const spider = statsOf(template('Dust Spider'), desert);
    const spiderOnStreet = statsOf(swapTiresTo(template('Dust Spider'), 'tires_street'), desert);
    expect(spider.scores.control).toBeGreaterThan(spiderOnStreet.scores.control + 3);
    expect(spider.details.control.cornerGrip).toBeGreaterThan(
      spiderOnStreet.details.control.cornerGrip * 1.12,
    );
    expect(spider.scores.speed).toBeGreaterThan(spiderOnStreet.scores.speed);
  });

  function swapTiresTo(blueprint: Parameters<typeof swapTires>[0], id: string) {
    const result = swapTires(blueprint, CATALOG, id);
    if (!result.ok) throw new Error(result.issue.code);
    return result.blueprint;
  }

  it('changes with the published track and weather, as Section 6.2 requires', () => {
    const slick = baselineBlueprint({ tireKitId: 'tires_slick' });
    expect(statsOf(slick, DRY).scores.control).toBeGreaterThan(
      statsOf(slick, WET).scores.control + 15,
    );
    // Every weather and every single-surface track yields sane scores for every bare chassis.
    for (const chassis of CHASSIS_LIST) {
      const bp = baselineBlueprint({ chassisId: chassis.id });
      for (const weather of WEATHER_IDS) {
        const surface = SURFACE_IDS[(chassis.price + weather.length) % SURFACE_IDS.length]!;
        const stats = computeBuildStats(bp, CATALOG, {
          weather,
          timeOfDay: 'dusk',
          surfaceMix: { [surface]: 1 },
        })!;
        for (const [path, value] of allNumbers(stats))
          expect(Number.isFinite(value), `${chassis.id} ${weather} ${surface}${path}`).toBe(true);
        for (const score of Object.values(stats.scores)) {
          expect(score).toBeGreaterThanOrEqual(0);
          expect(score).toBeLessThanOrEqual(100);
        }
      }
    }
    // Ice is worse than asphalt for everybody.
    const onIce = statsOf(baselineBlueprint(), {
      weather: 'clear',
      timeOfDay: 'day',
      surfaceMix: { ice: 1 },
    });
    expect(onIce.scores.control).toBeLessThan(statsOf(baselineBlueprint()).scores.control - 20);
  });

  it('gives stats for drafts that are not legal yet, and says they are not', () => {
    const over = car(
      'chassis_pickup',
      [
        { partId: 'weapon_mortar', mountId: 'bed_rear', autoMode: true },
        { partId: 'defense_antimissile', mountId: 'roof_cab' },
        { partId: 'utility_radar', mountId: 'bed_front' },
      ],
      { engineId: 'engine_v12', tireKitId: 'tires_track' },
    );
    const stats = statsOf(over);
    expect(stats.legal).toBe(false);
    expect(stats.indicators.budget).toMatchObject({
      spent: 1045,
      left: -45,
      gauge: 1,
      status: 'over',
    });
    expect(stats.warnings.map((w) => w.message)).toContain('Not enough credits');
    expect(stats.issues.map((i) => i.code)).toEqual(['NOT_ENOUGH_CREDITS']);
    expect(stats.scores.firepower).toBeGreaterThan(0);
    // Unknown essentials are the one thing there are no stats for.
    expect(computeBuildStats({ ...over, engineId: 'engine_nope' }, CATALOG)).toBeNull();
    // Unknown accessories are ignored for stats and reported as issues.
    const ghost = statsOf(car('chassis_beetle', [{ partId: 'weapon_ghost', mountId: 'roof_mid' }]));
    expect(ghost.legal).toBe(false);
    expect(ghost.mass.totalKg).toBe(393);
  });
});

describe('compareBuildStats: predictive deltas (Section 6.2)', () => {
  it('shows what installing a part would do before it is installed', () => {
    const before = statsOf(ROOKIE_BLUEPRINT, DRY);
    const candidate = installPart(ROOKIE_BLUEPRINT, CATALOG, 'defense_heavy_plate');
    if (!candidate.ok) throw new Error(candidate.issue.code);
    const after = statsOf(candidate.blueprint, DRY);
    const delta = compareBuildStats(before, after);
    expect(delta.indicators.creditsLeft).toEqual({
      before: 520,
      after: 410,
      delta: -110,
      better: false,
    });
    expect(delta.indicators.loadKg).toMatchObject({ delta: 145, better: false });
    expect(delta.scores.defense.delta).toBeGreaterThan(10);
    expect(delta.scores.defense.better).toBe(true);
    expect(delta.scores.speed.delta).toBeLessThan(0);
    expect(delta.scores.speed.better).toBe(false);
    expect(delta.scores.firepower).toMatchObject({ delta: 0, better: null });
    expect(delta.newWarnings).toEqual([]);
    expect(delta.becomesIllegal).toBe(false);
    // The spend breakdown comes with the edit itself.
    expect(candidate.spend).toMatchObject({ newSpend: 110, refund: 0, creditsLeft: 410 });
  });

  it('reports warnings a change introduces and warnings it clears', () => {
    const cool = statsOf(baselineBlueprint(), DRY);
    const hotSwap = swapEngine(baselineBlueprint(), CATALOG, 'engine_twin_turbo');
    if (!hotSwap.ok) throw new Error(hotSwap.issue.code);
    const hot = statsOf(hotSwap.blueprint, DRY);
    const worse = compareBuildStats(cool, hot);
    expect(worse.newWarnings.map((w) => w.code)).toEqual(['RUNS_HOT']);
    expect(worse.indicators.heatRatio.better).toBe(false);
    expect(worse.scores.speed.better).toBe(true);
    expect(worse.clearedWarnings).toEqual([]);
    // Two radiators bring it back under the limit.
    let fixed = hotSwap.blueprint;
    for (const mountId of ['front_center', 'roof_mid']) {
      const r = installPart(fixed, CATALOG, 'utility_radiator', { mountId });
      if (!r.ok) throw new Error(r.issue.code);
      fixed = r.blueprint;
    }
    const better = compareBuildStats(hot, statsOf(fixed, DRY));
    expect(better.clearedWarnings.map((w) => w.code)).toEqual(['RUNS_HOT']);
    expect(better.indicators.heatRatio.better).toBe(true);
    expect(better.newWarnings).toEqual([]);
    // Legality changes are called out.
    const illegal = statsOf(
      { ...fixed, engineId: 'engine_v12', tireKitId: 'tires_track', chassisId: 'chassis_spider' },
      DRY,
    );
    expect(compareBuildStats(statsOf(fixed, DRY), illegal).becomesIllegal).toBe(
      statsOf(fixed, DRY).legal && !illegal.legal,
    );
    expect(compareBuildStats(illegal, statsOf(fixed, DRY)).becomesLegal).toBe(
      !illegal.legal && statsOf(fixed, DRY).legal,
    );
    // Comparing a build with itself changes nothing.
    const same = compareBuildStats(cool, cool);
    for (const d of [...Object.values(same.scores), ...Object.values(same.indicators)])
      expect(d).toMatchObject({ delta: 0, better: null });
  });

  it('is quick enough to preview every card in a part list', () => {
    const start = performance.now();
    let count = 0;
    for (const part of Object.values(CATALOG.parts)) {
      const result = installPart(ROOKIE_BLUEPRINT, CATALOG, part.id);
      if (!result.ok) continue;
      compareBuildStats(statsOf(ROOKIE_BLUEPRINT, DRY), statsOf(result.blueprint, DRY));
      count++;
    }
    const perPreview = (performance.now() - start) / count;
    expect(count).toBeGreaterThan(30);
    // A few milliseconds each on this machine; the bound is generous for slow CI.
    expect(perPreview).toBeLessThan(40);
  });
});
