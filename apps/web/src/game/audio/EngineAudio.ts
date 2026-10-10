import { clamp } from '@bolt/shared';

/**
 * Procedural driving audio for Milestone A: an inline-four engine voice tied to a simple gear
 * model, tire scrub on slip, and a body thump on wall strikes. Everything is synthesized, so
 * there are no audio files to license or download. The context is only created after a user
 * gesture, and a browser that refuses audio simply plays silently (Section 14.3).
 */
export class EngineAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private oscA: OscillatorNode | null = null;
  private oscB: OscillatorNode | null = null;
  private sub: OscillatorNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private scrubGain: GainNode | null = null;
  private scrubFilter: BiquadFilterNode | null = null;
  private noise: AudioBuffer | null = null;
  private engineVolume = 0.7;
  private effectsVolume = 0.8;
  private muted = false;
  private gear = 1;

  /** Call from a pointer or key handler. Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
      return;
    }
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      this.ctx = ctx;

      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : 1;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -14;
      limiter.ratio.value = 8;
      master.connect(limiter).connect(ctx.destination);
      this.master = master;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 600;
      filter.Q.value = 2.2;
      const engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      filter.connect(engineGain).connect(master);
      this.filter = filter;
      this.engineGain = engineGain;

      // Two slightly detuned pulse-like voices plus a sub: a small, raspy four-cylinder.
      const oscA = ctx.createOscillator();
      oscA.type = 'sawtooth';
      const oscB = ctx.createOscillator();
      oscB.type = 'square';
      const sub = ctx.createOscillator();
      sub.type = 'triangle';
      const gA = ctx.createGain();
      gA.gain.value = 0.5;
      const gB = ctx.createGain();
      gB.gain.value = 0.22;
      const gS = ctx.createGain();
      gS.gain.value = 0.55;
      oscA.connect(gA).connect(filter);
      oscB.connect(gB).connect(filter);
      sub.connect(gS).connect(filter);
      oscA.start();
      oscB.start();
      sub.start();
      this.oscA = oscA;
      this.oscB = oscB;
      this.sub = sub;

      const length = ctx.sampleRate;
      const noise = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = noise.getChannelData(0);
      let seed = 22222;
      for (let i = 0; i < length; i++) {
        seed = (seed * 16807) % 2147483647;
        data[i] = (seed / 2147483647) * 2 - 1;
      }
      this.noise = noise;
      const scrub = ctx.createBufferSource();
      scrub.buffer = noise;
      scrub.loop = true;
      const scrubFilter = ctx.createBiquadFilter();
      scrubFilter.type = 'bandpass';
      scrubFilter.frequency.value = 1500;
      scrubFilter.Q.value = 3.5;
      const scrubGain = ctx.createGain();
      scrubGain.gain.value = 0;
      scrub.connect(scrubFilter).connect(scrubGain).connect(master);
      scrub.start();
      this.scrubGain = scrubGain;
      this.scrubFilter = scrubFilter;
    } catch {
      this.ctx = null;
    }
  }

  setVolumes(engine: number, effects: number, muted: boolean): void {
    this.engineVolume = engine;
    this.effectsVolume = effects;
    this.muted = muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.03);
  }

  /** Per-frame update from the predicted car. Speeds are world pixels per second. */
  update(forwardSpeed: number, throttle: number, slipRatio: number, topSpeed: number, active: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.oscA || !this.oscB || !this.sub || !this.filter || !this.engineGain) return;
    const t = ctx.currentTime;
    const v = Math.abs(forwardSpeed);
    // Four gears with hysteresis; RPM falls on each upshift, which is what sells acceleration.
    const bounds = [0, 0.24, 0.46, 0.7, 1.2];
    const frac = v / topSpeed;
    if (this.gear < 4 && frac > bounds[this.gear]! + 0.02) this.gear++;
    else if (this.gear > 1 && frac < bounds[this.gear - 1]! - 0.05) this.gear--;
    const lo = bounds[this.gear - 1]!;
    const hi = bounds[this.gear]!;
    const rpm = clamp(0.28 + 0.72 * ((frac - lo) / (hi - lo)), 0.2, 1.05);
    const freq = 46 + rpm * 118;
    this.oscA.frequency.setTargetAtTime(freq, t, 0.03);
    this.oscB.frequency.setTargetAtTime(freq * 2.01, t, 0.03);
    this.sub.frequency.setTargetAtTime(freq * 0.5, t, 0.03);
    this.filter.frequency.setTargetAtTime(380 + rpm * 1500 + throttle * 700, t, 0.05);
    const level = active ? (0.05 + throttle * 0.07 + rpm * 0.04) * this.engineVolume : 0;
    this.engineGain.gain.setTargetAtTime(level, t, 0.06);

    if (this.scrubGain && this.scrubFilter) {
      const scrub = active ? clamp((slipRatio - 0.3) / 0.6, 0, 1) * clamp(v / 120, 0, 1) : 0;
      this.scrubGain.gain.setTargetAtTime(scrub * 0.16 * this.effectsVolume, t, 0.05);
      this.scrubFilter.frequency.setTargetAtTime(1100 + scrub * 900, t, 0.1);
    }
  }

  /** Short filtered noise burst: body hitting a wall. `strength` is 0 to 1. */
  thump(strength: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900 + strength * 1400, t);
    filter.frequency.exponentialRampToValueAtTime(120, t + 0.18);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime((0.25 + strength * 0.45) * this.effectsVolume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t, Math.random() * 0.5, 0.25);
  }

  /** Countdown and GO beeps. */
  beep(high: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = high ? 880 : 440;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.12 * this.effectsVolume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + (high ? 0.5 : 0.16));
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.55);
  }

  dispose(): void {
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}
