import { environmentFor, getScenario, getTrack } from '@bolt/content';
import type { RaceSnapshot, TrackRuntime, VehicleBlueprint } from '@bolt/shared';
import { buildTrack } from '@bolt/shared';
import { debugEnabled } from '../../app/flags.js';
import { useApp } from '../../app/store.js';
import { raceFeed } from '../raceFeed.js';
import type { AudioLevels, RaceAudioContext, UiSoundKind } from './AudioSystem.js';
import type * as Harness from './debugHarness.js';
import { AudioSystem, FrameProfile } from './AudioSystem.js';
import { haptic, hapticsSupported, setHapticsEnabled, setHapticsReduced } from './haptics.js';
import type { HapticKind } from './haptics.js';
import type { VoiceLogEntry } from './mixer.js';
import type { AudioPrefs } from './settings.js';
import { getAudioPrefs, onAudioPrefs, setAudioPrefs } from './settings.js';

/**
 * The game's one audio system, live. This module owns the `AudioContext`, unlocks it on the
 * first user gesture, listens to the race feed, follows the settings and the page's
 * visibility, and exposes the few functions the rest of the client calls:
 *
 * - `uiSound(kind, partId?)` for buttons, the garage and the build clock;
 * - `getAudioPrefs` / `setAudioPrefs` for the Music and Interface sliders, the music switch,
 *   haptics and reduced intensity;
 * - `setAudioRaceContext` for a race screen that wants to say exactly which car and track
 *   are being raced, instead of letting this module work it out.
 *
 * The race scene keeps using `EngineAudio`, which is now a thin front for the same system.
 */

export type { UiSoundKind } from './AudioSystem.js';
export type { AudioPrefs } from './settings.js';
export type { HapticKind } from './haptics.js';
export { hapticsSupported } from './haptics.js';
export { getAudioPrefs, setAudioPrefs, onAudioPrefs } from './settings.js';

/** The track and weather every race runs on today (`app/App.tsx`). */
const DEFAULT_TRACK_ID = 'city_01';
const DEFAULT_WEATHER_ID = 'city_clear_night';

type ContextSource = {
  blueprint?: VehicleBlueprint;
  trackId?: string;
  weatherPresetId?: string;
  track?: TrackRuntime;
};

let system: AudioSystem | null = null;
let context: AudioContext | null = null;
let wanted: ContextSource | null = null;
let driveVolumes: { engine: number; effects: number; muted: boolean } | null = null;
let housekeeping: number | null = null;
let hiddenAt = false;
const tracks = new Map<string, TrackRuntime>();

const LOG_LIMIT = 6000;
const log: VoiceLogEntry[] = [];
let logging = false;

function levels(): AudioLevels {
  const settings = useApp.getState().settings;
  const prefs = getAudioPrefs();
  return {
    engine: driveVolumes?.engine ?? settings.engineVolume,
    effects: driveVolumes?.effects ?? settings.effectsVolume,
    muted: driveVolumes?.muted ?? settings.muted,
    ui: prefs.uiVolume,
    music: prefs.musicVolume,
    musicEnabled: prefs.musicEnabled,
    reducedIntensity: prefs.reducedIntensity,
  };
}

function applyLevels(): void {
  system?.applyLevels(levels());
}

function trackFor(id: string): TrackRuntime | null {
  const cached = tracks.get(id);
  if (cached) return cached;
  const def = getTrack(id);
  if (!def) return null;
  const runtime = buildTrack(def);
  tracks.set(id, runtime);
  return runtime;
}

/** Which car and track a race is on, from what the page already knows. */
function resolveContext(race: RaceSnapshot): RaceAudioContext | null {
  let blueprint: VehicleBlueprint | undefined = wanted?.blueprint;
  let trackId = wanted?.trackId ?? DEFAULT_TRACK_ID;
  let weatherId = wanted?.weatherPresetId ?? DEFAULT_WEATHER_ID;
  if (!wanted && debugEnabled()) {
    // A showcase scenario brings its own cars, and the query string names it.
    const id = new URLSearchParams(window.location.search).get('scenario');
    const scenario = id ? getScenario(id) : undefined;
    if (scenario) {
      blueprint = scenario.cars[race.you]?.blueprint;
      trackId = scenario.trackId;
      weatherId = scenario.weatherPresetId;
    }
  }
  blueprint ??= useApp.getState().blueprint;
  const track = wanted?.track ?? trackFor(trackId);
  return {
    engineId: blueprint.engineId,
    tireKitId: blueprint.tireKitId,
    chassisId: blueprint.chassisId,
    parts: blueprint.parts.map((part) => part.partId),
    track,
    laps: track?.def.laps ?? 3,
    wet: (environmentFor(weatherId)?.wetness ?? 0) > 0.3,
    themeId: trackId,
  };
}

function startHousekeeping(): void {
  if (housekeeping !== null) return;
  housekeeping = window.setInterval(() => {
    if (context?.state === 'running') system?.tick();
  }, 200);
}

function create(): void {
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  try {
    context = new Ctor({ latencyHint: 'interactive' });
  } catch {
    try {
      // Older prefixed contexts take no options.
      context = new Ctor();
    } catch {
      context = null;
      return;
    }
  }
  system = new AudioSystem(context);
  system.resolveContext = resolveContext;
  const ctx = context;
  system.gate = () => ctx.state === 'running';
  if (logging) attachLog();
  applyLevels();
  raceFeed.subscribe({
    onRace: (race) => system?.onRace(race),
    onEvent: (event, race) => system?.onEvent(event, race),
    onReset: () => system?.onReset(),
  });
  // Unlocked in the middle of a race: pick it up from the latest snapshot.
  if (raceFeed.latest) system.onRace(raceFeed.latest);
  startHousekeeping();
}

/**
 * Creates the audio context, or resumes it. Must run inside a user gesture: browsers start a
 * context suspended otherwise, and iOS Safari only resumes one from a gesture. It is safe to
 * call on every gesture, which is how an `interrupted` context (a phone call, the silent
 * switch, another app taking the audio session) comes back on the next touch.
 */
export function unlockAudio(): void {
  if (typeof window === 'undefined') return;
  if (!context) create();
  if (!context) return;
  if (context.state !== 'running' && !hiddenAt) void context.resume().catch(() => undefined);
}

/** State of the audio context: `none` before the first gesture. */
export function audioState(): AudioContextState | 'interrupted' | 'none' {
  return (context?.state as AudioContextState | 'interrupted' | undefined) ?? 'none';
}

/** The live system, or null before the first gesture. For `EngineAudio`. */
export function liveAudio(): AudioSystem | null {
  return system;
}

/**
 * Plays an interface sound. Silent before the first gesture and when muted; never throws.
 * For `'install'`, pass the part id: each part family has its own install sound, and an engine
 * answers with a blip of its own voice.
 */
export function uiSound(kind: UiSoundKind, partId?: string): void {
  if (!system || context?.state !== 'running' || levels().muted) return;
  system.ui(kind, partId);
}

/** Vibrates if the player has enabled haptics and the device can. Never throws. */
export function uiHaptic(kind: HapticKind, strength = 1): boolean {
  return haptic(kind, strength);
}

/**
 * Optional: tells the audio exactly what is being raced. Without it the car is the player's
 * saved blueprint (or the scenario's car in a showcase) and the track is the launch track.
 * Pass null to go back to working it out.
 */
export function setAudioRaceContext(source: ContextSource | null): void {
  wanted = source;
  if (system && raceFeed.latest) {
    const resolved = resolveContext(raceFeed.latest);
    if (resolved) system.setContext(resolved);
  }
}

/** The race scene's own volumes (`EngineAudio.setVolumes`). They are the store's, every frame. */
export function setDriveVolumes(engine: number, effects: number, muted: boolean): void {
  if (
    driveVolumes &&
    driveVolumes.engine === engine &&
    driveVolumes.effects === effects &&
    driveVolumes.muted === muted
  )
    return;
  driveVolumes = { engine, effects, muted };
  applyLevels();
}

/** The race view is gone: stop its sounds and go back to the store's volumes. */
export function endRaceAudio(): void {
  driveVolumes = null;
  system?.onReset();
  applyLevels();
}

function syncHaptics(prefs: AudioPrefs): void {
  setHapticsEnabled(prefs.haptics && hapticsSupported());
  setHapticsReduced(prefs.reducedIntensity);
}

// --- Page lifecycle --------------------------------------------------------------------------

function onHidden(): void {
  hiddenAt = true;
  if (!context || !system) return;
  // Fade everything, then stop the clock: nothing half-played is left to blurt out on return.
  system.silence();
  const ctx = context;
  window.setTimeout(() => {
    if (hiddenAt && ctx.state === 'running') void ctx.suspend().catch(() => undefined);
  }, 60);
}

function onVisible(): void {
  hiddenAt = false;
  system?.resume();
  if (!context) return;
  // Desktop browsers resume here. iOS may refuse outside a gesture; the next touch does it.
  if (context.state !== 'running') void context.resume().catch(() => undefined);
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const gesture = () => unlockAudio();
  for (const type of ['pointerdown', 'keydown', 'touchend'] as const)
    window.addEventListener(type, gesture, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () =>
    document.visibilityState === 'hidden' ? onHidden() : onVisible(),
  );
  window.addEventListener('pagehide', onHidden);
  window.addEventListener('pageshow', () => {
    if (document.visibilityState !== 'hidden') onVisible();
  });
  useApp.subscribe((state, previous) => {
    if (state.settings !== previous.settings) applyLevels();
  });
  onAudioPrefs((prefs) => {
    syncHaptics(prefs);
    applyLevels();
  });
  syncHaptics(getAudioPrefs());
  if (debugEnabled()) installDebugHook();
}

// --- Debug hook (only with ?debug=1) -----------------------------------------------------------

function attachLog(): void {
  if (!system) return;
  system.mixer.onLog = (entry) => {
    if (log.length < LOG_LIMIT) log.push(entry);
  };
  system.profile = new FrameProfile();
}

/**
 * `window.__boltAudio`, for the browser tests and for a reviewer at the console: the context
 * state, every voice started and stopped with its time, live node counts, and the offline
 * render harness (loaded on demand, never part of a normal page load).
 */
function installDebugHook(): void {
  logging = true;
  const hook = {
    state: () => audioState(),
    stats: () => system?.stats() ?? null,
    log: () => log.slice(),
    clearLog: () => {
      log.length = 0;
    },
    /** The same path as a race restart: `raceFeed.reset()`. */
    reset: () => raceFeed.reset(),
    ui: (kind: UiSoundKind, partId?: string) => uiSound(kind, partId),
    prefs: (patch?: Partial<AudioPrefs>) => (patch ? setAudioPrefs(patch) : getAudioPrefs()),
    /** The app's own settings, through the store's own setter. */
    settings: (patch: { muted?: boolean; engineVolume?: number; effectsVolume?: number }) =>
      useApp.getState().updateSettings(patch),
    /** Leaves the race screen the way the Leave button does. */
    leaveRace: () => useApp.getState().setScreen('home'),
    harness: () => import('./debugHarness.js'),
  };
  (window as unknown as { __boltAudio: typeof hook }).__boltAudio = hook;
}

export type BoltAudioDebugHook = {
  state: () => string;
  stats: () => ReturnType<AudioSystem['stats']> | null;
  log: () => VoiceLogEntry[];
  clearLog: () => void;
  reset: () => void;
  ui: (kind: UiSoundKind, partId?: string) => void;
  prefs: (patch?: Partial<AudioPrefs>) => AudioPrefs;
  settings: (patch: { muted?: boolean; engineVolume?: number; effectsVolume?: number }) => void;
  leaveRace: () => void;
  harness: () => Promise<typeof Harness>;
};
