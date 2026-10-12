import type {
  CarSnapshot,
  DriveJoinOptions,
  HazardSnapshot,
  InputSample,
  MatchPhase,
  ModuleSnapshot,
  PlayerInputMessage,
  ProjectileSnapshot,
  RaceEvent,
  RaceResult,
  RaceSnapshot,
  RivalSnapshot,
  StatusSnapshot,
} from '@bolt/shared';
import {
  ClientMessage,
  HAZARD_KINDS,
  JOIN_ERROR_CODES,
  PROJECTILE_KINDS,
  ROOM_DRIVE,
  STATUS_FAMILIES,
  ServerMessage,
} from '@bolt/shared';
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
  fx?: {
    drive: number;
    speedCap: number;
    grip: number;
    steerBias: number;
    steerScale: number;
    steerLag: number;
    rollingAdd: number;
    heatFactor: number;
    auxLimit: number;
    driveSupplyLimit: number;
    stabilityAdd: number;
    airborne: boolean;
    tow?: number;
    towTarget?: number;
    towNext?: number;
  };
  /** The tow level of the player's car, in hundredths. */
  tow?: number;
  combat?: {
    chassis: number;
    chassisMax: number;
    armor: Iterable<number>;
    components: Iterable<number>;
    statuses: Iterable<StatusView>;
    modules: Iterable<ModuleSnapshot>;
    reserve: number;
    lockWarning: number;
    ko: boolean;
  };
  race?: {
    phase: string;
    clockMs: number;
    position: number;
    gapMeters: number;
    gapSeconds: number;
    rivalTracked: boolean;
    finishWindowEndTick: number;
    resultWinner: number;
    resultJson: string;
  };
  rival?: RivalView;
  rivalBlueprint: string;
  projectiles?: { forEach(fn: (value: ProjectileView) => void): void };
  hazards?: { forEach(fn: (value: HazardView) => void): void };
};

type StatusView = { magnitude: number; untilTick: number };
type RivalView = Omit<
  RivalSnapshot,
  'armor' | 'components' | 'statuses' | 'modules' | 'finishedAtMs' | 'tow'
> & {
  finishedAtMs: number;
  /** In hundredths. */
  tow?: number;
  armor: Iterable<number>;
  components: Iterable<number>;
  statuses: Iterable<StatusView>;
  modules: Iterable<{ state: number; aim: number; up: boolean }>;
};
type ProjectileView = Omit<ProjectileSnapshot, 'kind'> & { kind: number };
type HazardView = Omit<HazardSnapshot, 'kind'> & { kind: number };

export type JoinFailure = 'version' | 'unauthorized' | 'build' | 'unavailable';

export class JoinError extends Error {
  constructor(readonly reason: JoinFailure) {
    super(reason);
  }
}

const RECONNECT_WINDOW_MS = 18_000;

/** One status entry per family on the wire; only the ones still running are kept. */
function statusList(statuses: Iterable<StatusView> | undefined, tick: number): StatusSnapshot[] {
  const out: StatusSnapshot[] = [];
  if (!statuses) return out;
  let index = 0;
  for (const status of statuses) {
    const family = STATUS_FAMILIES[index++];
    if (family && status.untilTick > tick)
      out.push({ family, magnitude: status.magnitude, untilTick: status.untilTick });
  }
  return out;
}

/** The race around the local car, rebuilt from the synchronized state. */
function toRace(state: DriveStateView, car: CarSnapshot): RaceSnapshot | null {
  const rival = state.rival;
  const info = state.race;
  if (!rival || !info) return null;
  const projectiles: ProjectileSnapshot[] = [];
  state.projectiles?.forEach((p) =>
    projectiles.push({
      id: p.id,
      kind: PROJECTILE_KINDS[p.kind] ?? 'bullet',
      owner: p.owner,
      x: p.x,
      y: p.y,
      vx: p.vx,
      vy: p.vy,
      tick: p.tick,
      landTick: p.landTick,
    }),
  );
  const hazards: HazardSnapshot[] = [];
  state.hazards?.forEach((h) =>
    hazards.push({
      id: h.id,
      kind: HAZARD_KINDS[h.kind] ?? 'mine',
      owner: h.owner,
      x: h.x,
      y: h.y,
      radius: h.radius,
      halfLength: h.halfLength,
      angle: h.angle,
      armedTick: h.armedTick,
      endTick: h.endTick,
      revealed: h.revealed,
    }),
  );
  let result: RaceResult | null = null;
  if (info.resultJson) {
    try {
      result = JSON.parse(info.resultJson) as RaceResult;
    } catch {
      result = null;
    }
  }
  return {
    tick: state.tick,
    you: 0,
    phase: info.phase as MatchPhase,
    raceTimeMs: info.clockMs,
    car,
    rival: {
      x: rival.x,
      y: rival.y,
      headingRad: rival.headingRad,
      velocityX: rival.velocityX,
      velocityY: rival.velocityY,
      steeringInput: rival.steeringInput,
      braking: rival.braking,
      lap: rival.lap,
      checkpointIndex: rival.checkpointIndex,
      courseProgress: rival.courseProgress,
      finishedAtMs: rival.finishedAtMs < 0 ? null : rival.finishedAtMs,
      chassis: rival.chassis,
      chassisMax: rival.chassisMax,
      armor: Array.from(rival.armor ?? []),
      components: Array.from(rival.components ?? []),
      statuses: statusList(rival.statuses, state.tick),
      modules: Array.from(rival.modules ?? [], (m) => ({ state: m.state, aim: m.aim, up: m.up })),
      ko: rival.ko,
      buildHash: rival.buildHash,
      tow: (rival.tow ?? 0) / 100,
    },
    rivalBlueprint: state.rivalBlueprint ?? '',
    projectiles,
    hazards,
    position: info.position,
    gapMeters: info.gapMeters,
    gapSeconds: info.gapSeconds,
    rivalTracked: info.rivalTracked,
    finishWindowEndTick: info.finishWindowEndTick,
    result,
  };
}

function toSnapshot(state: DriveStateView): CarSnapshot {
  const fx = state.fx;
  const combat = state.combat;
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
    tow: (state.tow ?? 0) / 100,
    ...(fx
      ? {
          effects: {
            drive: fx.drive,
            speedCap: fx.speedCap < 0 ? Infinity : fx.speedCap,
            grip: fx.grip,
            steerBias: fx.steerBias,
            steerScale: fx.steerScale,
            steerLag: fx.steerLag,
            rollingAdd: fx.rollingAdd,
            heatFactor: fx.heatFactor,
            auxLimit: fx.auxLimit,
            driveSupplyLimit: fx.driveSupplyLimit,
            stabilityAdd: fx.stabilityAdd,
            airborne: fx.airborne,
            tow: fx.tow ?? 0,
            towTarget: fx.towTarget ?? 0,
            towNext: fx.towNext ?? 0,
          },
        }
      : {}),
    ...(combat
      ? {
          combat: {
            chassis: combat.chassis,
            chassisMax: combat.chassisMax,
            armor: Array.from(combat.armor ?? []),
            components: Array.from(combat.components ?? []),
            statuses: statusList(combat.statuses, state.tick),
            modules: Array.from(combat.modules ?? [], (m) => ({
              state: m.state,
              charges: m.charges,
              readyTick: m.readyTick,
              cooldownTicks: m.cooldownTicks,
              aim: m.aim,
              locked: m.locked,
              pool: m.pool,
            })),
            reserve: combat.reserve,
            lockWarning: combat.lockWarning,
            ko: combat.ko,
          },
        }
      : {}),
  };
}

/** Authoritative link: a Colyseus room running the 30 Hz simulation on the game server. */
export class OnlineLink implements DriveLink {
  readonly mode = 'online' as const;
  onSnapshot: ((snapshot: CarSnapshot) => void) | null = null;
  onRace: ((race: RaceSnapshot) => void) | null = null;
  onEvent: ((event: RaceEvent) => void) | null = null;
  onStatus: ((status: LinkStatus) => void) | null = null;
  latencyMs = 0;
  private room: Room<DriveStateView>;
  private closed = false;
  private sentAt = new Map<number, number>();
  /** Highest event id delivered. Ids only grow, so anything at or below it is a repeat. */
  private lastEventId = 0;

  private constructor(
    private readonly client: Client,
    room: Room<DriveStateView>,
  ) {
    this.room = room;
    this.bind(room);
  }

  /** The rival's canonical blueprint JSON, as the server published it at join. */
  get rivalBlueprint(): string {
    return this.room.state?.rivalBlueprint ?? '';
  }

  static async join(options: DriveJoinOptions): Promise<OnlineLink> {
    const client = new Client(serverOrigin());
    try {
      const room = await client.joinOrCreate<DriveStateView>(ROOM_DRIVE, options);
      // The first state carries the rival's blueprint, which the race view needs before it
      // can load that car's art.
      await new Promise<void>((resolve) => {
        if (room.state?.rivalBlueprint) return resolve();
        const timer = window.setTimeout(resolve, 3000);
        room.onStateChange.once(() => {
          window.clearTimeout(timer);
          resolve();
        });
      });
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
      const car = toSnapshot(state);
      this.onSnapshot?.(car);
      if (this.onRace) {
        const race = toRace(state, car);
        if (race) this.onRace(race);
      }
    });
    room.onMessage(ServerMessage.RACE_EVENT, (event: RaceEvent) => {
      // Events carry increasing ids, so a resend after a reconnect never replays an effect
      // (Section 13.6: network correction must not replay the same effect twice).
      if (event.id <= this.lastEventId) return;
      this.lastEventId = event.id;
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
      // No payload: the room counts anything else as a malformed message and ignores it.
      this.room.send(ClientMessage.RESET_CAR);
    } catch {
      // Ignored while reconnecting.
    }
  }

  leave(): void {
    this.closed = true;
    this.onSnapshot = null;
    this.onRace = null;
    this.onEvent = null;
    this.onStatus = null;
    void this.room.leave(true).catch(() => undefined);
  }
}
