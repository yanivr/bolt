import { sampleBranch } from '@bolt/shared';
import type { BakeContext, OverlayArt } from '../biome.js';
import { Canvas, col, stencil } from '../canvas.js';
import type { Color, Stencil } from '../canvas.js';
import { drawText, textWidth } from '../font.js';
import { VIADUCT_HALF, drawViaduct } from './landmarks.js';
import type { LandmarkSites } from './landmarks.js';
import { PAL } from './palette.js';
import { WALL_OUT } from './road.js';

/**
 * Foreground structures drawn above the cars. Each is painted on its own transparent canvas;
 * the baker crops and packages them, and their ground shadows are baked into the road here.
 */

const BOARD = col('#1B2540');
const BOARD_EDGE = col('#28344A');

/** Marks the shadow an overlay throws onto the corridor, offset down and to the right. */
function castOverlayShadow(
  ctx: BakeContext,
  forced: Uint8Array,
  art: OverlayArt,
  shift: number,
): void {
  const { field } = ctx;
  for (let y = 0; y < art.canvas.h; y++) {
    for (let x = 0; x < art.canvas.w; x++) {
      if (art.canvas.alpha(x, y) !== 255) continue;
      const wx = art.x + x + shift;
      const wy = art.y + y + shift;
      if (wx < 0 || wy < 0 || wx >= field.w || wy >= field.h) continue;
      const i = wy * field.w + wx;
      if (field.edge[i]! <= WALL_OUT) forced[i] = 1;
    }
  }
}

function glowDot(cv: Canvas, x: number, y: number, core: Color, glow: Color): void {
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const d = Math.abs(dx) + Math.abs(dy);
      if (d <= 4 && d > 2) cv.halo(x + dx, y + dy, glow, 70);
      else if (d === 2) cv.halo(x + dx, y + dy, glow, 140);
    }
  }
  cv.setA(x - 1, y, glow, 255);
  cv.setA(x + 1, y, glow, 255);
  cv.setA(x, y - 1, glow, 255);
  cv.setA(x, y + 1, glow, 255);
  cv.setA(x, y, core, 255);
}

/** Lattice beam along `u` (the span), `depth` pixels across. `put` maps span space to pixels. */
function truss(put: (u: number, v: number, c: Color) => void, len: number, depth: number): void {
  const period = (depth - 2) * 2;
  for (let u = 0; u < len; u++) {
    const m = u % period;
    const zig = m < depth - 2 ? m : period - m;
    put(u, 1 + zig, PAL.steel);
    if (m === 0) for (let v = 1; v < depth - 1; v++) put(u, v, PAL.steelLight);
  }
  for (let u = 0; u < len; u++) {
    put(u, 0, PAL.steelHi);
    put(u, 1, PAL.steelLight);
    put(u, depth - 2, PAL.steel);
    put(u, depth - 1, PAL.steelDark);
  }
}

function footing(cv: Canvas, x: number, y: number, size: number): void {
  cv.rect(x, y, size, size, PAL.steel);
  cv.hline(x, y, size, PAL.steelHi);
  cv.vline(x, y, size, PAL.steelLight);
  cv.hline(x, y + size - 1, size, PAL.ink);
  cv.vline(x + size - 1, y, size, PAL.ink);
  cv.rect(x + 2, y + 2, size - 4, size - 4, PAL.steelDark);
  cv.set(x + 2, y + 2, PAL.steelLight);
}

function startGantry(ctx: BakeContext, sites: LandmarkSites): OverlayArt {
  const p = sampleBranch(ctx.track.main, ctx.track.startS);
  const half = Math.round(p.halfWidth + p.shoulder + 8);
  const W = 46;
  const H = half * 2 + 14;
  const cv = new Canvas(W, H);
  const top = 7;
  const bottom = H - 7;
  // Truss, running the full span.
  truss((u, v, c) => cv.set(26 + v, top + u, c), bottom - top, 12);
  // Banner board, hung on the approach side of the truss.
  const bx = 5;
  const by = top + 24;
  const bh = bottom - top - 48;
  cv.rect(bx, by, 20, bh, BOARD);
  cv.frame(bx, by, 20, bh, PAL.coral);
  cv.vline(bx, by, bh, PAL.coralHi);
  cv.hline(bx, by, 20, PAL.coralHi);
  cv.vline(bx + 19, by, bh, PAL.coralDim);
  // Checkered ends.
  for (let k = 0; k < 2; k++) {
    const cy = k === 0 ? by + 2 : by + bh - 10;
    for (let yy = 0; yy < 8; yy++)
      for (let xx = 0; xx < 16; xx++)
        cv.set(bx + 2 + xx, cy + yy, ((xx >> 2) + (yy >> 2)) & 1 ? PAL.ivory : PAL.ink);
  }
  const text = 'BOLT RIVALS';
  const tw = textWidth(text, 'chunky', 2);
  drawText(cv, bx + 3, by + ((bh + tw) >> 1), text, PAL.ivory, 'chunky', 2, 1);
  // Hangers between board and truss.
  for (let y = by + 6; y < by + bh - 4; y += 28) cv.hline(bx + 20, y, 6, PAL.steelDark);
  // Pylon heads.
  footing(cv, 25, 0, 14);
  footing(cv, 25, H - 14, 14);
  // Lamp heads along the truss.
  for (let y = top + 20; y < bottom - 10; y += 34) glowDot(cv, 41, y, PAL.ivory, PAL.lamp);
  // Start lights cluster in the middle of the span.
  const my = (H >> 1) - 12;
  cv.rect(38, my, 7, 24, PAL.ink);
  for (let k = 0; k < 5; k++) cv.rect(40, my + 2 + k * 4, 3, 3, PAL.mint);
  return {
    id: 'start_gantry',
    kind: 'start_gantry',
    canvas: cv,
    x: Math.round(sites.start.x) - 62,
    y: Math.round(p.y) - (H >> 1),
    fadeNearPlayer: true,
  };
}

function tramViaduct(sites: LandmarkSites): OverlayArt {
  const v = sites.viaduct;
  const w = v.roadX1 - v.roadX0;
  const h = VIADUCT_HALF * 2 + 8;
  const cv = new Canvas(w, h);
  drawViaduct(cv, v.roadX0, v.y - (h >> 1), v.y, v.roadX0, v.roadX1, false);
  // Underslung lamps so the deck edge reads against the dark road.
  for (let x = 30; x < w - 20; x += 48) glowDot(cv, x, h - 5, PAL.ivory, PAL.lamp);
  return {
    id: 'tram_viaduct',
    kind: 'tram_viaduct',
    canvas: cv,
    x: v.roadX0,
    y: v.y - (h >> 1),
    fadeNearPlayer: true,
  };
}

const LANTERN = stencil(['.kkk.', 'rRHRr', 'RHHRR', 'RRRRr', 'rRRrr', '.ktk.']);

function lanternStrings(ctx: BakeContext): OverlayArt[] {
  const out: OverlayArt[] = [];
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
    const oy = Math.floor(minY - 20);
    const cv = new Canvas(Math.ceil(maxX - minX + 140), Math.ceil(maxY - minY + 40));
    const anchor = (s: number, side: number): [number, number] => {
      const p = sampleBranch(branch, s);
      const reach = p.halfWidth + p.shoulder + 3;
      return [p.x - p.ty * side * reach - ox, p.y + p.tx * side * reach - oy];
    };
    type Hang = { x: number; y: number; warm: boolean };
    const hangs: Hang[] = [];
    const cords: Array<[number, number, number, number]> = [];
    let side = -1;
    let n = 0;
    for (let s = 60; s + 26 < branch.length - 44; s += 27) {
      const [ax, ay] = anchor(s, side);
      const [bx, by] = anchor(s + 24, -side);
      cords.push([ax, ay, bx, by]);
      for (const t of [0.16, 0.33, 0.5, 0.67, 0.84]) {
        // A shallow bow so the string does not read as a ruled line.
        const bow = Math.sin(t * Math.PI) * 3;
        hangs.push({
          x: Math.round(ax + (bx - ax) * t),
          y: Math.round(ay + (by - ay) * t + bow),
          warm: n++ % 2 === 0,
        });
      }
      side = -side;
    }
    for (const hg of hangs) {
      const glow = hg.warm ? PAL.lampGlow : PAL.coral;
      for (let dy = -5; dy <= 5; dy++) {
        for (let dx = -5; dx <= 5; dx++) {
          const d = Math.hypot(dx, dy * 0.9);
          if (d <= 3.3) cv.halo(hg.x + dx, hg.y + dy, glow, 120);
          else if (d <= 5.2 && ((dx + dy) & 1) === 0) cv.halo(hg.x + dx, hg.y + dy, glow, 60);
        }
      }
    }
    for (const [ax, ay, bx, by] of cords) {
      for (let t = 0; t <= 1; t += 0.01) {
        const bow = Math.sin(t * Math.PI) * 3;
        cv.setA(
          Math.round(ax + (bx - ax) * t),
          Math.round(ay + (by - ay) * t + bow - 3),
          PAL.ink,
          255,
        );
      }
      cv.rect(Math.round(ax) - 1, Math.round(ay) - 4, 3, 3, PAL.steel);
      cv.rect(Math.round(bx) - 1, Math.round(by) - 4, 3, 3, PAL.steel);
    }
    for (const hg of hangs) {
      const pal = hg.warm
        ? { k: PAL.woodDark, R: PAL.gold, H: PAL.goldHi, r: PAL.goldDim, t: PAL.coral }
        : { k: PAL.woodDark, R: PAL.coral, H: PAL.coralHi, r: PAL.coralDim, t: PAL.gold };
      cv.stamp(hg.x - 2, hg.y - 3, LANTERN, pal);
    }
    out.push({
      id: `lantern_strings_${branch.id}`,
      kind: 'lantern_strings',
      canvas: cv,
      x: ox,
      y: oy,
      fadeNearPlayer: true,
    });
  }
  return out;
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

type Panel = { lines: string[]; arrow: keyof typeof ARROWS; accent: Color };

/** Sign face in reading orientation: letter tops point the way the driver is heading. */
function panelFace(panel: Panel): Canvas {
  const tw = Math.max(...panel.lines.map((l) => textWidth(l, 'micro', 1)));
  const w = tw + 22;
  const h = 19;
  const cv = new Canvas(w, h);
  cv.rect(0, 0, w, h, BOARD);
  cv.frame(0, 0, w, h, PAL.ink);
  cv.frame(1, 1, w - 2, h - 2, PAL.kerbIvory);
  cv.rect(2, 2, 13, h - 4, BOARD_EDGE);
  cv.stamp(4, 5, ARROWS[panel.arrow]!, { a: panel.accent });
  const lh = panel.lines.length === 1 ? 7 : 3;
  panel.lines.forEach((line, k) => drawText(cv, 18, lh + k * 7, line, PAL.ivory, 'micro', 1));
  return cv;
}

/** Rotates a canvas by quarter turns clockwise. */
function rotate(src: Canvas, quarter: number): Canvas {
  const q = ((quarter % 4) + 4) % 4;
  const out = q % 2 === 0 ? new Canvas(src.w, src.h) : new Canvas(src.h, src.w);
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const a = src.alpha(x, y);
      if (a === 0) continue;
      const c = src.get(x, y);
      if (q === 0) out.setA(x, y, c, a);
      else if (q === 1) out.setA(src.h - 1 - y, x, c, a);
      else if (q === 2) out.setA(src.w - 1 - x, src.h - 1 - y, c, a);
      else out.setA(y, src.w - 1 - x, c, a);
    }
  }
  return out;
}

function spanFrame(
  ctx: BakeContext,
  s: number,
  extra: number,
): { cx: number; cy: number; half: number; hw: number; horizontalRoad: boolean; quarter: number } {
  const p = sampleBranch(ctx.track.main, s);
  const horizontalRoad = Math.abs(p.tx) > Math.abs(p.ty);
  // Quarter turns that point letter tops along the direction of travel.
  const quarter = horizontalRoad ? (p.tx > 0 ? 1 : 3) : p.ty < 0 ? 0 : 2;
  return {
    cx: Math.round(p.x),
    cy: Math.round(p.y),
    half: Math.round(p.halfWidth + p.shoulder + extra),
    hw: p.halfWidth,
    horizontalRoad,
    quarter,
  };
}

function signGantry(
  ctx: BakeContext,
  id: string,
  s: number,
  panels: Array<Panel | null>,
): OverlayArt {
  const f = spanFrame(ctx, s, 7);
  const depth = 8;
  const pad = 34;
  const len = f.half * 2;
  const cv = f.horizontalRoad
    ? new Canvas(pad * 2 + depth, len + 12)
    : new Canvas(len + 12, pad * 2 + depth);
  const put = (u: number, v: number, c: Color): void => {
    if (f.horizontalRoad) cv.set(pad + v, 6 + u, c);
    else cv.set(6 + u, pad + v, c);
  };
  truss(put, len, depth);
  if (f.horizontalRoad) {
    footing(cv, pad - 2, 0, 12);
    footing(cv, pad - 2, len, 12);
  } else {
    footing(cv, 0, pad - 2, 12);
    footing(cv, len, pad - 2, 12);
  }
  // One panel over each half of the road. Index 0 is the driver's left.
  panels.forEach((panel, k) => {
    if (!panel) return;
    const face = rotate(panelFace(panel), f.quarter);
    // Lateral position of this panel's center along the span, measured from the span start.
    const leftFirst = f.quarter === 3 || f.quarter === 0;
    const sideSign = k === 0 ? -1 : 1;
    // For a westbound road the driver's left is south (larger y); for eastbound it is north.
    let along: number;
    if (f.horizontalRoad) along = f.half + (f.quarter === 3 ? -sideSign : sideSign) * f.hw * 0.5;
    else along = f.half + (f.quarter === 0 ? sideSign : -sideSign) * f.hw * 0.5;
    void leftFirst;
    const px = f.horizontalRoad
      ? pad + (depth >> 1) - (face.w >> 1)
      : 6 + Math.round(along) - (face.w >> 1);
    const py = f.horizontalRoad
      ? 6 + Math.round(along) - (face.h >> 1)
      : pad + (depth >> 1) - (face.h >> 1);
    cv.blit(face, px, py);
    // A small lamp washing each face.
    if (f.horizontalRoad) glowDot(cv, px + face.w + 2, py + (face.h >> 1), PAL.ivory, PAL.lamp);
    else glowDot(cv, px + (face.w >> 1), py + face.h + 2, PAL.ivory, PAL.lamp);
  });
  const x = f.horizontalRoad ? f.cx - pad - (depth >> 1) : f.cx - f.half - 6;
  const y = f.horizontalRoad ? f.cy - f.half - 6 : f.cy - pad - (depth >> 1);
  return { id, kind: 'sign_bridge', canvas: cv, x, y, fadeNearPlayer: true };
}

function skyBridge(ctx: BakeContext, id: string, s: number): OverlayArt {
  const f = spanFrame(ctx, s, 16);
  const depth = 20;
  const len = f.half * 2;
  const cv = f.horizontalRoad ? new Canvas(depth, len) : new Canvas(len, depth);
  const put = (u: number, v: number, c: Color): void => {
    if (f.horizontalRoad) cv.set(v, u, c);
    else cv.set(u, v, c);
  };
  const roof = col('#34405E');
  const roofAlt = col('#2B3550');
  for (let u = 0; u < len; u++) {
    for (let v = 0; v < depth; v++) {
      let c: Color;
      const rib = u % 12 === 0;
      if (v === 0) c = PAL.steelHi;
      else if (v === 1) c = PAL.steelLight;
      else if (v === depth - 1) c = PAL.ink;
      else if (v === depth - 2) c = PAL.steelDark;
      else if (v === 2 || v === depth - 3)
        c = rib
          ? PAL.steelDark
          : u % 12 < 7 && Math.floor(u / 12) % 3 !== 1
            ? PAL.windowMid
            : PAL.windowDim;
      else if (v === 3) c = roofAlt;
      else if (v >= 8 && v <= 11) {
        // Ridge skylight glowing from the corridor below.
        const pane = u % 12;
        c =
          v === 8 || v === 11 || pane === 0 || pane === 6
            ? PAL.steelDark
            : (u + v) % 5 === 0
              ? PAL.windowWarm
              : PAL.windowMid;
      } else c = rib ? roofAlt : (u * 3 + v) % 17 === 0 ? roofAlt : roof;
      put(u, v, c);
    }
  }
  // End collars where the bridge meets each building.
  for (let v = 0; v < depth; v++) {
    for (const u of [0, 1, len - 2, len - 1])
      put(u, v, u === 0 || u === len - 2 ? PAL.kerb : PAL.kerbShade);
  }
  const x = f.horizontalRoad ? f.cx - (depth >> 1) : f.cx - f.half;
  const y = f.horizontalRoad ? f.cy - f.half : f.cy - (depth >> 1);
  return { id, kind: 'sign_bridge', canvas: cv, x, y, fadeNearPlayer: true };
}

export function buildOverlays(
  ctx: BakeContext,
  sites: LandmarkSites,
  hairpins: ReadonlyArray<{ s: number; dir: number }>,
  forced: Uint8Array,
): OverlayArt[] {
  const out: OverlayArt[] = [];
  const add = (art: OverlayArt, shift: number): void => {
    out.push(art);
    castOverlayShadow(ctx, forced, art, shift);
  };
  add(startGantry(ctx, sites), 9);
  add(tramViaduct(sites), 12);
  for (const art of lanternStrings(ctx)) out.push(art);
  const h1 = hairpins[0];
  const h2 = hairpins[1];
  const alley = ctx.track.branches[1];
  if (h1) {
    add(
      signGantry(ctx, 'sign_bridge_downtown', h1.s - 420, [
        { lines: ['DOWNTOWN'], arrow: 'up', accent: PAL.ivory },
        {
          lines: ['HAIRPIN', 'SLOW'],
          arrow: h1.dir > 0 ? 'uturnRight' : 'uturnLeft',
          accent: PAL.gold,
        },
      ]),
      7,
    );
  }
  if (h2 && alley) {
    add(
      signGantry(ctx, 'sign_bridge_lantern_alley', alley.leaveS - 78, [
        { lines: ['LANTERN', 'ALLEY'], arrow: 'left', accent: PAL.gold },
        { lines: ['MARKET ST'], arrow: h2.dir > 0 ? 'uturnRight' : 'uturnLeft', accent: PAL.ivory },
      ]),
      7,
    );
  }
  add(
    signGantry(ctx, 'sign_bridge_harbor', 1150, [
      { lines: ['HARBOR', 'DOCKS'], arrow: 'left', accent: PAL.cyan },
      { lines: ['WEST AVE'], arrow: 'up', accent: PAL.ivory },
    ]),
    7,
  );
  add(
    signGantry(ctx, 'sign_bridge_billboard_row', 4520, [
      { lines: ['BILLBOARD', 'ROW'], arrow: 'up', accent: PAL.ivory },
      null,
    ]),
    7,
  );
  add(
    signGantry(ctx, 'sign_bridge_market', 7560, [
      null,
      { lines: ['OVERPASS', 'HARBOR'], arrow: 'up', accent: PAL.cyan },
    ]),
    7,
  );
  add(skyBridge(ctx, 'sign_bridge_skywalk_west', 2330), 8);
  add(skyBridge(ctx, 'sign_bridge_skywalk_east', 8790), 8);
  return out;
}
