import type {
  CarPose,
  ChassisSpriteManifest,
  EngineSpriteManifest,
  MountedPartSprite,
  WheelSpriteManifest,
} from '@bolt/shared';
import { COMPONENT_FIRST_WHEEL, headingFrame, layoutCar } from '@bolt/shared';
import type Phaser from 'phaser';
import type { CarState } from '../combat/rig.js';
import { SOURCE_FROST } from '../combat/rig.js';

export type CarTextureKeys = {
  body: string;
  shadow: string;
  brake: string;
  head: string;
  wheels: string;
  engine: string;
  /** Texture key per mounted part id. */
  parts: Record<string, string>;
  /** Damage and frost overlay sheet for this chassis, when one is baked. */
  overlay?: string;
};

/** Draw order of the pieces of a car that are not in its container. */
export const DEPTH_CAR_SHADOW = 40;

const WHITE = 0xffffff;
const TINT_DEAD = 0x5c6074;
const TINT_WRECK = 0x62647a;
const TINT_FROST = 0xa4dcff;
const TINT_EMP = 0xb4b8d0;
const TINT_BATTERED = 0xb8b0b4;
const TINT_SCUFFED = 0xdcd6d8;

/**
 * One composited vehicle on screen. It owns a sprite per layer and asks the shared
 * `layoutCar` function where each one goes, so the live race draws exactly what the garage,
 * the VS card and the art review sheets draw. The container sits in world space at a position
 * the race view has already snapped to the device pixel grid, and it is never rotated: heading
 * is expressed by picking one of the authored heading frames.
 *
 * In a race it also shows the car's combat state (Section 12.8): which component was just
 * hit, which is failing, which is dead; a turret turned to its aim, a weapon kicked back by
 * its own shot, a hammer mid-swing; frost, a jump, a wreck. That state is worked out in
 * `combat/rig.ts` and only copied onto sprites here.
 */
export class CarView {
  readonly container: Phaser.GameObjects.Container;
  /** The ground shadow is its own object, so one car's shadow never lies on the other car. */
  readonly shadow: Phaser.GameObjects.Image;
  private wheels: Phaser.GameObjects.Image[] = [];
  private body: Phaser.GameObjects.Image;
  private overlay: Phaser.GameObjects.Image | null = null;
  private engine: Phaser.GameObjects.Image;
  private head: Phaser.GameObjects.Image;
  private brake: Phaser.GameObjects.Image;
  private partImages = new Map<string, Phaser.GameObjects.Image>();
  private partIndex = new Map<string, number>();
  private partIndexFor: unknown = null;
  private shadowDx = 2;
  private shadowDy = 3;
  private frameCount = 0;

  constructor(
    scene: Phaser.Scene,
    private readonly chassis: ChassisSpriteManifest,
    private readonly wheelKit: WheelSpriteManifest,
    private readonly engineKit: EngineSpriteManifest,
    private readonly keys: CarTextureKeys,
    private readonly parts: MountedPartSprite[] = [],
  ) {
    this.shadow = scene.add.image(0, 0, keys.shadow, 0).setDepth(DEPTH_CAR_SHADOW);
    for (let i = 0; i < chassis.wheelAnchors.length; i++)
      this.wheels.push(scene.add.image(0, 0, keys.wheels, 0));
    this.body = scene.add.image(0, 0, keys.body, 0);
    if (keys.overlay) this.overlay = scene.add.image(0, 0, keys.overlay, 0).setVisible(false);
    this.engine = scene.add.image(0, 0, keys.engine, 0);
    this.head = scene.add.image(0, 0, keys.head, 0);
    this.brake = scene.add.image(0, 0, keys.brake, 0);
    const partList: Phaser.GameObjects.Image[] = [];
    for (const part of parts) {
      const key = keys.parts[part.partId];
      if (!key) continue;
      const image = scene.add.image(0, 0, key, 0);
      this.partImages.set(part.instanceId, image);
      partList.push(image);
    }
    this.container = scene.add.container(0, 0, [
      ...this.wheels,
      this.body,
      ...(this.overlay ? [this.overlay] : []),
      this.engine,
      ...partList,
      this.head,
      this.brake,
    ]);
  }

  private indexOf(state: CarState, instanceId: string): number {
    if (this.partIndexFor !== state.rig) {
      this.partIndexFor = state.rig;
      this.partIndex.clear();
      state.rig?.parts.forEach((part, i) => this.partIndex.set(part.sprite.instanceId, i));
    }
    return this.partIndex.get(instanceId) ?? -1;
  }

  /**
   * Applies a pose: picks the frame for every layer and places it. With a combat `state` the
   * car also shows its damage, its statuses and what its parts are doing; `tick` is the render
   * clock those statuses are read against.
   */
  apply(pose: CarPose, state?: CarState, tick = 0): void {
    const ops = layoutCar(this.chassis, this.wheelKit, this.engineKit, pose, this.parts);
    this.frameCount++;
    const lift = state ? state.lift : 0;
    const ko = state ? state.ko : false;
    const emp = state ? state.has('emp', tick) : false;
    const frost = state ? state.has('grip', tick) && state.gripSource === SOURCE_FROST : false;
    const tier = state ? state.damageTier() : 0;
    let bodyTint = WHITE;
    if (ko) bodyTint = TINT_WRECK;
    else if (frost) bodyTint = TINT_FROST;
    else if (emp) bodyTint = TINT_EMP;
    else if (tier >= 3) bodyTint = TINT_BATTERED;
    else if (tier === 2) bodyTint = TINT_SCUFFED;
    const bodyFlash = state ? state.bodyFlash > 0 : false;
    // Under EMP the lamps are down and stutter; a wreck has none.
    const lamps = !ko && (!emp || this.frameCount % 9 === 0);

    let partDepth = 0;
    let wheel = 0;
    const base = this.wheels.length + 1 + (this.overlay ? 1 : 0) + 1;
    this.head.setVisible(false);
    this.brake.setVisible(false);
    for (const op of ops) {
      switch (op.kind) {
        case 'shadow':
          this.shadow.setFrame(op.frame);
          // A car in the air leaves its shadow behind on the road (Section 12.8).
          this.shadowDx = op.dx + Math.round(lift * 0.35);
          this.shadowDy = op.dy + Math.round(lift * 0.25);
          this.shadow.setAlpha(lift > 6 ? 0.6 : 1);
          break;
        case 'wheel': {
          const image = this.wheels[wheel]!;
          let dx = op.dx;
          let dy = op.dy - lift;
          let visible = true;
          let tint = ko ? TINT_WRECK : WHITE;
          let flash = false;
          if (state) {
            const component = COMPONENT_FIRST_WHEEL + wheel;
            const condition = state.condition(component);
            // A dead wheel is gone from its hub; a failing one runs out of true.
            if (condition === 3) visible = false;
            else if (condition > 0 && Math.abs(pose.roll) > 0.01) {
              const period = condition === 2 ? 3 : 7;
              const beat = Math.floor(this.frameCount / period) + wheel;
              if (beat % 2 === 0) dx += wheel % 2 === 0 ? 1 : -1;
              if (condition === 2) tint = 0xb4b6c4;
            }
            const drop = state.wheelDrop[wheel]!;
            if (drop >= 0) {
              // A spare being fitted drops onto its hub and bounces once.
              const k = Math.min(1, drop / 0.22);
              dy -= Math.round((1 - k) * (1 - k) * 9);
              visible = true;
            }
            flash = state.flash[component]! > 0 || (state.flash[1]! > 0 && wheel < 2);
          }
          image.setVisible(visible);
          image.setFrame(op.frame);
          image.setPosition(dx, dy);
          if (flash) image.setTintFill(WHITE);
          else image.setTint(tint);
          wheel++;
          break;
        }
        case 'body':
          this.body.setFrame(op.frame);
          this.body.setPosition(op.dx, op.dy - lift);
          if (bodyFlash) this.body.setTintFill(WHITE);
          else this.body.setTint(bodyTint);
          if (this.overlay) {
            // Blocks of the overlay sheet: scuffed, battered, frosted, each 64 headings.
            const block = frost ? 2 : tier >= 2 || ko ? 1 : tier === 1 ? 0 : -1;
            this.overlay.setVisible(block >= 0 && !bodyFlash);
            if (block >= 0) {
              this.overlay.setFrame(block * 64 + op.frame);
              this.overlay.setPosition(op.dx, op.dy - lift);
            }
          }
          break;
        case 'engine':
          this.engine.setFrame(op.frame);
          this.engine.setPosition(op.dx, op.dy - lift);
          if (state && state.flash[0]! > 0) this.engine.setTintFill(WHITE);
          else this.engine.setTint(ko || (state && state.condition(0) === 3) ? TINT_DEAD : WHITE);
          break;
        case 'part': {
          const image = op.instanceId ? this.partImages.get(op.instanceId) : undefined;
          if (!image) continue;
          // Draw order follows the compositor: far parts first, lamps on top.
          this.container.moveTo(image, base + partDepth++);
          let frame = op.frame;
          let dx = op.dx;
          let dy = op.dy - lift;
          let tint = ko ? TINT_WRECK : WHITE;
          let flash = false;
          let visible = true;
          const index = state && op.instanceId ? this.indexOf(state, op.instanceId) : -1;
          if (state && index >= 0) {
            // The part is drawn along its own heading: a turret at its aim, a hammer mid-swing.
            const heading = state.partHeading(index);
            frame = headingFrame(heading);
            const kick = state.partKick[index]!;
            if (kick !== 0) {
              dx -= Math.round(Math.sin(heading) * kick);
              dy += Math.round(Math.cos(heading) * kick);
            }
            const component = state.partComponent(index);
            if (state.condition(component) === 3) tint = TINT_DEAD;
            flash = state.flash[component]! > 0;
            visible = !state.partHidden[index];
          }
          image.setVisible(visible);
          image.setFrame(frame);
          image.setPosition(dx, dy);
          if (flash) image.setTintFill(WHITE);
          else image.setTint(tint);
          break;
        }
        case 'headlight':
          this.head.setFrame(op.frame);
          this.head.setPosition(op.dx, op.dy - lift);
          this.head.setVisible(lamps);
          break;
        default:
          this.brake.setFrame(op.frame);
          this.brake.setPosition(op.dx, op.dy - lift);
          this.brake.setVisible(!ko);
          break;
      }
    }
  }

  setPosition(x: number, y: number): void {
    this.container.setPosition(x, y);
    this.shadow.setPosition(x + this.shadowDx, y + this.shadowDy);
  }

  setVisible(visible: boolean): void {
    this.container.setVisible(visible);
    this.shadow.setVisible(visible);
  }

  objects(): Phaser.GameObjects.GameObject[] {
    return [this.container, this.shadow];
  }

  destroy(): void {
    this.container.destroy(true);
    this.shadow.destroy();
  }
}
