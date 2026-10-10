import type { CarSnapshot, InputSample, RaceEvent } from '@bolt/shared';

/** Where the authoritative simulation for this session lives. */
export type LinkMode = 'online' | 'offline';
export type LinkStatus = 'connected' | 'reconnecting' | 'lost';

/**
 * The race view talks to its authority through this interface only. The online link is a
 * Colyseus room on the game server. The offline link is a development stand-in that runs the
 * same shared session in the page, so the driving feel can be reviewed on hardware before a
 * server is deployed. Both deliver snapshots and events in exactly the same shape.
 */
export interface DriveLink {
  readonly mode: LinkMode;
  sendInputs(samples: InputSample[]): void;
  resetCar(): void;
  leave(): void;
  onSnapshot: ((snapshot: CarSnapshot) => void) | null;
  onEvent: ((event: RaceEvent) => void) | null;
  onStatus: ((status: LinkStatus) => void) | null;
  /** Round-trip estimate in milliseconds, or 0 when unknown or offline. */
  readonly latencyMs: number;
}
