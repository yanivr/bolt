import type {
  CarSnapshot,
  DriveJoinOptions,
  InputSample,
  PlayerInputMessage,
  RaceEvent,
  RaceSnapshot,
} from '@bolt/shared';
import { ClientMessage, JOIN_ERROR_CODES, ROOM_DRIVE, ServerMessage } from '@bolt/shared';
import type { Room } from 'colyseus.js';
import { Client } from 'colyseus.js';
import { serverOrigin } from './api.js';
import type { DriveLink, LinkStatus } from './link.js';
import type { DriveStateView, NetView } from './stateView.js';
import { toRace, toSnapshot } from './stateView.js';

export type JoinFailure = 'version' | 'unauthorized' | 'build' | 'unavailable';

export class JoinError extends Error {
  constructor(readonly reason: JoinFailure) {
    super(reason);
  }
}

const RECONNECT_WINDOW_MS = 18_000;

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

  get held(): boolean {
    return this.room.state?.held === true;
  }

  /** How this driver's input is reaching the room, for diagnostics. */
  get net(): NetView | null {
    return this.room.state?.net ?? null;
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
        // The acknowledgement comes the room's input delay after the sample arrived.
        const delayMs = (state.net?.delay ?? 0) * (1000 / 30);
        const rtt = Math.max(1, performance.now() - sent - delayMs);
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
    const race = this.room.state?.raceId;
    const message: PlayerInputMessage =
      typeof race === 'number' && race > 0 ? { race, inputs: samples } : { inputs: samples };
    try {
      this.room.send(ClientMessage.PLAYER_INPUT, message);
    } catch {
      // The socket is mid-reconnect; these samples are replayed from the pending buffer.
    }
  }

  away(): void {
    try {
      this.room.send(ClientMessage.NEUTRAL);
    } catch {
      // Reconnecting: the room already drives the car on neutral.
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
