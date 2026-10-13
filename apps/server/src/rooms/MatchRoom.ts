import { randomInt } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { AuthContext, Client, Deferred, RoomException } from '@colyseus/core';
import { Protocol, Room, ServerError } from '@colyseus/core';
import { StateView } from '@colyseus/schema';
import { CATALOG, CATALOG_VERSION, TRACKS } from '@bolt/content';
import type {
  BuildLockedMessage,
  BuildResultMessage,
  ErrorCode,
  MatchPhase,
  MatchProfile,
  MatchRoomPhaseMessage,
  RaceEvent,
  RaceResult,
  TickInputPolicy,
  TrackDefinition,
  TrackRuntime,
  VehicleBlueprint,
  WelcomeMessage,
} from '@bolt/shared';
import {
  INPUT_PACKET_HZ,
  MatchClientMessage,
  MatchServerMessage,
  PROTOCOL_VERSION,
  SIM_HZ,
  SNAPSHOT_HZ,
  buildTrack,
  createAiBrain,
  createRace,
  matchInputMessageSchema,
  matchSeatOptionsSchema,
  pingSchema,
  profileSchema,
  publicBlueprint,
  rematchVoteSchema,
  selectTrackSchema,
  serializeBlueprint,
  submitBuildSchema,
} from '@bolt/shared';
import type { GuestSessions } from '../security/guestSessions.js';
import type { Logger } from '../telemetry/log.js';
import { errorFields } from '../telemetry/log.js';
import { asJoinError, joinError, resolveCar, resolveCourse } from './driveJoin.js';
import type { MatchCodeRegistry } from './matchCodes.js';
import { recordMatch } from './matchLog.js';
import type { Course, MatchEffects, MatchTiming, RacePlan } from './matchMachine.js';
import { DEFAULT_MATCH_TIMING, MatchMachine } from './matchMachine.js';
import { MatchState, SeatState } from './matchSchema.js';
import { RaceHost } from './raceHost.js';
import { DriveState } from './schema.js';

/**
 * Race a Friend (Milestone E, docs/MULTIPLAYER.md): one private room for two people from the
 * invite to the last rematch. `MatchMachine` owns the phases and deadlines; this room carries
 * them out on Colyseus, validates every message, holds each player's build, and runs the race
 * through the same `RaceHost` as the race against the computer, with two people in it.
 *
 * Nobody reaches this room through the matchmaker's own endpoints (the guard allows `create`
 * and `joinOrCreate` for the drive room only): seats are reserved by `routes/match.ts`, which
 * authenticates the guest, rate limits code guesses and finds the room by its code.
 */

export type MatchRoomTuning = {
  timing: MatchTiming;
  /** Malformed messages tolerated on one connection before it is closed. */
  maxMalformedMessages: number;
  /** Build submissions accepted per second; the client sends at most a few. */
  buildSubmissionsPerSecond: number;
  /** Overrides of the room input policy (`TickInputPolicy`). Tests only. */
  inputPolicy: Partial<TickInputPolicy>;
  /** Laps per race instead of the track's own; zero keeps the track's. Tests only. */
  laps: number;
};

export const DEFAULT_MATCH_ROOM_TUNING: Readonly<MatchRoomTuning> = Object.freeze({
  timing: DEFAULT_MATCH_TIMING,
  maxMalformedMessages: 12,
  buildSubmissionsPerSecond: 4,
  inputPolicy: {},
  laps: 0,
});

export type MatchRoomDeps = {
  guests: GuestSessions;
  logger: Logger;
  tuning: MatchRoomTuning;
  codes: MatchCodeRegistry;
  maxRooms: number;
  roomCount: () => number;
};

/** What the room keeps about an admitted player, from the seat reservation. */
export type MatchAuth = {
  guestId: string;
  intent: 'create' | 'join';
  code?: string;
  profile: MatchProfile;
  blueprint: VehicleBlueprint;
  buildHash: string;
};

export const CLOSE_CODE_ABUSE = 4429;
/** The seat was given up (grace over, or the room closed): no reconnection is possible. */
export const CLOSE_CODE_SEAT_FREED = 4410;

const STEP_MS = 1000 / SIM_HZ;
const MAX_CATCH_UP_STEPS = 5;
const MAX_MESSAGES_PER_WINDOW = INPUT_PACKET_HZ * 3;
const FLOOD_MESSAGES_PER_WINDOW = INPUT_PACKET_HZ * 10;
const MAX_FLOODED_WINDOWS = 3;
const MAX_HELD_EVENTS = 512;

/** The track and weather a new lobby shows until the host picks: the first-session course. */
const DEFAULT_COURSE: Course = { trackId: 'city_01', weatherPresetId: 'city_clear_night' };

const trackCache = new Map<string, TrackRuntime>();
function trackRuntimeFor(def: TrackDefinition): TrackRuntime {
  let runtime = trackCache.get(def.id);
  if (!runtime) {
    runtime = buildTrack(def);
    trackCache.set(def.id, runtime);
  }
  return runtime;
}

/** Every course a lobby may offer (all eight tracks are baked; DECISIONS 254). */
export function matchCourses(): Course[] {
  const out: Course[] = [];
  for (const def of Object.values(TRACKS))
    for (const weatherPresetId of def.weatherPresetIds)
      out.push({ trackId: def.id, weatherPresetId });
  return out;
}

class MatchPlayer {
  windowMessages = 0;
  floodedWindows = 0;
  malformedMessages = 0;
  windowHadMalformed = false;
  buildSubmissions = 0;
  removed = false;
  latencyMs = 0;
  reconnection: Deferred<Client> | null = null;
  readonly heldEvents: RaceEvent[] = [];
  connected = true;

  constructor(
    public sessionId: string,
    readonly seat: number,
    readonly guestId: string,
  ) {}
}

export function createMatchRoom(deps: MatchRoomDeps): new () => Room<MatchState> {
  const { tuning } = deps;
  const timing = tuning.timing;
  const raceGraceTicks = Math.round((timing.raceGraceMs / 1000) * SIM_HZ);

  return class MatchRoom extends Room<MatchState, unknown, unknown, MatchAuth> {
    private log: Logger = deps.logger;
    private machine!: MatchMachine;
    private code = '';
    private readonly players = new Map<string, MatchPlayer>();
    private readonly bySeat: Array<MatchPlayer | null> = [null, null];
    private host: RaceHost | null = null;
    private hostPlan: RacePlan | null = null;
    private raceSeed = 0;
    private raceStartedAt = 0;
    private resultHandled = false;
    private raceCounter = 0;
    /** Event ids keep growing across the races of a room, so clients can drop repeats by id. */
    private eventFloor = 1;
    private accumulatorMs = 0;
    private lastPumpMs = 0;
    private roomTick = 0;
    private closing = false;

    /**
     * Runs during the seat reservation the HTTP route makes, before any socket exists. Parses
     * the options again (they crossed a process boundary), authenticates the guest and
     * validates the build with the server's catalog.
     */
    static override async onAuth(
      _token: string,
      options: unknown,
      _context: AuthContext,
    ): Promise<MatchAuth> {
      try {
        if ((options as { protocolVersion?: unknown } | null)?.protocolVersion !== PROTOCOL_VERSION)
          throw joinError('VERSION_MISMATCH');
        const parsed = matchSeatOptionsSchema.safeParse(options);
        if (!parsed.success) throw joinError('BAD_REQUEST');
        const join = parsed.data;
        const guest = await deps.guests.authenticate(join.guestToken);
        if (!guest) throw joinError('UNAUTHORIZED');
        if (join.intent === 'create' && deps.roomCount() >= deps.maxRooms)
          throw joinError('SERVER_FULL');
        const car = resolveCar(
          join.blueprint,
          DEFAULT_COURSE.trackId,
          DEFAULT_COURSE.weatherPresetId,
        );
        const auth: MatchAuth = {
          guestId: guest.guestId,
          intent: join.intent,
          profile: join.profile,
          blueprint: car.blueprint,
          buildHash: car.buildHash,
        };
        if (join.code !== undefined) auth.code = join.code;
        return auth;
      } catch (error) {
        throw asJoinError(error, (cause) =>
          deps.logger.error('match_join_failed', errorFields(cause)),
        );
      }
    }

    override onCreate(): void {
      this.maxClients = 2;
      this.state = new MatchState();
      this.patchRate = 1000 / SNAPSHOT_HZ;
      this.code = deps.codes.issue(this.roomId);
      this.state.code = this.code;
      this.log = deps.logger.child({ roomId: this.roomId });
      for (const key of ['0', '1']) {
        this.state.seats.set(key, new SeatState());
        this.state.views.set(key, new DriveState());
      }
      const now = Date.now();
      const courses = matchCourses();
      this.machine = new MatchMachine(
        timing,
        this.effects(),
        DEFAULT_COURSE,
        () => courses[randomInt(courses.length)]!,
        now,
      );
      this.writeCourse();

      const on = MatchClientMessage;
      this.onMessage(on.SELECT_TRACK, (client, message: unknown) =>
        this.onSelectTrack(client, message),
      );
      this.onMessage(on.LOCK_TRACK, (client, message: unknown) =>
        this.bare(client, message, (p) => this.machine.lockCourse(p.seat, Date.now())),
      );
      this.onMessage(on.ROOM_READY, (client, message: unknown) =>
        this.bare(client, message, (p) => this.machine.roomReady(p.seat, Date.now())),
      );
      this.onMessage(on.SUBMIT_BUILD, (client, message: unknown) =>
        this.onBuild(client, message, false),
      );
      this.onMessage(on.READY, (client, message: unknown) => this.onBuild(client, message, true));
      this.onMessage(on.PLAYER_INPUT, (client, message: unknown) => this.onInput(client, message));
      this.onMessage(on.NEUTRAL, (client, message: unknown) =>
        this.bare(client, message, (p) => {
          if (this.host && this.hostPlan) this.host.markAway(this.hostPlan.carOfSeat[p.seat]!);
        }),
      );
      this.onMessage(on.REMATCH_VOTE, (client, message: unknown) => this.onVote(client, message));
      this.onMessage(on.PROFILE, (client, message: unknown) => this.onProfile(client, message));
      this.onMessage(on.REOPEN, (client, message: unknown) =>
        this.bare(client, message, (p) => this.machine.reopen(p.seat, Date.now())),
      );
      this.onMessage(on.PING, (client, message: unknown) => this.onPing(client, message));
      this.onMessage(on.LEAVE, (client) => this.onLeaveRequest(client));
      this.onMessage('*', (client) => {
        const player = this.admit(client);
        if (player) this.strike(client, player);
      });

      this.lastPumpMs = performance.now();
      this.setSimulationInterval(() => this.pump(), STEP_MS / 2);
      this.log.info('match_created', {});
    }

    /** For the HTTP route, through the matchmaker: may this guest take a seat? */
    canSeat(guestId: string): 'ok' | 'full' | 'already_seated' | 'closed' {
      if (this.machine.closed || this.closing) return 'closed';
      if (this.machine.seatOf(guestId) >= 0) return 'already_seated';
      const free = this.machine.occupied() < 2;
      const open =
        this.machine.phase === 'CREATED' || this.machine.phase === 'WAITING_FOR_OPPONENT';
      return free && open ? 'ok' : 'full';
    }

    override onJoin(client: Client<unknown, MatchAuth>, _options: unknown, auth?: MatchAuth): void {
      try {
        if (!auth) throw joinError('BAD_REQUEST');
        if (auth.intent === 'join' && auth.code !== this.code)
          throw new ServerError(4404, 'This invite has expired. Ask your friend for a new link.');
        if (auth.intent === 'create' && this.machine.occupied() > 0) throw joinError('BAD_REQUEST');
        const seat = this.machine.join(
          auth.guestId,
          auth.profile,
          auth.blueprint,
          auth.buildHash,
          Date.now(),
        );
        if (typeof seat !== 'number')
          throw new ServerError(
            4409,
            seat === 'already_seated'
              ? 'You are already in this lobby on another screen.'
              : 'This lobby is full.',
          );
        const player = new MatchPlayer(client.sessionId, seat, auth.guestId);
        this.players.set(client.sessionId, player);
        this.bySeat[seat] = player;
        this.attachView(client, seat);
        client.send(MatchServerMessage.WELCOME, { seat, code: this.code } satisfies WelcomeMessage);
        this.syncSeats();
        this.log.info('match_player_joined', {
          sessionId: client.sessionId,
          guestId: auth.guestId,
          seat,
        });
      } catch (error) {
        throw asJoinError(error, (cause) =>
          this.log.error('match_join_failed', errorFields(cause)),
        );
      }
    }

    private attachView(client: Client, seat: number): void {
      const view = new StateView();
      view.add(this.state.views.get(String(seat))!);
      client.view = view;
    }

    override async onLeave(client: Client<unknown, MatchAuth>, consented?: boolean): Promise<void> {
      const player = this.players.get(client.sessionId);
      if (!player) return;
      const now = Date.now();
      player.connected = false;
      const seatOfHost = this.raceSeat(player.seat);
      if (seatOfHost) seatOfHost.connected = false;
      if (consented || player.removed) {
        this.forget(player);
        if (this.machine.seats[player.seat]?.guestId === player.guestId)
          this.machine.leave(player.seat, now, 'left');
        this.syncSeats();
        this.log.info('match_player_left', { sessionId: client.sessionId, seat: player.seat });
        return;
      }
      this.machine.drop(player.seat, now);
      this.syncSeats();
      this.log.info('match_player_disconnected', {
        sessionId: client.sessionId,
        seat: player.seat,
      });
      try {
        const pending = this.allowReconnection(
          client,
          Math.ceil(this.machine.longestGraceMs / 1000),
        );
        player.reconnection = pending;
        const back = await pending;
        player.reconnection = null;
        player.connected = true;
        player.sessionId = back.sessionId;
        this.attachView(back, player.seat);
        this.machine.rejoin(player.seat, Date.now());
        const seat = this.raceSeat(player.seat);
        if (seat) {
          seat.input.restartStream();
          seat.connected = true;
        }
        back.send(MatchServerMessage.WELCOME, {
          seat: player.seat,
          code: this.code,
        } satisfies WelcomeMessage);
        for (const event of player.heldEvents) back.send(MatchServerMessage.RACE_EVENT, event);
        player.heldEvents.length = 0;
        this.syncSeats();
        this.log.info('match_player_reconnected', { sessionId: back.sessionId, seat: player.seat });
      } catch {
        player.reconnection = null;
        // The machine frees the seat when its grace ends; nothing else to do here.
        if (this.machine.seats[player.seat]?.guestId === player.guestId)
          this.machine.leave(player.seat, Date.now(), 'disconnected');
        this.forget(player);
        this.syncSeats();
      }
    }

    private forget(player: MatchPlayer): void {
      this.players.delete(player.sessionId);
      if (this.bySeat[player.seat] === player) this.bySeat[player.seat] = null;
    }

    override onDispose(): void {
      deps.codes.release(this.roomId);
      this.log.info('match_disposed', { rounds: this.machine?.round ?? 0 });
    }

    override onUncaughtException(error: RoomException<this>, methodName: string): void {
      if (error.cause instanceof ServerError) return;
      this.log.error('match_room_exception', { methodName, ...errorFields(error.cause ?? error) });
      if (methodName === 'setSimulationInterval') this.closeRoom();
    }

    // --- What the machine asks for -------------------------------------------------------------

    private effects(): MatchEffects {
      return {
        phaseChanged: (phase, endsAt) => this.onPhase(phase, endsAt),
        startRace: (plan) => this.startRace(plan),
        releaseRace: () => {
          if (this.host) this.host.held = false;
        },
        forfeit: (seat, cause) => {
          if (!this.host || !this.hostPlan) return;
          this.host.concede(this.hostPlan.carOfSeat[seat]!, cause);
        },
        endRace: () => {
          if (this.host) this.eventFloor = Math.max(this.eventFloor, this.host.race.nextEventId);
          this.host = null;
          this.hostPlan = null;
        },
        seatFreed: (seat) => this.freeSeat(seat),
        closeRoom: () => this.closeRoom(),
      };
    }

    private onPhase(phase: MatchPhase, endsAt: number): void {
      if (!this.state) return;
      this.state.phase = phase;
      this.state.phaseEndsAt = endsAt;
      this.state.notice = this.machine?.notice ?? '';
      this.writeCourse();
      this.broadcast(MatchServerMessage.MATCH_PHASE, {
        phase,
        endsAt,
        serverNow: Date.now(),
      } satisfies MatchRoomPhaseMessage);
      this.log.info('match_phase', { phase });
    }

    private writeCourse(): void {
      const m = this.machine;
      if (!m) return;
      this.state.trackId = m.course.trackId;
      this.state.weatherPresetId = m.course.weatherPresetId;
      this.state.randomTrack = m.randomCourse;
      this.state.round = m.round;
    }

    private startRace(plan: RacePlan): void {
      const course = resolveCourse(plan.course.trackId, plan.course.weatherPresetId);
      const track =
        tuning.laps > 0
          ? buildTrack({ ...course.track, laps: tuning.laps })
          : trackRuntimeFor(course.track);
      const cars = plan.builds.map((build) =>
        resolveCar(build, plan.course.trackId, plan.course.weatherPresetId),
      );
      this.raceSeed = randomInt(0x7fffffff);
      const race = createRace(
        track,
        course.env,
        cars.map((car) => ({ build: car.build, params: car.params, buildHash: car.buildHash })),
        { seed: this.raceSeed, conditions: cars[0]!.conditions, catalog: CATALOG },
      );
      // A new race numbers its events from 1; carry on from the last race instead, so an id
      // names one event for the whole life of the room (the client drops repeats by id).
      if (this.host) this.eventFloor = Math.max(this.eventFloor, this.host.race.nextEventId);
      race.nextEventId = this.eventFloor;
      this.raceCounter += 1;
      const raceId = this.raceCounter;
      // A fresh view per seat and race: nothing of the last race lingers in it.
      for (let seat = 0; seat < 2; seat++) {
        const key = String(seat);
        this.state.views.set(key, new DriveState());
        const client = this.clientOfSeat(seat);
        if (client) this.attachView(client, seat);
      }
      const drivers = [0, 1].map((seat) => {
        const carIndex = plan.carOfSeat[seat]!;
        const autopilot = createAiBrain({
          seed: this.raceSeed ^ (0x51ed + carIndex),
          difficulty: 'rookie',
        });
        autopilot.prepare(race, carIndex);
        return {
          carIndex,
          view: this.state.views.get(String(seat))!,
          deliver: (event: RaceEvent) => this.deliver(seat, event),
          autopilot,
        };
      });
      const host = new RaceHost({
        race,
        raceId,
        brains: [null, null],
        drivers,
        policy: tuning.inputPolicy,
        publicBlueprints: cars.map((car) => serializeBlueprint(publicBlueprint(car.blueprint))),
      });
      host.held = true;
      for (let seat = 0; seat < 2; seat++) {
        const s = host.seat(plan.carOfSeat[seat]!);
        if (s) s.connected = this.machine.seats[seat]?.connected ?? false;
      }
      this.host = host;
      this.hostPlan = plan;
      this.resultHandled = false;
      this.raceStartedAt = Date.now();
      this.state.raceId = raceId;
      this.state.swapped = plan.swapped;
      host.writeViews();
      for (let seat = 0; seat < 2; seat++) {
        const car = cars[plan.carOfSeat[seat]!]!;
        this.clientOfSeat(seat)?.send(MatchServerMessage.BUILD_LOCKED, {
          blueprint: car.blueprint,
          buildHash: car.buildHash,
          raceId,
        } satisfies BuildLockedMessage);
      }
      this.log.info('match_race_created', {
        raceId,
        round: plan.round,
        trackId: plan.course.trackId,
        weatherPresetId: plan.course.weatherPresetId,
        seed: this.raceSeed,
        swapped: plan.swapped,
      });
    }

    private freeSeat(seat: number): void {
      const player = this.bySeat[seat];
      if (!player) return;
      this.bySeat[seat] = null;
      player.reconnection?.reject(new Error('seat freed'));
      player.reconnection = null;
      const client = this.clients.getById(player.sessionId);
      if (client && !player.removed) {
        player.removed = true;
        client.leave(CLOSE_CODE_SEAT_FREED);
      }
      this.players.delete(player.sessionId);
      const view = this.state.views.get(String(seat));
      if (view) view.held = true;
    }

    private closeRoom(): void {
      if (this.closing) return;
      this.closing = true;
      deps.codes.release(this.roomId);
      void this.disconnect();
    }

    private clientOfSeat(seat: number): Client | undefined {
      const player = this.bySeat[seat];
      return player && player.connected ? this.clients.getById(player.sessionId) : undefined;
    }

    private raceSeat(seat: number) {
      if (!this.host || !this.hostPlan) return null;
      return this.host.seat(this.hostPlan.carOfSeat[seat]!);
    }

    private deliver(seat: number, event: RaceEvent): void {
      const player = this.bySeat[seat];
      if (!player) return;
      const client = this.clientOfSeat(seat);
      if (client) client.send(MatchServerMessage.RACE_EVENT, event);
      else if (player.heldEvents.length < MAX_HELD_EVENTS) player.heldEvents.push(event);
    }

    // --- The loop ----------------------------------------------------------------------------------

    private pump(): void {
      if (this.closing) return;
      const now = performance.now();
      this.accumulatorMs += now - this.lastPumpMs;
      this.lastPumpMs = now;
      const ceiling = STEP_MS * MAX_CATCH_UP_STEPS;
      if (this.accumulatorMs > ceiling) this.accumulatorMs = ceiling;
      while (this.accumulatorMs >= STEP_MS) {
        this.accumulatorMs -= STEP_MS;
        this.step();
        if (this.closing) return;
      }
    }

    private step(): void {
      this.roomTick += 1;
      const now = Date.now();
      this.machine.update(now);
      if (this.closing) return;
      const host = this.host;
      if (host) {
        host.step();
        const race = host.race;
        if (race.phase === 'RACING' && this.machine.phase === 'COUNTDOWN')
          this.machine.raceStarted(now);
        if (race.result && !this.resultHandled) this.finishRace(race.result, now);
        if (race.phase === 'RACING' && this.host === host) {
          for (let seat = 0; seat < 2; seat++) {
            const s = this.raceSeat(seat);
            const connected = this.machine.seats[seat]?.connected ?? false;
            // Connected but silent for the whole race grace: a page left behind. Forfeit.
            if (s && connected && s.absentTicks > raceGraceTicks)
              this.machine.forfeitRace(seat, now);
          }
        }
      }
      if (this.roomTick % SIM_HZ === 0) this.closeMessageWindows();
      this.syncSeats();
    }

    private finishRace(result: RaceResult, now: number): void {
      this.resultHandled = true;
      const plan = this.hostPlan!;
      this.machine.raceFinished(result, now);
      this.broadcast(MatchServerMessage.RESULTS, { raceId: this.host?.raceId ?? 0, result });
      const forfeitSeat =
        result.forfeit !== undefined ? plan.carOfSeat.indexOf(result.forfeit.car) : -1;
      recordMatch(
        {
          matchId: `${this.roomId}:${plan.round}`,
          roomId: this.roomId,
          round: plan.round,
          trackId: plan.course.trackId,
          weatherPresetId: plan.course.weatherPresetId,
          seed: this.raceSeed,
          catalogVersion: CATALOG_VERSION,
          protocolVersion: PROTOCOL_VERSION,
          swapped: plan.swapped,
          players: [0, 1].map((seat) => ({
            guestId: this.machine.seats[seat]?.guestId ?? this.bySeat[seat]?.guestId ?? '',
            seat,
            car: plan.carOfSeat[seat]!,
            buildHash: this.host?.race.cars[plan.carOfSeat[seat]!]?.buildHash ?? '',
            nickname: this.machine.seats[seat]?.profile.nickname ?? 0,
          })),
          result,
          disconnect:
            forfeitSeat >= 0 && result.forfeit
              ? { seat: forfeitSeat, cause: result.forfeit.cause }
              : null,
          startedAt: new Date(this.raceStartedAt).toISOString(),
          endedAt: new Date(now).toISOString(),
        },
        (error) => this.log.error('match_record_failed', errorFields(error)),
      );
      this.log.info('match_race_finished', {
        round: plan.round,
        winner: result.winner,
        reason: result.reason,
      });
    }

    /** Writes what each seat may know about the other into the shared seat records. */
    private syncSeats(): void {
      const m = this.machine;
      for (let seat = 0; seat < 2; seat++) {
        const target = this.state.seats.get(String(seat))!;
        const s = m.seats[seat];
        target.present = s !== null;
        target.connected = s?.connected ?? false;
        target.host = s?.host ?? false;
        target.nickname = s?.profile.nickname ?? 0;
        target.emblem = s?.profile.emblem ?? 0;
        target.ready = s?.ready ?? false;
        target.loaded = s?.loaded ?? false;
        target.vote = s?.vote ?? '';
        target.car = this.hostPlan && s ? this.hostPlan.carOfSeat[seat]! : -1;
        target.latencyMs = s
          ? Math.min(0xffff, Math.round((this.bySeat[seat]?.latencyMs ?? 0) / 10) * 10)
          : 0;
        target.graceEndsAt = s?.graceEndsAt ?? 0;
      }
      if (this.state.notice !== m.notice) this.state.notice = m.notice;
      this.writeCourse();
    }

    // --- Messages ----------------------------------------------------------------------------------

    private admit(client: Client): MatchPlayer | undefined {
      const player = this.players.get(client.sessionId);
      if (!player || !player.connected || player.removed) return undefined;
      player.windowMessages += 1;
      if (player.windowMessages > FLOOD_MESSAGES_PER_WINDOW) {
        this.remove(
          client,
          player,
          'RATE_LIMITED',
          'You were disconnected for sending too many messages.',
        );
        return undefined;
      }
      return player.windowMessages > MAX_MESSAGES_PER_WINDOW ? undefined : player;
    }

    private closeMessageWindows(): void {
      for (const player of this.players.values()) {
        player.floodedWindows =
          player.windowMessages > MAX_MESSAGES_PER_WINDOW ? player.floodedWindows + 1 : 0;
        if (!player.windowHadMalformed && player.malformedMessages > 0)
          player.malformedMessages -= 1;
        player.windowMessages = 0;
        player.windowHadMalformed = false;
        player.buildSubmissions = 0;
        if (player.floodedWindows >= MAX_FLOODED_WINDOWS && !player.removed) {
          const client = this.clients.getById(player.sessionId);
          if (client)
            this.remove(
              client,
              player,
              'RATE_LIMITED',
              'You were disconnected for sending too many messages.',
            );
        }
      }
    }

    private strike(client: Client, player: MatchPlayer): void {
      player.malformedMessages += 1;
      player.windowHadMalformed = true;
      if (player.malformedMessages > tuning.maxMalformedMessages)
        this.remove(
          client,
          player,
          'BAD_REQUEST',
          'You were disconnected because the game sent invalid data.',
        );
    }

    private remove(client: Client, player: MatchPlayer, code: ErrorCode, message: string): void {
      if (player.removed) return;
      player.removed = true;
      this.log.warn('match_player_removed', {
        sessionId: client.sessionId,
        guestId: player.guestId,
        code,
      });
      client.send(MatchServerMessage.ERROR, { code, message });
      client.leave(CLOSE_CODE_ABUSE, code);
    }

    /** A message that carries no payload. Anything else in it is a strike. */
    private bare(
      client: Client,
      message: unknown,
      act: (player: MatchPlayer) => boolean | void,
    ): void {
      const player = this.admit(client);
      if (!player) return;
      if (message !== undefined && message !== null) {
        this.strike(client, player);
        return;
      }
      act(player);
      this.syncSeats();
    }

    private onSelectTrack(client: Client, message: unknown): void {
      const player = this.admit(client);
      if (!player) return;
      const parsed = selectTrackSchema.safeParse(message);
      if (!parsed.success) {
        this.strike(client, player);
        return;
      }
      const pick = parsed.data;
      if ('random' in pick) this.machine.selectCourse(player.seat, 'random', Date.now());
      else {
        try {
          resolveCourse(pick.trackId, pick.weatherPresetId);
        } catch {
          client.send(MatchServerMessage.ERROR, {
            code: 'UNKNOWN_TRACK',
            message: 'That track is not available.',
          });
          return;
        }
        this.machine.selectCourse(player.seat, pick, Date.now());
      }
      this.syncSeats();
    }

    private onBuild(client: Client, message: unknown, final: boolean): void {
      const player = this.admit(client);
      if (!player) return;
      const parsed = submitBuildSchema.safeParse(message);
      if (!parsed.success) {
        this.strike(client, player);
        return;
      }
      const { requestId, blueprint } = parsed.data;
      const answer = (result: BuildResultMessage): void =>
        client.send(MatchServerMessage.BUILD_RESULT, result);
      player.buildSubmissions += 1;
      if (player.buildSubmissions > tuning.buildSubmissionsPerSecond) {
        answer({
          requestId,
          ok: false,
          code: 'RATE_LIMITED',
          message: 'Saving your build too often. It will catch up.',
        });
        return;
      }
      if (this.machine.phase !== 'BUILDING') {
        answer({ requestId, ok: false, code: 'BAD_REQUEST', message: 'The build phase is over.' });
        return;
      }
      let car;
      try {
        car = resolveCar(
          blueprint,
          this.machine.course.trackId,
          this.machine.course.weatherPresetId,
        );
      } catch (error) {
        const refusal = error instanceof ServerError ? error : joinError('ILLEGAL_BUILD');
        const code = refusalCode(refusal.code);
        answer({ requestId, ok: false, code, message: refusal.message });
        return;
      }
      const now = Date.now();
      const accepted = final
        ? this.machine.ready(player.seat, car.blueprint, car.buildHash, now)
        : this.machine.submitBuild(player.seat, car.blueprint, car.buildHash, now);
      if (!accepted) {
        answer({
          requestId,
          ok: false,
          code: 'BAD_REQUEST',
          message: 'Build locked. Time to race.',
        });
        return;
      }
      answer({ requestId, ok: true, buildHash: car.buildHash, totalCost: car.totalCost });
      this.syncSeats();
    }

    private onInput(client: Client, message: unknown): void {
      const player = this.admit(client);
      if (!player) return;
      const parsed = matchInputMessageSchema.safeParse(message);
      if (!parsed.success) {
        this.strike(client, player);
        return;
      }
      if (!this.host || !this.hostPlan) return;
      this.host.accept(this.hostPlan.carOfSeat[player.seat]!, parsed.data.race, parsed.data.inputs);
    }

    private onVote(client: Client, message: unknown): void {
      const player = this.admit(client);
      if (!player) return;
      const parsed = rematchVoteSchema.safeParse(message);
      if (!parsed.success) {
        this.strike(client, player);
        return;
      }
      this.machine.vote(player.seat, parsed.data.choice, Date.now());
      this.syncSeats();
    }

    private onProfile(client: Client, message: unknown): void {
      const player = this.admit(client);
      if (!player) return;
      const parsed = profileSchema.safeParse(message);
      if (!parsed.success) {
        this.strike(client, player);
        return;
      }
      this.machine.setProfile(player.seat, parsed.data, Date.now());
      this.syncSeats();
    }

    private onPing(client: Client, message: unknown): void {
      const player = this.admit(client);
      if (!player) return;
      const parsed = pingSchema.safeParse(message);
      if (!parsed.success) {
        this.strike(client, player);
        return;
      }
      // The client reports its own round trip with the next ping, for the lobby's quality
      // badge only. It decides nothing.
      if (parsed.data.rtt !== undefined) player.latencyMs = Math.min(5000, parsed.data.rtt);
      client.send(MatchServerMessage.PONG, { t: parsed.data.t, now: Date.now() });
    }

    private onLeaveRequest(client: Client): void {
      const player = this.players.get(client.sessionId);
      if (!player) return;
      client.leave(Protocol.WS_CLOSE_CONSENTED);
    }
  };
}

function refusalCode(code: number): string {
  switch (code) {
    case 4422:
      return 'UNKNOWN_PART';
    case 4426:
      return 'CATALOG_MISMATCH';
    case 4400:
      return 'BAD_REQUEST';
    default:
      return 'ILLEGAL_BUILD';
  }
}
