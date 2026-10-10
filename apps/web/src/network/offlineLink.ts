import type { CarSnapshot, DriveSession, InputSample, RaceEvent } from '@bolt/shared';
import { countdownSeconds, raceTimeMs, resetDriveSession, stepDriveSession } from '@bolt/shared';
import type { DriveLink, LinkStatus } from './link.js';

/**
 * In-page authority for the offline test drive. It consumes one input sample per simulation
 * tick, exactly like the server room, and reports the same snapshots and race events. It is a
 * development aid for Milestone A, clearly badged in the HUD; real races always use the server.
 */
export class OfflineLink implements DriveLink {
  readonly mode = 'offline' as const;
  readonly latencyMs = 0;
  onSnapshot: ((snapshot: CarSnapshot) => void) | null = null;
  onEvent: ((event: RaceEvent) => void) | null = null;
  onStatus: ((status: LinkStatus) => void) | null = null;
  private ack = -1;
  private eventId = 0;

  constructor(private readonly session: DriveSession) {}

  sendInputs(samples: InputSample[]): void {
    for (const sample of samples) {
      if (sample.sequence <= this.ack) continue;
      this.ack = sample.sequence;
      const result = stepDriveSession(this.session, sample);
      const tick = this.session.tick;
      if (result.event === 'checkpoint') {
        this.onEvent?.({
          id: ++this.eventId,
          type: 'checkpoint',
          tick,
          index: this.session.progress.checkpointIndex,
        });
      } else if (result.event === 'lap') {
        this.onEvent?.({
          id: ++this.eventId,
          type: 'lap',
          tick,
          lap: this.session.progress.lap,
          lapTimeMs: result.lapTimeMs,
        });
      } else if (result.event === 'finish') {
        this.onEvent?.({
          id: ++this.eventId,
          type: 'finish',
          tick,
          raceTimeMs: raceTimeMs(this.session),
        });
      }
    }
    this.onSnapshot?.(this.snapshot());
  }

  resetCar(): void {
    resetDriveSession(this.session);
    this.onSnapshot?.(this.snapshot());
  }

  leave(): void {
    this.onSnapshot = null;
    this.onEvent = null;
    this.onStatus = null;
  }

  private snapshot(): CarSnapshot {
    const s = this.session;
    return {
      tick: s.tick,
      ackSequence: this.ack,
      raceTimeMs: raceTimeMs(s),
      phase: s.phase,
      countdown: countdownSeconds(s),
      countdownTicks: s.phase === 'COUNTDOWN' ? Math.max(0, s.countdownTicks) : 0,
      motion: { ...s.motion },
      progress: { ...s.progress },
      bestLapMs: s.bestLapMs,
      lastLapMs: s.lastLapMs,
    };
  }
}
