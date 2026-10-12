import { hash2 } from '@bolt/shared';
import type { TrackAnchor, TrackPoint } from '@bolt/shared';
import type { AnimatedArt, BakeContext, BiomeModule, BiomeOutput } from '../biome.js';
import { Canvas } from '../canvas.js';
import type { Color } from '../canvas.js';
import { birdsLoop, regionLoop, smokeLoop } from '../forest/anim.js';
import { distanceField } from '../forest/edt.js';
import { createEnv } from '../forest/env.js';
import type { Env } from '../forest/env.js';
import { finish } from '../forest/finish.js';
import { plantUnreachable } from '../forest/forestKit.js';
import { plantStats, plantTree, seedOf, standSprite } from '../forest/place.js';
import {
  nameBoard,
  paintStart,
  placeCornerSigns,
  placeShortcutSign,
  rockSprite,
} from '../forest/props.js';
import { SURF, paintCorridor } from '../forest/road.js';
import { liftPylon, markerPole, relayMast, snowGun, warmingHut } from '../forest/structures.js';
import { weatherLook } from '../forest/weather.js';
import { iceCracks, paintSnowField, scrapeIceRoad, skateMarks } from './ground.js';
import { SNOW, SNOW_ROAD, shadeSnow } from './palette.js';

/**
 * The snow biome: Whiteout Pass (snow_01) in clear frost and in falling snow. The plowed sprint
 * lane runs between snow banks of real height (the banks are walls in the data, so they stand
 * up in the picture), with snow guns and a warming hut on the north bank and plow poles on the
 * south one; the switchbacks are packed snow; the pond is ice, scraped clear on the racing
 * line, cracked and skated off it; the Snowmobile Trail is soft snow through the pines.
 */

const anchor = (env: Env, id: string): TrackAnchor | undefined =>
  env.ctx.def.anchors.find((a) => a.id === id);

/** Bank pixels of every wall of kind `snowbank`, with their depth from the bank's edge. */
function bankDepth(env: Env): { ids: Set<number>; depth: Float32Array } {
  const { maps, ctx } = env;
  const { w, h } = maps;
  const ids = new Set<number>();
  ctx.def.walls.forEach((wl, k) => {
    if (wl.kind === 'snowbank') ids.add(k + 1);
  });
  const outside = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++)
    outside[i] = maps.reach.solid[i] && ids.has(maps.reach.solidId[i]!) ? 0 : 1;
  return { ids, depth: distanceField(outside, w, h, 64) };
}

/**
 * The snow banks. Each is a wall in the data, so it is solid, and it is drawn as a mound of
 * real height: a bank with the road to its south rises tall, its upper part an overlay over the
 * ground behind it (cut in short pieces, so only the piece by the car fades); a bank with the
 * road to its north stands no taller than its own width, its crest meeting the road edge on
 * screen, as the city's near-side barriers do, so it never hides the road.
 */
function raiseBanks(
  env: Env,
  fresh: number,
  notch: { x: number; y: number; w: number; h: number } | null,
): { ids: Set<number>; depth: Float32Array } {
  const { maps, ctx } = env;
  const { w } = maps;
  const bd = bankDepth(env);
  const { depth, ids } = bd;
  const tones: Color[] = [
    SNOW.powderDeep,
    SNOW.powderShade,
    SNOW.powderMid,
    SNOW.powder,
    SNOW.powderHi,
  ];
  const tall = new Set<number>();
  ctx.def.walls.forEach((wl, k) => {
    if (!ids.has(k + 1)) return;
    const m = wl.points[Math.floor(wl.points.length / 2)]!;
    const south = maps.kind[Math.round(m.y + 30) * w + Math.round(m.x)]! !== 0;
    if (south) tall.add(k + 1);
  });
  const heightAt = (x: number, y: number, max: number): number => {
    const d = depth[y * w + x]!;
    if (d <= 0) return 0;
    const t = Math.min(1, d / 9);
    return Math.round(max * Math.sin((t * Math.PI) / 2) * (0.85 + vnoise2(x, y) * 0.3));
  };
  const topColor = (x: number, y: number, hN: number, hW: number, h0: number): Color => {
    const lit = (h0 - hN) * 0.25 + (h0 - hW) * 0.25 + 0.3;
    const k = lit > 0.9 ? 4 : lit > 0.25 ? 3 : lit > -0.3 ? 2 : 1;
    return hash2(x >> 1, y >> 1, 77) < 0.04 + fresh * 0.05 ? SNOW.sparkle : tones[k]!;
  };
  const faceColor = (x: number, y: number, v: number, top: number): Color => {
    if (v === 0) return SNOW.powderDeep;
    // Plowed snow in strata: a lit lip, then shade deepening toward the foot.
    const h = hash2(x >> 2, (y - v) >> 1, 78);
    if (h < 0.015) return SNOW.iceDark;
    if (v > top * 0.7) return h < 0.3 ? SNOW.drift : SNOW.powderMid;
    if ((v + (x >> 3)) % 6 === 0) return SNOW.powderShade;
    return v < top * 0.3 ? SNOW.powderShade : SNOW.drift;
  };
  // Short banks beside the road on its south: extruded, capped by the road edge.
  env.scene.extrude({
    x0: 0,
    y0: 0,
    x1: maps.w,
    y1: maps.h,
    shadow: 6,
    rise: (x, y) => {
      const i = y * w + x;
      if (!maps.reach.solid[i] || tall.has(maps.reach.solidId[i]!)) return 0;
      return heightAt(x, y, 17);
    },
    top: (x, y) =>
      topColor(x, y, heightAt(x, y - 1, 17), heightAt(x - 1, y, 17), heightAt(x, y, 17)),
    side: (x, y, v) => faceColor(x, y, v, 17),
  });
  // Tall banks: drawn as standing pieces.
  const MAX = 30;
  for (const id of tall) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < maps.w * maps.h; i++) {
      if (!maps.reach.solid[i] || maps.reach.solidId[i] !== id) continue;
      const x = i % w;
      const y = (i / w) | 0;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    const PIECE = 110;
    for (let px = x0; px <= x1; px += PIECE) {
      const pw = Math.min(PIECE, x1 - px + 1);
      const ph = y1 - y0 + 1 + MAX;
      const cv = Canvas.sprite(pw, ph);
      let any = false;
      for (let y = y0; y <= y1; y++)
        for (let x = px; x < px + pw; x++) {
          const i = y * w + x;
          if (!maps.reach.solid[i] || maps.reach.solidId[i] !== id) continue;
          if (
            notch &&
            x >= notch.x - 2 &&
            x < notch.x + notch.w + 2 &&
            y >= notch.y - 3 &&
            y < notch.y + notch.h + 3
          )
            continue;
          const h = heightAt(x, y, MAX);
          // Its shadow on the snow behind it, toward the south-east.
          for (let j = 1; j < h * env.shadowK * 0.9; j++) {
            const q = (y + j) * w + x + j;
            if (q < maps.w * maps.h && !maps.reach.solid[q] && env.shadow[q]! < 2)
              env.shadow[q] = 2;
          }
          const hs = y + 1 <= y1 && maps.reach.solidId[i + w] === id ? heightAt(x, y + 1, MAX) : 0;
          const top = topColor(x, y, heightAt(x, y - 1, MAX), heightAt(x - 1, y, MAX), h);
          const lx = x - px;
          const ly = y - y0 + MAX;
          cv.set(lx, ly - h, top);
          for (let v = h - 1; v >= hs; v--) cv.set(lx, ly - v, faceColor(x, y, v, MAX));
          any = true;
        }
      if (!any) continue;
      env.scene.addSplit(
        { art: cv, x: px, y: y0 - MAX, baseY: y1 },
        { id: `snowbank_${id}_${Math.round(px)}`, kind: 'snowbank', fade: true },
      );
    }
  }
  return bd;
}

function vnoise2(x: number, y: number): number {
  return hash2(x >> 4, y >> 4, 91) * 0.5 + hash2(x >> 3, y >> 3, 92) * 0.5;
}

/** The point on a bank's crest nearest p. */
function crestNear(
  env: Env,
  bd: { depth: Float32Array },
  p: TrackPoint,
  reach = 70,
): TrackPoint | null {
  const { w, h } = env.maps;
  let best: TrackPoint | null = null;
  let bv = 0;
  for (let y = Math.max(0, Math.round(p.y - reach)); y < Math.min(h, p.y + reach); y++)
    for (let x = Math.max(0, Math.round(p.x - reach / 3)); x < Math.min(w, p.x + reach / 3); x++) {
      const d = bd.depth[y * w + x]!;
      const score = d - Math.hypot(x - p.x, y - p.y) * 0.02;
      if (d > 6 && score > bv) {
        bv = score;
        best = { x, y };
      }
    }
  return best;
}

export function paintSnow(ctx: BakeContext): BiomeOutput {
  if (ctx.def.id !== 'snow_01') throw new Error(`The snow module has no art for ${ctx.def.id}`);
  const look = weatherLook(ctx.presetId);
  const fresh = ctx.presetId === 'snow_snowfall' ? 1 : 0;
  const env = createEnv(ctx, look.shadowK);
  const { maps, world } = env;
  paintSnowField(env, fresh);
  paintCorridor(
    env,
    SNOW_ROAD,
    (i) => maps.hazard[i]! > 0 && ctx.def.hazards[maps.hazard[i]! - 1]!.kind === 'deep_mud',
  );
  scrapeIceRoad(env);
  paintStart(env);
  const cracks = anchor(env, 'pond_cracks');
  if (cracks) cracks.points.forEach((p, k) => iceCracks(env, p.x, p.y, 7801 + k, 8));
  const pond = anchor(env, 'frozen_pond')?.points[0];
  if (pond) {
    skateMarks(env, pond.x - 300, pond.y + 120, 7901);
    skateMarks(env, pond.x + 350, pond.y - 40, 7902);
  }
  // Fresh snow in a snowfall settles on the verges and the plowed lane's edges (never the
  // racing surface's middle).
  if (fresh)
    for (let i = 0; i < maps.w * maps.h; i++) {
      if (maps.kind[i] !== 2 || maps.surf[i] === SURF.ice) continue;
      const x = i % maps.w;
      const y = (i / maps.w) | 0;
      if (hash2(x >> 1, y >> 1, 81) < 0.55)
        world.set(x, y, hash2(x, y, 82) < 0.5 ? SNOW.powder : SNOW.powderHi);
    }

  const t0 = performance.now();
  const pre = bankDepth(env);
  let hutSite: { x: number; y: number; w: number; h: number } | null = null;
  const bankN = ctx.def.walls.find((wl) => wl.id === 'bank_n');
  if (bankN) {
    const mid = bankN.points[Math.floor(bankN.points.length * 0.55)]!;
    const c = crestNear(env, pre, mid, 40);
    if (c) {
      const site = { x: Math.round(c.x - 23), y: Math.round(c.y - 7), w: 46, h: 14 };
      let fits = true;
      for (let y = site.y; y < site.y + site.h; y++)
        for (let x = site.x; x < site.x + site.w; x++)
          if (pre.depth[y * maps.w + x]! <= 0.5) fits = false;
      if (fits) hutSite = site;
    }
  }
  const bd = raiseBanks(env, fresh, hutSite);
  const load = fresh ? 1 : 0.82;
  let trees = 0;
  for (const o of ctx.def.obstacles) {
    const seed = seedOf(o.id, o.x, o.y);
    if (o.kind === 'tree') {
      plantTree(
        env,
        { species: hash2(seed, 1, 3) < 0.6 ? 'fir' : 'pine', seed, radius: o.radius, snow: load },
        o.x,
        o.y,
      );
      trees++;
    } else if (o.kind === 'rock')
      standSprite(env, rockSprite(o.radius, seed, o.y, load), o.x, o.y, 'rock');
  }
  const woods = plantUnreachable(env, ['fir', 'pine', 'fir'], 58, 8101, {
    minRoadDist: 200,
    extra: { snow: load },
  });
  env.log.push(`trees    ${trees} pines and firs, ${woods} in the unreachable margin`);

  // On the north bank: snow guns at the anchors' stations, and the warming hut.
  const guns: TrackPoint[] = [];
  const ga = anchor(env, 'snow_guns');
  if (ga)
    for (const p of ga.points) {
      const c = crestNear(env, bd, p);
      if (!c) continue;
      standSprite(env, snowGun(36, Math.PI / 2, c.y), c.x, c.y, 'snow_gun', {
        id: `snow_gun_${guns.length}`,
        kind: 'snow_gun',
        fade: true,
      });
      guns.push(c);
    }
  let hut: TrackPoint | null = null;
  if (hutSite) {
    standSprite(env, warmingHut(hutSite.w, hutSite.h, hutSite.y), hutSite.x, hutSite.y, 'hut', {
      id: 'warming_hut',
      kind: 'hut',
      fade: true,
    });
    env.scene.solid(hutSite.x, hutSite.y, hutSite.w, hutSite.h, 20);
    hut = { x: hutSite.x + hutSite.w - 7, y: hutSite.y + 4 };
  }
  env.log.push(
    `hut      ${hutSite ? `on bank_n at ${hutSite.x},${hutSite.y}` : 'did not fit on bank_n'}`,
  );
  // Plow poles on the south bank, next to their anchors.
  const pm = anchor(env, 'plow_markers');
  if (pm)
    for (const [k, p] of pm.points.entries()) {
      const c = crestNear(env, bd, p, 50);
      if (!c) continue;
      standSprite(env, markerPole(28, c.y), c.x, c.y, 'pole', {
        id: `plow_pole_${k}`,
        kind: 'pole',
        fade: true,
      });
    }
  // The radio relay (thin furniture) and a chairlift line across the infield.
  const rr = anchor(env, 'radio_relay')?.points[0];
  if (rr)
    standSprite(env, relayMast(110, Math.round(rr.y)), Math.round(rr.x), Math.round(rr.y), 'mast', {
      id: 'radio_relay',
      kind: 'mast',
      fade: true,
    });
  // The chairlift: four pylons evenly along its anchor's line (bottom station to top).
  const lift = anchor(env, 'chairlift')?.points;
  const pylons: TrackPoint[] = [];
  if (lift && lift.length >= 2) {
    const [a, b] = [lift[0]!, lift[lift.length - 1]!];
    for (let k = 0; k < 4; k++) {
      const p = {
        x: Math.round(a.x + ((b.x - a.x) * k) / 3),
        y: Math.round(a.y + ((b.y - a.y) * k) / 3),
      };
      if (maps.kind[p.y * maps.w + p.x] !== 0 || maps.roadDist[p.y * maps.w + p.x]! < 30) continue;
      standSprite(env, liftPylon(84, p.y), p.x, p.y, 'pylon', {
        id: `lift_pylon_${k}`,
        kind: 'pylon',
        fade: true,
      });
      pylons.push(p);
    }
    liftCable(env, pylons, 84);
  }
  // Warning boards: ice ahead, crosswind on the pond.
  const pw = ctx.def.hazards.find((hz) => hz.id === 'pond_wind');
  if (pw) {
    const sign = nameBoard('ICE  CROSSWIND', 0xe8b444);
    const s0 = ctx.track.main;
    void s0;
    const p = cracks?.points[0];
    if (p)
      env.scene.addSplit(
        {
          art: sign,
          x: Math.round(p.x) - 30,
          y: Math.round(p.y) - 120,
          baseY: Math.round(p.y) - 100,
        },
        { id: 'sign_pond_wind', kind: 'sign', fade: true },
      );
  }
  env.log.push(`signs    ${placeCornerSigns(env)} corner boards`);
  for (const br of ctx.track.branches.slice(1)) {
    const sc = ctx.def.shortcuts.find((s) => s.id === br.id);
    placeShortcutSign(env, br, (sc?.signName ?? br.id).toUpperCase());
  }
  env.log.push(
    `scene    ${plantStats()}; built in ${((performance.now() - t0) / 1000).toFixed(1)} s`,
  );
  env.previewCars.push(
    { name: 'sprint_lane', x: 1100, y: 470 },
    { name: 'switchbacks', x: 2350, y: 1100 },
    { name: 'pond', x: 1600, y: 1900 },
    { name: 'trail', x: 2900, y: 1100 },
    { name: 'west', x: 700, y: 1200 },
  );

  const loops = (): AnimatedArt[] => {
    const out: AnimatedArt[] = [];
    if (hut)
      out.push(
        smokeLoop('hut_smoke', hut.x, hut.y - 28, 8201, ctx.preset.windX, 0xe8ecf2, 0xa8b0c0),
      );
    guns.forEach((g, k) => out.push(gunLights(`snow_gun_light_${k}`, g, k)));
    if (pond)
      out.push(
        blowingSnow('pond_blowing_snow', pond.x, pond.y, ctx.preset.windX, ctx.preset.windY, 8301),
      );
    if (pond) {
      const x0 = Math.round(pond.x - 200);
      const y0 = Math.round(pond.y - 70);
      out.push(
        regionLoop(env, 'ice_glint', 'ice_sparkle', x0, y0, 400, 140, 8, 8, (cv, f) => {
          for (let k = 0; k < 70; k++) {
            const x = Math.floor(hash2(k, 1, 8401) * cv.w);
            const y = Math.floor(hash2(k, 2, 8401) * cv.h);
            if ((k + f) % 8 > 1) continue;
            const c = cv.get(x, y);
            if (c !== SNOW.ice && c !== SNOW.iceLight && c !== SNOW.iceDark) continue;
            cv.set(x, y, SNOW.iceStreak);
            if ((k + f) % 8 === 0) {
              cv.set(x + 1, y, SNOW.iceStreak);
              cv.set(x, y - 1, SNOW.iceLight);
            }
          }
        }),
      );
    }
    // Snow sliding off branches near the sprint lane.
    const pines = ctx.def.obstacles.filter((o) => o.kind === 'tree');
    for (let k = 0; k < Math.min(4, pines.length); k++) {
      const o = pines[Math.floor((k / 4) * pines.length)]!;
      out.push(branchSnow(`branch_snow_${k}`, o.x, o.y - 50, 8500 + k));
    }
    out.push(birdsLoop('pass_birds', 2300, 700, 8601, 3));
    return out;
  };
  return finish(env, {
    grade: look.grade,
    roadShade: 0.75,
    loops,
    shade: (c, k) => shadeSnow(c, k * look.shadowStrength),
  });
}

function liftCable(env: Env, pylons: readonly TrackPoint[], height: number): void {
  const rise = Math.round(height * 0.62);
  for (let k = 0; k + 1 < pylons.length; k++) {
    const a = pylons[k]!;
    const b = pylons[k + 1]!;
    for (const side of [-12, 12]) {
      const ax = a.x + side + Math.round(rise / 3);
      const ay = a.y - rise;
      const bx = b.x + side + Math.round(rise / 3);
      const by = b.y - rise;
      const x0 = Math.min(ax, bx) - 4;
      const y0 = Math.min(ay, by) - 4;
      const cv = Canvas.sprite(Math.abs(bx - ax) + 10, Math.abs(by - ay) + 24);
      const n = Math.ceil(Math.hypot(bx - ax, by - ay));
      for (let t = 0; t <= n; t++) {
        const f = t / n;
        const sag = Math.sin(f * Math.PI) * 10;
        const x = Math.round(ax + (bx - ax) * f) - x0;
        const y = Math.round(ay + (by - ay) * f + sag) - y0;
        cv.set(x, y, 0x2a2e38);
        // Chairs hang every so often.
        if (t % 70 === 35 && side < 0) {
          cv.vline(x, y + 1, 5, 0x3a3e48);
          cv.rect(x - 2, y + 6, 5, 2, 0xc8443e);
          cv.set(x - 2, y + 8, 0x3a3e48);
          cv.set(x + 2, y + 8, 0x3a3e48);
        }
      }
      env.scene.add({
        art: cv,
        x: x0,
        y: y0,
        baseY: Math.max(a.y, b.y),
        overlay: { id: `lift_cable_${k}_${side < 0 ? 'w' : 'e'}`, kind: 'cable', fade: true },
      });
    }
  }
}

function gunLights(id: string, g: TrackPoint, k: number): AnimatedArt {
  const frames: Canvas[] = [];
  for (let f = 0; f < 4; f++) {
    const cv = new Canvas(5, 5);
    const on = (f + k) % 4 < 2;
    if (on) {
      cv.setA(2, 2, 0xffe08a, 255);
      cv.setA(1, 2, 0xf6c35b, 160);
      cv.setA(3, 2, 0xf6c35b, 160);
      cv.setA(2, 1, 0xf6c35b, 160);
      cv.setA(2, 3, 0xf6c35b, 160);
    } else cv.setA(2, 2, 0x8a6a3a, 255);
    frames.push(cv);
  }
  // The lamp on the gun's post, 26 + 11 units up.
  const rise = Math.round(47 * 0.62);
  return {
    id,
    kind: 'snow_gun_light',
    frames,
    x: g.x - 2 + Math.floor(rise / 3),
    y: g.y - rise - 3,
    fps: 3,
    above: true,
    blend: 'normal',
  };
}

/** Streaks of snow blowing across the pond: the visible wind. */
function blowingSnow(
  id: string,
  cx: number,
  cy: number,
  wx: number,
  wy: number,
  seed: number,
): AnimatedArt {
  const W = 360;
  const H = 150;
  const F = 10;
  const l = Math.hypot(wx, wy) || 1;
  const ux = wx / l;
  const uy = wy / l;
  const frames: Canvas[] = [];
  const streaks = Array.from({ length: 26 }, (_, k) => ({
    x: hash2(k, 1, seed) * W,
    y: hash2(k, 2, seed) * H,
    len: 8 + hash2(k, 3, seed) * 18,
  }));
  for (let f = 0; f < F; f++) {
    const cv = new Canvas(W, H);
    for (const s of streaks) {
      const t = (f / F) * W;
      const x0 = (((s.x + t * ux) % W) + W) % W;
      const y0 = (((s.y + t * uy * 0.6) % H) + H) % H;
      for (let k = 0; k < s.len; k++) {
        const x = Math.round(x0 + ux * k);
        const y = Math.round(y0 + uy * k * 0.6);
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        cv.setA(x, y, 0xf4f8fc, k < 3 || k > s.len - 3 ? 90 : 160);
      }
    }
    frames.push(cv);
  }
  return {
    id,
    kind: 'blowing_snow',
    frames,
    x: Math.round(cx - W / 2),
    y: Math.round(cy - H / 2),
    fps: 10,
    above: true,
    blend: 'normal',
  };
}

/** A puff of snow sliding off a bough and falling. */
function branchSnow(id: string, x: number, y: number, seed: number): AnimatedArt {
  const W = 20;
  const H = 40;
  const F = 12;
  const frames: Canvas[] = [];
  for (let f = 0; f < F; f++) {
    const cv = new Canvas(W, H);
    if (f >= 6) {
      const t = (f - 6) / 6;
      for (let k = 0; k < 7; k++) {
        const px = Math.round(W / 2 + (hash2(k, 1, seed) - 0.5) * 8 * (1 + t));
        const py = Math.round(4 + t * (H - 8) + hash2(k, 2, seed) * 4);
        cv.setA(px, py, 0xf4f8fc, 220 - Math.round(t * 120));
      }
    }
    frames.push(cv);
  }
  return {
    id,
    kind: 'branch_snow',
    frames,
    x: Math.round(x - W / 2),
    y: Math.round(y - H / 2),
    fps: 8,
    above: true,
    blend: 'normal',
  };
}

export const SNOW_BIOME: BiomeModule = {
  biome: 'snow',
  paint: paintSnow,
  presets: ['snow_clear_frost', 'snow_snowfall'],
};
