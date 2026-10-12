import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BASELINE_BLUEPRINT, CATALOG, TRACKS, getWeatherPreset } from '@bolt/content';
import type { TrackRuntime, WeatherAtlasManifest } from '@bolt/shared';
import { buildTrack, resolveBlueprint, sampleBranch } from '@bolt/shared';
import type { CombatStage } from '../../apps/web/src/game/combat/stage.js';
import { WeatherAtlas } from '../../apps/web/src/game/weather/atlas.js';
import type { WeatherFrame } from '../../apps/web/src/game/weather/stage.js';
import { WeatherStage } from '../../apps/web/src/game/weather/stage.js';
import { createStage } from './stage.js';

/**
 * Drives the weather layer without a browser: the real atlas manifest, a real track, the
 * combat stage's two cars (with their rigs) placed on the road and driven along it.
 */

const ATLASES = resolve('apps/web/public/assets/atlases');
export const weatherManifest = JSON.parse(
  readFileSync(resolve(ATLASES, 'vfx_weather/manifest.json'), 'utf8'),
) as WeatherAtlasManifest;
export const weatherAtlas = new WeatherAtlas(weatherManifest);

const runtimes = new Map<string, TrackRuntime>();
export function runtime(trackId: string): TrackRuntime {
  let t = runtimes.get(trackId);
  if (!t) {
    t = buildTrack(TRACKS[trackId]!);
    runtimes.set(trackId, t);
  }
  return t;
}

export type WeatherRig = {
  weather: WeatherStage;
  combat: CombatStage;
  track: TrackRuntime;
  frame: WeatherFrame;
  /** Arc length of the local car along the main line, and the rival's lead over it. */
  s: number;
  gap: number;
  speed: number;
  /** One 60 Hz frame: both cars move along the road, then the weather runs. */
  step(dt?: number): void;
};

export function weatherRig(
  trackId: string,
  presetId: string,
  options: {
    low?: boolean;
    reducedMotion?: boolean;
    stress?: boolean;
    seed?: number;
    gap?: number;
    speed?: number;
  } = {},
): WeatherRig {
  const track = runtime(trackId);
  const preset = getWeatherPreset(presetId)!;
  const weather = new WeatherStage(weatherAtlas, track, preset, {
    reducedMotion: options.reducedMotion ?? false,
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
  });
  const combat = createStage();
  const build = resolveBlueprint(BASELINE_BLUEPRINT, CATALOG);
  combat.setCar(0, build);
  combat.setCar(1, build);
  const frame: WeatherFrame = {
    dt: 1 / 60,
    clockTicks: 0,
    viewX: 0,
    viewY: 0,
    viewW: 870,
    viewH: 370,
    you: 0,
    reduceFlashes: false,
    low: options.low ?? false,
    stress: options.stress ?? false,
  };
  const rig: WeatherRig = {
    weather,
    combat,
    track,
    frame,
    s: 200,
    gap: options.gap ?? 70,
    speed: options.speed ?? 250,
    step(dt = 1 / 60) {
      const main = track.branches[0]!;
      rig.s += rig.speed * dt;
      frame.dt = dt;
      frame.clockTicks += dt * 30;
      for (let i = 0; i < 2; i++) {
        const car = combat.cars[i]!;
        const p = sampleBranch(main, rig.s + (i === 1 ? rig.gap : 0));
        car.present = true;
        // A little to each side, so the two cars are not on one line.
        car.x = Math.round(p.x - p.ty * (i === 0 ? -14 : 14));
        car.y = Math.round(p.y + p.tx * (i === 0 ? -14 : 14));
        car.vx = p.tx * rig.speed;
        car.vy = p.ty * rig.speed;
        car.heading = Math.atan2(p.tx, -p.ty);
        car.frameHeading = car.heading;
        car.braking = Math.floor(rig.s / 400) % 3 === 0;
      }
      const own = combat.cars[0]!;
      // The camera as the race leads it: the car a little behind the middle of the view.
      frame.viewX = Math.round(own.x - frame.viewW / 2 + own.vx * 0.3);
      frame.viewY = Math.round(own.y - frame.viewH / 2 + own.vy * 0.25);
      weather.frame(frame, combat.cars, null);
    },
  };
  return rig;
}
