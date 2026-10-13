import { Client } from 'colyseus.js';
import type { Room } from 'colyseus.js';
import { conditionsFor, environmentFor, getTrack, resolveBuild } from '@bolt/content';
import type {
  BuildResultMessage,
  ControlInput,
  DriveSession,
  GuestSessionResponse,
  InputSample,
  MatchJoinResponse,
  MatchProfile,
  RaceEvent,
  RaceResult,
  RaceSnapshot,
  RematchChoice,
  TrackRuntime,
  VehicleBlueprint,
} from '@bolt/shared';
import {
  MAX_INPUTS_PER_PACKET,
  MatchClientMessage,
  MatchServerMessage,
  PROTOCOL_VERSION,
  SIM_DT,
  aggregateModifiers,
  blueprintSchema,
  buildTrack,
  compileModules,
  createDriveSession,
  createDriverScratch,
  driveCenterline,
  mulberry32,
} from '@bolt/shared';
import { Predictor } from '../../apps/web/src/network/prediction.js';
import type { DriveStateView } from '../../apps/web/src/network/stateView.js';
import { toRace, toSnapshot } from '../../apps/web/src/network/stateView.js';
import type { NetSim } from './netsim.js';

/**
 * A headless Race a Friend player: a real colyseus.js client that opens or joins a lobby over
 * HTTP, takes its seat over a WebSocket, and races exactly as the browser does: its own car is
 * predicted with the shipped `Predictor` and reconciled against every snapshot of its own view,
 * samples are produced on a real-time 30 Hz clock and sent in packets of two, and the prediction
 * clock stops while the room holds the race. All traffic goes through a `NetSim` proxy.
 *
 * What it measures: every correction the server makes to its own car (and how far it moved
 * the car on screen), how steadily the room's clock reached it, and what it was sent.
 */

export type SeatView = {
  present: boolean;
  connected: boolean;
  host: boolean;
  nickname: number;
  emblem: number;
  ready: boolean;
  loaded: boolean;
  vote: string;
  car: number;
  latencyMs: number;
  graceEndsAt: number;
};

type MapView<T> = {
  get(key: string): T | undefined;
  forEach(fn: (value: T, key: string) => void): void;
  readonly size: number;
};

export type MatchView = {
  phase: string;
  phaseEndsAt: number;
  code: string;
  trackId: string;
  weatherPresetId: string;
  randomTrack: boolean;
  raceId: number;
  round: number;
  swapped: boolean;
  notice: string;
  seats: MapView<SeatView>;
  views: MapView<DriveStateView>;
};

export type AppLoss = {
  /** Input packets dropped before they are sent: loss at the application level. */
  dropInputRate: number;
  /** Input packets held back and sent after the next one. */
  reorderInputRate: number;
  seed: number;
};

export const NO_APP_LOSS: AppLoss = { dropInputRate: 0, reorderInputRate: 0, seed: 7 };

export type DriveStats = {
  steps: number;
  packetsSent: number;
  packetsDropped: number;
  packetsReordered: number;
  snapshots: number;
  /** Reconciliations that moved the car on screen by more than a pixel. */
  corrections: number;
  worstCorrectionPx: number;
  sumCorrectionPx: number;
  /** Every correction's size, in order. */
  correctionSizes: number[];
  /** State updates that changed the car without moving the tick on, or moved it back. */
  sameTickMoves: number;
  tickBackwards: number;
  /** A room tick recorded twice with different contents. */
  relabels: number;
  /** Longest wait between snapshots that advanced the room clock, ms. */
  worstTickGapMs: number;
  /** Room ticks seen advancing per second of wall time, over the race. */
  tickRate: number;
  firstTickAt: number;
  firstTick: number;
  lastTickAt: number;
  lastTick: number;
};

function emptyStats(): DriveStats {
  return {
    steps: 0,
    packetsSent: 0,
    packetsDropped: 0,
    packetsReordered: 0,
    snapshots: 0,
    corrections: 0,
    worstCorrectionPx: 0,
    sumCorrectionPx: 0,
    correctionSizes: [],
    sameTickMoves: 0,
    tickBackwards: 0,
    relabels: 0,
    worstTickGapMs: 0,
    tickRate: 0,
    firstTickAt: 0,
    firstTick: -1,
    lastTickAt: 0,
    lastTick: -1,
  };
}

/** What the player does each tick, given its predicted car and what it knows of the race. */
export type DrivePolicy = (
  session: DriveSession,
  race: RaceSnapshot | null,
  info: { repairMask: number; tick: number },
) => ControlInput;

const trackCache = new Map<string, TrackRuntime>();
/** The course as the room races it: `laps` overrides the track's own when the room does. */
function runtimeFor(trackId: string, laps: number): TrackRuntime {
  const key = `${trackId}/${laps}`;
  let t = trackCache.get(key);
  if (!t) {
    const def = getTrack(trackId)!;
    t = buildTrack(laps > 0 ? { ...def, laps } : def);
    trackCache.set(key, t);
  }
  return t;
}

/** Where a car was at one room tick, and how much of its chassis was left. */
export type TrackPoint = { x: number; y: number; chassis: number };

/** Centerline driving, the primary gun held while the rival is near, a repair when damaged. */
export function fightingPolicy(): DrivePolicy {
  const scratch = createDriverScratch();
  let full: number[] | null = null;
  let presses = 0;
  return (session, race, info) => {
    const c = driveCenterline(session.track, session.motion, session.params, session.env, scratch);
    const control: ControlInput = {
      steer: c.steer,
      brake: c.brake,
      coast: c.coast,
      fire: 0,
      use: 0,
      target: 0,
    };
    if (race && session.phase === 'RACING') {
      const r = race.rival;
      const d = Math.hypot(r.x - session.motion.x, r.y - session.motion.y);
      if (d < 260) control.fire = 1;
      const components = race.car.combat?.components ?? [];
      // Integrity is in points; the first values seen are the undamaged ones.
      full ??= components.length > 0 ? [...components] : null;
      const hurt = full !== null && components.some((v, i) => v < full![i]! - 1);
      // A repair kit press, held for a few ticks, once a part has lost two points or more.
      if (hurt && info.repairMask !== 0 && presses < 8 && info.tick % 45 < 4) {
        control.use = info.repairMask;
        if (info.tick % 45 === 3) presses += 1;
      }
    }
    return control;
  };
}

export class HeadlessPlayer {
  guest!: GuestSessionResponse;
  client!: Client;
  room!: Room<MatchView>;
  seat = -1;
  code = '';
  readonly phases: string[] = [];
  readonly events: RaceEvent[] = [];
  readonly results: Array<{ raceId: number; result: RaceResult }> = [];
  readonly buildResults: BuildResultMessage[] = [];
  readonly errors: Array<{ code: string; message: string }> = [];
  locked: { blueprint: VehicleBlueprint; buildHash: string; raceId: number } | null = null;
  left: number | undefined;
  stats: DriveStats = emptyStats();
  /** Snapshots of this player's own car as reconciled, by room tick, for desync checks. */
  readonly ownTrack = new Map<number, TrackPoint>();
  readonly rivalTrack = new Map<number, TrackPoint>();
  private requestId = 0;
  private lastEventId = 0;
  private drive: DriveLoop | null = null;
  private readonly rng: () => number;

  constructor(
    readonly name: string,
    readonly net: NetSim,
    readonly loss: AppLoss = NO_APP_LOSS,
    /** The room's lap override (`MatchRoomTuning.laps`), so prediction finishes when it does. */
    readonly laps = 0,
  ) {
    this.rng = mulberry32(loss.seed);
  }

  async guestSession(): Promise<GuestSessionResponse> {
    const res = await fetch(`${this.net.url}/api/v1/guest`, { method: 'POST' });
    this.guest = (await res.json()) as GuestSessionResponse;
    this.client = new Client(this.net.wsUrl);
    return this.guest;
  }

  private async post(
    path: string,
    body: unknown,
    token = this.guest.token,
  ): Promise<{ status: number; body: unknown }> {
    const res = await fetch(`${this.net.url}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  }

  async create(blueprint: VehicleBlueprint, profile: MatchProfile): Promise<string> {
    if (!this.guest) await this.guestSession();
    const res = await this.post('/api/v1/match', {
      protocolVersion: PROTOCOL_VERSION,
      profile,
      blueprint,
    });
    if (res.status !== 201)
      throw new Error(`create failed: ${res.status} ${JSON.stringify(res.body)}`);
    const body = res.body as MatchJoinResponse;
    this.code = body.code;
    await this.consume(body);
    return body.code;
  }

  /** Tries to join; returns the HTTP answer, and takes the seat when it was granted. */
  async join(
    code: string,
    blueprint: VehicleBlueprint,
    profile: MatchProfile,
    token?: string,
  ): Promise<{ status: number; body: unknown }> {
    if (!this.guest) await this.guestSession();
    const res = await this.post(
      '/api/v1/match/join',
      { protocolVersion: PROTOCOL_VERSION, code, profile, blueprint },
      token,
    );
    if (res.status === 200) {
      const body = res.body as MatchJoinResponse;
      this.code = body.code;
      await this.consume(body);
    }
    return res;
  }

  private async consume(body: MatchJoinResponse): Promise<void> {
    const room = await this.client.consumeSeatReservation<MatchView>(body.reservation as never);
    this.bind(room);
    await waitUntil(
      () => this.seat >= 0 && this.room.state?.seats?.size === 2,
      5000,
      `${this.name} welcome`,
    );
  }

  private bind(room: Room<MatchView>): void {
    this.room = room;
    this.left = undefined;
    room.onMessage(MatchServerMessage.WELCOME, (m: { seat: number; code: string }) => {
      this.seat = m.seat;
      this.code = m.code;
    });
    room.onMessage(MatchServerMessage.MATCH_PHASE, (m: { phase: string }) =>
      this.phases.push(m.phase),
    );
    room.onMessage(MatchServerMessage.BUILD_RESULT, (m: BuildResultMessage) =>
      this.buildResults.push(m),
    );
    room.onMessage(
      MatchServerMessage.BUILD_LOCKED,
      (m: { blueprint: VehicleBlueprint; buildHash: string; raceId: number }) => {
        this.locked = m;
      },
    );
    room.onMessage(MatchServerMessage.RACE_EVENT, (e: RaceEvent) => {
      if (e.id <= this.lastEventId) return;
      this.lastEventId = e.id;
      this.events.push(e);
    });
    room.onMessage(MatchServerMessage.RESULTS, (m: { raceId: number; result: RaceResult }) =>
      this.results.push(m),
    );
    room.onMessage(MatchServerMessage.PONG, () => undefined);
    room.onMessage(MatchServerMessage.ERROR, (m: { code: string; message: string }) =>
      this.errors.push(m),
    );
    room.onLeave((code) => (this.left = code));
    room.onStateChange(() => this.drive?.onState());
  }

  get state(): MatchView {
    return this.room.state;
  }

  /** This player's own race view, the only one it receives. */
  view(): DriveStateView | undefined {
    return this.room.state?.views?.get(String(this.seat));
  }

  seatView(seat: number): SeatView | undefined {
    return this.room.state?.seats?.get(String(seat));
  }

  send(type: string, payload?: unknown): void {
    if (payload === undefined) this.room.send(type);
    else this.room.send(type, payload);
  }

  selectTrack(trackId: string, weatherPresetId: string): void {
    this.send(MatchClientMessage.SELECT_TRACK, { trackId, weatherPresetId });
  }
  lockTrack(): void {
    this.send(MatchClientMessage.LOCK_TRACK);
  }
  roomReady(): void {
    this.send(MatchClientMessage.ROOM_READY);
  }
  submit(blueprint: unknown): number {
    const requestId = ++this.requestId;
    this.send(MatchClientMessage.SUBMIT_BUILD, { requestId, blueprint });
    return requestId;
  }
  ready(blueprint: unknown): number {
    const requestId = ++this.requestId;
    this.send(MatchClientMessage.READY, { requestId, blueprint });
    return requestId;
  }
  vote(choice: RematchChoice): void {
    this.send(MatchClientMessage.REMATCH_VOTE, { choice });
  }
  async leave(): Promise<void> {
    this.stopDriving();
    // A socket that is already gone never answers; do not wait on it.
    await Promise.race([this.room.leave(true).catch(() => undefined), sleep(2_000)]);
  }

  async waitPhase(phase: string, timeoutMs = 20_000): Promise<void> {
    await waitUntil(
      () => this.room.state?.phase === phase,
      timeoutMs,
      `${this.name} phase ${phase}`,
    );
  }

  buildResult(requestId: number): BuildResultMessage | undefined {
    return this.buildResults.find((r) => r.requestId === requestId);
  }

  /** Drives the current race with prediction until stopped. */
  startDriving(policy: DrivePolicy = fightingPolicy()): void {
    this.stopDriving();
    this.stats = emptyStats();
    this.drive = new DriveLoop(this, policy, this.rng);
  }

  stopDriving(): void {
    this.drive?.stop();
    this.drive = null;
  }

  /** The proxy lost every connection: reconnect with the stored token. */
  async reconnect(): Promise<void> {
    const token = this.room.reconnectionToken;
    const room = await this.client.reconnect<MatchView>(token);
    this.bind(room);
    await waitUntil(() => !!this.room.state?.seats, 5000, `${this.name} reconnected state`);
    this.drive?.restartStream();
  }

  /** Internal: a sent packet, with application-level loss and reordering applied. */
  private held: InputSample[] | null = null;
  sendInputs(race: number, inputs: InputSample[]): void {
    this.stats.packetsSent += 1;
    if (this.rng() < this.loss.dropInputRate) {
      this.stats.packetsDropped += 1;
      return;
    }
    const out = (samples: InputSample[]) => {
      try {
        this.room.send(MatchClientMessage.PLAYER_INPUT, { race, inputs: samples });
      } catch {
        // The socket is down; the samples are lost, as on a real phone.
      }
    };
    if (this.held) {
      out(inputs);
      out(this.held);
      this.held = null;
      return;
    }
    if (this.rng() < this.loss.reorderInputRate) {
      this.stats.packetsReordered += 1;
      this.held = inputs;
      return;
    }
    out(inputs);
  }
}

const STEP_MS = SIM_DT * 1000;

class DriveLoop {
  private timer: ReturnType<typeof setInterval>;
  private raceId = 0;
  private predictor: Predictor | null = null;
  private session: DriveSession | null = null;
  private repairMask = 0;
  private outbox: InputSample[] = [];
  private lastSend = 0;
  private clockStart = 0;
  private stepsDone = 0;
  private wasHeld = true;
  private lastRace: RaceSnapshot | null = null;
  private lastViewTick = -1;
  private lastViewX = 0;
  private lastViewY = 0;

  constructor(
    private readonly player: HeadlessPlayer,
    private readonly policy: DrivePolicy,
    _rng: () => number,
  ) {
    this.timer = setInterval(() => this.pump(), 4);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  /** A new connection: the room starts our stream again; the numbering simply continues. */
  restartStream(): void {
    this.outbox.length = 0;
  }

  private setup(view: DriveStateView): boolean {
    const p = this.player;
    const state = p.state;
    if (
      !p.locked ||
      !view.raceId ||
      view.raceId !== state.raceId ||
      p.locked.raceId !== view.raceId
    )
      return false;
    if (this.raceId === view.raceId && this.predictor) return true;
    const track = runtimeFor(state.trackId, p.laps);
    const env = environmentFor(state.weatherPresetId)!;
    const conditions = conditionsFor(state.trackId, state.weatherPresetId)!;
    const resolved = resolveBuild(p.locked.blueprint, conditions);
    if (!resolved.ok) throw new Error(`${p.name}: locked build does not resolve`);
    const you = view.you ?? 0;
    this.session = createDriveSession(track, env, resolved.params, you);
    this.predictor = new Predictor(this.session);
    this.predictor.setBuild(resolved.build, conditions);
    try {
      const rival = blueprintSchema.parse(JSON.parse(view.rivalBlueprint));
      const r = resolveBuild(rival, conditions);
      if (r.ok) this.predictor.setRivalBody(r.params);
    } catch {
      // No rival body: contact is not predicted.
    }
    const specs = compileModules(resolved.build, aggregateModifiers(resolved.build));
    this.repairMask = 0;
    for (const spec of specs)
      if ((spec.kind === 'repair' || spec.kind === 'spare') && spec.useBit >= 0)
        this.repairMask |= 1 << spec.useBit;
    this.raceId = view.raceId;
    p.ownTrack.clear();
    p.rivalTrack.clear();
    this.lastViewTick = -1;
    this.outbox.length = 0;
    this.stepsDone = 0;
    this.wasHeld = true;
    return true;
  }

  onState(): void {
    const view = this.player.view();
    if (!view || !this.setup(view)) return;
    const stats = this.player.stats;
    const now = Date.now();
    if (view.tick === this.lastViewTick && (view.x !== this.lastViewX || view.y !== this.lastViewY))
      stats.sameTickMoves += 1;
    if (view.tick < this.lastViewTick) stats.tickBackwards += 1;
    this.lastViewTick = view.tick;
    this.lastViewX = view.x;
    this.lastViewY = view.y;
    if (stats.lastTick >= 0 && view.tick > stats.lastTick) {
      stats.worstTickGapMs = Math.max(stats.worstTickGapMs, now - stats.lastTickAt);
    }
    if (view.tick !== stats.lastTick) {
      if (stats.firstTick < 0) {
        stats.firstTick = view.tick;
        stats.firstTickAt = now;
      }
      stats.lastTick = view.tick;
      stats.lastTickAt = now;
      if (now > stats.firstTickAt)
        stats.tickRate = ((view.tick - stats.firstTick) / (now - stats.firstTickAt)) * 1000;
    }
    const predictor = this.predictor!;
    const snapshot = toSnapshot(view);
    const ex = predictor.errorX;
    const ey = predictor.errorY;
    const before = predictor.corrections;
    predictor.reconcile(snapshot);
    stats.snapshots += 1;
    if (predictor.corrections > before) {
      const size = Math.hypot(predictor.errorX - ex, predictor.errorY - ey);
      if (size > 1) {
        stats.corrections += 1;
        stats.sumCorrectionPx += size;
        stats.correctionSizes.push(size);
        stats.worstCorrectionPx = Math.max(stats.worstCorrectionPx, size);
      }
    }
    const race = toRace(view, snapshot);
    this.lastRace = race;
    // A finished car's session clock stops, so ticks only name one moment for both cars while
    // neither has finished.
    if (
      race &&
      race.phase === 'RACING' &&
      view.finishedAtMs < 0 &&
      race.rival.finishedAtMs === null
    ) {
      const before = this.player.ownTrack.get(view.tick);
      const seen = this.player.rivalTrack.get(view.tick);
      if (
        (before && (before.x !== view.x || before.y !== view.y)) ||
        (seen && (seen.x !== race.rival.x || seen.chassis !== race.rival.chassis))
      )
        stats.relabels += 1;
      this.player.ownTrack.set(view.tick, {
        x: view.x,
        y: view.y,
        chassis: race.car.combat?.chassis ?? -1,
      });
      this.player.rivalTrack.set(view.tick, {
        x: race.rival.x,
        y: race.rival.y,
        chassis: race.rival.chassis,
      });
    }
    if (race) {
      predictor.setRival(race.rival, race.tick);
    }
  }

  private pump(): void {
    const view = this.player.view();
    if (!view || !this.predictor || view.raceId !== this.raceId) return;
    const now = Date.now();
    this.predictor.decayError(0.004);
    if (view.held) {
      this.wasHeld = true;
      return;
    }
    if (this.wasHeld) {
      this.wasHeld = false;
      this.clockStart = now - this.stepsDone * STEP_MS;
    }
    let due = Math.floor((now - this.clockStart) / STEP_MS) - this.stepsDone;
    if (due > 8) {
      // A stall longer than the step clock catches up: the time is lost, as in the browser.
      this.clockStart += (due - 8) * STEP_MS;
      due = 8;
    }
    for (let i = 0; i < due; i++) {
      const session = this.session!;
      const control = this.policy(session, this.lastRace, {
        repairMask: this.repairMask,
        tick: this.stepsDone,
      });
      const { sample } = this.predictor.step(control);
      this.stepsDone += 1;
      this.player.stats.steps += 1;
      this.outbox.push(sample);
      if (this.outbox.length >= 2 || now - this.lastSend > 60) this.flush(now);
    }
    if (this.outbox.length > 0 && now - this.lastSend > 60) this.flush(now);
  }

  private flush(now: number): void {
    this.lastSend = now;
    while (this.outbox.length > 0) {
      const batch = this.outbox.splice(0, MAX_INPUTS_PER_PACKET);
      this.player.sendInputs(this.raceId, batch);
    }
  }
}

/** The value below which `share` of the sizes fall. */
export function percentile(values: readonly number[], share: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))]!;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitUntil(
  predicate: () => boolean,
  timeoutMs: number,
  what: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline)
      throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}.`);
    await sleep(10);
  }
}
