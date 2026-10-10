import { performance } from 'node:perf_hooks';
import type { AuthContext, Client, RoomException } from '@colyseus/core';
import { Protocol, Room, ServerError } from '@colyseus/core';
import type {
  DriveSession,
  ErrorCode,
  MatchPhase,
  RaceEvent,
  StepResult,
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
  WALL_FORGIVE_SPEED,
  buildTrack,
  createDriveSession,
  playerInputMessageSchema,
  raceTimeMs,
  resetDriveSession,
  stepDriveSession,
} from '@bolt/shared';
import type { MatchPhaseMessage } from '@bolt/shared';
import type { DriveRoomTuning } from '../config.js';
import type { GuestSessions } from '../security/guestSessions.js';
import type { Logger } from '../telemetry/log.js';
import { errorFields } from '../telemetry/log.js';
import type { DriveAuth } from './driveJoin.js';
import {
  asJoinError,
  joinError,
  parseJoinOptions,
  resolveCar,
  resolveCourse,
} from './driveJoin.js';
import { InputPacer } from './inputPacer.js';
import { DriveState, writeDriveState } from './schema.js';

/**
 * Solo test-drive room: one authoritative car on one track. The server owns time, physics
 * and checkpoint progress; the client only ever submits steering and brake samples.
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
/** Minimum gap between wall events so a long scrape reads as one hit, not thirty. */
const WALL_EVENT_COOLDOWN_TICKS = Math.round(0.25 * SIM_HZ);

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
  lastWallEventTick = -WALL_EVENT_COOLDOWN_TICKS;
  lastPhase: MatchPhase;

  constructor(
    readonly guestId: string,
    readonly session: DriveSession,
  ) {
    this.lastPhase = session.phase;
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
    private nextEventId = 1;
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
        if (deps.roomCount() >= deps.maxRooms) throw joinError('SERVER_FULL');
        return {
          guestId: guest.guestId,
          trackId: join.trackId,
          weatherPresetId: join.weatherPresetId,
          blueprint: car.blueprint,
        };
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
      const session = createDriveSession(this.track, course.env, car.params, this.players.size);
      const player = new DrivePlayer(auth.guestId, session);
      this.players.set(client.sessionId, player);
      this.state.buildHash = car.buildHash;
      // The opening phase reaches the client with its first state snapshot. MATCH_PHASE is
      // only sent for later changes, since nothing can be listening for it this early.
      writeDriveState(this.state, session, player.inputs.ackSequence);
      this.log.info('player_joined', {
        guestId: auth.guestId,
        sessionId: client.sessionId,
        buildHash: car.buildHash,
        totalCost: car.totalCost,
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
        await this.allowReconnection(client, tuning.reconnectSeconds);
        player.connected = true;
        player.inputs.touch();
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
        this.stepPlayer(player);
        if (windowEnded) this.closeMessageWindow(sessionId, player);
        if (player.connected && player.inputs.ticksSinceInput > idleTicks) {
          this.log.info('room_idle_timeout', { sessionId });
          this.close();
          return;
        }
      }
    }

    private stepPlayer(player: DrivePlayer): void {
      const session = player.session;
      // The pacer runs the car once per sample, in order. On a tick with no sample the car
      // may wait briefly and catch up afterwards; see InputPacer for why.
      player.inputs.tick(player.connected, (control) => {
        const result = stepDriveSession(session, control);
        if (result.event !== 'none') this.emitProgressEvents(player, result);

        const impact = session.telemetry.wallImpactSpeed;
        if (
          impact > WALL_FORGIVE_SPEED &&
          session.tick - player.lastWallEventTick >= WALL_EVENT_COOLDOWN_TICKS
        ) {
          player.lastWallEventTick = session.tick;
          this.emit({ id: this.nextEventId++, type: 'wall', tick: session.tick, speed: impact });
        }
        if (session.phase !== player.lastPhase) this.announcePhase(player);
      });
      writeDriveState(this.state, session, player.inputs.ackSequence);
    }

    private emitProgressEvents(player: DrivePlayer, result: StepResult): void {
      const session = player.session;
      const progress = session.progress;
      const tick = session.tick;

      if (result.event === 'checkpoint') {
        const count = this.track.checkpoints.length;
        // Progress already points at the next gate, so the one just crossed is one behind.
        const index = (progress.checkpointIndex + count - 1) % count;
        this.emit({ id: this.nextEventId++, type: 'checkpoint', tick, index });
        return;
      }
      if (result.lapTimeMs > 0) {
        const lap = progress.finishedAtMs !== null ? this.track.def.laps : progress.lap - 1;
        this.emit({ id: this.nextEventId++, type: 'lap', tick, lap, lapTimeMs: result.lapTimeMs });
      }
      if (result.event === 'finish') {
        // Also reached when the race clock runs out, in which case no lap was completed.
        this.emit({
          id: this.nextEventId++,
          type: 'finish',
          tick,
          raceTimeMs: raceTimeMs(session),
        });
      }
    }

    private emit(event: RaceEvent): void {
      this.broadcast(ServerMessage.RACE_EVENT, event);
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

      resetDriveSession(player.session);
      // Samples queued before the reset describe a car that is no longer there. The sequence
      // high-water mark is kept so none of them can be replayed afterwards.
      player.inputs.clear();
      if (player.session.phase !== player.lastPhase) this.announcePhase(player);
      writeDriveState(this.state, player.session, player.inputs.ackSequence);
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
