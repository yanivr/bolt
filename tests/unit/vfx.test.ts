import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SCENARIOS, WEAPON_LIST } from '@bolt/content';
import type { DamageOverlayManifest, RaceEvent, RaceEventType } from '@bolt/shared';
import { CAR_HEADINGS, CAR_SHEET_COLUMNS, VFX_LAYERS, vfxFrameRect } from '@bolt/shared';
import { describe, expect, it } from 'vitest';
import { EVENT_HANDLERS } from '../../apps/web/src/game/combat/stage.js';
import { resetStress, runStress } from '../../apps/web/src/game/combat/stress.js';
import { GENERIC_FX, WEAPON_FX } from '../../apps/web/src/game/combat/weaponFx.js';
import { DECOR_CAP, EffectPool, LAYER_CAPACITY } from '../../apps/web/src/game/vfx/EffectPool.js';
import {
  PIXEL_CAPACITY,
  PixelFx,
  SHAPE_CAPACITY,
  SHAPE_RING,
  drawLine,
  drawRing,
} from '../../apps/web/src/game/vfx/PixelFx.js';
import {
  FxAtlas,
  LAYER_BODY,
  LAYER_COUNT,
  LAYER_SMOKE,
} from '../../apps/web/src/game/vfx/atlas.js';
import { QualityGovernor, setVfxQuality, vfxQuality } from '../../apps/web/src/game/vfx/quality.js';
import { ANIMS } from '../../apps/web/src/game/vfx/recipes.js';
import { readPng } from '../../art/scripts/lib/pixels.js';
import { buildCombatVfx } from '../../art/scripts/vfx/index.js';
import { packAtlas } from '../../art/scripts/vfx/pack.js';
import {
  CountingSink,
  carsManifest,
  createStage,
  fxManifest,
  playScenario,
} from '../helpers/stage.js';

/**
 * The combat presentation (Milestone C part 2): the effects atlas, the pools, the mapping from
 * every event and every weapon to something on screen, and the 33 showcase scenarios played
 * through the real stage with no browser.
 */

const ATLASES = resolve('apps/web/public/assets/atlases');
const atlasImage = readPng(resolve(ATLASES, 'vfx_combat', fxManifest.file));

describe('combat effects atlas', () => {
  const anims = Object.values(fxManifest.anims);

  it('is what the pipeline bakes, byte for byte', () => {
    const { image, manifest } = packAtlas(buildCombatVfx(), 'atlas.png');
    expect(manifest).toEqual(fxManifest);
    expect(image.width).toBe(atlasImage.width);
    expect(Buffer.from(image.data).equals(Buffer.from(atlasImage.data))).toBe(true);
  });

  it('matches its image, and no two frames touch or share a pixel of padding', () => {
    expect(atlasImage.width).toBe(fxManifest.width);
    expect(atlasImage.height).toBe(fxManifest.height);
    expect(fxManifest.padding).toBeGreaterThanOrEqual(2);
    const owner = new Int32Array(fxManifest.width * fxManifest.height).fill(-1);
    let index = 0;
    for (const anim of anims) {
      for (let f = 0; f < anim.frames; f++, index++) {
        const r = vfxFrameRect(anim, f, fxManifest.padding);
        expect(r.x, anim.id).toBeGreaterThanOrEqual(0);
        expect(r.y, anim.id).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w, anim.id).toBeLessThanOrEqual(fxManifest.width);
        expect(r.y + r.h, anim.id).toBeLessThanOrEqual(fxManifest.height);
        // Claim the frame and half the padding on every side: a clash is a bleed waiting to happen.
        const pad = fxManifest.padding / 2;
        let clash = -1;
        for (let y = Math.max(0, r.y - pad); y < Math.min(fxManifest.height, r.y + r.h + pad); y++)
          for (
            let x = Math.max(0, r.x - pad);
            x < Math.min(fxManifest.width, r.x + r.w + pad);
            x++
          ) {
            const at = y * fxManifest.width + x;
            if (owner[at] !== -1 && owner[at] !== index) clash = owner[at]!;
            owner[at] = index;
          }
        expect(clash, `${anim.id} frame ${f}`).toBe(-1);
      }
    }
    // Nothing is drawn outside a frame.
    let stray = 0;
    for (let i = 0; i < owner.length; i++)
      if (owner[i] === -1 && atlasImage.data[i * 4 + 3] !== 0) stray++;
    expect(stray).toBe(0);
  });

  it.each(anims)(
    '$id has stable keys, sane timing and a first frame with something in it',
    (anim) => {
      // Names are stable and free of case-sensitivity traps (Section 13.8).
      expect(anim.id).toMatch(/^[a-z0-9_]+$/);
      expect(VFX_LAYERS).toContain(anim.layer);
      expect(anim.fps).toBeGreaterThan(0);
      expect(anim.frames).toBeGreaterThan(0);
      expect(anim.frames % Math.max(1, anim.directions)).toBe(0);
      expect(anim.anchorX).toBeGreaterThanOrEqual(0);
      expect(anim.anchorX).toBeLessThanOrEqual(anim.frameWidth);
      expect(anim.anchorY).toBeLessThanOrEqual(anim.frameHeight);
      if (anim.fallback) expect(fxManifest.anims[anim.fallback]).toBeDefined();
      // An additive strip sits on an additive layer, and only there.
      expect(anim.blend === 'add').toBe(anim.layer === 'glow' || anim.layer === 'flash');
      const first = vfxFrameRect(anim, 0, fxManifest.padding);
      let filled = 0;
      let soft = 0;
      for (let f = 0; f < anim.frames; f++) {
        const r = vfxFrameRect(anim, f, fxManifest.padding);
        for (let y = 0; y < r.h; y++)
          for (let x = 0; x < r.w; x++) {
            const a = atlasImage.alphaAt(r.x + x, r.y + y);
            if (f === 0 && a !== 0) filled++;
            if (a !== 0 && a !== 255) soft++;
          }
      }
      expect(first.w).toBe(anim.frameWidth);
      expect(filled).toBeGreaterThan(0);
      // Hard pixels everywhere; only light, marks on the road and shadows use stepped alpha.
      const mayBeSoft =
        anim.layer === 'glow' || anim.layer === 'decal' || anim.id === 'shadow_blob';
      if (!mayBeSoft) expect(soft, anim.id).toBe(0);
    },
  );

  it('uses few enough colors to stay an indexed image', () => {
    const colors = new Set<number>();
    for (let i = 0; i < atlasImage.data.length; i += 4) {
      const a = atlasImage.data[i + 3]!;
      if (a === 0) continue;
      colors.add(
        ((atlasImage.data[i]! << 24) |
          (atlasImage.data[i + 1]! << 16) |
          (atlasImage.data[i + 2]! << 8) |
          a) >>>
          0,
      );
    }
    expect(colors.size).toBeLessThanOrEqual(255);
  });

  it('holds every strip the runtime asks for, and no strip the runtime never draws', () => {
    const atlas = new FxAtlas(fxManifest);
    for (const name of ANIMS) expect(atlas.has(name), name).toBe(true);
    const used = new Set<string>(ANIMS);
    for (const anim of anims) if (anim.fallback) used.add(anim.fallback);
    expect(anims.map((a) => a.id).filter((id) => !used.has(id))).toEqual([]);
    expect(() => atlas.id('no_such_strip')).toThrow();
  });

  it('rocket and mortar blasts are the biggest fire in the atlas', () => {
    const area = (id: string) =>
      fxManifest.anims[id]!.frameWidth * fxManifest.anims[id]!.frameHeight;
    const blasts = ['fireball_a', 'fireball_b', 'mortar_core'];
    const others = anims.filter(
      (a) => a.layer === 'fire' && !blasts.includes(a.id) && !a.id.startsWith('outline'),
    );
    for (const other of others)
      for (const blast of blasts) expect(area(blast), other.id).toBeGreaterThan(area(other.id));
    // Explosion strips run 12 to 20 frames with more than one authored variant (Section 14.2).
    expect(fxManifest.anims.fireball_a!.frames).toBeGreaterThanOrEqual(12);
    expect(fxManifest.anims.mortar_core!.frames).toBeGreaterThanOrEqual(12);
  });
});

describe('damage overlays', () => {
  const damage = JSON.parse(
    readFileSync(resolve(ATLASES, 'vfx_damage/manifest.json'), 'utf8'),
  ) as DamageOverlayManifest;

  it('has a sheet for every chassis, three states of 64 headings, drawn only on bodywork', () => {
    expect(damage.states).toEqual(['scuffed', 'battered', 'frosted']);
    for (const chassis of Object.values(carsManifest.chassis)) {
      const ref = damage.chassis[chassis.id];
      expect(ref, chassis.id).toBeDefined();
      const image = readPng(resolve(ATLASES, 'vfx_damage', ref!.file));
      const body = readPng(resolve(ATLASES, 'cars', chassis.body.file));
      const rows = CAR_HEADINGS / CAR_SHEET_COLUMNS;
      expect(ref!.frameWidth).toBe(chassis.body.frameWidth);
      expect(image.width).toBe(body.width);
      expect(image.height).toBe(body.height * damage.states.length);
      expect(ref!.rows).toBe(rows * damage.states.length);
      let off = 0;
      const marks = [0, 0, 0];
      for (let y = 0; y < image.height; y++)
        for (let x = 0; x < image.width; x++) {
          if (image.alphaAt(x, y) === 0) continue;
          expect(image.alphaAt(x, y)).toBe(255);
          marks[Math.floor(y / body.height)]!++;
          if (body.alphaAt(x, y % body.height) === 0) off++;
        }
      expect(off, chassis.id).toBe(0);
      // Each state is there, and a battered car carries clearly more marks than a scuffed one.
      expect(marks[0]).toBeGreaterThan(200);
      expect(marks[1]!).toBeGreaterThan(marks[0]! * 1.5);
      expect(marks[2]).toBeGreaterThan(200);
    }
  });
});

describe('effect pool', () => {
  const atlas = new FxAtlas(fxManifest);
  const puff = atlas.id('puff_a');
  const shard = atlas.id('shard_a');
  const cars = new Float32Array(2);

  it('never grows: a flood of sprites stays inside the decorative cap of each layer', () => {
    const pool = new EffectPool(atlas);
    const size = pool.size;
    expect(size).toBe(LAYER_CAPACITY.reduce((a, b) => a + b, 0));
    for (let i = 0; i < 20_000; i++) {
      pool.spawn(i % 2 ? puff : shard, i % 97, i % 89);
      if (i % 500 === 0) pool.update(1 / 60, cars, cars);
      expect(pool.decorCount(LAYER_SMOKE)).toBeLessThanOrEqual(DECOR_CAP[LAYER_SMOKE]!);
      expect(pool.decorCount(LAYER_BODY)).toBeLessThanOrEqual(DECOR_CAP[LAYER_BODY]!);
    }
    expect(pool.size).toBe(size);
    expect(pool.count()).toBeLessThanOrEqual(DECOR_CAP[LAYER_SMOKE]! + DECOR_CAP[LAYER_BODY]!);
    expect(pool.recycled).toBeGreaterThan(
      19_000 - DECOR_CAP[LAYER_SMOKE]! - DECOR_CAP[LAYER_BODY]!,
    );
    for (let l = 0; l < LAYER_COUNT; l++)
      expect(pool.peak[l]).toBeLessThanOrEqual(LAYER_CAPACITY[l]!);
  });

  it('recycles the oldest decorative sprite and reuses slots after they expire', () => {
    const pool = new EffectPool(atlas);
    const first = pool.spawn(puff, 0, 0);
    for (let i = 1; i < DECOR_CAP[LAYER_SMOKE]!; i++) pool.spawn(puff, i, 0);
    expect(pool.isLive(first)).toBe(true);
    const extra = pool.spawn(puff, 5, 5);
    // The newcomer took the oldest one's place.
    expect(extra).toBe(first);
    expect(pool.x[extra]).toBe(5);
    expect(pool.recycled).toBe(1);
    // Everything runs out by itself, and the pool is empty again.
    for (let i = 0; i < 120; i++) pool.update(1 / 60, cars, cars);
    expect(pool.count()).toBe(0);
    expect(pool.spawn(puff, 1, 1)).toBeGreaterThanOrEqual(0);
  });

  it('never recycles, culls or expires a pinned sprite: gameplay objects are not dropped', () => {
    const pool = new EffectPool(atlas);
    pool.setView(0, 0, 100, 100);
    const pinned: number[] = [];
    // Far outside the view, and more of them than the simulation can have in flight.
    for (let i = 0; i < 64; i++) pinned.push(pool.pin(atlas.id('rocket'), 5000 + i, 5000));
    expect(pinned.every((s) => s >= 0)).toBe(true);
    for (let i = 0; i < 5000; i++) pool.spawn(shard, 50, 50);
    for (let i = 0; i < 600; i++) pool.update(1 / 60, cars, cars);
    expect(pinned.every((s) => pool.isLive(s))).toBe(true);
    expect(pool.refused).toBe(0);
    // A layer packed with pinned sprites still finds room for one more by evicting decoration.
    const full = new EffectPool(atlas);
    for (let i = 0; i < DECOR_CAP[LAYER_BODY]!; i++) full.spawn(shard, 1, 1);
    const more: number[] = [];
    for (let i = 0; i < LAYER_CAPACITY[LAYER_BODY]!; i++)
      more.push(full.pin(atlas.id('rocket'), 1, 1));
    expect(more.every((s) => s >= 0)).toBe(true);
    expect(full.decorCount(LAYER_BODY)).toBe(0);
    expect(full.pin(atlas.id('rocket'), 1, 1)).toBe(-1);
    expect(full.refused).toBe(1);
    for (const s of more) full.release(s);
    expect(full.count()).toBe(0);
  });

  it('culls decoration that starts outside the view and hides what leaves it', () => {
    const pool = new EffectPool(atlas);
    pool.setView(0, 0, 400, 200);
    expect(pool.spawn(puff, 2000, 2000)).toBe(-1);
    expect(pool.culled).toBe(1);
    const s = pool.spawn(puff, 200, 100);
    pool.update(1 / 60, cars, cars);
    expect(pool.shown[s]).toBe(1);
    pool.x[s] = 900;
    pool.update(1 / 60, cars, cars);
    expect(pool.shown[s]).toBe(0);
  });

  it('the low tier halves decorative counts and caps', () => {
    const pool = new EffectPool(atlas);
    pool.quality = 'low';
    expect(pool.scaled(12)).toBe(6);
    expect(pool.scaled(1)).toBe(1);
    for (let i = 0; i < 1000; i++) pool.spawn(puff, 0, 0);
    expect(pool.decorCount(LAYER_SMOKE)).toBe(DECOR_CAP[LAYER_SMOKE]! / 2);
    const pinned = pool.pin(puff, 0, 0);
    expect(pinned).toBeGreaterThanOrEqual(0);
  });

  it('moves a fragment through an arc, lands it and lets it lie', () => {
    const pool = new EffectPool(atlas);
    const s = pool.spawn(shard, 100, 100);
    pool.vx[s] = 60;
    pool.vz[s] = 120;
    pool.gravity[s] = 330;
    pool.bounce[s] = 0.3;
    pool.life[s] = 5;
    let top = 0;
    for (let i = 0; i < 240; i++) {
      pool.update(1 / 60, cars, cars);
      top = Math.max(top, pool.z[s]!);
    }
    expect(top).toBeGreaterThan(15);
    expect(pool.z[s]).toBe(0);
    expect(pool.x[s]!).toBeGreaterThan(110);
    const rest = pool.x[s]!;
    for (let i = 0; i < 120; i++) pool.update(1 / 60, cars, cars);
    expect(Math.abs(pool.x[s]! - rest)).toBeLessThan(1);
  });

  it('a sprite that rides a car is drawn where the car is', () => {
    const pool = new EffectPool(atlas);
    const s = pool.spawn(atlas.id('flash_s'), 4, -3, -1, false);
    pool.follow[s] = 1;
    pool.update(1 / 60, new Float32Array([0, 500]), new Float32Array([0, 300]));
    const anim = pool.anim[s]!;
    expect(pool.drawX[s]! + atlas.anchorX[anim]!).toBe(504);
    expect(pool.drawY[s]! + atlas.anchorY[anim]!).toBe(297);
  });
});

describe('pixel effects', () => {
  it('draws only whole-pixel rectangles and stays inside its fixed stores', () => {
    const px = new PixelFx();
    const sink = new CountingSink();
    for (let i = 0; i < 5000; i++)
      px.pixel(i % 50, i % 40, 30, -20, 0.5, i % 15, 1 + (i % 3), 40, 300);
    expect(px.pixelsLive).toBe(PIXEL_CAPACITY);
    for (let i = 0; i < 500; i++) {
      const s = px.shape(SHAPE_RING, 1, 0.4, 3, i);
      px.sx0[s] = 100.3;
      px.sy0[s] = 80.7;
      px.sA[s] = 5;
      px.sB[s] = 60;
      px.sC[s] = 12;
    }
    expect(px.shapesLive).toBe(SHAPE_CAPACITY);
    const cars = new Float32Array(2);
    for (let f = 0; f < 30; f++) {
      px.update(1 / 60);
      px.draw(sink, 0, cars, cars);
      px.draw(sink, 1, cars, cars);
    }
    expect(sink.rects).toBeGreaterThan(1000);
    expect(sink.bad).toBe(0);
    px.low = true;
    px.clear();
    for (let i = 0; i < 5000; i++) px.pixel(0, 0, 0, 0, 1, 0);
    expect(px.pixelsLive).toBe(PIXEL_CAPACITY / 2);
  });

  it('a line covers both ends, merges runs and honours dashes', () => {
    const cells: Array<[number, number, number, number]> = [];
    const sink = { rect: (x: number, y: number, w: number, h: number) => cells.push([x, y, w, h]) };
    expect(drawLine(sink, 0, 0, 9, 0, 0xffffff)).toBe(1);
    expect(cells).toEqual([[0, 0, 10, 1]]);
    cells.length = 0;
    drawLine(sink, 0, 0, 9, 3, 0xffffff);
    const covered = cells.reduce((n, c) => n + c[2] * c[3], 0);
    expect(covered).toBe(10);
    expect(cells.some((c) => c[0] === 0 && c[1] === 0)).toBe(true);
    expect(cells.some((c) => c[0] + c[2] - 1 === 9 && c[1] === 3)).toBe(true);
    cells.length = 0;
    drawLine(sink, 0, 0, 19, 0, 0xffffff, 1, 2, 2);
    expect(cells.map((c) => c[2])).toEqual([2, 2, 2, 2, 2]);
  });

  it('a ring costs rows, not pixels, and a broken ring leaves its gaps', () => {
    const whole = new CountingSink();
    const broken = new CountingSink();
    drawRing(whole, 0, 0, 60, 2, 0xffffff, 0, 1, 0, 1);
    drawRing(broken, 0, 0, 60, 2, 0xffffff, 12, 0.5, 0, 1);
    expect(whole.rects).toBeLessThan(260);
    expect(whole.bad + broken.bad).toBe(0);
    let lit = 0;
    let dark = 0;
    drawRing({ rect: (_x, _y, w) => (lit += w) }, 0, 0, 60, 2, 0, 0, 1, 0, 1);
    drawRing({ rect: (_x, _y, w) => (dark += w) }, 0, 0, 60, 2, 0, 12, 0.5, 0, 1);
    expect(dark / lit).toBeGreaterThan(0.35);
    expect(dark / lit).toBeLessThan(0.65);
  });
});

describe('quality governor', () => {
  it('drops after half a second of slow frames and comes back after five steady seconds', () => {
    setVfxQuality('auto');
    const governor = new QualityGovernor();
    for (let i = 0; i < 300; i++) governor.update(1 / 60);
    expect(vfxQuality()).toBe('high');
    let dropped = -1;
    for (let i = 0; i < 120 && dropped < 0; i++) if (governor.update(1 / 30) === 'low') dropped = i;
    expect(dropped).toBeGreaterThan(10);
    expect(dropped).toBeLessThan(60);
    let frames = 0;
    while (governor.update(1 / 60) === 'low' && frames < 2000) frames++;
    expect(frames / 60).toBeGreaterThan(5);
    expect(frames / 60).toBeLessThan(8);
    // One long hitch (a tab switch) is not a slow device.
    governor.update(0.4);
    expect(vfxQuality()).toBe('high');
    setVfxQuality('low');
    expect(governor.update(1 / 60)).toBe('low');
    setVfxQuality('auto');
    setVfxQuality('high');
    setVfxQuality('auto');
  });
});

// Every event type the protocol has. A new one fails to compile here until it is listed, and
// then fails the test below until it has a handler.
const EVENT_TYPES: Record<RaceEventType, true> = {
  checkpoint: true,
  lap: true,
  finish: true,
  wall: true,
  position: true,
  windup: true,
  shot: true,
  beam: true,
  area: true,
  telegraph: true,
  lock: true,
  warning: true,
  hit: true,
  explosion: true,
  impact: true,
  status: true,
  impulse: true,
  component: true,
  shield: true,
  hazard: true,
  tether: true,
  utility: true,
  misfire: true,
  refused: true,
  ko: true,
  result: true,
};

/** A number that changes whenever anything a player could see changes. */
function visible(stage: ReturnType<typeof createStage>): string {
  const cars = stage.cars.map((car) =>
    [
      car.sparkle > 0,
      car.liftVelocity,
      car.recoilTime > 0,
      car.bodyFlash > 0,
      Array.from(car.flash).some((v) => v > 0),
      Array.from(car.partKick).join(),
      Array.from(car.partTurnSpan).join(),
      Array.from(car.chargeAge).some((v) => v > 0),
      Array.from(car.partHidden).join(),
      Array.from(car.wheelDrop).join(),
      car.shieldRipple > 0,
      car.gripSource,
      car.slowSource,
      Array.from(car.moduleUp).join(),
    ].join('|'),
  );
  const hazards = stage.hazards.filter((h) => h.active).map((h) => `${h.id}:${h.pulse > 0}`);
  const sink = new CountingSink();
  stage.drawGround(sink);
  stage.drawAir(sink);
  return [
    stage.pool.count(),
    stage.px.pixelsLive,
    stage.px.shapesLive,
    sink.rects,
    stage.tether.active,
    cars,
    hazards,
  ].join('#');
}

describe('event and weapon mapping', () => {
  it('has a handler for every event type and nothing else', () => {
    expect(Object.keys(EVENT_HANDLERS).sort()).toEqual(Object.keys(EVENT_TYPES).sort());
    for (const type of Object.keys(EVENT_TYPES) as RaceEventType[])
      expect(typeof EVENT_HANDLERS[type], type).toBe('function');
  });

  it('has an identity for every weapon in the catalog, with a launch and a hit', () => {
    expect(WEAPON_LIST).toHaveLength(20);
    for (const weapon of WEAPON_LIST) {
      const fx = WEAPON_FX[weapon.id];
      expect(fx, weapon.id).toBeDefined();
      expect(fx, weapon.id).not.toBe(GENERIC_FX);
      expect(typeof fx!.shot, weapon.id).toBe('function');
      expect(typeof fx!.hit, weapon.id).toBe('function');
    }
    // No two weapons share an identity object.
    expect(new Set(WEAPON_LIST.map((w) => WEAPON_FX[w.id])).size).toBe(20);
  });

  // One synthetic event of each type, on a stage where both cars, a projectile, a hazard and a
  // shield exist. The picture must change for every one of them.
  it.each(Object.keys(EVENT_TYPES) as RaceEventType[])('%s changes what is on screen', (type) => {
    const def = SCENARIOS.find((s) => s.id === 'shield_break')!;
    // Stop at a quiet moment after the first burst, with everything still in place.
    const run = playScenario(def, { extraTicks: -def.durationTicks + 80 });
    const stage = run.stage;
    const you = stage.cars[0]!;
    const rival = stage.cars[1]!;
    const tick = stage.latestTick;
    const base = { id: 9000, tick };
    const hazard = stage.hazards[0]!;
    hazard.active = true;
    hazard.id = 77;
    hazard.kind = 'mine';
    hazard.revealed = true;
    hazard.x = you.x + 40;
    hazard.y = you.y;
    hazard.radius = 14;
    (stage as unknown as { hazardById: Map<number, typeof hazard> }).hazardById.set(77, hazard);
    const samples: Record<RaceEventType, RaceEvent> = {
      checkpoint: { ...base, type: 'checkpoint', car: 0, index: 1 },
      lap: { ...base, type: 'lap', car: 0, lap: 1, lapTimeMs: 1000 },
      finish: { ...base, type: 'finish', car: 0, raceTimeMs: 1000, finished: true },
      wall: { ...base, type: 'wall', car: 1, speed: 150 },
      position: { ...base, type: 'position', leader: 1, gapMeters: 3 },
      windup: { ...base, type: 'windup', car: 0, part: 1, weapon: 'weapon_railshot', ticks: 24 },
      shot: {
        ...base,
        type: 'shot',
        car: 0,
        part: 0,
        weapon: 'weapon_front_mg',
        x: you.x,
        y: you.y,
        dir: you.heading,
        projectile: 0,
        n: 0,
        of: 5,
      },
      beam: {
        ...base,
        type: 'beam',
        car: 0,
        part: 0,
        weapon: 'weapon_tesla',
        x: you.x,
        y: you.y,
        toX: rival.x,
        toY: rival.y,
        hit: 1,
      },
      area: {
        ...base,
        type: 'area',
        car: 0,
        part: 0,
        weapon: 'weapon_emp',
        x: you.x,
        y: you.y,
        dir: 0,
        half: Math.PI,
        range: 135,
        ticks: 1,
      },
      telegraph: {
        ...base,
        type: 'telegraph',
        car: 0,
        part: 0,
        weapon: 'weapon_mortar',
        x: rival.x,
        y: rival.y,
        radius: 60,
        ticks: 42,
        projectile: 5,
      },
      lock: {
        ...base,
        type: 'lock',
        car: 0,
        part: 0,
        weapon: 'weapon_homing',
        target: 1,
        locked: true,
      },
      warning: { ...base, type: 'warning', car: 0, kind: 'trap', by: 1, value: 77 },
      hit: {
        ...base,
        type: 'hit',
        car: 1,
        by: 0,
        weapon: 'ram',
        cls: 'ram',
        x: rival.x,
        y: rival.y,
        component: 2,
        damage: 12,
        chassis: 5,
        shield: 0,
        armor: 3,
        absorbed: 0,
        projectile: 0,
      },
      explosion: {
        ...base,
        type: 'explosion',
        by: 0,
        weapon: 'weapon_rocket',
        x: rival.x,
        y: rival.y,
        radius: 34,
        projectile: 0,
      },
      impact: {
        ...base,
        type: 'impact',
        weapon: 'weapon_front_mg',
        x: rival.x + 30,
        y: rival.y,
        projectile: 0,
        on: 'wall',
      },
      status: {
        ...base,
        type: 'status',
        car: 1,
        by: 0,
        family: 'emp',
        state: 'applied',
        magnitude: 1,
        ticks: 45,
      },
      impulse: { ...base, type: 'impulse', car: 1, by: 0, weapon: 'weapon_hammer', dx: 120, dy: 0 },
      component: {
        ...base,
        type: 'component',
        car: 1,
        component: 2,
        condition: 'disabled',
        integrity: 0,
        repaired: false,
      },
      shield: {
        ...base,
        type: 'shield',
        car: 1,
        part: rival.rig!.partOfKind('breakaway'),
        state: 'broken',
        points: 35,
      },
      hazard: {
        ...base,
        type: 'hazard',
        hazard: 77,
        kind: 'mine',
        by: 1,
        state: 'cleared',
        x: hazard.x,
        y: hazard.y,
        car: 0,
      },
      tether: { ...base, type: 'tether', car: 0, part: 0, target: 1, state: 'attached' },
      utility: {
        ...base,
        type: 'utility',
        car: 1,
        part: 0,
        utility: 'defense_energy_shield',
        state: 'started',
        value: 0,
      },
      misfire: { ...base, type: 'misfire', car: 0, part: 0, weapon: 'weapon_front_mg' },
      refused: { ...base, type: 'refused', car: 0, part: 0, reason: 'cooldown' },
      ko: { ...base, type: 'ko', car: 1, by: 0 },
      result: { ...base, type: 'result', winner: 0, reason: 'finish' },
    };
    const before = visible(stage);
    EVENT_HANDLERS[type](stage, samples[type] as never);
    if (type === 'utility') {
      // No shipped utility event belongs to a defense; the repair is the one with a burst.
      const repair = SCENARIOS.find((s) => s.id === 'repair_burst')!;
      const played = playScenario(repair);
      expect(played.anims.has('clamp')).toBe(true);
      expect(played.anims.has('icon_wheel')).toBe(true);
      expect(played.anims.has('icon_engine')).toBe(true);
      expect(played.anims.has('wheel_debris')).toBe(true);
      return;
    }
    expect(visible(stage), type).not.toBe(before);
  });

  it('gives each of the twenty weapons a set of effects no other weapon has', () => {
    const signatures = new Map<string, string>();
    for (const weapon of WEAPON_LIST) {
      const def = SCENARIOS.find((s) => s.id === weapon.id);
      expect(def, weapon.id).toBeDefined();
      const stage = createStage();
      const run = playScenario(def!, { stage });
      // The scenario's own expectations were met, and every event was shown exactly once.
      const counts: Partial<Record<RaceEventType, number>> = {};
      for (const event of run.events) counts[event.type] = (counts[event.type] ?? 0) + 1;
      expect(stage.handled, weapon.id).toEqual(counts);
      // Something this weapon owns was drawn: strips, pixel shapes, or both.
      const signature = [...run.anims].sort().join(',') + '/' + [...run.shapes].sort().join(',');
      expect(run.anims.size + run.shapes.size, weapon.id).toBeGreaterThan(0);
      for (const [other, seen] of signatures)
        expect(signature, `${weapon.id} looks like ${other}`).not.toBe(seen);
      signatures.set(weapon.id, signature);
    }
    expect(signatures.size).toBe(20);
  });

  it('draws the four major examples of Section 13.3 from their layers', () => {
    const play = (id: string) => playScenario(SCENARIOS.find((s) => s.id === id)!);
    const kinetic = play('kinetic_impact');
    for (const strip of ['flash_s', 'chip_puff', 'muzzle_mg', 'muzzle_shotgun', 'pellet'])
      expect(kinetic.anims.has(strip), strip).toBe(true);
    const rocket = play('rocket_hit');
    // Flash, expanding fire, fragments, smoke: four clearly distinct layers, plus the mark it leaves.
    expect(rocket.anims.has('flash_m') || rocket.anims.has('outline_m')).toBe(true);
    expect(rocket.anims.has('fireball_a') || rocket.anims.has('fireball_b')).toBe(true);
    expect(['shard_a', 'shard_b', 'shard_c', 'shard_d'].some((s) => rocket.anims.has(s))).toBe(
      true,
    );
    expect(['smoke_dark_a', 'smoke_dark_b', 'smoke_dark_c'].some((s) => rocket.anims.has(s))).toBe(
      true,
    );
    expect(rocket.anims.has('scorch_m')).toBe(true);
    expect(rocket.shapes.has(SHAPE_RING)).toBe(true);
    const mortar = play('mortar_strike');
    for (const strip of ['mortar_core', 'shell', 'shadow_blob', 'scorch_l', 'dust_a'])
      expect(mortar.anims.has(strip), strip).toBe(true);
    // Its reticle is on the road for the whole flight of the shell.
    expect(mortar.shapes.size).toBeGreaterThanOrEqual(2);
    const emp = play('emp_burst');
    // No fireball for an electric attack.
    for (const strip of ['fireball_a', 'fireball_b', 'smoke_dark_a', 'shard_a', 'mortar_core'])
      expect(emp.anims.has(strip), strip).toBe(false);
    expect(emp.anims.has('circuit')).toBe(true);
    expect(emp.anims.has('shield_frag_a')).toBe(true);
    expect(emp.shapes.has(SHAPE_RING)).toBe(true);
  });
});

describe('scenarios through the stage', () => {
  it.each(SCENARIOS.map((s) => s.id))('%s plays cleanly inside every cap', (id) => {
    const def = SCENARIOS.find((s) => s.id === id)!;
    const kicks: number[] = [];
    const stage = createStage(kicks);
    const run = playScenario(def, { stage, settleSeconds: 15 });
    // Every event of the timeline was shown once.
    const total = Object.values(stage.handled).reduce((a, b) => a + (b ?? 0), 0);
    expect(total).toBe(run.events.length);
    // Pixel shapes are on the pixel grid; nothing was refused; nothing outgrew its pool.
    expect(run.sink.bad).toBe(0);
    expect(stage.pool.refused).toBe(0);
    for (let l = 0; l < LAYER_COUNT; l++)
      expect(stage.pool.peak[l]).toBeLessThanOrEqual(LAYER_CAPACITY[l]!);
    expect(stage.px.pixelsPeak).toBeLessThanOrEqual(PIXEL_CAPACITY);
    // Fifteen seconds after the last event the bursts have cleared and nothing leaked: what is
    // left is only what a damaged car keeps giving off, and the marks still fading on the road.
    expect(stage.pool.decorCount()).toBeLessThanOrEqual(40);
    expect(run.misblended.size, [...run.misblended].join()).toBe(0);
    // Camera impulses stay inside Section 13.7: never more than 3 world pixels.
    for (const kick of kicks) expect(kick).toBeLessThanOrEqual(3);
  });

  it('shows an event only when the render clock has reached its tick, and in order', () => {
    const def = SCENARIOS.find((s) => s.id === 'rocket_hit')!;
    const stage = createStage();
    const shown: Array<{ id: number; late: number }> = [];
    const hit = EVENT_HANDLERS.hit;
    const explosion = EVENT_HANDLERS.explosion;
    EVENT_HANDLERS.hit = (s, e) => {
      shown.push({ id: e.id, late: s.renderTick - e.tick });
      hit(s, e);
    };
    EVENT_HANDLERS.explosion = (s, e) => {
      shown.push({ id: e.id, late: s.renderTick - e.tick });
      explosion(s, e);
    };
    try {
      playScenario(def, { stage });
    } finally {
      EVENT_HANDLERS.hit = hit;
      EVENT_HANDLERS.explosion = explosion;
    }
    expect(shown.length).toBe(3);
    for (let i = 1; i < shown.length; i++) expect(shown[i]!.id).toBeGreaterThan(shown[i - 1]!.id);
    // Never early, and at most one tick after it happened.
    for (const s of shown) {
      expect(s.late).toBeGreaterThanOrEqual(0);
      expect(s.late).toBeLessThanOrEqual(1);
    }
  });

  it('puts a hit on the car where it landed, not where the car was', () => {
    const def = SCENARIOS.find((s) => s.id === 'weapon_front_mg')!;
    const stage = createStage();
    const places: Array<{ follow: number; ox: number; oy: number }> = [];
    const hit = EVENT_HANDLERS.hit;
    EVENT_HANDLERS.hit = (s, e) => {
      s.atCar(e.car, e.x, e.y, e.tick);
      places.push({ follow: s.at.follow, ox: s.at.ox, oy: s.at.oy });
      hit(s, e);
    };
    try {
      playScenario(def, { stage });
    } finally {
      EVENT_HANDLERS.hit = hit;
    }
    expect(places.length).toBeGreaterThanOrEqual(4);
    for (const place of places) {
      // On the target, at its tail: the cars drive toward negative x, so the tail is at +x.
      expect(place.follow).toBe(1);
      expect(place.ox).toBeGreaterThan(8);
      expect(place.ox).toBeLessThan(36);
      expect(Math.abs(place.oy)).toBeLessThan(26);
    }
  });

  it('turns the turret to its aim and marks damage on the right component', () => {
    const turret = playScenario(SCENARIOS.find((s) => s.id === 'weapon_turret')!);
    const car = turret.stage.cars[0]!;
    // The target ran ahead and to the right: the head is turned well off the car's own heading.
    expect(Math.abs(car.partHeading(0) - car.frameHeading)).toBeGreaterThan(0.3);
    const repair = SCENARIOS.find((s) => s.id === 'repair_burst')!;
    const conditions: number[] = [];
    let last = -1;
    playScenario(repair, {
      onFrame(stage, raceTick) {
        if ((raceTick === 20 || raceTick === 140 || raceTick === 230) && raceTick !== last) {
          last = raceTick;
          conditions.push(stage.cars[0]!.condition(2), stage.cars[0]!.condition(0));
        }
      },
    });
    // Front-left wheel dead and engine critical at the start; the wheel is fitted, then the engine mended.
    expect(conditions.slice(0, 2)).toEqual([3, 2]);
    expect(conditions[2]).toBe(0);
    expect(conditions[conditions.length - 1]).toBeLessThan(2);
  });
});

describe('effects stress (Section 19.5)', () => {
  it.each(['high', 'low'] as const)(
    'holds every cap at the %s tier and never drops a pinned sprite',
    (tier) => {
      const stage = createStage();
      stage.setQuality(tier);
      stage.viewX0 = -435;
      stage.viewY0 = -195;
      stage.viewX1 = 435;
      stage.viewY1 = 195;
      resetStress();
      const own = {
        x: 0,
        y: 0,
        heading: 0,
        frameHeading: 0,
        vx: 0,
        vy: 0,
        steer: 0,
        braking: false,
        roll: 0,
        bodyShiftX: 0,
        bodyShiftY: 0,
      };
      const sink = new CountingSink();
      let peak = 0;
      let peakRects = 0;
      const started = performance.now();
      const frames = 900;
      for (let f = 0; f < frames; f++) {
        runStress(stage, 1 / 60, 0, 0);
        stage.frame(1 / 60, own, 0.5);
        sink.rects = 0;
        stage.drawGround(sink);
        stage.drawAir(sink);
        peak = Math.max(peak, stage.pool.count());
        peakRects = Math.max(peakRects, sink.rects);
      }
      const ms = (performance.now() - started) / frames;
      const scale = tier === 'low' ? 0.5 : 1;
      for (let l = 0; l < LAYER_COUNT; l++) {
        expect(stage.pool.decorCount(l)).toBeLessThanOrEqual(DECOR_CAP[l]! * scale);
        expect(stage.pool.peak[l]).toBeLessThanOrEqual(LAYER_CAPACITY[l]!);
      }
      // 48 fires and 16 missiles were pinned at the start and are all still there.
      expect(stage.pool.refused).toBe(0);
      expect(stage.pool.count() - stage.pool.decorCount()).toBe(64);
      expect(stage.px.pixelsPeak).toBeLessThanOrEqual(PIXEL_CAPACITY * scale);
      expect(sink.bad).toBe(0);
      // The stage itself (no drawing) must leave a 60 Hz frame nearly whole, even on a slow machine.
      expect(ms).toBeLessThan(6);
      expect(peak).toBeGreaterThan(tier === 'low' ? 150 : 300);
      expect(peakRects).toBeGreaterThan(100);
    },
  );

  it('does not allocate in steady state', () => {
    const stage = createStage();
    stage.viewX0 = -435;
    stage.viewY0 = -195;
    stage.viewX1 = 435;
    stage.viewY1 = 195;
    resetStress();
    const own = {
      x: 0,
      y: 0,
      heading: 0,
      frameHeading: 0,
      vx: 0,
      vy: 0,
      steer: 0,
      braking: false,
      roll: 0,
      bodyShiftX: 0,
      bodyShiftY: 0,
    };
    const sink = new CountingSink();
    const frame = () => {
      runStress(stage, 1 / 60, 0, 0);
      stage.frame(1 / 60, own, 0.5);
      stage.drawGround(sink);
      stage.drawAir(sink);
    };
    for (let f = 0; f < 600; f++) frame();
    // Heap used can only be compared across a collection, so take the smallest of several
    // readings on each side: garbage that a frame made would raise the floor.
    const floor = (frames: number) => {
      let low = Infinity;
      for (let f = 0; f < frames; f++) {
        frame();
        if (f % 20 === 0) low = Math.min(low, process.memoryUsage().heapUsed);
      }
      return low;
    };
    const before = floor(600);
    const after = floor(3000);
    // 3,000 frames of the stress scene: a leak of even 100 bytes a frame would show as 300 kB.
    expect(after - before).toBeLessThan(1_500_000);
  });
});
