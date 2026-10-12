import { performance } from 'node:perf_hooks';
import type { AuthContext, Client, RoomException } from '@colyseus/core';
import { Protocol, Room, ServerError } from '@colyseus/core';
import type { ScenarioRace, SparringRace } from '@bolt/content';
import {
  BASELINE_BLUEPRINT,
  createAiRace,
  createScenarioRace,
  defaultRaceSeed,
} from '@bolt/content';
import type {
  ControlInput,
  DriveSession,
  ErrorCode,
  MatchPhase,
  RaceEvent,
  TrackDefinition,
  TrackRuntime,
} from '@bolt/shared';
import {
  ClientMessage,
  INPUT_PACKET_HZ,
  MAX_QUEUED_INPUTS,
  SIM_HZ,
  SNAPSHOT_HZ,
  ServerMessage,
  applyScenario,
  buildTrack,
  eventVisibleTo,
  playerInputMessageSchema,
  resetRace,
  stepRaceWithBrains,
} from '@bolt/shared';
import type { MatchPhaseMessage } from '@bolt/shared';
import type { DriveRoomTuning } from '../config.js';
import type { GuestSessions } from '../security/guestSessions.js';
import type { Logger } from '../telemetry/log.js';
import { errorFields } from '../telemetry/log.js';
import type { DriveAuth } from './driveJoin.js';
import {
  asJoinError,
  getScenario,
  getTemplate,
  joinError,
  parseJoinOptions,
  resolveCar,
  resolveCourse,
} from './driveJoin.js';
import { InputPacer } from './inputPacer.js';
import { DriveState, writeDriveState, writeRaceState } from './schema.js';

/**
 * The Milestone C race room: one driver against a sparring rival on one track. The server owns
 * time, physics, combat and checkpoint progress; the client only ever submits control samples
 * (steering, brake, fire and utility buttons). The rival is driven by a brain that sends the
 * same kind of sample.
 *
 * The whole race advances once per control sample of its one human driver (see InputPacer):
 * the race is a pure function of that sample sequence and the seed, which is what lets the
 * client predict its own car exactly and lets the offline link reproduce a race bit for bit.
 * A room with two human drivers (Milestone E) will step on room ticks instead.
 */

export type DriveRoomDeps = {
  guests: GuestSessions;
  logger: Logger;
  tuning: DriveRoomTuning;
  maxRooms: number;
  roomCount: () => number;
};

/** Payload of `ServerMessage.MATCH_PHASE`. */
export type { MatchPhaseMessage };

/** WebSocket close code used when the server removes a connection for abusing the protocol. */
export const CLOSE_CODE_ABUSE = 4429;

const STEP_MS = 1000 / SIM_HZ;
/**
 * Most steps one timer callback may run. After a stall the excess time is dropped rather
 * than replayed, so a slow tick can never snowball into a longer one.
 */
const MAX_CATCH_UP_STEPS = 5;
/** Messages accepted per one-second window: three times the nominal input packet rate. */
const MAX_MESSAGES_PER_WINDOW = INPUT_PACKET_HZ * 3;
/** A single window this far over the nominal rate is a flood, not jitter. */
const FLOOD_MESSAGES_PER_WINDOW = INPUT_PACKET_HZ * 10;
const MAX_FLOODED_WINDOWS = 3;
const RESET_COOLDOWN_TICKS = SIM_HZ;
/** Index of the human driver's car on the grid. The rival takes the other slot. */
const PLAYER_CAR = 0;
/** Events kept for a driver whose connection has dropped, delivered in order when it is back. */
const MAX_HELD_EVENTS = 512;
/** What a scenario room reports as its rival: the scenario supplies the car, not a template. */
const SCENARIO_RIVAL = {
  id: 'scenario',
  group: 'example' as const,
  name: 'Scenario',
  description: '',
  blueprint: BASELINE_BLUEPRINT,
};

// Building a track samples every spline and fills the spatial grids, which takes far longer
// than a tick. The result is immutable, so every room on a track shares one instance.
const trackCache = new Map<string, TrackRuntime>();

function trackRuntimeFor(def: TrackDefinition): TrackRuntime {
  let runtime = trackCache.get(def.id);
  if (!runtime) {
    runtime = buildTrack(def);
    trackCache.set(def.id, runtime);
  }
  return runtime;
}

/**
 * Everything the room tracks for one driver. Kept apart from the room so the two-player
 * rooms planned for Milestone E can hold one of these per seat.
 */
class DrivePlayer {
  /** Queued control samples and the policy for consuming them, one tick at a time. */
  readonly inputs = new InputPacer(MAX_QUEUED_INPUTS);
  connected = true;
  /** Set when the server itself ends the connection, so no reconnection window is offered. */
  removed = false;
  leaveReason: 'consented' | 'requested' | 'removed' = 'consented';
  windowMessages = 0;
  floodedWindows = 0;
  malformedMessages = 0;
  windowHadMalformed = false;
  lastResetTick = -RESET_COOLDOWN_TICKS;
  lastPhase: MatchPhase;
  /** Events that happened while the connection was down. */
  readonly heldEvents: RaceEvent[] = [];
  /** One control slot per car; only the player's is ever filled. */
  readonly controls: Array<ControlInput | undefined> = [];

  constructor(
    readonly guestId: string,
    readonly sparring: SparringRace,
    /** Set when the room hosts a showcase scenario instead of a race. */
    readonly scenario: ScenarioRace | null = null,
  ) {
    this.lastPhase = this.session.phase;
  }

  /** The player's own car within the race. Looked up each time: a reset rebuilds the grid. */
  get session(): DriveSession {
    return this.sparring.race.cars[PLAYER_CAR]!.session;
  }
}

export function createDriveRoom(deps: DriveRoomDeps): new () => Room<DriveState> {
  const { tuning } = deps;
  const idleTicks = Math.round(tuning.idleSeconds * SIM_HZ);

  return class DriveRoom extends Room<DriveState, unknown, unknown, DriveAuth> {
    private readonly players = new Map<string, DrivePlayer>();
    private log: Logger = deps.logger;
    private track!: TrackRuntime;
    private trackId = '';
    private weatherPresetId = '';
    private roomTick = 0;
    private accumulatorMs = 0;
    private lastPumpMs = 0;
    /** Set once the room has decided to shut itself down, so the loop stops asking. */
    private closing = false;

    /**
     * Runs during matchmaking, before a room or seat exists, so a refused join costs the
     * server nothing. Colyseus 0.16 ignores an instance-level `onAuth` once this is defined.
     */
    static override async onAuth(
      _token: string,
      options: unknown,
      _context: AuthContext,
    ): Promise<DriveAuth> {
      try {
        const join = parseJoinOptions(options);
        const guest = await deps.guests.authenticate(join.guestToken);
        if (!guest) throw joinError('UNAUTHORIZED');
        resolveCourse(join.trackId, join.weatherPresetId);
        // Validates the whole build against the server's catalog. The canonical blueprint
        // it returns, not the one the client sent, is what the room goes on to use.
        const car = resolveCar(join.blueprint, join.trackId, join.weatherPresetId);
        // Choosing the rival, the seed or a scenario is for reviews and tests.
        const debug =
          join.rivalTemplateId !== undefined ||
          join.seed !== undefined ||
          join.scenarioId !== undefined;
        if (debug && !tuning.debugOptions)
          throw joinError('BAD_REQUEST', 'Those options are not available on this server.');
        // The rival is a shipped template named by id, never a blueprint from the client.
        if (join.rivalTemplateId !== undefined && !getTemplate(join.rivalTemplateId))
          throw joinError('BAD_REQUEST', 'That rival is not available.');
        if (join.scenarioId !== undefined) {
          const scenario = getScenario(join.scenarioId);
          if (!scenario || scenario.trackId !== join.trackId)
            throw joinError('BAD_REQUEST', 'That scenario is not available.');
          if (scenario.weatherPresetId !== join.weatherPresetId)
            throw joinError('BAD_REQUEST', 'That scenario is not available.');
        }
        if (deps.roomCount() >= deps.maxRooms) throw joinError('SERVER_FULL');
        const auth: DriveAuth = {
          guestId: guest.guestId,
          trackId: join.trackId,
          weatherPresetId: join.weatherPresetId,
          blueprint: car.blueprint,
        };
        if (join.difficulty !== undefined) auth.difficulty = join.difficulty;
        if (join.rivalTemplateId !== undefined) auth.rivalTemplateId = join.rivalTemplateId;
        if (join.seed !== undefined) auth.seed = join.seed;
        if (join.scenarioId !== undefined) auth.scenarioId = join.scenarioId;
        return auth;
      } catch (error) {
        throw asJoinError(error, (cause) => deps.logger.error('join_failed', errorFields(cause)));
      }
    }

    override onCreate(options: unknown): void {
      try {
        this.create(options);
      } catch (error) {
        throw asJoinError(error, (cause) =>
          this.log.error('room_create_failed', errorFields(cause)),
        );
      }
    }

    override onJoin(client: Client<unknown, DriveAuth>, _options: unknown, auth?: DriveAuth): void {
      try {
        this.admitPlayer(client, auth);
      } catch (error) {
        throw asJoinError(error, (cause) =>
          this.log.error('player_join_failed', errorFields(cause)),
        );
      }
    }

    private create(options: unknown): void {
      // Options were validated by onAuth, but this is still client data arriving through a
      // different door, so the room parses it again rather than assume.
      const join = parseJoinOptions(options);
      const course = resolveCourse(join.trackId, join.weatherPresetId);
      this.track = trackRuntimeFor(course.track);
      this.trackId = join.trackId;
      this.weatherPresetId = join.weatherPresetId;
      this.log = deps.logger.child({ roomId: this.roomId, trackId: this.trackId });

      // Solo for now. Rooms for two drivers arrive with multiplayer in Milestone E.
      this.maxClients = 1;
      this.state = new DriveState();
      this.patchRate = 1000 / SNAPSHOT_HZ;

      this.onMessage(ClientMessage.PLAYER_INPUT, (client, message: unknown) =>
        this.onPlayerInput(client, message),
      );
      this.onMessage(ClientMessage.RESET_CAR, (client, message: unknown) =>
        this.onResetCar(client, message),
      );
      this.onMessage(ClientMessage.READY, (client) => void this.admit(client));
      this.onMessage(ClientMessage.LEAVE, (client) => this.onLeaveRequest(client));
      // Without a catch-all Colyseus closes the socket on the first unknown type. Counting it
      // as a strike instead keeps one stray message from ending an honest player's run.
      this.onMessage('*', (client) => {
        const player = this.admit(client);
        if (player) this.strike(client, player);
      });

      // The timer fires at twice the step rate and the accumulator decides how many whole
      // steps are due, so timer jitter moves when a step runs but never how many run.
      this.lastPumpMs = performance.now();
      this.setSimulationInterval(() => this.pump(), STEP_MS / 2);
      this.log.info('room_created', { weatherPresetId: this.weatherPresetId });
    }

    private admitPlayer(client: Client<unknown, DriveAuth>, auth: DriveAuth | undefined): void {
      if (!auth || auth.trackId !== this.trackId || auth.weatherPresetId !== this.weatherPresetId) {
        throw joinError('BAD_REQUEST');
      }
      const course = resolveCourse(auth.trackId, auth.weatherPresetId);
      // Derived again from the blueprint on arrival: totals, mass and coefficients are never
      // carried across the seat reservation, let alone taken from the client.
      const car = resolveCar(auth.blueprint, auth.trackId, auth.weatherPresetId);
      const seed = auth.seed ?? defaultRaceSeed(car.buildHash, auth.trackId);
      let sparring: SparringRace | null;
      let scenario: ScenarioRace | null = null;
      let aiInfo: { difficulty: string; style: string; strategy: string } | null = null;
      if (auth.scenarioId !== undefined) {
        // A showcase scenario: both cars are the scenario's, on its marks, on its script.
        const def = getScenario(auth.scenarioId);
        scenario = def ? createScenarioRace(def, this.track) : null;
        sparring = scenario
          ? {
              race: scenario.race,
              brains: [null, scenario.brains[1] ?? null],
              rival: SCENARIO_RIVAL,
              seed,
            }
          : null;
      } else {
        // The AI rival (Milestone D): it builds for this course from the same catalog and
        // budget, or races a named shipped template when a debug join asks for one.
        const ai = createAiRace(
          this.track,
          auth.weatherPresetId,
          course.env,
          car.conditions,
          { build: car.build, params: car.params, buildHash: car.buildHash },
          seed,
          {
            ...(auth.difficulty !== undefined ? { difficulty: auth.difficulty } : {}),
            ...(auth.rivalTemplateId !== undefined
              ? { rivalTemplateId: auth.rivalTemplateId }
              : {}),
          },
        );
        sparring = ai;
        if (ai)
          aiInfo = {
            difficulty: ai.difficulty,
            style: ai.style,
            strategy: ai.pick?.strategy ?? 'template',
          };
      }
      if (!sparring) throw joinError('BAD_REQUEST', 'That rival is not available.');
      const player = new DrivePlayer(auth.guestId, sparring, scenario);
      this.players.set(client.sessionId, player);
      this.state.buildHash = sparring.race.cars[PLAYER_CAR]!.buildHash;
      // The opening phase reaches the client with its first state snapshot. MATCH_PHASE is
      // only sent for later changes, since nothing can be listening for it this early.
      this.writeState(player);
      this.log.info('player_joined', {
        guestId: auth.guestId,
        sessionId: client.sessionId,
        buildHash: car.buildHash,
        totalCost: car.totalCost,
        rival: sparring.rival.id,
        seed,
        ...(aiInfo ?? {}),
      });
    }

    override async onLeave(client: Client<unknown, DriveAuth>, consented?: boolean): Promise<void> {
      const player = this.players.get(client.sessionId);
      if (!player) return;
      player.connected = false;
      // Whatever was queued or held belongs to a connection that no longer exists. The car
      // coasts on neutral input until its driver is back.
      player.inputs.clear();

      if (consented || player.removed) {
        this.players.delete(client.sessionId);
        this.log.info('player_left', { sessionId: client.sessionId, reason: player.leaveReason });
        return;
      }

      this.log.info('player_disconnected', {
        sessionId: client.sessionId,
        graceSeconds: tuning.reconnectSeconds,
      });
      try {
        const back = await this.allowReconnection(client, tuning.reconnectSeconds);
        player.connected = true;
        player.inputs.touch();
        // What happened while the line was down arrives now, once and in order.
        for (const event of player.heldEvents) back.send(ServerMessage.RACE_EVENT, event);
        player.heldEvents.length = 0;
        this.log.info('player_reconnected', { sessionId: client.sessionId });
      } catch {
        this.players.delete(client.sessionId);
        this.log.info('player_left', { sessionId: client.sessionId, reason: 'reconnect_timeout' });
      }
    }

    override onDispose(): void {
      this.log.info('room_disposed', { ticks: this.roomTick });
    }

    /**
     * Defining this makes Colyseus wrap every handler and timer in a try/catch, so a bug in
     * one room is logged and contained instead of taking the whole process down.
     */
    override onUncaughtException(error: RoomException<this>, methodName: string): void {
      // Refused joins pass through here too. They are expected and already explained to
      // the client, so only genuine faults are reported.
      if (error.cause instanceof ServerError) return;
      this.log.error('room_exception', { methodName, ...errorFields(error.cause ?? error) });
      // A simulation that throws would throw again on every tick. Close the room cleanly.
      if (methodName === 'setSimulationInterval') this.close();
    }

    // --- Simulation ---------------------------------------------------------------------------

    private close(): void {
      if (this.closing) return;
      this.closing = true;
      void this.disconnect();
    }

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
      }
    }

    private step(): void {
      this.roomTick += 1;
      const windowEnded = this.roomTick % SIM_HZ === 0;
      for (const [sessionId, player] of this.players) {
        this.stepPlayer(sessionId, player);
        if (windowEnded) this.closeMessageWindow(sessionId, player);
        if (player.connected && player.inputs.ticksSinceInput > idleTicks) {
          this.log.info('room_idle_timeout', { sessionId });
          this.close();
          return;
        }
      }
    }

    private stepPlayer(sessionId: string, player: DrivePlayer): void {
      const { race, brains } = player.sparring;
      // The pacer runs the race once per sample, in order. On a tick with no sample the race
      // may wait briefly and catch up afterwards; see InputPacer for why.
      player.inputs.tick(player.connected, (control) => {
        player.controls[PLAYER_CAR] = control;
        const script = player.scenario?.brains[PLAYER_CAR];
        if (script) {
          // In a scenario the car keeps to its scripted lane and speed; the buttons are the
          // client's own, so every fire command still crosses the wire and is judged here.
          const driven = script.control(race, PLAYER_CAR);
          driven.fire = control.fire ?? 0;
          driven.use = control.use ?? 0;
          driven.target = control.target ?? 0;
          player.controls[PLAYER_CAR] = driven;
        }
        stepRaceWithBrains(race, player.controls, brains);
        if (race.events.length > 0) this.forward(sessionId, player, race.events);
        if (player.session.phase !== player.lastPhase) this.announcePhase(player);
      });
      this.writeState(player);
    }

    private writeState(player: DrivePlayer): void {
      writeDriveState(this.state, player.session, player.inputs.ackSequence);
      writeRaceState(this.state, player.sparring.race, PLAYER_CAR);
    }

    /**
     * Sends the step's events to the driver, in order. What only the other driver should know
     * (its refused commands, its warnings) and its checkpoint crossings are left out. While the
     * connection is down the events are held and delivered on reconnection.
     */
    private forward(sessionId: string, player: DrivePlayer, events: readonly RaceEvent[]): void {
      const client = player.connected ? this.clients.getById(sessionId) : undefined;
      for (const event of events) {
        if (!eventVisibleTo(event, PLAYER_CAR)) continue;
        if (client) client.send(ServerMessage.RACE_EVENT, event);
        else if (player.heldEvents.length < MAX_HELD_EVENTS) player.heldEvents.push(event);
      }
    }

    private announcePhase(player: DrivePlayer): void {
      const session = player.session;
      player.lastPhase = session.phase;
      this.broadcast(ServerMessage.MATCH_PHASE, {
        phase: session.phase,
        tick: session.tick,
      } satisfies MatchPhaseMessage);
      this.log.info('phase_changed', { phase: session.phase, tick: session.tick });
    }

    // --- Messages -----------------------------------------------------------------------------

    /**
     * Gate for every inbound message. Returns the sender's player when the message may be
     * processed, or undefined when it must be dropped.
     */
    private admit(client: Client): DrivePlayer | undefined {
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

    private closeMessageWindow(sessionId: string, player: DrivePlayer): void {
      player.floodedWindows =
        player.windowMessages > MAX_MESSAGES_PER_WINDOW ? player.floodedWindows + 1 : 0;
      // Strikes fade one per clean second, so occasional garbage over a long session is
      // forgiven while a steady stream still adds up.
      if (!player.windowHadMalformed && player.malformedMessages > 0) player.malformedMessages -= 1;
      player.windowMessages = 0;
      player.windowHadMalformed = false;

      if (player.floodedWindows >= MAX_FLOODED_WINDOWS && !player.removed) {
        const client = this.clients.getById(sessionId);
        if (client)
          this.remove(
            client,
            player,
            'RATE_LIMITED',
            'You were disconnected for sending too many messages.',
          );
      }
    }

    private strike(client: Client, player: DrivePlayer): void {
      player.malformedMessages += 1;
      player.windowHadMalformed = true;
      if (player.malformedMessages > tuning.maxMalformedMessages) {
        this.remove(
          client,
          player,
          'BAD_REQUEST',
          'You were disconnected because the game sent invalid data.',
        );
      }
    }

    private remove(client: Client, player: DrivePlayer, code: ErrorCode, message: string): void {
      if (player.removed) return;
      player.removed = true;
      player.leaveReason = 'removed';
      this.log.warn('player_removed', {
        sessionId: client.sessionId,
        guestId: player.guestId,
        code,
      });
      client.send(ServerMessage.ERROR, { code, message });
      client.leave(CLOSE_CODE_ABUSE, code);
    }

    private onPlayerInput(client: Client, message: unknown): void {
      const player = this.admit(client);
      if (!player) return;
      const parsed = playerInputMessageSchema.safeParse(message);
      if (!parsed.success) {
        this.strike(client, player);
        return;
      }
      // Duplicates and stale sequences are normal traffic and are skipped without penalty.
      player.inputs.accept(parsed.data.inputs);
    }

    private onResetCar(client: Client, message: unknown): void {
      const player = this.admit(client);
      if (!player) return;
      if (message !== undefined && message !== null) {
        this.strike(client, player);
        return;
      }
      if (this.roomTick - player.lastResetTick < RESET_COOLDOWN_TICKS) return;
      player.lastResetTick = this.roomTick;
      player.inputs.touch();

      // The whole race goes back to the grid: both cars repaired and reloaded, the rival's
      // choices replayed from the same seed.
      resetRace(player.sparring.race);
      for (const brain of player.sparring.brains) brain?.reset();
      if (player.scenario) {
        for (const brain of player.scenario.brains) brain.reset();
        applyScenario(player.sparring.race, player.scenario.def);
      }
      // Samples queued before the reset describe a car that is no longer there. The sequence
      // high-water mark is kept so none of them can be replayed afterwards.
      player.inputs.clear();
      if (player.session.phase !== player.lastPhase) this.announcePhase(player);
      this.writeState(player);
      this.log.info('car_reset', { sessionId: client.sessionId });
    }

    private onLeaveRequest(client: Client): void {
      const player = this.players.get(client.sessionId);
      if (!player) return;
      // The close is initiated here rather than by the client, so mark it as final up front
      // instead of trusting whichever close code comes back.
      player.removed = true;
      player.leaveReason = 'requested';
      client.leave(Protocol.WS_CLOSE_CONSENTED);
    }
  };
}
