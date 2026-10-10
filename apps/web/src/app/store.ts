import { DEFAULT_LOADOUT } from '@bolt/content';
import type { MatchPhase, VehicleLoadout } from '@bolt/shared';
import { create } from 'zustand';
import type { LinkMode, LinkStatus } from '../network/link.js';

export type Screen = 'boot' | 'home' | 'race';

export type Settings = {
  drivingHand: 'left' | 'right';
  reducedCamera: boolean;
  reduceFlashes: boolean;
  /** 0 disables camera shake entirely, 1 is the full restrained amount. */
  cameraShake: number;
  muted: boolean;
  engineVolume: number;
  effectsVolume: number;
  speedUnit: 'mph' | 'kmh';
  showTouchGuide: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  drivingHand: 'left',
  reducedCamera: false,
  // Section 5.13: flashes are reduced by default on first launch.
  reduceFlashes: true,
  cameraShake: 1,
  muted: false,
  engineVolume: 0.7,
  effectsVolume: 0.8,
  speedUnit: 'mph',
  showTouchGuide: true,
};

const SETTINGS_KEY = 'bolt.settings.v1';
const MILESTONES_KEY = 'bolt.tutorial.v1';
const LOADOUT_KEY = 'bolt.loadout.v1';

function loadLoadout(): VehicleLoadout {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(LOADOUT_KEY) ?? 'null',
    ) as Partial<VehicleLoadout> | null;
    // Unknown ids are caught again by the server; this only restores the last pick.
    return parsed ? { ...DEFAULT_LOADOUT, ...parsed } : { ...DEFAULT_LOADOUT };
  } catch {
    return { ...DEFAULT_LOADOUT };
  }
}

function loadSettings(): Settings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
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
  loadout: VehicleLoadout;
  paused: boolean;
  setScreen: (screen: Screen) => void;
  setBoot: (boot: BootState) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  completeMilestone: (id: string) => void;
  setLoadout: (patch: Partial<VehicleLoadout>) => void;
  setPaused: (paused: boolean) => void;
};

export const useApp = create<AppState>((set, get) => ({
  screen: 'boot',
  boot: { stage: 'garage', progress: 0 },
  settings: loadSettings(),
  milestones: loadMilestones(),
  loadout: loadLoadout(),
  paused: false,
  setScreen: (screen) => set({ screen, paused: false }),
  setBoot: (boot) => set({ boot }),
  updateSettings: (patch) => {
    const settings = { ...get().settings, ...patch };
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
  setLoadout: (patch) => {
    const loadout = { ...get().loadout, ...patch };
    try {
      window.localStorage.setItem(LOADOUT_KEY, JSON.stringify(loadout));
    } catch {
      // The pick still applies for this session.
    }
    set({ loadout });
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
  hasSteered: boolean;
  hasBraked: boolean;
  /** Prediction diagnostics, shown only with ?debug=1. */
  pendingInputs: number;
  corrections: number;
  maxCorrection: number;
  renderer: string;
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
  hasSteered: false,
  hasBraked: false,
  pendingInputs: 0,
  corrections: 0,
  maxCorrection: 0,
  renderer: '',
}));
