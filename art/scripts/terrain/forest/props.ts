import { hash2, sampleBranch } from '@bolt/shared';
import type { TrackBranch } from '@bolt/shared';
import { Canvas, F_NOSHADOW } from '../canvas.js';
import type { Color } from '../canvas.js';
import { drawText, textWidth } from '../font.js';
import { TILT } from '../oblique.js';
import type { Env } from './env.js';
import { getc, put } from './env.js';
import { rng, vnoise } from './noise.js';
import { NAT, darken, lighten } from './palette.js';
import { overlayTag, standSprite } from './place.js';
import { Voxels, band, renderVoxels } from './voxel.js';
import type { VoxelSprite } from './voxel.js';

/**
 * Props for the nature biomes: stumps, rocks, reeds and log piles built as voxels or drawn
 * upright, plus the road furniture (start line, chevron boards, the shortcut's sign).
 */

const STEPS4 = [0.24, 0.45, 0.66, 0.84];

function tone(ramp: readonly Color[], v: number, shadowed: boolean, rim: boolean): Color {
  let k = band(shadowed ? v * 0.5 : v, STEPS4);
  if (rim) k = Math.min(k, 1);
  return ramp[Math.max(0, Math.min(ramp.length - 1, k))]!;
}

/** A cut stump on its collision disc: bark sides, pale growth rings on top, a little moss. */
export function stumpSprite(radius: number, seed: number, keyY: number, snow = 0): VoxelSprite {
  const next = rng(seed);
  const H = 7 + next() * 7;
  const r = radius - 0.5;
  const v = new Voxels(-radius - 3, -radius - 3, radius * 2 + 6, radius * 2 + 6, Math.ceil(H + 4));
  v.column(0, H, (z) => ({ x: 0, y: 0, r: r * (1 - (z / H) * 0.12) }), 2, (a, z) => (vnoise(a * 3, z, 1, seed) - 0.5) * 1.4);
  // A sloped saw cut.
  const tilt = (next() - 0.5) * 0.25;
  for (let z = Math.floor(H - 3); z < H + 3; z++)
    for (let y = -radius; y <= radius; y++)
      for (let x = -radius; x <= radius; x++) {
        const top = H + x * tilt;
        if (z > top) v.clear(x, y, z);
        else if (z > top - 1 && v.get(x, y, z) !== 0) v.put(x, y, z, 3, 0, 0, 1, Math.round(Math.hypot(x, y)));
      }
  const bark = NAT.barkOak;
  const ring = [NAT.woodDark, NAT.wood, NAT.woodLight, NAT.woodHi, NAT.woodPale];
  return renderVoxels(
    v,
    (s) => {
      if (s.mat === 3) {
        if (snow > 0.3) return s.tag < r - 1 ? 0xeef3fa : 0xc8d2e6;
        if (s.tag >= r - 1) return bark[1]!;
        const k = s.tag % 3 === 0 ? 1 : s.tag < 2 ? 2 : 3;
        return ring[s.shadowed ? k - 1 : k]!;
      }
      const moss = vnoise(s.x, s.z * 2, 3, seed + 3) > 0.7 && s.z < 5;
      if (moss) return tone([NAT.mossDeep, NAT.mossDark, NAT.moss, NAT.mossLight], 0.2 + s.lambert * 0.8, s.shadowed, s.rim);
      return tone(bark.slice(1), 0.15 + s.lambert * 0.85, s.shadowed, s.rim);
    },
    { keyY },
  );
}

/** A boulder: lumpy, lichen on top, dark underside. */
export function rockSprite(radius: number, seed: number, keyY: number, snow = 0): VoxelSprite {
  const next = rng(seed);
  const R = radius;
  const v = new Voxels(-R - 4, -R - 4, R * 2 + 8, R * 2 + 8, Math.ceil(R * 1.3 + 4));
  const lumps = 3 + ((next() * 3) | 0);
  for (let k = 0; k < lumps; k++) {
    const a = next() * Math.PI * 2;
    const d = R * 0.35 * next();
    const rr = R * (0.55 + next() * 0.3);
    v.ellipsoid(Math.cos(a) * d, Math.sin(a) * d, rr * 0.4, rr, rr, rr * 0.8, 1, {
      bump: (dx, dy, dz) => 0.9 + (vnoise(dx * 3 + k, dy * 3 + dz * 2, 1, seed) - 0.5) * 0.3,
    });
  }
  const stone = [NAT.stoneDeep, NAT.stoneDark, NAT.stone, NAT.stoneLight, NAT.stoneHi];
  return renderVoxels(
    v,
    (s) => {
      if (snow > 0 && s.nz > 0.6 - snow * 0.2) return s.shadowed ? 0xc0cce4 : 0xf0f4fa;
      if (s.nz > 0.65 && vnoise(s.x, s.y, 3, seed + 2) > 0.62) return s.shadowed ? NAT.mossDark : NAT.stoneMoss;
      return tone(stone, 0.18 + s.lambert * 0.82, s.shadowed, s.rim);
    },
    { keyY, creaseDepth: 2 },
  );
}

/** A tussock of reeds and rushes, a few cattails, standing on its base point. */
export function reedSprite(radius: number, seed: number, height = 22, sway = 0): Canvas {
  const next = rng(seed);
  const w = radius * 2 + 12;
  const H = Math.round(height * TILT) + 8;
  const cv = Canvas.sprite(w, H + 4);
  const bx = w >> 1;
  const by = H + 1;
  // Base clump.
  for (let yy = -3; yy <= 2; yy++)
    for (let xx = -radius; xx <= radius; xx++)
      if ((xx * xx) / (radius * radius) + (yy * yy) / 9 <= 1) cv.set(bx + xx, by + yy, yy < 0 ? NAT.reedDark : darken(NAT.reedDark, 0.3));
  const blades = 12 + ((next() * 10) | 0);
  for (let k = 0; k < blades; k++) {
    const fx = bx + Math.round((next() - 0.5) * radius * 1.6);
    const len = H * (0.55 + next() * 0.45);
    const bend = (next() - 0.35) * 6 + sway * (0.6 + next() * 0.8);
    const c = next() < 0.4 ? NAT.reedLight : next() < 0.5 ? NAT.reed : NAT.reedDark;
    for (let t = 0; t < len; t++) {
      const f = t / len;
      cv.set(Math.round(fx + bend * f * f), by - 1 - t, f > 0.85 ? lighten(c, 0.15) : c);
    }
    if (next() < 0.22) {
      const tx = Math.round(fx + bend);
      const ty = Math.round(by - len);
      cv.set(tx, ty, NAT.cattail);
      cv.set(tx, ty + 1, NAT.cattail);
      cv.set(tx, ty + 2, darken(NAT.cattail, 0.3));
      cv.set(tx, ty - 1, NAT.reedLight);
    }
  }
  return cv;
}

/** Stands reeds on (gx, gy). */
export function standReeds(env: Env, gx: number, gy: number, radius: number, seed: number, height = 22): void {
  const art = reedSprite(radius, seed, height);
  env.scene.addSplit(
    { art, x: gx - (art.w >> 1), y: gy - (art.h - 3), baseY: gy },
    overlayTag(env, gx, gy, 'reeds'),
  );
}

/** A stack of felled logs lying east-west, ends toward the camera, on a footprint. */
export function logPileSprite(length: number, rows: number, seed: number, keyY: number, alongX = true): VoxelSprite {
  const next = rng(seed);
  const r = 4.5;
  const width = rows * r * 2;
  const L = length;
  const vx = alongX ? L : width + 4;
  const vy = alongX ? width + 4 : L;
  const v = new Voxels(-vx / 2 - 2, -vy / 2 - 2, Math.ceil(vx + 4), Math.ceil(vy + 4), Math.ceil(rows * r * 1.8 + 6));
  let tier = 0;
  for (let n = rows; n > 0; n--, tier++) {
    for (let k = 0; k < n; k++) {
      const off = (k - (n - 1) / 2) * r * 2;
      const z = r + tier * r * 1.72;
      const jitter = (next() - 0.5) * 4;
      const rr = r * (0.85 + next() * 0.25);
      if (alongX) v.capsule(-L / 2 + jitter, off, z, L / 2 + jitter, off, z, rr, 2, (t) => (t < 0.02 || t > 0.98 ? 1 : 0));
      else v.capsule(off, -L / 2 + jitter, z, off, L / 2 + jitter, z, rr, 2, (t) => (t < 0.02 || t > 0.98 ? 1 : 0));
    }
  }
  const bark = NAT.barkOak;
  return renderVoxels(
    v,
    (s) => {
      // Cut ends are pale with rings; the bark is dark.
      const endOn = alongX ? Math.abs(s.nx) > 0.7 : Math.abs(s.ny) > 0.7;
      if (endOn) {
        const ring = Math.floor(Math.hypot(alongX ? s.ny * 4 : s.nx * 4, s.nz * 4)) % 2;
        return s.shadowed ? NAT.woodLight : ring ? NAT.woodPale : NAT.woodHi;
      }
      return tone(bark.slice(1), 0.12 + s.lambert * 0.9, s.shadowed, s.rim);
    },
    { keyY, creaseDepth: 2 },
  );
}

/** The checkered start line and the two grid boxes, flat on the road. */
export function paintStart(env: Env): void {
  const { ctx, world, maps } = env;
  const { track, field } = ctx;
  const main = track.main;
  const st = sampleBranch(main, track.startS);
  const flags = world.flags!;
  for (let y = Math.floor(st.y - 150); y < st.y + 150; y++)
    for (let x = Math.floor(st.x - 150); x < st.x + 150; x++) {
      if (x < 0 || y < 0 || x >= maps.w || y >= maps.h) continue;
      const i = y * maps.w + x;
      if (maps.kind[i] !== 1 || field.branch[i] !== 0) continue;
      let u = field.s[i]! - track.startS;
      if (u > main.length / 2) u -= main.length;
      if (u < -main.length / 2) u += main.length;
      const lat = field.lateral[i]!;
      const hw = field.half[i]!;
      if (Math.abs(lat) > hw - 4) continue;
      if (u >= -6 && u < 6) {
        const chk = (Math.floor((u + 60) / 6) + Math.floor((lat + 600) / 6)) & 1;
        put(world, i, chk ? NAT.ivory : NAT.ink);
        flags[i] = F_NOSHADOW;
        continue;
      }
      // Grid boxes 46 px behind the line, either side of the centre.
      const g = u + 46;
      for (const side of [-1, 1]) {
        const v = lat - side * hw * 0.42;
        if (Math.abs(v) < 21 && g > -30 && g < 33) {
          const edge = (g >= 30 && g < 33) || (Math.abs(v) >= 18.5 && g > -6);
          if (edge) {
            put(world, i, NAT.ivory);
            flags[i] = F_NOSHADOW;
          }
        }
      }
    }
}

/** Chevron board on two posts: red and white, arrows pointing the way the road turns. */
export function chevronBoard(dir: number, count: number): Canvas {
  const cw = 8;
  const w = count * cw + 2;
  const cv = Canvas.sprite(w, 18);
  cv.rect(0, 0, w, 10, NAT.ink);
  cv.rect(1, 1, w - 2, 8, NAT.red);
  for (let k = 0; k < count; k++)
    for (let j = 0; j < 8; j++) {
      const lean = j < 4 ? j : 7 - j;
      for (let t = 0; t < 2; t++) {
        const u = dir > 0 ? 1 + lean + t : cw - 2 - lean - t;
        cv.set(1 + k * cw + u, 1 + j, NAT.ivory);
      }
    }
  cv.hline(1, 1, w - 2, lighten(NAT.red, 0.3));
  for (const px of [2, w - 4]) {
    cv.vline(px, 10, 8, NAT.woodLight);
    cv.vline(px + 1, 10, 8, NAT.woodDark);
  }
  return cv;
}

/** A wooden sign with a name burnt into it, on two posts. */
export function nameBoard(text: string, color: Color = NAT.woodLight): Canvas {
  const tw = textWidth(text, 'micro', 1);
  const w = tw + 8;
  const cv = Canvas.sprite(w, 19);
  cv.rect(0, 0, w, 10, NAT.woodDark);
  cv.rect(1, 1, w - 2, 8, color);
  cv.hline(1, 1, w - 2, lighten(color, 0.25));
  cv.hline(1, 8, w - 2, darken(color, 0.2));
  drawText(cv, 4, 3, text, NAT.woodDeep, 'micro', 1);
  for (const px of [3, w - 5]) {
    cv.vline(px, 10, 9, NAT.woodLight);
    cv.vline(px + 1, 10, 9, NAT.woodDark);
  }
  return cv;
}

/**
 * Corner signs exactly where the runtime puts them (`track.cornerSigns`, on the outside edge),
 * as chevron boards: three chevrons for a hairpin, two for a braking bend, one to lift for.
 */
export function placeCornerSigns(env: Env): number {
  const { track } = env.ctx;
  let n = 0;
  for (const sign of track.cornerSigns) {
    const dir = sign.turn === 'right' ? 1 : -1;
    // The arrows point the way the road goes on screen.
    const br = track.branches[sign.branch]!;
    const ahead = sampleBranch(br, sign.bendS + 60);
    const sx = Math.abs(ahead.tx) > 0.3 ? Math.sign(ahead.tx) : dir;
    const art = chevronBoard(sx, sign.severity === 3 ? 3 : sign.severity === 2 ? 2 : 1);
    const gx = Math.round(sign.x);
    const gy = Math.round(sign.y);
    env.scene.addSplit(
      { art, x: gx - (art.w >> 1), y: gy - art.h + 1, baseY: gy },
      { id: `sign_${sign.id}`, kind: 'corner_sign', fade: true },
    );
    n++;
  }
  return n;
}

/** The shortcut's name board at its mouth, standing just off the verge on the outside. */
export function placeShortcutSign(env: Env, br: TrackBranch, text: string): void {
  const p = sampleBranch(br, 40);
  const out = p.halfWidth + p.shoulder + 26;
  for (const side of [-1, 1]) {
    const gx = Math.round(p.x - p.ty * out * side);
    const gy = Math.round(p.y + p.tx * out * side);
    const i = gy * env.maps.w + gx;
    if (env.maps.kind[i] !== 0) continue;
    const art = nameBoard(text);
    env.scene.addSplit(
      { art, x: gx - (art.w >> 1), y: gy - art.h + 1, baseY: gy },
      { id: `sign_${br.id}_${side < 0 ? 'l' : 'r'}`, kind: 'shortcut_sign', fade: true },
    );
    return;
  }
}

/** Paints the solid banks of a creek or pond: wet earth, stones, roots and moss. */
export function paintBanks(env: Env, kinds: readonly string[], seed: number): number {
  const { ctx, maps, world } = env;
  const ids = new Set<number>();
  ctx.def.walls.forEach((wl, k) => {
    if (kinds.includes(wl.kind)) ids.add(k + 1);
  });
  const { w, h } = maps;
  let n = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!maps.reach.solid[i] || !ids.has(maps.reach.solidId[i]!)) continue;
      const nearWater = maps.water[i - 1] || maps.water[i + 1] || maps.water[i - w] || maps.water[i + w];
      const hh = hash2(x >> 1, y >> 1, seed);
      const st = vnoise(x, y, 4, seed + 1);
      let c: Color = st > 0.68 ? (st > 0.8 ? NAT.stoneLight : NAT.stone) : hh < 0.4 ? NAT.soil : NAT.mossDark;
      if (st > 0.66 && st < 0.69) c = NAT.stoneDark;
      if (nearWater) c = NAT.soilDark;
      put(world, i, c);
      n++;
    }
  void getc;
  return n;
}

export { standSprite };
