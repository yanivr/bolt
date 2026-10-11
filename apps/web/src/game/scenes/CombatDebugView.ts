// DEBUG VISUAL: replaced in Milestone C part 2
//
// Everything in this file is a stand-in so that combat can be operated and watched while the
// real rendering is built: the rival car (the ordinary CarView, moved by naive interpolation),
// projectiles as dots, hazards as outlines, beams as lines and explosions as rings. None of
// it is art, none of it is final, and nothing here feeds gameplay. The contract part 2 builds
// on is the data this reads: `RaceSnapshot` and `RaceEvent` (docs/COMBAT_API.md).

import type {
  CarPose,
  MountedPartSprite,
  RaceEvent,
  RaceSnapshot,
  RivalSnapshot,
  VehicleLoadout,
} from '@bolt/shared';
import { SIM_DT, engineSheetFor, lerp, lerpAngle } from '@bolt/shared';
import type Phaser from 'phaser';
import type { GameManifests } from '../assets.js';
import { CarView } from '../composition/CarView.js';
import { createPaintedBody } from '../composition/paint.js';

export type RivalSprites = { loadout: VehicleLoadout; parts: MountedPartSprite[] };

const HAZARD_COLOR: Record<string, number> = {
  mine: 0xffb454,
  oil: 0x2a3350,
  foam: 0xe8ecf4,
  fire: 0xff6a3d,
  frost: 0x9fe8ff,
  decoy: 0x67dea7,
};
const PROJECTILE_COLOR: Record<string, number> = {
  bullet: 0xffe08a,
  pellet: 0xffe08a,
  rocket: 0xff8a4c,
  missile: 0xff5d5d,
  frost: 0x9fe8ff,
  harpoon: 0xd8dde8,
  boomerang: 0xc8d2e0,
  foam: 0xe8ecf4,
  shell: 0x8a6a4a,
};

type Flash = {
  kind: 'ring' | 'line';
  x: number;
  y: number;
  toX: number;
  toY: number;
  radius: number;
  left: number;
  color: number;
};

/** Sprite sheets a rival car needs, as `[key, file reference]` pairs for the scene's loader. */
export function rivalSheets(
  manifests: GameManifests,
  sprites: RivalSprites,
): Array<[string, { file: string; frameWidth: number; frameHeight: number }]> {
  const { loadout, parts } = sprites;
  const chassis = manifests.cars.chassis[loadout.chassisId];
  const wheels = manifests.cars.wheels[loadout.tireKitId];
  const engine = manifests.cars.engines[loadout.engineId];
  if (!chassis || !wheels || !engine) return [];
  const out: Array<[string, { file: string; frameWidth: number; frameHeight: number }]> = [
    [`car:${chassis.id}:body`, chassis.body],
    [`car:${chassis.id}:shadow`, chassis.shadow],
    [`car:${chassis.id}:brake`, chassis.brakeLights],
    [`car:${chassis.id}:head`, chassis.headlights],
    [`wheel:${loadout.tireKitId}`, wheels.sheet],
    [
      `engine:${loadout.engineId}:${chassis.engineInBay ? 'bay' : 'tail'}`,
      engineSheetFor(chassis, engine),
    ],
  ];
  for (const partId of new Set(parts.map((p) => p.partId))) {
    const ref = manifests.cars.parts?.[partId];
    if (ref) out.push([`part:${partId}`, ref.sheet]);
  }
  return out;
}

export class CombatDebugView {
  private rival: CarView | null = null;
  private readonly ground: Phaser.GameObjects.Graphics;
  private readonly air: Phaser.GameObjects.Graphics;
  private latest: RaceSnapshot | null = null;
  private previous: RivalSnapshot | null = null;
  private latestAt = 0;
  private previousAt = 0;
  private roll = 0;
  private readonly flashes: Flash[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    manifests: GameManifests,
    sprites: RivalSprites | null,
    depthCar: number,
  ) {
    this.ground = scene.add.graphics().setDepth(14);
    this.air = scene.add.graphics().setDepth(depthCar + 4);
    if (sprites) {
      const { loadout, parts } = sprites;
      const chassis = manifests.cars.chassis[loadout.chassisId];
      const wheels = manifests.cars.wheels[loadout.tireKitId];
      const engine = manifests.cars.engines[loadout.engineId];
      if (chassis && wheels && engine) {
        const paint = manifests.cars.paints[loadout.paintId];
        const body = `car:${chassis.id}:body`;
        this.rival = new CarView(
          scene,
          chassis,
          wheels,
          engine,
          {
            body: paint ? createPaintedBody(scene, body, chassis, paint) : body,
            shadow: `car:${chassis.id}:shadow`,
            brake: `car:${chassis.id}:brake`,
            head: `car:${chassis.id}:head`,
            wheels: `wheel:${loadout.tireKitId}`,
            engine: `engine:${loadout.engineId}:${chassis.engineInBay ? 'bay' : 'tail'}`,
            parts: Object.fromEntries(parts.map((p) => [p.partId, `part:${p.partId}`])),
          },
          parts,
        );
        this.rival.container.setDepth(depthCar - 1).setVisible(false);
      }
    }
  }

  onRace(snapshot: RaceSnapshot, nowMs: number): void {
    this.previous = this.latest ? this.latest.rival : null;
    this.previousAt = this.latestAt;
    this.latest = snapshot;
    this.latestAt = nowMs;
  }

  onEvent(event: RaceEvent): void {
    const push = (flash: Flash) => {
      if (this.flashes.length < 48) this.flashes.push(flash);
    };
    if (event.type === 'explosion')
      push({
        kind: 'ring',
        x: event.x,
        y: event.y,
        toX: 0,
        toY: 0,
        radius: Math.max(10, event.radius),
        left: 0.35,
        color: 0xffa24c,
      });
    else if (event.type === 'beam')
      push({
        kind: 'line',
        x: event.x,
        y: event.y,
        toX: event.toX,
        toY: event.toY,
        radius: 0,
        left: 0.18,
        color: 0x9fe8ff,
      });
    else if (event.type === 'hit')
      push({
        kind: 'ring',
        x: event.x,
        y: event.y,
        toX: 0,
        toY: 0,
        radius: 5,
        left: 0.15,
        color: 0xffffff,
      });
    else if (event.type === 'area' && event.half >= Math.PI)
      push({
        kind: 'ring',
        x: event.x,
        y: event.y,
        toX: 0,
        toY: 0,
        radius: event.range,
        left: 0.3,
        color: 0xb48cff,
      });
    else if (event.type === 'telegraph')
      push({
        kind: 'ring',
        x: event.x,
        y: event.y,
        toX: 0,
        toY: 0,
        radius: event.radius,
        left: event.ticks * SIM_DT,
        color: 0xff5d5d,
      });
  }

  clear(): void {
    this.flashes.length = 0;
    this.latest = null;
    this.previous = null;
    this.rival?.container.setVisible(false);
  }

  update(nowMs: number, dt: number, scale: number): void {
    const snapshot = this.latest;
    this.ground.clear();
    this.air.clear();
    if (!snapshot) return;
    const snap = (v: number) => Math.round(v * scale) / scale;
    // Ticks the server has probably simulated since the snapshot was received.
    const elapsedTicks = Math.min(6, (nowMs - this.latestAt) / (SIM_DT * 1000));

    // --- Rival car -----------------------------------------------------------------------------
    if (this.rival) {
      const now = snapshot.rival;
      const before = this.previous ?? now;
      const span = Math.max(1, this.latestAt - this.previousAt);
      const t = Math.min(1.4, (nowMs - this.latestAt) / span);
      const x = lerp(before.x, now.x, t);
      const y = lerp(before.y, now.y, t);
      const heading = lerpAngle(before.headingRad, now.headingRad, Math.min(1, t));
      const speed = Math.hypot(now.velocityX, now.velocityY);
      this.roll += dt * Math.min(18, speed / 6);
      const pose: CarPose = {
        headingRad: heading,
        steer: now.steeringInput,
        roll: this.roll,
        braking: now.braking,
        headlights: true,
        bodyShiftX: 0,
        bodyShiftY: 0,
      };
      this.rival.apply(pose);
      this.rival.setPosition(snap(x), snap(y));
      this.rival.container.setVisible(true).setAlpha(now.ko ? 0.5 : 1);
    }

    // --- Hazards -------------------------------------------------------------------------------
    for (const hazard of snapshot.hazards) {
      const color = HAZARD_COLOR[hazard.kind] ?? 0xffffff;
      const alpha = hazard.revealed ? 0.9 : 0.25;
      this.ground.lineStyle(1, color, alpha);
      this.ground.fillStyle(color, alpha * 0.35);
      if (hazard.halfLength > 0) {
        const ax = Math.sin(hazard.angle);
        const ay = -Math.cos(hazard.angle);
        const points = [
          [hazard.halfLength, hazard.radius],
          [hazard.halfLength, -hazard.radius],
          [-hazard.halfLength, -hazard.radius],
          [-hazard.halfLength, hazard.radius],
        ].map(([along, across]) => ({
          x: hazard.x + ax * along! - ay * across!,
          y: hazard.y + ay * along! + ax * across!,
        }));
        this.ground.fillPoints(points, true);
        this.ground.strokePoints(points, true);
      } else {
        this.ground.fillCircle(hazard.x, hazard.y, hazard.radius);
        this.ground.strokeCircle(hazard.x, hazard.y, hazard.radius);
      }
    }

    // --- Projectiles: moved forward from where and when they were last written ----------------
    for (const p of snapshot.projectiles) {
      const age = (snapshot.tick - p.tick + elapsedTicks) * SIM_DT;
      const x = p.x + p.vx * age;
      const y = p.y + p.vy * age;
      this.air.fillStyle(PROJECTILE_COLOR[p.kind] ?? 0xffffff, 1);
      this.air.fillCircle(x, y, p.kind === 'bullet' || p.kind === 'pellet' ? 1.5 : 3);
    }

    // --- Brief marks for discrete events ---------------------------------------------------------
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const flash = this.flashes[i]!;
      flash.left -= dt;
      if (flash.left <= 0) {
        this.flashes.splice(i, 1);
        continue;
      }
      this.air.lineStyle(1, flash.color, 0.9);
      if (flash.kind === 'ring') this.air.strokeCircle(flash.x, flash.y, flash.radius);
      else this.air.lineBetween(flash.x, flash.y, flash.toX, flash.toY);
    }
  }

  destroy(): void {
    this.rival?.destroy();
    this.ground.destroy();
    this.air.destroy();
  }
}
