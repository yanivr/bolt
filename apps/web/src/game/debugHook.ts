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
  /** The local car on the page, in CSS pixels (weather captures crop round it). */
  ownCar?(): { x: number; y: number };
  /**
   * The view as drawn: the `Camera` setting, the whole-number world scale, the canvas size,
   * the world pixels it shows, where it is, and the terrain chunks it touches right now.
   */
  view(): {
    distance: 'close' | 'medium' | 'far';
    filter: 'pixelated' | 'smooth';
    scale: number;
    widthPx: number;
    heightPx: number;
    worldWidth: number;
    worldHeight: number;
    cssPerWorld: number;
    scrollX: number;
    scrollY: number;
    chunks: number;
    chunksMax: number;
    chunksTotal: number;
  };
};

declare global {
  interface Window {
    __boltRace?: RaceDebugHook;
  }
}

export {};
