import type { WeatherAtlasManifest } from '@bolt/shared';
import { weatherFrameRect } from '@bolt/shared';
import Phaser from 'phaser';
import { WL_ADDITIVE, WL_COUNT } from './atlas.js';
import type { WeatherStage } from './stage.js';

/** Texture key of the weather atlas, and the cache key of its manifest. */
export const WX_TEXTURE = 'fx:weather';
export const WX_MANIFEST = 'fx:weather:manifest';

/**
 * Where each weather layer sits among the race view's depths (ground art 0, terrain loops
 * below the cars 8, combat decals 11, skids 12, combat ground 14 to 16, headlight pools 20,
 * tire smoke 30, cars 50 and 51, combat smoke to marks 54 to 60, terrain loops above the cars
 * 60, foreground art 70). Section 12.4's order: marks and light on the road under the ground
 * effects; what the wheels throw up with the tire smoke, under the cars; the middle plane of
 * weather over the cars; the nearest plane over the foreground art; the screen layer last.
 */
export const WX_DEPTH: readonly number[] = [10, 13, 17, 31, 61, 62, 71, 72];
const DEPTH_LIGHTNING = 73;

function registerFrames(
  textures: Phaser.Textures.TextureManager,
  manifest: WeatherAtlasManifest,
): Phaser.Textures.Frame[] {
  const texture = textures.get(WX_TEXTURE);
  const frames: Phaser.Textures.Frame[] = [];
  for (const anim of Object.values(manifest.anims)) {
    for (let i = 0; i < anim.frames; i++) {
      const name = `${anim.id}:${i}`;
      const r = weatherFrameRect(anim, i, manifest.padding);
      frames.push(
        (texture.has(name) ? texture.get(name) : texture.add(name, 0, r.x, r.y, r.w, r.h)) ??
          texture.get(),
      );
    }
  }
  return frames;
}

/**
 * The only Phaser in the weather layer: one Blitter per layer (one batch each, one texture
 * for all of them), every sprite created up front, and one Graphics for the storm's flash.
 * Each frame it copies the stage's draw list onto the sprites, on the device pixel grid.
 */
export class WeatherView {
  private readonly blitters: Phaser.GameObjects.Blitter[] = [];
  private readonly bobs: Phaser.GameObjects.Bob[][] = [];
  private readonly shown: number[] = [];
  private readonly frames: Phaser.Textures.Frame[];
  private readonly sky: Phaser.GameObjects.Graphics;
  drawn = 0;

  constructor(
    scene: Phaser.Scene,
    private readonly stage: WeatherStage,
  ) {
    this.frames = registerFrames(scene.textures, stage.atlas.manifest);
    const list = stage.list;
    for (let l = 0; l < WL_COUNT; l++) {
      const blitter = scene.add.blitter(0, 0, WX_TEXTURE).setDepth(WX_DEPTH[l]!);
      if (WL_ADDITIVE[l]) blitter.setBlendMode(Phaser.BlendModes.ADD);
      const bobs: Phaser.GameObjects.Bob[] = [];
      for (let i = 0; i < list.capacity[l]!; i++)
        bobs.push(blitter.create(0, 0, this.frames[0], false));
      this.blitters.push(blitter);
      this.bobs.push(bobs);
      this.shown.push(0);
    }
    this.sky = scene.add.graphics().setDepth(DEPTH_LIGHTNING).setBlendMode(Phaser.BlendModes.ADD);
  }

  sync(scale: number, viewX: number, viewY: number, viewW: number, viewH: number): void {
    const list = this.stage.list;
    let drawn = 0;
    for (let l = 0; l < WL_COUNT; l++) {
      const bobs = this.bobs[l]!;
      const n = list.count[l]!;
      const base = list.start[l]!;
      for (let k = 0; k < n; k++) {
        const bob = bobs[k]!;
        const i = base + k;
        bob.x = Math.round(list.x[i]! * scale) / scale;
        bob.y = Math.round(list.y[i]! * scale) / scale;
        bob.setFrame(this.frames[list.frame[i]!]!);
        const alpha = list.alpha[i]!;
        if (bob.alpha !== alpha) bob.alpha = alpha;
        bob.tint = list.tint[i]!;
        if (!bob.visible) bob.visible = true;
      }
      for (let k = n; k < this.shown[l]!; k++) bobs[k]!.visible = false;
      this.shown[l] = n;
      drawn += n;
    }
    this.drawn = drawn;
    this.sky.clear();
    if (this.stage.flash > 0) {
      this.sky.fillStyle(this.stage.flashTint, this.stage.flash);
      this.sky.fillRect(viewX - 4, viewY - 4, viewW + 8, viewH + 8);
    }
  }

  destroy(): void {
    for (const b of this.blitters) b.destroy();
    this.sky.destroy();
  }
}
