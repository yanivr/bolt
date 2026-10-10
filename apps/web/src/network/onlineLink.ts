import type {
  CarSnapshot,
  DriveJoinOptions,
  InputSample,
  MatchPhase,
  PlayerInputMessage,
  RaceEvent,
} from '@bolt/shared';
import { ClientMessage, JOIN_ERROR_CODES, ROOM_DRIVE, ServerMessage } from '@bolt/shared';
import type { Room } from 'colyseus.js';
import { Client } from 'colyseus.js';
import { serverOrigin } from './api.js';
import type { DriveLink, LinkStatus } from './link.js';

/** Flat synchronized state of the drive room, mirroring apps/server/src/rooms/schema.ts. */
type DriveStateView = {
  tick: number;
  phase: string;
  countdown: number;
  countdownTicks: number;
  raceTimeMs: number;
  ackSequence: number;
  bestLapMs: number;
  lastLapMs: number;
  x: number;
  y: number;
  headingRad: number;
  velocityX: number;
  velocityY: number;
  yawRate: number;
  steeringInput: number;
  brakeInput: number;
  throttleFraction: number;
  reverseHold: number;
  reversing: boolean;
  wallGrace: number;
  coreHeat: number;
  batteryEnergy: number;
  thermalLimited: boolean;
  engineSpool: number;
  engineCharge: number;
  engineClock: number;
  engineBurst: number;
  tireWearSeconds: number;
  wheelIntegrity: Iterable<number>;
  buildHash: string;
  checkpointIndex: number;
  lap: number;
  courseProgress: number;
  lastCheckpointMs: number;
  wrongWaySeconds: number;
  finishedAtMs: number;
};

export type JoinFailure = 'version' | 'unauthorized' | 'build' | 'unavailable';

export class JoinError extends Error {
  constructor(readonly reason: JoinFailure) {
    super(reason);
  }
}

const RECONNECT_WINDOW_MS = 18_000;

function toSnapshot(state: DriveStateView): CarSnapshot {
  return {
    tick: state.tick,
    ackSequence: state.ackSequence,
    raceTimeMs: state.raceTimeMs,
    phase: state.phase as MatchPhase,
    countdown: state.countdown,
    countdownTicks: state.countdownTicks,
    motion: {
      x: state.x,
      y: state.y,
      headingRad: state.headingRad,
      velocityX: state.velocityX,
      velocityY: state.velocityY,
      yawRate: state.yawRate,
      steeringInput: state.steeringInput,
      brakeInput: state.brakeInput,
      throttleFraction: state.throttleFraction,
      reverseHold: state.reverseHold,
      reversing: state.reversing,
      wallGrace: state.wallGrace,
      coreHeat: state.coreHeat,
      batteryEnergy: state.batteryEnergy,
      thermalLimited: state.thermalLimited,
      engineSpool: state.engineSpool,
      engineCharge: state.engineCharge,
      engineClock: state.engineClock,
      engineBurst: state.engineBurst,
      tireWearSeconds: state.tireWearSeconds,
    },
    progress: {
      checkpointIndex: state.checkpointIndex,
      lap: state.lap,
      courseProgress: state.courseProgress,
      lastCheckpointMs: state.lastCheckpointMs,
      wrongWaySeconds: state.wrongWaySeconds,
      finishedAtMs: state.finishedAtMs < 0 ? null : state.finishedAtMs,
    },
    bestLapMs: state.bestLapMs,
    lastLapMs: state.lastLapMs,
    wheelIntegrity: state.wheelIntegrity ? Array.from(state.wheelIntegrity) : [],
    buildHash: state.buildHash ?? '',
  };
}

/** Authoritative link: a Colyseus room running the 30 Hz simulation on the game server. */
export class OnlineLink implements DriveLink {
  readonly mode = 'online' as const;
  onSnapshot: ((snapshot: CarSnapshot) => void) | null = null;
  onEvent: ((event: RaceEvent) => void) | null = null;
  onStatus: ((status: LinkStatus) => void) | null = null;
  latencyMs = 0;
  private room: Room<DriveStateView>;
  private closed = false;
  private sentAt = new Map<number, number>();
  private seenEvents = new Set<number>();

  private constructor(
    private readonly client: Client,
    room: Room<DriveStateView>,
  ) {
    this.room = room;
    this.bind(room);
  }

  static async join(options: DriveJoinOptions): Promise<OnlineLink> {
    const client = new Client(serverOrigin());
    try {
      const room = await client.joinOrCreate<DriveStateView>(ROOM_DRIVE, options);
      return new OnlineLink(client, room);
    } catch (error) {
      const code = (error as { code?: number }).code;
      // A catalog mismatch means this page was built against other part values: reload.
      if (code === JOIN_ERROR_CODES.VERSION_MISMATCH || code === JOIN_ERROR_CODES.CATALOG_MISMATCH)
        throw new JoinError('version');
      if (code === JOIN_ERROR_CODES.ILLEGAL_BUILD || code === JOIN_ERROR_CODES.UNKNOWN_PART)
        throw new JoinError('build');
      if (code === JOIN_ERROR_CODES.UNAUTHORIZED) throw new JoinError('unauthorized');
      throw new JoinError('unavailable');
    }
  }

  private bind(room: Room<DriveStateView>): void {
    room.onStateChange((state) => {
      const sent = this.sentAt.get(state.ackSequence);
      if (sent !== undefined) {
        const rtt = performance.now() - sent;
        this.latencyMs = this.latencyMs === 0 ? rtt : this.latencyMs * 0.85 + rtt * 0.15;
        for (const key of this.sentAt.keys()) if (key <= state.ackSequence) this.sentAt.delete(key);
      }
      this.onSnapshot?.(toSnapshot(state));
    });
    room.onMessage(ServerMessage.RACE_EVENT, (event: RaceEvent) => {
      // Events carry unique ids so a resend after a reconnect never replays an effect.
      if (this.seenEvents.has(event.id)) return;
      this.seenEvents.add(event.id);
      this.onEvent?.(event);
    });
    room.onMessage(ServerMessage.MATCH_PHASE, () => undefined);
    room.onMessage(ServerMessage.ERROR, () => undefined);
    room.onLeave((code) => {
      if (this.closed || code === 1000) return;
      void this.recover();
    });
  }

  private async recover(): Promise<void> {
    this.onStatus?.('reconnecting');
    const token = this.room.reconnectionToken;
    const deadline = performance.now() + RECONNECT_WINDOW_MS;
    while (!this.closed && performance.now() < deadline) {
      try {
        const room = await this.client.reconnect<DriveStateView>(token);
        this.room = room;
        this.bind(room);
        this.onStatus?.('connected');
        return;
      } catch {
        await new Promise((resolve) => window.setTimeout(resolve, 900));
      }
    }
    if (!this.closed) this.onStatus?.('lost');
  }

  sendInputs(samples: InputSample[]): void {
    if (this.closed || samples.length === 0) return;
    const now = performance.now();
    for (const s of samples) this.sentAt.set(s.sequence, now);
    if (this.sentAt.size > 240) this.sentAt.clear();
    const message: PlayerInputMessage = { inputs: samples };
    try {
      this.room.send(ClientMessage.PLAYER_INPUT, message);
    } catch {
      // The socket is mid-reconnect; these samples are replayed from the pending buffer.
    }
  }

  resetCar(): void {
    try {
      this.room.send(ClientMessage.RESET_CAR, {});
    } catch {
      // Ignored while reconnecting.
    }
  }

  leave(): void {
    this.closed = true;
    this.onSnapshot = null;
    this.onEvent = null;
    this.onStatus = null;
    void this.room.leave(true).catch(() => undefined);
  }
}
