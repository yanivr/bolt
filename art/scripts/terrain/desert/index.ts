import type { AnimatedArt, BakeContext, BiomeModule, BiomeOutput } from '../biome.js';
import type { Color } from '../canvas.js';
import { gradeLoops } from './anim.js';
import { paintDecor } from './decor.js';
import type { Dressing, Env } from './dress.js';
import { dressCanyonSwitch } from './canyonSwitch.js';
import { dressDustDevil } from './dustDevil.js';
import { buildRegionGrid, buildSlopeGrid, paintGround } from './ground.js';
import { CANYON_SWITCH_LAND, DUST_DEVIL_LAND } from './lands.js';
import { buildMasks } from './masks.js';
import { windNoise } from './noise.js';
import { lookFor } from './palette.js';
import { paintRoad, planRoad } from './road.js';
import { rockPainter } from './rocks.js';
import { Stage } from './stage.js';
import type { HitInfo } from './stage.js';
import { M_BANNER, M_RAIL, bannerPaint, railPaint } from './structures.js';

/**
 * The desert painter (docs/ART_GUIDE.md, "The desert biome"). Stages, in order:
 *
 *  1. Physics planes: what is solid, what a car can reach, the surface under every pixel.
 *  2. Flat ground: dunes, flats and slopes by light; scrub, grass and pebbles; the road.
 *  3. The track's dressing raises its masses (rocks, cliffs, mesas, the arch, the banner) into
 *     the height field and lists its upright props and loops.
 *  4. Shadows of masses and props are cut into the ground; the flat picture is remembered.
 *  5. Masses, then props, are drawn: over unreachable ground into the ground layer, over
 *     reachable ground into the foreground. The ground layer is compared with the remembered
 *     flat picture on every reachable pixel: any change is raised art hiding drivable ground.
 *  6. Everything is graded into the preset's light; the foreground is cut into overlays.
 */
export function paintDesert(ctx: BakeContext): BiomeOutput {
  const { world, field, track } = ctx;
  const t0 = performance.now();
  const masks = buildMasks(track, field);
  const look = lookFor(ctx.preset);
  const spec = ctx.def.id === 'desert_02' ? CANYON_SWITCH_LAND : DUST_DEVIL_LAND;
  const regions = buildRegionGrid(spec, masks.w, masks.h);
  const slopes = buildSlopeGrid(spec, masks.w, masks.h);
  paintGround(world, field, masks, spec, look, regions, slopes);
  const decor = paintDecor(world, field, masks, spec, look, regions, slopes, ctx.seed);
  const info = planRoad(track, masks, field);
  const soft = ctx.def.hazards.findIndex((h) => h.id === 'wash_soft_sand');
  const windZone = new Uint8Array(masks.w * masks.h);
  ctx.def.hazards.forEach((hz, i) => {
    if (hz.kind !== 'crosswind') return;
    for (let p = 0; p < masks.w * masks.h; p++) if (masks.hazard[p] === i + 1) windZone[p] = 1;
  });
  paintRoad(world, track, field, masks, info, {
    look,
    spec,
    windZone,
    washBranch: 'dry_wash',
    ledgeBranch: 'ledge_run',
    softSandHazard: soft >= 0 ? soft : undefined,
  });

  const stage = new Stage(masks, world);
  const env: Env = { ctx, track, masks, stage, look, spec, info };
  const dress: Dressing = ctx.def.id === 'desert_01' ? dressDustDevil(env) : dressCanyonSwitch(env);

  // Shadows: props first (into their own plane), then the masses' volume.
  for (const pl of dress.placements) {
    if (!pl.shadow) continue;
    stage.spriteShadow(pl.sp.art, pl.gx - pl.sp.ax, pl.gy - pl.sp.ay, pl.gy, look.drop, pl.shadowFrom ?? 0);
  }
  stage.resolveShadows(look.drop);
  const d = world.data;
  const n = masks.w * masks.h;
  for (let p = 0; p < n; p++) {
    if (stage.shade[p]! === 0 && stage.propShadow[p]! === 0) continue;
    const o = p * 4;
    const c = look.shade((d[o]! << 16) | (d[o + 1]! << 8) | d[o + 2]!);
    d[o] = (c >> 16) & 255;
    d[o + 1] = (c >> 8) & 255;
    d[o + 2] = c & 255;
  }
  const flat = d.slice();

  // Raised art.
  const rock = rockPainter({ rock: spec.rock, look });
  stage.drawMasses((mat: number, hit: HitInfo, st: Stage): Color => {
    if (mat === M_BANNER) {
      const c = bannerPaint(env, hit, st);
      return hit.shaded ? look.castShade(c) : c;
    }
    if (mat === M_RAIL) return railPaint(hit, st);
    return rock(mat, hit, st);
  });
  const ordered = dress.placements.slice().sort((a, b) => a.gy - b.gy || a.gx - b.gx);
  for (const pl of ordered)
    stage.sprite(pl.sp.art, pl.gx - pl.sp.ax, pl.gy - pl.sp.ay, pl.gy, pl.kind, pl.forceFg ?? false);
  for (const draw of dress.draws) draw();

  // The guard, from the picture: no reachable pixel of the ground layer may have changed.
  let covered = 0;
  let inSolids = 0;
  for (let p = 0; p < n; p++) {
    const o = p * 4;
    if (d[o] === flat[o] && d[o + 1] === flat[o + 1] && d[o + 2] === flat[o + 2]) continue;
    if (masks.reach[p]) covered++;
    else inSolids++;
  }

  // Dust in the air throws slow, broad shadows over everything in a sandstorm.
  if (look.drift >= 1) {
    const dim = (data: Uint8ClampedArray, i: number): void => {
      data[i] = Math.round(data[i]! * 0.91 + 3);
      data[i + 1] = Math.round(data[i + 1]! * 0.9 + 2);
      data[i + 2] = Math.round(data[i + 2]! * 0.89 + 1);
    };
    for (let p = 0; p < n; p++) {
      const x = p % masks.w;
      const y = (p / masks.w) | 0;
      if (windNoise(x, y, look.wind, 260, 909, 0.45) < 0.62) continue;
      dim(d, p * 4);
      if (stage.fg.data[p * 4 + 3]! > 0) dim(stage.fg.data, p * 4);
    }
  }

  // Grade.
  const gradeBuf = (data: Uint8ClampedArray, alphaOnly: boolean): void => {
    for (let i = 0; i < data.length; i += 4) {
      if (alphaOnly && data[i + 3] === 0) continue;
      const c = look.grade((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!);
      data[i] = (c >> 16) & 255;
      data[i + 1] = (c >> 8) & 255;
      data[i + 2] = c & 255;
    }
  };
  gradeBuf(d, false);
  gradeBuf(stage.fg.data, true);
  // In dust the picture is posterized a little further, which keeps every chunk inside one
  // 256-color palette (no per-chunk folding, so no seams).
  if (look.posterize > 1) {
    const q = look.posterize;
    for (const data of [d, stage.fg.data])
      for (let i = 0; i < data.length; i += 4)
        for (let k = 0; k < 3; k++) data[i + k] = Math.min(255, Math.round(data[i + k]! / q) * q);
  }
  const animated: AnimatedArt[] = dress.anims;
  gradeLoops(animated, look.grade, look.posterize);
  const overlays = stage.overlays('fg');

  const mismatch = animatedMismatchCount(world, animated);
  console.log(
    `  desert   ${((performance.now() - t0) / 1000).toFixed(1)} s; ${masks.reachCount} reachable px; ` +
      `raised art: ${inSolids} px in the ground layer (all over solid or unreachable ground), ` +
      `${overlays.length} overlays; decor ${decor.scrub} scrub, ${decor.tufts} tufts, ${decor.pebbles} pebble clusters, ${decor.gullies} rills, ${decor.tracks} old tracks`,
  );
  console.log(
    `  props    ${Object.entries(dress.props)
      .map(([k, v]) => `${v} ${k}`)
      .join(', ')}`,
  );
  return {
    overlays,
    animated,
    lights: [],
    checks: { coveredDrivable: Math.max(covered, 0), animatedMismatch: mismatch },
    previewSpots: dress.previewSpots,
    previewPlain: dress.previewSpots.slice(0, 3).map((s) => s.name),
    previewCars: dress.previewCars,
  };
}

function animatedMismatchCount(world: BakeContext['world'], art: readonly AnimatedArt[]): number {
  let bad = 0;
  for (const a of art) {
    if (a.above || a.blend === 'add') continue;
    const f = a.frames[0];
    if (!f) continue;
    for (let y = 0; y < f.h; y++)
      for (let x = 0; x < f.w; x++) {
        if (f.alpha(x, y) !== 255) continue;
        if (world.get(a.x + x, a.y + y) !== f.get(x, y)) bad++;
      }
  }
  return bad;
}

export const DESERT_BIOME: BiomeModule = {
  biome: 'desert',
  paint: paintDesert,
  presets: ['desert_clear', 'desert_crosswind', 'desert_dry_heat', 'desert_sandstorm'],
};
