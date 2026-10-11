import type { CarPose, VfxAtlasManifest } from '@bolt/shared';
import { VFX_LAYERS, vfxFrameRect } from '@bolt/shared';
import Phaser from 'phaser';
import type { CarView } from '../composition/CarView.js';
import type { PixelSink } from '../vfx/PixelFx.js';
import { LAYER_COUNT } from '../vfx/atlas.js';
import type { CombatStage } from './stage.js';

/** Texture key of the combat effects atlas. */
export const FX_TEXTURE = 'fx:combat';

/**
 * Draw order around the cars (ground art is 0, driving smoke 30, cars 50, foreground art 70).
 * One batch per effects layer, in VFX_LAYERS order: decals, ground light and hazards under the
 * cars; smoke, debris and projectiles, fire and flashes over them.
 */
const LAYER_DEPTH = [11, 16, 14, 54, 55, 56, 59, 60];
const DEPTH_GROUND_SHAPES = 15;
const DEPTH_AIR_SHAPES = 58;
const DEPTH_CAR = 50;
/** Where a car is lifted to while a heavy blast would hide it (Section 13.3). */
const DEPTH_CAR_OUTLINED = 57;

/** Adds the atlas's frames to its texture; returns them in the pool's global frame order. */
export function registerFxFrames(
  textures: Phaser.Textures.TextureManager,
  manifest: VfxAtlasManifest,
): Phaser.Textures.Frame[] {
  const texture = textures.get(FX_TEXTURE);
  const frames: Phaser.Textures.Frame[] = [];
  for (const anim of Object.values(manifest.anims)) {
    for (let i = 0; i < anim.frames; i++) {
      const name = `${anim.id}:${i}`;
      const rect = vfxFrameRect(anim, i, manifest.padding);
      const frame =
        (texture.has(name)
          ? texture.get(name)
          : texture.add(name, 0, rect.x, rect.y, rect.w, rect.h)) ?? texture.get();
      frames.push(frame);
    }
  }
  return frames;
}

class GraphicsSink implements PixelSink {
  private color = -1;
  private alpha = -1;
  constructor(private readonly g: Phaser.GameObjects.Graphics) {}

  begin(): void {
    this.g.clear();
    this.color = -1;
    this.alpha = -1;
  }

  rect(x: number, y: number, w: number, h: number, color: number, alpha: number): void {
    if (color !== this.color || alpha !== this.alpha) {
      this.g.fillStyle(color, alpha);
      this.color = color;
      this.alpha = alpha;
    }
    this.g.fillRect(x, y, w, h);
  }
}

/**
 * The renderer of the combat presentation: it owns the Phaser objects (one Blitter per effects
 * layer with every sprite created up front, two Graphics objects for the pixel shapes, the two
 * cars and their headlight pools) and each frame copies onto them what `CombatStage` worked
 * out. Nothing is created or destroyed while racing.
 */
export class CombatView {
  private readonly blitters: Phaser.GameObjects.Blitter[] = [];
  private readonly bobs: Phaser.GameObjects.Bob[] = [];
  private readonly frames: Phaser.Textures.Frame[];
  private readonly ground: Phaser.GameObjects.Graphics;
  private readonly air: Phaser.GameObjects.Graphics;
  private readonly groundSink: GraphicsSink;
  private readonly airSink: GraphicsSink;
  private readonly pose: CarPose = {
    headingRad: 0,
    steer: 0,
    roll: 0,
    braking: false,
    headlights: true,
    bodyShiftX: 0,
    bodyShiftY: 0,
  };
  /** Sprites drawn in the last frame, for the performance readout. */
  drawn = 0;

  constructor(
    scene: Phaser.Scene,
    private readonly stage: CombatStage,
    /** One view per car index, or null when that car cannot be drawn. */
    private readonly cars: Array<CarView | null>,
    private readonly cones: Array<Phaser.GameObjects.Image | null>,
  ) {
    this.frames = registerFxFrames(scene.textures, stage.atlas.manifest);
    const pool = stage.pool;
    for (let layer = 0; layer < LAYER_COUNT; layer++) {
      const blitter = scene.add.blitter(0, 0, FX_TEXTURE).setDepth(LAYER_DEPTH[layer]!);
      const name = VFX_LAYERS[layer]!;
      if (name === 'glow' || name === 'flash') blitter.setBlendMode(Phaser.BlendModes.ADD);
      this.blitters.push(blitter);
      for (let slot = pool.layerStart[layer]!; slot < pool.layerEnd[layer]!; slot++)
        this.bobs[slot] = blitter.create(0, 0, this.frames[0], false);
    }
    this.ground = scene.add.graphics().setDepth(DEPTH_GROUND_SHAPES);
    this.air = scene.add.graphics().setDepth(DEPTH_AIR_SHAPES);
    this.groundSink = new GraphicsSink(this.ground);
    this.airSink = new GraphicsSink(this.air);
  }

  /** Copies the stage onto the screen. Call once a frame, after `stage.frame`. */
  sync(): void {
    const stage = this.stage;
    const pool = stage.pool;
    const scale = stage.scale;
    const bobs = this.bobs;
    const frames = this.frames;
    let drawn = 0;
    for (let i = 0; i < pool.size; i++) {
      const bob = bobs[i]!;
      if (!pool.shown[i]) {
        if (bob.visible) bob.visible = false;
        continue;
      }
      // On the same device pixel grid as the ground and the cars: no sprite sits between pixels.
      bob.x = Math.round(pool.drawX[i]! * scale) / scale;
      bob.y = Math.round(pool.drawY[i]! * scale) / scale;
      bob.setFrame(frames[pool.frameOut[i]!]!);
      const alpha = pool.drawAlpha[i]!;
      if (bob.alpha !== alpha) bob.alpha = alpha;
      bob.tint = pool.tint[i]!;
      if (!bob.visible) bob.visible = true;
      drawn++;
    }
    this.drawn = drawn;

    this.groundSink.begin();
    stage.drawGround(this.groundSink);
    this.airSink.begin();
    stage.drawAir(this.airSink);

    // Cars: the one lower on the screen is nearer the camera and is drawn over the other.
    const a = stage.cars[0]!;
    const b = stage.cars[1]!;
    const firstOnTop = a.present && b.present ? a.y > b.y + 0.5 : false;
    for (let index = 0; index < 2; index++) {
      const view = this.cars[index];
      const car = stage.cars[index]!;
      const cone = this.cones[index];
      if (!view) continue;
      if (!car.present) {
        view.setVisible(false);
        cone?.setVisible(false);
        continue;
      }
      const pose = this.pose;
      pose.headingRad = car.frameHeading;
      pose.steer = car.steer;
      pose.roll = car.roll;
      pose.braking = car.braking;
      pose.bodyShiftX = car.bodyShiftX;
      pose.bodyShiftY = car.bodyShiftY;
      view.setVisible(true);
      view.apply(pose, car, stage.renderTick);
      view.setPosition(car.x, car.y);
      const onTop = index === 0 ? firstOnTop : !firstOnTop;
      view.container.setDepth(car.outline > 0 ? DEPTH_CAR_OUTLINED : DEPTH_CAR + (onTop ? 1 : 0));
      if (cone) {
        // The light pool follows the drawn car; it goes out with the lamps.
        const dark = car.ko || car.has('emp', stage.renderTick);
        cone.setVisible(!dark);
        cone.setPosition(car.x + Math.sin(car.heading) * 22, car.y - Math.cos(car.heading) * 22);
        cone.setRotation(car.heading);
      }
    }
  }

  /** For a race in which the local driver is not car 0: the views trade indices. */
  swapCars(): void {
    this.cars.reverse();
    this.cones.reverse();
  }

  destroy(): void {
    for (const blitter of this.blitters) blitter.destroy();
    this.ground.destroy();
    this.air.destroy();
  }
}
