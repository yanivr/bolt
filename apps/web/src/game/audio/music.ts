import type { Mixer } from './mixer.js';
import type { Recipe } from './recipe.js';
import { hz } from './sfxRecipes.js';

/**
 * Race music (Section 14.3): an original chiptune theme on four channels, two pulse voices, a
 * triangle bass and a noise kit, sequenced in code. It sits low in the mix on its own bus with
 * its own volume, and it adapts: the normal race arrangement, a faster and denser one for the
 * final lap and the finishing window, and a clean stop for the result stinger.
 *
 * The theme is data: a chord per bar and a list of notes. Notes are scheduled a fraction of a
 * second ahead on the audio clock, never from animation frames, so timing does not depend on
 * the frame rate.
 */

export type MusicIntensity = 'normal' | 'final';

type Note = readonly [step: number, midi: number, steps: number];

export type Theme = {
  id: string;
  title: string;
  /** Beats a minute for the normal arrangement and for the final lap. 100 to 145. */
  bpm: number;
  bpmFinal: number;
  /** Bass root (MIDI) and the four chord tones of the arpeggio, per bar. */
  bars: ReadonlyArray<{ root: number; chord: readonly [number, number, number, number] }>;
  /** The melody, one list of notes per bar. Sixteen steps to the bar. */
  lead: ReadonlyArray<readonly Note[]>;
};

/** "Neon Cut", for the night city track. A minor, eight bars. */
export const THEME_NEON_CUT: Theme = {
  id: 'neon_cut',
  title: 'Neon Cut',
  bpm: 128,
  bpmFinal: 140,
  bars: [
    { root: 45, chord: [69, 72, 76, 81] },
    { root: 45, chord: [69, 72, 76, 81] },
    { root: 41, chord: [65, 69, 72, 77] },
    { root: 41, chord: [65, 69, 72, 77] },
    { root: 48, chord: [64, 67, 72, 76] },
    { root: 48, chord: [64, 67, 72, 76] },
    { root: 43, chord: [62, 67, 71, 74] },
    { root: 40, chord: [64, 68, 71, 76] },
  ],
  lead: [
    [
      [0, 76, 3],
      [3, 81, 1],
      [4, 79, 2],
      [6, 76, 2],
      [8, 72, 3],
      [11, 74, 1],
      [12, 76, 4],
    ],
    [
      [0, 81, 2],
      [2, 79, 2],
      [4, 76, 2],
      [6, 74, 2],
      [8, 72, 2],
      [10, 71, 2],
      [12, 69, 4],
    ],
    [
      [0, 72, 3],
      [3, 77, 1],
      [4, 81, 4],
      [8, 79, 2],
      [10, 77, 2],
      [12, 76, 2],
      [14, 72, 2],
    ],
    [
      [0, 69, 2],
      [2, 72, 2],
      [4, 77, 4],
      [8, 76, 2],
      [10, 74, 2],
      [12, 72, 4],
    ],
    [
      [0, 79, 3],
      [3, 76, 1],
      [4, 79, 2],
      [6, 84, 2],
      [8, 83, 3],
      [11, 79, 1],
      [12, 76, 4],
    ],
    [
      [0, 76, 2],
      [2, 79, 2],
      [4, 84, 2],
      [6, 86, 2],
      [8, 88, 4],
      [12, 86, 2],
      [14, 84, 2],
    ],
    [
      [0, 83, 3],
      [3, 86, 1],
      [4, 83, 2],
      [6, 79, 2],
      [8, 74, 3],
      [11, 79, 1],
      [12, 83, 4],
    ],
    [
      [0, 80, 2],
      [2, 83, 2],
      [4, 88, 4],
      [8, 86, 2],
      [10, 83, 2],
      [12, 80, 2],
      [14, 76, 2],
    ],
  ],
};

export const THEMES: Readonly<Record<string, Theme>> = { city_01: THEME_NEON_CUT };
export const DEFAULT_THEME = THEME_NEON_CUT;

const A4 = hz(69);

/** The instruments. Envelopes are written for one sixteenth and stretched to the note. */
const INSTRUMENT = {
  lead: {
    id: 'mus_lead',
    bus: 'music',
    cat: 'status',
    pri: 12,
    note: 'Music lead: 25 percent pulse with a little vibrato.',
    layers: [
      {
        w: 'p25',
        f: A4,
        env: [
          [0.004, 1],
          [0.03, 0.7],
          [0.09, 0.6],
          [0.11, 0],
        ],
        lfo: { w: 'sin', hz: 6, depth: 0.006, to: 'f' },
      },
    ],
  },
  arp: {
    id: 'mus_arp',
    bus: 'music',
    cat: 'status',
    pri: 8,
    note: 'Music arpeggio: thin 12.5 percent pulse, plucked.',
    layers: [
      {
        w: 'p12',
        f: A4,
        env: [
          [0.003, 1],
          [0.08, 0],
        ],
      },
    ],
  },
  bass: {
    id: 'mus_bass',
    bus: 'music',
    cat: 'status',
    pri: 11,
    note: 'Music bass: triangle with a square octave for bite.',
    layers: [
      {
        w: 'tri',
        f: A4,
        env: [
          [0.004, 1],
          [0.1, 0.8],
          [0.12, 0],
        ],
      },
      {
        w: 'sq',
        f: A4 * 2,
        env: [
          [0.004, 0.16],
          [0.06, 0],
        ],
      },
    ],
  },
  kick: {
    id: 'mus_kick',
    bus: 'music',
    cat: 'status',
    pri: 10,
    note: 'Music kick: a sine drop with a click.',
    layers: [
      {
        w: 'sin',
        f: [
          [0, 170],
          [0.09, 46],
        ],
        env: [
          [0.003, 1],
          [0.13, 0],
        ],
      },
      {
        w: 'lfsr',
        f: 0.4,
        env: [
          [0.002, 0.5],
          [0.02, 0],
        ],
      },
    ],
  },
  snare: {
    id: 'mus_snare',
    bus: 'music',
    cat: 'status',
    pri: 9,
    note: 'Music snare: crunchy shift-register noise over a short tone.',
    layers: [
      {
        w: 'lfsr',
        f: 1,
        env: [
          [0.002, 1],
          [0.1, 0],
        ],
        flt: { t: 'bp', f: 2400, q: 0.7 },
        crush: 6,
      },
      {
        w: 'tri',
        f: [
          [0, 240],
          [0.05, 170],
        ],
        env: [
          [0.002, 0.6],
          [0.06, 0],
        ],
      },
    ],
  },
  hat: {
    id: 'mus_hat',
    bus: 'music',
    cat: 'status',
    pri: 5,
    note: 'Music hat: a tick of metallic noise.',
    layers: [
      {
        w: 'metal',
        f: 4,
        env: [
          [0.002, 1],
          [0.03, 0],
        ],
        flt: { t: 'hp', f: 6000 },
      },
    ],
  },
} as const satisfies Record<string, Recipe>;

export const MUSIC_RECIPES: readonly Recipe[] = Object.values(INSTRUMENT);

/** Absolute levels of the instruments on the music bus. */
const LEVEL = { lead: 0.2, arp: 0.085, bass: 0.34, kick: 0.42, snare: 0.2, hat: 0.07 } as const;

const STEPS = 16;
const KICK = [0, 6, 8];
const KICK_FINAL = [0, 4, 8, 12];
const SNARE = [4, 12];
const FILL = [12, 13, 14, 15];

/** What one step of the theme plays: used by the player and by the tests. */
export type MusicEvent = { instrument: keyof typeof INSTRUMENT; midi: number; steps: number };

/**
 * The notes on one sixteenth of the theme. `cycle` counts how many times the theme has come
 * round: the arpeggio joins on odd cycles so the loop is not the same eight bars forever.
 */
export function stepEvents(
  theme: Theme,
  bar: number,
  step: number,
  cycle: number,
  intensity: MusicIntensity,
): MusicEvent[] {
  const events: MusicEvent[] = [];
  const chords = theme.bars[bar % theme.bars.length]!;
  const final = intensity === 'final';
  const lastBar = bar % theme.bars.length === theme.bars.length - 1;
  for (const [at, midi, steps] of theme.lead[bar % theme.lead.length]!)
    if (at === step) events.push({ instrument: 'lead', midi, steps });
  if (step % 2 === 0) {
    // Root on the beat, the octave on the off-beats, a fifth to turn the bar round.
    const k = step / 2;
    const midi = chords.root + (k === 2 || k === 6 ? 12 : k === 5 ? 7 : 0);
    events.push({ instrument: 'bass', midi, steps: final ? 1.4 : 1.7 });
  }
  if (final || cycle % 2 === 1) {
    const order = final ? [0, 1, 2, 3, 2, 1] : [0, 2, 1, 3];
    events.push({ instrument: 'arp', midi: chords.chord[order[step % order.length]!]!, steps: 1 });
  }
  if ((final ? KICK_FINAL : KICK).includes(step))
    events.push({ instrument: 'kick', midi: 69, steps: 1 });
  if (SNARE.includes(step) || (lastBar && FILL.includes(step)))
    events.push({ instrument: 'snare', midi: 69, steps: 1 });
  if (final || step % 2 === 0) events.push({ instrument: 'hat', midi: 69, steps: 1 });
  return events;
}

export class MusicPlayer {
  private theme: Theme = DEFAULT_THEME;
  private intensity: MusicIntensity = 'normal';
  private playing = false;
  private nextTime = 0;
  private step = 0;
  private bar = 0;
  private cycle = 0;

  constructor(private readonly mixer: Mixer) {}

  get isPlaying(): boolean {
    return this.playing;
  }

  get currentIntensity(): MusicIntensity {
    return this.intensity;
  }

  start(theme: Theme = DEFAULT_THEME, when = this.mixer.ctx.currentTime): void {
    this.theme = theme;
    this.playing = true;
    this.intensity = 'normal';
    this.nextTime = when + 0.02;
    this.step = 0;
    this.bar = 0;
    this.cycle = 0;
  }

  /** Takes effect on the next step: the tempo and the arrangement change together. */
  setIntensity(intensity: MusicIntensity): void {
    this.intensity = intensity;
  }

  stop(): void {
    if (!this.playing) return;
    this.playing = false;
    this.mixer.stopBuses(['music'], 0.25);
  }

  /** Schedules every step that begins before `until` (context time). */
  pump(until: number): void {
    if (!this.playing) return;
    const now = this.mixer.ctx.currentTime;
    // After a pause (tab hidden) pick up from now rather than playing the backlog at once.
    if (this.nextTime < now - 0.25) this.nextTime = now + 0.02;
    let guard = 0;
    while (this.nextTime < until && guard++ < 64) {
      const bpm = this.intensity === 'final' ? this.theme.bpmFinal : this.theme.bpm;
      const stepSeconds = 60 / bpm / 4;
      for (const event of stepEvents(this.theme, this.bar, this.step, this.cycle, this.intensity)) {
        const recipe = INSTRUMENT[event.instrument];
        this.mixer.playRecipe(recipe, {
          when: this.nextTime,
          gain: LEVEL[event.instrument],
          absolute: true,
          pitch: hz(event.midi) / A4,
          // Envelopes are written for a tenth of a second; stretch to the note's length.
          stretch: Math.max(0.5, (event.steps * stepSeconds) / 0.11),
        });
      }
      this.nextTime += stepSeconds;
      if (++this.step >= STEPS) {
        this.step = 0;
        if (++this.bar >= this.theme.bars.length) {
          this.bar = 0;
          this.cycle++;
        }
      }
    }
  }
}
