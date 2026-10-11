import { TAU } from '@bolt/shared';
import { MODE_LOOP } from '../vfx/EffectPool.js';
import { LAYER_FIRE } from '../vfx/atlas.js';
import type { CombatStage } from './stage.js';

/**
 * The effects stress scenario (Section 19.5), run with `?debug=1&vfxStress=1` on any race or
 * scenario and by the pool's unit test: far more at once than two cars can produce. Every
 * quarter second a rocket blast, every second a mortar strike and an EMP, a standing field of
 * road fire, a swarm of missiles with trails and a steady rain of small impacts, all inside
 * the view around the local car. It goes through the same recipes and the same pools as real
 * events, so what it measures is what a race would cost at its very worst.
 */
let clock = 0;
let beat = 0;
let fires: number[] | null = null;
const missiles: number[] = [];

export function resetStress(): void {
  clock = 0;
  beat = 0;
  fires = null;
  missiles.length = 0;
}

export function runStress(stage: CombatStage, dt: number, cx: number, cy: number): void {
  const fx = stage.fx;
  const pool = stage.pool;
  const a = stage.a;
  clock += dt;
  if (!fires) {
    // 48 fire sprites, the simulation's hazard cap, as pinned sprites.
    fires = [];
    for (let i = 0; i < 48; i++) {
      const s = pool.pin(
        i % 2 ? a.fire_a : a.fire_b,
        cx - 230 + (i % 12) * 40,
        cy - 110 + Math.floor(i / 12) * 70,
        LAYER_FIRE,
      );
      if (s >= 0) pool.age[s] = i * 0.07;
      fires.push(s);
    }
    // 16 missiles circling, each leaving its trail.
    for (let i = 0; i < 16; i++) {
      const s = pool.pin(a.missile, cx, cy);
      if (s >= 0) pool.mode[s] = MODE_LOOP;
      missiles.push(s);
    }
  }
  for (let i = 0; i < missiles.length; i++) {
    const s = missiles[i]!;
    if (s < 0) continue;
    const ang = clock * 1.6 + (i / missiles.length) * TAU;
    const r = 90 + (i % 4) * 34;
    pool.x[s] = cx + Math.cos(ang) * r;
    pool.y[s] = cy + Math.sin(ang) * r * 0.6;
    pool.aim(s, ang + Math.PI);
    if (Math.floor(clock * 30) % 2 === 0)
      fx.puff(pool.x[s]!, pool.y[s]!, 0, 0, 0xf2f4fa, 0.45, true);
  }
  const step = Math.floor(clock / 0.05);
  while (beat < step) {
    beat++;
    fx.seed(beat * 7919);
    const x = cx + (fx.r() - 0.5) * 520;
    const y = cy + (fx.r() - 0.5) * 240;
    stage.atWorld(x, y);
    // Twenty small kinetic impacts a second, as two machine guns and a shotgun would make.
    fx.kinetic(stage.at, fx.r() * TAU);
    if (beat % 5 === 0) fx.rocketBlast(stage.at, 34, beat);
    if (beat % 20 === 0) {
      stage.atWorld(cx + (fx.r() - 0.5) * 300, cy + (fx.r() - 0.5) * 160);
      fx.mortarBlast(stage.at, 60, beat);
    }
    if (beat % 20 === 10) {
      stage.atWorld(cx + (fx.r() - 0.5) * 200, cy + (fx.r() - 0.5) * 120);
      fx.empBurst(stage.at, 135, beat);
    }
    if (beat % 7 === 0) {
      stage.atWorld(cx + (fx.r() - 0.5) * 400, cy + (fx.r() - 0.5) * 200);
      fx.bloomBlast(stage.at, 30, beat);
    }
  }
}
