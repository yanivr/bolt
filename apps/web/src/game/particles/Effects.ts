import type { VfxManifest } from '@bolt/shared';
import type Phaser from 'phaser';

type Particle = {
  sprite: Phaser.GameObjects.Image;
  active: boolean;
  age: number;
  life: number;
  vx: number;
  vy: number;
  drag: number;
  frames: number;
  fps: number;
  fade: boolean;
  startAlpha: number;
};

/**
 * Pooled world-space pixel effects: tire smoke, dust, exhaust, sparks, impact stars and skid
 * decals. Nothing is allocated while racing (Section 13.2); when a pool is exhausted the
 * oldest decorative particle is recycled. Effects here are cosmetic and never feed gameplay.
 */
export class Effects {
  private pool: Particle[] = [];
  private cursor = 0;
  private skids: Phaser.GameObjects.Image[] = [];
  private skidBorn: number[] = [];
  private skidCursor = 0;
  private clock = 0;
  /** Device quality scale, 0.4 to 1. Decorative density follows it. */
  quality = 1;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly vfx: VfxManifest,
    particleCount = 220,
    skidCount = 420,
  ) {
    for (let i = 0; i < particleCount; i++) {
      const sprite = scene.add.image(0, 0, 'vfx:smoke_a', 0).setVisible(false).setDepth(30);
      this.pool.push({ sprite, active: false, age: 0, life: 0, vx: 0, vy: 0, drag: 0, frames: 1, fps: 1, fade: false, startAlpha: 1 });
    }
    for (let i = 0; i < skidCount; i++) {
      this.skids.push(scene.add.image(0, 0, 'vfx:skid_light', 0).setVisible(false).setDepth(12));
      this.skidBorn.push(-1e9);
    }
  }

  objects(): Phaser.GameObjects.GameObject[] {
    return [...this.pool.map((p) => p.sprite), ...this.skids];
  }

  private spawn(strip: string, x: number, y: number, vx: number, vy: number, opts: { tint?: number; alpha?: number; drag?: number; rotation?: number; hold?: number; depth?: number }): void {
    const def = this.vfx.strips[strip];
    if (!def) return;
    const p = this.pool[this.cursor]!;
    this.cursor = (this.cursor + 1) % this.pool.length;
    p.active = true;
    p.age = 0;
    p.frames = def.frames;
    p.fps = def.fps;
    p.life = def.frames / def.fps + (opts.hold ?? 0);
    p.vx = vx;
    p.vy = vy;
    p.drag = opts.drag ?? 2.5;
    p.startAlpha = opts.alpha ?? 1;
    p.fade = false;
    p.sprite.setTexture(`vfx:${strip}`, 0);
    p.sprite.setPosition(x, y);
    p.sprite.setRotation(opts.rotation ?? 0);
    p.sprite.setAlpha(p.startAlpha);
    p.sprite.setDepth(opts.depth ?? 30);
    if (opts.tint !== undefined) p.sprite.setTint(opts.tint);
    else p.sprite.clearTint();
    p.sprite.setVisible(true);
  }

  smoke(x: number, y: number, vx: number, vy: number, tint: number, alpha: number, small: boolean): void {
    const strip = small ? 'smoke_small' : this.cursor % 2 === 0 ? 'smoke_a' : 'smoke_b';
    // Quarter-turn steps keep clusters pixel-true while breaking up repetition.
    this.spawn(strip, x, y, vx, vy, { tint, alpha, drag: 3.2, rotation: (this.cursor % 4) * (Math.PI / 2) });
  }

  exhaust(x: number, y: number, vx: number, vy: number): void {
    this.spawn('exhaust', x, y, vx, vy, { alpha: 0.75, drag: 2 });
  }

  spark(x: number, y: number, vx: number, vy: number): void {
    this.spawn('spark', x, y, vx, vy, { drag: 4.5, rotation: Math.atan2(vy, vx) + Math.PI / 4, depth: 34 });
  }

  impact(x: number, y: number): void {
    this.spawn('impact', x, y, 0, 0, { drag: 0, depth: 36 });
  }

  skid(x: number, y: number, rotation: number, heavy: boolean): void {
    const i = this.skidCursor;
    this.skidCursor = (this.skidCursor + 1) % this.skids.length;
    const s = this.skids[i]!;
    s.setTexture(heavy ? 'vfx:skid_heavy' : 'vfx:skid_light', i % 4);
    s.setPosition(x, y);
    s.setRotation(rotation);
    s.setAlpha(1);
    s.setVisible(true);
    this.skidBorn[i] = this.clock;
  }

  update(dt: number): void {
    this.clock += dt;
    for (const p of this.pool) {
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.active = false;
        p.sprite.setVisible(false);
        continue;
      }
      const damp = Math.exp(-p.drag * dt);
      p.vx *= damp;
      p.vy *= damp;
      p.sprite.x += p.vx * dt;
      p.sprite.y += p.vy * dt;
      p.sprite.setFrame(Math.min(p.frames - 1, Math.floor(p.age * p.fps)));
    }
    // Rubber fades out over a few seconds so the road never fills up.
    const hold = 5;
    const fade = 3;
    for (let i = 0; i < this.skids.length; i++) {
      const s = this.skids[i]!;
      if (!s.visible) continue;
      const age = this.clock - this.skidBorn[i]!;
      if (age > hold + fade) s.setVisible(false);
      else if (age > hold) s.setAlpha(Math.round((1 - (age - hold) / fade) * 4) / 4);
    }
  }

  clear(): void {
    for (const p of this.pool) {
      p.active = false;
      p.sprite.setVisible(false);
    }
    for (const s of this.skids) s.setVisible(false);
  }
}
