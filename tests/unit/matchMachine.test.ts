import { BASELINE_BLUEPRINT, getTemplate } from '@bolt/content';
import type { MatchPhase, RaceResult, VehicleBlueprint } from '@bolt/shared';
import { describe, expect, it } from 'vitest';
import type { MatchEffects, RacePlan } from '../../apps/server/src/rooms/matchMachine.js';
import { DEFAULT_MATCH_TIMING, MatchMachine } from '../../apps/server/src/rooms/matchMachine.js';

/**
 * The Race a Friend state machine (Section 3.3), every transition with a fake clock: the lobby,
 * the reveal, the build with its shared deadline, the race, results and every kind of rematch,
 * and what happens when a player drops or leaves in each phase.
 */

const T = DEFAULT_MATCH_TIMING;
const TINKER = getTemplate('starter_tinker')!.blueprint;
const PACK = getTemplate('starter_packhorse')!.blueprint;

type Call = { kind: string; args: unknown[] };

function rig() {
  const calls: Call[] = [];
  const phases: MatchPhase[] = [];
  let now = 1_000_000;
  const effects: MatchEffects = {
    phaseChanged: (phase) => {
      phases.push(phase);
    },
    startRace: (plan: RacePlan) => calls.push({ kind: 'startRace', args: [plan] }),
    releaseRace: () => calls.push({ kind: 'releaseRace', args: [] }),
    forfeit: (seat, cause) => calls.push({ kind: 'forfeit', args: [seat, cause] }),
    endRace: () => calls.push({ kind: 'endRace', args: [] }),
    seatFreed: (seat) => calls.push({ kind: 'seatFreed', args: [seat] }),
    closeRoom: () => calls.push({ kind: 'closeRoom', args: [] }),
  };
  const m = new MatchMachine(
    T,
    effects,
    { trackId: 'city_01', weatherPresetId: 'city_clear_night' },
    () => ({ trackId: 'desert_01', weatherPresetId: 'desert_clear' }),
    now,
  );
  const clock = {
    get now() {
      return now;
    },
    advance(ms: number) {
      now += ms;
      m.update(now);
    },
  };
  const last = (kind: string) => [...calls].reverse().find((c) => c.kind === kind);
  return { m, calls, phases, clock, last };
}

function seated() {
  const r = rig();
  expect(r.m.join('host-guest', { nickname: 1, emblem: 1 }, TINKER, 'h1', r.clock.now)).toBe(0);
  expect(r.m.join('second-guest', { nickname: 2, emblem: 2 }, PACK, 'h2', r.clock.now)).toBe(1);
  return r;
}

function building() {
  const r = seated();
  expect(r.m.lockCourse(0, r.clock.now)).toBe(true);
  r.m.roomReady(0, r.clock.now);
  r.m.roomReady(1, r.clock.now);
  expect(r.m.phase).toBe('BUILDING');
  return r;
}

function racing() {
  const r = building();
  r.m.ready(0, TINKER, 'h1', r.clock.now);
  r.m.ready(1, PACK, 'h2', r.clock.now);
  expect(r.m.phase).toBe('VS_REVEAL');
  r.m.roomReady(0, r.clock.now);
  r.m.roomReady(1, r.clock.now);
  expect(r.m.phase).toBe('COUNTDOWN');
  r.m.raceStarted(r.clock.now);
  expect(r.m.phase).toBe('RACING');
  return r;
}

const RESULT: RaceResult = { winner: 0, reason: 'finish', raceTimeMs: 100_000, cars: [] };

function results() {
  const r = racing();
  r.m.raceFinished(RESULT, r.clock.now);
  expect(r.m.phase).toBe('FINISHED');
  r.clock.advance(T.finishedMs);
  expect(r.m.phase).toBe('RESULTS');
  return r;
}

describe('the lobby', () => {
  it('opens with the host waiting and takes exactly one more player', () => {
    const r = rig();
    expect(r.m.phase).toBe('CREATED');
    expect(r.m.join('a', { nickname: 0, emblem: 0 }, BASELINE_BLUEPRINT, 'x', r.clock.now)).toBe(0);
    expect(r.m.phase).toBe('WAITING_FOR_OPPONENT');
    expect(r.m.seats[0]!.host).toBe(true);
    expect(r.m.join('a', { nickname: 0, emblem: 0 }, BASELINE_BLUEPRINT, 'x', r.clock.now)).toBe(
      'already_seated',
    );
    expect(r.m.join('b', { nickname: 3, emblem: 0 }, BASELINE_BLUEPRINT, 'x', r.clock.now)).toBe(1);
    expect(r.m.seats[1]!.host).toBe(false);
    expect(r.m.join('c', { nickname: 4, emblem: 0 }, BASELINE_BLUEPRINT, 'x', r.clock.now)).toBe(
      'full',
    );
  });

  it('lets only the host choose and lock the course, and only with the rival there', () => {
    const r = rig();
    r.m.join('a', { nickname: 0, emblem: 0 }, TINKER, 'h', r.clock.now);
    expect(r.m.lockCourse(0, r.clock.now)).toBe(false);
    r.m.join('b', { nickname: 0, emblem: 0 }, PACK, 'h', r.clock.now);
    const course = { trackId: 'forest_01', weatherPresetId: 'forest_clear' };
    expect(r.m.selectCourse(1, course, r.clock.now)).toBe(false);
    expect(r.m.selectCourse(0, course, r.clock.now)).toBe(true);
    expect(r.m.course).toEqual(course);
    expect(r.m.lockCourse(1, r.clock.now)).toBe(false);
    expect(r.m.lockCourse(0, r.clock.now)).toBe(true);
    expect(r.m.phase).toBe('TRACK_REVEAL');
    expect(r.m.phaseEndsAt).toBe(r.clock.now + T.trackRevealMs);
    // Locked: no more choosing.
    expect(
      r.m.selectCourse(0, { trackId: 'city_01', weatherPresetId: 'city_clear_night' }, r.clock.now),
    ).toBe(false);
  });

  it('picks a random course when the build starts, not before', () => {
    const r = seated();
    r.m.selectCourse(0, 'random', r.clock.now);
    expect(r.m.randomCourse).toBe(true);
    r.m.lockCourse(0, r.clock.now);
    expect(r.m.course).toEqual({ trackId: 'desert_01', weatherPresetId: 'desert_clear' });
  });

  it('starts the build when both have seen the reveal, or when the reveal runs out', () => {
    const a = seated();
    a.m.lockCourse(0, a.clock.now);
    a.m.roomReady(0, a.clock.now);
    expect(a.m.phase).toBe('TRACK_REVEAL');
    a.m.roomReady(1, a.clock.now);
    expect(a.m.phase).toBe('BUILDING');
    expect(a.m.phaseEndsAt).toBe(a.clock.now + T.buildMs);

    const b = seated();
    b.m.lockCourse(0, b.clock.now);
    b.clock.advance(T.trackRevealMs);
    expect(b.m.phase).toBe('BUILDING');
  });
});

describe('the build phase', () => {
  it("ends early when both are ready, and the race uses each player's build on alternating sides", () => {
    const r = building();
    expect(r.m.submitBuild(0, PACK, 'p', r.clock.now)).toBe(true);
    expect(r.m.ready(0, TINKER, 't', r.clock.now)).toBe(true);
    // Ready is final.
    expect(r.m.submitBuild(0, PACK, 'p', r.clock.now)).toBe(false);
    expect(r.m.phase).toBe('BUILDING');
    expect(r.m.ready(1, PACK, 'p2', r.clock.now)).toBe(true);
    expect(r.m.phase).toBe('VS_REVEAL');
    const plan = r.last('startRace')!.args[0] as RacePlan;
    expect(plan.round).toBe(1);
    expect(plan.carOfSeat).toEqual([0, 1]);
    expect(plan.builds).toEqual([TINKER, PACK]);
    expect(plan.swapped).toBe(false);
  });

  it('locks the last legal build of a player who never pressed Ready at the deadline', () => {
    const r = building();
    r.m.ready(0, TINKER, 't', r.clock.now);
    r.m.submitBuild(1, BASELINE_BLUEPRINT, 'b', r.clock.now);
    r.clock.advance(T.buildMs - 1);
    expect(r.m.phase).toBe('BUILDING');
    r.clock.advance(1);
    expect(r.m.phase).toBe('VS_REVEAL');
    const plan = r.last('startRace')!.args[0] as RacePlan;
    expect(plan.builds[1]).toBe(BASELINE_BLUEPRINT);
    // Nothing more is accepted once the clock is out.
    expect(r.m.submitBuild(1, PACK, 'p', r.clock.now)).toBe(false);
  });

  it('refuses submissions after the deadline even before the room has ticked', () => {
    const r = building();
    const late = r.clock.now + T.buildMs;
    expect(r.m.submitBuild(0, PACK, 'p', late)).toBe(false);
  });
});

describe('the race', () => {
  it('waits for both to load, or for the load limit, before the countdown', () => {
    const r = building();
    r.m.ready(0, TINKER, 't', r.clock.now);
    r.m.ready(1, PACK, 'p', r.clock.now);
    r.m.roomReady(0, r.clock.now);
    expect(r.m.phase).toBe('VS_REVEAL');
    r.clock.advance(T.loadMs);
    expect(r.m.phase).toBe('COUNTDOWN');
    expect(r.last('releaseRace')).toBeDefined();
  });

  it('goes from the finish to results', () => {
    const r = results();
    expect(r.m.lastResult).toBe(RESULT);
  });
});

describe('rematch', () => {
  it('needs both votes; the same cars swap sides', () => {
    const r = results();
    r.m.vote(0, 'race', r.clock.now);
    expect(r.m.phase).toBe('REMATCH_VOTE');
    expect(r.last('startRace')!.args[0]).toMatchObject({ round: 1 });
    r.m.vote(1, 'race', r.clock.now);
    expect(r.m.phase).toBe('VS_REVEAL');
    const plan = r.last('startRace')!.args[0] as RacePlan;
    expect(plan.round).toBe(2);
    expect(plan.carOfSeat).toEqual([1, 0]);
    expect(plan.builds).toEqual([PACK, TINKER]);
    expect(plan.buildOwner).toEqual([1, 0]);
  });

  it('swaps the cars only when both ask for it', () => {
    const r = results();
    r.m.vote(0, 'swap', r.clock.now);
    r.m.vote(1, 'race', r.clock.now);
    expect(r.m.phase).toBe('REMATCH_VOTE');
    r.m.vote(1, 'swap', r.clock.now);
    expect(r.m.phase).toBe('VS_REVEAL');
    const plan = r.last('startRace')!.args[0] as RacePlan;
    expect(plan.swapped).toBe(true);
    // Round 2: seat 0 is on car 1 and drives seat 1's build, and the other way round.
    expect(plan.carOfSeat).toEqual([1, 0]);
    expect(plan.builds).toEqual([TINKER, PACK]);
    expect(plan.buildOwner).toEqual([0, 1]);
  });

  it('opens a new build phase when either wants to change the build', () => {
    const r = results();
    r.m.vote(0, 'build', r.clock.now);
    r.m.vote(1, 'race', r.clock.now);
    expect(r.m.phase).toBe('BUILDING');
    expect(r.m.phaseEndsAt).toBe(r.clock.now + T.buildMs);
    expect(r.m.seats[0]!.ready).toBe(false);
  });

  it('withdraws a vote', () => {
    const r = results();
    r.m.vote(0, 'race', r.clock.now);
    r.m.vote(0, 'none', r.clock.now);
    expect(r.m.phase).toBe('RESULTS');
  });
});

describe('players who drop or leave', () => {
  it('in the lobby: the seat waits out the 90 s grace, then the host is alone again', () => {
    const r = seated();
    r.m.drop(1, r.clock.now);
    r.clock.advance(T.lobbyGraceMs - 1);
    expect(r.m.seats[1]).not.toBeNull();
    r.clock.advance(1);
    expect(r.m.seats[1]).toBeNull();
    expect(r.m.phase).toBe('WAITING_FOR_OPPONENT');
    expect(r.m.notice).toBe('rival_timed_out');
    expect(r.last('seatFreed')!.args).toEqual([1]);
  });

  it('in the lobby: a host who leaves hands the lobby to the guest', () => {
    const r = seated();
    r.m.leave(0, r.clock.now);
    expect(r.m.seats[1]!.host).toBe(true);
    expect(r.m.phase).toBe('WAITING_FOR_OPPONENT');
    expect(r.m.notice).toBe('host_left');
  });

  it('in the reveal: a guest who leaves sends the host back to waiting', () => {
    const r = seated();
    r.m.lockCourse(0, r.clock.now);
    r.m.leave(1, r.clock.now);
    expect(r.m.phase).toBe('WAITING_FOR_OPPONENT');
    expect(r.m.notice).toBe('rival_left');
  });

  it('in the reveal: the build does not start while a player is away', () => {
    const r = seated();
    r.m.lockCourse(0, r.clock.now);
    r.m.drop(1, r.clock.now);
    r.clock.advance(T.trackRevealMs + 1000);
    expect(r.m.phase).toBe('TRACK_REVEAL');
    r.m.rejoin(1, r.clock.now);
    r.clock.advance(10);
    expect(r.m.phase).toBe('BUILDING');
  });

  it('while building: 20 s of grace, then the build is cancelled without a winner', () => {
    const r = building();
    r.m.drop(1, r.clock.now);
    r.clock.advance(T.buildGraceMs);
    expect(r.m.phase).toBe('WAITING_FOR_OPPONENT');
    expect(r.m.notice).toBe('build_cancelled');
    expect(r.calls.some((c) => c.kind === 'startRace')).toBe(false);
    expect(r.calls.some((c) => c.kind === 'forfeit')).toBe(false);
  });

  it('while building: a player back in time keeps everything, even past the deadline', () => {
    const r = building();
    r.m.submitBuild(1, PACK, 'p', r.clock.now);
    r.clock.advance(T.buildMs - 5_000);
    r.m.drop(1, r.clock.now);
    r.clock.advance(10_000);
    // The clock ran out while the player was away: the builds are frozen and the room waits.
    expect(r.m.phase).toBe('BUILDING');
    expect(r.m.submitBuild(0, TINKER, 't', r.clock.now)).toBe(false);
    r.m.rejoin(1, r.clock.now);
    expect(r.m.phase).toBe('VS_REVEAL');
    expect((r.last('startRace')!.args[0] as RacePlan).builds[1]).toBe(PACK);
  });

  it('while racing: 15 s under the autopilot, then a disconnect forfeit', () => {
    const r = racing();
    r.m.drop(0, r.clock.now);
    r.clock.advance(T.raceGraceMs - 1);
    expect(r.calls.some((c) => c.kind === 'forfeit')).toBe(false);
    r.clock.advance(1);
    expect(r.last('forfeit')!.args).toEqual([0, 'disconnected']);
    expect(r.m.seats[0]).toBeNull();
    // The room reports the result of the forfeit like any other.
    r.m.raceFinished({ ...RESULT, winner: 1, reason: 'forfeit' }, r.clock.now);
    expect(r.m.phase).toBe('FINISHED');
  });

  it('while racing: back in time, nothing happens', () => {
    const r = racing();
    r.m.drop(1, r.clock.now);
    r.clock.advance(T.raceGraceMs - 1000);
    r.m.rejoin(1, r.clock.now);
    r.clock.advance(T.raceGraceMs * 2);
    expect(r.calls.some((c) => c.kind === 'forfeit')).toBe(false);
    expect(r.m.phase).toBe('RACING');
  });

  it('while racing: leaving is an immediate forfeit', () => {
    const r = racing();
    r.m.leave(1, r.clock.now);
    expect(r.last('forfeit')!.args).toEqual([1, 'left']);
    expect(r.m.notice).toBe('rival_left');
  });

  it('while racing: a connected page that sent nothing for the whole grace forfeits but keeps its seat', () => {
    const r = racing();
    expect(r.m.forfeitRace(1, r.clock.now)).toBe(true);
    expect(r.last('forfeit')!.args).toEqual([1, 'disconnected']);
    expect(r.m.seats[1]).not.toBeNull();
  });

  it('in results: the seat frees after the results grace, and the lobby can open again', () => {
    const r = results();
    r.m.drop(1, r.clock.now);
    r.clock.advance(T.resultsGraceMs);
    expect(r.m.seats[1]).toBeNull();
    expect(r.m.phase).toBe('RESULTS');
    expect(r.m.vote(0, 'race', r.clock.now)).toBe(false);
    expect(r.m.reopen(0, r.clock.now)).toBe(true);
    expect(r.m.phase).toBe('WAITING_FOR_OPPONENT');
    expect(r.m.join('new-friend', { nickname: 5, emblem: 5 }, PACK, 'p', r.clock.now)).toBe(1);
  });

  it('when the last player leaves, the room closes', () => {
    const r = seated();
    r.m.leave(1, r.clock.now);
    r.m.leave(0, r.clock.now);
    expect(r.m.phase).toBe('CLOSED');
    expect(r.last('closeRoom')).toBeDefined();
  });

  it('closes after 15 minutes without a message (the code expires)', () => {
    const r = seated();
    r.clock.advance(T.idleMs + 1);
    expect(r.m.phase).toBe('CLOSED');
    expect(r.m.notice).toBe('expired');
    expect(r.m.join('late', { nickname: 0, emblem: 0 }, TINKER, 't', r.clock.now)).toBe('closed');
  });

  it('never seats anyone in a build or a race', () => {
    const r = racing();
    r.m.leave(1, r.clock.now);
    const seat = r.m.join(
      'walk-in',
      { nickname: 0, emblem: 0 },
      TINKER as VehicleBlueprint,
      't',
      r.clock.now,
    );
    expect(seat).toBe('full');
  });
});
