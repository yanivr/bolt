/** What the capture tools and the end-to-end tests may ask of a running race (debug only). */
export type RaceDebugHook = {
  /** True when the race only advances through `advance`. */
  manual: boolean;
  /** Runs this many 60 Hz frames before the next one is drawn. */
  advance(frames: number): void;
  /** Runs this many 60 Hz frames at once, inside the call. Manual clock only. */
  run(frames: number): void;
  /** Frames still to run from the last `advance`. */
  pending(): number;
  /** Race ticks since GO, and the tick of the newest snapshot. */
  raceTick(): number;
  tick(): number;
  stats(): Record<string, number | string>;
  /** Middle of the two cars on the page, in CSS pixels: where a capture should look. */
  focus(): { x: number; y: number };
  setQuality(value: 'auto' | 'high' | 'low'): void;
};

declare global {
  interface Window {
    __boltRace?: RaceDebugHook;
  }
}

export {};
