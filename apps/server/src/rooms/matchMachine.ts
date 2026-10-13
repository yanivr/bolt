import type {
  MatchNotice,
  MatchPhase,
  MatchProfile,
  RaceResult,
  RematchChoice,
  VehicleBlueprint,
} from '@bolt/shared';
import { BUILD_SECONDS, MATCH_GRACE_MS } from '@bolt/shared';

/**
 * The Race a Friend state machine (Section 3.3), without Colyseus, sockets or a race in it, so
 * every transition can be driven and checked in a unit test with a fake clock. The match room
 * feeds it what players do and what the race reports, calls `update` every tick, and carries
 * out what it asks for through `MatchEffects`.
 *
 *   CREATED > WAITING_FOR_OPPONENT > TRACK_REVEAL > BUILDING > VS_REVEAL > COUNTDOWN > RACING
 *     > FINISHED > RESULTS > REMATCH_VOTE > (VS_REVEAL | BUILDING) ... > CLOSED
 *
 * VS_REVEAL is the Milestone F fight card. Until it exists the phase is only the time both
 * players need to load the race, shown as the race's own loading screen, with no placeholder.
 *
 * Who is away, and what happens (Section 3.3, docs/MULTIPLAYER.md "Disconnects"):
 * - Before BUILDING: the seat is kept for `lobbyGraceMs` (the 90 s initial connection
 *   timeout). Then, or at once on Leave, the player is gone: the other is back in the waiting
 *   lobby, and becomes the host if they were not.
 * - While BUILDING: `buildGraceMs` (20 s). Then, or at once on Leave, the build is cancelled
 *   without a winner and the other is back in the waiting lobby. If the build clock runs out
 *   meanwhile, the room locks both builds and waits for the grace to decide.
 * - From VS_REVEAL to the finish: the car is driven by the emergency autopilot for
 *   `raceGraceMs` (15 s). Back in time, the driver has it back; otherwise, or at once on Leave,
 *   the race is a disconnect forfeit.
 * - In RESULTS and REMATCH_VOTE: `resultsGraceMs`. Then, or on Leave, the seat is free; the
 *   other can open the lobby again for a new rival with the same code.
 * The whole room closes after `idleMs` without a message from anyone (the code expires).
 */

export type MatchTiming = {
  lobbyGraceMs: number;
  buildGraceMs: number;
  raceGraceMs: number;
  resultsGraceMs: number;
  /** Longest the track reveal waits for both players to press Build Your Car. */
  trackRevealMs: number;
  buildMs: number;
  /** Longest the race waits for both players to load it. */
  loadMs: number;
  /** From the decided race to the results phase. */
  finishedMs: number;
  idleMs: number;
};

export const DEFAULT_MATCH_TIMING: Readonly<MatchTiming> = Object.freeze({
  lobbyGraceMs: MATCH_GRACE_MS.lobby,
  buildGraceMs: MATCH_GRACE_MS.build,
  raceGraceMs: MATCH_GRACE_MS.race,
  resultsGraceMs: MATCH_GRACE_MS.results,
  trackRevealMs: 12_000,
  buildMs: BUILD_SECONDS * 1000,
  loadMs: 20_000,
  finishedMs: 2_500,
  idleMs: 15 * 60_000,
});

export type Course = { trackId: string; weatherPresetId: string };

export type MatchSeat = {
  guestId: string;
  profile: MatchProfile;
  host: boolean;
  connected: boolean;
  /** Epoch ms when a dropped seat's grace ends, or 0 while connected. */
  graceEndsAt: number;
  /** The newest legal build the server holds for this player. */
  build: VehicleBlueprint;
  buildHash: string;
  /** Pressed Ready in the build phase. */
  ready: boolean;
  /** Pressed Build Your Car on the reveal, or loaded the race. */
  loaded: boolean;
  vote: RematchChoice | '';
};

export type RacePlan = {
  course: Course;
  round: number;
  /** For each seat, the car index it drives (grid side). */
  carOfSeat: [number, number];
  /** For each car index, the blueprint it races. */
  builds: [VehicleBlueprint, VehicleBlueprint];
  /** For each car index, the seat whose build it is. */
  buildOwner: [number, number];
  swapped: boolean;
};

export interface MatchEffects {
  phaseChanged(phase: MatchPhase, endsAt: number): void;
  /** Create the race for this plan, held on the grid. */
  startRace(plan: RacePlan): void;
  /** Both have loaded (or the wait ran out): let the countdown run. */
  releaseRace(): void;
  /** End the race as a forfeit by this seat. */
  forfeit(seat: number, cause: 'left' | 'disconnected'): void;
  /** Drop the race object, if any. */
  endRace(): void;
  /** Disconnect whatever connection still holds this seat. */
  seatFreed(seat: number): void;
  closeRoom(): void;
}

export type JoinRefusal = 'full' | 'already_seated' | 'closed';

const LOBBY_PHASES: ReadonlySet<MatchPhase> = new Set([
  'CREATED',
  'WAITING_FOR_OPPONENT',
  'TRACK_REVEAL',
]);
const RACE_PHASES: ReadonlySet<MatchPhase> = new Set(['VS_REVEAL', 'COUNTDOWN', 'RACING']);
const AFTER_PHASES: ReadonlySet<MatchPhase> = new Set(['FINISHED', 'RESULTS', 'REMATCH_VOTE']);

export class MatchMachine {
  phase: MatchPhase = 'CREATED';
  /** Epoch ms when the current phase ends by itself, or 0. */
  phaseEndsAt = 0;
  readonly seats: [MatchSeat | null, MatchSeat | null] = [null, null];
  course: Course;
  /** The host asked for a random course, picked when the build starts. */
  randomCourse = false;
  /** Races started in this room, from 1. */
  round = 0;
  plan: RacePlan | null = null;
  lastResult: RaceResult | null = null;
  notice: MatchNotice = '';
  lastActivity: number;

  constructor(
    private readonly timing: MatchTiming,
    private readonly effects: MatchEffects,
    initialCourse: Course,
    private readonly pickRandomCourse: () => Course,
    now: number,
  ) {
    this.course = { ...initialCourse };
    this.lastActivity = now;
  }

  // --- Queries --------------------------------------------------------------------------------

  get closed(): boolean {
    return this.phase === 'CLOSED';
  }

  occupied(): number {
    return (this.seats[0] ? 1 : 0) + (this.seats[1] ? 1 : 0);
  }

  seatOf(guestId: string): number {
    if (this.seats[0]?.guestId === guestId) return 0;
    if (this.seats[1]?.guestId === guestId) return 1;
    return -1;
  }

  other(seat: number): MatchSeat | null {
    return this.seats[seat === 0 ? 1 : 0];
  }

  private bothPresent(): boolean {
    return this.seats[0] !== null && this.seats[1] !== null;
  }

  private bothConnected(): boolean {
    return this.bothPresent() && this.seats[0]!.connected && this.seats[1]!.connected;
  }

  /** Grace a seat dropped now would get. */
  graceFor(phase: MatchPhase): number {
    if (LOBBY_PHASES.has(phase)) return this.timing.lobbyGraceMs;
    if (phase === 'BUILDING') return this.timing.buildGraceMs;
    if (RACE_PHASES.has(phase)) return this.timing.raceGraceMs;
    return this.timing.resultsGraceMs;
  }

  /** Longest any phase keeps a dropped seat: the reconnection window Colyseus is given. */
  get longestGraceMs(): number {
    const t = this.timing;
    return Math.max(t.lobbyGraceMs, t.buildGraceMs, t.raceGraceMs, t.resultsGraceMs);
  }

  // --- Players arriving and going ----------------------------------------------------------------

  join(
    guestId: string,
    profile: MatchProfile,
    build: VehicleBlueprint,
    buildHash: string,
    now: number,
  ): number | JoinRefusal {
    if (this.closed) return 'closed';
    if (this.seatOf(guestId) >= 0) return 'already_seated';
    const free = this.seats[0] === null ? 0 : this.seats[1] === null ? 1 : -1;
    // A seat opens only in the waiting lobby: a second player cannot walk into a build or a race.
    if (free < 0 || (this.phase !== 'CREATED' && this.phase !== 'WAITING_FOR_OPPONENT'))
      return 'full';
    const index: 0 | 1 = free === 0 ? 0 : 1;
    const host = this.occupied() === 0;
    this.seats[index] = {
      guestId,
      profile,
      host,
      connected: true,
      graceEndsAt: 0,
      build,
      buildHash,
      ready: false,
      loaded: false,
      vote: '',
    };
    this.touch(now);
    this.notice = '';
    if (this.phase === 'CREATED') this.enter('WAITING_FOR_OPPONENT', 0);
    return index;
  }

  setProfile(seat: number, profile: MatchProfile, now: number): boolean {
    const s = this.seats[seat];
    if (!s || !LOBBY_PHASES.has(this.phase)) return false;
    s.profile = profile;
    this.touch(now);
    return true;
  }

  /** The connection dropped without a goodbye. */
  drop(seat: number, now: number): void {
    const s = this.seats[seat];
    if (!s || !s.connected) return;
    s.connected = false;
    s.graceEndsAt = now + this.graceFor(this.phase);
  }

  /** The same player is back on a new connection. */
  rejoin(seat: number, now: number): void {
    const s = this.seats[seat];
    if (!s) return;
    s.connected = true;
    s.graceEndsAt = 0;
    this.touch(now);
    // A build held at its deadline for a returning player can now go on.
    if (this.phase === 'BUILDING' && this.phaseEndsAt > 0 && now >= this.phaseEndsAt)
      this.lockBuilds(now);
  }

  /** The player left on purpose, or their grace ran out: the seat is free. */
  leave(seat: number, now: number, cause: 'left' | 'disconnected' = 'left'): void {
    const s = this.seats[seat];
    if (!s) return;
    const phase = this.phase;
    const wasHost = s.host;
    if (RACE_PHASES.has(phase)) this.effects.forfeit(seat, cause);
    this.seats[seat] = null;
    this.effects.seatFreed(seat);
    const remaining = this.other(seat);
    if (!remaining) {
      this.close();
      return;
    }
    if (wasHost) remaining.host = true;
    if (LOBBY_PHASES.has(phase)) {
      this.notice = wasHost ? 'host_left' : cause === 'left' ? 'rival_left' : 'rival_timed_out';
      this.backToLobby();
    } else if (phase === 'BUILDING') {
      // Cancelled without a winner (Section 3.3).
      this.notice = 'build_cancelled';
      this.backToLobby();
    } else if (RACE_PHASES.has(phase)) {
      // The forfeit decided the race; `raceFinished` moves the phase on.
      this.notice = cause === 'left' ? 'rival_left' : 'rival_timed_out';
    } else {
      this.notice = cause === 'left' ? 'rival_left' : 'rival_timed_out';
      for (const other of this.seats) if (other) other.vote = '';
      if (phase === 'REMATCH_VOTE') this.enter('RESULTS', 0);
    }
    this.touch(now);
  }

  /** After results with nobody in the other seat: wait for a new rival with the same code. */
  reopen(seat: number, now: number): boolean {
    if (!this.seats[seat] || this.other(seat) || !AFTER_PHASES.has(this.phase)) return false;
    this.backToLobby();
    this.touch(now);
    return true;
  }

  private backToLobby(): void {
    this.effects.endRace();
    this.plan = null;
    for (const s of this.seats)
      if (s) {
        s.ready = false;
        s.loaded = false;
        s.vote = '';
      }
    this.enter('WAITING_FOR_OPPONENT', 0);
  }

  // --- The lobby ---------------------------------------------------------------------------------

  selectCourse(seat: number, course: Course | 'random', now: number): boolean {
    if (!this.seats[seat]?.host || this.phase !== 'WAITING_FOR_OPPONENT') return false;
    if (course === 'random') this.randomCourse = true;
    else {
      this.randomCourse = false;
      this.course = { ...course };
    }
    this.touch(now);
    return true;
  }

  /** `Start Build`: the host locks the course and both see it. */
  lockCourse(seat: number, now: number): boolean {
    if (!this.seats[seat]?.host || this.phase !== 'WAITING_FOR_OPPONENT') return false;
    if (!this.bothConnected()) return false;
    if (this.randomCourse) this.course = this.pickRandomCourse();
    for (const s of this.seats) if (s) s.loaded = false;
    this.touch(now);
    this.enter('TRACK_REVEAL', now + this.timing.trackRevealMs);
    return true;
  }

  /** Build Your Car on the reveal, or the race scene is up. */
  roomReady(seat: number, now: number): boolean {
    const s = this.seats[seat];
    if (!s) return false;
    if (this.phase !== 'TRACK_REVEAL' && this.phase !== 'VS_REVEAL') return false;
    s.loaded = true;
    this.touch(now);
    if (this.bothPresent() && this.seats[0]!.loaded && this.seats[1]!.loaded) {
      if (this.phase === 'TRACK_REVEAL') this.startBuilding(now);
      else this.release(now);
    }
    return true;
  }

  // --- Building ------------------------------------------------------------------------------------

  private startBuilding(now: number): void {
    for (const s of this.seats)
      if (s) {
        s.ready = false;
        s.vote = '';
      }
    this.enter('BUILDING', now + this.timing.buildMs);
  }

  /** A legal build the room validated. Refused once the player is ready or the phase is over. */
  submitBuild(seat: number, build: VehicleBlueprint, buildHash: string, now: number): boolean {
    const s = this.seats[seat];
    if (!s || this.phase !== 'BUILDING' || s.ready) return false;
    if (this.phaseEndsAt > 0 && now >= this.phaseEndsAt) return false;
    s.build = build;
    s.buildHash = buildHash;
    this.touch(now);
    return true;
  }

  ready(seat: number, build: VehicleBlueprint, buildHash: string, now: number): boolean {
    if (!this.submitBuild(seat, build, buildHash, now)) return false;
    this.seats[seat]!.ready = true;
    if (this.bothPresent() && this.seats[0]!.ready && this.seats[1]!.ready) this.lockBuilds(now);
    return true;
  }

  private lockBuilds(now: number): void {
    // A player is away: the builds are fixed (no more submissions), and the room waits for the
    // grace to bring them back or cancel the match.
    if (!this.bothConnected()) {
      this.phaseEndsAt = Math.min(this.phaseEndsAt || now, now);
      return;
    }
    this.round += 1;
    const swapped = this.pendingSwap;
    this.pendingSwap = false;
    // Sides alternate every race (Section 3.4: swap side assignment on rematch).
    const first = (this.round - 1) % 2;
    const carOfSeat: [number, number] = [first, 1 - first];
    const ownerOfCar: [number, number] = [0, 0];
    for (let seat = 0; seat < 2; seat++) ownerOfCar[carOfSeat[seat]!] = swapped ? 1 - seat : seat;
    const builds: [VehicleBlueprint, VehicleBlueprint] = [
      this.seats[ownerOfCar[0]]!.build,
      this.seats[ownerOfCar[1]]!.build,
    ];
    this.plan = {
      course: { ...this.course },
      round: this.round,
      carOfSeat,
      builds,
      buildOwner: ownerOfCar,
      swapped,
    };
    for (const s of this.seats)
      if (s) {
        s.loaded = false;
        s.vote = '';
      }
    this.enter('VS_REVEAL', now + this.timing.loadMs);
    this.effects.startRace(this.plan);
  }

  private pendingSwap = false;

  // --- The race ------------------------------------------------------------------------------------

  private release(now: number): void {
    if (this.phase !== 'VS_REVEAL') return;
    this.enter('COUNTDOWN', 0);
    this.effects.releaseRace();
    this.touch(now);
  }

  /** The race reached GO. */
  raceStarted(now: number): void {
    if (this.phase === 'COUNTDOWN') this.enter('RACING', 0);
    this.touch(now);
  }

  /**
   * A driver who is connected but has sent nothing for the whole race grace (a page left in
   * the background) forfeits the race like one who dropped, but keeps the seat.
   */
  forfeitRace(seat: number, now: number): boolean {
    if (!this.seats[seat] || !RACE_PHASES.has(this.phase)) return false;
    this.effects.forfeit(seat, 'disconnected');
    this.touch(now);
    return true;
  }

  /** The race is decided: a finish, the time limit, a knockout or a forfeit. */
  raceFinished(result: RaceResult, now: number): void {
    if (!RACE_PHASES.has(this.phase)) return;
    this.lastResult = result;
    this.enter('FINISHED', now + this.timing.finishedMs);
    this.touch(now);
  }

  // --- Rematch -------------------------------------------------------------------------------------

  /**
   * Section 5.11: no new race without both players' consent. `race` keeps both cars, `swap`
   * trades them, `build` opens a new build phase; `none` withdraws a vote. The race starts when
   * both have voted the same, or when either asks to build and the other has also voted.
   */
  vote(seat: number, choice: RematchChoice, now: number): boolean {
    const s = this.seats[seat];
    if (!s || !AFTER_PHASES.has(this.phase)) return false;
    if (!this.other(seat)) return false;
    s.vote = choice === 'none' ? '' : choice;
    this.touch(now);
    const a = this.seats[0]?.vote ?? '';
    const b = this.seats[1]?.vote ?? '';
    if (a === '' && b === '') {
      this.enter('RESULTS', 0);
      return true;
    }
    if (this.phase !== 'REMATCH_VOTE') this.enter('REMATCH_VOTE', 0);
    if (a === '' || b === '' || !this.bothConnected()) return true;
    if (a === 'build' || b === 'build') {
      this.effects.endRace();
      this.startBuilding(now);
    } else if (a === b) {
      this.effects.endRace();
      this.pendingSwap = a === 'swap';
      this.lockBuilds(now);
    }
    return true;
  }

  // --- The clock -----------------------------------------------------------------------------------

  update(now: number): void {
    if (this.closed) return;
    if (now - this.lastActivity > this.timing.idleMs) {
      this.notice = 'expired';
      this.close();
      return;
    }
    for (let seat = 0; seat < 2; seat++) {
      const s = this.seats[seat];
      if (s && !s.connected && s.graceEndsAt > 0 && now >= s.graceEndsAt)
        this.leave(seat, now, 'disconnected');
      if (this.closed) return;
    }
    if (this.phaseEndsAt <= 0 || now < this.phaseEndsAt) return;
    switch (this.phase) {
      case 'TRACK_REVEAL':
        if (this.bothConnected()) this.startBuilding(now);
        break;
      case 'BUILDING':
        this.lockBuilds(now);
        break;
      case 'VS_REVEAL':
        // Whoever has not loaded by now starts on the grid without them; the autopilot and
        // the race grace look after a car with nobody driving it.
        this.release(now);
        break;
      case 'FINISHED':
        this.enter('RESULTS', 0);
        break;
      default:
        break;
    }
  }

  private touch(now: number): void {
    this.lastActivity = now;
  }

  private close(): void {
    if (this.closed) return;
    this.effects.endRace();
    this.enter('CLOSED', 0);
    this.effects.closeRoom();
  }

  private enter(phase: MatchPhase, endsAt: number): void {
    this.phase = phase;
    this.phaseEndsAt = endsAt;
    this.effects.phaseChanged(phase, endsAt);
  }
}
