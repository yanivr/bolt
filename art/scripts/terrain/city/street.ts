import { hash2, sampleBranch } from '@bolt/shared';
import type { TerrainLight } from '@bolt/shared';
import type { BakeContext } from '../biome.js';
import type { Canvas, Color } from '../canvas.js';
import { stencil } from '../canvas.js';
import { ZONE_SHOULDER } from '../field.js';
import type { LightPool } from '../lighting.js';
import type { CityLayout } from './layout.js';
import { NEON } from './neon.js';
import { PAL, TINT_CORAL, TINT_GOLD, TINT_HEX, TINT_WARM, contactShade } from './palette.js';
import type { RoadPlan } from './road.js';
import { emissive, lampHead, tree } from './sprites.js';

/**
 * Street furniture on the drivable sidewalk. Nothing here is solid: props are small, sit
 * against the building line and leave the kerb side clear, so the sidewalk reads as walkable.
 */

export type StreetOutput = { pools: LightPool[]; lights: TerrainLight[] };

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

const BOLLARD = stencil([
  '..ooooo..',
  '.oghhggo.',
  'oghhgggdo',
  'oghgggddo',
  'ogggccddo',
  'oggcccddo',
  'ogddddddo',
  '.oddddoo.',
  '..ooooo..',
]);

const HYDRANT = stencil(['.rr.', 'rhrd', 'rrdd', '.dd.']);
const BIN = stencil(['smms', 'mlmd', 'mmdd', 'sdds']);

export const LAMP_SPACING = 172;
export const LAMP_RADII: readonly number[] = [27, 52, 78];

export function paintStreet(ctx: BakeContext, layout: CityLayout, plan: RoadPlan, out: StreetOutput): void {
  const { world, field, track } = ctx;
  const main = track.main;
  const L = main.length;
  const w = field.w;
  world.curFlags = 0;
  world.curHeight = -1;

  const frame = (s: number): { x: number; y: number; tx: number; ty: number; nx: number; ny: number; hw: number; sh: number } => {
    const p = sampleBranch(main, s);
    return { x: p.x, y: p.y, tx: p.tx, ty: p.ty, nx: -p.ty, ny: p.tx, hw: p.halfWidth, sh: p.shoulder };
  };
  const zoneAt = (x: number, y: number): number => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= w || yi >= field.h) return -1;
    const i = yi * w + xi;
    return field.branch[i] === 0 ? field.zone[i]! : -1;
  };
  const roofBehind = (f: ReturnType<typeof frame>, side: number): boolean => {
    const x = Math.round(f.x + f.nx * side * (f.hw + f.sh + 11));
    const y = Math.round(f.y + f.ny * side * (f.hw + f.sh + 11));
    if (x < 0 || y < 0 || x >= w || y >= field.h) return false;
    return layout.roofId[y * w + x] !== 0;
  };
  const nearAny = (s: number, list: readonly number[], r: number): boolean =>
    list.some((t) => {
      const d = Math.abs(s - t);
      return Math.min(d, L - d) < r;
    });

  // --- Street lamps: alternate sides, steady rhythm ---------------------------------------
  const lampCount = Math.round(L / LAMP_SPACING);
  const lampStep = L / lampCount;
  const lampS: Array<{ s: number; side: number }> = [];
  for (let k = 0; k < lampCount; k++) {
    const s = (track.startS + lampStep * 0.5 + k * lampStep) % L;
    let side = k % 2 === 0 ? -1 : 1;
    // The grid has its own floodlights.
    if (Math.min(Math.abs(s - track.startS), L - Math.abs(s - track.startS)) < 150) continue;
    let f = frame(s);
    let bx = f.x + f.nx * side * (f.hw + f.sh - 4);
    let by = f.y + f.ny * side * (f.hw + f.sh - 4);
    if (zoneAt(bx, by) !== ZONE_SHOULDER) {
      side = -side;
      f = frame(s);
      bx = f.x + f.nx * side * (f.hw + f.sh - 4);
      by = f.y + f.ny * side * (f.hw + f.sh - 4);
      if (zoneAt(bx, by) !== ZONE_SHOULDER) continue;
    }
    lampS.push({ s, side });
    const hx = Math.round(f.x + f.nx * side * (f.hw + 1));
    const hy = Math.round(f.y + f.ny * side * (f.hw + 1));
    const px = Math.round(bx);
    const py = Math.round(by);
    // Contact shadow, base plate, arm, head.
    world.map(px + 2, py + 2, contactShade);
    world.map(px + 1, py + 2, contactShade);
    world.map(px + 2, py + 1, contactShade);
    world.line(px, py, hx, hy, PAL.steelDark);
    world.rect(px - 1, py - 1, 3, 3, PAL.steelDark);
    world.set(px - 1, py - 1, PAL.steelLight);
    world.set(px, py, PAL.steel);
    lampHead(world, hx, hy);
    const cx = f.x + f.nx * side * (f.hw - 24);
    const cy = f.y + f.ny * side * (f.hw - 24);
    const scale = Math.min(1, f.hw / 80);
    out.pools.push({ x: cx, y: cy, radii: LAMP_RADII.map((r) => Math.round(r * scale)), tint: TINT_WARM, level: 0 });
    out.lights.push({ x: hx, y: hy, radius: LAMP_RADII[2]!, color: TINT_HEX[TINT_WARM]!, intensity: 1 });
  }

  // --- Furniture slots ---------------------------------------------------------------------
  const SLOT = 26;
  const slots = Math.floor(L / SLOT);
  for (let k = 0; k < slots; k++) {
    const s = k * SLOT + 9;
    for (const side of [-1, 1]) {
      const f = frame(s);
      const wallLat = f.hw + f.sh;
      const at = (lat: number, du = 0): [number, number] => [
        Math.round(f.x + f.tx * du + f.nx * side * lat),
        Math.round(f.y + f.ty * du + f.ny * side * lat),
      ];
      const [ax, ay] = at(wallLat - 5);
      if (zoneAt(ax, ay) !== ZONE_SHOULDER) continue;
      if (lampS.some((l) => l.side === side && Math.min(Math.abs(l.s - s), L - Math.abs(l.s - s)) < 14)) continue;
      if (nearAny(s, plan.zebras, 34)) continue;
      const roll = hash2(k, side + 3, 4401);
      const axis = Math.abs(f.tx) > 0.94 || Math.abs(f.ty) > 0.94;
      const horizontalRoad = Math.abs(f.tx) > Math.abs(f.ty);
      const building = roofBehind(f, side);
      if (roll < 0.13) {
        // Tree pit with a small round street tree.
        const [tx, ty] = at(wallLat - 7);
        world.rect(tx - 3, ty - 3, 7, 7, PAL.walkGrout);
        world.rect(tx - 2, ty - 2, 5, 5, PAL.soil);
        tree(world, tx, ty, 4, k * 7 + side, hash2(k, side, 4402) < 0.3);
      } else if (roll < 0.19) {
        const [bx, by] = at(wallLat - 4);
        world.map(bx + 2, by + 3, contactShade);
        world.map(bx + 3, by + 2, contactShade);
        world.stamp(bx - 2, by - 2, BIN, { s: PAL.steelDark, m: PAL.mintDim, l: PAL.mint, d: PAL.leafDeep });
      } else if (roll < 0.24) {
        const [hx, hy] = at(4.5);
        const [kx, ky] = at(f.hw + 5);
        void hx;
        void hy;
        world.map(kx + 2, ky + 2, contactShade);
        world.stamp(kx - 2, ky - 2, HYDRANT, { r: PAL.coral, h: PAL.coralHi, d: PAL.coralDim });
      } else if (roll < 0.31 && axis) {
        // Bench against the wall.
        const [bx, by] = at(wallLat - 4, -4);
        if (horizontalRoad) {
          world.rect(bx, by - 1, 9, 3, PAL.wood);
          world.hline(bx, by - 1, 9, PAL.woodLight);
          world.hline(bx + 1, by + 2, 8, PAL.walkShade);
        } else {
          world.rect(bx - 1, by, 3, 9, PAL.wood);
          world.vline(bx - 1, by, 9, PAL.woodLight);
          world.vline(bx + 2, by + 1, 8, PAL.walkShade);
        }
      } else if (roll < 0.345 && axis) {
        // Newspaper boxes in a row.
        const colors = [PAL.cyanDim, PAL.coral, PAL.goldDim];
        for (let j = 0; j < 3; j++) {
          const [bx, by] = at(wallLat - 4, j * 4 - 4);
          world.rect(bx - 1, by - 1, 3, 3, colors[j]!);
          world.set(bx - 1, by - 1, j === 0 ? PAL.cyan : j === 1 ? PAL.coralHi : PAL.gold);
          world.map(bx + 2, by + 2, contactShade);
        }
      } else if (roll < 0.375 && axis) {
        // Bus stop: glass shelter roof with a bench and a lit panel.
        const [ox, oy] = at(wallLat - 1, -11);
        orientedRect(world, ox, oy, f.tx, f.ty, -f.nx * side, -f.ny * side, 22, 7, (u, v) => {
          if (u === 0 || u === 21 || v === 0 || v === 6) return PAL.steelDark;
          if (u % 5 === 0) return PAL.steel;
          return v < 3 ? PAL.glass : (u + v) % 4 === 0 ? PAL.glassLight : PAL.glass;
        });
        const [lx, ly] = at(wallLat - 4, 13);
        emissive(world, () => {
          world.rect(lx - 1, ly - 1, 2, 3, PAL.cyan);
          world.set(lx - 1, ly - 1, PAL.cyanHi);
        });
        out.pools.push({ x: lx, y: ly, radii: [6, 11], tint: 1, level: 0 });
      } else if (roll < 0.47 && building && axis) {
        // Shop awning with a spill of light from the doorway, sometimes cafe tables.
        const style = (hash2(k, side, 4403) * 4) | 0;
        const stripeA = [PAL.kerbCoral, PAL.cyanDim, PAL.mintDim, PAL.purpleDim][style]!;
        const stripeB = [PAL.kerbIvory, PAL.kerbIvory, PAL.kerbIvory, PAL.kerbIvoryDark][style]!;
        const [ox, oy] = at(wallLat + 1, -10);
        orientedRect(world, ox, oy, f.tx, f.ty, -f.nx * side, -f.ny * side, 20, 6, (u, v) => {
          if (v === 5) return (u & 3) === 3 ? null : PAL.wallBase;
          return (Math.floor(u / 3) & 1) === 0 ? stripeA : stripeB;
        });
        const tint = [TINT_WARM, 1, TINT_GOLD, 3][style]!;
        const [dx, dy] = at(wallLat - 1);
        out.pools.push({ x: dx, y: dy, radii: [8, 14], tint, level: 0 });
        out.lights.push({ x: dx, y: dy, radius: 14, color: TINT_HEX[tint]!, intensity: 0.4 });
        if (hash2(k, side, 4404) < 0.6) {
          for (const du of [-15, 15]) {
            const [tx, ty] = at(wallLat - 6, du);
            if (zoneAt(tx, ty) !== ZONE_SHOULDER) continue;
            world.map(tx + 2, ty + 2, contactShade);
            world.rect(tx - 1, ty - 1, 3, 3, PAL.kerbIvoryDark);
            world.set(tx - 1, ty - 1, PAL.ivory);
            world.set(tx - 2, ty, PAL.coralDim);
            world.set(tx + 2, ty, PAL.coralDim);
          }
        }
      } else if (roll < 0.52) {
        // Planter box.
        const [bx, by] = at(wallLat - 4);
        world.rect(bx - 2, by - 2, 5, 5, PAL.kerbShade);
        world.rect(bx - 1, by - 1, 3, 3, PAL.leafDark);
        world.set(bx - 1, by - 1, PAL.leafLight);
        world.set(bx, by, PAL.leaf);
        world.map(bx + 3, by + 3, contactShade);
      } else if ((roll < 0.62 || (roll < 0.47 && !axis)) && roll >= 0.375 && building) {
        // Lit doorway or shop window: neon and warm spill on the sidewalk.
        const pick = hash2(k, side, 4405);
        const tint = pick < 0.55 ? TINT_WARM : pick < 0.7 ? 1 : pick < 0.85 ? TINT_CORAL : 3;
        const [dx, dy] = at(wallLat);
        const [gx, gy] = at(wallLat + 1);
        const glow = tint === TINT_WARM ? PAL.windowWarm : NEON[tint - 1]!.c;
        emissive(world, () => {
          orientedRect(world, gx - f.tx * 4, gy - f.ty * 4, f.tx, f.ty, f.nx * side, f.ny * side, 8, 1.5, () => glow);
        });
        out.pools.push({ x: dx, y: dy, radii: [7, 13], tint, level: 0 });
        out.lights.push({ x: dx, y: dy, radius: 13, color: TINT_HEX[tint]!, intensity: 0.4 });
      }
    }
  }

  // --- Zebra dressing: tactile paving and the signal pole ---------------------------------
  for (const z of plan.zebras) {
    for (const side of [-1, 1]) {
      const f = frame(z + 11);
      const ox = f.x - f.tx * 11 + f.nx * side * (f.hw + 4);
      const oy = f.y - f.ty * 11 + f.ny * side * (f.hw + 4);
      orientedRect(world, ox, oy, f.tx, f.ty, f.nx * side, f.ny * side, 22, f.sh - 6, (u, v) => ((u + v) & 1) === 0 ? PAL.paintGoldWorn : PAL.walkShade);
    }
  }

  // --- Shortcut dressing: bollards, lantern glow on the lane -------------------------------
  for (const ob of track.obstacles) {
    const x = Math.round(ob.x);
    const y = Math.round(ob.y);
    world.mapDisc(x + 2, y + 2, 4, contactShade);
    world.curHeight = 2;
    world.stamp(x - 4, y - 4, BOLLARD, { o: PAL.ink, g: PAL.gold, h: PAL.goldHi, d: PAL.goldDim, c: PAL.coral });
    world.curHeight = -1;
  }
  for (const branch of track.branches) {
    if (branch.index === 0) continue;
    let n = 0;
    for (let s = 56; s < branch.length - 40; s += 30) {
      const p = sampleBranch(branch, s);
      const tint = n++ % 2 === 0 ? TINT_GOLD : TINT_CORAL;
      out.pools.push({ x: p.x, y: p.y, radii: [13, 24, 34], tint, level: 0 });
      out.lights.push({ x: Math.round(p.x), y: Math.round(p.y), radius: 34, color: TINT_HEX[tint]!, intensity: 0.8 });
    }
  }
}
