import {
  CATALOG,
  DEFAULT_LOADOUT,
  TRACKS,
  WEATHER_PRESETS,
  environmentFor,
  getTrack,
  getWeatherPreset,
  resolveLoadout,
} from '@bolt/content';
import type { RaceEnvironment, TrackRuntime, VehicleParams } from '@bolt/shared';
import {
  COOLING_MULTIPLIER,
  CORNER_SIGNS,
  MAX_COMBINED_GRIP,
  SIM_DT,
  SURFACE_GRIP,
  SURFACE_IDS,
  WIND,
  buildTrack,
  checkTrack,
  createDriveSession,
  createDriverScratch,
  createGround,
  createLocation,
  createProgress,
  crossingClosed,
  driveCenterline,
  groundAt,
  gustFactor,
  hazardActive,
  hazardClock,
  lapPosition,
  locate,
  sampleBranch,
  scheduleState,
  stepDriveSession,
  updateProgress,
  windAccel,
} from '@bolt/shared';
import { describe, expect, it } from 'vitest';
import { cityFingerprints } from '../helpers/fingerprint.js';
import { makeOpenField } from '../helpers/openField.js';
import { driveDefaultCar } from '../helpers/trackDrive.js';

/**
 * Track format 2 (docs/TRACK_API.md): the migration of Neon Cut, the validator on all eight
 * tracks, the weather table, wind, every hazard, shortcut credit, off-road, the cost of the
 * ground lookup, and the default car's race time on every track.
 */

function defaultParams(tireKitId = DEFAULT_LOADOUT.tireKitId): VehicleParams {
  const r = resolveLoadout({ ...DEFAULT_LOADOUT, tireKitId });
  if (!r.ok) throw new Error('loadout must resolve');
  return r.params;
}

function track(id: string): TrackRuntime {
  return buildTrack(getTrack(id)!);
}

describe('Neon Cut moved to format 2 without a change', () => {
  it('has the same runtime, the same driving and the same race, bit for bit', () => {
    // Recorded on the format-1 build before any track code changed (tests/helpers/fingerprint.ts).
    expect(cityFingerprints()).toEqual({
      track: '3b58a9e7f808292416a8cf5f303bfecd1042f24ee89a2a02d21b48afcc334a35',
      drive: 'b7064b847f3a3b825c8ffbacd58bd3178ec6b117e2201bba735265c071ea3505',
      rain: 'f890f53ea1fd83524fb3828b5b7a0611219f25cc26ec625265e99a27f74248f4',
      race: '00c98f0189e650cf4f096420a43b94ed2f86120dd759ba30d5af3ac9f2bc3bb3',
    });
  });
});

describe('the eight launch tracks of Section 9.1', () => {
  const TABLE: Array<[string, string, string, Record<string, number>, [string, string]]> = [
    ['city_01', 'Neon Cut', 'city', { asphalt: 0.8, cobble: 0.2 }, ['Clear Night', 'Rainy Night']],
    ['city_02', 'Backstreet Blitz', 'city', { asphalt: 0.6, cobble: 0.4 }, ['Clear', 'Rain']],
    ['desert_01', 'Dust Devil', 'desert', { asphalt: 0.45, sand: 0.55 }, ['Clear', 'Crosswind']],
    [
      'desert_02',
      'Canyon Switch',
      'desert',
      { asphalt: 0.65, sand: 0.35 },
      ['Dry Heat', 'Sandstorm'],
    ],
    ['forest_01', 'Moss Run', 'forest', { asphalt: 0.5, dirt: 0.3, mud: 0.2 }, ['Clear', 'Rain']],
    [
      'forest_02',
      'Timber Dash',
      'forest',
      { asphalt: 0.45, dirt: 0.45, mud: 0.1 },
      ['Clear', 'Heavy Rain'],
    ],
    [
      'snow_01',
      'Whiteout Pass',
      'snow',
      { snow: 0.55, ice: 0.25, asphalt: 0.2 },
      ['Clear Frost', 'Snowfall'],
    ],
    [
      'industrial_01',
      'Steel Circuit',
      'industrial',
      { metal: 0.45, asphalt: 0.4, cobble: 0.15 },
      ['Dry Night', 'Factory Rain'],
    ],
  ];

  it('ships exactly the table, in its order, with its weather and surfaces', () => {
    expect(Object.keys(TRACKS)).toEqual(TABLE.map((row) => row[0]));
    for (const [id, name, biome, mix, weathers] of TABLE) {
      const def = getTrack(id)!;
      expect(def.name).toBe(name);
      expect(def.biome).toBe(biome);
      expect(def.surfaceMix).toEqual(mix);
      expect(def.weatherPresetIds.map((p) => getWeatherPreset(p)!.displayName)).toEqual(weathers);
      expect(def.formatVersion).toBe(2);
      expect(def.laps).toBe(3);
    }
  });

  it.each(Object.keys(TRACKS))('%s passes every rule of the validator', (id) => {
    const check = checkTrack(track(id));
    expect(check.issues).toEqual([]);
    expect(check.passed).toHaveLength(15);
  });

  it.each(Object.keys(TRACKS))(
    '%s: the default car finishes inside its length class, signs on time',
    (id) => {
      const def = getTrack(id)!;
      const target = def.lengthClass === 'short' ? 105 : 130;
      const run = driveDefaultCar(track(id), def.weatherPresetIds[0]!);
      expect(run.finished).toBe(true);
      expect(Math.abs(run.raceSeconds - target) / target).toBeLessThanOrEqual(0.1);
      expect(run.wallStrikes).toBe(0);
      for (const lead of run.signLeads) {
        if (lead.seconds === null) continue;
        expect(lead.seconds).toBeGreaterThanOrEqual(CORNER_SIGNS.leadMin - 1e-9);
        expect(lead.seconds).toBeLessThanOrEqual(CORNER_SIGNS.leadMax + 1e-9);
      }
      // The second weather is slower or about the same, and still finishes.
      const other = driveDefaultCar(track(id), def.weatherPresetIds[1]!);
      expect(other.finished).toBe(true);
      expect(other.raceSeconds).toBeLessThan(180);
    },
  );

  it('has four short and four long courses', () => {
    const classes = Object.values(TRACKS).map((t) => t.lengthClass);
    expect(classes.filter((c) => c === 'short')).toHaveLength(4);
    expect(classes.filter((c) => c === 'long')).toHaveLength(4);
  });
});

describe('weather (Section 9.2)', () => {
  it('uses the grip and cooling table exactly', () => {
    const table: Record<string, number[]> = {
      clear: [1.0, 0.87, 0.61, 0.82, 0.52, 0.48, 0.29, 0.97, 1.0],
      rain: [0.73, 0.61, 0.58, 0.65, 0.4, 0.43, 0.25, 0.72, 1.18],
      heavy_rain: [0.63, 0.52, 0.54, 0.56, 0.34, 0.4, 0.23, 0.65, 1.25],
      sandstorm: [0.91, 0.85, 0.55, 0.71, 0.47, 0.46, 0.28, 0.89, 0.94],
      dry_heat: [1.0, 0.88, 0.57, 0.8, 0.5, 0.5, 0.31, 0.98, 0.78],
      snowfall: [0.66, 0.55, 0.58, 0.61, 0.37, 0.42, 0.24, 0.65, 1.15],
      clear_frost: [0.75, 0.65, 0.6, 0.69, 0.4, 0.52, 0.28, 0.77, 1.08],
    };
    for (const [weather, row] of Object.entries(table)) {
      const grip = SURFACE_GRIP[weather as keyof typeof SURFACE_GRIP];
      expect(SURFACE_IDS.map((s) => grip[s])).toEqual(row.slice(0, 8));
      expect(COOLING_MULTIPLIER[weather as keyof typeof COOLING_MULTIPLIER]).toBe(row[8]);
    }
  });

  it('gives every preset the table row, a temperature, rain, wetness, wind and visibility', () => {
    for (const preset of Object.values(WEATHER_PRESETS)) {
      expect(preset.cooling).toBe(COOLING_MULTIPLIER[preset.weather]);
      expect(preset.ambientTempC).toBeGreaterThan(-20);
      expect(preset.ambientTempC).toBeLessThan(50);
      for (const v of [preset.rainIntensity, preset.wetness, preset.visibility])
        expect(v >= 0 && v <= 1).toBe(true);
      expect(Number.isFinite(preset.windX) && Number.isFinite(preset.windY)).toBe(true);
      const env = environmentFor(preset.id)!;
      expect(env.windX).toBe(preset.windX);
      expect(env.windY).toBe(preset.windY);
    }
    expect(getWeatherPreset('desert_crosswind')!.weather).toBe('clear');
    expect(getWeatherPreset('industrial_dry_night')!.timeOfDay).toBe('night');
    expect(getWeatherPreset('industrial_factory_rain')!.weather).toBe('rain');
  });

  it('caps tire specialization on top of the table (a magnetic car on a magnetic strip)', () => {
    const t = track('industrial_01');
    const strip = t.def.hazards.find((h) => h.kind === 'magnetic_strip')!;
    const routed = t.routeHazards.find((r) => t.hazards[r.hazard] === strip)!;
    const p = sampleBranch(t.main, routed.s + routed.length / 2);
    const env = environmentFor('industrial_dry_night')!;
    const grips = ['tires_magnetic', 'tires_street'].map((kit) => {
      const params = defaultParams(kit);
      const session = createDriveSession(t, env, params);
      session.phase = 'RACING';
      session.countdownTicks = 0;
      Object.assign(session.motion, {
        x: p.x,
        y: p.y,
        headingRad: Math.atan2(p.tx, -p.ty),
        velocityX: p.tx * 60,
        velocityY: p.ty * 60,
      });
      stepDriveSession(session, { steer: 0, brake: 0, coast: false });
      return session.telemetry.grip;
    });
    // Metal 0.97, rollers 0.91 x 1.45, the strip 1.25: over the cap, so held at it.
    expect(0.97 * 0.91 * 1.45 * 1.25).toBeGreaterThan(MAX_COMBINED_GRIP);
    expect(grips[0]).toBeCloseTo(MAX_COMBINED_GRIP, 9);
    expect(grips[1]).toBeCloseTo(0.97, 9);
  });
});

describe('wind on exposed bodies and airborne projectiles', () => {
  it('pushes a reference car across with the chosen magnitude', () => {
    const params = { ...defaultParams(), massKg: 393 };
    const out = { x: 0, y: 0 };
    windAccel(params, { weather: 'clear', wetness: 0, windX: 0, windY: 70 }, 1, Math.PI / 2, out);
    // Heading east, the wind from the north is all across the car.
    expect(out.y).toBeCloseTo(70 * WIND.bodyGain, 9);
    expect(out.x).toBeCloseTo(0, 9);
    windAccel(params, { weather: 'clear', wetness: 0, windX: 70, windY: 0 }, 1, Math.PI / 2, out);
    expect(out.x).toBeCloseTo(70 * WIND.bodyGain * WIND.alongShare, 9);
    windAccel(params, { weather: 'clear', wetness: 0, windX: 0, windY: 70 }, 0, Math.PI / 2, out);
    expect(out.x === 0 && out.y === 0).toBe(true);
  });

  const drive = (exposure: number, env: RaceEnvironment) => {
    const t = buildTrack(makeOpenField({ windExposure: exposure }));
    const session = createDriveSession(t, env, defaultParams());
    for (let i = 0; i < 30 * 7; i++)
      stepDriveSession(session, { steer: 0, brake: 0, coast: false });
    return session.motion;
  };

  it('drifts a car on an exposed field and leaves a sheltered one exactly alone', () => {
    const still: RaceEnvironment = { weather: 'clear', wetness: 0 };
    const windy: RaceEnvironment = { weather: 'clear', wetness: 0, windX: 0, windY: 70 };
    const calm = drive(1, still);
    const blown = drive(1, windy);
    const sheltered = drive(0, windy);
    // Driving west, a wind toward +y pushes the car toward +y.
    expect(blown.y - calm.y).toBeGreaterThan(3);
    expect(sheltered).toEqual(drive(0, still));
  });

  it('carries a bullet sideways, and a lobbed shell lands where the telegraph says', async () => {
    const { duel } = await import('../helpers/combat.js');
    const shoot = (windY: number, exposure: number) => {
      const d = duel({ parts: [{ id: 'weapon_front_mg', fire: 0 }] }, undefined, { ahead: 180 });
      d.race.env = { ...d.race.env, windX: 0, windY };
      d.race.track = buildTrack({
        ...makeOpenField({ windExposure: exposure }),
        id: `wind_${exposure}`,
      });
      d.fire(0);
      const p = d.race.projectiles.find((q) => q.active)!;
      return p.syncVy;
    };
    const drift = shoot(70, 1) - shoot(0, 1);
    expect(drift).toBeCloseTo(70 * WIND.projectileGain * SIM_DT, 9);
    expect(shoot(70, 0)).toBe(shoot(0, 0));
  });
});

describe('environment hazards: fixed timetables and their effects', () => {
  it('reads a timetable the same way every time', () => {
    const s = { periodSeconds: 10, offsetSeconds: 2, warnSeconds: 1.5, activeSeconds: 2 };
    expect(scheduleState(s, 0).phase).toBe('active');
    expect(scheduleState(s, 2).phase).toBe('idle');
    expect(scheduleState(s, 2 + 6.4).phase).toBe('idle');
    expect(scheduleState(s, 2 + 6.6).phase).toBe('warning');
    expect(scheduleState(s, 2 + 8.1).phase).toBe('active');
    expect(scheduleState(s, 12).phase).toBe('idle');
    expect(scheduleState(s, 2 + 6.6).secondsLeft).toBeCloseTo(1.4, 9);
  });

  it('closes the Signal Street crossing on its timetable, with warning first, and it stops a car', () => {
    const t = track('city_02');
    const index = t.crossings[0]!;
    const h = t.hazards[index]!;
    if (h.kind !== 'crossing') throw new Error('expected a crossing');
    const ticks = Array.from({ length: 30 * 28 }, (_, k) => k);
    const closed = ticks.filter((k) => crossingClosed(t, index, k));
    // 2.6 s down in every 14 s.
    expect(closed.length / ticks.length).toBeCloseTo(2.6 / 14, 1);
    for (const k of closed) expect(hazardActive(h, k)).toBe(true);
    // Every closing is preceded by 1.6 s of warning (the second closing: the race starts in a warning).
    const first = closed.find((k) => k > 100 && !crossingClosed(t, index, k - 1))!;
    expect(scheduleState(h.schedule, (first - 1) * SIM_DT).phase).toBe('warning');
    expect(scheduleState(h.schedule, (first - 47) * SIM_DT).phase).toBe('warning');
    expect(scheduleState(h.schedule, (first - 50) * SIM_DT).phase).toBe('idle');

    // A car rolling at the barrier: blocked while it is down, through when it is up.
    const env = environmentFor('city_clear_day')!;
    const runAt = (clock: number) => {
      const session = createDriveSession(t, env, defaultParams());
      session.phase = 'RACING';
      session.countdownTicks = 0;
      session.raceTicks = clock;
      const loc = createLocation();
      const mx = (h.a.x + h.b.x) / 2;
      const my = (h.a.y + h.b.y) / 2;
      locate(t, mx, my, loc);
      const p = sampleBranch(t.main, loc.s - 80);
      Object.assign(session.motion, {
        x: p.x,
        y: p.y,
        headingRad: Math.atan2(p.tx, -p.ty),
        velocityX: p.tx * 120,
        velocityY: p.ty * 120,
      });
      for (let i = 0; i < 30; i++) stepDriveSession(session, { steer: 0, brake: 0, coast: false });
      const along = (session.motion.x - mx) * p.tx + (session.motion.y - my) * p.ty;
      return along;
    };
    expect(runAt(first)).toBeLessThan(0);
    const open = ticks.find(
      (k) =>
        k > first + 120 &&
        scheduleState(h.schedule, k * SIM_DT).phase === 'idle' &&
        scheduleState(h.schedule, k * SIM_DT).secondsLeft > 3,
    )!;
    expect(runAt(open)).toBeGreaterThan(40);
  });

  it('applies oil, steam, magnets, deep mud and gusts only where and when they are', () => {
    const t = track('industrial_01');
    const ground = createGround();
    const loc = createLocation();
    const centre = (id: string) => {
      const h = t.def.hazards.find((x) => x.id === id)!;
      if (!('shape' in h) || h.shape.type !== 'circle') throw new Error('circle expected');
      return h.shape;
    };
    const at = (x: number, y: number, clock: number) => {
      locate(t, x, y, loc);
      return { ...groundAt(t, loc, x, y, clock, ground) };
    };
    const oil = centre('smelter_oil_2');
    expect(at(oil.x, oil.y, 0).gripScale).toBe(0.55);
    const vent = centre('steam_vent_1');
    const ventHazard = t.def.hazards.find((x) => x.id === 'steam_vent_1')!;
    if (ventHazard.kind !== 'steam_vent') throw new Error('vent expected');
    const activeTick = Array.from({ length: 200 }, (_, k) => k).find((k) =>
      hazardActive(ventHazard, k),
    )!;
    const idleTick = Array.from({ length: 200 }, (_, k) => k).find(
      (k) => !hazardActive(ventHazard, k),
    )!;
    expect(at(vent.x, vent.y, activeTick)).toMatchObject({ drag: 140, heat: 18 });
    expect(at(vent.x, vent.y, idleTick)).toMatchObject({ drag: 0, heat: 0 });
    // Beside the vent nothing acts.
    expect(at(vent.x + 120, vent.y, activeTick)).toMatchObject({ drag: 0, heat: 0, gripScale: 1 });

    const d = track('desert_01');
    const wash = d.routeHazards.find((r) => d.hazards[r.hazard]!.kind === 'deep_mud')!;
    const branch = d.branches[wash.branch]!;
    const mid = sampleBranch(branch, wash.s + wash.length / 2);
    locate(d, mid.x, mid.y, loc);
    expect(groundAt(d, loc, mid.x, mid.y, 0, ground).drag).toBe(22);

    const wind = d.def.hazards.find((h) => h.kind === 'crosswind')!;
    if (wind.kind !== 'crosswind' || !wind.gust) throw new Error('gusty crosswind expected');
    const factors = Array.from({ length: 30 * wind.gust.periodSeconds }, (_, k) =>
      gustFactor(wind, k),
    );
    expect(Math.min(...factors)).toBeGreaterThanOrEqual(wind.gust.low - 1e-9);
    expect(Math.max(...factors)).toBeLessThanOrEqual(wind.gust.high + 1e-9);
    expect(gustFactor(wind, 7)).toBe(gustFactor(wind, 7 + 30 * wind.gust.periodSeconds));
  });

  it('heats and slows a car in an active steam vent', () => {
    const t = track('industrial_01');
    const h = t.def.hazards.find((x) => x.id === 'steam_vent_1')!;
    if (h.kind !== 'steam_vent' || h.shape.type !== 'circle') throw new Error('vent expected');
    const vent = h.shape;
    const env = environmentFor('industrial_dry_night')!;
    const run = (clock: number) => {
      const session = createDriveSession(t, env, defaultParams());
      session.phase = 'RACING';
      session.countdownTicks = 0;
      session.raceTicks = clock;
      Object.assign(session.motion, {
        x: vent.x + 30,
        y: vent.y,
        headingRad: -Math.PI / 2,
        velocityX: -100,
        velocityY: 0,
      });
      for (let i = 0; i < 12; i++) stepDriveSession(session, { steer: 0, brake: 0, coast: false });
      return { heat: session.motion.coreHeat, speed: session.telemetry.speed };
    };
    const active = Array.from({ length: 200 }, (_, k) => k).find(
      (k) => hazardActive(h, k) && hazardActive(h, k + 12),
    )!;
    const idle = Array.from({ length: 200 }, (_, k) => k).find(
      (k) => !hazardActive(h, k) && !hazardActive(h, k + 12),
    )!;
    const hot = run(active);
    const cool = run(idle);
    expect(hot.heat).toBeGreaterThan(cool.heat + 4);
    expect(hot.speed).toBeLessThan(cool.speed - 20);
  });
});

describe('shortcuts are credited only when driven', () => {
  const walk = (t: TrackRuntime, path: Array<{ x: number; y: number }>) => {
    const progress = createProgress();
    const loc = createLocation();
    let ms = 0;
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1]!;
      const b = path[k]!;
      locate(t, a.x, a.y, loc);
      ms += 33;
      updateProgress(
        t,
        progress,
        a.x,
        a.y,
        b.x,
        b.y,
        Math.atan2(b.x - a.x, -(b.y - a.y)),
        200,
        loc,
        ms,
        SIM_DT,
      );
    }
    return progress;
  };
  const along = (t: TrackRuntime, b: number, from: number, to: number) => {
    const out: Array<{ x: number; y: number }> = [];
    for (let s = from; s <= to; s += 6) {
      const p = sampleBranch(t.branches[b]!, s);
      out.push({ x: p.x, y: p.y });
    }
    return out;
  };
  const toLap = (t: TrackRuntime, s: number) =>
    (((s - t.startS) % t.lapLength) + t.lapLength) % t.lapLength;

  it.each(Object.keys(TRACKS))(
    '%s: driving each shortcut counts like the road it bypasses',
    (id) => {
      const t = track(id);
      for (const sc of t.branches.slice(1)) {
        const start = t.startS - 40;
        const leave = t.startS + toLap(t, sc.leaveS);
        const rejoin = t.startS + toLap(t, sc.rejoinS);
        const end = t.startS + t.lapLength + 60;
        const driven = walk(t, [
          ...along(t, 0, start, leave),
          ...along(t, sc.index, 0, sc.length),
          ...along(t, 0, rejoin, end),
        ]);
        expect(driven.lap).toBe(2);
      }
    },
  );

  it('Dust Devil: going round the Dry Wash across open ground, past its gates, is not credited', () => {
    const t = track('desert_01');
    const sc = t.branches[1]!;
    const start = t.startS - 40;
    const leave = t.startS + toLap(t, sc.leaveS);
    const rejoin = t.startS + toLap(t, sc.rejoinS);
    const end = t.startS + t.lapLength + 60;
    const a = sampleBranch(t.main, leave);
    const b = sampleBranch(t.main, rejoin);
    let top = Infinity;
    for (let i = 0; i < sc.count; i++) top = Math.min(top, sc.y[i]!);
    const north = top - 330;
    const line = (p: { x: number; y: number }, q: { x: number; y: number }) =>
      Array.from({ length: 41 }, (_, k) => ({
        x: p.x + ((q.x - p.x) * k) / 40,
        y: p.y + ((q.y - p.y) * k) / 40,
      }));
    const cut = [
      ...line(a, { x: a.x, y: north }),
      ...line({ x: a.x, y: north }, { x: b.x, y: north }),
      ...line({ x: b.x, y: north }, b),
    ];
    const before = walk(t, along(t, 0, start, leave));
    const cutter = walk(t, [...along(t, 0, start, leave), ...cut]);
    // Nothing credited for the detour: still waiting for the first gate in the span.
    expect(cutter.checkpointIndex).toBe(before.checkpointIndex);
    const lap = walk(t, [...along(t, 0, start, leave), ...cut, ...along(t, 0, rejoin, end)]);
    expect(lap.lap).toBe(1);
  });
});

describe('off-road on an open track', () => {
  it('slows a car that leaves the road but never walls it in, and it drives back', () => {
    const t = track('desert_01');
    const env = environmentFor('desert_clear')!;
    const params = defaultParams();
    const session = createDriveSession(t, env, params);
    session.phase = 'RACING';
    session.countdownTicks = 0;
    // The westmost point of the main line is on the open west climb; go 450 px into the infield.
    let west = 0;
    for (let i = 0; i < t.main.count; i++) if (t.main.x[i]! < t.main.x[west]!) west = i;
    const s0 = t.main.s[west]!;
    const p = sampleBranch(t.main, s0);
    const nx = -p.ty;
    const ny = p.tx;
    Object.assign(session.motion, {
      x: p.x + nx * 450,
      y: p.y + ny * 450,
      headingRad: Math.atan2(nx, -ny),
    });
    const loc = createLocation();
    locate(t, session.motion.x, session.motion.y, loc);
    const before = loc.edge;
    expect(before).toBeGreaterThan(100);
    const x0 = session.motion.x;
    const y0 = session.motion.y;
    for (let i = 0; i < 75; i++) stepDriveSession(session, { steer: 0, brake: 0, coast: false });
    locate(t, session.motion.x, session.motion.y, loc);
    // Nothing pushes it back toward the road: it keeps going, further from it, slowly.
    const moved = (session.motion.x - x0) * nx + (session.motion.y - y0) * ny;
    expect(moved).toBeGreaterThan(50);
    expect(loc.edge).toBeGreaterThan(before);
    expect(session.telemetry.speed).toBeLessThan(120);
    expect(session.telemetry.onShoulder).toBe(true);
    expect(session.telemetry.surface).toBe('sand');
    expect(session.telemetry.wallContact).toBe(false);
    // The driver brings it back to the road and on round the course.
    const scratch = createDriverScratch();
    for (let i = 0; i < 30 * 15; i++)
      stepDriveSession(
        session,
        driveCenterline(t, session.motion, params, env, scratch, undefined, hazardClock(session)),
      );
    locate(t, session.motion.x, session.motion.y, loc);
    expect(loc.edge).toBeLessThan(0);
    const from = (((s0 - t.startS) % t.lapLength) + t.lapLength) % t.lapLength;
    expect(lapPosition(t, loc)).toBeGreaterThan(from + 300);
  });
});

describe('the ground under a car: one grid read, deterministic and cheap', () => {
  it('returns the same answer for the same point, and the grid read costs next to nothing', () => {
    const t = track('desert_01');
    const ground = createGround();
    const loc = createLocation();
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const pts = Array.from({ length: 20000 }, () => ({
      x: rnd() * t.def.worldWidth,
      y: rnd() * t.def.worldHeight,
    }));
    const read = () =>
      pts.map((p) => {
        locate(t, p.x, p.y, loc);
        groundAt(t, loc, p.x, p.y, 77, ground);
        return `${ground.surface}${ground.onShoulder ? 1 : 0}${ground.hazard}${ground.exposure}`;
      });
    expect(read()).toEqual(read());
    // Locate plus ground, as the car step does once a tick per car.
    const t0 = performance.now();
    let n = 0;
    for (let rep = 0; rep < 5; rep++)
      for (const p of pts) {
        locate(t, p.x, p.y, loc);
        groundAt(t, loc, p.x, p.y, rep, ground);
        n++;
      }
    const perCall = ((performance.now() - t0) * 1000) / n;
    // The ground read alone, given the location the car step has already found.
    const locs = pts.map((p) => {
      const l = createLocation();
      locate(t, p.x, p.y, l);
      return l;
    });
    const t1 = performance.now();
    for (let rep = 0; rep < 5; rep++)
      for (let i = 0; i < pts.length; i++) groundAt(t, locs[i]!, pts[i]!.x, pts[i]!.y, rep, ground);
    const groundOnly = ((performance.now() - t1) * 1000) / n;
    console.log(
      `desert_01, random points over the whole map: locate + groundAt ${perCall.toFixed(2)} us, groundAt alone ${groundOnly.toFixed(3)} us`,
    );
    expect(perCall).toBeLessThan(25);
    expect(groundOnly).toBeLessThan(1);
  });

  it('keeps a whole race tick of two cars cheap on an open track', () => {
    const t = track('desert_01');
    const env = environmentFor('desert_crosswind')!;
    const sessions = [0, 1].map((i) => createDriveSession(t, env, defaultParams(), i));
    const scratch = [createDriverScratch(), createDriverScratch()];
    const params = defaultParams();
    const t0 = performance.now();
    let ticks = 0;
    for (let i = 0; i < 30 * 40; i++) {
      sessions.forEach((s, k) =>
        stepDriveSession(
          s,
          driveCenterline(t, s.motion, params, env, scratch[k]!, undefined, hazardClock(s)),
        ),
      );
      ticks++;
    }
    const ms = (performance.now() - t0) / ticks;
    console.log(`two cars with drivers on desert_01: ${(ms * 1000).toFixed(0)} us a tick`);
    expect(ms).toBeLessThan(2);
  });

  it('builds every track quickly enough to do at race start', () => {
    for (const def of Object.values(TRACKS)) {
      const t0 = performance.now();
      buildTrack({ ...def });
      expect(performance.now() - t0).toBeLessThan(2500);
    }
    expect(CATALOG.version).toBeDefined();
  });
});
