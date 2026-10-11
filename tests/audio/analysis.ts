import { PixelBuffer, encodePng } from '../../art/scripts/lib/pixels.js';

/**
 * Measurements on rendered audio. Nobody can listen in this environment, so the render tests
 * prove what they can with numbers: level, clipping, DC, clicks at the edges, silence after
 * the end, length, and a spectral fingerprint that tells one sound from another.
 */

export const dB = (linear: number) => 20 * Math.log10(Math.max(linear, 1e-12));

export function decodeFloat32(base64: string): Float32Array {
  const bytes = Buffer.from(base64, 'base64');
  return new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4)).slice();
}

/** Sum of channels, halved: what a mono speaker would get. */
export function mono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]!;
  const out = new Float32Array(channels[0]!.length);
  for (const channel of channels)
    for (let i = 0; i < out.length; i++) out[i]! += channel[i]! / channels.length;
  return out;
}

export function peak(x: Float32Array, from = 0, to = x.length): number {
  let p = 0;
  for (let i = from; i < to; i++) {
    const a = Math.abs(x[i]!);
    if (a > p) p = a;
  }
  return p;
}

export function rms(x: Float32Array, from = 0, to = x.length): number {
  let sum = 0;
  const n = Math.max(1, to - from);
  for (let i = from; i < to; i++) sum += x[i]! * x[i]!;
  return Math.sqrt(sum / n);
}

export function dcOffset(x: Float32Array, from = 0, to = x.length): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += x[i]!;
  return sum / Math.max(1, to - from);
}

/** The loudest RMS over any window of `seconds`, stepping a quarter window: short-term loudness. */
export function loudestWindow(x: Float32Array, rate: number, seconds = 0.1): number {
  const size = Math.max(1, Math.round(seconds * rate));
  if (x.length <= size) return rms(x);
  const hop = Math.max(1, Math.floor(size / 4));
  let best = 0;
  for (let start = 0; start + size <= x.length; start += hop) {
    const r = rms(x, start, start + size);
    if (r > best) best = r;
  }
  return best;
}

/** First and last sample above `floor`, or -1 when the signal never rises above it. */
export function activeSpan(x: Float32Array, floor = 1e-4): { first: number; last: number } {
  let first = -1;
  let last = -1;
  for (let i = 0; i < x.length; i++)
    if (Math.abs(x[i]!) > floor) {
      if (first < 0) first = i;
      last = i;
    }
  return { first, last };
}

/**
 * Clicks at the edges. A voice that starts or stops without a ramp begins or ends on a large
 * sample; one with a ramp creeps in. Returns the largest sample within `ms` of the first and
 * of the last audible sample, as a share of the peak: near 0 is a clean ramp, near 1 a click.
 */
export function edgeLevels(x: Float32Array, rate: number, ms = 0.35): { on: number; off: number } {
  const { first, last } = activeSpan(x);
  const p = peak(x);
  if (first < 0 || p === 0) return { on: 0, off: 0 };
  const n = Math.max(2, Math.round((ms / 1000) * rate));
  return {
    on: peak(x, first, Math.min(x.length, first + n)) / p,
    off: peak(x, Math.max(0, last - n), last + 1) / p,
  };
}

/** The largest jump between neighbouring samples, as a share of the peak. */
export function largestStep(x: Float32Array): number {
  let step = 0;
  for (let i = 1; i < x.length; i++) {
    const d = Math.abs(x[i]! - x[i - 1]!);
    if (d > step) step = d;
  }
  const p = peak(x);
  return p > 0 ? step / p : 0;
}

// --- Spectrum ------------------------------------------------------------------------------

/** In-place radix-2 FFT. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b]! * cr - im[b]! * ci;
        const ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a]! += tr;
        im[a]! += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

export type Spectrogram = { frames: Float32Array[]; size: number; hop: number; rate: number };

/** Magnitude spectrogram, Hann window. */
export function stft(x: Float32Array, rate: number, size = 1024, hop = 256): Spectrogram {
  const window = new Float64Array(size);
  for (let i = 0; i < size; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  const frames: Float32Array[] = [];
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let start = 0; start + size <= x.length; start += hop) {
    for (let i = 0; i < size; i++) {
      re[i] = x[start + i]! * window[i]!;
      im[i] = 0;
    }
    fft(re, im);
    const mag = new Float32Array(size / 2);
    for (let i = 0; i < size / 2; i++) mag[i] = Math.hypot(re[i]!, im[i]!) / (size / 4);
    frames.push(mag);
  }
  return { frames, size, hop, rate };
}

/**
 * What tells two sounds apart at a glance, as numbers:
 * - `centroid` and `spread`: where the energy sits and how wide, in octaves above 20 Hz;
 * - `flatness`: 0 a pure tone, 1 noise;
 * - `seconds`: how long it is audible (above -40 dB of its own peak);
 * - `envelope`: its loudness shape in eight equal slices of that time, each 0 to 1;
 * - `pitch`: the strongest frequency in each quarter of that time, in octaves above 20 Hz;
 * - `attack`: the share of the audible time it takes to reach its loudest slice;
 * - `modDepth`, `modHz`: the strongest wobble of loudness between 4 and 90 Hz, which is what
 *   separates a burble from a howl and a stutter from a hiss.
 */
export type Fingerprint = {
  centroid: number;
  spread: number;
  flatness: number;
  seconds: number;
  envelope: number[];
  pitch: number[];
  attack: number;
  /** Roughness: how deep the loudness wobbles (0 steady, 1 chopped) and how fast, in hertz. */
  modDepth: number;
  modHz: number;
};

const oct = (hz: number) => Math.log2(Math.max(hz, 20) / 20);

export function fingerprint(x: Float32Array, rate: number): Fingerprint {
  const p = peak(x);
  const { first, last } = activeSpan(x, Math.max(1e-5, p * 0.01));
  if (first < 0 || last - first < 64)
    return {
      centroid: 0,
      spread: 0,
      flatness: 0,
      seconds: 0,
      envelope: new Array<number>(8).fill(0),
      pitch: [0, 0, 0, 0],
      attack: 0,
      modDepth: 0,
      modHz: 0,
    };
  const active = x.subarray(first, last + 1);
  const seconds = active.length / rate;
  const size = active.length >= 4096 ? 2048 : active.length >= 1024 ? 1024 : 256;
  const padded = active.length < size * 2 ? pad(active, size * 2) : active;
  const spec = stft(padded, rate, size, size / 4);
  const binHz = rate / size;

  // Whole-sound power spectrum.
  const power = new Float64Array(size / 2);
  for (const frame of spec.frames)
    for (let i = 1; i < frame.length; i++) power[i]! += frame[i]! * frame[i]!;
  let total = 0;
  let centroid = 0;
  let logSum = 0;
  let bins = 0;
  for (let i = 1; i < power.length; i++) {
    const hz = i * binHz;
    if (hz < 30 || hz > 16000) continue;
    total += power[i]!;
    centroid += power[i]! * oct(hz);
    logSum += Math.log(power[i]! + 1e-20);
    bins++;
  }
  centroid /= Math.max(total, 1e-20);
  let spread = 0;
  for (let i = 1; i < power.length; i++) {
    const hz = i * binHz;
    if (hz < 30 || hz > 16000) continue;
    spread += power[i]! * (oct(hz) - centroid) ** 2;
  }
  spread = Math.sqrt(spread / Math.max(total, 1e-20));
  const flatness =
    Math.exp(logSum / Math.max(bins, 1)) / Math.max(total / Math.max(bins, 1), 1e-20);

  const envelope: number[] = [];
  let loudest = 0;
  for (let s = 0; s < 8; s++) {
    const a = Math.floor((s * active.length) / 8);
    const b = Math.floor(((s + 1) * active.length) / 8);
    const r = rms(active, a, Math.max(b, a + 1));
    envelope.push(r);
    if (r > loudest) loudest = r;
  }
  const attack = envelope.indexOf(loudest) / 7;
  for (let s = 0; s < 8; s++) envelope[s] = loudest > 0 ? envelope[s]! / loudest : 0;

  const pitch: number[] = [];
  for (let q = 0; q < 4; q++) {
    const a = Math.floor((q * spec.frames.length) / 4);
    const b = Math.max(a + 1, Math.floor(((q + 1) * spec.frames.length) / 4));
    let bestBin = 1;
    let bestPower = 0;
    for (let i = 2; i < size / 2; i++) {
      let sum = 0;
      for (let f = a; f < b && f < spec.frames.length; f++) sum += spec.frames[f]![i]! ** 2;
      if (sum > bestPower) {
        bestPower = sum;
        bestBin = i;
      }
    }
    pitch.push(oct(bestBin * binHz));
  }
  const { depth: modDepth, hz: modHz } = modulation(active, rate);
  return { centroid, spread, flatness, seconds, envelope, pitch, attack, modDepth, modHz };
}

/** The strongest periodic wobble of the loudness envelope between 4 and 90 Hz. */
export function modulation(x: Float32Array, rate: number): { depth: number; hz: number } {
  const hop = Math.max(1, Math.round(rate / 400));
  const count = Math.floor(x.length / hop);
  if (count < 32) return { depth: 0, hz: 0 };
  let size = 64;
  while (size < count && size < 4096) size <<= 1;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  let mean = 0;
  const used = Math.min(count, size);
  for (let i = 0; i < used; i++) {
    re[i] = rms(x, i * hop, (i + 1) * hop);
    mean += re[i]!;
  }
  mean /= used;
  if (mean < 1e-6) return { depth: 0, hz: 0 };
  for (let i = 0; i < used; i++)
    re[i] = (re[i]! - mean) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / used));
  fft(re, im);
  const binHz = rate / hop / size;
  let best = 0;
  let bestHz = 0;
  for (let i = 1; i < size / 2; i++) {
    const hz = i * binHz;
    if (hz < 4 || hz > 90) continue;
    const mag = Math.hypot(re[i]!, im[i]!) / (used / 4);
    if (mag > best) {
      best = mag;
      bestHz = hz;
    }
  }
  return { depth: Math.min(1, best / mean), hz: bestHz };
}

function pad(x: Float32Array, length: number): Float32Array {
  const out = new Float32Array(length);
  out.set(x);
  return out;
}

/**
 * Distance between two fingerprints. Each term is scaled so that 1 is "plainly different on
 * that axis alone": an octave of brightness, an octave of width, a doubling of length, a
 * third of the envelope, two octaves of dominant pitch, noise against tone, a steady sound
 * against one that wobbles by a third, or an octave between two wobbles.
 */
export function fingerprintDistance(a: Fingerprint, b: Fingerprint): number {
  let env = 0;
  for (let i = 0; i < 8; i++) env += (a.envelope[i]! - b.envelope[i]!) ** 2;
  env = Math.sqrt(env / 8) / 0.33;
  let pitch = 0;
  for (let i = 0; i < 4; i++) pitch += Math.abs(a.pitch[i]! - b.pitch[i]!);
  pitch = pitch / 4 / 2;
  const centroid = Math.abs(a.centroid - b.centroid);
  const spread = Math.abs(a.spread - b.spread);
  const length = Math.abs(Math.log2(Math.max(a.seconds, 0.01) / Math.max(b.seconds, 0.01)));
  const flat = Math.abs(Math.sqrt(a.flatness) - Math.sqrt(b.flatness)) / 0.25;
  const attack = Math.abs(a.attack - b.attack) / 0.5;
  // Roughness: a difference in depth always counts; a difference in rate only where both wobble.
  const both = Math.min(a.modDepth, b.modDepth);
  const rough =
    Math.abs(a.modDepth - b.modDepth) / 0.3 +
    (both > 0.12 ? Math.abs(Math.log2(Math.max(a.modHz, 1) / Math.max(b.modHz, 1))) : 0);
  return Math.sqrt(
    centroid ** 2 +
      spread ** 2 +
      length ** 2 +
      env ** 2 +
      pitch ** 2 +
      flat ** 2 +
      attack ** 2 +
      rough ** 2,
  );
}

// --- Files ---------------------------------------------------------------------------------

/** 16-bit PCM WAV. */
export function encodeWav(channels: Float32Array[], rate: number): Buffer {
  const frames = channels[0]!.length;
  const count = channels.length;
  const out = Buffer.alloc(44 + frames * count * 2);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + frames * count * 2, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(count, 22);
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * count * 2, 28);
  out.writeUInt16LE(count * 2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(frames * count * 2, 40);
  let at = 44;
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < count; c++) {
      const v = Math.max(-1, Math.min(1, channels[c]![i]!));
      out.writeInt16LE(Math.round(v * 32767), at);
      at += 2;
    }
  return out;
}

const HEAT: Array<[number, number, number]> = [
  [8, 10, 24],
  [40, 30, 110],
  [150, 40, 120],
  [235, 100, 50],
  [255, 210, 80],
  [255, 255, 235],
];

/**
 * A spectrogram as a PNG: time left to right, frequency bottom to top on a log scale from
 * 40 Hz to 16 kHz, level as heat over a 70 dB range. A strip under it shows the waveform
 * envelope. Tick marks on the left edge are at 100 Hz, 1 kHz and 10 kHz.
 */
export function spectrogramPng(x: Float32Array, rate: number, width = 640, height = 256): Buffer {
  const size = 1024;
  const padded = x.length < size * 2 ? pad(x, size * 2) : x;
  const hop = Math.max(32, Math.floor((padded.length - size) / width));
  const spec = stft(padded, rate, size, hop);
  const strip = 40;
  const buf = new PixelBuffer(width, height + strip);
  const lo = Math.log2(40);
  const hi = Math.log2(16000);
  const binHz = rate / size;
  let top = 1e-9;
  for (const frame of spec.frames) for (const v of frame) if (v > top) top = v;
  for (let px = 0; px < width; px++) {
    const frame =
      spec.frames[Math.min(spec.frames.length - 1, Math.floor((px * spec.frames.length) / width))]!;
    for (let py = 0; py < height; py++) {
      const hz = 2 ** (lo + ((height - 1 - py) / (height - 1)) * (hi - lo));
      const bin = Math.min(frame.length - 1, Math.max(1, Math.round(hz / binHz)));
      const level = Math.max(0, Math.min(1, (dB(frame[bin]! / top) + 70) / 70));
      const scaled = level * (HEAT.length - 1);
      const i = Math.min(HEAT.length - 2, Math.floor(scaled));
      const t = scaled - i;
      const a = HEAT[i]!;
      const b = HEAT[i + 1]!;
      buf.set(px, py, [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
        255,
      ]);
    }
    // Waveform peak for this column.
    const from = Math.floor((px * x.length) / width);
    const to = Math.max(from + 1, Math.floor(((px + 1) * x.length) / width));
    const p = Math.min(1, peak(x, from, Math.min(to, x.length)));
    const half = Math.round((p * (strip - 4)) / 2);
    for (let py = 0; py < strip; py++) {
      const mid = strip / 2;
      const on = Math.abs(py - mid) <= half;
      buf.set(px, height + py, on ? [120, 230, 255, 255] : [8, 10, 24, 255]);
    }
  }
  for (const hz of [100, 1000, 10000]) {
    const py = Math.round((height - 1) * (1 - (Math.log2(hz) - lo) / (hi - lo)));
    for (let px = 0; px < 6; px++) buf.set(px, py, [255, 255, 255, 255]);
  }
  return encodePng(buf);
}

/**
 * Share of a sound's energy between two frequencies, in dB relative to all of it. A phone
 * speaker gives almost nothing below about 300 Hz, so a sound whose energy is all down there
 * is a sound most players will not hear: `bandShare(x, rate, 300, 8000)` near 0 dB is safe,
 * -10 dB means nine tenths of the energy is lost on a small speaker.
 */
export function bandShare(x: Float32Array, rate: number, loHz: number, hiHz: number): number {
  const size = 2048;
  const padded = x.length < size * 2 ? pad(x, size * 2) : x;
  const spec = stft(padded, rate, size, size / 2);
  const binHz = rate / size;
  let inBand = 0;
  let total = 0;
  for (const frame of spec.frames)
    for (let i = 1; i < frame.length; i++) {
      const p = frame[i]! * frame[i]!;
      total += p;
      const hz = i * binHz;
      if (hz >= loHz && hz <= hiHz) inBand += p;
    }
  return 10 * Math.log10(Math.max(inBand, 1e-30) / Math.max(total, 1e-30));
}

/** Reads back a 16-bit PCM WAV written by `encodeWav`. */
export function decodeWav(bytes: Buffer): { rate: number; channels: Float32Array[] } {
  const count = bytes.readUInt16LE(22);
  const rate = bytes.readUInt32LE(24);
  const frames = bytes.readUInt32LE(40) / (count * 2);
  const channels = Array.from({ length: count }, () => new Float32Array(frames));
  let at = 44;
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < count; c++) {
      channels[c]![i] = bytes.readInt16LE(at) / 32767;
      at += 2;
    }
  return { rate, channels };
}
