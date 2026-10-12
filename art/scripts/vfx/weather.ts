import type { WeatherAnimManifest, WeatherAtlasManifest, WeatherLayer } from '@bolt/shared';
import { hash2 } from '@bolt/shared';
import type { PixelBuffer, RGBA } from '../lib/pixels.js';
import { hex } from '../lib/pixels.js';
import type { FxStrip, Put } from './kit.js';
import { ICE, VAPOR, burstLobes, cloud, directional, fx, line, tumble, vnoise } from './kit.js';
import { packAtlas } from './pack.js';

/**
 * The weather and environment atlas (`vfx_weather`): rain in three planes, splashes, spray and
 * rooster tails, wet and snow tracks, reflection streaks, snowflakes, ice glints, frost, sand
 * streaks, grit and dust bands, plumes off every surface, tumbleweeds and dust devils, heat
 * shimmer, leaves and needles, light shafts, mist, steam, smoke, sparks and embers.
 *
 * The same house rules as the combat atlas (docs/VFX_GUIDE.md): hard pixels from a few ramps,
 * no gradient, shapes that point somewhere baked per heading, nothing rotated or scaled at run
 * time. Alpha is used only where the guide allows it (marks on the road, reflections and other
 * light on the ground); a translucent cloud such as mist or haze is opaque in the atlas and
 * drawn at a fixed alpha step by the runtime. Seeded hashes only: a second bake is identical.
 */

export type WeatherStrip = { strip: FxStrip; layer: WeatherLayer };

const ramp = (...colors: string[]): RGBA[] => colors.map((c) => hex(c));

/** Lightest first. Rain is cool and blue: never white, so it never reads as snow. */
const RAIN = ramp('#dfe9f7', '#b4c5de', '#8a9fc0', '#61779b');
const SPRAY = ramp('#eef4fa', '#c6d3e3', '#97a9c1', '#6a7c94');
/** Snow leans blue-violet in its shadows (Section 12.10), and is never a full white field. */
const SNOW = ramp('#ffffff', '#e6efff', '#c0d2ee', '#8c9fcc');
const FROST = ramp('#ffffff', '#e2f0ff', '#b4d0ee', '#84a4d2');
const SAND = ramp('#f3ddac', '#e2c48a', '#c9a468', '#a6824e', '#7a5d3e');
const SAND_HI = hex('#fcf2da');
const DIRT = ramp('#c9a87c', '#a3825c', '#7b5f43', '#55412f');
const MUD = ramp('#7c5b3d', '#5b412a', '#3d2b1b');
const GRAVEL = ramp('#cfc8b8', '#9c968a', '#605b53');
const LEAF_GREEN = ramp('#a6d672', '#62a247', '#376d35');
const LEAF_OLIVE = ramp('#cfc565', '#918c3d', '#5d5a2b');
const LEAF_AMBER = ramp('#f2b654', '#c97a31', '#8a4b25');
const NEEDLE = ramp('#c08a54', '#7c5232');
const SMOKE = ramp('#cfd1dc', '#a3a7ba', '#767b92', '#50546b');
const EMBER = ramp('#fff3b0', '#ffd35a', '#ff9a3c', '#f0602c');
const SHAFT = ramp('#fff2c6', '#d8cba0');
/** Additive light: white is full strength, the grays are dimmer steps. Tinted at run time. */
const LIGHT = ramp('#ffffff', '#c4c4c4', '#8a8a8a', '#505050');
const MARK_WET: RGBA = [16, 22, 36, 132];
const MARK_SNOW_DARK: RGBA = hex('#7f90b6', 220);
const MARK_SNOW_RIDGE: RGBA = hex('#f6f9ff', 230);
const MARK_SAND: RGBA = hex('#9a7a4e', 150);
const MARK_MUD: RGBA = hex('#33241a', 168);
const TWIG = hex('#4b3a27');
const SHADOW: RGBA = [24, 18, 14, 96];

function wx(layer: WeatherLayer, strip: FxStrip): WeatherStrip {
  return { strip, layer };
}

/** A one-pixel ellipse outline, optionally broken into arcs. */
function ellipse(
  put: Put,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  c: RGBA,
  fill = 1,
  seed = 0,
): void {
  const steps = Math.max(12, Math.round((rx + ry) * 4));
  for (let k = 0; k < steps; k++) {
    const a = (k / steps) * Math.PI * 2;
    if (fill < 1 && hash2(Math.floor((k / steps) * 8), seed, 41) > fill) continue;
    put(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, c);
  }
}

// --- Rain ---------------------------------------------------------------------------------------

/**
 * A falling streak, pointing the way it travels. Two lengths a plane. The far plane is short
 * dashes in the darkest blue, the middle a clean one-pixel line, the near plane a long line
 * with a two-pixel bright head and a gap in its tail, so the three read as depth and not noise.
 */
function rainStreak(id: string, size: number, lengths: number[], plane: 0 | 1 | 2): FxStrip {
  return directional(id, size, 32, lengths.length, { fps: 1 }, (u, v, ctx) => {
    const len = lengths[ctx.frame]!;
    const half = len / 2;
    if (u < -half || u > half) return null;
    const head = u > half - (plane === 2 ? 2 : 1);
    const width = plane === 2 && head ? 0.95 : 0.5;
    if (Math.abs(v) >= width) return null;
    if (plane === 2 && u < -half + len * 0.35 && u > -half + len * 0.2) return null;
    const k = (u + half) / len;
    if (plane === 0) return k > 0.5 ? RAIN[2]! : RAIN[3]!;
    if (plane === 1) return head ? RAIN[0]! : k > 0.4 ? RAIN[1]! : RAIN[2]!;
    return head ? RAIN[0]! : k > 0.55 ? RAIN[1]! : RAIN[2]!;
  });
}

function splashes(): WeatherStrip[] {
  const ring = fx('splash_ring', 11, 6, 4, { fps: 18, anchor: [5, 3] }, (f, put) => {
    if (f === 0) {
      put(5, 3, RAIN[0]!);
      put(4, 2, RAIN[1]!);
      put(6, 2, RAIN[1]!);
      put(5, 1, RAIN[2]!);
    } else if (f === 1) {
      ellipse(put, 5.5, 3.5, 2.4, 1, RAIN[1]!);
      put(3, 1, RAIN[1]!);
      put(7, 0, RAIN[2]!);
    } else if (f === 2) ellipse(put, 5.5, 3.5, 3.8, 1.3, RAIN[1]!, 0.9, 3);
    else ellipse(put, 5.5, 3.5, 5, 1.6, RAIN[2]!, 0.6, 5);
  });
  const big = fx('splash_big', 17, 9, 5, { fps: 16, anchor: [8, 5] }, (f, put) => {
    const crown = [
      [-3, -2],
      [-1, -3],
      [1, -3],
      [3, -2],
      [-4, 0],
      [4, 0],
    ];
    if (f <= 1) {
      for (const [dx, dy] of crown)
        put(8 + dx! * (1 + f * 0.5), 5 + dy! * (1 + f * 0.6), RAIN[f === 0 ? 0 : 1]!);
      ellipse(put, 8.5, 5.5, 2 + f * 1.5, 1 + f * 0.7, RAIN[1]!);
    } else {
      ellipse(put, 8.5, 5.5, 3.5 + f * 1.3, 1.7 + f * 0.6, RAIN[f < 4 ? 1 : 2]!, 1 - f * 0.15, f);
      if (f === 2) for (const [dx] of crown) put(8 + dx! * 2, 1, RAIN[2]!);
    }
  });
  const mud = fx('splash_mud', 7, 5, 3, { fps: 16, anchor: [3, 3] }, (f, put) => {
    if (f === 0) {
      put(3, 3, MUD[0]!);
      put(2, 2, MUD[1]!);
      put(4, 2, MUD[1]!);
    } else ellipse(put, 3.5, 3.5, 1.5 + f, 0.8 + f * 0.5, MUD[f === 1 ? 0 : 1]!, 0.8, f);
  });
  const drip = fx('drip', 3, 6, 3, { fps: 14, anchor: [1, 5] }, (f, put) => {
    const y = f * 2;
    put(1, y, RAIN[2]!);
    put(1, y + 1, RAIN[0]!);
  });
  return [wx('ground', ring), wx('ground', big), wx('ground', mud), wx('air', drip)];
}

/**
 * Water thrown off the tires: a puff of fine mist that opens and thins, a scatter of droplets
 * and the rooster tail behind a fast car, a long fan pointing back along the car's line.
 */
function spray(): WeatherStrip[] {
  const puff = fx('spray_puff', 14, 11, 5, { fps: 14 }, (f, put) => {
    const lobes = burstLobes(7, 6, 4, 11, 1.2 + f * 1.1, 2.4 + f * 0.7, f * 0.4);
    cloud(put, 14, 11, lobes, {
      seed: 23,
      ramp: SPRAY,
      thresholds: [0.55, 0.3, 0.1],
      noise: 0.25,
      grain: 2.5,
      z: f * 0.7,
      erode: 0.12 + f * 0.17,
    });
  });
  const drops = fx('spray_drops', 11, 9, 4, { fps: 16 }, (f, put) => {
    for (let k = 0; k < 9 - f; k++) {
      const a = hash2(k, 3, 7) * Math.PI * 2;
      const d = 1 + f * 1.3 + hash2(k, 4, 7) * 2;
      put(5.5 + Math.cos(a) * d * 1.2, 4.5 + Math.sin(a) * d * 0.8, SPRAY[k % 3 === 0 ? 0 : 1]!);
    }
  });
  const rooster = directional('rooster', 30, 16, 4, { fps: 18, loop: true }, (u, v, ctx) => {
    // The fan runs along +u from the wheel and widens as it goes: four arcs of droplets that
    // march outward a frame at a time, over a short bright sheet of water at the wheel.
    if (u < 0 || u > 14) return null;
    if (u < 3 && Math.abs(v) < 0.6 + u * 0.3) return SPRAY[1]!;
    for (let a = 0; a < 4; a++) {
      const u0 = 2.5 + ((a * 3 + ctx.frame * 0.75) % 12);
      if (Math.abs(u - u0) > 0.55) continue;
      const w = 0.8 + u0 * 0.36;
      const n = 2 + Math.floor(u0 / 4);
      for (let j = -n; j <= n; j++) {
        const vj = (j / n) * w + (hash2(a, j + 9, 31) - 0.5) * 0.8;
        if (Math.abs(v - vj) < 0.55) return u0 < 6 ? SPRAY[0]! : u0 < 10 ? SPRAY[1]! : SPRAY[2]!;
      }
    }
    return null;
  });
  return [wx('kick', puff), wx('kick', drops), wx('kick', rooster)];
}

/** Marks the wheels leave: a dark wet line, a groove in snow with its bright ridge, a sand rut. */
function tracks(): WeatherStrip[] {
  const mark = (id: string, draw: (v: number) => RGBA | null) =>
    directional(id, 12, 16, 1, { fps: 1 }, (u, v) => (Math.abs(u) > 5 ? null : draw(v)));
  return [
    wx(
      'wet',
      mark('track_wet', (v) => (Math.abs(v) < 1 ? MARK_WET : null)),
    ),
    wx(
      'wet',
      mark('track_snow', (v) =>
        Math.abs(v) < 0.7 ? MARK_SNOW_DARK : v > 0.7 && v < 1.5 ? MARK_SNOW_RIDGE : null,
      ),
    ),
    wx(
      'wet',
      mark('track_sand', (v) => (Math.abs(v) < 1 ? MARK_SAND : null)),
    ),
    wx(
      'wet',
      mark('track_mud', (v) => (Math.abs(v) < 1.1 ? MARK_MUD : null)),
    ),
  ];
}

/**
 * Light on wet ground, additive and tinted at run time: a streak broken into short blocks that
 * swap between two frames (Section 13.5: reflections broken into short blocky streaks), in
 * four lengths for a tail lamp, a headlight, a muzzle flash and a blast or a street lamp.
 */
function reflections(): WeatherStrip[] {
  const out: WeatherStrip[] = [];
  const lengths = [6, 10, 16, 26];
  lengths.forEach((len, n) => {
    const s = fx(`refl_${n}`, 3, len, 2, { fps: 7, loop: true, anchor: [1, 0] }, (f, put) => {
      for (let y = 0; y < len; y++) {
        // Blocks of two or three pixels with one-pixel gaps that move between the frames.
        const block = Math.floor((y + f * 2) / 3);
        if ((y + f * 2) % 3 === 2 && y > 1) continue;
        const k = y / len;
        const c = k < 0.3 ? LIGHT[0]! : k < 0.65 ? LIGHT[1]! : LIGHT[2]!;
        put(1, y, c);
        if (k < 0.5 && hash2(block, f, 17 + n) > 0.45)
          put(hash2(block, f, 19) > 0.5 ? 0 : 2, y, LIGHT[2]!);
      }
    });
    s.blend = 'add';
    out.push(wx('shine', s));
  });
  const pool = fx('refl_pool', 11, 5, 2, { fps: 4, loop: true }, (f, put) => {
    for (let y = 0; y < 5; y++)
      for (let x = 0; x < 11; x++) {
        const d = Math.hypot((x + 0.5 - 5.5) / 5.5, (y + 0.5 - 2.5) / 2.5);
        if (d > 1) continue;
        if ((x + y + f) % 2 === 1 && d > 0.45) continue;
        put(x, y, d < 0.45 ? LIGHT[2]! : LIGHT[3]!);
      }
  });
  pool.blend = 'add';
  out.push(wx('shine', pool));
  return out;
}

// --- Snow and ice -----------------------------------------------------------------------------

/**
 * Stepped crystalline flakes, one fixed frame each (Section 13.5): a dim dot for the far plane,
 * a bright dot, a two-pixel flake, a plus, and two six-armed crystals for the near plane.
 */
function snow(): WeatherStrip[] {
  const shade = hex('#6c7cae');
  const flake = fx('flake', 5, 5, 6, { fps: 1 }, (f, put) => {
    // Each flake carries one blue-violet shadow pixel below it, so it reads on white snow too.
    if (f === 0) put(2, 2, SNOW[1]!);
    else if (f === 1) {
      put(2, 2, SNOW[0]!);
      put(2, 3, shade);
    } else if (f === 2) {
      put(2, 2, SNOW[0]!);
      put(3, 2, SNOW[0]!);
      put(2, 3, SNOW[1]!);
      put(3, 3, shade);
    } else if (f === 3) {
      put(2, 2, SNOW[0]!);
      for (const [x, y] of [
        [1, 2],
        [3, 2],
        [2, 1],
      ])
        put(x!, y!, SNOW[1]!);
      put(2, 3, shade);
    } else if (f === 4) {
      put(2, 2, SNOW[0]!);
      for (const [x, y] of [
        [2, 1],
        [1, 2],
        [3, 2],
      ])
        put(x!, y!, SNOW[0]!);
      for (const [x, y] of [
        [2, 0],
        [0, 2],
        [4, 2],
      ])
        put(x!, y!, SNOW[2]!);
      put(2, 3, SNOW[1]!);
      put(2, 4, shade);
    } else {
      put(2, 2, SNOW[0]!);
      for (const [x, y] of [
        [1, 1],
        [3, 1],
      ])
        put(x!, y!, SNOW[0]!);
      for (const [x, y] of [
        [1, 3],
        [3, 3],
      ])
        put(x!, y!, SNOW[2]!);
      for (const [x, y] of [
        [0, 0],
        [4, 0],
      ])
        put(x!, y!, SNOW[2]!);
      put(0, 4, shade);
      put(4, 4, shade);
    }
  });
  const kick = fx('snow_kick', 16, 12, 5, { fps: 14 }, (f, put) => {
    const lobes = burstLobes(8, 7, 5, 37, 1.5 + f * 1.3, 2.6 + f * 0.8, f * 0.5);
    cloud(put, 16, 12, lobes, {
      seed: 41,
      ramp: SNOW,
      thresholds: [0.6, 0.35, 0.15],
      noise: 0.28,
      grain: 2.5,
      z: f * 0.6,
      erode: f < 2 ? 0 : (f - 1) * 0.15,
      rim: 0.35,
      rimColor: hex('#7a8cbc'),
    });
  });
  const chip = fx('ice_chip', 3, 3, 2, { fps: 10 }, (f, put) => {
    put(1, 1, ICE[f === 0 ? 0 : 1]!);
    put(1, 0, ICE[2]!);
    put(0, 1, ICE[3]!);
    put(2, 1, ICE[2]!);
    put(1, 2, ICE[3]!);
  });
  const glint = fx('ice_glint', 9, 9, 5, { fps: 14 }, (f, put) => {
    const arm = [0, 1, 3, 4, 1][f]!;
    put(4, 4, ICE[0]!);
    for (let k = 1; k <= arm; k++) {
      const c = k === 1 ? ICE[0]! : k < 3 ? ICE[1]! : ICE[2]!;
      put(4 + k, 4, c);
      put(4 - k, 4, c);
      if (k <= Math.max(1, arm - 1)) {
        put(4, 4 + k, c);
        put(4, 4 - k, c);
      }
    }
    if (f === 2)
      for (const [x, y] of [
        [3, 3],
        [5, 5],
        [3, 5],
        [5, 3],
      ])
        put(x!, y!, ICE[2]!);
  });
  glint.blend = 'add';
  const fog = fx('fog_puff', 28, 15, 6, { fps: 8 }, (f, put) => {
    const lobes = burstLobes(14, 8, 5, 53, 3 + f * 1.6, 4.4 + f * 0.6, f * 0.3);
    cloud(put, 28, 15, lobes, {
      seed: 59,
      ramp: FROST,
      thresholds: [0.65, 0.35, 0.12],
      heat: -0.15,
      noise: 0.3,
      grain: 3,
      z: f * 0.5,
      erode: 0.1 + f * 0.13,
    });
  });
  return [
    wx('air', flake),
    wx('kick', kick),
    wx('kick', chip),
    wx('shine', glint),
    wx('ground', fog),
  ];
}

/**
 * The frosted edge of the screen: fern-like crystals that grow in from the border, densest at
 * the very edge and gone a few pixels in. Two variants per edge and per corner; the runtime
 * tiles them along the border at a low alpha step and leaves out any near either car.
 */
function frost(): WeatherStrip[] {
  const out: WeatherStrip[] = [];
  /**
   * One frost crystal: a spine grown from (x, y) along `angle`, throwing side branches at
   * sixty degrees that throw their own, with a bright root and dimmer, bluer tips.
   */
  const grow = (
    put: Put,
    x: number,
    y: number,
    angle: number,
    len: number,
    gen: number,
    seed: number,
  ) => {
    let px = x;
    let py = y;
    for (let s = 0; s < len; s++) {
      px += Math.cos(angle);
      py += Math.sin(angle);
      const c =
        gen === 0 ? (s < len * 0.5 ? FROST[0]! : FROST[1]!) : gen === 1 ? FROST[1]! : FROST[2]!;
      put(px, py, c);
      if (gen < 2 && s > 1 && s % 3 === 1) {
        const side = hash2(s, gen, seed) > 0.5 ? 1 : -1;
        const child = len * (gen === 0 ? 0.42 : 0.5) * (0.7 + hash2(s, gen, seed + 1) * 0.5);
        grow(put, px, py, angle + side * (Math.PI / 3), child, gen + 1, seed + s * 7);
        if (hash2(s, gen, seed + 2) > 0.55)
          grow(put, px, py, angle - side * (Math.PI / 3), child * 0.7, gen + 1, seed + s * 11);
      }
    }
    put(px, py, FROST[3]!);
  };
  /** A strip of the screen's border with crystals growing in from its top edge. */
  const edge = (put: Put, w: number, depth: number, n: number, seed: number) => {
    for (let k = 0; k < n; k++) {
      const x = (k + 0.2 + hash2(k, seed, 1) * 0.6) * (w / n);
      const angle = Math.PI / 2 + (hash2(k, seed, 2) - 0.5) * 0.9;
      grow(put, x, -1, angle, depth * (0.6 + hash2(k, seed, 3) * 0.5), 0, seed + k * 31);
    }
  };
  for (let v = 0; v < 2; v++) {
    const seed = 101 + v * 17;
    const top = fx(`frost_top_${v}`, 40, 12, 1, { fps: 1, anchor: [0, 0] }, (_f, put) =>
      edge(put, 40, 12, 4, seed),
    );
    const bottom = fx(`frost_bottom_${v}`, 40, 12, 1, { fps: 1, anchor: [0, 11] }, (_f, put) =>
      edge((x, y, c) => put(x, 11 - y, c), 40, 12, 4, seed + 3),
    );
    const left = fx(`frost_left_${v}`, 12, 40, 1, { fps: 1, anchor: [0, 0] }, (_f, put) =>
      edge((x, y, c) => put(y, x, c), 40, 12, 4, seed + 5),
    );
    const right = fx(`frost_right_${v}`, 12, 40, 1, { fps: 1, anchor: [11, 0] }, (_f, put) =>
      edge((x, y, c) => put(11 - y, x, c), 40, 12, 4, seed + 7),
    );
    out.push(wx('screen', top), wx('screen', bottom), wx('screen', left), wx('screen', right));
  }
  /** A corner: the densest frost, crystals fanning in from both edges and the corner itself. */
  const corner = (id: string, flipX: boolean, flipY: boolean, anchor: [number, number]) =>
    fx(id, 40, 40, 1, { fps: 1, anchor }, (_f, put) => {
      const p: Put = (x, y, c) => put(flipX ? 39 - x : x, flipY ? 39 - y : y, c);
      for (let k = 0; k < 3; k++) {
        const a = 0.3 + k * 0.48;
        grow(p, -1, -1, a, 15 + hash2(k, 3, 211) * 8, 0, 211 + k * 13);
      }
      edge(p, 40, 8, 2, 223);
      edge((x, y, c) => p(y, x, c), 40, 8, 2, 227);
    });
  out.push(
    wx('screen', corner('frost_corner_tl', false, false, [0, 0])),
    wx('screen', corner('frost_corner_tr', true, false, [39, 0])),
    wx('screen', corner('frost_corner_bl', false, true, [0, 39])),
    wx('screen', corner('frost_corner_br', true, true, [39, 39])),
  );
  return out;
}

// --- Sand, dust and heat -----------------------------------------------------------------------

function sand(): WeatherStrip[] {
  const streak = directional('sand_streak', 20, 32, 2, { fps: 1 }, (u, v, ctx) => {
    const len = ctx.frame === 0 ? 8 : 15;
    if (Math.abs(u) > len / 2 || Math.abs(v) >= 0.5) return null;
    // A pale grain at the head, a tan tail broken into grains.
    const k = (u + len / 2) / len;
    if (k < 0.55 && Math.floor(u + 20) % 3 === 0) return null;
    return k > 0.8 ? SAND_HI : k > 0.45 ? SAND[0]! : SAND[2]!;
  });
  const grit = fx('grit', 2, 2, 3, { fps: 1, anchor: [0, 0] }, (f, put) => {
    if (f === 0) put(0, 0, SAND[3]!);
    else if (f === 1) put(0, 0, SAND_HI);
    else {
      put(0, 0, SAND[1]!);
      put(1, 0, SAND[4]!);
    }
  });
  const band = directional('dust_band', 64, 16, 1, { fps: 1 }, (u, v) => {
    // A ribbon of drifting sand along the wind: thick in the middle, thinning to the ends,
    // ragged at the sides, with streaks of paler sand running along it.
    const half = 30;
    if (Math.abs(u) > half) return null;
    const body = Math.sqrt(1 - (u / half) ** 2);
    const edge = 2 + body * 5 + (vnoise(u / 5 + 40, 3, 0, 61) - 0.5) * 3;
    if (Math.abs(v) > edge) return null;
    const grain = vnoise(u / 6 + 40, v / 1.1 + 40, 0, 67);
    if (grain < 0.32 + (1 - body) * 0.3) return null;
    return grain > 0.7 ? SAND_HI : grain > 0.5 ? SAND[0]! : SAND[1]!;
  });
  const haze = [0, 1, 2].map((n) =>
    directional(`haze_${n}`, 64, 16, 1, { fps: 1 }, (u, v) => {
      // A broad drift of dust lying along the wind, ragged at its sides and ends: overlapping
      // drifts on a lattice make the haze, in a few fixed alpha steps chosen at run time.
      const half = 30 - n * 2;
      if (Math.abs(u) > half) return null;
      const body = Math.sqrt(1 - (u / half) ** 2);
      const wob = (vnoise(u / 7 + 10 * n, 5, 0, 81 + n) - 0.5) * 8;
      const edge = 4 + body * (9 + n * 2) + wob;
      if (Math.abs(v + wob * 0.4) > edge) return null;
      const grain = vnoise(u / 8 + 20, v / 1.5 + 20 * n, 0, 83 + n);
      if (grain < 0.22) return null;
      return grain > 0.62 ? hex('#ffffff') : hex('#e4e4e4');
    }),
  );
  const plume = fx('dust_plume', 20, 15, 6, { fps: 12 }, (f, put) => {
    const lobes = burstLobes(10, 9, 5, 83, 2 + f * 1.4, 3 + f * 0.75, f * 0.6);
    cloud(put, 20, 15, lobes, {
      seed: 89,
      ramp: SAND,
      thresholds: [0.7, 0.5, 0.3, 0.12],
      heat: -0.1,
      noise: 0.18,
      grain: 4,
      z: f * 0.6,
      erode: f < 3 ? 0 : (f - 2) * 0.12,
      rim: 0.12,
      rimColor: SAND[3]!,
    });
  });
  const dirt = fx('dirt_puff', 13, 10, 5, { fps: 13 }, (f, put) => {
    const lobes = burstLobes(6.5, 6, 4, 97, 1.4 + f * 1.1, 2.4 + f * 0.6, f * 0.4);
    cloud(put, 13, 10, lobes, {
      seed: 101,
      ramp: DIRT,
      thresholds: [0.6, 0.35, 0.15],
      noise: 0.3,
      grain: 2.5,
      z: f * 0.7,
      erode: 0.08 + f * 0.16,
      rim: 0.22,
      rimColor: DIRT[3]!,
    });
  });
  const mud = fx('mud_fleck', 3, 3, 3, { fps: 1 }, (f, put) => {
    put(1, 1, MUD[1]!);
    if (f >= 1) put(2, 1, MUD[0]!);
    if (f >= 2) {
      put(1, 2, MUD[2]!);
      put(0, 1, MUD[1]!);
    }
  });
  const gravel = fx('gravel', 2, 2, 2, { fps: 1, anchor: [0, 0] }, (f, put) => {
    put(0, 0, GRAVEL[f === 0 ? 0 : 1]!);
    if (f === 1) {
      put(1, 0, GRAVEL[0]!);
      put(1, 1, GRAVEL[2]!);
    }
  });
  const tumble = fx('tumbleweed', 14, 14, 8, { fps: 14, loop: true }, (f, put) => {
    tumbleShape(put, f);
  });
  const shadow = fx('tumble_shadow', 12, 4, 1, { fps: 1 }, (_f, put) => {
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 12; x++)
        if (Math.hypot((x + 0.5 - 6) / 6, (y + 0.5 - 2) / 2) <= 1) put(x, y, SHADOW);
  });
  const devil = fx('dust_devil', 26, 42, 8, { fps: 10, loop: true, anchor: [13, 40] }, (f, put) => {
    for (let y = 0; y < 42; y++) {
      const k = y / 41;
      const half = 2 + (1 - k) * 9 + Math.sin(k * 7 + f * 0.8) * 1.2;
      const cx = 13 + Math.sin(k * 4.5 + f * (Math.PI / 4)) * 2.2 * (1 - k);
      for (let x = 0; x < 26; x++) {
        const dx = x + 0.5 - cx;
        if (Math.abs(dx) > half) continue;
        // Bands spiral round the funnel: a phase that climbs with height and turns with time.
        const phase = (dx / half + y * 0.11 - f / 8 + 4) % 1;
        if (phase > 0.42) continue;
        if (hash2(x, y, f + 7) < 0.25) continue;
        put(x, y, Math.abs(dx) > half * 0.7 ? SAND[3]! : phase < 0.2 ? SAND[1]! : SAND[2]!);
      }
    }
    for (let x = 4; x < 22; x++) if (hash2(x, f, 9) > 0.45) put(x, 41, SAND[3]!);
  });
  const shimmer = fx('heat_shimmer', 30, 7, 6, { fps: 9, loop: true }, (f, put) => {
    // Distant atmospheric flicker only (Section 13.5): a few broken rows that slide a pixel.
    for (const row of [1, 3, 5]) {
      const shift = Math.round(Math.sin((f / 6) * Math.PI * 2 + row) * 1.5);
      for (let x = 0; x < 30; x++) {
        const seg = Math.floor((x + shift + row * 3) / 5);
        if (hash2(seg, row, 23) < 0.45) continue;
        if ((x + shift) % 5 === 4) continue;
        put(x, row, LIGHT[row === 3 ? 2 : 3]!);
      }
    }
  });
  shimmer.blend = 'add';
  return [
    wx('air', streak),
    wx('air', grit),
    wx('ground', band),
    ...haze.map((h) => wx('screen', h)),
    wx('kick', plume),
    wx('kick', dirt),
    wx('kick', mud),
    wx('kick', gravel),
    wx('ground', tumble),
    wx('ground', shadow),
    wx('ground', devil),
    wx('shine', shimmer),
  ];
}

function tumbleShape(put: Put, f: number): void {
  const angle = (f / 8) * Math.PI * 2;
  tumble(
    put,
    14,
    angle,
    (u, v) => {
      const r = Math.hypot(u, v);
      if (r > 5.2) return null;
      const rim = r > 4.2;
      const twig = hash2(Math.round(u * 1.1 + 9), Math.round(v * 1.1 + 9), 7) > (rim ? 0.35 : 0.62);
      if (!twig) return null;
      const lit = u + v < -1;
      return lit ? SAND[1]! : rim ? DIRT[1]! : SAND[3]!;
    },
    TWIG,
  );
}

// --- Forest ------------------------------------------------------------------------------------

function forest(): WeatherStrip[] {
  const leaf = (id: string, colors: RGBA[]) =>
    fx(id, 7, 7, 4, { fps: 8, loop: true }, (f, put) =>
      tumble(put, 7, (f / 4) * Math.PI, (u, v) => {
        const e = (u / 3.1) ** 2 + (v / 1.5) ** 2;
        if (e > 1) return null;
        return u < -0.6 ? colors[0]! : e < 0.45 ? colors[1]! : colors[2]!;
      }),
    );
  const needle = fx('needle', 6, 6, 4, { fps: 8, loop: true }, (f, put) => {
    const a = (f / 4) * Math.PI;
    const dx = Math.cos(a) * 2.2;
    const dy = Math.sin(a) * 2.2;
    line(put, 3 - dx, 3 - dy, 3 + dx, 3 + dy, NEEDLE[1]!);
    put(3 + dx, 3 + dy, NEEDLE[0]!);
  });
  const shafts = [0, 1].map((n) => {
    const s = fx(`light_shaft_${n}`, 44, 88, 1, { fps: 1 }, (_f, put) => {
      // Light falls from the upper left (the key light): a band slanting down to the right,
      // with a ragged edge and a brighter core, and fading out at both ends.
      const width = n === 0 ? 7 : 10;
      for (let y = 0; y < 88; y++) {
        const cx = 8 + y * 0.32 + (n === 1 ? 4 : 0);
        const ends = Math.min(y, 87 - y) / 14;
        for (let x = 0; x < 44; x++) {
          const d = Math.abs(x + 0.5 - cx);
          const edge = width * Math.min(1, ends) + (hash2(x, y >> 1, 131 + n) - 0.5) * 2;
          if (d > edge) continue;
          if (d > edge - 2 && (x + y) % 2 === 0) continue;
          put(x, y, d < edge * 0.4 ? SHAFT[0]! : SHAFT[1]!);
        }
      }
    });
    s.blend = 'add';
    return wx('shine', s);
  });
  const mote = fx('mote', 2, 2, 3, { fps: 1, anchor: [0, 0] }, (f, put) => {
    put(0, 0, f === 0 ? SHAFT[0]! : SHAFT[1]!);
    if (f === 2) put(1, 0, SHAFT[1]!);
  });
  mote.blend = 'add';
  const firefly = fx('firefly', 5, 5, 4, { fps: 6, loop: true }, (f, put) => {
    const on = [1, 3, 2, 0][f]!;
    if (on === 0) {
      put(2, 2, hex('#5a6a2a'));
      return;
    }
    put(2, 2, hex('#f4ffb0'));
    if (on >= 2)
      for (const [x, y] of [
        [1, 2],
        [3, 2],
        [2, 1],
        [2, 3],
      ])
        put(x!, y!, hex('#9ab83c'));
    if (on === 3)
      for (const [x, y] of [
        [0, 2],
        [4, 2],
      ])
        put(x!, y!, hex('#4a5e1e'));
  });
  firefly.blend = 'add';
  const mist = [0, 1].map((n) =>
    fx(`mist_${n}`, 96, 22, 1, { fps: 1 }, (_f, put) => {
      // Pale mist lying low along the roadside: long thin wisps in a few rows, frayed at the
      // ends, with gaps between them. Drawn at a low alpha step, it softens without blotting.
      for (let y = 0; y < 22; y++) {
        const row = 1 - Math.abs(y - 11) / 11;
        for (let x = 0; x < 96; x++) {
          const ends = Math.min(x, 95 - x) / 22;
          const v = vnoise(x / 14 + n * 9, y / 2.2, 0, 157 + n) * row * Math.min(1, ends);
          if (v < 0.28) continue;
          put(x, y, v > 0.42 ? hex('#f2f6f8') : hex('#d9e2ea'));
        }
      }
    }),
  );
  return [
    wx('air', leaf('leaf_green', LEAF_GREEN)),
    wx('air', leaf('leaf_olive', LEAF_OLIVE)),
    wx('air', leaf('leaf_amber', LEAF_AMBER)),
    wx('air', needle),
    ...shafts,
    wx('glow', mote),
    wx('glow', firefly),
    ...mist.map((m) => wx('ground', m)),
  ];
}

// --- Steam, smoke, sparks and embers ----------------------------------------------------------

function industry(): WeatherStrip[] {
  const steam = (id: string, w: number, h: number, frames: number, seed: number) =>
    fx(id, w, h, frames, { fps: 10 }, (f, put, t) => {
      const lobes = burstLobes(
        w / 2,
        h * 0.6,
        5,
        seed,
        w * (0.12 + t * 0.2),
        w * (0.16 + t * 0.07),
        t * h * 0.25,
      );
      cloud(put, w, h, lobes, {
        seed: seed + 1,
        ramp: VAPOR,
        thresholds: [0.55, 0.3, 0.1],
        noise: 0.3,
        grain: w > 20 ? 4 : 2.5,
        z: f * 0.6,
        erode: 0.05 + t * 0.5,
        rim: 0.2,
        rimColor: VAPOR[2]!,
      });
    });
  const wisp = fx('smoke_wisp', 14, 16, 8, { fps: 9 }, (f, put, t) => {
    const lobes = burstLobes(7, 10 - t * 3, 4, 171, 1.5 + t * 3, 2.6 + t * 1.8, t * 3);
    cloud(put, 14, 16, lobes, {
      seed: 173,
      ramp: SMOKE,
      thresholds: [0.6, 0.4, 0.2],
      noise: 0.3,
      grain: 2.5,
      z: f * 0.5,
      erode: 0.06 + t * 0.45,
      rim: 0.2,
      rimColor: SMOKE[3]!,
    });
  });
  const spark = fx('spark', 3, 3, 3, { fps: 1 }, (f, put) => {
    if (f === 0) {
      put(1, 1, EMBER[0]!);
      put(0, 1, EMBER[1]!);
    } else if (f === 1) {
      put(0, 0, EMBER[1]!);
      put(1, 1, EMBER[0]!);
      put(2, 2, EMBER[2]!);
    } else put(1, 1, EMBER[2]!);
  });
  const ember = fx('ember', 2, 2, 3, { fps: 1, anchor: [0, 0] }, (f, put) => {
    if (f === 0) put(0, 0, EMBER[1]!);
    else if (f === 1) put(0, 0, EMBER[2]!);
    else {
      put(0, 0, EMBER[3]!);
      put(1, 1, EMBER[3]!);
    }
  });
  ember.blend = 'add';
  return [
    wx('air', steam('steam_s', 12, 10, 6, 181)),
    wx('air', steam('steam_m', 20, 16, 7, 191)),
    wx('air', steam('steam_l', 30, 24, 8, 197)),
    wx('air', wisp),
    wx('kick', spark),
    wx('glow', ember),
  ];
}

/** Every strip of the weather atlas, in a stable order. */
export function buildWeatherVfx(): WeatherStrip[] {
  return [
    wx('ground', rainStreak('rain_far', 10, [4, 6], 0)),
    wx('air', rainStreak('rain_mid', 14, [7, 10], 1)),
    wx('near', rainStreak('rain_near', 22, [12, 17], 2)),
    ...splashes(),
    ...spray(),
    ...tracks(),
    ...reflections(),
    ...snow(),
    ...frost(),
    ...sand(),
    ...forest(),
    ...industry(),
  ];
}

/** Packs the weather strips with the combat packer and gives each animation its weather layer. */
export function packWeatherAtlas(strips: WeatherStrip[]): {
  image: PixelBuffer;
  manifest: WeatherAtlasManifest;
} {
  const { image, manifest } = packAtlas(
    strips.map((s) => s.strip),
    'atlas.png',
  );
  const layerOf = new Map(strips.map((s) => [s.strip.id, s.layer]));
  const anims: Record<string, WeatherAnimManifest> = {};
  for (const [id, a] of Object.entries(manifest.anims)) {
    anims[id] = {
      id,
      x: a.x,
      y: a.y,
      frameWidth: a.frameWidth,
      frameHeight: a.frameHeight,
      frames: a.frames,
      columns: a.columns,
      fps: a.fps,
      loop: a.loop,
      anchorX: a.anchorX,
      anchorY: a.anchorY,
      layer: layerOf.get(id)!,
      blend: a.blend,
      directions: a.directions,
    };
  }
  return {
    image,
    manifest: {
      version: 1,
      file: manifest.file,
      width: manifest.width,
      height: manifest.height,
      padding: manifest.padding,
      anims,
    },
  };
}
