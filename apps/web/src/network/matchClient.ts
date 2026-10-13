import type {
  BuildLockedMessage,
  BuildResultMessage,
  CarSnapshot,
  InputSample,
  MatchJoinResponse,
  MatchNotice,
  MatchPhase,
  MatchProfile,
  MatchRoomPhaseMessage,
  RaceEvent,
  RaceResult,
  RaceSnapshot,
  RematchChoice,
  VehicleBlueprint,
  WelcomeMessage,
} from '@bolt/shared';
import {
  MatchClientMessage,
  MatchServerMessage,
  PROTOCOL_VERSION,
  matchGraceMs,
} from '@bolt/shared';
import type { Room } from 'colyseus.js';
import { Client } from 'colyseus.js';
import { create } from 'zustand';
import { ensureGuest, serverOrigin } from './api.js';
import type { DriveLink, LinkStatus } from './link.js';
import type { DriveStateView } from './stateView.js';
import { toRace, toSnapshot } from './stateView.js';

/**
 * The client half of Race a Friend (Milestone E, docs/MULTIPLAYER.md): one connection to one
 * match room for the whole visit, from the lobby to the last rematch. `MatchClient` opens or
 * joins a lobby over HTTP, holds the socket, keeps a clock offset and a round-trip estimate from
 * pings, reconnects on its own after a drop (and after a page refresh, from session storage),
 * and mirrors what the room publishes into `useMatch`, which the screens read. The race itself
 * goes through `MatchRaceLink`, a `DriveLink` over the same room.
 */

type MapView<T> = {
  get(key: string): T | undefined;
  forEach(fn: (value: T, key: string) => void): void;
};

type SeatStateView = {
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

type MatchStateView = {
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
  seats: MapView<SeatStateView>;
  views: MapView<DriveStateView>;
};

export type SeatInfo = {
  present: boolean;
  connected: boolean;
  host: boolean;
  nickname: number;
  emblem: number;
  ready: boolean;
  loaded: boolean;
  vote: RematchChoice | '';
  car: number;
  latencyMs: number;
  /** Local clock (ms) when a dropped seat's grace ends, or 0. */
  graceEndsAt: number;
};

export type MatchFailure =
  'expired' | 'full' | 'already' | 'server' | 'version' | 'unauthorized' | 'build' | 'rate';

export class MatchJoinError extends Error {
  constructor(
    readonly reason: MatchFailure,
    readonly detail = '',
  ) {
    super(reason);
  }
}

export type MatchStatus = 'connected' | 'reconnecting' | 'lost';

export type MatchView = {
  active: boolean;
  status: MatchStatus;
  /** Why a lost match ended: the seat was given up, or the room closed. */
  lostReason: 'seat' | 'closed' | 'network' | '';
  seat: number;
  code: string;
  phase: MatchPhase;
  /** Local clock (ms) when the phase ends by itself, or 0. */
  endsAt: number;
  trackId: string;
  weatherPresetId: string;
  randomTrack: boolean;
  raceId: number;
  round: number;
  swapped: boolean;
  notice: MatchNotice;
  seats: [SeatInfo, SeatInfo];
  rttMs: number;
  /** The build the server locked for this player's next race. */
  locked: BuildLockedMessage | null;
  lastBuild: BuildResultMessage | null;
  result: { raceId: number; result: RaceResult } | null;
  /** Local clock (ms) when this seat's own reconnect grace runs out, while reconnecting. */
  reconnectEndsAt: number;
};

const EMPTY_SEAT: SeatInfo = {
  present: false,
  connected: false,
  host: false,
  nickname: 0,
  emblem: 0,
  ready: false,
  loaded: false,
  vote: '',
  car: -1,
  latencyMs: 0,
  graceEndsAt: 0,
};

const INITIAL: MatchView = {
  active: false,
  status: 'connected',
  lostReason: '',
  seat: -1,
  code: '',
  phase: 'CREATED',
  endsAt: 0,
  trackId: '',
  weatherPresetId: '',
  randomTrack: false,
  raceId: 0,
  round: 0,
  swapped: false,
  notice: '',
  seats: [EMPTY_SEAT, EMPTY_SEAT],
  rttMs: 0,
  locked: null,
  lastBuild: null,
  result: null,
  reconnectEndsAt: 0,
};

export const useMatch = create<MatchView>(() => ({ ...INITIAL }));

const RESUME_KEY = 'bolt.match.v1';
const PROFILE_KEY = 'bolt.profile.v1';
const PING_MS = 2000;
/** The longest a dropped seat is kept anywhere in a match, with a little to spare. */
const RECONNECT_WINDOW_MS = 95_000;
const CLOSE_SEAT_FREED = 4410;
const CLOSE_CONSENTED = 4000;

function readJson<T>(storage: Storage | undefined, key: string): T | null {
  try {
    const raw = storage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(storage: Storage | undefined, key: string, value: unknown): void {
  try {
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked: the match still works for this page, only a refresh cannot resume it.
  }
}

function session(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

function local(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** The preset nickname and emblem this player shows, chosen once at random and remembered. */
export function loadProfile(nicknames: number, emblems: number): MatchProfile {
  const stored = readJson<MatchProfile>(local(), PROFILE_KEY);
  if (
    stored &&
    Number.isInteger(stored.nickname) &&
    Number.isInteger(stored.emblem) &&
    stored.nickname >= 0 &&
    stored.nickname < nicknames &&
    stored.emblem >= 0 &&
    stored.emblem < emblems
  )
    return { nickname: stored.nickname, emblem: stored.emblem };
  const fresh = {
    nickname: Math.floor(Math.random() * nicknames),
    emblem: Math.floor(Math.random() * emblems),
  };
  writeJson(local(), PROFILE_KEY, fresh);
  return fresh;
}

export function saveProfile(profile: MatchProfile): void {
  writeJson(local(), PROFILE_KEY, profile);
}

let current: MatchClient | null = null;

/** Forgets a match that has ended, so the screens stop following it. */
export function clearMatch(): void {
  current = null;
  useMatch.setState({ ...INITIAL });
}

/** The match this page is in, if any. */
export function activeMatch(): MatchClient | null {
  return current;
}

declare global {
  interface Window {
    /**
     * With the test switches (`?debug=1` or `?autopilot=1`) only: end-to-end tests drop this
     * page's connection, as a phone losing its signal does.
     */
    __boltMatch?: { drop(): void };
  }
}

try {
  const query = new URLSearchParams(window.location.search);
  if (query.get('debug') === '1' || query.get('autopilot') === '1')
    window.__boltMatch = {
      // Not a goodbye (that is 4000): the room keeps the seat and this page reconnects.
      drop: () => current?.room.connection.close(3001, 'debug drop'),
    };
} catch {
  // No window: a test environment without a page.
}

async function post(
  path: string,
  body: unknown,
  token: string,
): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${serverOrigin()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    return { status: res.status, body: parsed };
  } finally {
    window.clearTimeout(timer);
  }
}

function failureOf(status: number, body: unknown): MatchJoinError {
  const error = (body as { error?: { code?: string; message?: string } } | null)?.error;
  const code = error?.code ?? '';
  const message = error?.message ?? '';
  if (code === 'INVITE_EXPIRED') return new MatchJoinError('expired', message);
  if (code === 'LOBBY_FULL')
    return new MatchJoinError(/already/i.test(message) ? 'already' : 'full', message);
  if (code === 'VERSION_MISMATCH' || code === 'CATALOG_MISMATCH')
    return new MatchJoinError('version', message);
  if (code === 'UNAUTHORIZED') return new MatchJoinError('unauthorized', message);
  if (code === 'ILLEGAL_BUILD' || code === 'UNKNOWN_PART')
    return new MatchJoinError('build', message);
  if (code === 'RATE_LIMITED' || status === 429) return new MatchJoinError('rate', message);
  return new MatchJoinError('server', message);
}

export class MatchClient {
  readonly client: Client;
  room: Room<MatchStateView>;
  seat = -1;
  code = '';
  rttMs = 0;
  /** Server clock minus local clock, ms, from the fastest ping seen. */
  offsetMs = 0;
  private bestRtt = Infinity;
  private pingTimer = 0;
  private closed = false;
  private lastEventId = 0;
  private raceLink: MatchRaceLink | null = null;
  private resumeToken = '';

  private constructor(client: Client, room: Room<MatchStateView>) {
    this.client = client;
    this.room = room;
    this.bind(room);
  }

  /** Opens a new lobby with this player as host. */
  static async open(profile: MatchProfile, blueprint: VehicleBlueprint): Promise<MatchClient> {
    return MatchClient.enter('/api/v1/match', {
      protocolVersion: PROTOCOL_VERSION,
      profile,
      blueprint,
    });
  }

  /** Takes the second seat of the lobby a code names. */
  static async join(
    code: string,
    profile: MatchProfile,
    blueprint: VehicleBlueprint,
  ): Promise<MatchClient> {
    return MatchClient.enter('/api/v1/match/join', {
      protocolVersion: PROTOCOL_VERSION,
      code,
      profile,
      blueprint,
    });
  }

  private static async enter(path: string, body: unknown): Promise<MatchClient> {
    current?.leave();
    let guest;
    try {
      guest = await ensureGuest();
    } catch {
      throw new MatchJoinError('server');
    }
    let res;
    try {
      res = await post(path, body, guest.token);
    } catch {
      throw new MatchJoinError('server');
    }
    if (res.status !== 200 && res.status !== 201) throw failureOf(res.status, res.body);
    const answer = res.body as MatchJoinResponse;
    const client = new Client(serverOrigin());
    let room: Room<MatchStateView>;
    try {
      room = await client.consumeSeatReservation<MatchStateView>(answer.reservation as never);
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (code === 4404) throw new MatchJoinError('expired');
      if (code === 4409) throw new MatchJoinError('full');
      throw new MatchJoinError('server');
    }
    const match = new MatchClient(client, room);
    match.code = answer.code;
    current = match;
    await match.welcomed();
    return match;
  }

  /** After a page refresh: the seat this tab held, if the room still keeps it. */
  static async resume(): Promise<MatchClient | null> {
    const saved = readJson<{ token: string; code: string }>(session(), RESUME_KEY);
    if (!saved?.token) return null;
    const client = new Client(serverOrigin());
    try {
      const room = await client.reconnect<MatchStateView>(saved.token);
      const match = new MatchClient(client, room);
      match.code = saved.code;
      current = match;
      await match.welcomed();
      return match;
    } catch {
      writeJson(session(), RESUME_KEY, null);
      return null;
    }
  }

  private async welcomed(): Promise<void> {
    const deadline = performance.now() + 5000;
    while (this.seat < 0 && performance.now() < deadline)
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    if (this.seat < 0) {
      this.leave();
      throw new MatchJoinError('server');
    }
  }

  private bind(room: Room<MatchStateView>): void {
    this.room = room;
    this.resumeToken = room.reconnectionToken;
    room.onMessage(MatchServerMessage.WELCOME, (m: WelcomeMessage) => {
      this.seat = m.seat;
      this.code = m.code;
      this.resumeToken = room.reconnectionToken;
      writeJson(session(), RESUME_KEY, { token: room.reconnectionToken, code: m.code });
      useMatch.setState({
        active: true,
        seat: m.seat,
        code: m.code,
        status: 'connected',
        reconnectEndsAt: 0,
      });
      this.publish();
    });
    room.onMessage(MatchServerMessage.MATCH_PHASE, (m: MatchRoomPhaseMessage) => {
      this.observeClock(m.serverNow, 0);
    });
    room.onMessage(MatchServerMessage.BUILD_RESULT, (m: BuildResultMessage) =>
      useMatch.setState({ lastBuild: m }),
    );
    room.onMessage(MatchServerMessage.BUILD_LOCKED, (m: BuildLockedMessage) =>
      useMatch.setState({ locked: m }),
    );
    room.onMessage(MatchServerMessage.RACE_EVENT, (event: RaceEvent) => {
      // Ids only grow within a room; a repeat after a reconnect is dropped here.
      if (event.id <= this.lastEventId) return;
      this.lastEventId = event.id;
      this.raceLink?.event(event);
    });
    room.onMessage(MatchServerMessage.RESULTS, (m: { raceId: number; result: RaceResult }) =>
      useMatch.setState({ result: m }),
    );
    room.onMessage(MatchServerMessage.PONG, (m: { t: number; now: number }) => {
      const rtt = performance.now() - m.t;
      this.rttMs = this.rttMs === 0 ? rtt : this.rttMs * 0.8 + rtt * 0.2;
      this.observeClock(m.now, rtt);
      useMatch.setState({ rttMs: Math.round(this.rttMs) });
    });
    room.onMessage(MatchServerMessage.ERROR, () => undefined);
    room.onStateChange(() => {
      this.publish();
      this.raceLink?.state();
    });
    room.onLeave((code) => {
      if (this.closed) return;
      // Not our own goodbye: the room closed (it expired, or the last rival left).
      if (code === CLOSE_CONSENTED) {
        this.end('closed');
        return;
      }
      if (code === CLOSE_SEAT_FREED) {
        this.end('seat');
        return;
      }
      void this.recover();
    });
    window.clearInterval(this.pingTimer);
    this.pingTimer = window.setInterval(() => this.ping(), PING_MS);
    this.ping();
  }

  /** Clock offset from the round trip with the smallest delay: the best evidence of "now". */
  private observeClock(serverNow: number, rtt: number): void {
    if (rtt > 0 && rtt <= this.bestRtt * 1.2) {
      this.bestRtt = Math.min(this.bestRtt, rtt);
      this.offsetMs = serverNow + rtt / 2 - Date.now();
    } else if (!Number.isFinite(this.bestRtt)) this.offsetMs = serverNow - Date.now();
  }

  /** A server epoch time on this page's clock. */
  toLocal(serverTime: number): number {
    return serverTime > 0 ? serverTime - this.offsetMs : 0;
  }

  /** The socket is up. While it is not, nothing is sent: the browser would only log it. */
  private get open(): boolean {
    return !this.closed && this.room.connection.isOpen;
  }

  private ping(): void {
    if (!this.open) return;
    try {
      const message: { t: number; rtt?: number } = { t: performance.now() };
      if (this.rttMs > 0) message.rtt = Math.round(this.rttMs);
      this.room.send(MatchClientMessage.PING, message);
    } catch {
      // Reconnecting.
    }
  }

  private async recover(): Promise<void> {
    useMatch.setState({
      status: 'reconnecting',
      // What the player is shown: how long the room keeps the seat in this phase. The client
      // keeps trying a little past it in case its clock or the network is slow.
      reconnectEndsAt: Date.now() + matchGraceMs(useMatch.getState().phase),
    });
    this.raceLink?.status('reconnecting');
    const token = this.resumeToken;
    const deadline = performance.now() + RECONNECT_WINDOW_MS;
    while (!this.closed && performance.now() < deadline) {
      try {
        const room = await this.client.reconnect<MatchStateView>(token);
        this.bind(room);
        useMatch.setState({ status: 'connected', reconnectEndsAt: 0 });
        this.raceLink?.status('connected');
        return;
      } catch (error) {
        const message = String((error as { message?: unknown }).message ?? '');
        // The room no longer keeps the seat: stop trying.
        if (/expired|disposed|not found|invalid/i.test(message)) break;
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }
    }
    if (!this.closed) this.end('network');
  }

  private end(reason: 'seat' | 'closed' | 'network'): void {
    this.closed = true;
    window.clearInterval(this.pingTimer);
    writeJson(session(), RESUME_KEY, null);
    useMatch.setState({ status: 'lost', lostReason: reason });
    this.raceLink?.status('lost');
    if (current === this) current = null;
  }

  /** Copies what the room publishes into the store, only when something changed. */
  private publish(): void {
    const state = this.room.state;
    if (!state?.seats) return;
    const seatOf = (key: string): SeatInfo => {
      const s = state.seats.get(key);
      if (!s) return EMPTY_SEAT;
      return {
        present: s.present,
        connected: s.connected,
        host: s.host,
        nickname: s.nickname,
        emblem: s.emblem,
        ready: s.ready,
        loaded: s.loaded,
        vote: (s.vote || '') as RematchChoice | '',
        car: s.car,
        latencyMs: s.latencyMs,
        graceEndsAt: this.toLocal(s.graceEndsAt),
      };
    };
    const next = {
      phase: state.phase as MatchPhase,
      endsAt: this.toLocal(state.phaseEndsAt),
      code: state.code || this.code,
      trackId: state.trackId,
      weatherPresetId: state.weatherPresetId,
      randomTrack: state.randomTrack,
      raceId: state.raceId,
      round: state.round,
      swapped: state.swapped,
      notice: (state.notice || '') as MatchNotice,
      seats: [seatOf('0'), seatOf('1')] as [SeatInfo, SeatInfo],
    };
    const prev = useMatch.getState();
    const same =
      prev.phase === next.phase &&
      Math.abs(prev.endsAt - next.endsAt) < 250 &&
      prev.code === next.code &&
      prev.trackId === next.trackId &&
      prev.weatherPresetId === next.weatherPresetId &&
      prev.randomTrack === next.randomTrack &&
      prev.raceId === next.raceId &&
      prev.round === next.round &&
      prev.swapped === next.swapped &&
      prev.notice === next.notice &&
      sameSeat(prev.seats[0], next.seats[0]) &&
      sameSeat(prev.seats[1], next.seats[1]);
    if (!same) useMatch.setState(next);
  }

  /** This player's race view, if the room has one for the current race. */
  view(): DriveStateView | undefined {
    return this.room.state?.views?.get(String(this.seat));
  }

  /** A link to the current race, for the race view. */
  linkForRace(): MatchRaceLink {
    this.raceLink?.detach();
    this.raceLink = new MatchRaceLink(this, this.room.state?.raceId ?? 0);
    return this.raceLink;
  }

  send(type: string, payload?: unknown): void {
    if (!this.open) return;
    try {
      if (payload === undefined) this.room.send(type);
      else this.room.send(type, payload);
    } catch {
      // Reconnecting: the room's own deadlines decide what happens meanwhile.
    }
  }

  selectTrack(trackId: string, weatherPresetId: string): void {
    this.send(MatchClientMessage.SELECT_TRACK, { trackId, weatherPresetId });
  }
  selectRandom(): void {
    this.send(MatchClientMessage.SELECT_TRACK, { random: true });
  }
  lockTrack(): void {
    this.send(MatchClientMessage.LOCK_TRACK);
  }
  roomReady(): void {
    this.send(MatchClientMessage.ROOM_READY);
  }
  private requestId = 0;
  submitBuild(blueprint: VehicleBlueprint): number {
    const requestId = ++this.requestId;
    this.send(MatchClientMessage.SUBMIT_BUILD, { requestId, blueprint });
    return requestId;
  }
  ready(blueprint: VehicleBlueprint): number {
    const requestId = ++this.requestId;
    this.send(MatchClientMessage.READY, { requestId, blueprint });
    return requestId;
  }
  vote(choice: RematchChoice): void {
    this.send(MatchClientMessage.REMATCH_VOTE, { choice });
  }
  setProfile(profile: MatchProfile): void {
    saveProfile(profile);
    this.send(MatchClientMessage.PROFILE, profile);
  }
  reopen(): void {
    this.send(MatchClientMessage.REOPEN);
  }
  away(): void {
    this.send(MatchClientMessage.NEUTRAL);
  }
  sendInputs(race: number, inputs: InputSample[]): void {
    this.send(MatchClientMessage.PLAYER_INPUT, { race, inputs });
  }

  /** Leaves the match for good. */
  leave(): void {
    if (this.closed) return;
    this.closed = true;
    window.clearInterval(this.pingTimer);
    writeJson(session(), RESUME_KEY, null);
    this.raceLink?.detach();
    this.raceLink = null;
    void this.room.leave(true).catch(() => undefined);
    if (current === this) current = null;
    useMatch.setState({ ...INITIAL });
  }

  get isClosed(): boolean {
    return this.closed;
  }
}

function sameSeat(a: SeatInfo, b: SeatInfo): boolean {
  return (
    a.present === b.present &&
    a.connected === b.connected &&
    a.host === b.host &&
    a.nickname === b.nickname &&
    a.emblem === b.emblem &&
    a.ready === b.ready &&
    a.loaded === b.loaded &&
    a.vote === b.vote &&
    a.car === b.car &&
    a.latencyMs === b.latencyMs &&
    Math.abs(a.graceEndsAt - b.graceEndsAt) < 500
  );
}

/**
 * The race view's link to a race in the match room. It reads this player's own view of the
 * race (its car in full, the rival as seen from outside), sends samples stamped with the race,
 * and stops the race view's clock while the room holds the race on the grid. Leaving the race
 * view only detaches it: the match goes on to results and rematches.
 */
export class MatchRaceLink implements DriveLink {
  readonly mode = 'online' as const;
  onSnapshot: ((snapshot: CarSnapshot) => void) | null = null;
  onRace: ((race: RaceSnapshot) => void) | null = null;
  onEvent: ((event: RaceEvent) => void) | null = null;
  onStatus: ((status: LinkStatus) => void) | null = null;
  private detached = false;

  constructor(
    private readonly match: MatchClient,
    readonly raceId: number,
  ) {}

  get latencyMs(): number {
    return this.match.rttMs;
  }

  get held(): boolean {
    const view = this.match.view();
    return !view || view.raceId !== this.raceId || view.held === true;
  }

  /** The view of this race, or undefined before the room has written it. */
  view(): DriveStateView | undefined {
    const view = this.match.view();
    return view && view.raceId === this.raceId ? view : undefined;
  }

  /** The rival's public blueprint JSON for this race. */
  get rivalBlueprint(): string {
    return this.view()?.rivalBlueprint ?? '';
  }

  state(): void {
    if (this.detached) return;
    const view = this.view();
    if (!view) return;
    const car = toSnapshot(view);
    this.onSnapshot?.(car);
    if (this.onRace) {
      const race = toRace(view, car);
      if (race) this.onRace(race);
    }
  }

  event(event: RaceEvent): void {
    if (!this.detached) this.onEvent?.(event);
  }

  status(status: LinkStatus): void {
    if (!this.detached) this.onStatus?.(status);
  }

  sendInputs(samples: InputSample[]): void {
    if (this.detached || samples.length === 0) return;
    this.match.sendInputs(this.raceId, samples);
  }

  /** A race between two people is restarted only by both voting for a rematch. */
  resetCar(): void {}

  away(): void {
    this.match.away();
  }

  detach(): void {
    this.detached = true;
    this.onSnapshot = null;
    this.onRace = null;
    this.onEvent = null;
    this.onStatus = null;
  }

  leave(): void {
    this.detach();
  }
}
