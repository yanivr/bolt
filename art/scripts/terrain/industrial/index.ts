import { sampleBranch } from '@bolt/shared';
import type { HazardSchedule, TerrainLight, TrackHazard } from '@bolt/shared';
import type { AnimatedArt, BakeContext, BiomeModule, BiomeOutput } from '../biome.js';
import { Canvas, F_EMISSIVE } from '../canvas.js';
import type { Color } from '../canvas.js';
import { accumulatePools, applyLight, applyShadows, castShadows } from '../lighting.js';
import type { LightPool } from '../lighting.js';
import { Scene } from '../oblique.js';
import { citySeed } from '../city/index.js';
import { paintGround } from '../city/ground.js';
import { buildLayout } from '../city/layout.js';
import type { FixedLot, LayoutOptions, Rect, Reserve } from '../city/layout.js';
import { G_QUAY, G_WATER } from '../city/layout.js';
import {
  PAL,
  ROOF_SLATE,
  shadeNight,
  shadeRoad,
  shadeRoadDeep,
  withCityStyle,
} from '../city/palette.js';
import { BARRIER_REACH, paintBarrier } from '../city/road.js';
import { lampTwin, lampPole, lampArm, LAMP_ARM } from '../city/sprites.js';
import { loopMismatch } from '../city/timetable.js';
import { wetLoops, wetOverlays, wetPass } from '../city/wet.js';
import { placeCornerSigns, startBanner } from '../city/blitz/dressing.js';
import {
  beaconLoop,
  conveyorLoop,
  furnaceLoop,
  lampLoop,
  magnetLoop,
  oilLoop,
  pistonLoop,
  sparksLoop,
  steamLoop,
  ventRingLoop,
} from './anim.js';
import {
  anchorPt,
  clearOf,
  containerRows,
  paintConveyorBridge,
  paintDock,
  paintFurnace,
  paintGantry,
  paintStack,
  paintWaterTower,
  pressAt,
  warningBoard,
} from './landmarks.js';
import { paintIndustrialRoad, planIndustrialRoad } from './road.js';
import { buildWorks, hallTrusses, inZone } from './structures.js';
import type { HallZone } from './structures.js';
import { IND, NIGHT_STYLE, RAIN_STYLE, TINT_MERCURY, TINT_SODIUM, WET_FACTORY } from './style.js';

/**
 * The industrial biome (docs/art/tracks/industrial_01.md): a steelworks at night, built with
 * the city's oblique machinery under an industrial style. Paints Steel Circuit's dry night and
 * its factory rain.
 */

const LAYOUT: LayoutOptions = {
  streetScale: 1.3,
  regionMax: 460,
  regionMay: 340,
  lotMax: 190,
  lotSquare: 140,
  parkRate: 0,
  parkingRate: 0.1,
  plazaRate: 0.1,
  towerRate: 0,
};

const TINTS: ReadonlyArray<readonly [number, number, number]> = [
  [1.0, 0.7, 0.32],
  [0.3, 0.86, 0.95],
  [1.0, 0.5, 0.24],
  [0.64, 0.5, 0.96],
  [1.0, 0.78, 0.34],
  [0.74, 1.0, 0.9],
];
const GAIN = [0, 0.2, 0.42, 0.66];
const LIFT = [0, 7, 15, 24];

function litWorks(c: Color, step: number, tint: number): Color {
  const t = TINTS[tint] ?? TINTS[0]!;
  const g = GAIN[step] ?? 0.8;
  const l = LIFT[step] ?? 30;
  const r = (c >> 16) & 255;
  const gr = (c >> 8) & 255;
  const b = c & 255;
  const lum = (r * 3 + gr * 5 + b * 2) / 10;
  const k = g * Math.max(0.22, 1.22 - lum / 190);
  return (
    (Math.min(255, Math.round(r * (1 + k * t[0]) + l * t[0])) << 16) |
    (Math.min(255, Math.round(gr * (1 + k * t[1]) + l * t[1])) << 8) |
    Math.min(255, Math.round(b * (1 + k * t[2]) + l * t[2]))
  );
}

/** The bounding box of the main line's samples on a run of one surface holding a hazard. */
function runBox(ctx: BakeContext, test: (i: number) => boolean): Rect | null {
  const m = ctx.track.main;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < m.count; i++) {
    if (!test(i)) continue;
    x0 = Math.min(x0, m.x[i]!);
    y0 = Math.min(y0, m.y[i]!);
    x1 = Math.max(x1, m.x[i]!);
    y1 = Math.max(y1, m.y[i]!);
  }
  return x0 > x1
    ? null
    : { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
}

function grow(r: Rect, n: number, e: number, s: number, w: number): Rect {
  return { x: r.x - w, y: r.y - n, w: r.w + w + e, h: r.h + n + s };
}

export function paintIndustrial(bake: BakeContext): BiomeOutput {
  const rain = bake.preset.wetness > 0;
  return withCityStyle(rain ? RAIN_STYLE : NIGHT_STYLE, () =>
    paint({ ...bake, seed: citySeed(bake) }, bake.seed, rain),
  );
}

function paint(ctx: BakeContext, presetSeed: number, rain: boolean): BiomeOutput {
  const { world, field, track, def } = ctx;
  const pools: LightPool[] = [];
  const lights: TerrainLight[] = [];
  const out = { pools, lights };
  const scene = new Scene(field, track.obstacles);
  const W = def.worldWidth;
  const H = def.worldHeight;
  const m = track.main;
  const hazards = def.hazards;
  const sOf = (h: TrackHazard): number =>
    track.routeHazards.find((r) => r.hazard === hazards.indexOf(h))?.s ?? -1;

  // --- Plan: the two halls from the stretches of plate holding their hazards -----------------
  const magnets = hazards.filter((h) => h.kind === 'magnetic_strip');
  const vents = hazards.filter(
    (h): h is Extract<TrackHazard, { kind: 'steam_vent' }> => h.kind === 'steam_vent',
  );
  const near = (i: number, list: TrackHazard[], reach: number): boolean =>
    list.some((h) => {
      const s = sOf(h);
      const d = Math.abs(m.s[i]! - s);
      return s >= 0 && Math.min(d, m.length - d) < reach;
    });
  const pressBox = runBox(ctx, (i) => m.surface[i] === 'metal' && near(i, magnets, 420));
  const smelterBox = runBox(
    ctx,
    (i) =>
      m.surface[i] === 'metal' &&
      Math.abs(m.ty[i]!) < 0.2 &&
      near(i, [...vents, ...hazards.filter((h) => h.kind === 'oil')], 520),
  );
  const zones: HallZone[] = [];
  if (pressBox)
    zones.push({ id: 'press_hall', name: 'PRESS HALL', rects: [grow(pressBox, 40, 96, 60, 96)] });
  if (smelterBox)
    zones.push({
      id: 'smelter_hall',
      name: 'SMELTER HALL',
      rects: [grow(smelterBox, 110, 10, 66, 30)],
    });

  // The dock: the quay apron east of the cobbled road, then the water.
  const cobRun = runBox(ctx, (i) => m.surface[i] === 'cobble')!;
  const quayX = clearOf(
    ctx,
    cobRun.x + cobRun.w,
    cobRun.y + (cobRun.h >> 1),
    1,
    0,
    BARRIER_REACH + 4,
  ).x;
  const waterX = Math.min(W - 140, quayX + 120);
  // The crane yard round the gantry's anchor, between the yard road and Smelter Hall.
  const ga = anchorPt(ctx, 'gantry_crane');
  const gTop = clearOf(ctx, ga.x, ga.y, 0, -1, 0).y;
  let up = ga.y;
  while (up > 0 && field.edge[up * W + ga.x]! > 0) up--;
  let down = ga.y;
  while (
    down < H - 1 &&
    field.edge[down * W + ga.x]! > 0 &&
    !zones.some((z) => inZone(z, ga.x, down))
  )
    down++;
  const yard = {
    x: ga.x - 130,
    y: up + BARRIER_REACH + 8,
    w: 260,
    h: down - up - BARRIER_REACH - 20,
  };
  void gTop;
  const wt = anchorPt(ctx, 'water_tower');
  const wtAt = clearOf(ctx, wt.x, wt.y, -1, 0, BARRIER_REACH + 70);
  const stackA = anchorPt(ctx, 'smelter_stacks', 0);
  const stackB = anchorPt(ctx, 'smelter_stacks', 1);
  const stackY = Math.min(H - 40, stackA.y + 130);

  const reserves: Reserve[] = [
    { x: quayX, y: 0, w: waterX - quayX, h: H, ground: G_QUAY },
    { x: waterX, y: 0, w: W - waterX, h: H, ground: G_WATER },
    { ...yard, ground: G_QUAY },
  ];
  const fixed: FixedLot[] = [
    {
      x: wtAt.x - 30,
      y: wtAt.y - 30,
      w: 60,
      h: 60,
      family: ROOF_SLATE,
      rise: 60,
      tag: 'water_tower',
    },
    {
      x: stackA.x - 30,
      y: stackY - 30,
      w: stackB.x - stackA.x + 60,
      h: 60,
      family: ROOF_SLATE,
      rise: 160,
      tag: 'stacks',
    },
  ];
  const layout = buildLayout(ctx, scene, reserves, fixed, LAYOUT);
  const plan = planIndustrialRoad(ctx);

  // --- Flat ground ---------------------------------------------------------------------------
  paintGround(ctx, scene, layout, out);
  for (const z of zones)
    for (const r of z.rects)
      for (let y = Math.max(0, r.y); y < Math.min(H, r.y + r.h); y++)
        for (let x = Math.max(0, r.x); x < Math.min(W, r.x + r.w); x++) {
          if (field.edge[y * W + x]! <= 0) continue;
          // Hall floor: concrete bays with painted walkways.
          const bx = x % 48;
          const by = y % 40;
          let c: Color =
            bx === 0 || by === 0
              ? IND.concreteSeam
              : ((x >> 4) + (y >> 4)) % 5 === 0
                ? IND.concreteAlt
                : IND.concrete;
          const edgeD = field.edge[y * W + x]!;
          if (edgeD > BARRIER_REACH + 4 && edgeD < BARRIER_REACH + 7) c = IND.hazardYellowDim;
          world.set(x, y, c);
        }
  paintIndustrialRoad(ctx, plan);
  paintBarrier(ctx, scene, layout, plan);

  // --- Halls ---------------------------------------------------------------------------------
  let trusses = 0;
  let machines = 0;
  for (const z of zones) trusses += hallTrusses(ctx, scene, z, out, 52);
  // Presses beside the road in Press Hall, at their anchors; their rams are loops.
  const presses: Array<{ x: number; y: number }> = [];
  for (const p of def.anchors.find((a) => a.kind === 'piston')?.points ?? []) {
    const at = pressAt(ctx, scene, p.x, p.y, out);
    if (at) presses.push(at);
    machines++;
  }

  // --- Landmarks -----------------------------------------------------------------------------
  paintWaterTower(scene, wtAt.x, wtAt.y, out);
  const beacons: Array<{ x: number; y: number }> = [];
  beacons.push(paintStack(scene, stackA.x, stackY, 13, 150));
  beacons.push(paintStack(scene, stackB.x, stackY + 6, 11, 128));
  containerRows(scene, { x: yard.x, y: yard.y + 30, w: yard.w, h: yard.h - 40 }, 51);
  const craneLight = paintGantry(scene, ga.x - 20, yard.y + 14, yard.y + yard.h - 6, out);
  const cb = def.anchors.find((a) => a.kind === 'conveyor');
  if (cb && cb.points.length >= 2)
    paintConveyorBridge(
      ctx,
      scene,
      Math.round(cb.points[0]!.x) + 40,
      Math.round(cb.points[1]!.x) - 40,
      Math.round(cb.points[0]!.y),
      out,
    );
  const dock = paintDock(ctx, scene, quayX, waterX, 40, H - 40, out);
  const glowA = anchorPt(ctx, 'smelter_glow');
  const mouth = paintFurnace(ctx, scene, glowA.x, glowA.y, out);
  const gw = anchorPt(ctx, 'gap_warning');
  for (const dx of [-30, 30])
    if (
      warningBoard(
        scene,
        clearOf(ctx, gw.x + dx, gw.y, 0, 1, BARRIER_REACH + 2).x,
        clearOf(ctx, gw.x + dx, gw.y, 0, 1, BARRIER_REACH + 2).y + 17,
        'LOW CLEARANCE',
      )
    )
      break;
  // Obstacles inside their discs: pillars are drawn with the bridge (or as hall columns),
  // crates and the barrel here.
  for (const ob of track.obstacles) {
    const x = Math.round(ob.x);
    const y = Math.round(ob.y);
    const r = Math.floor(ob.radius);
    if (ob.kind === 'pillar' && !ob.id.startsWith('gap_')) {
      const cv = Canvas.sprite(2 * r, 2 * r + 2);
      cv.disc(r - 0.5, r + 1, r - 1, PAL.steelDark);
      cv.disc(r - 0.5, r - 0.5, r - 1, PAL.steel);
      for (let k = 0; k < 2 * r; k++)
        cv.set(k, r, (k >> 1) % 2 === 0 ? IND.hazardYellow : IND.hazardBlack);
      cv.disc(r - 1.5, r - 1.5, r - 3, PAL.steelLight);
      scene.add({ art: cv, x: x - r, y: y - r, baseY: y + r });
    } else if (ob.kind === 'crate') {
      const cv = Canvas.sprite(10, 11);
      cv.rect(0, 0, 10, 3, PAL.woodLight);
      cv.rect(0, 3, 10, 7, PAL.wood);
      cv.frame(0, 3, 10, 7, PAL.woodDark);
      cv.line(1, 4, 8, 9, PAL.woodDark);
      cv.hline(0, 10, 10, PAL.ink);
      scene.add({ art: cv, x: x - 5, y: y - 6, baseY: y + 5 });
    } else if (ob.kind === 'barrel') {
      const cv = Canvas.sprite(10, 12);
      cv.rect(0, 2, 10, 8, IND.hazardYellowDim);
      cv.vline(0, 2, 8, IND.hazardYellow);
      cv.hline(0, 5, 10, IND.hazardBlack);
      cv.disc(4.5, 2, 4, IND.hazardYellow);
      cv.disc(4.5, 2, 2, IND.oilMid);
      cv.hline(0, 11, 10, PAL.ink);
      scene.add({ art: cv, x: x - 5, y: y - 6, baseY: y + 5 });
    }
  }
  // Warning lamp posts beside the vents, at their anchors.
  const lampSpots: Array<{ x: number; y: number }> = [];
  for (const p of def.anchors.find((a) => a.kind === 'warning_light')?.points ?? []) {
    const at = clearOf(
      ctx,
      p.x,
      p.y,
      0,
      p.y > (vents[0]?.shape.type === 'circle' ? vents[0].shape.y : 0) ? 1 : -1,
      BARRIER_REACH + 1,
    );
    const cv = Canvas.sprite(5, 20);
    cv.vline(2, 4, 15, PAL.steelLight);
    cv.vline(3, 4, 15, PAL.steelDark);
    cv.hline(0, 19, 5, PAL.ink);
    cv.rect(0, 0, 5, 4, PAL.steelDark);
    cv.set(2, 1, 0x6a4a20);
    if (!scene.artFits(cv, at.x - 2, at.y - 19)) continue;
    scene.add({ art: cv, x: at.x - 2, y: at.y - 19, baseY: at.y });
    lampSpots.push({ x: at.x, y: at.y - 18 });
  }

  // --- Works buildings, lamps, signs ---------------------------------------------------------
  // Inside the halls the lots are the halls' own bays: built taller, the road runs between them.
  buildWorks(
    scene,
    layout,
    out,
    () => false,
    (lot) =>
      zones.some((z) =>
        z.rects.some(
          (r) =>
            lot.x < r.x + r.w && r.x < lot.x + lot.w && lot.y < r.y + r.h && r.y < lot.y + lot.h,
        ),
      ),
  );
  // Sodium masts along the yard roads (the halls have their own lamps).
  for (let s = 60; s < m.length; s += 190) {
    const p = sampleBranch(m, s);
    if (zones.some((z) => inZone(z, p.x, p.y))) continue;
    for (const side of [-1, 1]) {
      const nx = -p.ty * side;
      const ny = p.tx * side;
      const reach = p.halfWidth + p.shoulder + 3;
      if (ny < -0.7) {
        const sp = lampTwin();
        const gx = Math.round(p.x + nx * reach);
        let gy = Math.round(p.y + ny * reach);
        while (gy > 0 && field.edge[gy * W + gx]! <= 0) gy--;
        if (!scene.spriteFits(sp, gx, gy - 1)) continue;
        scene.add({ art: sp.art, x: gx - sp.ax, y: gy - 1 - sp.ay, baseY: gy + 3 });
        pools.push({
          x: p.x + nx * (p.halfWidth - 26),
          y: p.y + ny * (p.halfWidth - 26),
          radii: [40, 74],
          tint: TINT_SODIUM,
        });
        lights.push({ x: gx, y: gy - sp.ay + 3, radius: 74, color: '#FFC47A', intensity: 1 });
        break;
      }
      if (Math.abs(ny) < 0.3) {
        const pole = lampPole();
        const gx = Math.round(p.x + nx * (reach + 6));
        const gy = Math.round(p.y + ny * (reach + 6));
        if (field.edge[gy * W + gx]! <= 0 || !scene.spriteFits(pole, gx, gy)) continue;
        scene.place(pole, gx, gy);
        const dir = nx > 0 ? -1 : 1;
        const arm = lampArm(dir);
        scene.add({
          art: arm.art,
          x: gx - arm.ax,
          y: gy - pole.ay + 2 - arm.ay,
          baseY: gy,
          overlay: { id: `lamp_arm_${Math.round(s)}`, kind: 'lamp_arm', fade: true },
        });
        pools.push({
          x: p.x + nx * (p.halfWidth - 26),
          y: p.y + ny * (p.halfWidth - 26),
          radii: [40, 74],
          tint: TINT_SODIUM,
        });
        lights.push({
          x: gx + dir * LAMP_ARM,
          y: gy - pole.ay + 4,
          radius: 74,
          color: '#FFC47A',
          intensity: 1,
        });
        break;
      }
    }
  }
  const chevrons = placeCornerSigns(ctx, scene, layout);
  startBanner(ctx, scene, out);

  // --- Light and stand the scene ----------------------------------------------------------------
  scene.resolve();
  const shadow = castShadows(field.w, field.h, scene.shadowH, 12, scene.forced);
  for (let p = 0; p < field.w * field.h; p++) {
    if (scene.drive[p]) {
      if (shadow[p]) shadow[p] = 3;
      else if (scene.shade[p]! > 0) shadow[p] = 2;
    } else if (scene.shade[p]! > 0) shadow[p] = 1;
  }
  applyShadows(world, shadow, [shadeNight, shadeRoad, shadeRoadDeep]);
  const planes = accumulatePools(field.w, field.h, pools);
  applyLight(world, planes, litWorks);
  const flat = world.data.slice();
  scene.paint(world, planes, litWorks);
  let covered = 0;
  for (let p = 0; p < field.w * field.h; p++) {
    if (field.edge[p]! > 0 || !scene.drive[p]) continue;
    const i = p * 4;
    if (
      world.data[i] !== flat[i] ||
      world.data[i + 1] !== flat[i + 1] ||
      world.data[i + 2] !== flat[i + 2]
    ) {
      if (covered < 200 && covered % 10 === 0)
        console.log(`  covered  ${p % W},${Math.floor(p / W)}`);
      covered++;
    }
  }
  const overlays = scene.overlays();

  // Beacons baked dark red, so the loops can blink them.
  world.curFlags = F_EMISSIVE;
  for (const b of beacons) world.set(b.x, b.y, 0x7a2634);
  world.curFlags = 0;

  const fresh: AnimatedArt[] = [];
  if (rain) {
    // Inside the halls the floor stays dry.
    const dry = new Uint8Array(W * H);
    for (const z of zones)
      for (const r of z.rects)
        for (let y = Math.max(0, r.y); y < Math.min(H, r.y + r.h); y++)
          for (let x = Math.max(0, r.x); x < Math.min(W, r.x + r.w); x++) dry[y * W + x] = 1;
    const wet = wetPass({
      world,
      field,
      drive: scene.drive,
      raised: scene.raised,
      lights,
      seed: presetSeed,
      style: WET_FACTORY,
      dry,
    });
    wetOverlays(WET_FACTORY, overlays);
    console.log(
      `  wet      ${wet.puddlePixels} px of puddles, ${wet.reflectedPixels} px of reflections`,
    );
  }

  // --- Loops ---------------------------------------------------------------------------------
  const animated: AnimatedArt[] = [];
  vents.forEach((v, k) => {
    animated.push(ventRingLoop(ctx, world, v, k));
    animated.push(steamLoop(v, k));
  });
  lampSpots.forEach((at, k) => {
    // Each lamp warns of the vent nearest it.
    const v = vents.reduce((a, b) =>
      a.shape.type === 'circle' &&
      b.shape.type === 'circle' &&
      Math.hypot(a.shape.x - at.x, a.shape.y - at.y) <=
        Math.hypot(b.shape.x - at.x, b.shape.y - at.y)
        ? a
        : b,
    );
    animated.push(lampLoop(world, v, at, k));
  });
  hazards.forEach((h, k) => {
    if (h.kind === 'magnetic_strip') {
      const l = magnetLoop(ctx, world, k);
      if (l) animated.push(l);
    } else if (h.kind === 'oil') {
      const l = oilLoop(ctx, world, k);
      if (l) animated.push(l);
    }
  });
  beacons.forEach((b, k) => animated.push(beaconLoop(world, `stack_beacon_${k + 1}`, b, k * 2)));
  animated.push(furnaceLoop(world, mouth));
  presses.forEach((p, k) => animated.push(pistonLoop(world, p, k)));
  animated.push(
    sparksLoop(
      world,
      clearOf(
        ctx,
        anchorPt(ctx, 'welding_sparks').x,
        anchorPt(ctx, 'welding_sparks').y,
        0,
        -1,
        BARRIER_REACH + 10,
      ),
    ),
  );
  animated.push(conveyorLoop(world, dock.conveyor));
  // The crane's warning light, on its overlay.
  fresh.push({
    id: 'crane_light',
    kind: 'crane_light',
    frames: [0, 1, 2, 3].map((f) => {
      const cv = new Canvas(3, 3);
      cv.setA(1, 1, f < 2 ? PAL.amber : 0x6a4a20, 255);
      if (f === 0)
        for (const [dx, dy] of [
          [0, 1],
          [2, 1],
          [1, 0],
          [1, 2],
        ] as const)
          cv.setA(dx, dy, PAL.amber, 140);
      return cv;
    }),
    x: craneLight.x - 1,
    y: craneLight.y - 1,
    fps: 3,
    above: true,
    blend: 'normal',
  });
  if (rain) wetLoops(WET_FACTORY, world, fresh);
  animated.push(...fresh);

  const schedules = new Map<string, HazardSchedule>();
  for (const h of hazards) if ('schedule' in h) schedules.set(h.id, h.schedule);
  const checks = {
    coveredDrivable: Math.max(covered, scene.violations()),
    animatedMismatch: loopMismatch(world, animated, schedules),
  };
  console.log(`  scene    ${chevrons} chevron boards, ${trusses} trusses, ${machines} machines`);

  const v0 = vents[0]?.shape.type === 'circle' ? vents[0].shape : { x: 0, y: 0 };
  const startP = sampleBranch(m, track.startS);
  return {
    overlays,
    animated,
    lights,
    checks,
    previewSpots: [
      { name: 'start_line', x: Math.round(startP.x), y: Math.round(startP.y) },
      ...(pressBox
        ? [
            {
              name: 'press_hall',
              x: pressBox.x + (pressBox.w >> 1),
              y: pressBox.y + (pressBox.h >> 1),
            },
          ]
        : []),
      { name: 'smelter_vents', x: Math.round(v0.x), y: Math.round(v0.y) },
      { name: 'smelter_oil', x: 1660, y: 1440 },
      { name: 'conveyor_gap', x: 1850, y: 720 },
      { name: 'dock', x: quayX + 60, y: 1000 },
      { name: 'crane_yard', x: ga.x, y: ga.y },
      { name: 'water_tower', x: wtAt.x + 80, y: wtAt.y },
    ],
    previewPlain: ['press_hall', 'conveyor_gap'],
    previewCars: [],
  };
}

export const INDUSTRIAL_BIOME: BiomeModule = {
  biome: 'industrial',
  paint: paintIndustrial,
  presets: ['industrial_dry_night', 'industrial_factory_rain'],
};

void TINT_MERCURY;
