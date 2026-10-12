import { hash2, sampleBranch } from '@bolt/shared';
import type { TrackAnchor, TrackObstacle } from '@bolt/shared';
import type { AnimatedArt } from '../biome.js';
import { birdsLoop, butterfliesLoop, crop, regionLoop, sparkleLoop } from './anim.js';
import type { Env } from './env.js';
import { put } from './env.js';
import { paintMist, paintMushroomRing, plantBoundaryWoods, plantReach } from './forestKit.js';
import { NAT } from './palette.js';
import { fbm } from './noise.js';
import { castTreeShadow, plantTree, seedOf, standSprite } from './place.js';
import { paintBanks, reedSprite, rockSprite, standReeds, stumpSprite } from './props.js';
import { bridgePortal, millHouse, rowboat, treehouse, waterWheel } from './structures.js';
import type { Species } from './trees.js';
import { buildTree } from './trees.js';
import { POND_WATER, findWater, lilyPads, paintShore, paintWater, shoreReflections, wetEdge } from './water.js';

/**
 * Moss Run's own art: the creek and the mill pond, the mill with its wheel, the timber bridge,
 * the hollow oak, the ranger's treehouse, the marsh, the mushroom ring and the mist in the
 * shaded bends. Everything is placed from the track's data: walls, obstacles and anchors by id.
 */

const anchor = (env: Env, id: string): TrackAnchor | undefined => env.ctx.def.anchors.find((a) => a.id === id);

function nearestTree(env: Env, x: number, y: number): TrackObstacle | null {
  let best: TrackObstacle | null = null;
  let bd = Infinity;
  for (const o of env.ctx.def.obstacles) {
    if (o.kind !== 'tree' || o.radius < 12) continue;
    const d = Math.hypot(o.x - x, o.y - y);
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best;
}

export type MossRunPlan = { loops: () => AnimatedArt[] };

export function paintMossRunWater(env: Env): { dist: Float32Array } {
  findWater(env);
  const creek = anchor(env, 'creek');
  const pts = creek?.points ?? [];
  const flow = (x: number, y: number): { x: number; y: number } | null => {
    // Along the creek's polyline, still in the pond.
    if (pts.length < 2) return null;
    let best: { x: number; y: number } | null = null;
    let bd = Infinity;
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = pts[k]!;
      const b = pts[k + 1]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l = Math.hypot(dx, dy);
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (l * l)));
      const d = Math.hypot(x - a.x - dx * t, y - a.y - dy * t);
      if (d < bd) {
        bd = d;
        best = { x: dx / l, y: dy / l };
      }
    }
    return bd < 150 && y < (pts[pts.length - 1]!.y - 90) ? best : null;
  };
  const dist = paintWater(env, POND_WATER, flow);
  shoreReflections(env, 741, 0x1d3e36);
  wetEdge(env);
  paintShore(env, dist, 721);
  lilyPads(env, dist, 711, 26);
  paintBanks(env, ['water_edge'], 731);
  return { dist };
}

/** Moss Run's raised things and loops. Call after the road is painted. */
export function buildMossRun(env: Env, dist: Float32Array): MossRunPlan {
  const { ctx, maps } = env;
  const { def } = ctx;
  paintWetland(env, 1, 120, 5701);
  const special = new Set<string>();
  // The hollow oak: the nearest tree to its anchor, the oldest in the wood.
  const ho = anchor(env, 'hollow_oak')?.points[0];
  const hollow = ho ? nearestTree(env, ho.x, ho.y) : null;
  if (hollow) {
    special.add(hollow.id);
    plantTree(env, { species: 'oak', seed: 9091, radius: hollow.radius, crownScale: 1.32, hollow: true }, hollow.x, hollow.y);
  }
  // The ranger's treehouse, in the crown of the nearest tree to the hut's anchor.
  const rh = anchor(env, 'ranger_hut')?.points[0];
  const hutTree = rh ? nearestTree(env, rh.x, rh.y) : null;
  if (hutTree && hutTree.id !== hollow?.id) {
    special.add(hutTree.id);
    const placed = plantTree(env, { species: 'oak', seed: 7071, radius: hutTree.radius, crownScale: 1.15 }, hutTree.x, hutTree.y);
    const z = Math.max(22, Math.round(placed.model.trunkTop * 0.8));
    const hut = treehouse(z, hutTree.radius * 0.62, hutTree.y + 30);
    standSprite(env, hut, hutTree.x, hutTree.y, 'canopy');
    env.log.push(`ranger hut in the crown of ${hutTree.id}, ${Math.round(Math.hypot(hutTree.x - rh!.x, hutTree.y - rh!.y))} px from its anchor`);
  }
  // Every other tree: oaks and birches, alders by the water.
  const waterNear = (x: number, y: number): boolean => {
    for (let r = 40; r <= 220; r += 60)
      for (let a = 0; a < 8; a++) {
        const px = Math.round(x + Math.cos(a) * r);
        const py = Math.round(y + Math.sin(a) * r);
        if (px >= 0 && py >= 0 && px < maps.w && py < maps.h && maps.water[py * maps.w + px]) return true;
      }
    return false;
  };
  let trees = 0;
  for (const o of def.obstacles) {
    if (special.has(o.id)) continue;
    const seed = seedOf(o.id, o.x, o.y);
    const r = hash2(seed, 1, 5);
    if (o.kind === 'tree' && o.radius < 12) {
      // The marsh's reed tussocks are solid clumps.
      standReeds(env, o.x, o.y, o.radius, seed, 26);
      continue;
    }
    if (o.kind === 'log') {
      standSprite(env, stumpSprite(o.radius, seed, o.y), o.x, o.y, 'stump');
      continue;
    }
    if (o.kind === 'rock') {
      standSprite(env, rockSprite(o.radius, seed, o.y), o.x, o.y, 'rock');
      continue;
    }
    const wet = waterNear(o.x, o.y);
    const species: Species = wet && r < 0.55 ? 'alder' : r < 0.6 ? 'oak' : 'birch';
    plantTree(env, { species, seed, radius: o.radius }, o.x, o.y);
    trees++;
  }
  env.log.push(`trees    ${trees} on obstacles, hollow oak ${hollow?.id ?? 'none'}`);
  const woods = plantBoundaryWoods(env, ['oak', 'oak', 'birch', 'alder'], 54, 5101);
  env.log.push(`woods    ${woods} trees in the unreachable margin`);
  const inner = plantReach(env, ['alder', 'birch', 'oak'], 5301);
  env.log.push(`pockets  ${inner} trees in unreachable pockets`);

  // Reeds along the banks, standing on the bank walls themselves (solid ground).
  let reeds = 0;
  const swaying: Array<{ x: number; y: number; seed: number; h: number }> = [];
  for (const wall of def.walls) {
    if (wall.kind !== 'water_edge') continue;
    for (let k = 0; k + 1 < wall.points.length + (wall.closed ? 1 : 0); k++) {
      const a = wall.points[k]!;
      const b = wall.points[(k + 1) % wall.points.length]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      for (let t = 10; t < len - 10; t += 28 + hash2(k, t | 0, 41) * 30) {
        if (hash2(k, t | 0, 42) < 0.35) continue;
        const x = Math.round(a.x + ((b.x - a.x) * t) / len);
        const y = Math.round(a.y + ((b.y - a.y) * t) / len);
        const seed = seedOf(wall.id, x, y);
        const h = 18 + hash2(x, y, 3) * 10;
        // One clump in five sways in the breeze (a loop above the cars instead of a still).
        if (reeds % 5 === 2 && swaying.length < 8) swaying.push({ x, y, seed, h });
        else standReeds(env, x, y, 5, seed, h);
        reeds++;
      }
    }
  }
  env.log.push(`reeds    ${reeds} clumps on the banks`);

  // The mill and its wheel, at the wheel's anchor inside the pond.
  const wa = anchor(env, 'water_wheel')?.points[0];
  let wheelFrames: ReturnType<typeof waterWheel>[] = [];
  let wheelAt = { x: 0, y: 0 };
  if (wa) {
    const W = 86;
    const D = 44;
    const mx = Math.round(wa.x - W + 30);
    const my = Math.round(wa.y - D - 2);
    const house = millHouse(W, D, my);
    standSprite(env, house, mx, my, 'mill', { id: 'mill', kind: 'mill', fade: true });
    env.scene.solid(mx, my, W, D, 40);
    // Its reflection: the house upside down on the water below its south wall.
    for (let y = my + D; y < my + D + 30; y++)
      for (let x = mx - 2; x < mx + W + 6; x++) {
        const i = y * maps.w + x;
        if (!maps.water[i]) continue;
        const t = (y - my - D) / 30;
        if (hash2(x, y, 51) < t * 0.6) continue;
        put(env.world, i, t < 0.4 ? 0x2a4a48 : 0x264a4a);
      }
    // A boardwalk from the mill to the western shore.
    wheelAt = { x: mx + W - 28, y: my + D + 1 };
    wheelFrames = Array.from({ length: 8 }, (_, k) => waterWheel(23, 11, k / 8, wheelAt.y));
    const boat = rowboat(26, my + 40);
    standSprite(env, boat, mx - 70, my + 40, 'boat', { id: 'rowboat', kind: 'boat', fade: true });
    for (let y = my + 26; y < my + 36; y++)
      for (let x = mx - 1; x > mx - 260; x--) {
        const i = y * maps.w + x;
        if (!maps.water[i]) break;
        put(env.world, i, (x & 3) === 0 || y === my + 26 || y === my + 35 ? NAT.woodDark : y === my + 27 ? NAT.woodHi : NAT.woodLight);
      }
    env.log.push(`mill     at ${mx},${my}; wheel at ${wheelAt.x},${wheelAt.y}`);
  }

  // The bridge: timber rails on the rail walls, portals at both ends with the name board.
  const mb = anchor(env, 'mill_bridge');
  if (mb && mb.points.length === 2) {
    const rails = def.walls.filter((w) => w.kind === 'rail');
    const railIds = new Set(rails.map((w) => def.walls.indexOf(w) + 1));
    const { solid, solidId } = maps.reach;
    const w = maps.w;
    env.scene.extrude({
      x0: 0,
      y0: 0,
      x1: maps.w,
      y1: maps.h,
      shadow: 3,
      rise: (x, y) => {
        const i = y * w + x;
        return solid[i] && railIds.has(solidId[i]!) ? 8 : 0;
      },
      top: (x) => ((x & 7) === 0 ? NAT.woodDark : NAT.woodHi),
      side: (x, _y, v) => (v === 0 ? NAT.woodDeep : (x & 7) < 2 ? NAT.woodDark : v > 5 ? NAT.wood : null),
    });
    // Plank verge across the bridge: the shoulder between the rails is boarded.
    const s0 = ctx.track.main;
    void s0;
    const [a, b] = mb.points as [{ x: number; y: number }, { x: number; y: number }];
    for (let y = Math.floor(a.y - 110); y < a.y + 110; y++)
      for (let x = Math.floor(Math.min(a.x, b.x)); x < Math.max(a.x, b.x); x++) {
        const i = y * w + x;
        if (maps.kind[i] !== 2) continue;
        put(env.world, i, x % 5 === 0 ? NAT.woodDark : (y & 1) === 0 ? NAT.woodLight : NAT.wood);
      }
    for (let p of [a, b]) {
      // Stand the posts a little inside the bridge, where the rails are.
      const px = Math.round(p.x + (p === a ? 1 : -1) * Math.sign(b.x - a.x) * 8);
      const isRail = (yy: number): boolean => solid[yy * w + px] === 1 && railIds.has(solidId[yy * w + px]!);
      let yN = Math.round(p.y);
      while (yN > p.y - 140 && !isRail(yN)) yN--;
      let yS = Math.round(p.y);
      while (yS < p.y + 140 && !isRail(yS)) yS++;
      if (!isRail(yN) || !isRail(yS)) continue;
      p = { x: px, y: p.y };
      const portal = bridgePortal(yN - Math.round(p.y) - 2, yS - Math.round(p.y) + 3, 46, Math.round(p.y) + 40);
      standSprite(env, portal, Math.round(p.x), Math.round(p.y), 'bridge', {
        id: `bridge_portal_${p.x < (a.x + b.x) / 2 ? 'w' : 'e'}`,
        kind: 'bridge',
        fade: true,
      });
    }
  }

  // Ground details.
  const mr = anchor(env, 'mushroom_ring')?.points[0];
  if (mr) paintMushroomRing(env, mr.x, mr.y, 24, 3301);
  const mist = anchor(env, 'mist_shade');
  if (mist) for (const p of mist.points) paintMist(env, p.x, p.y, 70, 30, 3401);
  void castTreeShadow;
  void buildTree;
  void dist;

  env.previewCars.push(
    { name: 'bridge', x: 1750, y: 520 },
    { name: 'east_bends', x: 2700, y: 1500 },
    { name: 'marsh', x: 1200, y: 1500 },
    { name: 'nw', x: 700, y: 650 },
    { name: 'mill', x: 1700, y: 1150 },
    { name: 'south', x: 2000, y: 2100 },
  );

  const loops = (): AnimatedArt[] => {
    const out: AnimatedArt[] = [];
    if (wheelFrames.length > 0) {
      const f0 = wheelFrames[0]!;
      const x = wheelAt.x - f0.ax;
      const y = wheelAt.y - f0.ay;
      const bg = crop(env, x, y, f0.canvas.w, f0.canvas.h);
      const frames = wheelFrames.map((f) => {
        const cv = bg.crop(0, 0, bg.w, bg.h);
        cv.blit(f.canvas, 0, 0);
        return cv;
      });
      // Frame 0 becomes the baked picture.
      env.world.blit(wheelFrames[0]!.canvas, x, y);
      let onDrive = 0;
      for (let yy = 0; yy < f0.canvas.h; yy++)
        for (let xx = 0; xx < f0.canvas.w; xx++)
          if (f0.canvas.alpha(xx, yy) && maps.reach.drive[(y + yy) * maps.w + x + xx]) onDrive++;
      if (onDrive > 0) throw new Error(`waterwheel covers ${onDrive} drivable pixels`);
      out.push({ id: 'water_wheel', kind: 'water_wheel', frames, x, y, fps: 8, above: false, blend: 'normal' });
    }
    // Sparkle on the creek above and below the bridge, and on the pond.
    const cr = anchor(env, 'creek');
    if (cr) {
      const [p0, p1, p2] = cr.points;
      if (p0 && p1) {
        const s = sparkleLoop(env, 'creek_sparkle_n', Math.round(p1.x - 60), Math.round(p0.y + 30), 120, Math.round(p1.y - p0.y - 120), 811);
        if (s) out.push(s);
      }
      if (p1 && p2) {
        const s = sparkleLoop(env, 'creek_sparkle_s', Math.round(p1.x - 70), Math.round(p1.y + 100), 140, 200, 812);
        if (s) out.push(s);
      }
    }
    const bp = anchor(env, 'birds_pond')?.points[0];
    if (bp) {
      const s = sparkleLoop(env, 'pond_sparkle', Math.round(bp.x - 150), Math.round(bp.y - 90), 300, 140, 813);
      if (s) out.push(s);
      out.push(duckLoop(env, Math.round(bp.x - 30), Math.round(bp.y + 10)));
      out.push(birdsLoop('pond_birds', Math.round(bp.x + 120), Math.round(bp.y - 200), 821));
    }
    const runoff = anchor(env, 'bridge_runoff')?.points[0];
    if (runoff) {
      const x0 = Math.round(runoff.x - 60);
      const y0 = Math.round(runoff.y + 4);
      out.push(
        regionLoop(env, 'bridge_runoff', 'waterfall', x0, y0, 120, 22, 6, 10, (cv, f) => {
          for (let yy = 0; yy < cv.h; yy++)
            for (let xx = 0; xx < cv.w; xx++) {
              const wi = (y0 + yy) * maps.w + x0 + xx;
              if (!maps.water[wi]) continue;
              const h = hash2(xx >> 1, (yy + f * 3) >> 1, 77);
              if (h < 0.22 - yy * 0.008) cv.set(xx, yy, h < 0.06 ? NAT.waterSpark : NAT.foam);
            }
        }),
      );
    }
    swaying.forEach((r, k) => {
      const frames = [0, 1, 2, 1, 0, -1, -2, -1].map((sw) => reedSprite(5, r.seed, r.h, sw * 1.2));
      const f0 = frames[0]!;
      out.push({ id: `reeds_sway_${k}`, kind: 'reeds_sway', frames, x: r.x - (f0.w >> 1), y: r.y - (f0.h - 3), fps: 6, above: true, blend: 'normal' });
    });
    if (mr) {
      out.push(mushroomGlowLoop(env, mr.x, mr.y, 24));
      out.push(butterfliesLoop('ring_butterflies', Math.round(mr.x + 40), Math.round(mr.y - 30), 831));
    }
    return out;
  };
  return { loops };
}

/**
 * Wet ground along a branch (the marsh behind the pond): dark sodden moss, sedge tufts and
 * shallow pools a car can splash through. Flat ground.
 */
function paintWetland(env: Env, branch: number, reach: number, seed: number): void {
  const { maps, world, ctx } = env;
  const { field } = ctx;
  for (let i = 0; i < maps.w * maps.h; i++) {
    if (maps.kind[i] !== 0 || maps.water[i] || field.branch[i] !== branch) continue;
    const e = field.edge[i]!;
    const x = i % maps.w;
    const y = (i / maps.w) | 0;
    const t = e / reach + (fbm(x, y, 50, seed) - 0.5) * 0.6;
    if (t > 1) continue;
    const pn = fbm(x, y, 28, seed + 1);
    let c = t < 0.5 ? NAT.mossDeep : NAT.mossDark;
    if (pn < 0.36 - t * 0.14) c = pn > 0.33 - t * 0.14 ? NAT.soilDark : hash2(x >> 2, y, seed + 2) > 0.9 ? NAT.waterGlint : NAT.shallow;
    else {
      const tuft = hash2(x, Math.floor(y / 4), seed + 3);
      if (tuft < 0.07) c = y % 4 === 0 ? NAT.reedLight : y % 4 < 3 ? NAT.reed : NAT.reedDark;
    }
    put(world, i, c);
  }
}

/** Ducks paddling in a slow circle with ripples behind them. */
function duckLoop(env: Env, x0: number, y0: number): AnimatedArt {
  const { maps } = env;
  const W = 64;
  const H = 34;
  const F = 12;
  return regionLoop(env, 'pond_ducks', 'ducks', x0, y0, W, H, F, 6, (cv, f) => {
    for (let k = 0; k < 3; k++) {
      const a = ((f / F) * Math.PI * 2) / 3 + k * 0.5;
      const dx = Math.round(W / 2 + Math.cos(a) * 18 - k * 9);
      const dy = Math.round(H / 2 + Math.sin(a) * 8);
      drawDuck(cv, dx, dy, k === 0);
      void maps;
    }
  });
}

function drawDuck(cv: ReturnType<typeof crop>, x: number, y: number, drake: boolean): void {
  const body = drake ? 0x8a7a68 : 0x7a6650;
  cv.set(x - 2, y + 1, NAT.foam);
  cv.set(x + 3, y + 1, NAT.waterLight);
  cv.rect(x - 1, y - 1, 4, 2, body);
  cv.set(x - 1, y - 1, 0xa89a84);
  cv.set(x + 2, y - 2, drake ? 0x2e6a48 : 0x5e4a36);
  cv.set(x + 3, y - 2, drake ? 0x2e6a48 : 0x5e4a36);
  cv.set(x + 4, y - 2, 0xe0a83a);
}

/** The mushroom ring breathing: caps glow brighter and fainter in turn. */
function mushroomGlowLoop(env: Env, cx: number, cy: number, r: number): AnimatedArt {
  const x0 = Math.round(cx - r - 6);
  const y0 = Math.round(cy - r - 6);
  const W = Math.round(r * 2 + 12);
  const caps: Array<{ x: number; y: number; k: number }> = [];
  for (let k = 0; k < 22; k++) {
    const a = (k / 22) * Math.PI * 2 + hash2(k, 1, 3301) * 0.2;
    caps.push({ x: Math.round(cx + Math.cos(a) * r) - x0, y: Math.round(cy + Math.sin(a) * r * 0.75) - y0, k });
  }
  return regionLoop(env, 'mushroom_glow', 'glow', x0, y0, W, W, 8, 6, (cv, f) => {
    for (const c of caps) {
      const on = (c.k + f) % 8 < 3;
      if (!on) continue;
      cv.set(c.x, c.y - 1, NAT.mushroomGlowHi);
      cv.set(c.x - 1, c.y, NAT.mushroomGlow);
      cv.set(c.x + 1, c.y, NAT.mushroomGlow);
    }
  });
}

export { sampleBranch };
