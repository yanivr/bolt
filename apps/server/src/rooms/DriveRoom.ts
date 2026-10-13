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
  SIM_HZ,
  SNAPSHOT_HZ,
  ServerMessage,
  applyScenario,
  buildTrack,
  playerInputMessageSchema,
  resetRace,
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
import { RaceHost } from './raceHost.js';
import { DriveState } from './schema.js';

/**
 * The race against the computer: one driver against the AI on one track. The server owns time,
 * physics, combat and checkpoint progress; the client only ever submits control samples
 * (steering, brake, fire and utility buttons). The rival is driven by a brain that makes the
 * same kind of sample.
 *
 * The race advances on the room's own 30 Hz clock through `RaceHost`, exactly as a race between
 * two people does in the match room (Milestone E): the driver's samples go through a jitter
 * buffer that hands the race one control per tick. The race starts on the grid only once the
 * driver's first samples are in, so a phone still downloading the track does not lose its
 * countdown.
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
 * Everything the room tracks for one driver, apart from the race itself.
 */
class DrivePlayer {
  connected = true;
  /** Set when the server itself ends the connection, so no reconnection window is offered. */
  removed = false;
  leaveReason: 'consented' | 'requested' | 'removed' = 'consented';
  windowMessages = 0;
  floodedWindows = 0;
  malformedMessages = 0;
  windowHadMalformed = false;
  lastResetTick = -RESET_COOLDOWN_TICKS;
  /** Room tick of the last input packet, for the idle timeout. */
  lastInputTick = 0;
  /** Events that happened while the connection was down. */
  readonly heldEvents: RaceEvent[] = [];
  host!: RaceHost;

  constructor(
    readonly guestId: string,
    readonly sparring: SparringRace,
    /** Set when the room hosts a showcase scenario instead of a race. */
    readonly scenario: ScenarioRace | null = null,
  ) {}

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
      this.onMessage(ClientMessage.NEUTRAL, (client, message: unknown) =>
        this.onNeutral(client, message),
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
      player.lastInputTick = this.roomTick;
      player.host = this.createHost(client.sessionId, player, 1);
      this.players.set(client.sessionId, player);
      this.state.buildHash = sparring.race.cars[PLAYER_CAR]!.buildHash;
      // The opening phase reaches the client with its first state snapshot. MATCH_PHASE is
      // only sent for later changes, since nothing can be listening for it this early.
      player.host.writeViews();
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

    /** The race host for this driver's race: the person on car 0, the AI (or script) on car 1. */
    private createHost(sessionId: string, player: DrivePlayer, raceId: number): RaceHost {
      const script = player.scenario?.brains[PLAYER_CAR];
      const host = new RaceHost({
        race: player.sparring.race,
        raceId,
        brains: player.sparring.brains,
        policy: tuning.inputPolicy,
        drivers: [
          {
            carIndex: PLAYER_CAR,
            view: this.state,
            deliver: (event) => this.forward(sessionId, player, event),
          },
        ],
        // In a scenario the car keeps to its scripted lane and speed; the buttons are the
        // client's own, so every fire command still crosses the wire and is judged here.
        ...(script
          ? {
              transform: (index: number, control: ControlInput) => {
                const driven = script.control(player.sparring.race, index);
                driven.fire = control.fire ?? 0;
                driven.use = control.use ?? 0;
                driven.target = control.target ?? 0;
                return driven;
              },
            }
          : {}),
      });
      // The race waits on the grid for the driver's first samples.
      host.awaitingDrivers = true;
      return host;
    }

    override async onLeave(client: Client<unknown, DriveAuth>, consented?: boolean): Promise<void> {
      const player = this.players.get(client.sessionId);
      if (!player) return;
      player.connected = false;
      // The car coasts on neutral input until its driver is back.
      const seat = player.host.seat(PLAYER_CAR);
      if (seat) seat.connected = false;

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
        player.lastInputTick = this.roomTick;
        const again = player.host.seat(PLAYER_CAR);
        if (again) {
          // Samples queued for the old connection are gone; the stream starts again.
          again.input.restartStream();
          again.connected = true;
        }
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
        const { phase, changed } = player.host.step();
        if (changed) this.announcePhase(phase, player);
        if (windowEnded) this.closeMessageWindow(sessionId, player);
        if (player.connected && this.roomTick - player.lastInputTick > idleTicks) {
          this.log.info('room_idle_timeout', { sessionId });
          this.close();
          return;
        }
      }
    }

    /**
     * Sends one of the race's events to the driver. What only the other driver should know (its
     * refused commands, its warnings, its checkpoint crossings, its hidden traps) has already
     * been left out by the race host. While the connection is down the events are held and
     * delivered on reconnection.
     */
    private forward(sessionId: string, player: DrivePlayer, event: RaceEvent): void {
      const client = player.connected ? this.clients.getById(sessionId) : undefined;
      if (client) client.send(ServerMessage.RACE_EVENT, event);
      else if (player.heldEvents.length < MAX_HELD_EVENTS) player.heldEvents.push(event);
    }

    private announcePhase(phase: MatchPhase, player: DrivePlayer): void {
      const session = player.session;
      this.broadcast(ServerMessage.MATCH_PHASE, {
        phase,
        tick: session.tick,
      } satisfies MatchPhaseMessage);
      this.log.info('phase_changed', { phase, tick: session.tick });
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
      // Duplicates, stale sequences and packets of a race that was reset are normal traffic
      // and are skipped without penalty.
      player.lastInputTick = this.roomTick;
      player.host.accept(PLAYER_CAR, parsed.data.race, parsed.data.inputs);
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
      player.lastInputTick = this.roomTick;

      // The whole race goes back to the grid: both cars repaired and reloaded, the rival's
      // choices replayed from the same seed.
      resetRace(player.sparring.race);
      for (const brain of player.sparring.brains) brain?.reset();
      if (player.scenario) {
        for (const brain of player.scenario.brains) brain.reset();
        applyScenario(player.sparring.race, player.scenario.def);
      }
      // A new race with a new number: samples of the old one are refused by it, and the
      // client numbers its samples afresh. It waits on the grid for the first of them.
      const previous = player.host;
      player.host = this.createHost(client.sessionId, player, previous.raceId + 1);
      // The client keeps numbering on; whatever it sent before the reset stays dead.
      const before = previous.seat(PLAYER_CAR)?.input.highestSequence ?? -1;
      player.host.seat(PLAYER_CAR)?.input.refuseBelow(before + 1);
      this.announcePhase(player.sparring.race.phase, player);
      player.host.writeViews();
      this.log.info('car_reset', { sessionId: client.sessionId });
    }

    private onNeutral(client: Client, message: unknown): void {
      const player = this.admit(client);
      if (!player) return;
      if (message !== undefined && message !== null) {
        this.strike(client, player);
        return;
      }
      player.host.markAway(PLAYER_CAR);
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
