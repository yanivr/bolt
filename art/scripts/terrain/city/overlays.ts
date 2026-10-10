import { sampleBranch } from '@bolt/shared';
import type { BakeContext } from '../biome.js';
import { Canvas, col, stencil } from '../canvas.js';
import type { Color, Stencil } from '../canvas.js';
import { drawText, textWidth } from '../font.js';
import { leanOf } from '../oblique.js';
import type { Scene } from '../oblique.js';
import { VIADUCT_HALF, VIADUCT_RISE, drawViaductDeck } from './landmarks.js';
import type { LandmarkSites } from './landmarks.js';
import { PAL } from './palette.js';

/**
 * Structures that reach over the road. They are drawn in the same oblique view as everything
 * else and handed to the scene as overlays, so they sit above the cars and fade when the local
 * car is under them. Whatever part of them stands on solid ground stays in the ground layer.
 */

const BOARD = col('#1B2540');
const BOARD_EDGE = col('#28344A');

function glowDot(cv: Canvas, x: number, y: number, core: Color, glow: Color): void {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const d = Math.abs(dx) + Math.abs(dy);
      if (d === 3) cv.halo(x + dx, y + dy, glow, 70);
      else if (d === 2) cv.halo(x + dx, y + dy, glow, 140);
    }
  }
  cv.setA(x - 1, y, glow, 255);
  cv.setA(x + 1, y, glow, 255);
  cv.setA(x, y - 1, glow, 255);
  cv.setA(x, y + 1, glow, 255);
  cv.setA(x, y, core, 255);
}

/** Lattice column `r` pixels tall whose foot is at (x, y). It leans east as it rises. */
function pylon(cv: Canvas, x: number, y: number, wide: number, r: number): void {
  for (let v = 0; v <= r; v++) {
    const px = x + leanOf(v);
    cv.set(px, y - v, PAL.steelHi);
    cv.set(px + wide - 1, y - v, PAL.steelDark);
    const m = v % ((wide - 2) * 2);
    const zig = m < wide - 2 ? m : (wide - 2) * 2 - m;
    cv.set(px + 1 + Math.min(wide - 3, zig), y - v, PAL.steel);
    if (v % 8 === 0) cv.hline(px, y - v, wide, PAL.steelLight);
  }
  cv.rect(x - 1, y - 1, wide + 2, 3, PAL.steelDark);
  cv.hline(x - 1, y - 1, wide + 2, PAL.steel);
}

const GANTRY_RISE = 46;
/** Depth of the box truss that carries the banner, and the width of its deck. */
const GANTRY_BEAM = 20;
const GANTRY_DECK = 24;
/** How far the feet of each portal stand out beyond the deck on either side. */
const GANTRY_SPLAY = 11;

/**
 * Start gantry. The road runs east-west here, so the span runs up the screen. It is a real
 * structure: a portal frame on each bank with splayed legs and a tie, a box truss between them
 * whose lit west side shows under the banner deck, and the start lights hung on its south end.
 */
function startGantry(ctx: BakeContext, scene: Scene, sites: LandmarkSites): void {
  const p = sampleBranch(ctx.track.main, ctx.track.startS);
  const lean = leanOf(GANTRY_RISE);
  const x = Math.round(sites.start.x) - 44 - GANTRY_SPLAY - lean + 1;
  const col0 = x + GANTRY_SPLAY + 10;
  // Feet: on the far bank right behind the edge, on the near bank a few pixels back.
  let yN = Math.round(p.y);
  while (yN > 0 && scene.drive[yN * scene.w + col0]) yN--;
  let yS = Math.round(p.y);
  while (yS < scene.h - 1 && scene.drive[yS * scene.w + col0]) yS++;
  yN -= 3;
  yS += 5;
  const W = GANTRY_SPLAY * 2 + GANTRY_DECK + lean + 3;
  const top = yN - GANTRY_RISE - 6;
  const H = yS + 4 - top;
  const cv = Canvas.sprite(W, H);
  const Y = (wy: number): number => wy - top;
  const bx = GANTRY_SPLAY;
  const under = GANTRY_RISE - GANTRY_BEAM;
  /** One leg of a portal: a box section from a foot on the ground up to the truss. */
  const leg = (footX: number, headX: number, gy: number, lit: boolean): void => {
    for (let v = 0; v <= under; v++) {
      const px = Math.round(footX + ((headX - footX) * v) / under) + leanOf(v);
      const band = Math.floor(v / 6) % 2 === 0;
      cv.set(px, Y(gy) - v, lit ? PAL.steelHi : PAL.steelLight);
      cv.set(px + 1, Y(gy) - v, band ? PAL.coral : PAL.ivory);
      cv.set(px + 2, Y(gy) - v, band ? PAL.coral : PAL.kerbIvory);
      cv.set(px + 3, Y(gy) - v, band ? PAL.coralDim : PAL.kerbIvoryDark);
      cv.set(px + 4, Y(gy) - v, PAL.steelDark);
    }
    // Footing block.
    cv.rect(footX - 2, Y(gy) - 2, 9, 4, PAL.kerbShade);
    cv.hline(footX - 2, Y(gy) - 2, 9, PAL.kerbHi);
    cv.hline(footX - 2, Y(gy) + 1, 9, PAL.ink);
  };
  const portal = (gy: number): void => {
    const westFoot = 1;
    const eastFoot = bx + GANTRY_DECK + GANTRY_SPLAY - 6;
    // Tie between the legs, a third of the way up.
    const tv = 14;
    const x0 = Math.round(westFoot + ((bx + 1 - westFoot) * tv) / under) + leanOf(tv);
    const x1 = Math.round(eastFoot + ((bx + GANTRY_DECK - 5 - eastFoot) * tv) / under) + leanOf(tv);
    cv.hline(x0, Y(gy) - tv, x1 - x0 + 3, PAL.steelLight);
    cv.hline(x0, Y(gy) - tv + 1, x1 - x0 + 3, PAL.steelDark);
    leg(westFoot, bx + 1, gy, true);
    leg(eastFoot, bx + GANTRY_DECK - 5, gy, false);
  };
  portal(yN);
  // Box truss: its west side faces the light and shows as a slanted strip under the deck,
  // bright chords top and bottom with lacing zigzagging between them.
  for (let v = under; v < GANTRY_RISE; v++) {
    const px = bx + leanOf(v);
    for (let gy = yN - 3; gy <= yS; gy++) {
      const along = gy - yN + 400;
      const k = v - under;
      let c: Color = PAL.inkSoft;
      if (v >= GANTRY_RISE - 3) c = PAL.steelHi;
      else if (k <= 2) c = PAL.steelLight;
      else {
        const m = (along + k) % 16;
        const n = (along - k + 160) % 16;
        if (m < 2 || n < 2) c = PAL.steel;
      }
      cv.set(px, Y(gy) - v, c);
      cv.set(px + 1, Y(gy) - v, c);
    }
  }
  // Deck with the banner on top.
  const dx = bx + lean;
  const d0 = Y(yN) - GANTRY_RISE - 3;
  const d1 = Y(yS) - GANTRY_RISE;
  cv.rect(dx, d0, GANTRY_DECK, d1 - d0, BOARD);
  cv.frame(dx, d0, GANTRY_DECK, d1 - d0, PAL.coral);
  cv.vline(dx, d0, d1 - d0, PAL.coralHi);
  cv.hline(dx, d0, GANTRY_DECK, PAL.coralHi);
  cv.vline(dx + GANTRY_DECK - 1, d0, d1 - d0, PAL.coralDim);
  for (const cy of [d0 + 3, d1 - 13]) {
    for (let yy = 0; yy < 10; yy++)
      for (let xx = 0; xx < 20; xx++)
        cv.set(dx + 2 + xx, cy + yy, (((xx / 5) | 0) + ((yy / 5) | 0)) & 1 ? PAL.ivory : PAL.ink);
  }
  const text = 'BOLT RIVALS';
  const tw = textWidth(text, 'chunky', 2);
  drawText(cv, dx + 5, d0 + ((d1 - d0 + tw) >> 1), text, PAL.ivory, 'chunky', 2, 1);
  // The east chord of the truss, in shade, along the far edge of the deck.
  for (let y = d0; y < d1; y++) {
    cv.set(dx + GANTRY_DECK, y, (y - d0) % 6 === 0 ? PAL.steelLight : PAL.steelDark);
    cv.set(dx + GANTRY_DECK + 1, y, PAL.ink);
  }
  // South end of the truss faces the camera: the start lights in their housing.
  for (let k = 0; k < GANTRY_BEAM; k++) {
    const v = GANTRY_RISE - 1 - k;
    const px = bx + leanOf(v);
    for (let i = 0; i < GANTRY_DECK + 2; i++) {
      let c: Color = PAL.ink;
      if (k === 0) c = PAL.coralDim;
      else if (i === 0) c = PAL.steelLight;
      else if (k === GANTRY_BEAM - 1) c = PAL.inkSoft;
      cv.set(px + i, d1 + k, c);
    }
  }
  for (let row = 0; row < 2; row++) {
    const ly = d1 + 4 + row * 7;
    const lx0 = bx + leanOf(GANTRY_RISE - 7 - row * 7) + 3;
    for (let k = 0; k < 5; k++) {
      const lx = lx0 + k * 4;
      cv.rect(lx, ly, 3, 4, row === 0 ? PAL.mintDim : PAL.redDim);
      if (row === 0) {
        cv.rect(lx, ly, 3, 3, PAL.mint);
        cv.set(lx, ly, col('#D4FFE9'));
      }
    }
  }
  portal(yS);
  for (let y = d0 + 16; y < d1 - 10; y += 34) glowDot(cv, dx - 1, y, PAL.ivory, PAL.lamp);
  scene.addSplit(
    { art: cv, x, y: top, baseY: yS },
    { id: 'start_gantry', kind: 'start_gantry', fade: true },
  );
  // The span's shadow lies on the road beside it, clear of the deck that would hide it.
  scene.shadeRect(x + dx + GANTRY_DECK + 2, yN + 16, 26, yS - yN - 14);
  for (const fx of [x + 1, x + bx + GANTRY_DECK + GANTRY_SPLAY - 6]) {
    scene.footprint(fx, yN - 2, 5, 3, 7);
  }
}

function tramViaduct(scene: Scene, sites: LandmarkSites): void {
  const v = sites.viaduct;
  const w = v.roadX1 - v.roadX0;
  const cv = new Canvas(w, VIADUCT_HALF * 2 + 7 + 4);
  drawViaductDeck(cv, v.roadX0, v.roadX0, v.roadX1);
  // Underslung lamps so the deck edge reads against the dark road.
  for (let x = 24; x < w - 16; x += 44) glowDot(cv, x, VIADUCT_HALF * 2 + 8, PAL.ivory, PAL.lamp);
  scene.add({
    art: cv,
    x: v.roadX0 + leanOf(VIADUCT_RISE),
    y: v.y - VIADUCT_HALF - VIADUCT_RISE,
    baseY: v.y + VIADUCT_HALF,
    overlay: { id: 'tram_viaduct', kind: 'tram_viaduct', fade: true },
  });
  scene.shadeRect(v.roadX0 + 8, v.y - VIADUCT_HALF + 10, w, VIADUCT_HALF * 2);
}

const LANTERN = stencil(['.kkk.', 'rRHRr', 'RHHRR', 'RRRRr', 'rRRrr', '.ktk.']);
const STRING_RISE = 22;

/** Lantern strings zigzag across the alley between poles on its walls. */
function lanternStrings(ctx: BakeContext, scene: Scene): void {
  for (const branch of ctx.track.branches) {
    if (branch.index === 0) continue;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < branch.count; i++) {
      minX = Math.min(minX, branch.x[i]!);
      maxX = Math.max(maxX, branch.x[i]!);
      minY = Math.min(minY, branch.y[i]!);
      maxY = Math.max(maxY, branch.y[i]!);
    }
    const ox = Math.floor(minX - 70);
    const oy = Math.floor(minY - 20 - STRING_RISE);
    const cv = new Canvas(Math.ceil(maxX - minX + 140), Math.ceil(maxY - minY + 40 + STRING_RISE));
    const anchor = (s: number, side: number): [number, number] => {
      const p = sampleBranch(branch, s);
      const reach = p.halfWidth + p.shoulder + 3;
      return [Math.round(p.x - p.ty * side * reach), Math.round(p.y + p.tx * side * reach)];
    };
    type Hang = { x: number; y: number; warm: boolean };
    const hangs: Hang[] = [];
    const cords: Array<[number, number, number, number]> = [];
    const poles = new Map<string, [number, number]>();
    let side = -1;
    let n = 0;
    for (let s = 60; s + 26 < branch.length - 44; s += 27) {
      const [ax, ay] = anchor(s, side);
      const [bx, by] = anchor(s + 24, -side);
      poles.set(`${ax},${ay}`, [ax, ay]);
      poles.set(`${bx},${by}`, [bx, by]);
      cords.push([ax - ox, ay - oy - STRING_RISE, bx - ox, by - oy - STRING_RISE]);
      for (const t of [0.16, 0.33, 0.5, 0.67, 0.84]) {
        // A shallow sag so the string does not read as a ruled line.
        const bow = Math.sin(t * Math.PI) * 4;
        hangs.push({
          x: Math.round(ax + (bx - ax) * t) - ox,
          y: Math.round(ay + (by - ay) * t + bow) - oy - STRING_RISE,
          warm: n++ % 2 === 0,
        });
      }
      side = -side;
    }
    for (const hg of hangs) {
      const glow = hg.warm ? PAL.lampGlow : PAL.coral;
      for (let dy = -4; dy <= 5; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const d = Math.hypot(dx, dy * 0.9);
          if (d <= 3.3) cv.halo(hg.x + dx, hg.y + dy, glow, 110);
        }
      }
    }
    for (const [ax, ay, bx, by] of cords) {
      for (let t = 0; t <= 1; t += 0.01) {
        const bow = Math.sin(t * Math.PI) * 4;
        cv.setA(
          Math.round(ax + (bx - ax) * t),
          Math.round(ay + (by - ay) * t + bow - 3),
          PAL.ink,
          255,
        );
      }
    }
    for (const hg of hangs) {
      const pal = hg.warm
        ? { k: PAL.woodDark, R: PAL.gold, H: PAL.goldHi, r: PAL.goldDim, t: PAL.coral }
        : { k: PAL.woodDark, R: PAL.coral, H: PAL.coralHi, r: PAL.coralDim, t: PAL.gold };
      cv.stamp(hg.x - 2, hg.y - 3, LANTERN, pal);
    }
    scene.add({
      art: cv,
      x: ox,
      y: oy,
      baseY: Math.ceil(maxY) + 40,
      overlay: { id: `lantern_strings_${branch.id}`, kind: 'lantern_strings', fade: true },
    });
    // The poles the strings hang from stand on the alley walls, in the ground layer.
    for (const [px, py] of poles.values()) {
      const pole = Canvas.sprite(3, STRING_RISE + 5);
      pole.vline(1, 0, STRING_RISE + 4, PAL.steel);
      pole.vline(2, 1, STRING_RISE + 3, PAL.steelDark);
      pole.rect(0, STRING_RISE + 2, 3, 3, PAL.steelDark);
      pole.set(1, 0, PAL.steelHi);
      if (!scene.artFits(pole, px - 1, py - STRING_RISE - 4)) continue;
      scene.add({ art: pole, x: px - 1, y: py - STRING_RISE - 4, baseY: py });
    }
  }
}

const ARROWS: Record<string, Stencil> = {
  up: stencil([
    '....a....',
    '...aaa...',
    '..aaaaa..',
    '.aaaaaaa.',
    '...aaa...',
    '...aaa...',
    '...aaa...',
    '...aaa...',
    '...aaa...',
  ]),
  left: stencil([
    '...a.....',
    '..aa.....',
    '.aaaaaaa.',
    'aaaaaaaaa',
    '.aaaaaaa.',
    '..aa..aaa',
    '...a..aaa',
    '......aaa',
    '......aaa',
  ]),
  right: stencil([
    '.....a...',
    '.....aa..',
    '.aaaaaaa.',
    'aaaaaaaaa',
    '.aaaaaaa.',
    'aaa..aa..',
    'aaa..a...',
    'aaa......',
    'aaa......',
  ]),
  east: stencil([
    '.....a...',
    '.....aa..',
    'aaaaaaaa.',
    'aaaaaaaaa',
    'aaaaaaaa.',
    '.....aa..',
    '.....a...',
  ]),
  west: stencil([
    '...a.....',
    '..aa.....',
    '.aaaaaaaa',
    'aaaaaaaaa',
    '.aaaaaaaa',
    '..aa.....',
    '...a.....',
  ]),
  uturnRight: stencil([
    '.aaaaaa..',
    'aaaaaaaa.',
    'aaa...aaa',
    'aaa...aaa',
    'aaa.aaaaaaa',
    'aaa..aaaaa',
    'aaa...aaa',
    'aaa....a.',
    'aaa......',
  ]),
  uturnLeft: stencil([
    '...aaaaaa.',
    '..aaaaaaaa',
    '..aaa...aaa',
    '..aaa...aaa',
    'aaaaaaa.aaa',
    '.aaaaa..aaa',
    '..aaa...aaa',
    '...a....aaa',
    '........aaa',
  ]),
};

export type Panel = { lines: string[]; arrow: keyof typeof ARROWS; accent: Color };

/** Direction sign face, upright toward the camera. */
function panelFace(panel: Panel): Canvas {
  const tw = Math.max(...panel.lines.map((l) => textWidth(l, 'micro', 1)));
  const w = tw + 22;
  const h = 19;
  const cv = Canvas.sprite(w, h);
  cv.rect(0, 0, w, h, BOARD);
  cv.frame(0, 0, w, h, PAL.ink);
  cv.frame(1, 1, w - 2, h - 2, PAL.kerbIvory);
  cv.rect(2, 2, 13, h - 4, BOARD_EDGE);
  const st = ARROWS[panel.arrow]!;
  cv.stamp(4, (h - st.h) >> 1, st, { a: panel.accent });
  const lh = panel.lines.length === 1 ? 7 : 3;
  panel.lines.forEach((line, k) => drawText(cv, 18, lh + k * 7, line, PAL.ivory, 'micro', 1));
  return cv;
}

const BRIDGE_RISE = 30;

/** Finds the banks either side of a north-south stretch of road at arc length `s`. */
function crossSpan(
  ctx: BakeContext,
  scene: Scene,
  s: number,
  back: number,
): { y: number; x0: number; x1: number } {
  const p = sampleBranch(ctx.track.main, s);
  const y = Math.round(p.y);
  let x0 = Math.round(p.x);
  let x1 = x0;
  while (x0 > 0 && scene.drive[y * scene.w + x0]) x0--;
  while (x1 < scene.w - 1 && scene.drive[y * scene.w + x1]) x1++;
  return { y, x0: x0 - back, x1: x1 + back };
}

/** Sign bridge across a north-south road: its panels face the camera. */
function signBridge(
  ctx: BakeContext,
  scene: Scene,
  id: string,
  s: number,
  panels: Array<Panel | null>,
): void {
  const span = crossSpan(ctx, scene, s, 5);
  const lean = leanOf(BRIDGE_RISE);
  const W0 = span.x1 - span.x0 + 8;
  const W = W0 + lean;
  const H = BRIDGE_RISE + 26;
  const cv = Canvas.sprite(W, H);
  const foot = H - 2;
  pylon(cv, 1, foot, 6, BRIDGE_RISE);
  pylon(cv, W0 - 7, foot, 6, BRIDGE_RISE);
  const by = foot - BRIDGE_RISE - 4;
  // Truss beam, seen from the front, up where the pylons have leaned to.
  for (let x = lean; x < W; x++) {
    cv.set(x, by, PAL.steelHi);
    cv.set(x, by + 1, PAL.steelLight);
    cv.set(x, by + 6, PAL.steel);
    cv.set(x, by + 7, PAL.steelDark);
    const m = x % 10;
    cv.set(x, by + 2 + (m < 5 ? m : 9 - m), PAL.steel);
  }
  const mid = W0 / 2 + lean;
  panels.forEach((panel, k) => {
    if (!panel) return;
    const face = panelFace(panel);
    const cx = Math.round(mid + (k === 0 ? -1 : 1) * (W0 * 0.23));
    cv.blit(face, cx - (face.w >> 1), by - 6);
    glowDot(cv, cx, by + face.h - 4, PAL.ivory, PAL.lamp);
  });
  scene.addSplit(
    { art: cv, x: span.x0 - 4, y: span.y - foot, baseY: span.y },
    { id, kind: 'sign_bridge', fade: true },
  );
  scene.shadeRect(span.x0 + 6, span.y + 6, span.x1 - span.x0, 4);
}

/** Glazed footbridge between the buildings either side of a north-south road. */
function skyBridge(ctx: BakeContext, scene: Scene, id: string, s: number): void {
  const span = crossSpan(ctx, scene, s, 12);
  const W = span.x1 - span.x0;
  const depth = 12;
  const face = 9;
  const cv = Canvas.sprite(W, depth + face);
  const roof = col('#3D4A6B');
  const roofAlt = col('#34405E');
  for (let u = 0; u < W; u++) {
    for (let v = 0; v < depth; v++) {
      let c: Color = u % 12 === 0 ? roofAlt : roof;
      if (v === 0) c = PAL.steelHi;
      else if (v === 1) c = PAL.steelLight;
      else if (v === depth - 1) c = PAL.steelLight;
      else if (v >= 4 && v <= 6)
        c = u % 12 === 0 || u % 12 === 6 ? PAL.steelDark : v === 4 ? PAL.windowWarm : PAL.windowMid;
      cv.set(u, v, c);
    }
    for (let v = 0; v < face; v++) {
      const pane = u % 8;
      let c: Color = PAL.steelDark;
      if (v === 0) c = PAL.steel;
      else if (v === face - 1) c = PAL.ink;
      else if (v >= 2 && v <= 5 && pane !== 0)
        c =
          Math.floor(u / 8) % 4 === 2 ? PAL.windowNight : v === 2 ? PAL.windowWarm : PAL.windowMid;
      cv.set(u, depth + v, c);
    }
  }
  for (const u of [0, 1, W - 2, W - 1])
    for (let v = 0; v < depth + face; v++)
      cv.set(u, v, u === 0 || u === W - 2 ? PAL.kerb : PAL.kerbShade);
  scene.add({
    art: cv,
    x: span.x0 + leanOf(VIADUCT_RISE),
    y: span.y - (depth >> 1) - VIADUCT_RISE,
    baseY: span.y + (depth >> 1),
    overlay: { id, kind: 'sign_bridge', fade: true },
  });
  scene.shadeRect(span.x0 + 8, span.y + 4, W, depth);
}

/** Roadside direction board on posts, standing on the far bank of an east-west road. */
function roadsideSign(ctx: BakeContext, scene: Scene, s: number, panel: Panel): void {
  const p = sampleBranch(ctx.track.main, s);
  const x = Math.round(p.x);
  let y = Math.round(p.y);
  while (y > 0 && scene.drive[y * scene.w + x]) y--;
  const face = panelFace(panel);
  const cv = Canvas.sprite(face.w, face.h + 9);
  for (const px of [3, face.w - 5]) {
    cv.vline(px, face.h, 9, PAL.steelLight);
    cv.vline(px + 1, face.h, 9, PAL.steelDark);
  }
  cv.blit(face, 0, 0);
  const sx = x - (face.w >> 1);
  const sy = y - cv.h + 1;
  if (!scene.artFits(cv, sx, sy)) return;
  scene.add({ art: cv, x: sx, y: sy, baseY: y + 5 });
  scene.footprint(sx + 3, y - 1, face.w - 6, 2, 3);
}

export function buildOverlays(
  ctx: BakeContext,
  scene: Scene,
  sites: LandmarkSites,
  hairpins: ReadonlyArray<{ s: number; dir: number }>,
): void {
  startGantry(ctx, scene, sites);
  tramViaduct(scene, sites);
  lanternStrings(ctx, scene);
  const h1 = hairpins[0];
  const h2 = hairpins[1];
  const alley = ctx.track.branches[1];
  if (h1) {
    roadsideSign(ctx, scene, h1.s - 430, { lines: ['DOWNTOWN'], arrow: 'east', accent: PAL.ivory });
    roadsideSign(ctx, scene, h1.s - 330, {
      lines: ['HAIRPIN', 'SLOW'],
      arrow: h1.dir > 0 ? 'uturnRight' : 'uturnLeft',
      accent: PAL.gold,
    });
  }
  if (h2 && alley) {
    roadsideSign(ctx, scene, alley.leaveS - 150, {
      lines: ['LANTERN', 'ALLEY'],
      arrow: 'west',
      accent: PAL.gold,
    });
  }
  roadsideSign(ctx, scene, 4520, { lines: ['BILLBOARD', 'ROW'], arrow: 'east', accent: PAL.ivory });
  roadsideSign(ctx, scene, 1180, { lines: ['HARBOR', 'DOCKS'], arrow: 'west', accent: PAL.cyan });
  roadsideSign(ctx, scene, 7480, { lines: ['OVERPASS'], arrow: 'east', accent: PAL.cyan });
  signBridge(ctx, scene, 'sign_bridge_west_avenue', 2640, [
    { lines: ['WEST AVE'], arrow: 'up', accent: PAL.ivory },
    { lines: ['CLOCK', 'TOWER'], arrow: 'up', accent: PAL.gold },
  ]);
  signBridge(ctx, scene, 'sign_bridge_overpass', 8500, [
    { lines: ['OVERPASS'], arrow: 'up', accent: PAL.ivory },
    { lines: ['HARBOR', 'DOCKS'], arrow: 'up', accent: PAL.cyan },
  ]);
  skyBridge(ctx, scene, 'sign_bridge_skywalk_west', 3390);
  skyBridge(ctx, scene, 'sign_bridge_skywalk_east', 8900);
}
