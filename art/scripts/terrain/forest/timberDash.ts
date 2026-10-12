import { hash2 } from '@bolt/shared';
import type { TrackAnchor, TrackObstacle, TrackPoint } from '@bolt/shared';
import type { AnimatedArt } from '../biome.js';
import { Canvas } from '../canvas.js';
import { birdsLoop, regionLoop } from './anim.js';
import type { Env } from './env.js';
import { getc, put } from './env.js';
import { plantBoundaryWoods } from './forestKit.js';
import { K_OFF } from './maps.js';
import { fbm, vnoise } from './noise.js';
import { NAT, darken, lighten } from './palette.js';
import { plantTree, seedOf, standSprite } from './place.js';
import { chevronBoard, logPileSprite, rockSprite, stumpSprite } from './props.js';
import { lookoutTower, sparTop } from './structures.js';
import type { Species } from './trees.js';

/**
 * Timber Dash's own art: redwood walls along the two straights, the giant redwoods the
 * chicanes go round, the logging operation (the sawmill's sawdust yard with its cart rails,
 * the landing where timber is stacked, the high-lead spar with its cables, the log piles on
 * the spur), the fire lookout on its stilts, and a brook that floods into channels in heavy
 * rain. Only what the data makes solid is drawn solid: the sawmill yard and the landing are
 * ground (sawdust, bark, rails); the spar is one of the obstacle trees.
 */

const anchor = (env: Env, id: string): TrackAnchor | undefined =>
  env.ctx.def.anchors.find((a) => a.id === id);

export function paintTimberDashGround(env: Env): void {
  void env;
}

function nearestTree(env: Env, p: TrackPoint, maxD: number): TrackObstacle | null {
  let best: TrackObstacle | null = null;
  let bd = maxD;
  for (const o of env.ctx.def.obstacles) {
    if (o.kind !== 'tree' || o.radius > 20) continue;
    const d = Math.hypot(o.x - p.x, o.y - p.y);
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best;
}

/** Flat yard of trodden sawdust and bark chips, with heaps that a car can plough through. */
function sawdustYard(env: Env, cx: number, cy: number, rx: number, ry: number, seed: number): void {
  const { maps, world } = env;
  const { w, h } = maps;
  for (let y = Math.floor(cy - ry - 10); y <= cy + ry + 10; y++)
    for (let x = Math.floor(cx - rx - 10); x <= cx + rx + 10; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const i = y * w + x;
      if (maps.kind[i] !== K_OFF) continue;
      const d = Math.hypot((x - cx) / rx, (y - cy) / ry) + (fbm(x, y, 30, seed) - 0.5) * 0.5;
      if (d > 1) continue;
      const hh = hash2(x >> 1, y >> 1, seed + 1);
      let c = d > 0.85 ? (hh < 0.5 ? NAT.sawdustDark : getc(world, i)) : hh < 0.15 ? NAT.sawdustDark : hh > 0.9 ? NAT.sawdustLight : NAT.sawdust;
      // Bark chips and splinters.
      if (hash2(x, y, seed + 2) < 0.025) c = NAT.woodDark;
      // Tracks of the skidder through the yard.
      const tr = Math.abs(((y - cy) * 0.3 + (x - cx) * 0.05) % 26);
      if (tr < 3 && d < 0.8 && vnoise(x, y, 40, seed + 3) > 0.4) c = NAT.sawdustDark;
      put(world, i, env.wet > 0.6 && fbm(x, y, 18, seed + 4) < 0.2 ? NAT.mudWater : c);
    }
  // Heaps: soft mounds, shaded like the shrubs (no height, no collision).
  for (let k = 0; k < 5; k++) {
    const hx = cx + (hash2(k, 1, seed) - 0.5) * rx * 1.2;
    const hy = cy + (hash2(k, 2, seed) - 0.5) * ry * 1.1;
    const r = 10 + hash2(k, 3, seed) * 10;
    for (let y = Math.floor(hy - r); y <= hy + r; y++)
      for (let x = Math.floor(hx - r * 1.4); x <= hx + r * 1.4; x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const dx = (x - hx) / 1.4;
        const dy = y - hy;
        const dd = Math.hypot(dx, dy) / r;
        if (dd > 1 || maps.kind[y * w + x] !== K_OFF) continue;
        const lit = -(dx + dy) / r;
        const c = dd > 0.86 && dx + dy > 0 ? NAT.sawdustDark : lit > 0.35 ? NAT.sawdustLight : lit < -0.3 ? NAT.sawdustDark : NAT.sawdust;
        put(world, y * w + x, c);
      }
  }
}

/** Narrow-gauge cart rails on sleepers, flat on the ground, between two points. */
function cartRails(env: Env, a: TrackPoint, b: TrackPoint): void {
  const { maps, world } = env;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  for (let t = 0; t < len; t += 0.5) {
    const x = a.x + ux * t;
    const y = a.y + uy * t;
    for (let v = -7; v <= 7; v += 0.5) {
      const px = Math.round(x - uy * v);
      const py = Math.round(y + ux * v);
      if (px < 0 || py < 0 || px >= maps.w || py >= maps.h) continue;
      const i = py * maps.w + px;
      if (maps.kind[i] !== K_OFF) continue;
      const sleeper = Math.floor(t) % 7 < 3;
      if (Math.abs(Math.abs(v) - 4.5) < 0.6) put(world, i, v < 0 ? NAT.steelLight : NAT.steel);
      else if (sleeper && Math.abs(v) < 6.5) put(world, i, NAT.woodDark);
    }
  }
}

/** A shallow brook a car can splash through: flat water over pebbles, wider in the rain. */
function brook(env: Env, pts: readonly TrackPoint[], width: number, seed: number): void {
  const { maps, world } = env;
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k]!;
    const b = pts[k + 1]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    for (let t = 0; t < len; t += 1) {
      const f = t / len;
      const meander = Math.sin(f * Math.PI * 3 + seed) * 26 + (vnoise(t, k, 60, seed) - 0.5) * 30;
      const ux = (b.x - a.x) / len;
      const uy = (b.y - a.y) / len;
      const cx = a.x + ux * t - uy * meander;
      const cy = a.y + uy * t + ux * meander;
      const wv = width * (0.7 + vnoise(t, k, 30, seed + 1) * 0.6);
      for (let v = -wv - 3; v <= wv + 3; v += 0.7) {
        const px = Math.round(cx - uy * v);
        const py = Math.round(cy + ux * v);
        if (px < 0 || py < 0 || px >= maps.w || py >= maps.h) continue;
        const i = py * maps.w + px;
        if (maps.kind[i] !== K_OFF) continue;
        const av = Math.abs(v);
        let c;
        if (av > wv) c = av > wv + 2 ? NAT.soil : NAT.soilDark;
        else {
          const hh = hash2(px >> 1, py >> 1, seed + 2);
          c = av > wv - 2 ? NAT.shallow : hh < 0.12 ? NAT.pebbleDark : hh > 0.94 ? NAT.waterGlint : NAT.shallowLight;
          if ((Math.floor(t) + Math.floor(v * 2)) % 9 === 0 && av < wv - 2) c = NAT.foam;
        }
        put(world, i, c);
      }
    }
  }
}

export function buildTimberDash(env: Env): { loops: () => AnimatedArt[] } {
  const { ctx, maps } = env;
  const { def } = ctx;
  const rainy = env.wet > 0.6;
  // Ground first: the yards, the rails, the brook.
  const saw = anchor(env, 'sawmill')?.points[0];
  if (saw) sawdustYard(env, saw.x, saw.y, 190, 120, 9101);
  const stacks = anchor(env, 'timber_stacks')?.points[0];
  if (stacks) sawdustYard(env, stacks.x, stacks.y - 20, 150, 70, 9201);
  if (saw) cartRails(env, { x: saw.x - 180, y: saw.y + 40 }, { x: saw.x + 200, y: saw.y + 40 });
  const flume = anchor(env, 'log_flume');
  if (flume) {
    brook(env, flume.points, rainy ? 11 : 7, 9301);
    if (rainy) {
      // Run-off streaming toward the brook in the downpour.
      for (let k = 0; k < 6; k++) {
        const p = flume.points[0]!;
        const q = flume.points[flume.points.length - 1]!;
        const t = (k + 0.5) / 6;
        const m = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
        brook(env, [{ x: m.x - 260 + k * 30, y: m.y - 160 }, m], 3, 9400 + k);
      }
    }
  }

  // The giant redwoods: the four biggest obstacles.
  let trees = 0;
  const giants = def.obstacles.filter((o) => o.kind === 'tree' && o.radius > 20);
  for (const o of giants) {
    plantTree(env, { species: 'redwood', seed: seedOf(o.id, o.x, o.y), radius: o.radius }, o.x, o.y, 26);
    trees++;
  }
  // The spar: the obstacle tree nearest the sawmill, topped and rigged.
  const spar = saw ? nearestTree(env, saw, 700) : null;
  if (spar) {
    const placed = plantTree(env, { species: 'redwood', seed: 4242, radius: spar.radius, crownScale: 0.01 }, spar.x, spar.y, 12);
    const top = Math.round(placed.model.trunkTop * 0.95);
    const rig = sparTop(top, spar.y);
    standSprite(env, rig, spar.x, spar.y, 'canopy');
    env.log.push(`spar     ${spar.id}, ${Math.round(Math.hypot(spar.x - saw!.x, spar.y - saw!.y))} px from the sawmill yard`);
    // Cables from the spar's top to the yard: thin, above the cars.
    const sx = spar.x + Math.round(top * 0.62 / 3);
    const sy = spar.y - Math.round(top * 0.62);
    const ends = [
      { x: Math.round(saw!.x - 120), y: Math.round(saw!.y + 30) },
      { x: Math.round(saw!.x + 60), y: Math.round(saw!.y - 50) },
    ];
    for (const [k, e] of ends.entries()) {
      const x0 = Math.min(sx, e.x) - 2;
      const y0 = Math.min(sy, e.y) - 2;
      const cv = Canvas.sprite(Math.abs(e.x - sx) + 5, Math.abs(e.y - sy) + 12);
      const n = Math.ceil(Math.hypot(e.x - sx, e.y - sy));
      for (let t = 0; t <= n; t++) {
        const f = t / n;
        const sag = Math.sin(f * Math.PI) * 8;
        cv.set(Math.round(sx + (e.x - sx) * f - x0), Math.round(sy + (e.y - sy) * f + sag - y0), 0x262a30);
      }
      env.scene.add({ art: cv, x: x0, y: y0, baseY: e.y, overlay: { id: `spar_cable_${k}`, kind: 'cable', fade: true } });
    }
  }
  // Everything else: redwoods and Douglas firs.
  for (const o of def.obstacles) {
    if (o.kind !== 'tree' || o.radius > 20 || o.id === spar?.id) continue;
    const seed = seedOf(o.id, o.x, o.y);
    const r = hash2(seed, 1, 5);
    const species: Species = r < 0.72 ? 'redwood' : 'pine';
    plantTree(env, { species, seed, radius: o.radius }, o.x, o.y);
    trees++;
  }
  for (const o of def.obstacles) {
    const seed = seedOf(o.id, o.x, o.y);
    if (o.kind === 'log') standSprite(env, logPileSprite(o.radius * 1.8, 3, seed, o.y, true), o.x, o.y, 'logs');
    else if (o.kind === 'rock') standSprite(env, rockSprite(o.radius, seed, o.y), o.x, o.y, 'rock');
  }
  void stumpSprite;
  env.log.push(`trees    ${trees} redwoods and firs, ${giants.length} giants`);
  const woods = plantBoundaryWoods(env, ['redwood', 'redwood', 'pine'], 60, 9501);
  env.log.push(`woods    ${woods} trees in the unreachable margin`);

  // The fire lookout: a cab on four thin legs (thin furniture: not a collider, like a sign post).
  const lk = anchor(env, 'fire_lookout')?.points[0];
  if (lk) standSprite(env, lookoutTower(70, Math.round(lk.y)), Math.round(lk.x), Math.round(lk.y), 'lookout', { id: 'fire_lookout', kind: 'lookout', fade: true });

  // Chevrons at the chicanes' own sign anchors.
  for (const a of def.anchors) {
    if (a.kind !== 'sign' || a.tag !== 'chevrons') continue;
    const p = a.points[0]!;
    const art = chevronBoard(1, 3);
    env.scene.addSplit(
      { art, x: Math.round(p.x) - (art.w >> 1), y: Math.round(p.y) - art.h + 1, baseY: Math.round(p.y) },
      { id: `sign_${a.id}`, kind: 'chevrons', fade: true },
    );
  }

  env.previewCars.push(
    { name: 'start', x: 1100, y: 470 },
    { name: 'north_chicane', x: 2250, y: 560 },
    { name: 'south_chicane', x: 2400, y: 1400 },
    { name: 'spur', x: 3800, y: 900 },
    { name: 'sawmill', x: 1212, y: 1080 },
  );

  const loops = (): AnimatedArt[] => {
    const out: AnimatedArt[] = [];
    const bw = anchor(env, 'birds_woods')?.points[0];
    if (bw) out.push(birdsLoop('woods_birds', Math.round(bw.x), Math.round(bw.y - 120), 9601, 5));
    const lf = anchor(env, 'leaf_fall');
    if (lf) lf.points.forEach((p, k) => out.push(leafFall(`leaf_fall_${k}`, Math.round(p.x), Math.round(p.y), 9700 + k)));
    if (flume) {
      const p = flume.points[0]!;
      const q = flume.points[flume.points.length - 1]!;
      const mx = Math.round((p.x + q.x) / 2) - 70;
      const my = Math.round((p.y + q.y) / 2) - 50;
      out.push(
        regionLoop(env, 'brook_flow', 'water_flow', mx, my, 140, 100, 6, 8, (cv, f) => {
          for (let yy = 0; yy < cv.h; yy++)
            for (let xx = 0; xx < cv.w; xx++) {
              const c = cv.get(xx, yy);
              if (c !== NAT.shallowLight && c !== NAT.foam) continue;
              const on = (xx + yy * 2 + f * 3) % 9 === 0;
              cv.set(xx, yy, on ? NAT.foam : NAT.shallowLight);
            }
        }),
      );
    }
    if (rainy) for (const [k, p] of [[0, saw], [1, stacks]] as const) if (p) out.push(dripLoop(env, `yard_puddles_${k}`, Math.round(p.x), Math.round(p.y)));
    return out;
  };
  void maps;
  return { loops };
}

/** Leaves spiralling down, above the cars. */
function leafFall(id: string, cx: number, cy: number, seed: number): AnimatedArt {
  const W = 120;
  const H = 90;
  const F = 16;
  const colors = [NAT.leafGold, NAT.leafRed, 0x9aa04a, NAT.litterLight];
  const leaves = Array.from({ length: 9 }, (_, k) => ({
    x: hash2(k, 1, seed) * W,
    y0: hash2(k, 2, seed) * H,
    c: colors[k % colors.length]!,
    ph: hash2(k, 3, seed) * Math.PI * 2,
  }));
  const frames: Canvas[] = [];
  for (let f = 0; f < F; f++) {
    const cv = new Canvas(W, H);
    for (const l of leaves) {
      const t = f / F;
      const y = (l.y0 + t * H) % H;
      const x = l.x + Math.sin(t * Math.PI * 4 + l.ph) * 5;
      const flip = Math.floor(f + l.ph) % 2 === 0;
      cv.set(Math.round(x), Math.round(y), l.c);
      cv.set(Math.round(x) + (flip ? 1 : 0), Math.round(y) + (flip ? 0 : 1), darken(l.c, 0.25));
    }
    frames.push(cv);
  }
  return { id, kind: 'leaves', frames, x: cx - W / 2, y: cy - H / 2, fps: 8, above: true, blend: 'normal' };
}

/** Rain rings on the yard's puddles (heavy rain only). */
function dripLoop(env: Env, id: string, cx: number, cy: number): AnimatedArt {
  const x0 = cx - 80;
  const y0 = cy - 50;
  return regionLoop(env, id, 'puddle_rings', x0, y0, 160, 100, 6, 8, (cv, f) => {
    for (let k = 0; k < 40; k++) {
      const x = Math.floor(hash2(k, f, 9800) * cv.w);
      const y = Math.floor(hash2(k, f + 9, 9800) * cv.h);
      if (cv.get(x, y) !== NAT.mudWater) continue;
      cv.set(x, y, lighten(NAT.mudWater, 0.35));
      cv.set(x + 1, y, NAT.mudSheen);
    }
  });
}
