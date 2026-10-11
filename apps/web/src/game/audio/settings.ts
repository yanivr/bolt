/**
 * Audio preferences the app's settings store does not hold yet (Section 5.13 asks for separate
 * Music, Engine, Effects and UI sliders; the store has Engine, Effects and Mute). They live
 * here, persist on their own key, and are changed through `setAudioPrefs`. When the settings
 * screen grows the controls, it calls these; nothing else needs to change.
 */

export type AudioPrefs = {
  /** 0 to 1. */
  musicVolume: number;
  uiVolume: number;
  /** Music on or off, apart from its volume. */
  musicEnabled: boolean;
  /** Vibration. Off unless the player turns it on (Section 14.4). */
  haptics: boolean;
  /** Softer explosions and impacts, a gentler EMP stutter, half-length vibration. */
  reducedIntensity: boolean;
};

export const DEFAULT_AUDIO_PREFS: AudioPrefs = {
  musicVolume: 0.5,
  uiVolume: 0.8,
  musicEnabled: true,
  haptics: false,
  reducedIntensity: false,
};

export const AUDIO_PREFS_KEY = 'bolt.audio.v1';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function storage(): Store | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Reads stored preferences, keeping only fields that still exist with the right type. */
export function parseAudioPrefs(raw: string | null): AudioPrefs {
  const prefs: AudioPrefs = { ...DEFAULT_AUDIO_PREFS };
  if (!raw) return prefs;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out = prefs as unknown as Record<string, unknown>;
    for (const key of Object.keys(DEFAULT_AUDIO_PREFS)) {
      const value = parsed[key];
      if (typeof value !== typeof out[key]) continue;
      out[key] = typeof value === 'number' ? Math.max(0, Math.min(1, value)) : value;
    }
  } catch {
    // Unreadable: defaults.
  }
  return prefs;
}

let prefs: AudioPrefs = (() => {
  try {
    return parseAudioPrefs(storage()?.getItem(AUDIO_PREFS_KEY) ?? null);
  } catch {
    return { ...DEFAULT_AUDIO_PREFS };
  }
})();

const listeners = new Set<(prefs: AudioPrefs) => void>();

export function getAudioPrefs(): AudioPrefs {
  return prefs;
}

export function setAudioPrefs(patch: Partial<AudioPrefs>): AudioPrefs {
  prefs = parseAudioPrefs(JSON.stringify({ ...prefs, ...patch }));
  try {
    storage()?.setItem(AUDIO_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Still applies for this session.
  }
  for (const listener of listeners) listener(prefs);
  return prefs;
}

export function onAudioPrefs(listener: (prefs: AudioPrefs) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
