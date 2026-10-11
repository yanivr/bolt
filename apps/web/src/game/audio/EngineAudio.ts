import { endRaceAudio, liveAudio, setDriveVolumes, unlockAudio } from './index.js';

/**
 * What the race scene holds. It began in Milestone A as the whole of the game's sound (an
 * engine drone, a thump and a beep); it is now the scene's door into the audio system in this
 * folder, with the same five calls it always had. Everything else the race sounds like comes
 * from `raceFeed`, which the audio system listens to by itself: the scene does not need to
 * know that weapons make noise.
 *
 * - `unlock()` from a pointer or key handler. The audio module also listens for gestures
 *   itself, so sound works on screens that never construct this class.
 * - `setVolumes(engine, effects, muted)` every frame, from the settings store.
 * - `update(...)` every frame, from the predicted car: this is what keeps the engine note
 *   glued to the throttle, ahead of the 15 Hz snapshots.
 * - `thump(severity)` on a wall strike, `beep(go)` on each countdown light.
 */
export class EngineAudio {
  /** Call from a pointer or key handler. Safe to call repeatedly. */
  unlock(): void {
    unlockAudio();
  }

  setVolumes(engine: number, effects: number, muted: boolean): void {
    setDriveVolumes(engine, effects, muted);
  }

  /** Per-frame update from the predicted car. Speeds are world pixels per second. */
  update(
    forwardSpeed: number,
    throttle: number,
    slipRatio: number,
    topSpeed: number,
    active: boolean,
  ): void {
    liveAudio()?.frame(forwardSpeed, throttle, slipRatio, topSpeed, active);
  }

  /** The body hitting a wall. `strength` is 0 to 1. */
  thump(strength: number): void {
    liveAudio()?.thump(strength);
  }

  /** Countdown and GO beeps. */
  beep(high: boolean): void {
    liveAudio()?.beep(high);
  }

  /** The race view is closing: its sounds stop. The audio context stays for the menus. */
  dispose(): void {
    endRaceAudio();
  }
}
