import { hash2, sampleBranch } from '@bolt/shared';
import type { BakeContext } from '../biome.js';
import { Canvas } from '../canvas.js';
import type { Color } from '../canvas.js';
import { ZONE_SHOULDER } from '../field.js';
import type { Scene, Sprite } from '../oblique.js';
import type { CityLayout } from './layout.js';
import { G_YARD } from './layout.js';
import { LIVERIES, PAL, TINT_CORAL, TINT_GOLD, TINT_HEX, TINT_WARM } from './palette.js';
import { parkCar, plantTree, standLantern } from './props.js';
import type { LightOut } from './props.js';
import { BARRIER_REACH } from './road.js';
import type { RoadPlan } from './road.js';
import {
  LAMP_ARM,
  benchSprite,
  binSprite,
  bollardSprite,
  busShelter,
  coneSprite,
  crateStack,
  dumpsterSprite,
  hydrantSprite,
  lampArm,
  lampPole,
  lampTwin,
  newsBoxes,
  planterSprite,
  treeSprite,
} from './sprites.js';

/**
 * Street furniture. The sidewalk is drivable, so nothing may stand on it: lamps, trees and
 * everything else stand behind the collision edge. On the far bank of a road that is right
 * behind the barrier; on the near bank it is as far back as the thing is tall, so that it never
 * leans over the road. Lamp arms that reach over the kerb go to fading overlays.
 */

/** Fills a rectangle laid along an arbitrary direction, without holes. */
export function orientedRect(
  cv: Canvas,
  ox: number,
  oy: number,
  ux: number,
  uy: number,
  vx: number,
  vy: number,
  len: number,
  depth: number,
  colorAt: (u: number, v: number) => Color | null,
): void {
  for (let u = 0; u < len; u += 0.5) {
    for (let v = 0; v < depth; v += 0.5) {
      const c = colorAt(Math.floor(u), Math.floor(v));
      if (c === null) continue;
      cv.set(Math.round(ox + ux * u + vx * v - 0.5), Math.round(oy + uy * u + vy * v - 0.5), c);
    }
  }
}

export const LAMP_SPACING = 172;
export const LAMP_RADII: readonly number[] = [40, 74];

/**
 * Street furniture choices a track other than Neon Cut can make. Defaults are Neon Cut's.
 */
export type StreetOptions = {
  /** Draws the track's obstacles; by default each is a gold alley bollard. */
  obstacles?: (scene: Scene) => void;
  /** Tints of the lantern pools laid along each shortcut, alternating; [] for none. */
  alleyTints?: readonly number[];
  /** Arc-length ranges of the main line with no lamps (the track lights them itself). */
  noLamps?: ReadonlyArray<readonly [number, number]>;
};

export function paintStreet(
  ctx: BakeContext,
  scene: Scene,
  layout: CityLayout,
  plan: RoadPlan,
  out: LightOut,
  opts: StreetOptions = {},
): void {
  const { world, field, track } = ctx;
  const main = track.main;
  const L = main.length;
  const w = field.w;
  const h = field.h;
  world.curFlags = 0;

  type Frame = {
    x: number;
    y: number;
    tx: number;
    ty: number;
    /** Outward normal on the chosen side. */
    nx: number;
    ny: number;
    hw: number;
    sh: number;
  };
  const frame = (s: number, side: number): Frame => {
    const p = sampleBranch(main, s);
    return {
      x: p.x,
      y: p.y,
      tx: p.tx,
      ty: p.ty,
      nx: -p.ty * side,
      ny: p.tx * side,
      hw: p.halfWidth,
      sh: p.shoulder,
    };
  };
  const solid = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < h && scene.drive[y * w + x] === 0;
  /** First non-drivable pixel walking outward from the edge point of a frame. */
  const edgePoint = (f: Frame): { x: number; y: number } | null => {
    for (let k = -2; k < 12; k++) {
      const x = Math.round(f.x + f.nx * (f.hw + f.sh + k));
      const y = Math.round(f.y + f.ny * (f.hw + f.sh + k));
      if (solid(x, y) && field.edge[y * w + x]! > 0) return { x, y };
    }
    return null;
  };
  const nearAny = (s: number, list: readonly number[], r: number): boolean =>
    list.some((t) => {
      const d = Math.abs(s - t);
      return Math.min(d, L - d) < r;
    });
  const occ = new Uint8Array(w * h);
  const claim = (x: number, y: number, fw: number, fd: number): void => {
    for (let yy = y - fd - 2; yy <= y + 2; yy++)
      for (let xx = x - (fw >> 1) - 2; xx <= x + (fw >> 1) + 2; xx++)
        if (xx >= 0 && yy >= 0 && xx < w && yy < h) occ[yy * w + xx] = 1;
  };
  /** Open ground for a foot `fw` wide and `fd` deep whose south-center is (x, y). */
  const openFoot = (x: number, y: number, fw: number, fd: number, kindOnly = 0): boolean => {
    for (let yy = y - fd + 1; yy <= y; yy += Math.max(1, fd - 1)) {
      for (let xx = x - (fw >> 1); xx <= x + (fw >> 1); xx += Math.max(1, fw >> 1)) {
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) return false;
        const i = yy * w + xx;
        if (field.edge[i]! <= BARRIER_REACH || layout.roofId[i] !== 0 || occ[i]) return false;
        if (kindOnly && layout.ground[i] !== kindOnly) return false;
      }
    }
    return true;
  };
  /** The sprite must not sit on top of the barrier's picture either. */
  const clearOfBarrier = (sp: Sprite, x: number, y: number): boolean => {
    for (const [px, py] of [
      [x - sp.ax, y - sp.ay],
      [x - sp.ax + sp.art.w - 1, y - sp.ay],
      [x, y - sp.ay],
    ] as const) {
      if (px < 0 || py < 0 || px >= w || py >= h) return false;
      if (field.edge[py * w + px]! <= BARRIER_REACH) return false;
    }
    return true;
  };
  const put = (
    sp: Sprite,
    x: number,
    y: number,
    fw: number,
    fd: number,
    shadow: number,
  ): boolean => {
    if (!openFoot(x, y, fw, fd)) return false;
    if (!clearOfBarrier(sp, x, y) || !scene.spriteFits(sp, x, y)) return false;
    scene.place(sp, x, y);
    scene.footprint(x - (fw >> 1), y - fd + 1, fw, fd, shadow);
    claim(x, y, fw, fd);
    return true;
  };

  // --- Street lamps: alternate sides, steady rhythm ---------------------------------------
  const lampCount = Math.round(L / LAMP_SPACING);
  const lampStep = L / lampCount;
  let armCount = 0;
  let treeCount = 0;
  for (let k = 0; k < lampCount; k++) {
    const s = (track.startS + lampStep * 0.5 + k * lampStep) % L;
    // The grid has its own floodlights.
    if (Math.min(Math.abs(s - track.startS), L - Math.abs(s - track.startS)) < 150) continue;
    if (opts.noLamps?.some(([a, b]) => s >= a && s <= b)) continue;
    let done = false;
    for (const side of k % 2 === 0 ? [-1, 1] : [1, -1]) {
      if (done) break;
      const f = frame(s, side);
      const e = edgePoint(f);
      if (!e) continue;
      // Where the light lands: on the road, a little in from the kerb.
      const cx = f.x + f.nx * (f.hw - 26);
      const cy = f.y + f.ny * (f.hw - 26);
      let hx = e.x;
      let hy = e.y;
      if (f.ny < -0.7) {
        // Far bank: a twin lamp right on the edge, in front of whatever stands there.
        const sp = lampTwin();
        let y = e.y;
        while (y > e.y - 6 && !scene.spriteFits(sp, e.x, y)) y--;
        if (!scene.spriteFits(sp, e.x, y)) continue;
        scene.add({ art: sp.art, x: e.x - sp.ax, y: y - sp.ay, baseY: y + 4 });
        scene.footprint(e.x - 1, y - 1, 3, 2, 5);
        hy = y - sp.ay + 4;
      } else if (f.ny > 0.7) {
        // Near bank: a short lantern, stepped back so it never leans over the road.
        const y = e.y + BARRIER_REACH + 15;
        if (!openFoot(e.x, y, 3, 2)) continue;
        if (!standLantern(scene, out, e.x, y, TINT_WARM, [10, 18])) continue;
        claim(e.x, y, 5, 3);
        hy = y - 10;
      } else {
        // Beside a north-south road: a pole behind the barrier, arm out over the kerb.
        const dir = f.nx > 0 ? -1 : 1;
        const px = Math.round(e.x + f.nx * 4);
        const py = Math.round(e.y + f.ny * 4);
        const pole = lampPole();
        if (!solid(px, py) || !scene.spriteFits(pole, px, py)) continue;
        if (layout.roofId[py * w + px] !== 0) continue;
        scene.place(pole, px, py);
        scene.footprint(px - 1, py - 1, 3, 2, 5);
        claim(px, py, 5, 3);
        const arm = lampArm(dir);
        const ax = px;
        const ay = py - pole.ay + 2;
        if (scene.spriteFits(arm, ax, ay))
          scene.add({ art: arm.art, x: ax - arm.ax, y: ay - arm.ay, baseY: py });
        else {
          scene.add({
            art: arm.art,
            x: ax - arm.ax,
            y: ay - arm.ay,
            baseY: py,
            overlay: {
              id: `lamp_arm_${String(armCount++).padStart(2, '0')}`,
              kind: 'lamp_arm',
              fade: true,
            },
          });
        }
        hx = px + dir * LAMP_ARM;
        hy = ay + 2;
      }
      const scale = Math.min(1, f.hw / 80);
      out.pools.push({
        x: cx,
        y: cy,
        radii: LAMP_RADII.map((r) => Math.round(r * scale)),
        tint: TINT_WARM,
      });
      out.lights.push({
        x: hx,
        y: hy,
        radius: LAMP_RADII[1]!,
        color: TINT_HEX[TINT_WARM]!,
        intensity: 1,
      });
      done = true;
    }
  }

  // --- Furniture and planting behind the barrier -------------------------------------------
  const SLOT = 24;
  const slots = Math.floor(L / SLOT);
  for (let k = 0; k < slots; k++) {
    const s = k * SLOT + 9;
    for (const side of [-1, 1]) {
      const f = frame(s, side);
      const e = edgePoint(f);
      if (!e) continue;
      if (nearAny(s, plan.zebras, 30)) continue;
      const roll = hash2(k, side + 3, 4401);
      const pick = hash2(k, side + 5, 4402);
      const seed = k * 7 + side + 11;
      const near = f.ny > 0.45;
      // How far behind the edge the foot of a sprite of this height must stand.
      const back = (sp: Sprite, extra = 0): { x: number; y: number } => {
        const dist = BARRIER_REACH + 3 + extra + (near ? sp.art.h * f.ny : 0);
        return { x: Math.round(e.x + f.nx * dist), y: Math.round(e.y + f.ny * dist) };
      };
      if (roll >= 0.9 && near && f.ny > 0.8) {
        // A street tree right behind the near barrier. Its crown leans over the sidewalk, so
        // whatever of it reaches the road becomes an overlay of its own that fades.
        const r = 6 + ((pick * 3) | 0);
        const x = Math.round(e.x);
        const y = Math.round(e.y + BARRIER_REACH + 5);
        if (!openFoot(x, y, 3, 2)) continue;
        const sp = treeSprite(r, seed, pick < 0.4);
        const sx = x - sp.ax;
        const sy = y - sp.ay;
        // The crown is the canopy disc; the trunk under it stays on the ground.
        const crownRows = 2 * r + 2;
        const crown = Canvas.sprite(sp.art.w, crownRows);
        crown.buf.copyFrom(sp.art.buf, 0, 0, sp.art.w, crownRows, 0, 0);
        const trunk = Canvas.sprite(sp.art.w, sp.art.h - crownRows);
        trunk.buf.copyFrom(sp.art.buf, 0, crownRows, sp.art.w, sp.art.h - crownRows, 0, 0);
        if (!scene.artFits(trunk, sx, sy + crownRows)) continue;
        scene.add({ art: trunk, x: sx, y: sy + crownRows, baseY: y });
        if (scene.artFits(crown, sx, sy)) scene.add({ art: crown, x: sx, y: sy, baseY: y });
        else {
          scene.add({
            art: crown,
            x: sx,
            y: sy,
            baseY: y,
            overlay: {
              id: `street_tree_${String(treeCount++).padStart(2, '0')}`,
              kind: 'tree_canopy',
              fade: true,
            },
          });
        }
        scene.shadeDisc(x + 3, y + 1, r * 0.85, 1.7);
        claim(x, y, 7, 3);
      } else if (roll < 0.3) {
        // Trees are the commonest thing: a row of them softens the wall line.
        const r = 4 + ((pick * 4) | 0);
        const reach = BARRIER_REACH + 4 + (near ? (2 * r + 6) * f.ny : 0) + pick * 10;
        const x = Math.round(e.x + f.nx * reach);
        const y = Math.round(e.y + f.ny * reach);
        if (!openFoot(x, y, 3, 2)) continue;
        if (y - 2 * r - 6 >= 0 && field.edge[(y - 2 * r - 6) * w + x]! <= BARRIER_REACH && near)
          continue;
        if (plantTree(scene, x, y, r, seed, pick < 0.3)) claim(x, y, 7, 3);
      } else if (roll < 0.37) {
        const sp = planterSprite(seed, 11 + ((pick * 3) | 0) * 2);
        const g = back(sp);
        put(sp, g.x, g.y, sp.art.w, 5, 2);
      } else if (roll < 0.42) {
        const sp = binSprite();
        const g = back(sp);
        put(sp, g.x, g.y, 4, 3, 2);
      } else if (roll < 0.46) {
        const sp = hydrantSprite();
        const g = back(sp);
        put(sp, g.x, g.y, 4, 3, 2);
      } else if (roll < 0.52) {
        const sp = benchSprite();
        const g = back(sp, 2);
        put(sp, g.x, g.y, 10, 4, 2);
      } else if (roll < 0.55) {
        const sp = newsBoxes();
        const g = back(sp);
        put(sp, g.x, g.y, 14, 4, 2);
      } else if (roll < 0.585) {
        const sp = busShelter();
        const g = back(sp, 2);
        if (put(sp, g.x, g.y, 28, 6, 4)) {
          out.pools.push({ x: g.x + 8, y: g.y + 3, radii: [8, 14], tint: 1 });
        }
      } else if (roll < 0.66) {
        // A row of bollards.
        for (let j = -1; j <= 1; j++) {
          const sp = bollardSprite();
          const g = back(sp);
          put(sp, Math.round(g.x + f.tx * j * 8), Math.round(g.y + f.ty * j * 8), 3, 2, 2);
        }
      } else if (roll < 0.72) {
        const sp = dumpsterSprite(LIVERIES[(pick * LIVERIES.length) | 0]!);
        const g = back(sp, 6);
        if (openFoot(g.x, g.y, 15, 6, G_YARD)) put(sp, g.x, g.y, 15, 6, 3);
      } else if (roll < 0.76) {
        const sp = crateStack(seed);
        const g = back(sp, 8);
        if (openFoot(g.x, g.y, 17, 6, G_YARD)) put(sp, g.x, g.y, 17, 6, 3);
      } else if (roll < 0.8) {
        const sp = coneSprite();
        for (let j = 0; j < 2; j++) {
          const g = back(sp, j * 3);
          put(sp, Math.round(g.x + f.tx * j * 6), Math.round(g.y + f.ty * j * 6), 3, 2, 1);
        }
      } else if (roll < 0.87) {
        // A car left behind the wall, parked along the road.
        const horizontal = Math.abs(f.tx) > Math.abs(f.ty);
        const dist = BARRIER_REACH + (horizontal ? 14 : 12) + (near ? 24 * f.ny : 0) + pick * 6;
        const cx = Math.round(e.x + f.nx * dist);
        const cy = Math.round(e.y + f.ny * dist);
        const gy = cy + (horizontal ? 8 : 16);
        const fw = horizontal ? 32 : 17;
        const fd = horizontal ? 17 : 32;
        if (!openFoot(cx, gy, fw, fd, G_YARD)) continue;
        if (
          parkCar(
            scene,
            cx,
            cy,
            horizontal,
            pick < 0.5,
            LIVERIES[((roll * 977) % LIVERIES.length) | 0]!,
          )
        )
          claim(cx, gy, fw, fd);
      }
    }
  }

  // --- Zebra dressing: tactile paving on the sidewalk -------------------------------------
  for (const z of plan.zebras) {
    for (const side of [-1, 1]) {
      const f = frame(z + 11, side);
      const ox = f.x - f.tx * 11 + f.nx * (f.hw + 4);
      const oy = f.y - f.ty * 11 + f.ny * (f.hw + 4);
      orientedRect(world, ox, oy, f.tx, f.ty, f.nx, f.ny, 22, f.sh - 6, (u, v) => {
        const x = Math.round(ox + f.tx * u + f.nx * v - 0.5);
        const y = Math.round(oy + f.ty * u + f.ny * v - 0.5);
        if (x < 0 || y < 0 || x >= w || y >= h || field.zone[y * w + x] !== ZONE_SHOULDER)
          return null;
        return ((u >> 1) + (v >> 1)) % 2 === 0 ? PAL.paintGoldWorn : PAL.walkShade;
      });
    }
  }

  // --- Shortcut dressing: the bollards that stand in the lane, lantern glow on the stones ---
  if (opts.obstacles) opts.obstacles(scene);
  else
    for (const ob of track.obstacles) {
      const x = Math.round(ob.x);
      const y = Math.round(ob.y);
      const sp = bollardSprite(true);
      scene.place(sp, x, y + 3);
      scene.shadeDisc(x + 2, y + 4, 3);
    }
  const alleyTints = opts.alleyTints ?? [TINT_GOLD, TINT_CORAL];
  for (const branch of track.branches) {
    if (branch.index === 0 || alleyTints.length === 0) continue;
    let n = 0;
    for (let s = 56; s < branch.length - 40; s += 30) {
      const p = sampleBranch(branch, s);
      const tint = alleyTints[n++ % alleyTints.length]!;
      out.pools.push({ x: p.x, y: p.y, radii: [16, 30], tint });
      out.lights.push({
        x: Math.round(p.x),
        y: Math.round(p.y),
        radius: 34,
        color: TINT_HEX[tint]!,
        intensity: 0.8,
      });
    }
  }
}
