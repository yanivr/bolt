import { resolve } from 'node:path';
import type { CarPose } from '@bolt/shared';
import { VFX_LAYERS, engineSheetFor, layoutCar, vfxFrameRect } from '@bolt/shared';
import { SCENARIOS } from '@bolt/content';
import { PixelBuffer, hex, readPng, writePng } from '../../art/scripts/lib/pixels.js';
import type { CombatStage } from '../../apps/web/src/game/combat/stage.js';
import { COMPONENT_FIRST_WHEEL, headingFrame } from '@bolt/shared';
import { carsManifest, fxManifest, playScenario } from '../helpers/stage.js';
import { runScenario } from '../scenarios/runner.js';

/**
 * A software picture of the combat stage, for reviewing effects without a browser: the same
 * `CombatStage` the game runs, a real scenario, and a plain compositor that draws the pooled
 * sprites from the atlas, the pixel shapes, and the two cars from their sheets (key paint, no
 * terrain) on the road color. It is a review tool, not a second renderer: what ships is drawn
 * by `CombatView`, and `tests/visual/combat.ts` captures that.
 *
 *   npx tsx tests/visual/stageRender.ts <out.png> <scenario> <raceTick> [frames=8] [every=2] [w=260] [h=170] [scale=3]
 *
 * `raceTick` is ticks after GO; `every` is 60 Hz frames between pictures.
 */

const [out, id, tickArg, framesArg, everyArg, wArg, hArg, scaleArg] = process.argv.slice(2);
if (!out || !id)
  throw new Error(
    'usage: stageRender.ts <out.png> <scenario> <raceTick> [frames] [every] [w] [h] [scale]',
  );
const def = SCENARIOS.find((s) => s.id === id);
if (!def) throw new Error(`no scenario ${id}`);
// `auto` starts at the scenario's first shot, wind-up or beam; `auto+12` twelve ticks later.
let startTick = Number(tickArg ?? 0);
if ((tickArg ?? '').startsWith('auto')) {
  const run = runScenario(def);
  const first = run.events.find((e) => ['shot', 'windup', 'beam', 'utility'].includes(e.type));
  startTick = (first ? first.tick - run.goTick : 0) + Number(tickArg!.slice(4) || 0);
}
const count = Number(framesArg ?? 8);
const every = Number(everyArg ?? 2);
const W = Number(wArg ?? 260);
const H = Number(hArg ?? 170);
const zoom = Number(scaleArg ?? 3);

const ATLASES = resolve('apps/web/public/assets/atlases');
const atlas = readPng(resolve(ATLASES, 'vfx_combat', fxManifest.file));
const sheets = new Map<string, PixelBuffer>();
const sheet = (file: string): PixelBuffer => {
  let image = sheets.get(file);
  if (!image) {
    image = readPng(resolve(ATLASES, 'cars', file));
    sheets.set(file, image);
  }
  return image;
};

const frameRects: Array<{ x: number; y: number; w: number; h: number }> = [];
for (const anim of Object.values(fxManifest.anims))
  for (let i = 0; i < anim.frames; i++) frameRects.push(vfxFrameRect(anim, i, fxManifest.padding));

type Canvas = { data: Float32Array; ox: number; oy: number };

function plot(
  c: Canvas,
  wx: number,
  wy: number,
  r: number,
  g: number,
  b: number,
  a: number,
  add: boolean,
): void {
  const x = Math.floor(wx - c.ox);
  const y = Math.floor(wy - c.oy);
  if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
  const i = (y * W + x) * 3;
  if (add) {
    c.data[i] = Math.min(255, c.data[i]! + r * a);
    c.data[i + 1] = Math.min(255, c.data[i + 1]! + g * a);
    c.data[i + 2] = Math.min(255, c.data[i + 2]! + b * a);
  } else {
    c.data[i] = c.data[i]! * (1 - a) + r * a;
    c.data[i + 1] = c.data[i + 1]! * (1 - a) + g * a;
    c.data[i + 2] = c.data[i + 2]! * (1 - a) + b * a;
  }
}

function blit(
  c: Canvas,
  src: PixelBuffer,
  sx: number,
  sy: number,
  w: number,
  h: number,
  dx: number,
  dy: number,
  alpha: number,
  tint: number,
  add: boolean,
  fill = -1,
): void {
  const tr = ((tint >> 16) & 255) / 255;
  const tg = ((tint >> 8) & 255) / 255;
  const tb = (tint & 255) / 255;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = ((sy + y) * src.width + sx + x) * 4;
      const a = src.data[i + 3]!;
      if (a === 0) continue;
      if (fill >= 0)
        plot(
          c,
          dx + x,
          dy + y,
          (fill >> 16) & 255,
          (fill >> 8) & 255,
          fill & 255,
          (a / 255) * alpha,
          false,
        );
      else
        plot(
          c,
          dx + x,
          dy + y,
          src.data[i]! * tr,
          src.data[i + 1]! * tg,
          src.data[i + 2]! * tb,
          (a / 255) * alpha,
          add,
        );
    }
}

function drawLayer(c: Canvas, stage: CombatStage, layer: number): void {
  const pool = stage.pool;
  const add = VFX_LAYERS[layer] === 'glow' || VFX_LAYERS[layer] === 'flash';
  for (let s = pool.layerStart[layer]!; s < pool.layerEnd[layer]!; s++) {
    if (!pool.shown[s]) continue;
    const r = frameRects[pool.frameOut[s]!]!;
    blit(
      c,
      atlas,
      r.x,
      r.y,
      r.w,
      r.h,
      Math.round(pool.drawX[s]! * 2) / 2,
      Math.round(pool.drawY[s]! * 2) / 2,
      pool.drawAlpha[s]!,
      pool.tint[s]!,
      add,
    );
  }
}

function drawCar(c: Canvas, stage: CombatStage, index: number): void {
  const car = stage.cars[index]!;
  const rig = car.rig;
  if (!car.present || !rig) return;
  const build = setupBuilds[index]!;
  const chassis = rig.chassis;
  const wheels = carsManifest.wheels[build.tires.id] ?? carsManifest.wheels.tires_street!;
  const engine =
    carsManifest.engines[build.engine.id] ?? carsManifest.engines.engine_four_cylinder!;
  const pose: CarPose = {
    headingRad: car.frameHeading,
    steer: car.steer,
    roll: car.roll,
    braking: car.braking,
    headlights: true,
    bodyShiftX: car.bodyShiftX,
    bodyShiftY: car.bodyShiftY,
  };
  const ops = layoutCar(
    chassis,
    wheels,
    engine,
    pose,
    rig.parts.map((p) => p.sprite),
  );
  const tick = stage.renderTick;
  const frost = car.has('grip', tick) && car.gripSource === 2;
  const bodyTint = car.ko
    ? 0x62647a
    : frost
      ? 0xa4dcff
      : car.has('emp', tick)
        ? 0xb4b8d0
        : 0xffffff;
  let wheel = 0;
  for (const op of ops) {
    let ref = chassis.body;
    let tint = 0xffffff;
    let fill = -1;
    let frame = op.frame;
    let dx = op.dx;
    let dy = op.dy - (op.kind === 'shadow' ? 0 : car.lift);
    if (op.kind === 'shadow') ref = chassis.shadow;
    else if (op.kind === 'wheel') {
      ref = wheels.sheet;
      const component = COMPONENT_FIRST_WHEEL + wheel;
      const hidden = car.condition(component) === 3 && car.wheelDrop[wheel]! < 0;
      if (car.flash[component]! > 0) fill = 0xffffff;
      const drop = car.wheelDrop[wheel]!;
      if (drop >= 0) dy -= Math.round((1 - Math.min(1, drop / 0.22)) ** 2 * 9);
      wheel++;
      if (hidden) continue;
    } else if (op.kind === 'body') {
      tint = bodyTint;
      if (car.bodyFlash > 0) fill = 0xffffff;
    } else if (op.kind === 'engine') {
      ref = engineSheetFor(chassis, engine);
      if (car.flash[0]! > 0) fill = 0xffffff;
    } else if (op.kind === 'part') {
      const i = rig.parts.findIndex((p) => p.sprite.instanceId === op.instanceId);
      const art = carsManifest.parts?.[op.sheetId];
      if (!art || i < 0 || car.partHidden[i]) continue;
      ref = art.sheet;
      const heading = car.partHeading(i);
      frame = headingFrame(heading);
      const kick = car.partKick[i]!;
      dx -= Math.round(Math.sin(heading) * kick);
      dy += Math.round(Math.cos(heading) * kick);
      if (car.condition(car.partComponent(i)) === 3) tint = 0x5c6074;
      if (car.flash[car.partComponent(i)]! > 0) fill = 0xffffff;
    } else if (op.kind === 'headlight') ref = chassis.headlights;
    else if (op.kind === 'brake') ref = chassis.brakeLights;
    const image = sheet(ref.file);
    const fw = ref.frameWidth;
    const fh = ref.frameHeight;
    blit(
      c,
      image,
      (frame % ref.columns) * fw,
      Math.floor(frame / ref.columns) * fh,
      fw,
      fh,
      car.x + dx - fw / 2,
      car.y + dy - fh / 2,
      1,
      tint,
      false,
      fill,
    );
  }
}

const setupBuilds: Array<{ tires: { id: string }; engine: { id: string } }> = [];
const road = hex('#3a4058');
const pictures: PixelBuffer[] = [];
let frameIndex = 0;
let started = -1;

playScenario(def, {
  onFrame(stage, raceTick) {
    if (setupBuilds.length === 0) {
      // The rigs know the chassis; engines and wheel kits come from the scenario's blueprints.
      def.cars.forEach((car) =>
        setupBuilds.push({
          tires: { id: car.blueprint.tireKitId },
          engine: { id: car.blueprint.engineId },
        }),
      );
    }
    if (raceTick < startTick || pictures.length >= count) return;
    if (started < 0) started = frameIndex;
    if ((frameIndex++ - started) % every !== 0) return;
    const a = stage.cars[0]!;
    const b = stage.cars[1]!;
    // FOCUS=0 or FOCUS=1 in the environment centres one car; otherwise the middle of the two.
    const pick = process.env.FOCUS;
    const cx = pick === '0' ? a.x : pick === '1' ? b.x : b.present ? (a.x + b.x) / 2 : a.x;
    const cy = pick === '0' ? a.y : pick === '1' ? b.y : b.present ? (a.y + b.y) / 2 : a.y;
    const c: Canvas = {
      data: new Float32Array(W * H * 3),
      ox: Math.round(cx - W / 2),
      oy: Math.round(cy - H / 2),
    };
    for (let i = 0; i < W * H; i++) {
      c.data[i * 3] = road[0];
      c.data[i * 3 + 1] = road[1];
      c.data[i * 3 + 2] = road[2];
    }
    // A lane line, so motion and scale can be read.
    for (let x = 0; x < W; x++)
      if (Math.floor((x + c.ox) / 16) % 2 === 0)
        plot(c, x + c.ox, cy - 44, 200, 196, 170, 0.7, false);
    const sink = (add: boolean) => ({
      rect: (x: number, y: number, w: number, h: number, color: number, alpha: number) => {
        for (let yy = 0; yy < h; yy++)
          for (let xx = 0; xx < w; xx++)
            plot(
              c,
              x + xx,
              y + yy,
              (color >> 16) & 255,
              (color >> 8) & 255,
              color & 255,
              alpha,
              add,
            );
      },
    });
    drawLayer(c, stage, 0);
    drawLayer(c, stage, 2);
    stage.drawGround(sink(false));
    drawLayer(c, stage, 1);
    const order = a.y > b.y ? [1, 0] : [0, 1];
    for (const index of order) drawCar(c, stage, index);
    drawLayer(c, stage, 3);
    drawLayer(c, stage, 4);
    drawLayer(c, stage, 5);
    stage.drawAir(sink(false));
    drawLayer(c, stage, 6);
    const picture = new PixelBuffer(W, H);
    for (let i = 0; i < W * H; i++) {
      picture.data[i * 4] = c.data[i * 3]!;
      picture.data[i * 4 + 1] = c.data[i * 3 + 1]!;
      picture.data[i * 4 + 2] = c.data[i * 3 + 2]!;
      picture.data[i * 4 + 3] = 255;
    }
    pictures.push(picture);
  },
});

const columns = Math.min(4, pictures.length);
const rows = Math.ceil(pictures.length / columns);
const montage = new PixelBuffer(columns * (W + 2), rows * (H + 2));
pictures.forEach((p, i) =>
  montage.blit(p, (i % columns) * (W + 2), Math.floor(i / columns) * (H + 2)),
);
writePng(resolve(out), montage.scaled(zoom));
console.log(`${id}: ${pictures.length} frames from tick ${startTick}`);
