import type { CarSnapshot, InputSample, RaceEvent, RaceSnapshot } from '@bolt/shared';

/** Where the authoritative simulation for this session lives. */
export type LinkMode = 'online' | 'offline';
export type LinkStatus = 'connected' | 'reconnecting' | 'lost';

/**
 * The race view talks to its authority through this interface only. The online link is a
 * Colyseus room on the game server. The offline link is a development stand-in that runs the
 * same shared race in the page, so the game can be reviewed on hardware before a server is
 * deployed and so showcase scenarios can be played back. Both deliver snapshots and events in
 * exactly the same shape.
 */
export interface DriveLink {
  readonly mode: LinkMode;
  sendInputs(samples: InputSample[]): void;
  /** Puts the whole race back on the grid. */
  resetCar(): void;
  leave(): void;
  /** The driver's own car: what the predictor reconciles against. */
  onSnapshot: ((snapshot: CarSnapshot) => void) | null;
  /**
   * The race around it: the rival, everything in flight and on the road, standings, result.
   * Delivered right after `onSnapshot` for the same tick. `race.car` is that same snapshot.
   */
  onRace: ((race: RaceSnapshot) => void) | null;
  /** Discrete events, each exactly once and in order of their ids. */
  onEvent: ((event: RaceEvent) => void) | null;
  onStatus: ((status: LinkStatus) => void) | null;
  /** Round-trip estimate in milliseconds, or 0 when unknown or offline. */
  readonly latencyMs: number;
  /**
   * True while the authority holds the race on the grid and the client must not run its
   * prediction clock (the match room while both players load). Absent means never.
   */
  readonly held?: boolean;
  /** The page went to the background: the authority drives the car on neutral (Section 5.10). */
  away?(): void;
}
