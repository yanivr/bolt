import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  CarAtlasManifest,
  RaceEvent,
  ScenarioDefinition,
  VfxAtlasManifest,
} from '@bolt/shared';
import { SIM_DT, VFX_LAYERS, raceSnapshot, stepRaceWithBrains } from '@bolt/shared';
import { createScenarioRace } from '@bolt/content';
import { CombatStage } from '../../apps/web/src/game/combat/stage.js';
import type { PixelSink } from '../../apps/web/src/game/vfx/PixelFx.js';
import { FxAtlas } from '../../apps/web/src/game/vfx/atlas.js';
import { scenarioTrack } from '../scenarios/runner.js';

/**
 * Drives the combat presentation without a browser: the real stage, the real atlas manifest,
 * a real scenario stepped by the real simulation, and frames at 60 Hz exactly as the race
 * scene feeds them when the race runs in the page.
 */

const ASSETS = resolve('apps/web/public/assets/atlases');
export const fxManifest = JSON.parse(
  readFileSync(resolve(ASSETS, 'vfx_combat/manifest.json'), 'utf8'),
) as VfxAtlasManifest;
export const carsManifest = JSON.parse(
  readFileSync(resolve(ASSETS, 'cars/manifest.json'), 'utf8'),
) as CarAtlasManifest;

export class CountingSink implements PixelSink {
  rects = 0;
  /** Rectangles that were not on whole pixels or had no area. */
  bad = 0;
  rect(x: number, y: number, w: number, h: number): void {
    this.rects++;
    if (
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      !Number.isInteger(w) ||
      !Number.isInteger(h) ||
      w < 1 ||
      h < 1
    )
      this.bad++;
  }
}

export function createStage(kicks: number[] = []): CombatStage {
  return new CombatStage(new FxAtlas(fxManifest), carsManifest, {
    kick: (pixels) => kicks.push(pixels),
    skid: () => {},
    exhaust: () => {},
  });
}

export type StageRun = {
  stage: CombatStage;
  events: RaceEvent[];
  sink: CountingSink;
  /** Most sprites, pixel particles and shapes alive on any frame. */
  peakSprites: number;
  peakPixels: number;
  /** Names of every strip that was shown at least once, and kinds of pixel shape. */
  anims: Set<string>;
  shapes: Set<number>;
  /** Strips that were shown on a layer of the wrong blend mode. */
  misblended: Set<string>;
  /** Strips and shapes first shown within a second of each weapon's own events. */
  frames: number;
};

/** Plays one scenario through a stage, two frames a tick, drawing every frame. */
export function playScenario(
  def: ScenarioDefinition,
  options: {
    stage?: CombatStage;
    onFrame?: (stage: CombatStage, raceTick: number) => void;
    extraTicks?: number;
    settleSeconds?: number;
  } = {},
): StageRun {
  const setup = createScenarioRace(def, scenarioTrack(def));
  if (!setup) throw new Error(`scenario ${def.id} does not resolve`);
  const { race, brains, entries } = setup;
  const stage = options.stage ?? createStage();
  stage.clear();
  stage.scale = 2;
  stage.setCar(0, entries[0]!.build);
  stage.setCar(1, entries[1]!.build);
  const sink = new CountingSink();
  const events: RaceEvent[] = [];
  const run: StageRun = {
    stage,
    events,
    sink,
    peakSprites: 0,
    peakPixels: 0,
    anims: new Set(),
    shapes: new Set(),
    misblended: new Set(),
    frames: 0,
  };
  const own = {
    x: 0,
    y: 0,
    heading: 0,
    frameHeading: 0,
    vx: 0,
    vy: 0,
    steer: 0,
    braking: false,
    roll: 0,
    bodyShiftX: 0,
    bodyShiftY: 0,
  };
  let prev = { ...race.cars[0]!.session.motion };
  const limit = def.countdownTicks + def.durationTicks + (options.extraTicks ?? 45);
  for (let i = 0; i < limit; i++) {
    prev = { ...race.cars[0]!.session.motion };
    stepRaceWithBrains(race, [], brains);
    for (const event of race.events) {
      events.push(event);
      stage.onEvent(event);
    }
    stage.onRace(raceSnapshot(race, 0, 0));
    const m = race.cars[0]!.session.motion;
    for (let f = 0; f < 2; f++) {
      const alpha = f === 0 ? 0 : 0.5;
      own.x = Math.round((prev.x + (m.x - prev.x) * alpha) * 2) / 2;
      own.y = Math.round((prev.y + (m.y - prev.y) * alpha) * 2) / 2;
      own.heading = m.headingRad;
      own.frameHeading = m.headingRad;
      own.vx = m.velocityX;
      own.vy = m.velocityY;
      stage.viewX0 = own.x - 435;
      stage.viewY0 = own.y - 195;
      stage.viewX1 = own.x + 435;
      stage.viewY1 = own.y + 195;
      stage.frame(SIM_DT / 2, own, alpha);
      stage.drawGround(sink);
      stage.drawAir(sink);
      run.frames++;
      const pool = stage.pool;
      for (let s = 0; s < pool.size; s++)
        if (pool.shown[s]) {
          const name = stage.atlas.names[pool.anim[s]!]!;
          run.anims.add(name);
          // An additive strip on an ordinary layer (or the reverse) would be drawn wrong.
          const layer = VFX_LAYERS[pool.layerOf(s)]!;
          const additive = layer === 'glow' || layer === 'flash';
          if ((fxManifest.anims[name]!.blend === 'add') !== additive) run.misblended.add(name);
        }
      for (let s = 0; s < stage.px.sKind.length; s++)
        if (stage.px.sKind[s]) run.shapes.add(stage.px.sKind[s]!);
      run.peakSprites = Math.max(run.peakSprites, pool.count());
      run.peakPixels = Math.max(run.peakPixels, stage.px.pixelsLive);
      options.onFrame?.(stage, race.raceTicks);
    }
  }
  // Let what is on screen play out with no further events.
  const settle = Math.round((options.settleSeconds ?? 0) * 60);
  for (let f = 0; f < settle; f++) {
    stage.frame(1 / 60, own, 1);
    stage.drawGround(sink);
    stage.drawAir(sink);
  }
  return run;
}
