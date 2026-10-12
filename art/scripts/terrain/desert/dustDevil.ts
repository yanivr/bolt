import { sampleBranch } from '@bolt/shared';
import { TILT } from '../oblique.js';
import { dustDevilLoop, heatShimmerLoop, sockLoop, tumbleweedLoop, wheelLoop } from './anim.js';
import type { Dressing, Env } from './dress.js';
import { anchor, cornerBoards, count, emptyDressing } from './dress.js';
import { fbm, smooth, vnoise } from './noise.js';
import { PAL } from './palette.js';
import {
  billboard,
  utilityPole,
  joshua,
  routeSign,
  saguaro,
  tireStack,
  waterTank,
  windPumpTower,
  wreck,
} from './props.js';
import { fitRise, raiseBoulder, raiseMesas } from './rocks.js';
import { powerLine, raiseBanner } from './structures.js';
import { FG_PROP, FG_SIGN, FG_TOWER, M_CLIFF } from './stage.js';

/**
 * Dust Devil, golden afternoon. A bean of sweepers across open desert: half of it graded sand
 * road, half bleached two-lane tarmac with sand drifted over the inside of its bends. The only
 * solids are the rocks and the boundary, so its volume comes from boulders, cacti, a wreck
 * against a rock, tire stacks at Devil's Elbow, the rock arch over the Dry Wash (standing on
 * two of the wash's own rocks) and the mesas that close the map; its landmarks on open sand
 * stand on legs: the windmill, the water tank, the billboard.
 */
export function dressDustDevil(env: Env): Dressing {
  const { ctx, track, stage, look, masks } = env;
  const out = emptyDressing();
  const obs = track.obstacles;
  const wreckIds = new Set(['arc_boulders_3', 'arc_boulders_6']);
  const tireIds = new Set(['elbow_rocks_2', 'elbow_rocks_4']);
  const archFeet = ['wash_rocks_n_2', 'wash_rocks_s_2'];

  obs.forEach((o, i) => {
    if (archFeet.includes(o.id)) return;
    if (o.id.startsWith('climb_cacti')) {
      const k = Number(o.id.split('_').pop());
      const sp = k % 2 === 1 ? saguaro(46 + (k % 3) * 5, ctx.seed + i) : joshua(ctx.seed + i);
      out.placements.push({ sp, gx: Math.round(o.x), gy: Math.round(o.y + 3), kind: FG_PROP, shadow: true });
      count(out, k % 2 === 1 ? 'saguaro' : 'joshua tree');
    } else if (wreckIds.has(o.id)) {
      out.placements.push({
        sp: wreck(ctx.seed + i, i % 2 === 0 ? PAL.paintTeal : PAL.paintBlue),
        gx: Math.round(o.x),
        gy: Math.round(o.y + 9),
        kind: FG_PROP,
        shadow: true,
      });
      raiseBoulder(stage, { ...o, x: o.x + 8, y: o.y - 8, radius: 9 }, i, ctx.seed, 1);
      count(out, 'wreck');
    } else if (tireIds.has(o.id)) {
      for (const [dx, dy, n] of [
        [-6, 2, 3],
        [6, 3, 2],
        [0, 9, 3],
      ] as const)
        out.placements.push({
          sp: tireStack(n, n === 3),
          gx: Math.round(o.x + dx),
          gy: Math.round(o.y + dy),
          kind: FG_PROP,
          shadow: true,
        });
      count(out, 'tire stack', 3);
    } else {
      raiseBoulder(stage, o, i, ctx.seed, 1);
      count(out, 'boulder');
    }
  });

  // The rock arch over the Dry Wash springs from two of its rocks.
  const a = obs.find((o) => o.id === archFeet[0]);
  const b = obs.find((o) => o.id === archFeet[1]);
  if (a && b) {
    // Buttresses: the two foot rocks, taller than the others.
    raiseBoulder(stage, a, obs.indexOf(a), ctx.seed + 5, 2.2);
    raiseBoulder(stage, b, obs.indexOf(b), ctx.seed + 6, 2.2);
    raiseArch(env, a, b);
    count(out, 'rock arch');
  }

  // Mesas behind the boundary; taller, twin buttes in the two northern corners.
  const W = stage.w;
  raiseMesas(stage, (x, y) => {
    const n = fbm(x, y, 140, 71, 2);
    const corner = Math.max(
      smooth(700, 200, Math.hypot(x - 0, y - 0)),
      smooth(700, 200, Math.hypot(x - W, y - 0)),
    );
    const steps = Math.floor(smooth(0.3, 0.75, n) * 3) / 3;
    const base = steps <= 0 ? 0 : 50 + steps * 60;
    return Math.max(base, corner * 135 * (vnoise(x, y, 60, 72) > 0.25 ? 1 : 0.6));
  });
  count(out, 'mesa');

  cornerBoards(track, out);
  count(out, 'chevron board', track.cornerSigns.length);
  const wash = anchor(ctx, 'dry_wash_sign').points[0]!;
  out.placements.push({ sp: routeSign('DRY WASH', 1), gx: Math.round(wash.x), gy: Math.round(wash.y), kind: FG_SIGN, shadow: true });
  const elbow = anchor(ctx, 'devils_elbow_sign').points[0]!;
  out.placements.push({ sp: routeSign("DEVIL'S ELBOW", 0), gx: Math.round(elbow.x), gy: Math.round(elbow.y), kind: FG_SIGN, shadow: true });
  count(out, 'route sign', 2);

  const bb = anchor(ctx, 'bleached_billboard').points[0]!;
  out.placements.push({ sp: billboard(), gx: Math.round(bb.x), gy: Math.round(bb.y), kind: FG_PROP, shadow: true });
  count(out, 'billboard');

  const pump = anchor(ctx, 'wind_pump').points[0]!;
  const tower = windPumpTower();
  const px = Math.round(pump.x);
  const py = Math.round(pump.y);
  out.placements.push({ sp: tower.sprite, gx: px, gy: py, kind: FG_TOWER, shadow: true });
  out.anims.push(wheelLoop('wind_pump_wheel', px - tower.sprite.ax + tower.hub.x, py - tower.sprite.ay + tower.hub.y, look));
  out.placements.push({ sp: waterTank(), gx: px + 42, gy: py + 10, kind: FG_TOWER, shadow: true });
  count(out, 'windmill');
  count(out, 'water tank');

  // A power line on wooden poles along the outside of the southern arc.
  const feet: Array<{ x: number; y: number }> = [];
  for (let s = 200; s < 2700; s += 170) {
    const p = sampleBranch(track.main, s);
    const lat = -(p.halfWidth + p.shoulder + 82);
    const fx = p.x - p.ty * lat;
    const fy = p.y + p.tx * lat;
    if (masks.solid[Math.round(fy) * masks.w + Math.round(fx)]) continue;
    feet.push({ x: fx, y: fy });
  }
  out.draws.push(powerLine(env, feet, utilityPole(), look.drop));
  count(out, 'utility pole', feet.length);

  // Start banner across the graded road.
  raiseBanner(env, 'DUST DEVIL');
  count(out, 'start banner');

  // Loops.
  for (const id of ['wind_sock_arc', 'wind_sock_rise']) {
    const p = anchor(ctx, id).points[0]!;
    out.anims.push(sockLoop(id, Math.round(p.x), Math.round(p.y), look));
    count(out, 'wind sock');
  }
  anchor(ctx, 'dust_devil_flats').points.forEach((p, k) => {
    out.anims.push(dustDevilLoop(`dust_devil_${k + 1}`, Math.round(p.x), Math.round(p.y), look, ctx.seed + k * 31, env.spec.sand.light));
  });
  const tw = anchor(ctx, 'tumbleweed_path').points;
  for (let k = 0; k + 1 < tw.length; k++) {
    const from = tw[k]!;
    const to = tw[k + 1]!;
    // Each loop crosses part of the leg, downwind.
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    const ax = { x: mid.x - look.wind.x * 140, y: mid.y - look.wind.y * 140 };
    const bx = { x: mid.x + look.wind.x * 140, y: mid.y + look.wind.y * 140 };
    out.anims.push(tumbleweedLoop(`tumbleweed_${k + 1}`, ax, bx, look));
  }
  const haze = anchor(ctx, 'heat_haze_arc').points;
  haze.forEach((p, k) => {
    if (k % 2 === 1) return;
    out.anims.push(heatShimmerLoop(`heat_shimmer_${k / 2 + 1}`, Math.round(p.x - 70), Math.round(p.y - 6), 140, look.id === 'desert_clear' ? 1 : 0.6));
  });

  // Review spots: the start, both drifts, the dip and the wash, the arch, the rise, the elbow.
  const at = (s: number, lat = 0): { x: number; y: number } => {
    const p = sampleBranch(track.main, s);
    return { x: p.x - p.ty * lat, y: p.y + p.tx * lat };
  };
  const spot = (name: string, s: number): void => {
    const p = at(s);
    const q = sampleBranch(track.main, s);
    out.previewSpots.push({ name, x: Math.round(p.x), y: Math.round(p.y) });
    out.previewCars.push({
      name,
      x: Math.round(p.x),
      y: Math.round(p.y),
      car: { x: Math.round(p.x + q.ty * 30), y: Math.round(p.y - q.tx * 30), heading: Math.round((Math.atan2(q.tx, -q.ty) / (Math.PI * 2)) * 64 + 64) % 64 },
    });
  };
  spot('start', track.startS + 60);
  spot('west_drift', 3400);
  spot('dip', 5300);
  spot('rise_drift', 6500);
  spot('elbow', 7650);
  spot('elbow_sand', 8250);
  spot('arc', 2000);
  const arch = anchor(ctx, 'rock_arch').points[0]!;
  out.previewSpots.push({ name: 'rock_arch', x: Math.round(arch.x), y: Math.round(arch.y) });
  out.previewSpots.push({ name: 'billboard', x: Math.round(bb.x), y: Math.round(bb.y - 30) });
  out.previewSpots.push({ name: 'wind_pump', x: px, y: py - 20 });
  void TILT;
  void fitRise;
  void M_CLIFF;
  return out;
}

/**
 * A sandstone arch as a slab of the height field: solid from its underside up to its top,
 * springing from inside two rock discs and spanning the wash between them. Its feet are in the
 * ground layer; the span over the sand goes to an overlay, so a car passes under it.
 */
function raiseArch(env: Env, a: { x: number; y: number; radius: number }, b: { x: number; y: number; radius: number }): void {
  const { stage } = env;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const H = 104;
  const x0 = Math.floor(Math.min(a.x, b.x) - 60);
  const x1 = Math.ceil(Math.max(a.x, b.x) + 60);
  const y0 = Math.floor(Math.min(a.y, b.y) - 40);
  const y1 = Math.ceil(Math.max(a.y, b.y) + 40);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if (x < 0 || y < 0 || x >= stage.w || y >= stage.h) continue;
      const px = x + 0.5 - a.x;
      const py = y + 0.5 - a.y;
      const t = (px * ux + py * uy) / len;
      if (t < -0.06 || t > 1.06) continue;
      const tt = Math.max(0, Math.min(1, t));
      const e = Math.abs(2 * tt - 1);
      // The arch bows to the east in plan, so its curve shows from the south.
      const bow = (1 - e * e) * 22;
      const d = Math.abs(px * -uy + py * ux + bow);
      const inDisc =
        Math.hypot(x + 0.5 - a.x, y + 0.5 - a.y) <= a.radius ||
        Math.hypot(x + 0.5 - b.x, y + 0.5 - b.y) <= b.radius;
      const half = (inDisc ? 12 : 9 + e * 4) + (vnoise(x, y, 7, 881) - 0.5) * 4;
      if (d > half) continue;
      // Steep legs and a flat-topped span: a window arch.
      const top = H * Math.pow(1 - Math.pow(e, 8), 0.35) + 6 - (d / half) * 6 + (vnoise(x, y, 4, 883) - 0.5) * 3;
      const under = (H - 26) * Math.pow(Math.max(0, 1 - Math.pow(e, 6)), 0.5) + (vnoise(x, y, 5, 882) - 0.5) * 5;
      const bottom = inDisc ? 0 : Math.max(0, under) * TILT;
      // Over sand a car can reach only the span high enough to drive under is kept: the arch
      // stands on the ground only inside the two rock discs.
      const reach = stage.masks.reach[y * stage.w + x] === 1;
      if (reach && bottom < 24) continue;
      stage.raiseSlab(x, y, bottom, top * TILT, M_CLIFF, 7);
    }
}
