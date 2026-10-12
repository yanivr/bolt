import { buildTrack, hash2, sampleBranch, shapeTester } from '@bolt/shared';
import type { TrackRuntime } from '@bolt/shared';
import type { Canvas, Color } from '../canvas.js';
import type { CorridorField } from '../field.js';
import { K_OFFROAD, K_SHOULDER, S_ASPHALT, S_SAND } from './masks.js';
import type { Masks } from './masks.js';
import { vnoise, windNoise } from './noise.js';
import type { Look } from './palette.js';
import { PAL, darker, lighter } from './palette.js';
import type { TerrainSpec } from './spec.js';

/**
 * The stage. Asphalt is dark, bleached tarmac with white edge lines, a yellow center line
 * (dashed on straights, doubled through bends), red and white curbs on the tight corners and
 * the cracks and patches of a desert highway. Sand road is a graded track: pale and smooth,
 * two pairs of wheel ruts, washboard ripples, a windrow berm and white painted stones along
 * each edge. Sand that the wind has laid over the asphalt (the surface zones) is loose dune
 * sand with the paint buried under it, its edge in wind-blown fingers that keep to within a few
 * pixels of the physics boundary. Everything is decided per pixel from the corridor field and
 * the same surface lookup the car uses.
 */

const SEED = 5303;

export type RoadInfo = {
  /** The surface each branch sample was authored with, before the zones were laid over it. */
  authored: Uint8Array[];
  /** Drift coverage (0 to 255) of zone sand over authored asphalt, smoothed. */
  drift: Uint8Array;
  /** Arc length band of the start mat on the main line. */
  startS: number;
  /** 1 inside the soft-sand hazard's own shape, evaluated per pixel. */
  soft: Uint8Array;
};

const surfOf = (s: string): number => (s === 'sand' ? S_SAND : s === 'asphalt' ? S_ASPHALT : 2);

export function planRoad(track: TrackRuntime, masks: Masks, field: CorridorField): RoadInfo {
  // The same track without its zones gives the surface each sample was authored with.
  const bare = buildTrack({ ...track.def, surfaceZones: [] });
  const authored = bare.branches.map((b) => Uint8Array.from(b.surface.map(surfOf)));
  const { w, h } = masks;
  // The zones evaluated at every pixel centre, later zones winning, as the physics stamps
  // them into its 8 px grid: the drawn edge follows the authored band, within half a grid cell
  // of the cell edges the car feels.
  const zonePix = new Uint8Array(w * h);
  for (const zone of track.def.surfaceZones) {
    const t = shapeTester(zone.shape, track.branches);
    const code = zone.surface === 'sand' ? 1 : 2;
    const x0 = Math.max(0, Math.floor(t.bounds.x0));
    const x1 = Math.min(w - 1, Math.ceil(t.bounds.x1));
    const y0 = Math.max(0, Math.floor(t.bounds.y0));
    const y1 = Math.min(h - 1, Math.ceil(t.bounds.y1));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) if (t.contains(x + 0.5, y + 0.5)) zonePix[y * w + x] = code;
  }
  const raw = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    if (masks.kind[p] === K_OFFROAD) continue;
    const a = authored[field.branch[p]!]![field.sample[p]!]!;
    if (zonePix[p] === 1 && a === S_ASPHALT) raw[p] = 1;
  }
  // A 9 px box filter turns the hard mask into a short coverage ramp for the drift's edge.
  const R = 4;
  const tmp = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = -R; x < w + R; x++) {
      if (x + R < w) acc += raw[y * w + x + R]!;
      if (x - R - 1 >= 0) acc -= raw[y * w + x - R - 1]!;
      if (x >= 0 && x < w) tmp[y * w + x] = acc;
    }
  }
  const drift = new Uint8Array(w * h);
  const N = (2 * R + 1) * (2 * R + 1);
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -R; y < h + R; y++) {
      if (y + R < h) acc += tmp[(y + R) * w + x]!;
      if (y - R - 1 >= 0) acc -= tmp[(y - R - 1) * w + x]!;
      if (y >= 0 && y < h) drift[y * w + x] = Math.round((acc * 255) / N);
    }
  }
  const soft = new Uint8Array(w * h);
  for (const hz of track.def.hazards) {
    if (hz.kind !== 'deep_mud') continue;
    const t = shapeTester(hz.shape, track.branches);
    for (let y = Math.max(0, Math.floor(t.bounds.y0)); y <= Math.min(h - 1, Math.ceil(t.bounds.y1)); y++)
      for (let x = Math.max(0, Math.floor(t.bounds.x0)); x <= Math.min(w - 1, Math.ceil(t.bounds.x1)); x++)
        if (t.contains(x + 0.5, y + 0.5)) soft[y * w + x] = 1;
  }
  return { authored, drift, startS: track.startS, soft };
}

function asphaltTone(x: number, y: number): Color {
  // Clustered aggregate: 2 x 2 cells shifted per row pair so nothing lines up.
  const row = y >> 1;
  const xo = x + ((hash2(row, 3, SEED) * 4) | 0);
  const hs = hash2(xo >> 1, row, SEED + 1);
  if (hs < 0.08) return PAL.asphaltDark;
  if (hs > 0.93) return PAL.asphaltLight;
  if (hash2(x, y, SEED + 2) < 0.006) return PAL.asphaltHi;
  return PAL.asphalt;
}

export type RoadOptions = {
  look: Look;
  spec: TerrainSpec;
  /** Shortcut branch ids drawn as a dry riverbed, and as a cliff ledge. */
  washBranch?: string;
  ledgeBranch?: string;
  /** Hazard index (+1 in the masks) of the wash's soft sand. */
  softSandHazard?: number;
  /** 1 where a crosswind zone lies, per pixel: sand creeps over the tarmac there in wind. */
  windZone?: Uint8Array;
  /** Arc lengths (main line) where the yellow center line is left out, for decals. */
  quiet?: Array<[number, number]>;
};

export function paintRoad(
  world: Canvas,
  track: TrackRuntime,
  field: CorridorField,
  masks: Masks,
  info: RoadInfo,
  opts: RoadOptions,
): void {
  const { w, h } = masks;
  const data = world.data;
  const sand = opts.spec.sand;
  const G = opts.spec.grade;
  const main = track.main;
  const L = main.length;
  const startS = track.startS;
  const gridS = startS - 46;
  const washIdx = opts.washBranch ? track.branches.findIndex((b) => b.id === opts.washBranch) : -1;
  const ledgeIdx = opts.ledgeBranch ? track.branches.findIndex((b) => b.id === opts.ledgeBranch) : -1;
  const sc = field.smoothCurvature;
  const wrap = (d: number): number => ((((d + L / 2) % L) + L) % L) - L / 2;
  const put = (p: number, c: Color): void => {
    const o = p * 4;
    data[o] = (c >> 16) & 255;
    data[o + 1] = (c >> 8) & 255;
    data[o + 2] = c & 255;
    data[o + 3] = 255;
  };
  const NW = { x: -Math.SQRT1_2, y: -Math.SQRT1_2 };
  const drift = opts.look.drift;
  const wind = opts.look.wind;

  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const kind = masks.kind[p]!;
      if (kind === K_OFFROAD) continue;
      const b = field.branch[p]!;
      const br = track.branches[b]!;
      const si = field.sample[p]!;
      const ss = field.s[p]!;
      const lat = field.lateral[p]!;
      const hw = field.half[p]!;
      const sh = br.shoulder[si]!;
      const k = field.edge[p]! + sh; // < 0 on the pavement, 0 to `sh` across the shoulder
      const authored = info.authored[b]![si]!;
      const isMain = b === 0;
      const curv = Math.abs(sc[b]![si]!);
      const side = lat > 0 ? 1 : -1;
      // Outward normal of this edge, for lighting the berm and the bank.
      const nx = -br.ty[si]! * side;
      const ny = br.tx[si]! * side;
      const outLit = nx * NW.x + ny * NW.y;

      // --- Shoulder ---------------------------------------------------------------------
      if (kind === K_SHOULDER) {
        let c: Color;
        if (b === washIdx) {
          // A cut bank: a lit or shaded lip, then cobbles and loose sand.
          if (k < 2.2) c = outLit > 0.2 ? sand.dark : outLit < -0.2 ? sand.hi : sand.mid;
          else {
            const hs = hash2(x >> 1, y >> 1, SEED + 30);
            c = hs < 0.07 ? sand.dark : hs < 0.11 ? lighter(sand.light, 0.2) : sand.base;
          }
        } else if (authored === S_ASPHALT) {
          // Compacted verge with gravel; a dark lip right against the tarmac.
          if (k < 1) c = darker(sand.mid, 0.25);
          else {
            const hs = hash2(x >> 1, y >> 1, SEED + 31);
            const t = k / sh;
            c = t < 0.5 ? sand.mid : sand.base;
            if (hs < 0.05 * (1.2 - t)) c = sand.dark;
            else if (hs > 0.95) c = sand.light;
          }
        } else {
          // Windrow berm of loose sand thrown up by the grader.
          if (k < 1) c = G.edge;
          else if (k < 7) {
            const rising = k < 3.5;
            const facing = rising ? -outLit : outLit;
            c = k >= 3 && k < 4 ? sand.hi : facing > 0.15 ? sand.light : facing < -0.15 ? sand.dark : sand.base;
          } else {
            c = sand.base;
            const hs = hash2(x >> 1, y, SEED + 32);
            if (hs < 0.03) c = sand.mid;
          }
          // White painted stones line the outer foot of the berm.
          const m = ss - Math.floor(ss / 40) * 40;
          if (b !== ledgeIdx && k >= 8 && k < 11.5 && m < 4.6)
            c = k >= 10.5 || m >= 3.6 ? PAL.stoneShade : PAL.stone;
        }
        // In a sandstorm the wind lays thin fingers of sand along the verge.
        if (drift > 0.5) {
          // Drifts come in patches; inside one, long fingers stream with the wind.
          const patch = vnoise(x, y, 70, SEED + 35);
          const f = windNoise(x, y, wind, 5, SEED + 33, 0.12);
          if (patch > 0.42 && f > 0.62 - (patch - 0.42) * 0.3) c = f > 0.74 ? sand.light : sand.base;
        }
        put(p, c);
        continue;
      }

      // --- Pavement -------------------------------------------------------------------
      const d = info.drift[p]!;
      let c: Color;
      // Where the drift ends, wind-blown fingers: the threshold wanders along the wind.
      const fin =
        d > 0 && d < 255
          ? (vnoise(x * 0.5 + y * wind.x * 0.4, y * 0.5 - x * wind.y * 0.4, 4, SEED + 41) - 0.5) * 190
          : 0;
      const cover = d + fin;
      if (authored === S_ASPHALT && cover >= 128) {
        // Laid sand: the dunes' own sand blown over the tarmac, rippled across the wind, with a
        // bright upwind lip and a darker downwind one where it thins out.
        const across = x * -wind.y + y * wind.x;
        c = sand.base;
        const q = (x * wind.x + y * wind.y) / 7 + (vnoise(x, y, 23, SEED + 45) - 0.5) * 1.2;
        const fq = q - Math.floor(q);
        if (fq < 0.17 && hash2(Math.floor(q), Math.floor(across / 23), SEED + 43) < 0.62) c = sand.mid;
        else if (fq < 0.3 && hash2(Math.floor(q), Math.floor(across / 23), SEED + 43) < 0.62) c = sand.light;
        // The buried edge line shows where the sand lies thin.
        if (k >= -8 && k < -6 && cover < 175 && hash2(x >> 1, y >> 1, SEED + 44) < 0.45) c = PAL.whiteWorn;
        if (cover < 146) {
          // Which side of the drift this edge is: the gradient of the coverage, against the wind.
          const gxv = info.drift[p + 1]! - info.drift[p - 1]!;
          const gyv = info.drift[p + w]! - info.drift[p - w]!;
          const upwind = gxv * wind.x + gyv * wind.y > 0;
          c = upwind ? sand.hi : sand.mid;
        }
        put(p, c);
        continue;
      }
      if (authored === S_ASPHALT) {
        c = asphaltTone(x, y);
        if (cover > 70 && cover < 128) {
          // The tarmac just outside a drift is dusted with grains, and its edge throws a shadow.
          const hs = hash2(x, y, SEED + 42);
          const t = (cover - 70) / 58;
          if (cover > 118 && k < -10) c = PAL.asphaltDeep;
          else if (hs < t * 0.4) c = hs < t * 0.15 ? sand.base : sand.dark;
        }
        if (isMain) {
          // Transverse thermal cracks, sealed with tar.
          const cc = Math.floor(ss / 46);
          if (hash2(cc, 1, SEED + 51) < 0.3) {
            const sc0 = cc * 46 + hash2(cc, 2, SEED + 51) * 30;
            const wig = Math.sin(lat / 6 + cc) * 1.6;
            const reach = hw * (0.3 + hash2(cc, 3, SEED + 51) * 0.7);
            const from = (hash2(cc, 4, SEED + 51) * 2 - 1) * hw * 0.4;
            if (Math.abs(ss - sc0 - wig) < 0.6 && Math.abs(lat - from) < reach) c = PAL.asphaltDeep;
          }
          // Tar snakes: meandering sealed cracks along the lanes.
          const tc = Math.floor(ss / 180);
          if (hash2(tc, 1, SEED + 52) < 0.4) {
            const l0 = (hash2(tc, 2, SEED + 52) * 2 - 1) * (hw - 22);
            const lm = l0 + Math.sin(ss / 23 + tc * 3) * 5 + Math.sin(ss / 9) * 1.5;
            const u = ss - tc * 180;
            if (u > 20 && u < 150 && Math.abs(lat - lm) < 0.6) c = PAL.asphaltDeep;
          }
          // Rubber on the inside line through bends.
          if (curv > 0.0024) {
            const inside = Math.sign(sc[b]![si]!);
            const lineLat = inside * hw * 0.42;
            const dl = Math.abs(lat - lineLat);
            if (dl < 7 && hash2(x >> 1, y, SEED + 53) < 0.55) c = PAL.asphaltDark;
            else if (dl < 10 && ((x + y) & 1) === 0 && hash2(x >> 2, y >> 1, SEED + 54) < 0.5)
              c = PAL.asphaltDark;
          }
        }
        // Edge lines.
        if (k >= -8 && k < -6) c = hash2(x >> 1, y >> 1, SEED + 55) < 0.18 ? PAL.whiteWorn : PAL.white;
        // Reflector studs on the edge line every 40 px.
        if (isMain && k >= -8 && k < -6 && ss - Math.floor(ss / 40) * 40 < 1.5) c = PAL.stud;
        // Center line: dashed on straights, doubled through bends.
        if (isMain) {
          const quiet = opts.quiet?.some(([a, z]) => ss >= a && ss <= z) ?? false;
          const dbl = curv > 0.0028;
          if (!quiet) {
            if (dbl) {
              if ((lat >= -4 && lat < -2) || (lat >= 2 && lat < 4))
                c = hash2(x >> 1, y >> 1, SEED + 56) < 0.15 ? PAL.yellowWorn : PAL.yellow;
            } else if (lat >= -1.5 && lat < 1.5 && ss - Math.floor(ss / 44) * 44 < 22)
              c = hash2(x >> 1, y >> 1, SEED + 56) < 0.15 ? PAL.yellowWorn : PAL.yellow;
          }
          // Curbs on the tight corners, over the last pixels of tarmac.
          if (curv > 0.0042 && k >= -4) {
            const stripe = (Math.floor(ss / 10) & 1) === 0;
            c = k >= -1 ? (stripe ? PAL.curbRedDark : PAL.curbWhiteDark) : stripe ? PAL.curbRed : PAL.curbWhite;
          }
        } else if (b !== washIdx && b !== ledgeIdx) {
          if (lat >= -1.5 && lat < 1.5 && ss - Math.floor(ss / 44) * 44 < 22) c = PAL.yellow;
        }
        // A dark lip where the tarmac ends, at its edges and where it gives way to sand.
        if (k >= -1 && !(isMain && curv > 0.0042)) c = PAL.asphaltDeep;
        const au = info.authored[b]!;
        const n1 = br.closed ? (si + 1) % br.count : Math.min(br.count - 1, si + 1);
        const n0 = br.closed ? (si - 1 + br.count) % br.count : Math.max(0, si - 1);
        if (au[n1] === S_SAND && br.s[n1]! - ss < 2.5 && br.s[n1]! - ss >= 0) c = PAL.asphaltDeep;
        if (au[n0] === S_SAND && ss - br.s[si]! < 2) c = PAL.asphaltDeep;
        // Wind-blown sand creeping over the edge of the tarmac: thin fingers in the outer
        // dozen pixels only, so the lane and its edge line always show.
        if (drift >= 1 || (drift > 0.5 && opts.windZone?.[p] === 1)) {
          if (k > -13 && vnoise(x, y, 70, SEED + 35) > 0.42) {
            const f = windNoise(x, y, wind, 5, SEED + 34, 0.12);
            if (f > 0.66 + (-k / 13) * 0.22) c = f > 0.78 ? sand.light : sand.base;
          }
        }
      } else if (b === washIdx) {
        // The dry riverbed: pale silt with braided flow lines and cobbles at its banks.
        const soft = info.soft[p] === 1;
        const silt = lighter(sand.base, 0.16);
        c = silt;
        const m1 = Math.abs(lat - 10 * Math.sin(ss / 47) - 4 * Math.sin(ss / 13));
        const m2 = Math.abs(lat + 14 * Math.sin(ss / 61 + 1.3));
        if (m1 < 1.2 || m2 < 0.9) c = sand.mid;
        else if (m1 < 2.6) c = lighter(sand.light, 0.2);
        if (k >= -9) {
          const hs = hash2(x >> 1, y >> 1, SEED + 60);
          if (hs < 0.12) c = hs < 0.05 ? sand.dark : lighter(sand.light, 0.2);
        }
        if (soft) {
          // Soft sand: churned into lumps by spinning wheels, two deep wandering ruts.
          const lump = vnoise(x, y, 3, SEED + 61);
          c = lump > 0.7 ? sand.light : lump < 0.26 ? sand.mid : sand.base;
          if (hash2(x, y, SEED + 62) < 0.03) c = sand.dark;
          const rutA = Math.abs(lat - 11 - Math.sin(ss / 17) * 3 - Math.sin(ss / 5) * 0.8);
          const rutB = Math.abs(lat + 12 - Math.sin(ss / 19 + 2) * 3 - Math.sin(ss / 6) * 0.8);
          const rut = Math.min(rutA, rutB);
          if (rut < 1.2) c = sand.deep;
          else if (rut < 2.6) c = sand.dark;
          else if (rut < 3.6) c = sand.hi;
        }
      } else {
        // Graded sand road: smooth and pale, with worn wheel tracks.
        const ledge = b === ledgeIdx;
        c = ledge ? mixRock(sand.base, opts.spec.rock.light) : G.base;
        const hs = hash2(x >> 1, y >> 1, SEED + 70);
        if (hs < 0.025) c = ledge ? sand.mid : G.mid;
        else if (hs > 0.975) c = ledge ? sand.light : G.hi;
        // Wheel tracks: two lanes, two tracks each, a little darker and compacted.
        const lanes = ledge || hw < 50 ? [0] : [-hw * 0.46, hw * 0.46];
        for (const lc of lanes) {
          for (const off of [-9.5, 9.5]) {
            const dl = Math.abs(lat - lc - off - Math.sin(ss / 70 + lc) * 1.5);
            if (dl < 2.2) c = dl < 0.9 && hash2(x >> 1, y >> 1, SEED + 73) < 0.75 ? (ledge ? sand.dark : G.rut) : ledge ? sand.mid : G.mid;
          }
        }
        // Washboard ripples across the straights: faint bands every six pixels.
        if (curv < 0.002 && !ledge) {
          const m = ss - Math.floor(ss / 7) * 7;
          if (m < 1.1 && c === G.base && hash2(Math.floor(ss / 42), Math.floor((lat + 300) / 26), SEED + 71) < 0.32)
            c = G.mid;
        }
        if (ledge) {
          const hr = hash2(x >> 1, y >> 1, SEED + 72);
          if (hr < 0.02) c = opts.spec.rock.mid;
          else if (hr < 0.03) c = opts.spec.rock.light;
        }
        // A soft furrow marks the edge of the graded surface.
        if (k >= -2) c = ledge ? sand.dark : k >= -1 ? G.edge : G.mid;
      }

      // Start mat, grid boxes and shortcut mouths.
      if (isMain) {
        const u = wrap(ss - startS);
        if (u >= -6 && u < 6 && k < -2) {
          const check = (Math.floor((u + 60) / 6) + Math.floor((lat + 600) / 6)) & 1;
          c = check ? PAL.white : PAL.ink;
        }
        for (const gs of [-1, 1]) {
          const gl = gs * hw * 0.42;
          const v = Math.abs(lat - gl);
          const g = wrap(ss - gridS);
          if (g >= -36 && g < 35 && v < 25 && (g >= 32 || (v >= 22.5 && g >= -4)))
            c = authored === S_ASPHALT ? PAL.white : PAL.stone;
        }
      }
      put(p, c);
    }
}

function mixRock(a: Color, b: Color): Color {
  const r = (((a >> 16) & 255) * 3 + ((b >> 16) & 255)) >> 2;
  const g = (((a >> 8) & 255) * 3 + ((b >> 8) & 255)) >> 2;
  const bl = ((a & 255) * 3 + (b & 255)) >> 2;
  return (r << 16) | (g << 8) | bl;
}

/** World point at an arc length and lateral offset on a branch. */
export function roadPoint(
  track: TrackRuntime,
  branch: number,
  s: number,
  lat: number,
): { x: number; y: number; tx: number; ty: number; hw: number; sh: number } {
  const b = track.branches[branch]!;
  const p = sampleBranch(b, s);
  return { x: p.x - p.ty * lat, y: p.y + p.tx * lat, tx: p.tx, ty: p.ty, hw: p.halfWidth, sh: p.shoulder };
}
