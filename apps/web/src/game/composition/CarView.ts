import type {
  CarPose,
  ChassisSpriteManifest,
  EngineSpriteManifest,
  WheelSpriteManifest,
} from '@bolt/shared';
import { layoutCar } from '@bolt/shared';
import type Phaser from 'phaser';

export type CarTextureKeys = {
  body: string;
  shadow: string;
  brake: string;
  head: string;
  wheels: string;
  engine: string;
};

/**
 * One composited vehicle on screen. It owns a sprite per layer and asks the shared
 * `layoutCar` function where each one goes, so the live race draws exactly what the garage,
 * the VS card and the art review sheets draw. The container sits in world space at a position
 * the race view has already snapped to the device pixel grid, and it is never rotated: heading
 * is expressed by picking one of the authored heading frames.
 */
export class CarView {
  readonly container: Phaser.GameObjects.Container;
  private shadow: Phaser.GameObjects.Image;
  private wheels: Phaser.GameObjects.Image[] = [];
  private body: Phaser.GameObjects.Image;
  private engine: Phaser.GameObjects.Image;
  private head: Phaser.GameObjects.Image;
  private brake: Phaser.GameObjects.Image;

  constructor(
    scene: Phaser.Scene,
    private readonly chassis: ChassisSpriteManifest,
    private readonly wheelKit: WheelSpriteManifest,
    private readonly engineKit: EngineSpriteManifest,
    private readonly keys: CarTextureKeys,
  ) {
    this.shadow = scene.add.image(0, 0, keys.shadow, 0);
    for (let i = 0; i < chassis.wheelAnchors.length; i++)
      this.wheels.push(scene.add.image(0, 0, keys.wheels, 0));
    this.body = scene.add.image(0, 0, keys.body, 0);
    this.engine = scene.add.image(0, 0, keys.engine, 0);
    this.head = scene.add.image(0, 0, keys.head, 0);
    this.brake = scene.add.image(0, 0, keys.brake, 0);
    this.container = scene.add.container(0, 0, [
      this.shadow,
      ...this.wheels,
      this.body,
      this.engine,
      this.head,
      this.brake,
    ]);
  }

  /** Applies a pose: picks the frame for every layer and places it. */
  apply(pose: CarPose): void {
    const ops = layoutCar(this.chassis, this.wheelKit, this.engineKit, pose);
    let wheel = 0;
    this.head.setVisible(false);
    this.brake.setVisible(false);
    for (const op of ops) {
      let target: Phaser.GameObjects.Image;
      let frame: number;
      switch (op.kind) {
        case 'shadow':
          target = this.shadow;
          frame = op.frame;
          break;
        case 'wheel':
          target = this.wheels[wheel++]!;
          frame = op.frame;
          break;
        case 'body':
          target = this.body;
          frame = op.frame;
          break;
        case 'engine':
          target = this.engine;
          frame = op.frame;
          break;
        case 'headlight':
          target = this.head;
          frame = op.frame;
          target.setVisible(true);
          break;
        default:
          target = this.brake;
          frame = op.frame;
          target.setVisible(true);
          break;
      }
      target.setFrame(frame);
      target.setPosition(op.dx, op.dy);
    }
  }

  setPosition(x: number, y: number): void {
    this.container.setPosition(x, y);
  }

  objects(): Phaser.GameObjects.GameObject[] {
    return [this.container];
  }

  destroy(): void {
    this.container.destroy(true);
  }
}
