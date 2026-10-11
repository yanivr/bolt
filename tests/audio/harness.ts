import type { Page } from '@playwright/test';
import type * as Harness from '../../apps/web/src/game/audio/debugHarness.js';
import type { AudioSystem } from '../../apps/web/src/game/audio/AudioSystem.js';
import type { VoiceLogEntry } from '../../apps/web/src/game/audio/mixer.js';
import { decodeFloat32 } from './analysis.js';

/**
 * The Node side of the offline render harness: asks the page (the production build, with
 * `?debug=1`) to render through `window.__boltAudio.harness()` and brings the PCM back.
 */

export type AudioStats = ReturnType<AudioSystem['stats']>;

export type Hook = {
  state: () => string;
  stats: () => AudioStats | null;
  log: () => VoiceLogEntry[];
  clearLog: () => void;
  reset: () => void;
  ui: (kind: string, partId?: string) => void;
  prefs: (patch?: Record<string, unknown>) => Record<string, unknown>;
  settings: (patch: { muted?: boolean; engineVolume?: number; effectsVolume?: number }) => void;
  leaveRace: () => void;
  harness: () => Promise<typeof Harness>;
};

export type Clip = {
  rate: number;
  seconds: number;
  channels: Float32Array[];
  log: VoiceLogEntry[];
  peakVoices: number;
  peakMusic: number;
  nodesEnd: Harness.Rendered['nodesEnd'];
  nodesFixed: number;
  designed?: number;
  resetAt?: number;
};

function unpack(r: Harness.Rendered & { resetAt?: number }): Clip {
  const clip: Clip = {
    rate: r.sampleRate,
    seconds: r.seconds,
    channels: r.channels.map(decodeFloat32),
    log: r.log,
    peakVoices: r.peakVoices,
    peakMusic: r.peakMusic,
    nodesEnd: r.nodesEnd,
    nodesFixed: r.nodesFixed,
  };
  if (r.designed !== undefined) clip.designed = r.designed;
  if (r.resetAt !== undefined) clip.resetAt = r.resetAt;
  return clip;
}

type W = { __boltAudio: Hook };

/** Opens the client far enough for the audio module to have installed its debug hook. */
export async function openHarness(page: Page): Promise<void> {
  await page.goto('/?debug=1');
  await page.waitForFunction(() => '__boltAudio' in window, undefined, { timeout: 30_000 });
  // Load the render chunk once, so the first measurement does not pay for it.
  await page.evaluate(async () => {
    await (window as unknown as W).__boltAudio.harness();
  });
}

export async function recipeInfo(page: Page): Promise<ReturnType<typeof Harness.recipeInfo>> {
  return page.evaluate(async () =>
    (await (window as unknown as W).__boltAudio.harness()).recipeInfo(),
  );
}

export async function engineKeys(page: Page): Promise<string[]> {
  return page.evaluate(async () =>
    (await (window as unknown as W).__boltAudio.harness()).engineKeys(),
  );
}

export async function scenarioIds(page: Page): Promise<string[]> {
  return page.evaluate(async () =>
    (await (window as unknown as W).__boltAudio.harness()).scenarioIds(),
  );
}

export async function renderRecipe(
  page: Page,
  id: string,
  options: Harness.RecipeRender = {},
): Promise<Clip> {
  return unpack(
    await page.evaluate(
      async ([i, o]) => (await (window as unknown as W).__boltAudio.harness()).renderRecipe(i, o),
      [id, options] as const,
    ),
  );
}

export async function renderEngine(
  page: Page,
  key: string,
  options: { raw?: boolean; trim?: number } = {},
): Promise<Clip> {
  return unpack(
    await page.evaluate(
      async ([k, o]) => (await (window as unknown as W).__boltAudio.harness()).renderEngine(k, o),
      [key, options] as const,
    ),
  );
}

export async function renderScenario(
  page: Page,
  id: string,
  options: Harness.ScenarioRender = {},
): Promise<Clip> {
  return unpack(
    await page.evaluate(
      async ([i, o]) => (await (window as unknown as W).__boltAudio.harness()).renderScenario(i, o),
      [id, options] as const,
    ),
  );
}

export async function renderTimeline(
  page: Page,
  steps: Harness.TimelineStep[],
  seconds: number,
  music: 'normal' | 'final' | null = null,
): Promise<Clip> {
  return unpack(
    await page.evaluate(
      async ([s, d, m]) =>
        (await (window as unknown as W).__boltAudio.harness()).renderTimeline(s, d, m),
      [steps, seconds, music] as const,
    ),
  );
}

export async function renderMusic(page: Page, seconds: number, raw = false): Promise<Clip> {
  return unpack(
    await page.evaluate(
      async ([s, r]) => (await (window as unknown as W).__boltAudio.harness()).renderMusic(s, r),
      [seconds, raw] as const,
    ),
  );
}

export { ENGINE_RUN } from '../../apps/web/src/game/audio/debugHarness.js';
