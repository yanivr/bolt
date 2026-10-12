import type { EffectPool } from '../vfx/EffectPool.js';
import type { FxAtlas } from '../vfx/atlas.js';
import { LAYER_FLASH } from '../vfx/atlas.js';
import type { LightList } from './stage.js';

/** Warm tint for the reflection of a flash or a blast on wet road. */
const FLASH_TINT = 0xffc070;

/**
 * The bright moments the combat stage is drawing this frame (muzzle flashes, tracers, blast
 * flashes: its additive `flash` layer), as light sources for reflections on wet ground. The
 * sixteen largest are kept; the size of a sprite picks the length of its reflection. Reads the
 * pool as drawn, so a reflection appears and goes with the flash that casts it.
 */
export function collectCombatLights(pool: EffectPool, atlas: FxAtlas, out: LightList): void {
  out.clear();
  const start = pool.layerStart[LAYER_FLASH]!;
  const end = pool.layerEnd[LAYER_FLASH]!;
  for (let i = start; i < end; i++) {
    if (!pool.shown[i]) continue;
    const anim = pool.anim[i]!;
    const w = atlas.width[anim]!;
    const h = atlas.height[anim]!;
    if (w < 5 && h < 5) continue;
    const size = w >= 40 ? 3 : w >= 20 ? 2 : 1;
    const x = pool.drawX[i]! + w / 2;
    const y = pool.drawY[i]! + h * 0.8;
    if (out.count < out.x.length) out.add(x, y, size, FLASH_TINT);
    else {
      // Full: a bigger light replaces the smallest kept.
      let small = 0;
      for (let k = 1; k < out.count; k++) if (out.size[k]! < out.size[small]!) small = k;
      if (out.size[small]! < size) {
        out.x[small] = x;
        out.y[small] = y;
        out.size[small] = size;
      }
    }
  }
}
