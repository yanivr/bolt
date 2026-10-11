import { CAPS, RateLimiter, TokenBucket, decideVoice, duckHold, duckTargets } from './mixMath.js';
import type { VoiceSlot } from './mixMath.js';
import type { BusId, Recipe } from './recipe.js';
import { BUS_IDS, recipeDuration } from './recipe.js';
import { SFX } from './sfxRecipes.js';
import { SFX_TRIM } from './sfxTrim.js';
import type { BuiltVoice } from './synth.js';
import { NodeLedger, SynthResources, buildVoice, releaseVoice } from './synth.js';

/**
 * The mixer: seven buses into a master limiter, and the voice pool with its hard caps.
 *
 *   voice -> bus volume -> bus duck -> sum -> mute -> compressor -> soft clip -> output
 *
 * The compressor rides the level; the soft clip after it is a fixed ceiling at -1.7 dBFS that
 * nothing can pass, whatever is thrown at it (Section 14.3: "limiting and compression protect
 * volume").
 */

/** Level of each bus before the user's slider. The music sits low (Section 14.3). */
const BUS_TRIM: Record<BusId, number> = {
  engine: 1,
  weapons: 1,
  impacts: 1,
  ambience: 1,
  alerts: 1,
  ui: 1,
  music: 0.28,
};

/** The ceiling of the soft clipper, linear. -1.7 dBFS. */
export const OUTPUT_CEILING = 0.824;

export type VoiceLogEntry = {
  /** Context time, seconds. */
  t: number;
  ev: 'start' | 'stop' | 'end' | 'steal' | 'drop' | 'limit';
  id: string;
  seq: number;
  bus: BusId;
  /** Voices alive after this entry, music excluded. */
  poly: number;
};

export type PlayOptions = {
  when?: number;
  gain?: number;
  pan?: number;
  pitch?: number;
  stretch?: number;
  /** Separates rate limits: the same sound from two cars does not share one. */
  limitKey?: string;
  /** Draw from the shared small-impact allowance (bursts of bullet hits). */
  burst?: boolean;
  /** Level from where the sound is in the world. Kept apart so a moving voice can be re-placed. */
  place?: number;
  /** `gain` is the final level: the calibrated trim is not applied (music instruments). */
  absolute?: boolean;
};

export type Voice = {
  seq: number;
  recipe: Recipe;
  built: BuiltVoice;
  start: number;
  end: number;
  /** Level before placement: trim times the gain asked for. */
  base: number;
  stopped: boolean;
};

type Bus = { vol: GainNode; duck: GainNode };

export class Mixer {
  readonly res: SynthResources;
  readonly ledger = new NodeLedger();
  readonly voices: Voice[] = [];
  /** Set by the debug hook: every start, stop, steal and refusal. */
  onLog: ((entry: VoiceLogEntry) => void) | null = null;
  /** Most voices alive at once since the last reset of the statistic, music excluded. */
  peakVoices = 0;
  peakMusic = 0;

  private readonly buses = {} as Record<BusId, Bus>;
  private readonly sum: GainNode;
  private readonly mute: GainNode;
  private readonly limiter = new RateLimiter();
  private readonly impacts = new TokenBucket(CAPS.impactBurst, CAPS.impactRefillPerSecond);
  private readonly slots: VoiceSlot[] = [];
  private seq = 0;
  private muted = false;

  constructor(
    readonly ctx: BaseAudioContext,
    /** False renders a recipe bare, with no master chain: used to calibrate levels. */
    master = true,
  ) {
    this.res = new SynthResources(ctx);
    this.sum = ctx.createGain();
    this.mute = ctx.createGain();
    this.sum.connect(this.mute);
    this.ledger.fixed += 2;
    if (master) {
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -13;
      comp.knee.value = 8;
      comp.ratio.value = 10;
      comp.attack.value = 0.003;
      comp.release.value = 0.14;
      const clip = ctx.createWaveShaper();
      const size = 4096;
      const curve = new Float32Array(new ArrayBuffer(size * 4));
      const knee = 0.6;
      for (let i = 0; i < size; i++) {
        const x = (i / (size - 1)) * 2 - 1;
        const a = Math.abs(x);
        const y = a <= knee ? a : knee + (0.84 - knee) * Math.tanh((a - knee) / (0.84 - knee));
        curve[i] = Math.sign(x) * y;
      }
      clip.curve = curve;
      this.mute.connect(comp).connect(clip).connect(ctx.destination);
      this.ledger.fixed += 2;
    } else this.mute.connect(ctx.destination);
    for (const id of BUS_IDS) {
      const vol = ctx.createGain();
      vol.gain.value = BUS_TRIM[id];
      const duck = ctx.createGain();
      vol.connect(duck).connect(this.sum);
      this.buses[id] = { vol, duck };
      this.ledger.fixed += 2;
    }
  }

  /** Where a bus takes its input, for the fixed graphs (engines, music). */
  input(bus: BusId): AudioNode {
    return this.buses[bus].vol;
  }

  setBusVolume(bus: BusId, volume: number): void {
    const target = Math.max(0, Math.min(1, volume)) * BUS_TRIM[bus];
    const param = this.buses[bus].vol.gain;
    if (Math.abs(param.value - target) < 1e-4) return;
    param.setTargetAtTime(target, this.ctx.currentTime, 0.03);
  }

  setMuted(muted: boolean): void {
    if (muted === this.muted) return;
    this.muted = muted;
    this.mute.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.02);
  }

  /** Briefly lowers the music and engines around something big. */
  duck(strength: number, soundSeconds: number, when = this.ctx.currentTime): void {
    const targets = duckTargets(strength);
    const hold = duckHold(strength, soundSeconds);
    for (const bus of ['music', 'engine', 'ambience'] as const) {
      const param = this.buses[bus].duck.gain;
      param.cancelScheduledValues(when);
      param.setTargetAtTime(targets[bus], when, 0.012);
      param.setTargetAtTime(1, when + hold, 0.2);
    }
  }

  /** The gain each bus and the mute stage are at right now, for the debug hook and the tests. */
  gains(): Record<BusId | 'mute', number> {
    const out = { mute: this.mute.gain.value } as Record<BusId | 'mute', number>;
    for (const id of BUS_IDS) out[id] = this.buses[id].vol.gain.value;
    return out;
  }

  /** Voices alive, music excluded. */
  get activeVoices(): number {
    let n = 0;
    for (const v of this.voices) if (v.recipe.bus !== 'music') n++;
    return n;
  }

  private log(ev: VoiceLogEntry['ev'], recipe: Recipe, seq: number, t: number): void {
    this.onLog?.({ t, ev, id: recipe.id, seq, bus: recipe.bus, poly: this.activeVoices });
  }

  /** Frees every voice that has finished. Cheap; called on every play and on every snapshot. */
  prune(now = this.ctx.currentTime): void {
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const voice = this.voices[i]!;
      if (voice.end > now) continue;
      this.voices.splice(i, 1);
      this.free(voice);
      this.log('end', voice.recipe, voice.seq, now);
    }
  }

  /**
   * Starts a sound. Returns null when it is refused: unknown, inside its rate limit, or weaker
   * than everything in a full pool.
   */
  play(id: string, options: PlayOptions = {}): Voice | null {
    const recipe = SFX[id];
    if (!recipe) return null;
    return this.playRecipe(recipe, options);
  }

  playRecipe(recipe: Recipe, options: PlayOptions = {}): Voice | null {
    const now = this.ctx.currentTime;
    const when = Math.max(options.when ?? now, now);
    this.prune(now);
    const seq = ++this.seq;
    if (
      recipe.limitMs !== undefined &&
      !this.limiter.allow(`${recipe.id}:${options.limitKey ?? ''}`, when, recipe.limitMs)
    ) {
      this.log('limit', recipe, seq, when);
      return null;
    }
    if (options.burst && !this.impacts.take(when)) {
      this.log('limit', recipe, seq, when);
      return null;
    }
    const slots = this.slots;
    slots.length = 0;
    for (const v of this.voices)
      slots.push({ pri: v.recipe.pri, start: v.start, bus: v.recipe.bus, id: v.recipe.id });
    // A sound over its copy limit and a full bus can both apply: ask until there is room.
    for (let guard = 0; guard < 4; guard++) {
      const decision = decideVoice(slots, recipe);
      if (decision.action === 'play') break;
      if (decision.action === 'drop') {
        this.log('drop', recipe, seq, when);
        return null;
      }
      const victim = this.voices[decision.index]!;
      this.log('steal', victim.recipe, victim.seq, when);
      this.fade(victim, 0.012, when);
      // A stolen voice is out of the count at once; its last 12 ms are a fade, not a voice.
      this.voices.splice(decision.index, 1);
      slots.splice(decision.index, 1);
      this.dying.push(victim);
    }

    const stretch = options.stretch ?? 1;
    const base = options.absolute
      ? (options.gain ?? 1)
      : (SFX_TRIM[recipe.id] ?? 0.2) * (options.gain ?? 1);
    const voiceOptions = { when, gain: base * (options.place ?? 1), stretch } as {
      when: number;
      gain: number;
      stretch: number;
      pitch?: number;
      pan?: number;
    };
    if (options.pitch !== undefined) voiceOptions.pitch = options.pitch;
    if (options.pan !== undefined) voiceOptions.pan = options.pan;
    const built = buildVoice(this.res, recipe, this.buses[recipe.bus].vol, voiceOptions);
    this.ledger[recipe.bus === 'music' ? 'music' : 'voices'] += built.nodes.length;
    const voice: Voice = { seq, recipe, built, start: when, end: built.end, base, stopped: false };
    this.voices.push(voice);
    const alive = this.activeVoices;
    if (recipe.bus === 'music') {
      let music = 0;
      for (const v of this.voices) if (v.recipe.bus === 'music') music++;
      if (music > this.peakMusic) this.peakMusic = music;
    } else if (alive > this.peakVoices) this.peakVoices = alive;
    if (recipe.duck)
      this.duck(recipe.duck, recipe.loop ? 0.3 : recipeDuration(recipe, stretch), when);
    this.log('start', recipe, seq, when);
    this.reap(now);
    return voice;
  }

  /** Stolen voices on their way out: no longer counted, freed when their fade is over. */
  private readonly dying: Voice[] = [];

  private reap(now: number): void {
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const voice = this.dying[i]!;
      if (voice.end > now) continue;
      this.dying.splice(i, 1);
      this.free(voice);
    }
  }

  private free(voice: Voice): void {
    this.ledger[voice.recipe.bus === 'music' ? 'music' : 'voices'] -= releaseVoice(voice.built);
  }

  private fade(voice: Voice, release: number, when: number): void {
    const param = voice.built.out.gain;
    param.cancelScheduledValues(when);
    param.setTargetAtTime(0, when, release / 4);
    const stopAt = when + release + 0.02;
    for (const source of voice.built.sources) {
      try {
        source.stop(stopAt);
      } catch {
        // Already stopped.
      }
    }
    voice.end = Math.min(voice.end, stopAt);
    voice.stopped = true;
  }

  /** Fades a voice out and frees it. For loops, and for cutting a one-shot short. */
  stop(voice: Voice, release?: number): void {
    if (voice.stopped) return;
    const now = this.ctx.currentTime;
    this.fade(voice, release ?? voice.recipe.release ?? 0.03, now);
    this.log('stop', voice.recipe, voice.seq, now);
  }

  /** Moves a living voice: level and stereo position glide, they never jump. */
  place(voice: Voice, gain: number, pan: number): void {
    if (voice.stopped) return;
    const now = this.ctx.currentTime;
    voice.built.out.gain.setTargetAtTime(voice.base * gain, now, 0.05);
    voice.built.panner?.pan.setTargetAtTime(pan, now, 0.05);
  }

  /** Bends a living voice by `cents`: every tone and noise source moves together. */
  bend(voice: Voice, cents: number): void {
    if (voice.stopped) return;
    const now = this.ctx.currentTime;
    for (const source of voice.built.sources) {
      const detune = (source as OscillatorNode).detune as AudioParam | undefined;
      detune?.setTargetAtTime(cents, now, 0.08);
    }
  }

  stopAll(release = 0.03): void {
    for (const voice of this.voices) this.stop(voice, release);
  }

  /** Stops everything on the given buses. */
  stopBuses(buses: readonly BusId[], release = 0.03): void {
    for (const voice of this.voices)
      if (buses.includes(voice.recipe.bus)) this.stop(voice, release);
  }

  /** Voices still fading after a steal, for the leak accounting. */
  get fadingVoices(): number {
    return this.dying.length;
  }

  /** Frees finished and fading voices alike. */
  sweep(now = this.ctx.currentTime): void {
    this.prune(now);
    this.reap(now);
  }

  resetLimits(): void {
    this.limiter.reset();
    this.impacts.reset();
  }
}
