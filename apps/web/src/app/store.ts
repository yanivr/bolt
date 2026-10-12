import { BASELINE_BLUEPRINT, CATALOG } from '@bolt/content';
import type { MatchPhase, VehicleBlueprint } from '@bolt/shared';
import { serializeBlueprint, validateUntrustedBlueprint } from '@bolt/shared';
import { BLUEPRINT_KEY, restoreBlueprint } from './savedBlueprint.js';
import { create } from 'zustand';
import type { CameraDistance } from '../game/rendering/frame.js';
import { parseCameraDistance } from '../game/rendering/frame.js';
import { setVfxQuality } from '../game/vfx/quality.js';
import type { SteeringMode } from '../input/driveInput.js';
import type { LinkMode, LinkStatus } from '../network/link.js';

/**
 * The flow of Section 1.3: Home, Track Preview, the timed garage, the race. My Blueprints is
 * reached from Home; inside the garage it opens as an overlay so the build clock keeps running.
 */
export type Screen = 'boot' | 'home' | 'preview' | 'garage' | 'race' | 'blueprints';

/** Tutorial milestones kept in local storage (Section 4). */
export const MILESTONE_BUILT = 'built';
export const MILESTONE_GARAGE_TIPS = 'garage_tips';

export type Settings = {
  drivingHand: 'left' | 'right';
  /** How the floating stick is read: a direction on screen, or left and right like a wheel. */
  steering: SteeringMode;
  reduceFlashes: boolean;
  /** 0 disables camera shake entirely, 1 is the full restrained amount. */
  cameraShake: number;
  muted: boolean;
  engineVolume: number;
  effectsVolume: number;
  speedUnit: 'mph' | 'kmh';
  showTouchGuide: boolean;
  /** Short callouts for the big moments of a race. Warnings are never switched off. */
  callouts: boolean;
  /** Size of the fire and equipment buttons (Section 5.13, Larger Buttons). */
  hudScale: 'normal' | 'large';
  /**
   * Particle quality (Section 5.13). `auto` lets the effects watch the frame rate and thin
   * out decoration by themselves; nothing that carries gameplay is ever reduced.
   */
  effectsQuality: 'auto' | 'high' | 'low';
  /**
   * How much of the track the race view shows (the `Camera` setting). A fixed view chosen
   * in the menu: the camera still never rotates and never zooms while driving.
   */
  cameraDistance: CameraDistance;
};

export const DEFAULT_SETTINGS: Settings = {
  drivingHand: 'left',
  steering: 'direction',
  // Section 5.13: flashes are reduced by default on first launch.
  reduceFlashes: true,
  cameraShake: 1,
  muted: false,
  engineVolume: 0.7,
  effectsVolume: 0.8,
  speedUnit: 'mph',
  showTouchGuide: true,
  callouts: true,
  hudScale: 'normal',
  effectsQuality: 'auto',
  cameraDistance: 'close',
};

const SETTINGS_KEY = 'bolt.settings.v1';
const MILESTONES_KEY = 'bolt.tutorial.v1';
function loadBlueprint(): VehicleBlueprint {
  try {
    const blueprint = restoreBlueprint(window.localStorage);
    // Written straight back, so a migrated Milestone A pick survives the next reload and a
    // stale entry is replaced by the car that will actually be raced.
    window.localStorage.setItem(BLUEPRINT_KEY, serializeBlueprint(blueprint));
    return blueprint;
  } catch {
    // Storage is unavailable (private browsing, blocked cookies): start from the baseline.
    return BASELINE_BLUEPRINT;
  }
}

function loadSettings(): Settings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // Keep only settings that still exist, with the type they should have, so a value saved
    // by an older build can never reach the game.
    const settings: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (typeof parsed[key] === typeof settings[key]) settings[key] = parsed[key];
    }
    if (settings.steering !== 'direction' && settings.steering !== 'wheel')
      settings.steering = DEFAULT_SETTINGS.steering;
    if (settings.drivingHand !== 'left' && settings.drivingHand !== 'right')
      settings.drivingHand = DEFAULT_SETTINGS.drivingHand;
    if (settings.speedUnit !== 'mph' && settings.speedUnit !== 'kmh')
      settings.speedUnit = DEFAULT_SETTINGS.speedUnit;
    if (settings.hudScale !== 'normal' && settings.hudScale !== 'large')
      settings.hudScale = DEFAULT_SETTINGS.hudScale;
    if (
      settings.effectsQuality !== 'auto' &&
      settings.effectsQuality !== 'high' &&
      settings.effectsQuality !== 'low'
    )
      settings.effectsQuality = DEFAULT_SETTINGS.effectsQuality;
    // `wide` was the name of `far` in an earlier build.
    settings.cameraDistance = parseCameraDistance(
      settings.cameraDistance,
      DEFAULT_SETTINGS.cameraDistance,
    );
    return settings as Settings;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function loadMilestones(): Record<string, boolean> {
  try {
    return JSON.parse(window.localStorage.getItem(MILESTONES_KEY) ?? '{}') as Record<
      string,
      boolean
    >;
  } catch {
    return {};
  }
}

export type BootState =
  | { stage: 'garage' | 'track' | 'connecting'; progress: number }
  | { stage: 'ready' }
  | { stage: 'error'; kind: 'assets' | 'renderer' };

type AppState = {
  screen: Screen;
  boot: BootState;
  settings: Settings;
  milestones: Record<string, boolean>;
  /** The car the player will race: always a legal blueprint for the current catalog. */
  blueprint: VehicleBlueprint;
  /**
   * A saved build the player asked to review in the garage. It may not be legal; the garage
   * opens it as a draft and it only reaches a race once the validator accepts it.
   */
  garageDraft: VehicleBlueprint | null;
  paused: boolean;
  setScreen: (screen: Screen) => void;
  openGarageWith: (draft: VehicleBlueprint) => void;
  takeGarageDraft: () => VehicleBlueprint | null;
  setBoot: (boot: BootState) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  completeMilestone: (id: string) => void;
  /** Replaces the car. Refused, and false returned, unless it is a legal build. */
  setBlueprint: (blueprint: VehicleBlueprint) => boolean;
  setPaused: (paused: boolean) => void;
};

const startSettings = loadSettings();
// The effects read their quality from their own module; the stored choice is handed over once
// here and again whenever it changes.
setVfxQuality(startSettings.effectsQuality);

export const useApp = create<AppState>((set, get) => ({
  screen: 'boot',
  boot: { stage: 'garage', progress: 0 },
  settings: startSettings,
  milestones: loadMilestones(),
  blueprint: loadBlueprint(),
  garageDraft: null,
  paused: false,
  setScreen: (screen) => set({ screen, paused: false }),
  openGarageWith: (draft) => set({ garageDraft: draft, screen: 'garage', paused: false }),
  takeGarageDraft: () => {
    const draft = get().garageDraft;
    if (draft) set({ garageDraft: null });
    return draft;
  },
  setBoot: (boot) => set({ boot }),
  updateSettings: (patch) => {
    const settings = { ...get().settings, ...patch };
    if (patch.effectsQuality !== undefined) setVfxQuality(settings.effectsQuality);
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // Settings still apply for this session.
    }
    set({ settings });
  },
  completeMilestone: (id) => {
    if (get().milestones[id]) return;
    const milestones = { ...get().milestones, [id]: true };
    try {
      window.localStorage.setItem(MILESTONES_KEY, JSON.stringify(milestones));
    } catch {
      // Tutorial prompts may repeat next visit; they stay skippable.
    }
    set({ milestones });
  },
  setBlueprint: (candidate) => {
    const check = validateUntrustedBlueprint(candidate, CATALOG);
    if (!check.ok) return false;
    try {
      window.localStorage.setItem(BLUEPRINT_KEY, serializeBlueprint(check.blueprint));
    } catch {
      // The pick still applies for this session.
    }
    set({ blueprint: check.blueprint });
    return true;
  },
  setPaused: (paused) => set({ paused }),
}));

/** Live race readout. Written by the race scene about twelve times a second. */
export type HudState = {
  linkMode: LinkMode;
  linkStatus: LinkStatus;
  latencyMs: number;
  phase: MatchPhase;
  countdown: number;
  /** Bumps each time GO fires so the flash can replay. */
  goStamp: number;
  speed: number;
  lap: number;
  laps: number;
  raceTimeMs: number;
  lastLapMs: number;
  bestLapMs: number;
  wrongWay: boolean;
  /** Next significant bend: -1 left, 1 right, 0 none; severity 1 to 3. */
  bendDirection: number;
  bendSeverity: number;
  lapFraction: number;
  mapX: number;
  mapY: number;
  finished: boolean;
  fps: number;
  /** Heading of the local car in whole degrees, 0 up the screen and clockwise. Debug readout. */
  headingDeg: number;
  /** True while the local car is backing up. Debug readout. */
  reversing: boolean;
  /** Core heat and stored energy of the local car, whole units. Debug readout. */
  coreHeat: number;
  batteryEnergy: number;
  hasSteered: boolean;
  hasBraked: boolean;
  /** Prediction diagnostics, shown only with ?debug=1. */
  pendingInputs: number;
  corrections: number;
  maxCorrection: number;
  renderer: string;
  /**
   * Combat diagnostics for the debug readout and the end-to-end tests. Not the combat HUD:
   * that is designed in Milestone C part 2 from the same snapshot (docs/COMBAT_API.md).
   */
  position: number;
  gapMeters: number;
  chassis: number;
  rivalChassis: number;
  projectiles: number;
  hazards: number;
  raceEvents: number;
  lastEvent: string;
  statuses: string;
  /** `reason:winner` once the race is decided, otherwise empty. */
  result: string;
};

export const useHud = create<HudState>(() => ({
  linkMode: 'offline',
  linkStatus: 'connected',
  latencyMs: 0,
  phase: 'COUNTDOWN',
  countdown: 3,
  goStamp: 0,
  speed: 0,
  lap: 1,
  laps: 3,
  raceTimeMs: 0,
  lastLapMs: 0,
  bestLapMs: 0,
  wrongWay: false,
  bendDirection: 0,
  bendSeverity: 0,
  lapFraction: 0,
  mapX: 0,
  mapY: 0,
  finished: false,
  fps: 60,
  headingDeg: 0,
  reversing: false,
  coreHeat: 0,
  batteryEnergy: 0,
  hasSteered: false,
  hasBraked: false,
  pendingInputs: 0,
  corrections: 0,
  maxCorrection: 0,
  renderer: '',
  position: 1,
  gapMeters: 0,
  chassis: 0,
  rivalChassis: 0,
  projectiles: 0,
  hazards: 0,
  raceEvents: 0,
  lastEvent: '',
  statuses: '',
  result: '',
}));
