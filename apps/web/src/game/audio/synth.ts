import type { Curve, Layer, Recipe, Wave } from './recipe.js';
import { ENV_LIMITS } from './recipe.js';

/**
 * Turns a recipe into Web Audio nodes. Works on any `BaseAudioContext`, so exactly the same
 * code runs live and in the offline renders the tests measure.
 *
 * Rules that keep it clean:
 * - every envelope starts at zero and ends at zero with a ramp, so nothing clicks;
 * - a voice has one output gain, separate from its envelopes, which is what gets faded when a
 *   voice is stopped early or stolen;
 * - every node a voice makes is counted in, and counted out when its sources end and it is
 *   disconnected.
 */

/** Counts live nodes by owner, so a leak shows up as a number that does not come back down. */
export class NodeLedger {
  fixed = 0;
  engine = 0;
  voices = 0;
  music = 0;

  get total(): number {
    return this.fixed + this.engine + this.voices + this.music;
  }
}

export type LedgerKey = 'fixed' | 'engine' | 'voices' | 'music';

const LFSR_SCALE = 0.62;

/** A shift register gives more of one bit than the other; without this its noise carries DC. */
function removeMean(data: Float32Array): void {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i]!;
  const mean = sum / data.length;
  for (let i = 0; i < data.length; i++) data[i]! -= mean;
}

/** Per-context shared material: noise tables, pulse waveforms, bit-crush curves. */
export class SynthResources {
  readonly white: AudioBuffer;
  readonly lfsr: AudioBuffer;
  readonly metal: AudioBuffer;
  private readonly pulses = new Map<number, PeriodicWave>();
  private readonly crushCurves = new Map<number, Float32Array<ArrayBuffer>>();

  constructor(readonly ctx: BaseAudioContext) {
    const rate = ctx.sampleRate;
    // White noise from a fixed seed: renders are repeatable.
    this.white = ctx.createBuffer(1, rate, rate);
    const white = this.white.getChannelData(0);
    let seed = 22222;
    for (let i = 0; i < white.length; i++) {
      seed = (seed * 16807) % 2147483647;
      white[i] = (seed / 2147483647) * 2 - 1;
    }
    // The long shift register of the 8-bit consoles: one bit, 32767 steps.
    this.lfsr = ctx.createBuffer(1, 32767, rate);
    const long = this.lfsr.getChannelData(0);
    let reg = 1;
    for (let i = 0; i < long.length; i++) {
      const bit = (reg ^ (reg >> 1)) & 1;
      reg = (reg >> 1) | (bit << 14);
      long[i] = reg & 1 ? LFSR_SCALE : -LFSR_SCALE;
    }
    removeMean(long);
    // The short mode: taps one and six, 93 steps. Each step is held four samples so the buzz
    // sits near 120 Hz at rate 1 and recipes pitch it from there.
    const HOLD = 4;
    this.metal = ctx.createBuffer(1, 93 * HOLD * 8, rate);
    const short = this.metal.getChannelData(0);
    reg = 1;
    for (let i = 0; i < short.length; i += HOLD) {
      const bit = (reg ^ (reg >> 6)) & 1;
      reg = (reg >> 1) | (bit << 14);
      const v = reg & 1 ? LFSR_SCALE : -LFSR_SCALE;
      for (let k = 0; k < HOLD && i + k < short.length; k++) short[i + k] = v;
    }
    removeMean(short);
  }

  noise(wave: Wave): AudioBuffer {
    return wave === 'lfsr' ? this.lfsr : wave === 'metal' ? this.metal : this.white;
  }

  /** A pulse wave of the given duty, band-limited to 48 harmonics. */
  pulse(duty: number): PeriodicWave {
    let wave = this.pulses.get(duty);
    if (!wave) {
      const n = 48;
      const real = new Float32Array(n);
      const imag = new Float32Array(n);
      for (let k = 1; k < n; k++) real[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
      wave = this.ctx.createPeriodicWave(real, imag);
      this.pulses.set(duty, wave);
    }
    return wave;
  }

  /** A staircase with `steps` levels for a wave shaper: amplitude quantization. */
  crush(steps: number): Float32Array<ArrayBuffer> {
    let curve = this.crushCurves.get(steps);
    if (!curve) {
      const size = 2048;
      curve = new Float32Array(new ArrayBuffer(size * 4));
      for (let i = 0; i < size; i++) {
        const x = (i / (size - 1)) * 2 - 1;
        curve[i] = Math.round(x * (steps / 2)) / (steps / 2);
      }
      this.crushCurves.set(steps, curve);
    }
    return curve;
  }
}

export function setOscWave(
  res: SynthResources,
  osc: OscillatorNode,
  wave: 'sq' | 'p25' | 'p12' | 'tri' | 'saw' | 'sin',
): void {
  if (wave === 'p25') osc.setPeriodicWave(res.pulse(0.25));
  else if (wave === 'p12') osc.setPeriodicWave(res.pulse(0.125));
  else
    osc.type =
      wave === 'sq' ? 'square' : wave === 'tri' ? 'triangle' : wave === 'saw' ? 'sawtooth' : 'sine';
}

const isNoise = (wave: Wave) => wave === 'noise' || wave === 'lfsr' || wave === 'metal';

function curveStart(curve: Curve): number {
  return typeof curve === 'number' ? curve : (curve[0]?.[1] ?? 0);
}

function scheduleCurve(
  param: AudioParam,
  curve: Curve,
  t0: number,
  stretch: number,
  scale: number,
  glide: 'exp' | 'lin' | 'step',
): void {
  if (typeof curve === 'number') {
    param.setValueAtTime(curve * scale, t0);
    return;
  }
  let lastT = -1;
  for (let i = 0; i < curve.length; i++) {
    const [time, value] = curve[i]!;
    let t = t0 + time * stretch;
    if (t <= lastT) t = lastT + 0.0005;
    const v = value * scale;
    if (i === 0 || glide === 'step') param.setValueAtTime(v, i === 0 ? t0 : t);
    else if (glide === 'exp' && v > 0) param.exponentialRampToValueAtTime(v, t);
    else param.linearRampToValueAtTime(v, t);
    lastT = t;
  }
}

export type VoiceOptions = {
  /** Context time to start at. */
  when: number;
  /** Linear level of the whole voice. */
  gain: number;
  /** Multiplies every tone frequency and noise rate. */
  pitch?: number;
  /** Multiplies every time in the recipe: a wind-up that takes longer, a whistle that falls further. */
  stretch?: number;
  pan?: number;
};

export type BuiltVoice = {
  out: GainNode;
  panner: StereoPannerNode | null;
  /** Context time at which a one-shot has finished. Infinity for a loop. */
  end: number;
  nodes: AudioNode[];
  sources: AudioScheduledSourceNode[];
};

/**
 * Builds the node graph of one voice, connected to `dest` and scheduled. The caller owns the
 * returned nodes and must hand them to `releaseVoice` once the voice is over.
 */
export function buildVoice(
  res: SynthResources,
  recipe: Recipe,
  dest: AudioNode,
  options: VoiceOptions,
): BuiltVoice {
  const ctx = res.ctx;
  const t0 = options.when;
  const stretch = options.stretch ?? 1;
  const pitch = options.pitch ?? 1;
  const nodes: AudioNode[] = [];
  const sources: AudioScheduledSourceNode[] = [];
  const keep = <T extends AudioNode>(node: T): T => {
    nodes.push(node);
    return node;
  };

  const out = keep(ctx.createGain());
  out.gain.value = options.gain;
  let panner: StereoPannerNode | null = null;
  if (typeof ctx.createStereoPanner === 'function') {
    panner = keep(ctx.createStereoPanner());
    panner.pan.value = options.pan ?? 0;
    out.connect(panner).connect(dest);
  } else out.connect(dest);

  let end = 0;
  for (const layer of recipe.layers) {
    const layerEnd = buildLayer(res, recipe, layer, out, t0, stretch, pitch, keep, sources);
    if (layerEnd > end) end = layerEnd;
  }
  if (recipe.loop) end = Infinity;
  else {
    const stopAt = end + 0.03;
    for (const source of sources) source.stop(stopAt);
  }
  return { out, panner, end, nodes, sources };
}

function buildLayer(
  res: SynthResources,
  recipe: Recipe,
  layer: Layer,
  out: AudioNode,
  voiceStart: number,
  stretch: number,
  pitch: number,
  keep: <T extends AudioNode>(node: T) => T,
  sources: AudioScheduledSourceNode[],
): number {
  const ctx = res.ctx;
  const t0 = voiceStart + (layer.at ?? 0) * stretch;
  const glide = layer.glide ?? 'exp';
  const f0 = curveStart(layer.f) * pitch;

  let head: AudioNode;
  let freqParam: AudioParam;
  if (isNoise(layer.w)) {
    const src = keep(ctx.createBufferSource());
    src.buffer = res.noise(layer.w);
    src.loop = true;
    scheduleCurve(src.playbackRate, layer.f, t0, stretch, pitch, glide);
    // Start each copy somewhere else in the table, deterministically, so two bursts of the
    // same recipe are not sample-identical.
    const offset = ((recipe.id.length * 7919 + Math.floor(t0 * 1000)) % 997) / 997;
    src.start(t0, offset * src.buffer.duration);
    sources.push(src);
    head = src;
    freqParam = src.playbackRate;
  } else {
    const osc = keep(ctx.createOscillator());
    setOscWave(res, osc, layer.w as 'sq');
    scheduleCurve(osc.frequency, layer.f, t0, stretch, pitch, glide);
    osc.start(t0);
    sources.push(osc);
    head = osc;
    freqParam = osc.frequency;
    if (layer.fm) {
      const mod = keep(ctx.createOscillator());
      mod.type = 'sine';
      scheduleCurve(mod.frequency, layer.f, t0, stretch, pitch * layer.fm.ratio, glide);
      const depth = keep(ctx.createGain());
      const deviation = layer.fm.index * f0;
      depth.gain.setValueAtTime(deviation, t0);
      if (layer.fm.decay !== undefined)
        depth.gain.linearRampToValueAtTime(0, t0 + layer.fm.decay * stretch);
      mod.connect(depth).connect(osc.frequency);
      mod.start(t0);
      sources.push(mod);
    }
  }

  let filter: BiquadFilterNode | null = null;
  if (layer.flt) {
    filter = keep(ctx.createBiquadFilter());
    filter.type = layer.flt.t === 'lp' ? 'lowpass' : layer.flt.t === 'hp' ? 'highpass' : 'bandpass';
    filter.Q.value = layer.flt.q ?? 0.7;
    scheduleCurve(filter.frequency, layer.flt.f, t0, stretch, 1, 'exp');
    head.connect(filter);
    head = filter;
  }
  if (layer.crush !== undefined) {
    const shaper = keep(ctx.createWaveShaper());
    shaper.curve = res.crush(layer.crush);
    head.connect(shaper);
    head = shaper;
  }

  // The envelope. It starts at zero and, unless the recipe loops, returns to zero.
  const env = keep(ctx.createGain());
  const level = layer.g ?? 1;
  env.gain.setValueAtTime(0, voiceStart);
  if (t0 > voiceStart) env.gain.setValueAtTime(0, t0);
  let lastT = t0;
  let lastV = 0;
  for (let i = 0; i < layer.env.length; i++) {
    const [time, value] = layer.env[i]!;
    let t = t0 + time * stretch;
    if (i === 0 && t < t0 + ENV_LIMITS.MIN_ATTACK) t = t0 + ENV_LIMITS.MIN_ATTACK;
    if (t <= lastT) t = lastT + 0.0005;
    env.gain.linearRampToValueAtTime(value * level, t);
    lastT = t;
    lastV = value;
  }
  if (!recipe.loop && lastV > 0) {
    lastT += ENV_LIMITS.MIN_RELEASE;
    env.gain.linearRampToValueAtTime(0, lastT);
  }
  head.connect(env);
  head = env;

  if (layer.lfo) {
    const lfo = keep(ctx.createOscillator());
    lfo.type =
      layer.lfo.w === 'sq'
        ? 'square'
        : layer.lfo.w === 'tri'
          ? 'triangle'
          : layer.lfo.w === 'saw'
            ? 'sawtooth'
            : 'sine';
    lfo.frequency.value = layer.lfo.hz / stretch;
    const depth = keep(ctx.createGain());
    if (layer.lfo.to === 'amp') {
      // Tremolo after the envelope: the level swings between 1 and 1 - depth. A square LFO is
      // smoothed by a short low-pass so its edges are ramps, not steps.
      const trem = keep(ctx.createGain());
      trem.gain.value = 1 - layer.lfo.depth / 2;
      depth.gain.value = layer.lfo.depth / 2;
      if (layer.lfo.w === 'sq' || layer.lfo.w === 'saw') {
        const soften = keep(ctx.createBiquadFilter());
        soften.type = 'lowpass';
        soften.frequency.value = Math.max(120, layer.lfo.hz * 12);
        soften.Q.value = 0.5;
        lfo.connect(soften).connect(depth).connect(trem.gain);
      } else lfo.connect(depth).connect(trem.gain);
      head.connect(trem);
      head = trem;
    } else if (layer.lfo.to === 'f') {
      depth.gain.value = layer.lfo.depth * f0;
      lfo.connect(depth).connect(freqParam);
    } else if (filter) {
      depth.gain.value = layer.lfo.depth * curveStart(layer.flt!.f);
      lfo.connect(depth).connect(filter.frequency);
    }
    lfo.start(t0);
    sources.push(lfo);
  }

  head.connect(out);
  return lastT;
}

/** Disconnects everything a voice made. Safe to call twice. */
export function releaseVoice(voice: BuiltVoice): number {
  const count = voice.nodes.length;
  for (const node of voice.nodes) {
    try {
      node.disconnect();
    } catch {
      // Already disconnected.
    }
  }
  voice.nodes.length = 0;
  voice.sources.length = 0;
  return count;
}
