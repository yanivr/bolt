import {
  SCENARIOS,
  createScenarioRace,
  environmentFor,
  getScenario,
  getTrack,
} from '@bolt/content';
import type {
  RaceSnapshot,
  ScenarioDefinition,
  TrackRuntime,
  VehicleBlueprint,
} from '@bolt/shared';
import { buildTrack, eventVisibleTo, raceSnapshot, stepRaceWithBrains } from '@bolt/shared';
import type { AudioLevels, RaceAudioContext, UiSoundKind } from './AudioSystem.js';
import { AudioSystem } from './AudioSystem.js';
import { ENGINE_RECIPES, engineRecipe } from './engineRecipes.js';
import type { EngineInput } from './engineVoice.js';
import { EngineVoice } from './engineVoice.js';
import { Mixer } from './mixer.js';
import type { VoiceLogEntry } from './mixer.js';
import type { MusicIntensity } from './music.js';
import { MusicPlayer } from './music.js';
import { recipeDuration } from './recipe.js';
import { SFX, SFX_LIST } from './sfxRecipes.js';
import type { Cue } from './soundMap.js';

/**
 * Offline renders, for measuring what cannot be listened to here. Loaded only through
 * `window.__boltAudio.harness()` with `?debug=1`. Every function builds the SAME mixer, voices
 * and audio system the game uses, on an `OfflineAudioContext`, and returns PCM. The offline
 * clock is stopped at each simulation tick (`suspend`), the tick's snapshot and events are fed
 * in exactly as `raceFeed` would, and rendering resumes: the system cannot tell it is not live.
 */

export const RENDER_RATE = 44100;

export type Rendered = {
  sampleRate: number;
  seconds: number;
  /** One base64 string of little-endian float32 per channel. */
  channels: string[];
  log: VoiceLogEntry[];
  peakVoices: number;
  peakMusic: number;
  /** Live node counts at the end of the render, after the reset. */
  nodesEnd: { fixed: number; engine: number; voices: number; music: number };
  nodesFixed: number;
  /** Designed length, for one-shots. */
  designed?: number;
};

const FULL: AudioLevels = {
  engine: 1,
  effects: 1,
  ui: 1,
  music: 1,
  muted: false,
  musicEnabled: true,
  reducedIntensity: false,
};

function encode(data: Float32Array): string {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK)
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

function offline(seconds: number, channels: number): OfflineAudioContext {
  return new OfflineAudioContext(channels, Math.ceil(seconds * RENDER_RATE), RENDER_RATE);
}

/** Renders, calling `onStep(i)` with the clock stopped at `i * dt` for every step. */
async function renderStepped(
  ctx: OfflineAudioContext,
  seconds: number,
  dt: number,
  onStep: (index: number, time: number) => void,
): Promise<AudioBuffer> {
  const steps = Math.floor((seconds - 0.01) / dt);
  for (let i = 1; i <= steps; i++) {
    void ctx.suspend(i * dt).then(() => {
      onStep(i, i * dt);
      return ctx.resume();
    });
  }
  onStep(0, 0);
  return ctx.startRendering();
}

function pack(
  buffer: AudioBuffer,
  mixer: Mixer,
  log: VoiceLogEntry[],
  designed?: number,
): Rendered {
  const channels: string[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(encode(buffer.getChannelData(c)));
  const ledger = mixer.ledger;
  const out: Rendered = {
    sampleRate: buffer.sampleRate,
    seconds: buffer.duration,
    channels,
    log,
    peakVoices: mixer.peakVoices,
    peakMusic: mixer.peakMusic,
    nodesEnd: {
      fixed: ledger.fixed,
      engine: ledger.engine,
      voices: ledger.voices,
      music: ledger.music,
    },
    nodesFixed: ledger.fixed,
  };
  if (designed !== undefined) out.designed = designed;
  return out;
}

function logOf(mixer: Mixer): VoiceLogEntry[] {
  const log: VoiceLogEntry[] = [];
  mixer.onLog = (entry) => log.push(entry);
  return log;
}

// --- One recipe --------------------------------------------------------------------------------

export type RecipeRender = {
  /** Bare: no master chain and no calibrated trim. What the calibration measures. */
  raw?: boolean;
  /** Replaces the calibrated trim, through the master chain. Only the calibration passes this. */
  trim?: number;
  pitch?: number;
  stretch?: number;
  /** Seconds a loop is held before it is stopped. */
  hold?: number;
};

export function recipeIds(): string[] {
  return SFX_LIST.map((recipe) => recipe.id);
}

export function recipeInfo(): Array<{
  id: string;
  cat: string;
  bus: string;
  loop: boolean;
  seconds: number;
  note: string;
}> {
  return SFX_LIST.map((recipe) => ({
    id: recipe.id,
    cat: recipe.cat,
    bus: recipe.bus,
    loop: recipe.loop === true,
    seconds: recipeDuration(recipe),
    note: recipe.note,
  }));
}

/** One recipe alone, at the player's own car with every slider at full. Mono. */
export async function renderRecipe(id: string, options: RecipeRender = {}): Promise<Rendered> {
  const recipe = SFX[id];
  if (!recipe) throw new Error(`no recipe ${id}`);
  const stretch = options.stretch ?? 1;
  const designed = recipe.loop ? (options.hold ?? 1.2) : recipeDuration(recipe, stretch);
  const seconds = designed + (recipe.loop ? (recipe.release ?? 0.05) * 3 : 0) + 0.5;
  const ctx = offline(seconds, 1);
  const mixer = new Mixer(ctx, !options.raw);
  const log = logOf(mixer);
  const play: Parameters<Mixer['playRecipe']>[1] = { when: 0, stretch };
  if (options.raw || options.trim !== undefined) {
    play.absolute = true;
    play.gain = options.trim ?? 1;
  }
  if (options.pitch !== undefined) play.pitch = options.pitch;
  const voice = mixer.playRecipe(recipe, play);
  let buffer: AudioBuffer;
  if (recipe.loop && voice) {
    buffer = await renderStepped(ctx, seconds, designed, (index) => {
      if (index === 1) mixer.stop(voice);
    });
  } else buffer = await ctx.startRendering();
  mixer.sweep(seconds);
  return pack(buffer, mixer, log, designed);
}

// --- One engine --------------------------------------------------------------------------------

export function engineKeys(): string[] {
  return ENGINE_RECIPES.map((recipe) => recipe.key);
}

/** Phases of the engine run, in seconds, for the measurements. */
export const ENGINE_RUN = {
  idleEnd: 0.8,
  pullEnd: 4.5,
  holdEnd: 5.5,
  liftEnd: 6.6,
  total: 7.2,
} as const;

/**
 * Seven seconds of one engine: idle, a pull through the gears at full throttle, a second held
 * at speed, a lift, and off. Mono. `raw` leaves out the master chain and the calibrated trim;
 * `trim` replaces the calibrated trim (the calibration uses both).
 */
export async function renderEngine(
  key: string,
  options: { raw?: boolean; trim?: number } = {},
): Promise<Rendered> {
  const recipe = engineRecipe(key);
  if (!recipe) throw new Error(`no engine ${key}`);
  const ctx = offline(ENGINE_RUN.total, 1);
  const mixer = new Mixer(ctx, !options.raw);
  const log = logOf(mixer);
  const voice = new EngineVoice(
    mixer.res,
    recipe,
    mixer.input('engine'),
    mixer.ledger,
    (extra, gain) => void mixer.play(extra, { gain }),
    options.raw ? 1 : options.trim,
  );
  const input: EngineInput = {
    speedShare: 0,
    throttle: 0,
    spool: 0,
    clock: 0,
    active: true,
    stutter: 0,
    gain: 1,
    pan: 0,
  };
  let spool = 0;
  const dt = 1 / 60;
  const buffer = await renderStepped(ctx, ENGINE_RUN.total, dt, (_index, t) => {
    if (t < ENGINE_RUN.idleEnd) {
      input.throttle = 0;
      input.speedShare = 0;
    } else if (t < ENGINE_RUN.holdEnd) {
      input.throttle = 1;
      input.speedShare = 0.96 * (1 - Math.exp(-(t - ENGINE_RUN.idleEnd) / 1.3));
    } else if (t < ENGINE_RUN.liftEnd) {
      input.throttle = 0;
      input.speedShare *= Math.exp(-dt / 1.6);
    } else input.active = false;
    spool += (input.throttle - spool) * (1 - Math.exp(-dt / 0.5));
    input.spool = spool;
    input.clock = t % 4;
    if (t >= 1.2 && t - dt < 1.2) voice.burst(1);
    voice.update(input, 0.035);
  });
  voice.dispose();
  mixer.sweep(ENGINE_RUN.total);
  return pack(buffer, mixer, log);
}

// --- A scenario --------------------------------------------------------------------------------

const tracks = new Map<string, TrackRuntime>();
function trackFor(id: string): TrackRuntime {
  let track = tracks.get(id);
  if (!track) {
    const def = getTrack(id);
    if (!def) throw new Error(`no track ${id}`);
    track = buildTrack(def);
    tracks.set(id, track);
  }
  return track;
}

function contextFor(
  def: ScenarioDefinition,
  blueprint: VehicleBlueprint,
  track: TrackRuntime,
): RaceAudioContext {
  return {
    engineId: blueprint.engineId,
    tireKitId: blueprint.tireKitId,
    chassisId: blueprint.chassisId,
    parts: blueprint.parts.map((part) => part.partId),
    track,
    laps: track.def.laps,
    wet: (environmentFor(def.weatherPresetId)?.wetness ?? 0) > 0.3,
    themeId: def.trackId,
  };
}

export function scenarioIds(): string[] {
  return SCENARIOS.map((scenario) => scenario.id);
}

export type ScenarioRender = {
  /** Whose ears: car 0 (the scripted player) or car 1. */
  viewer?: number;
  music?: boolean;
  /** Seconds rendered after the reset, to prove everything stops. */
  tail?: number;
  levels?: Partial<AudioLevels>;
};

/**
 * A showcase scenario, simulated in the page tick by tick, heard through the whole audio
 * system. Stereo. The countdown beeps are given as the scene gives them. At the end of the
 * scenario the feed is reset, as on leaving the race, and the tail shows what is left.
 */
export async function renderScenario(
  id: string,
  options: ScenarioRender = {},
): Promise<Rendered & { resetAt: number }> {
  const def = getScenario(id);
  if (!def) throw new Error(`no scenario ${id}`);
  const track = trackFor(def.trackId);
  const setup = createScenarioRace(def, track);
  if (!setup) throw new Error(`scenario ${id} does not resolve`);
  const viewer = options.viewer ?? 0;
  const { race, brains } = setup;
  const ticks = def.countdownTicks + def.durationTicks;
  const resetAt = ticks / 30;
  const seconds = resetAt + (options.tail ?? 1.5);
  const ctx = offline(seconds, 2);
  const system = new AudioSystem(ctx);
  const log = logOf(system.mixer);
  system.applyLevels({ ...FULL, musicEnabled: options.music === true, ...options.levels });
  const blueprint = def.cars[viewer]?.blueprint ?? def.cars[0]!.blueprint;
  system.setContext(contextFor(def, blueprint, track));

  let lastCount = -1;
  let wasCountdown = true;
  let done = false;
  const feed = (snapshot: RaceSnapshot) => {
    system.onRace(snapshot);
    const session = race.cars[viewer]!.session;
    const count = session.phase === 'COUNTDOWN' ? Math.ceil(session.countdownTicks / 30) : 0;
    if (session.phase === 'COUNTDOWN' && count !== lastCount && count > 0 && lastCount !== -1)
      system.beep(false);
    if (session.phase === 'RACING' && wasCountdown) system.beep(true);
    lastCount = count;
    wasCountdown = session.phase === 'COUNTDOWN';
  };
  const buffer = await renderStepped(ctx, seconds, 1 / 30, (index) => {
    if (done) {
      system.tick();
      return;
    }
    if (index === 0) {
      feed(raceSnapshot(race, viewer, 0));
      return;
    }
    if (index > ticks) {
      done = true;
      system.onReset();
      return;
    }
    stepRaceWithBrains(race, [], brains);
    for (const event of race.events) if (eventVisibleTo(event, viewer)) system.onEvent(event, null);
    // Snapshots at 15 Hz, as on the wire.
    if (index % 2 === 0) feed(raceSnapshot(race, viewer, 0));
  });
  system.mixer.sweep(seconds);
  return { ...pack(buffer, system.mixer, log), resetAt };
}

// --- A written timeline: interface runs, and the busy mix -----------------------------------------

export type TimelineStep =
  | { t: number; ui: UiSoundKind; part?: string }
  | { t: number; cue: Cue }
  | { t: number; beep: boolean };

/** Plays a list of cues at given times through the whole system. Stereo. */
export async function renderTimeline(
  steps: TimelineStep[],
  seconds: number,
  music: MusicIntensity | null = null,
): Promise<Rendered> {
  const ctx = offline(seconds, 2);
  const system = new AudioSystem(ctx);
  const log = logOf(system.mixer);
  system.applyLevels({ ...FULL, musicEnabled: music !== null });
  if (music) {
    system.music.start(undefined, 0);
    system.music.setIntensity(music);
  }
  const sorted = [...steps].sort((a, b) => a.t - b.t);
  let next = 0;
  const dt = 1 / 60;
  const buffer = await renderStepped(ctx, seconds, dt, (_index, t) => {
    while (next < sorted.length && sorted[next]!.t <= t + 1e-6) {
      const step = sorted[next++]!;
      if ('ui' in step) system.ui(step.ui, step.part);
      else if ('beep' in step) system.beep(step.beep);
      else system.cue(step.cue);
    }
    // The music ends before the render does, so the tail shows whether anything else is left.
    if (t >= seconds - 0.6) system.music.stop();
    system.tick();
  });
  system.mixer.sweep(seconds);
  return pack(buffer, system.mixer, log);
}

/** The race theme alone, switching to the final-lap arrangement half way. Stereo. */
export async function renderMusic(seconds: number, raw = false): Promise<Rendered> {
  const ctx = offline(seconds, 2);
  const mixer = new Mixer(ctx, !raw);
  const log = logOf(mixer);
  const music = new MusicPlayer(mixer);
  music.start(undefined, 0);
  const buffer = await renderStepped(ctx, seconds, 0.1, (_index, t) => {
    if (t >= seconds / 2) music.setIntensity('final');
    if (t >= seconds - 0.6) music.stop();
    else music.pump(t + 0.25);
    mixer.sweep(t);
  });
  mixer.sweep(seconds);
  return pack(buffer, mixer, log);
}
