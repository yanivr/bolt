import { sampleBranch, segmentDistance } from '@bolt/shared';
import { TILT } from '../oblique.js';
import { beaconLoop, dustRibbonLoop, flagLoop, heatShimmerLoop, sockLoop } from './anim.js';
import type { Dressing, Env } from './dress.js';
import { distanceTo } from './masks.js';
import { anchor, cornerBoards, count, emptyDressing } from './dress.js';
import { fbm, smooth, vnoise } from './noise.js';
import { PAL, lighter } from './palette.js';
import { fallingRockSign, oreHopper, radioMast, routeSign, watchtower, wreck } from './props.js';
import { fitRise, raiseBoulder, raiseMesas } from './rocks.js';
import { FG_PROP, FG_SIGN, FG_TOWER, M_CLIFF, M_RIDGE } from './stage.js';
import { M_RAIL, RAIL_RISE, raiseBanner } from './structures.js';

/** Tag on cliff pixels that carry the painted chevrons. */
export const TAG_PAINTED = 9;

/**
 * Canyon Switch, high noon or a sandstorm. A bleached plateau straight across the top of the
 * map, a sandy descent down the west, the canyon floor's S-bends between rock walls, and a
 * switchback climbing the east slope behind a guard rail. The canyon's north walls are the
 * tall ones: their faces turn south toward the camera and rise far above the road, their upper
 * part an overlay over the upland behind them. The south walls are the near rim of the canyon,
 * drawn only as high as their own rock allows, so they never stand over the road.
 */
export function dressCanyonSwitch(env: Env): Dressing {
  const { ctx, track, stage, look, masks } = env;
  const def = ctx.def;
  const out = emptyDressing();
  const wallIndex = (id: string): number => def.walls.findIndex((w) => w.id === id);
  const north = new Set([wallIndex('north_wall_a'), wallIndex('north_wall_b')]);
  const south = new Set([wallIndex('south_wall_a'), wallIndex('south_wall_ledge'), wallIndex('south_wall_b')]);
  const rail = wallIndex('switchback_rail');
  const rim = wallIndex('world_edge');
  const painted = anchor(ctx, 'painted_cliff').points[0]!;

  // Canyon walls, column by column on their capsules.
  const { w, h } = stage;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (masks.solid[p] !== 1) continue;
      const owner = masks.owner[p]! - 1;
      if (north.has(owner)) {
        // Tall: 120 to 165 world px, flat-topped buttresses stepping along the wall.
        const n = fbm(x, y, 220, 201, 2);
        const z = 118 + Math.floor(n * 4) * 13 + (vnoise(x, y, 30, 202) > 0.78 ? -14 : 0);
        const nearPaint = Math.hypot(x - painted.x, y - painted.y) < 120;
        stage.raise(x, y, Math.round(z * TILT), M_CLIFF, nearPaint ? TAG_PAINTED : 1);
      } else if (south.has(owner)) {
        // The near rim: a rugged rock ridge as high as its own capsule allows.
        const z = 30 + vnoise(x, y, 11, 203) * 26;
        const r = Math.min(Math.round(z * TILT), fitRise(masks, x, y, 60));
        if (r > 0) stage.raise(x, y, r, M_RIDGE, 2);
      } else if (owner === rail) {
        const wall = def.walls[rail]!;
        let dmin = Infinity;
        for (let k = 0; k + 1 < wall.points.length; k++) {
          const a = wall.points[k]!;
          const b = wall.points[k + 1]!;
          dmin = Math.min(dmin, segmentDistance(x + 0.5, y + 0.5, a.x, a.y, b.x, b.y));
        }
        if (dmin > 1.6) continue;
        // Posts every dozen pixels, the beam between them clear of the ground.
        const post = (x + y) % 12 < 2;
        if (post) stage.raise(x, y, RAIL_RISE, M_RAIL);
        else stage.raiseSlab(x, y, RAIL_RISE - 3, RAIL_RISE, M_RAIL);
      }
    }
  count(out, 'canyon wall', north.size + south.size);
  count(out, 'guard rail');
  dropBeyondRail(env, rail);

  // Boulders; one plateau rock carries a wreck.
  track.obstacles.forEach((o, i) => {
    if (o.id === 'plateau_rocks_4') {
      out.placements.push({ sp: wreck(ctx.seed + i, PAL.paintCoral), gx: Math.round(o.x), gy: Math.round(o.y + 8), kind: FG_PROP, shadow: true });
      raiseBoulder(stage, { ...o, x: o.x - 6, y: o.y - 7, radius: 8 }, i, ctx.seed, 1);
      count(out, 'wreck');
      return;
    }
    raiseBoulder(stage, o, i, ctx.seed, o.id.startsWith('ledge') ? 1.3 : 1);
    count(out, o.id.startsWith('ledge') ? 'fallen rock' : 'boulder');
  });

  // The broken arch: a tongue of rock leaning out from the north wall over the road.
  raiseOverhang(env);
  count(out, 'canyon arch');

  // Mesas behind the canyon rim: tall in the north beyond the plateau, lower elsewhere.
  raiseMesas(stage, (x, y) => {
    const p = y * w + x;
    if (masks.solid[p] === 1 && masks.owner[p]! - 1 !== rim) return 0;
    const n = fbm(x, y, 150, 211, 2);
    const steps = Math.floor(smooth(0.25, 0.75, n) * 3) / 3;
    const northRim = smooth(400, 120, y);
    return steps <= 0 && northRim < 0.5 ? 0 : 55 + steps * 55 + northRim * 50;
  });
  count(out, 'mesa');

  // Signs.
  cornerBoards(track, out);
  count(out, 'chevron board', track.cornerSigns.length);
  const rock = anchor(ctx, 'falling_rock_sign').points[0]!;
  out.placements.push({ sp: fallingRockSign(), gx: Math.round(rock.x), gy: Math.round(rock.y), kind: FG_SIGN, shadow: true });
  const ledge = track.branches.find((b) => b.id === 'ledge_run')!;
  const lp = sampleBranch(track.main, ledge.leaveS - 150);
  out.placements.push({
    sp: routeSign('LEDGE RUN', 1),
    gx: Math.round(lp.x - lp.ty * (lp.halfWidth + lp.shoulder + 16)),
    gy: Math.round(lp.y + lp.tx * (lp.halfWidth + lp.shoulder + 16)),
    kind: FG_SIGN,
    shadow: true,
  });
  count(out, 'warning sign');
  count(out, 'route sign');

  // Landmarks on legs.
  const mastAt = anchor(ctx, 'radio_mast').points[0]!;
  const mast = radioMast(150);
  const mx = Math.round(mastAt.x);
  const my = Math.round(mastAt.y);
  out.placements.push({ sp: mast.sprite, gx: mx, gy: my, kind: FG_TOWER, shadow: true });
  mast.lamps.forEach((l, k) =>
    out.anims.push(beaconLoop(`mast_lamp_${k + 1}`, mx - mast.sprite.ax + l.x, my - mast.sprite.ay + l.y)),
  );
  count(out, 'radio mast');
  const tw = anchor(ctx, 'watchtower').points[0]!;
  out.placements.push({ sp: watchtower(), gx: Math.round(tw.x), gy: Math.round(tw.y), kind: FG_TOWER, shadow: true });
  count(out, 'watchtower');
  const hop = anchor(ctx, 'ore_hopper').points[0]!;
  out.placements.push({ sp: oreHopper(), gx: Math.round(hop.x), gy: Math.round(hop.y), kind: FG_TOWER, shadow: true });
  count(out, 'ore hopper');

  raiseBanner(env, 'CANYON SWITCH');
  count(out, 'start banner');

  // Loops: flags along the plateau, blowing sand, a sock on the switchback crest, the mast.
  const flags = anchor(ctx, 'plateau_flags').points;
  flags.forEach((p, k) => {
    out.anims.push(flagLoop(`plateau_flag_${k + 1}`, Math.round(p.x), Math.round(p.y), look, k % 2 === 0 ? PAL.flagOrange : PAL.signRed, k * 1.7));
  });
  count(out, 'flag', flags.length);
  anchor(ctx, 'dust_ribbons').points.forEach((p, k) => {
    out.anims.push(dustRibbonLoop(`blowing_sand_${k + 1}`, Math.round(p.x), Math.round(p.y), look, env.spec.sand.light, ctx.seed + k * 13));
  });
  const crest = sampleBranch(track.main, track.main.length - 420);
  out.anims.push(sockLoop('wind_sock_crest', Math.round(crest.x + crest.ty * 130), Math.round(crest.y - crest.tx * 130), look));
  count(out, 'wind sock');
  if (look.id === 'desert_dry_heat') {
    for (const f of [0.15, 0.45, 0.75]) {
      const p = sampleBranch(track.main, track.startS - 1600 * f - 200);
      out.anims.push(heatShimmerLoop(`heat_shimmer_${Math.round(f * 100)}`, Math.round(p.x - 90), Math.round(p.y + 40), 180, 1));
    }
  }

  // Review spots.
  const spot = (name: string, s: number, branch = 0): void => {
    const b = track.branches[branch]!;
    const q = sampleBranch(b, s);
    out.previewSpots.push({ name, x: Math.round(q.x), y: Math.round(q.y) });
    out.previewCars.push({
      name,
      x: Math.round(q.x),
      y: Math.round(q.y),
      car: { x: Math.round(q.x + q.ty * 30), y: Math.round(q.y - q.tx * 30), heading: Math.round((Math.atan2(q.tx, -q.ty) / (Math.PI * 2)) * 64 + 64) % 64 },
    });
  };
  spot('start', track.startS + 80);
  spot('plateau', track.startS + 900);
  spot('descent', 3100);
  spot('canyon_s', 4700);
  spot('arch', 5450);
  spot('painted_cliff', 6400);
  spot('switchback', 8300);
  spot('ledge', ledge.length * 0.5, ledge.index);
  out.previewSpots.push({ name: 'mast', x: mx, y: my - 60 });
  out.previewSpots.push({ name: 'hopper', x: Math.round(hop.x), y: Math.round(hop.y - 20) });
  return out;
}

/**
 * The canyon arch: its south leg fell long ago (the ledge's fallen rock is what is left of
 * it); its span still leans out from the north wall over the road, high enough to drive under,
 * as a slab of the height field. Over the road it is an overlay that fades near the player.
 */
function raiseOverhang(env: Env): void {
  const { ctx, track, stage } = env;
  const at = anchor(ctx, 'canyon_arch').points[0]!;
  const s = sampleBranch(track.main, nearestS(track, at.x, at.y));
  const tx = s.tx;
  const ty = s.ty;
  const nx = s.ty; // left of travel: toward the north wall
  const ny = -s.tx;
  const wallAt = s.halfWidth + s.shoulder + 34;
  // A broad shelf at the cliff's own height, its broken edge reaching across most of the road.
  for (let v = -40; v <= wallAt + 24; v++)
    for (let u = -110; u <= 110; u++) {
      // The broken edge: furthest out in the middle, curving back into the wall at both sides.
      const edge =
        -18 + (Math.abs(u) / 110) ** 2 * (wallAt + 30) + (vnoise(u, 0, 11, 302) - 0.5) * 26 + (vnoise(u, 0, 4, 304) - 0.5) * 8;
      if (v < edge) continue;
      const x = Math.round(s.x + tx * u + nx * v);
      const y = Math.round(s.y + ty * u + ny * v);
      if (x < 0 || y < 0 || x >= stage.w || y >= stage.h) continue;
      const p = y * stage.w + x;
      const wall = stage.masks.solid[p] === 1;
      const crown = 150 + (vnoise(x, y, 7, 303) - 0.5) * 6;
      const thick = 34 + Math.max(0, v - edge) * 0.25;
      const top = crown * TILT;
      const bottom = wall ? 0 : Math.max(0, crown - thick) * TILT;
      if (!wall && bottom < 30) continue;
      stage.raiseSlab(x, y, bottom, top, M_CLIFF, 3);
    }
}

/**
 * The drop on the far side of the switchback's guard rail: a bright scree lip right behind the
 * rail, then the ground falling away in two darker steps into the gully, following the rail's
 * own curve. Flat paint on drivable sand (the gully floor is still sand a car can reach).
 */
function dropBeyondRail(env: Env, railIndex: number): void {
  const { masks, ctx, look } = env;
  const { w, h } = masks;
  const field = ctx.field;
  const data = ctx.world.data;
  let x0 = w;
  let y0 = h;
  let x1 = 0;
  let y1 = 0;
  for (let p = 0; p < w * h; p++)
    if (masks.solid[p] === 1 && masks.owner[p] === railIndex + 1) {
      const x = p % w;
      const y = (p / w) | 0;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  if (x1 < x0) return;
  const R = 60;
  const bx0 = Math.max(0, x0 - R);
  const by0 = Math.max(0, y0 - R);
  const bx1 = Math.min(w - 1, x1 + R);
  const by1 = Math.min(h - 1, y1 + R);
  const bw = bx1 - bx0 + 1;
  const bh = by1 - by0 + 1;
  const dist = distanceTo(bw, bh, (q) => {
    const p = (by0 + ((q / bw) | 0)) * w + bx0 + (q % bw);
    return masks.solid[p] === 1 && masks.owner[p] === railIndex + 1;
  });
  // The rail stands 30 px past the shoulder; beyond it is further from the road than that.
  const railEdge = 30 + 12;
  for (let yy = 0; yy < bh; yy++)
    for (let xx = 0; xx < bw; xx++) {
      const x = bx0 + xx;
      const y = by0 + yy;
      const p = y * w + x;
      if (masks.kind[p] !== 0 || masks.solid[p]) continue;
      const e = field.edge[p]!;
      // Only the rail's own side of the road (the rail is on the right of travel).
      if (e < railEdge || e >= 999 || field.lateral[p]! <= 0 || field.branch[p] !== 0) continue;
      const d = dist[yy * bw + xx]!;
      if (d > R) continue;
      // The lip fades out toward the rail's ends: there the ground does not fall away.
      const ends = ctx.def.walls[railIndex]!.points;
      const a = ends[0]!;
      const b = ends[ends.length - 1]!;
      const toEnd = Math.min(Math.hypot(x - a.x, y - a.y), Math.hypot(x - b.x, y - b.y)) - d;
      const band = Math.min(34 + (vnoise(x, y, 17, 611) - 0.5) * 16, toEnd * 0.7);
      if (band <= 4) continue;
      const o = p * 4;
      let c = (data[o]! << 16) | (data[o + 1]! << 8) | data[o + 2]!;
      if (d < 3) c = lighter(c, 0.14);
      else if (d < 5) c = look.shade(look.shade(c));
      else if (d < band) c = look.shade(c);
      else continue;
      data[o] = (c >> 16) & 255;
      data[o + 1] = (c >> 8) & 255;
      data[o + 2] = c & 255;
    }
}

function nearestS(track: Env['track'], x: number, y: number): number {
  const m = track.main;
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < m.count; i++) {
    const d = (m.x[i]! - x) ** 2 + (m.y[i]! - y) ** 2;
    if (d < bd) {
      bd = d;
      best = m.s[i]!;
    }
  }
  return best;
}
