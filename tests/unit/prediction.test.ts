import {
  CATALOG,
  CITY_01,
  DEFAULT_LOADOUT,
  EXAMPLE_TEMPLATES,
  baselineBlueprint,
  conditionsFor,
  createSparringRace,
  environmentFor,
  raceEntry,
  resolveLoadout,
} from '@bolt/content';
import type {
  CarSnapshot,
  DriveSession,
  InputSample,
  RaceSnapshot,
  VehicleBlueprint,
  VehicleParams,
} from '@bolt/shared';
import {
  MAX_QUEUED_INPUTS,
  buildTrack,
  deriveVehicleParams,
  installPart,
  resolveBlueprint,
  createDriveSession,
  createDriverScratch,
  driveCenterline,
  sessionSnapshot,
  stepDriveSession,
} from '@bolt/shared';
import { describe, expect, it } from 'vitest';
import { InputPacer } from '../../apps/server/src/rooms/inputPacer.js';
import { OfflineLink } from '../../apps/web/src/network/offlineLink.js';
import { Predictor } from '../../apps/web/src/network/prediction.js';

const track = buildTrack(CITY_01);
const env = environmentFor('city_clear_night')!;
const resolved = resolveLoadout(DEFAULT_LOADOUT);
if (!resolved.ok) throw new Error('default loadout must resolve');
const defaultParams = resolved.params;

function snapshot(s: DriveSession, ack: number): CarSnapshot {
  return sessionSnapshot(s, ack);
}

/** Server stand-in: the drive room's own input policy stepping one authoritative session. */
function harness(
  delayTicks: number,
  drop: (tick: number) => boolean = () => false,
  params: VehicleParams = defaultParams,
) {
  const server = createDriveSession(track, env, params);
  const predictor = new Predictor(createDriveSession(track, env, params));
  const scratch = createDriverScratch();
  const pacer = new InputPacer(MAX_QUEUED_INPUTS);
  const wire: Array<{ at: number; sample: InputSample }> = [];
  const back: Array<{ at: number; snap: CarSnapshot }> = [];
  const run = (ticks: number, from = 0) => {
    for (let tick = from; tick < from + ticks; tick++) {
      const control = driveCenterline(track, predictor.session.motion, params, env, scratch);
      const { sample } = predictor.step(control);
      if (!drop(tick)) wire.push({ at: tick + delayTicks, sample });
      while (wire.length > 0 && wire[0]!.at <= tick) pacer.accept([wire.shift()!.sample]);
      pacer.tick(true, (input) => stepDriveSession(server, input));
      if (tick % 2 === 0)
        back.push({ at: tick + delayTicks, snap: snapshot(server, pacer.ackSequence) });
      while (back.length > 0 && back[0]!.at <= tick) predictor.reconcile(back.shift()!.snap);
    }
  };
  return { server, predictor, pacer, run };
}

describe('client prediction and reconciliation (Section 15.4)', () => {
  it('stays exactly on the authoritative car with zero latency', () => {
    const { server, predictor, run } = harness(0);
    run(30 * 20);
    expect(predictor.session.motion.x).toBeCloseTo(server.motion.x, 6);
    expect(predictor.session.motion.y).toBeCloseTo(server.motion.y, 6);
    expect(predictor.maxCorrection).toBeLessThan(1e-6);
  });

  it('replays unacknowledged input so 100 ms each way needs no visible correction', () => {
    const { predictor, run } = harness(3);
    run(30 * 25);
    expect(predictor.pendingCount).toBeGreaterThan(3);
    expect(predictor.pendingCount).toBeLessThan(12);
    // The server runs each sample exactly once, so prediction and authority agree to
    // rounding error from the first tick.
    expect(predictor.maxCorrection).toBeLessThan(1e-6);
  });

  it('recovers from lost packets without a teleport and converges again', () => {
    const { server, predictor, run } = harness(
      3,
      (tick) => tick > 200 && tick < 900 && tick % 20 === 0,
    );
    run(30 * 30);
    // A lost sample is replaced on the server by the one before it, so the only disagreement
    // is the difference between two neighbouring samples: a fraction of a pixel, not a tick
    // of travel.
    expect(predictor.corrections).toBeGreaterThan(0);
    expect(predictor.maxCorrection).toBeLessThan(2);
    // Run on a clean link: the visual error decays and both cars keep lapping.
    run(30 * 5, 30 * 30);
    for (let i = 0; i < 60; i++) predictor.decayError(1 / 60);
    expect(Math.hypot(predictor.errorX, predictor.errorY)).toBeLessThan(0.5);
    expect(server.progress.lap).toBeGreaterThanOrEqual(1);
  });

  it('leads the server by the one-way delay, so its inputs land on the intended tick', () => {
    const { server, predictor, run } = harness(4);
    run(30 * 4);
    expect(server.phase).toBe('RACING');
    expect(predictor.session.phase).toBe('RACING');
    const lead = predictor.session.raceTicks - server.raceTicks;
    expect(lead).toBeGreaterThanOrEqual(3);
    expect(lead).toBeLessThanOrEqual(5);
  });
});

describe('prediction with heat, energy and engine state', () => {
  const conditions = conditionsFor('city_01', 'city_clear_night')!;
  const paramsOf = (blueprint: VehicleBlueprint) =>
    deriveVehicleParams(resolveBlueprint(blueprint, CATALOG)!, conditions);
  const withParts = (blueprint: VehicleBlueprint, ...partIds: string[]) =>
    partIds.reduce((bp, id) => {
      const result = installPart(bp, CATALOG, id);
      if (!result.ok) throw new Error(`${id}: ${result.issue.code}`);
      return result.blueprint;
    }, blueprint);
  // Cars whose force depends on state the Milestone A snapshot did not carry: a battery
  // that runs flat, fuel pulses, a stored launch, a wind-up, an output cycle, thermal
  // limiting, tire wear and powered grip.
  const cars: Array<[string, VehicleBlueprint]> = [
    [
      'Rain Runner (flat battery, shield throttled)',
      EXAMPLE_TEMPLATES.find((t) => t.name === 'Rain Runner')!.blueprint,
    ],
    [
      'Tiny Trouble (below its stability threshold)',
      EXAMPLE_TEMPLATES.find((t) => t.name === 'Tiny Trouble')!.blueprint,
    ],
    [
      'Rocket Engine (fuel pulses, thermal limit)',
      baselineBlueprint({ engineId: 'engine_rocket' }),
    ],
    ['Spring Drive (stored launch)', baselineBlueprint({ engineId: 'engine_spring' })],
    ['Turbine (wind-up)', baselineBlueprint({ engineId: 'engine_turbine' })],
    ['Wildcard Motor (output cycle)', baselineBlueprint({ engineId: 'engine_experimental' })],
    [
      'Twin Turbo on Soft Compound (lag, heat, wear)',
      baselineBlueprint({ engineId: 'engine_twin_turbo', tireKitId: 'tires_soft' }),
    ],
    [
      'Sport Electric on Adaptive Tires with a gyro and a wing',
      withParts(
        baselineBlueprint({ engineId: 'engine_electric_sport', tireKitId: 'tires_adaptive' }),
        'utility_gyro',
        'utility_spoiler',
      ),
    ],
  ];

  it.each(cars)('%s: replay from snapshots is exact at 100 ms each way', (_name, blueprint) => {
    const params = paramsOf(blueprint);
    const { server, predictor, run } = harness(3, () => false, params);
    run(30 * 45);
    expect(server.phase).toBe('RACING');
    // The state in question really was exercised.
    expect(server.motion.coreHeat).toBeGreaterThan(0);
    // Every snapshot was reconciled with unacknowledged inputs replayed on top, and the
    // prediction never had to be corrected: the powertrain state travels with the snapshot.
    expect(predictor.pendingCount).toBeGreaterThan(3);
    expect(predictor.maxCorrection).toBeLessThan(1e-6);
  });

  it('diverges if any powertrain field is left out of the snapshot (the test above is not vacuous)', () => {
    const params = paramsOf(cars[2]![1]);
    for (const field of ['coreHeat', 'engineCharge', 'engineBurst'] as const) {
      const server = createDriveSession(track, env, params);
      const predictor = new Predictor(createDriveSession(track, env, params));
      const scratch = createDriverScratch();
      const pacer = new InputPacer(MAX_QUEUED_INPUTS);
      const wire: Array<{ at: number; sample: InputSample }> = [];
      const back: Array<{ at: number; snap: CarSnapshot }> = [];
      for (let tick = 0; tick < 30 * 30; tick++) {
        const control = driveCenterline(track, predictor.session.motion, params, env, scratch);
        const { sample } = predictor.step(control);
        wire.push({ at: tick + 3, sample });
        while (wire.length > 0 && wire[0]!.at <= tick) pacer.accept([wire.shift()!.sample]);
        pacer.tick(true, (input) => stepDriveSession(server, input));
        if (tick % 2 === 0) {
          const snap = snapshot(server, pacer.ackSequence);
          // A snapshot that forgets one field, as the old schema would have.
          (snap.motion as Record<string, number | boolean>)[field] =
            field === 'engineCharge' ? 1 : 0;
          back.push({ at: tick + 3, snap });
        }
        while (back.length > 0 && back[0]!.at <= tick) predictor.reconcile(back.shift()!.snap);
      }
      expect(predictor.maxCorrection, field).toBeGreaterThan(0.01);
    }
  });

  it('carries wheel integrity and the build hash in the snapshot', () => {
    const spider = createDriveSession(
      track,
      env,
      paramsOf(baselineBlueprint({ chassisId: 'chassis_spider' })),
    );
    const snap = sessionSnapshot(spider, 4, 'abc123');
    expect(snap.wheelIntegrity).toEqual([100, 100, 100, 100, 100, 100]);
    expect(snap.buildHash).toBe('abc123');
    const predictor = new Predictor(
      createDriveSession(track, env, paramsOf(baselineBlueprint({ chassisId: 'chassis_spider' }))),
    );
    snap.wheelIntegrity[2] = 40;
    predictor.reconcile(snap);
    expect(predictor.session.wheelIntegrity).toEqual([100, 100, 40, 100, 100, 100]);
  });
});

describe('offline link', () => {
  it('reports the same snapshots and events as an authority and ignores replayed samples', () => {
    const conditions = conditionsFor(CITY_01.id, 'city_clear_night')!;
    const sparring = createSparringRace(
      track,
      env,
      conditions,
      raceEntry(baselineBlueprint(), conditions)!,
      1,
      'baseline',
    )!;
    const link = new OfflineLink(sparring.race, sparring.brains);
    const snaps: CarSnapshot[] = [];
    const races: RaceSnapshot[] = [];
    link.onSnapshot = (s) => snaps.push(s);
    link.onRace = (r) => races.push(r);
    const sample: InputSample = { sequence: 1, clientTick: 1, steer: 0, brake: 0, coast: false };
    link.sendInputs([sample]);
    link.sendInputs([sample]);
    expect(sparring.race.tick).toBe(1);
    expect(snaps.at(-1)!.ackSequence).toBe(1);
    // The race around the car arrives with every snapshot, and carries that same snapshot.
    expect(races).toHaveLength(snaps.length);
    expect(races.at(-1)!.car).toBe(snaps.at(-1));
    expect(races.at(-1)!.rival.x).toBe(track.spawns[1]!.x);
    link.resetCar();
    expect(snaps.at(-1)!.phase).toBe('COUNTDOWN');
  });
});
