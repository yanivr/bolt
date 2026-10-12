import {
  CITY_01,
  conditionsFor,
  createSparringRace,
  environmentFor,
  getTemplate,
  raceEntry,
} from '@bolt/content';
import type { CarSnapshot, InputSample, RivalSnapshot } from '@bolt/shared';
import {
  MAX_QUEUED_INPUTS,
  TOW,
  buildTrack,
  carSnapshot,
  createDriveSession,
  createDriverScratch,
  driveCenterline,
  rivalSnapshot,
  stepRaceWithBrains,
  ticksOf,
  towGapSeconds,
} from '@bolt/shared';
import { describe, expect, it } from 'vitest';
import { InputPacer } from '../../apps/server/src/rooms/inputPacer.js';
import { Predictor } from '../../apps/web/src/network/prediction.js';

/**
 * Prediction of the local car with the tow coming on and going off (Section 15.4 and
 * docs/COMBAT_API.md, "Predicted and authoritative"). The tow depends on where the rival is,
 * which a client only hears about in snapshots. It is still predicted exactly, because the
 * server decides it on a slow clock and announces each decision one period before it takes
 * effect: the snapshot's effects carry the bonus, what it is moving toward and what comes next.
 *
 * The rig is the drive room's own input policy stepping a real two-car race, with a delay each
 * way on the wire. The player holds back off the grid so that a slower rival gets three seconds
 * away, then drives flat out: the tow takes hold, builds, fades and lets go.
 */

const track = buildTrack(CITY_01);
const env = environmentFor('city_clear_night')!;
const conditions = conditionsFor(CITY_01.id, 'city_clear_night')!;
const PERIOD = ticksOf(TOW.updateSeconds);

type Options = {
  delayTicks: number;
  /** Changes a snapshot before the client sees it. */
  tamper?: (snap: CarSnapshot) => void;
  seconds?: number;
  /** Runs the same race with the tow switched off, for the comparison. */
  towOff?: boolean;
  /** Stops after this many client ticks, whatever the tow is doing. */
  ticks?: number;
};

function run({ delayTicks, tamper, seconds = 90, towOff = false, ticks }: Options) {
  const player = raceEntry(getTemplate('starter_sprinter')!.blueprint, conditions)!;
  // The unarmed Beetle as the rival: nothing in this race but driving and the tow.
  const sparring = createSparringRace(track, env, conditions, player, 5, 'baseline')!;
  const { race, brains } = sparring;
  if (towOff) race.options.tow = false;
  const me = race.cars[0]!;
  const predictor = new Predictor(createDriveSession(track, env, player.params, 0));
  predictor.setBuild(player.build, conditions);
  predictor.setRivalBody(race.cars[1]!.baseParams);
  const scratch = createDriverScratch();
  const pacer = new InputPacer(MAX_QUEUED_INPUTS);
  const wire: Array<{ at: number; sample: InputSample }> = [];
  const back: Array<{ at: number; snap: CarSnapshot; rival: RivalSnapshot; tick: number }> = [];
  const levels: number[] = [];
  let engagedAt = -1;
  let releasedAt = -1;
  let peak = 0;
  let maxPending = 0;
  let closest = Infinity;
  // Every reconciliation's jump of the predicted car, however small: the predictor itself only
  // counts those over a hundredth of a pixel.
  let jumps = 0;
  let jumpSum = 0;
  let jumpMax = 0;
  let played = 0;
  for (let tick = 0; tick < (ticks ?? seconds * 30); tick++) {
    played = tick + 1;
    const control = driveCenterline(track, predictor.session.motion, player.params, env, scratch);
    // Off the grid the player dawdles for four seconds, on the brake, and then races.
    const racing = predictor.session.phase === 'RACING';
    if (racing && predictor.session.raceTicks < 30 * 4)
      control.brake = Math.max(control.brake, 0.6);
    const { sample } = predictor.step(control);
    wire.push({ at: tick + delayTicks, sample });
    while (wire.length > 0 && wire[0]!.at <= tick) pacer.accept([wire.shift()!.sample]);
    pacer.tick(true, (input) => {
      stepRaceWithBrains(race, [input], brains);
      for (const event of race.events) {
        if (event.type !== 'catchup' || event.car !== 0) continue;
        if (event.state === 'engaged' && engagedAt < 0) engagedAt = race.raceTicks;
        if (event.state === 'released' && releasedAt < 0) releasedAt = race.raceTicks;
      }
    });
    peak = Math.max(peak, me.tow.tow);
    levels.push(me.tow.tow);
    if (race.raceTicks > 30 * 10) closest = Math.min(closest, towGapSeconds(race, me));
    if (tick % 2 === 0) {
      const snap = carSnapshot(race, 0, pacer.ackSequence);
      tamper?.(snap);
      back.push({ at: tick + delayTicks, snap, rival: rivalSnapshot(race, 1), tick: race.tick });
    }
    while (back.length > 0 && back[0]!.at <= tick) {
      const arrived = back.shift()!;
      predictor.setRival(arrived.rival, arrived.tick);
      const bx = predictor.session.motion.x;
      const by = predictor.session.motion.y;
      predictor.reconcile(arrived.snap);
      const jump = Math.hypot(predictor.session.motion.x - bx, predictor.session.motion.y - by);
      if (jump > 0) jumps++;
      jumpSum += jump;
      jumpMax = Math.max(jumpMax, jump);
    }
    maxPending = Math.max(maxPending, predictor.pendingCount);
    // Stop well short of the rival's bumper: this test is about the tow, not about contact.
    if (ticks === undefined && releasedAt >= 0 && race.raceTicks > releasedAt + 60) break;
  }
  return {
    race,
    me,
    predictor,
    engagedAt,
    releasedAt,
    peak,
    maxPending,
    levels,
    closest,
    played,
    jumps,
    jumpSum,
    jumpMax,
  };
}

describe('predicting the local car while the tow comes and goes', () => {
  it('needs no correction at all at 100 ms each way: on, building, fading and off', () => {
    const r = run({ delayTicks: 3 });
    // The tow really did take hold of the player's car, build, and let go again.
    expect(r.engagedAt).toBeGreaterThan(0);
    expect(r.releasedAt).toBeGreaterThan(r.engagedAt + 30 * 3);
    expect(r.peak).toBeGreaterThan(TOW.maxBonus * 0.5);
    expect(r.me.tow.tow).toBe(0);
    expect(r.maxPending).toBeGreaterThan(3);
    expect(r.maxPending).toBeLessThan(PERIOD);
    // And the prediction never had to be corrected: the same bits as the authority.
    expect(r.predictor.maxCorrection).toBeLessThan(1e-6);
    expect(r.predictor.session.motion.x).toBeCloseTo(r.me.session.motion.x, -3);
  });

  it('is still exact at 200 ms each way, which is as far ahead as a playable client runs', () => {
    const r = run({ delayTicks: 6 });
    expect(r.engagedAt).toBeGreaterThan(0);
    expect(r.releasedAt).toBeGreaterThan(r.engagedAt);
    expect(r.maxPending).toBeGreaterThan(9);
    expect(r.maxPending).toBeLessThan(PERIOD);
    expect(r.predictor.maxCorrection).toBeLessThan(1e-6);
  });

  it('degrades to corrections of a fraction of a pixel when the client is more than a decision period ahead', () => {
    // 400 ms each way: more than 15 unacknowledged ticks, so now and then the replay crosses
    // two decision ticks and has only been told about one.
    const r = run({ delayTicks: 12 });
    expect(r.maxPending).toBeGreaterThan(PERIOD);
    expect(r.engagedAt).toBeGreaterThan(0);
    expect(r.releasedAt).toBeGreaterThan(r.engagedAt);
    expect(r.predictor.corrections).toBeGreaterThan(0);
    // The existing ceiling for a lossy link is 2 px (prediction.test.ts); this stays far inside.
    expect(r.predictor.maxCorrection).toBeLessThan(0.25);
  });

  it('is not vacuous: a snapshot without the tow numbers is corrected again and again', () => {
    const r = run({
      delayTicks: 3,
      tamper: (snap) => {
        // What a protocol 4 client would have seen.
        snap.effects!.tow = 0;
        snap.effects!.towTarget = 0;
        snap.effects!.towNext = 0;
      },
    });
    expect(r.engagedAt).toBeGreaterThan(0);
    console.log(
      `a client blind to the tow: ${r.predictor.corrections} corrections, largest ${r.predictor.maxCorrection.toFixed(3)} px`,
    );
    expect(r.predictor.maxCorrection).toBeGreaterThan(0.01);
    expect(r.predictor.corrections).toBeGreaterThan(20);
    // Even so it is a small error: the bonus is a few percent of top speed.
    expect(r.predictor.maxCorrection).toBeLessThan(2);
  });

  it('corrects a trailing car under tow no more than the same car in the same race without the tow', () => {
    // The same rig twice: once as above, once with the race's tow switched off, over exactly
    // the same number of client ticks. Any correction the tow caused would show as a
    // difference. Through 200 ms each way there is none in either; at 400 ms, more than a
    // decision period ahead, the tow adds a few corrections of a fraction of a pixel.
    for (const delayTicks of [3, 6, 12]) {
      const on = run({ delayTicks });
      const off = run({ delayTicks, towOff: true, ticks: on.played });
      const label = `${Math.round((delayTicks * 1000) / 30)} ms each way`;
      console.log(
        `${label}: with the tow ${on.predictor.corrections} corrections over 0.01 px, largest ${on.jumpMax.toFixed(4)} px, sum ${on.jumpSum.toFixed(4)} px; ` +
          `without ${off.predictor.corrections}, largest ${off.jumpMax.toFixed(4)} px, sum ${off.jumpSum.toFixed(4)} px; ${on.played} ticks`,
      );
      expect(on.engagedAt, label).toBeGreaterThan(0);
      expect(off.peak, label).toBe(0);
      expect(off.played, label).toBe(on.played);
      // The tow made a difference to the race: the towed car really did get further.
      expect(on.me.session.progress.courseProgress, label).toBeGreaterThan(
        off.me.session.progress.courseProgress + 50,
      );
      if (delayTicks <= 6) {
        expect(on.predictor.corrections, label).toBe(off.predictor.corrections);
        expect(on.jumpMax, label).toBeLessThanOrEqual(off.jumpMax + 1e-9);
        expect(on.jumpSum, label).toBeLessThanOrEqual(off.jumpSum + 1e-9);
      } else {
        expect(on.predictor.corrections, label).toBeLessThan(off.predictor.corrections + 25);
        expect(on.jumpMax, label).toBeLessThan(off.jumpMax + 0.25);
      }
    }
  });

  it('changes the bonus slowly: never more than one ramp step between two ticks', () => {
    const r = run({ delayTicks: 3 });
    const step = TOW.maxBonus * Math.max(TOW.rampUpPerSecond, TOW.rampDownPerSecond) * (1 / 30);
    for (let i = 1; i < r.levels.length; i++)
      expect(Math.abs(r.levels[i]! - r.levels[i - 1]!)).toBeLessThanOrEqual(step + 1e-12);
    // It let go at the edge of fighting range, not on the rival's bumper.
    expect(r.closest).toBeGreaterThan(0.5);
  });
});
