import type { SurfaceId } from '@bolt/shared';
import type { EngineRecipe } from './engineRecipes.js';
import type { GearState } from './mixMath.js';
import { clamp, engineSpeed, smooth } from './mixMath.js';
import { ENGINE_TRIM } from './sfxTrim.js';
import type { NodeLedger, SynthResources } from './synth.js';
import { setOscWave } from './synth.js';

/**
 * A running engine: a fixed graph built once from an `EngineRecipe`, after which only
 * parameters move. `update` is called every frame for the player's car and fifteen times a
 * second for the rival's; every change is a glide (`setTargetAtTime`), so pitch never steps
 * however coarse the data is. No node is created after construction.
 */

export type EngineInput = {
  /** Road speed as a share of nominal top speed. */
  speedShare: number;
  /** 0 to 1. */
  throttle: number;
  /** Powertrain wind-up, 0 to 1 (turbos, turbine). */
  spool: number;
  /** Seconds into the engine's repeating output cycle. */
  clock: number;
  /** False silences the engine (paused, finished, not racing). */
  active: boolean;
  /** 0 to 1: how hard an EMP is chopping the sound. */
  stutter: number;
  /** Distance level and stereo position. */
  gain: number;
  pan: number;
};

/** What the engine asks its owner to play on top: blow-off, spring release, fuel pulse. */
export type EngineExtra = 'turbo_blowoff' | 'spring_release' | 'rocket_pulse';

/** Level of the engine bus content before trims. The calibration sets each engine's trim. */
const ENGINE_BASE = 0.3;

export class EngineVoice {
  readonly nodeCount: number;
  private readonly nodes: AudioNode[] = [];
  private readonly sources: AudioScheduledSourceNode[] = [];
  private readonly oscs: OscillatorNode[] = [];
  private readonly filter: BiquadFilterNode;
  private readonly toneLevel: GainNode;
  private readonly lumpLfo: OscillatorNode | null = null;
  private readonly lumpDepth: GainNode | null = null;
  private readonly lumpGain: GainNode | null = null;
  private readonly whines: OscillatorNode[] = [];
  private readonly whineGain: GainNode | null = null;
  private readonly noiseBand: BiquadFilterNode | null = null;
  private readonly noiseGain: GainNode | null = null;
  private readonly gateLfo: OscillatorNode | null = null;
  private readonly stutterDepth: GainNode;
  private readonly stutterGain: GainNode;
  private readonly panner: StereoPannerNode | null = null;
  private readonly level: GainNode;
  private readonly gear: GearState = { gear: 1 };
  private readonly trim: number;
  private highThrottleAt = -10;
  private lastBlowoff = -10;
  private disposed = false;
  /** Normalized engine speed of the last update, for tests and the debug hook. */
  rpm = 0;
  firingHz = 0;

  constructor(
    private readonly res: SynthResources,
    readonly recipe: EngineRecipe,
    dest: AudioNode,
    private readonly ledger: NodeLedger,
    private readonly onExtra: ((extra: EngineExtra, gain: number) => void) | null = null,
    /** Replaces the calibrated trim. Only the calibration itself passes this. */
    trimOverride?: number,
  ) {
    const ctx = res.ctx;
    const keep = <T extends AudioNode>(node: T): T => {
      this.nodes.push(node);
      return node;
    };
    const start = (source: AudioScheduledSourceNode) => {
      source.start();
      this.sources.push(source);
    };
    this.trim = trimOverride ?? ENGINE_TRIM[recipe.key] ?? 1;

    // Output: everything -> EMP stutter -> pan -> level -> bus.
    const out = keep(ctx.createGain());
    this.stutterGain = keep(ctx.createGain());
    const stutterLfo = keep(ctx.createOscillator());
    stutterLfo.type = 'square';
    stutterLfo.frequency.value = 11.5;
    const stutterSoft = keep(ctx.createBiquadFilter());
    stutterSoft.type = 'lowpass';
    stutterSoft.frequency.value = 90;
    this.stutterDepth = keep(ctx.createGain());
    this.stutterDepth.gain.value = 0;
    stutterLfo.connect(stutterSoft).connect(this.stutterDepth).connect(this.stutterGain.gain);
    start(stutterLfo);
    this.level = keep(ctx.createGain());
    this.level.gain.value = 0;
    out.connect(this.stutterGain);
    if (typeof ctx.createStereoPanner === 'function') {
      this.panner = keep(ctx.createStereoPanner());
      this.stutterGain.connect(this.panner).connect(this.level);
    } else this.stutterGain.connect(this.level);
    this.level.connect(dest);

    // Tone channels -> (crush) -> lump -> low-pass -> level.
    const toneSum = keep(ctx.createGain());
    for (const spec of recipe.oscs) {
      const osc = keep(ctx.createOscillator());
      setOscWave(res, osc, spec.w);
      osc.frequency.value = recipe.idleHz * spec.mult;
      const gain = keep(ctx.createGain());
      gain.gain.value = spec.gain;
      osc.connect(gain).connect(toneSum);
      start(osc);
      this.oscs.push(osc);
    }
    let head: AudioNode = toneSum;
    if (recipe.crush !== undefined) {
      const shaper = keep(ctx.createWaveShaper());
      shaper.curve = res.crush(recipe.crush);
      head.connect(shaper);
      head = shaper;
    }
    if (recipe.lump) {
      this.lumpGain = keep(ctx.createGain());
      this.lumpGain.gain.value = 1 - recipe.lump.depth / 2;
      this.lumpLfo = keep(ctx.createOscillator());
      this.lumpLfo.type = 'sine';
      this.lumpLfo.frequency.value = recipe.idleHz * recipe.lump.mult;
      this.lumpDepth = keep(ctx.createGain());
      this.lumpDepth.gain.value = recipe.lump.depth / 2;
      this.lumpLfo.connect(this.lumpDepth).connect(this.lumpGain.gain);
      start(this.lumpLfo);
      head.connect(this.lumpGain);
      head = this.lumpGain;
    }
    this.filter = keep(ctx.createBiquadFilter());
    this.filter.type = 'lowpass';
    this.filter.frequency.value = recipe.filter.base;
    this.filter.Q.value = recipe.filter.q;
    this.toneLevel = keep(ctx.createGain());
    this.toneLevel.gain.value = 0;
    head.connect(this.filter).connect(this.toneLevel).connect(out);

    if (recipe.whine) {
      this.whineGain = keep(ctx.createGain());
      this.whineGain.gain.value = 0;
      const count = recipe.whine.twinCents !== undefined ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const osc = keep(ctx.createOscillator());
        setOscWave(res, osc, recipe.whine.w);
        osc.frequency.value = recipe.whine.fromHz;
        if (i === 1) osc.detune.value = recipe.whine.twinCents ?? 0;
        osc.connect(this.whineGain);
        start(osc);
        this.whines.push(osc);
      }
      this.whineGain.connect(out);
    }

    if (recipe.noise) {
      const src = keep(ctx.createBufferSource());
      src.buffer = res.noise(recipe.noise.w);
      src.loop = true;
      src.playbackRate.value = recipe.noise.rate;
      this.noiseBand = keep(ctx.createBiquadFilter());
      this.noiseBand.type =
        recipe.noise.band.t === 'lp'
          ? 'lowpass'
          : recipe.noise.band.t === 'hp'
            ? 'highpass'
            : 'bandpass';
      this.noiseBand.frequency.value = recipe.noise.band.fromHz;
      this.noiseBand.Q.value = recipe.noise.band.q;
      this.noiseGain = keep(ctx.createGain());
      this.noiseGain.gain.value = 0;
      let tail: AudioNode = src.connect(this.noiseBand);
      if (recipe.noise.gate || recipe.noise.gateHz) {
        // A gate that opens briefly once a cycle: a pulse wave swinging the gain 0 to 1.
        const gate = keep(ctx.createGain());
        gate.gain.value = 0.5;
        this.gateLfo = keep(ctx.createOscillator());
        this.gateLfo.setPeriodicWave(res.pulse(0.25));
        this.gateLfo.frequency.value =
          recipe.noise.gateHz ?? recipe.idleHz * (recipe.noise.gate ?? 1);
        const soft = keep(ctx.createBiquadFilter());
        soft.type = 'lowpass';
        soft.frequency.value = 400;
        const depth = keep(ctx.createGain());
        depth.gain.value = 0.5;
        this.gateLfo.connect(soft).connect(depth).connect(gate.gain);
        start(this.gateLfo);
        tail.connect(gate);
        tail = gate;
      }
      tail.connect(this.noiseGain).connect(out);
      start(src);
    }

    this.nodeCount = this.nodes.length;
    this.ledger.engine += this.nodeCount;
  }

  update(input: EngineInput, tau = 0.04): void {
    if (this.disposed) return;
    const recipe = this.recipe;
    const now = this.res.ctx.currentTime;
    const share = clamp(input.speedShare, 0, 1.3);
    const throttle = clamp(input.throttle, 0, 1);
    const rpm = engineSpeed(share, recipe.gears, this.gear);
    const n = clamp((rpm - 0.2) / 0.85, 0, 1);
    let firing = recipe.idleHz + (recipe.redHz - recipe.idleHz) * n;
    if (recipe.cycleWobble)
      firing *= 1 + recipe.cycleWobble * Math.sin((input.clock / 4) * Math.PI * 2);
    this.rpm = rpm;
    this.firingHz = firing;

    for (let i = 0; i < this.oscs.length; i++)
      this.oscs[i]!.frequency.setTargetAtTime(firing * recipe.oscs[i]!.mult, now, tau);
    this.filter.frequency.setTargetAtTime(
      recipe.filter.base + recipe.filter.rpm * n + recipe.filter.throttle * throttle,
      now,
      tau * 1.5,
    );
    if (recipe.lump && this.lumpLfo && this.lumpDepth && this.lumpGain) {
      const depth = recipe.lump.depth * (recipe.lump.fade ? 1 - n : 1 - 0.4 * n);
      this.lumpLfo.frequency.setTargetAtTime(firing * recipe.lump.mult, now, tau);
      this.lumpDepth.gain.setTargetAtTime(depth / 2, now, 0.1);
      this.lumpGain.gain.setTargetAtTime(1 - depth / 2, now, 0.1);
    }

    const on = input.active ? 1 : 0;
    // A hybrid runs on its motor until asked for power.
    const petrol =
      recipe.electricBelow !== undefined
        ? smooth(recipe.electricBelow - 0.15, recipe.electricBelow + 0.15, throttle)
        : 1;
    const tone = recipe.level.idle + recipe.level.throttle * throttle + recipe.level.rpm * n;
    this.toneLevel.gain.setTargetAtTime(tone * petrol * on, now, 0.06);

    if (recipe.whine && this.whineGain) {
      const w = recipe.whine;
      const drive =
        w.by === 'rpm'
          ? n
          : w.by === 'speed'
            ? clamp(share, 0, 1)
            : w.by === 'spool'
              ? clamp(input.spool, 0, 1)
              : n * (0.35 + 0.65 * throttle);
      // Exponential in pitch: a whine climbs by ratio, like the real thing.
      const hz = w.fromHz * Math.pow(w.toHz / w.fromHz, drive);
      for (const osc of this.whines) osc.frequency.setTargetAtTime(hz, now, tau * 2);
      const presence = w.by === 'rpm' ? 0.35 + 0.65 * drive : drive;
      const electric = recipe.electricBelow !== undefined ? 1 - 0.65 * petrol : 1;
      this.whineGain.gain.setTargetAtTime(w.gain * presence * electric * on, now, 0.08);
    }

    if (recipe.noise && this.noiseGain && this.noiseBand) {
      const g = recipe.noise.gain;
      this.noiseGain.gain.setTargetAtTime(
        (g.idle + g.throttle * throttle + g.rpm * n) * on,
        now,
        0.06,
      );
      const band = recipe.noise.band;
      this.noiseBand.frequency.setTargetAtTime(
        band.fromHz + (band.toHz - band.fromHz) * n,
        now,
        tau * 2,
      );
      if (this.gateLfo && recipe.noise.gate)
        this.gateLfo.frequency.setTargetAtTime(firing * recipe.noise.gate, now, tau);
    }

    const stutter = clamp(input.stutter, 0, 1) * 0.9;
    this.stutterDepth.gain.setTargetAtTime(stutter / 2, now, 0.02);
    this.stutterGain.gain.setTargetAtTime(1 - stutter / 2, now, 0.02);
    this.level.gain.setTargetAtTime(ENGINE_BASE * this.trim * input.gain, now, 0.06);
    this.panner?.pan.setTargetAtTime(input.pan, now, 0.06);

    if (this.onExtra && input.active) {
      if (recipe.blowoff) {
        if (throttle > 0.65 && input.spool > 0.5) this.highThrottleAt = now;
        else if (
          throttle < 0.25 &&
          now - this.highThrottleAt < 0.35 &&
          now - this.lastBlowoff > 0.8
        ) {
          this.lastBlowoff = now;
          this.highThrottleAt = -10;
          this.onExtra('turbo_blowoff', input.gain * (0.6 + 0.4 * clamp(input.spool, 0, 1)));
        }
      }
    }
  }

  /** The powertrain released a stored burst (spring launch, fuel pulse). */
  burst(gain: number): void {
    if (this.recipe.burst && !this.disposed) this.onExtra?.(this.recipe.burst, gain);
  }

  /** Fades out and frees every node. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const ctx = this.res.ctx;
    const now = ctx.currentTime;
    this.level.gain.cancelScheduledValues(now);
    this.level.gain.setTargetAtTime(0, now, 0.01);
    for (const source of this.sources) {
      try {
        source.stop(now + 0.08);
      } catch {
        // Already stopped.
      }
    }
    this.ledger.engine -= this.nodeCount;
    const nodes = this.nodes;
    const free = () => {
      for (const node of nodes) {
        try {
          node.disconnect();
        } catch {
          // Already disconnected.
        }
      }
      nodes.length = 0;
    };
    // The nodes are let go once the fade is over. Offline there is no timer worth waiting
    // for: the render ends first and the context is dropped whole.
    if (typeof window !== 'undefined' && !('startRendering' in ctx)) window.setTimeout(free, 150);
  }
}

// --- Tires ---------------------------------------------------------------------------------

type TireCharacter = { skidHz: number; skidQ: number; skid: number; rumble: number };

/** How each tire family (the catalog `soundKey`) colours the skid and the rumble. */
export const TIRE_CHARACTER: Readonly<Record<string, TireCharacter>> = {
  tires_road: { skidHz: 1, skidQ: 3.5, skid: 1, rumble: 1 },
  tires_offroad: { skidHz: 0.7, skidQ: 1.6, skid: 0.8, rumble: 1.3 },
  tires_studded: { skidHz: 1.5, skidQ: 5, skid: 0.9, rumble: 1.2 },
  tires_heavy: { skidHz: 0.6, skidQ: 2.6, skid: 0.9, rumble: 1.4 },
  tires_track: { skidHz: 0.5, skidQ: 1.2, skid: 0.6, rumble: 1.8 },
};

type SurfaceCharacter = {
  /** Skid pitch in hertz, its sharpness, and its level: a screech on asphalt, a hiss on sand. */
  skidHz: number;
  skidQ: number;
  skid: number;
  /** Rolling rumble level at speed, and its tone. */
  rumble: number;
  rumbleHz: number;
};

export const SURFACE_CHARACTER: Readonly<Record<SurfaceId, SurfaceCharacter>> = {
  asphalt: { skidHz: 1450, skidQ: 1, skid: 1, rumble: 0.05, rumbleHz: 160 },
  cobble: { skidHz: 1250, skidQ: 0.8, skid: 0.85, rumble: 0.8, rumbleHz: 210 },
  sand: { skidHz: 3200, skidQ: 0.25, skid: 0.6, rumble: 0.35, rumbleHz: 420 },
  dirt: { skidHz: 900, skidQ: 0.3, skid: 0.7, rumble: 0.6, rumbleHz: 180 },
  mud: { skidHz: 480, skidQ: 0.4, skid: 0.65, rumble: 0.45, rumbleHz: 120 },
  snow: { skidHz: 2400, skidQ: 0.3, skid: 0.5, rumble: 0.3, rumbleHz: 300 },
  ice: { skidHz: 3400, skidQ: 2.2, skid: 0.75, rumble: 0.1, rumbleHz: 500 },
  metal: { skidHz: 2000, skidQ: 2, skid: 1, rumble: 0.5, rumbleHz: 340 },
};

const TIRE_BASE = 0.3;

/** Skid and rolling rumble of the player's tires: two bands of one noise source. */
export class TireVoice {
  readonly nodeCount: number;
  private readonly nodes: AudioNode[] = [];
  private readonly src: AudioBufferSourceNode;
  private readonly skidBand: BiquadFilterNode;
  private readonly skidGain: GainNode;
  private readonly rumbleBand: BiquadFilterNode;
  private readonly rumbleGain: GainNode;
  private disposed = false;
  /** Levels of the last update, for the debug hook. */
  skid = 0;
  rumble = 0;

  constructor(
    private readonly res: SynthResources,
    dest: AudioNode,
    private readonly ledger: NodeLedger,
  ) {
    const ctx = res.ctx;
    const keep = <T extends AudioNode>(node: T): T => {
      this.nodes.push(node);
      return node;
    };
    this.src = keep(ctx.createBufferSource());
    this.src.buffer = res.white;
    this.src.loop = true;
    this.skidBand = keep(ctx.createBiquadFilter());
    this.skidBand.type = 'bandpass';
    this.skidBand.frequency.value = 1400;
    this.skidGain = keep(ctx.createGain());
    this.skidGain.gain.value = 0;
    this.rumbleBand = keep(ctx.createBiquadFilter());
    this.rumbleBand.type = 'lowpass';
    this.rumbleBand.frequency.value = 200;
    this.rumbleGain = keep(ctx.createGain());
    this.rumbleGain.gain.value = 0;
    this.src.connect(this.skidBand).connect(this.skidGain).connect(dest);
    this.src.connect(this.rumbleBand).connect(this.rumbleGain).connect(dest);
    this.src.start();
    this.nodeCount = this.nodes.length;
    this.ledger.engine += this.nodeCount;
  }

  /** `slip` 0 gripping to 1 sliding; `speed` in world pixels a second. */
  update(
    slip: number,
    speed: number,
    surface: SurfaceId,
    tireKey: string,
    wet: boolean,
    active: boolean,
  ): void {
    if (this.disposed) return;
    const now = this.res.ctx.currentTime;
    const ground = SURFACE_CHARACTER[surface];
    const tire = TIRE_CHARACTER[tireKey] ?? TIRE_CHARACTER.tires_road!;
    const moving = clamp(speed / 120, 0, 1);
    const scrub = active ? clamp((slip - 0.3) / 0.6, 0, 1) * moving : 0;
    // Wet roads take the edge off a screech and turn it toward a hiss.
    const skid = scrub * ground.skid * tire.skid * (wet ? 0.7 : 1);
    this.skid = skid;
    this.skidGain.gain.setTargetAtTime(skid * TIRE_BASE, now, 0.05);
    this.skidBand.frequency.setTargetAtTime(
      ground.skidHz * tire.skidHz * (wet ? 1.5 : 1) * (0.8 + 0.5 * scrub),
      now,
      0.1,
    );
    this.skidBand.Q.setTargetAtTime(ground.skidQ * tire.skidQ * (wet ? 0.5 : 1), now, 0.1);
    const roll = active ? clamp(speed / 320, 0, 1) * ground.rumble * tire.rumble : 0;
    this.rumble = roll;
    this.rumbleGain.gain.setTargetAtTime(roll * TIRE_BASE * 1.6, now, 0.08);
    this.rumbleBand.frequency.setTargetAtTime(ground.rumbleHz * (0.6 + 0.6 * moving), now, 0.1);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const ctx = this.res.ctx;
    const now = ctx.currentTime;
    this.skidGain.gain.setTargetAtTime(0, now, 0.01);
    this.rumbleGain.gain.setTargetAtTime(0, now, 0.01);
    try {
      this.src.stop(now + 0.08);
    } catch {
      // Already stopped.
    }
    this.ledger.engine -= this.nodeCount;
    const nodes = this.nodes;
    const free = () => {
      for (const node of nodes) {
        try {
          node.disconnect();
        } catch {
          // Already disconnected.
        }
      }
      nodes.length = 0;
    };
    if (typeof window !== 'undefined' && !('startRendering' in ctx)) window.setTimeout(free, 150);
  }
}
