import { hash2, mulberry32 } from '@bolt/shared';
import type { TrackObstacle } from '@bolt/shared';
import type { Color } from '../canvas.js';
import { LEAN_RUN, TILT } from '../oblique.js';
import type { Masks } from './masks.js';
import { vnoise } from './noise.js';
import type { Look, RockRamp } from './palette.js';
import { PAL, STRATA, VARNISH, darker, lighter } from './palette.js';
import { M_BOULDER, M_CLIFF, M_MESA, M_PILLAR, M_RIDGE } from './stage.js';
import type { HitInfo, MassPainter, Stage } from './stage.js';

/**
 * Rock in the height field: boulders standing inside their own collision discs, the mesa
 * cliffs that close the map behind the boundary wall, and (for Canyon Switch) the canyon walls
 * along their capsules. One painter colors every hit: tops by their slope against the light,
 * south faces in strata bands at fixed heights so neighbouring cliffs line up, west faces a
 * step lighter, and anything in the shadow of a taller mass a hard step down.
 */

/**
 * Tallest rise the column on ground pixel (x, y) may have before its leaning top would be drawn
 * over ground a car can reach. Used to keep boulders inside their own discs.
 */
export function fitRise(masks: Masks, x: number, y: number, limit: number): number {
  const { w, h, reach } = masks;
  for (let v = 1; v <= limit; v++) {
    const sx = x + Math.floor(v / LEAN_RUN);
    const sy = y - v;
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) return v - 1;
    if (reach[sy * w + sx]) return v - 1;
  }
  return limit;
}

/**
 * A boulder (or a cluster of two or three) on an obstacle's disc. Each rock is a convex,
 * faceted solid: the lowest of a crown plane and a ring of tilted planes, so it breaks into
 * crisp flat facets, each lit once from the north-west. Every column is clipped so the whole
 * rock, top included, stays inside the disc: what the car sees of the rock is what it hits.
 * `tag` carries the facet's light step for the painter.
 */
export function raiseBoulder(stage: Stage, o: TrackObstacle, index: number, seed: number, scale = 1): void {
  const rnd = mulberry32((seed ^ (index * 2654435761)) >>> 0);
  const r = o.radius;
  type Rock = { x: number; y: number; rx: number; ry: number; top: number; planes: Array<[number, number, number, number]> };
  const rocks: Rock[] = [];
  const n = r >= 16 ? 1 + Math.floor(rnd() * 3) : 1 + Math.floor(rnd() * 2);
  for (let k = 0; k < n; k++) {
    const main = k === 0;
    const a = rnd() * Math.PI * 2;
    const d = main ? r * 0.1 : r * (0.4 + rnd() * 0.22);
    const rr = main ? r * (0.86 + rnd() * 0.1) : r * (0.36 + rnd() * 0.18);
    const top = (main ? r * 1.15 : r * 0.62) * scale * (0.85 + rnd() * 0.3);
    const planes: Rock['planes'] = [];
    const facets = 6 + Math.floor(rnd() * 3);
    const turn = rnd() * Math.PI * 2;
    for (let f = 0; f < facets; f++) {
      const th = turn + (f / facets) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
      // z = top * lift - slope * (distance along th): every facet reaches the ground near the rim.
      const slope = (top / (rr * 0.62)) * (0.75 + rnd() * 0.5);
      const lift = 1.05 + rnd() * 0.5;
      planes.push([Math.cos(th), Math.sin(th), slope, lift]);
    }
    rocks.push({ x: o.x + Math.cos(a) * d, y: o.y + Math.sin(a) * d * 0.6 + r * 0.22, rx: rr, ry: rr * 0.78, top, planes });
  }
  const L = { x: -0.55, y: -0.55, z: 0.63 };
  const x0 = Math.floor(o.x - r - 2);
  const x1 = Math.ceil(o.x + r + 2);
  const y0 = Math.floor(o.y - r - 2);
  const y1 = Math.ceil(o.y + r + 2);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if (x < 0 || y < 0 || x >= stage.w || y >= stage.h) continue;
      if (stage.masks.reach[y * stage.w + x]) continue;
      let best = 0;
      let tone = 2;
      for (const rk of rocks) {
        const dx = x + 0.5 - rk.x;
        const dy = y + 0.5 - rk.y;
        if ((dx / rk.rx) ** 2 + (dy / rk.ry) ** 2 > 1) continue;
        let z = rk.top;
        let nx = 0;
        let ny = 0;
        for (const [cx, cy, sl, lift] of rk.planes) {
          const v = rk.top * lift - sl * (dx * cx + dy * cy);
          if (v < z) {
            z = v;
            nx = sl * cx;
            ny = sl * cy;
          }
        }
        if (z <= best) continue;
        best = z;
        const nz = 1 / Math.hypot(nx, ny, 1);
        const lit = (nx * L.x + ny * L.y + L.z) * nz;
        tone = lit > 0.86 ? 0 : lit > 0.74 ? 1 : lit > 0.56 ? 2 : lit > 0.36 ? 3 : 4;
      }
      if (best <= 0) continue;
      const rise = Math.min(Math.round(best * TILT), fitRise(stage.masks, x, y, 120));
      if (rise > 0) stage.raise(x, y, rise, M_BOULDER, tone);
    }
}

/**
 * Mesa cliffs on the unreachable land behind the boundary wall. Their tops are flat with a
 * broken rim; the walls rise from the wall's inner foot. Each column stays inside the
 * unreachable land, so the cliffs never stand over sand a car can reach.
 */
export function raiseMesas(
  stage: Stage,
  heightAt: (x: number, y: number) => number,
  material = M_MESA,
): void {
  const { w, h, masks } = stage;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (masks.reach[p] || masks.solid[p] === 2) continue;
      const z = heightAt(x, y);
      if (z <= 0) continue;
      const rise = Math.min(Math.round(z * TILT), fitRise(masks, x, y, 250));
      if (rise > 0) stage.raise(x, y, rise, material, 0);
    }
}

export type RockLook = { rock: RockRamp; look: Look };

/** The single painter for every height-field hit. */
export function rockPainter({ rock, look }: RockLook): MassPainter {
  const ramp = [rock.hi, rock.light, rock.base, rock.mid, rock.dark, rock.deep];
  return (mat: number, hit: HitInfo, stage: Stage): Color => {
    const { gx, gy, r } = hit;
    let c: Color;
    if (hit.face === 0) {
      // Top: slope against the light from the north-west.
      const e = stage.riseAt(gx + 1, gy) - stage.riseAt(gx - 1, gy);
      const s = stage.riseAt(gx, gy + 1) - stage.riseAt(gx, gy - 1);
      const lit = e + s;
      if (mat === M_BOULDER) {
        // The facet's own light step, with a lit rim where the rock's outline meets the sky.
        const step = stage.tag[gy * stage.w + gx]!;
        c = ramp[Math.min(5, step)]!;
        if (stage.riseAt(gx - 1, gy) === 0 || stage.riseAt(gx, gy - 1) === 0) c = ramp[Math.max(0, step - 1)]!;
        if (hash2(gx, gy, 311) < 0.025) c = ramp[Math.min(5, step + 1)]!;
      } else if (mat === M_PILLAR || (mat === M_CLIFF && stage.floor[gy * stage.w + gx]! > 0 && stage.tag[gy * stage.w + gx] === 7)) {
        // Spans over open air (the arches): shaded by their slope like a boulder.
        const step = lit > 1.5 ? 0 : lit > 0.3 ? 1 : lit > -0.6 ? 2 : lit > -1.8 ? 3 : 4;
        c = ramp[step]!;
      } else {
        // Mesa and cliff tops: a flat cap, a bright rim where the top breaks off, scrub.
        const rimN = stage.riseAt(gx, gy - 1) < r - 6;
        const rimW = stage.riseAt(gx - 1, gy) < r - 6;
        const rimS = stage.riseAt(gx, gy + 1) < r - 6;
        c = rock.light;
        if (vnoise(gx, gy, 16, 4411) > 0.7) c = mixHalf(rock.light, rock.base);
        if (rimN || rimW) c = rock.hi;
        else if (rimS) c = lighter(rock.light, 0.15);
        const sc = hash2(gx >> 1, gy >> 1, 4412);
        const slab = stage.floor[gy * stage.w + gx]! > 0;
        if (!rimN && !rimS && !slab && sc < 0.012) c = darker(rock.mid, 0.2);
        else if (!rimN && !rimS && sc > 0.994) c = PAL.sageDark;
      }
    } else if (mat === M_BOULDER || mat === M_PILLAR) {
      // Boulder sides: the west face in light, the south face in shade, a dark foot.
      const v = r;
      if (hit.face === 2) c = v <= 1 ? rock.mid : rock.base;
      else c = v <= 1 ? rock.ink : v <= 2 ? rock.deep : rock.dark;
    } else {
      // Cliff and mesa faces: strata bands by height, fissures, desert varnish from the rim.
      const top = stage.riseAt(gx, gy);
      const wobble = Math.floor(vnoise(gx, 0, 23, 4413) * 4);
      const band = Math.floor((r + wobble) / 7) % STRATA.length;
      const [light, dark] = STRATA[band]!;
      const col = gx >> 1;
      const fis = hash2(Math.floor(gx / 3), 7, 4414);
      let tone = hash2(col, Math.floor((r + wobble) / 7), 4415) < 0.5 ? light : dark;
      if (hit.face === 2) tone = lighter(light, 0.12);
      // The band seam: a thin dark ledge line every band.
      if ((r + wobble) % 7 === 0) tone = darker(dark, 0.18);
      // Vertical fissures.
      if (fis < 0.14 && (gx % 3 === 0)) tone = darker(dark, 0.32);
      // Varnish streaks run down from the rim.
      const streak = hash2(gx, 3, 4416);
      if (streak < 0.16 && top - r < 6 + Math.floor(streak * 90)) tone = mixVarnish(tone);
      // The foot of a wall is shadowed by the scree it stands in.
      if (r <= 2) tone = darker(dark, 0.3);
      if (mat === M_RIDGE) tone = darker(tone, 0.06);
      // Painted chevrons on the cliff at Canyon Switch's last S: yellow arrows on black.
      if (mat === M_CLIFF && hit.face === 1 && stage.tag[gy * stage.w + gx] === 9 && r >= 10 && r < 34) {
        const u = ((gx % 16) + 16) % 16;
        const v = r - 10;
        const arrow = Math.abs(v - 11.5) * 0.85 + u;
        tone = arrow >= 3 && arrow < 8 ? PAL.signYellow : arrow >= 2 && arrow < 9 ? PAL.signBlack : darker(PAL.signBlack, 0.1);
        if (v === 0 || v === 23) tone = PAL.signBlack;
      }
      if (mat === M_CLIFF && hit.face === 1) tone = darker(tone, 0.04);
      c = tone;
    }
    if (hit.shaded) c = look.castShade(c);
    return c;
  };
}

function mixHalf(a: Color, b: Color): Color {
  return ((((a >> 16) & 255) + ((b >> 16) & 255)) >> 1 << 16) | ((((a >> 8) & 255) + ((b >> 8) & 255)) >> 1 << 8) | (((a & 255) + (b & 255)) >> 1);
}

function mixVarnish(c: Color): Color {
  const r = (((c >> 16) & 255) + ((VARNISH >> 16) & 255) * 2) / 3;
  const g = (((c >> 8) & 255) + ((VARNISH >> 8) & 255) * 2) / 3;
  const b = ((c & 255) + (VARNISH & 255) * 2) / 3;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

export { M_CLIFF, M_RIDGE };
