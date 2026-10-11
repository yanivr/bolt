import { CATALOG, allParts, partsByCategory } from '@bolt/content';
import type { RaceEvent, RaceEventType } from '@bolt/shared';
import { HAZARD_KINDS, STATUS_FAMILIES } from '@bolt/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { UI_SOUNDS } from '../../apps/web/src/game/audio/AudioSystem.js';
import {
  ENGINE_RECIPES,
  engineProblems,
  engineRecipe,
} from '../../apps/web/src/game/audio/engineRecipes.js';
import { SURFACE_CHARACTER, TIRE_CHARACTER } from '../../apps/web/src/game/audio/engineVoice.js';
import {
  HAPTIC_KINDS,
  HAPTIC_MIN_GAP_MS,
  HAPTIC_PATTERNS,
  haptic,
  hapticPattern,
  hapticsSupported,
  resetHaptics,
  setHapticsEnabled,
  setHapticsReduced,
} from '../../apps/web/src/game/audio/haptics.js';
import type { VoiceSlot } from '../../apps/web/src/game/audio/mixMath.js';
import {
  CAPS,
  PROTECTED_PRIORITY,
  RateLimiter,
  SPACE,
  TokenBucket,
  decideVoice,
  distanceGain,
  duckHold,
  duckTargets,
  engineSpeed,
  panFor,
  place,
} from '../../apps/web/src/game/audio/mixMath.js';
import {
  DEFAULT_THEME,
  MUSIC_RECIPES,
  THEMES,
  stepEvents,
} from '../../apps/web/src/game/audio/music.js';
import {
  BUS_IDS,
  CATEGORIES,
  LOUDNESS_TARGETS,
  recipeDuration,
  recipeProblems,
} from '../../apps/web/src/game/audio/recipe.js';
import { DEFAULT_AUDIO_PREFS, parseAudioPrefs } from '../../apps/web/src/game/audio/settings.js';
import { SFX, SFX_LIST } from '../../apps/web/src/game/audio/sfxRecipes.js';
import { ENGINE_TRIM, SFX_TRIM } from '../../apps/web/src/game/audio/sfxTrim.js';
import type { Cue, MapContext } from '../../apps/web/src/game/audio/soundMap.js';
import {
  DEFENSE_SOUNDS,
  EVENT_HANDLERS,
  PART_SOUNDS,
  REFUSAL_SOUNDS,
  STATUS_SOUNDS,
  SURFACE_SOUNDS,
  UTILITY_SOUNDS,
  WEAPON_SOUNDS,
  cuesForEvent,
  hitSurface,
  partSound,
} from '../../apps/web/src/game/audio/soundMap.js';
import { SCENARIO_SOUNDS, firstMissing } from '../audio/expectations.js';
import { SCENARIOS, runScenario } from '../scenarios/runner.js';

const context = (overrides: Partial<MapContext> = {}): MapContext => ({
  you: 0,
  parts: [
    ['weapon_rocket', 'defense_energy_shield'],
    ['defense_breakaway', 'defense_reactive'],
  ],
  wheels: [4, 4],
  laps: 3,
  gripSource: () => 'oil',
  ...overrides,
});

const playIds = (cues: Cue[]) => cues.filter((c) => c.kind === 'play').map((c) => c.id);

const event = <T extends RaceEventType>(
  type: T,
  body: Omit<Extract<RaceEvent, { type: T }>, 'id' | 'tick' | 'type'>,
): RaceEvent => ({ id: 1, tick: 100, type, ...body }) as unknown as RaceEvent;

describe('sound recipes', () => {
  it('are well formed, uniquely named and inside the voice budget', () => {
    expect(SFX_LIST.length).toBeGreaterThan(120);
    const ids = new Set<string>();
    for (const recipe of SFX_LIST) {
      expect(ids.has(recipe.id), `duplicate ${recipe.id}`).toBe(false);
      ids.add(recipe.id);
      expect(recipeProblems(recipe), recipe.id).toEqual([]);
      expect(BUS_IDS).toContain(recipe.bus);
      expect(CATEGORIES).toContain(recipe.cat);
      expect(recipe.layers.length).toBeLessThanOrEqual(CAPS.layersPerVoice);
      if (!recipe.loop) expect(recipeDuration(recipe), recipe.id).toBeLessThan(2);
      if (recipe.loop) expect(recipe.release, `${recipe.id} needs a release`).toBeGreaterThan(0);
    }
    for (const recipe of MUSIC_RECIPES) {
      expect(recipeProblems(recipe), recipe.id).toEqual([]);
      expect(recipe.bus).toBe('music');
      expect(SFX[recipe.id], 'music instruments are not effects').toBeUndefined();
    }
  });

  it('every recipe has a calibrated level, and no level is left over from a deleted recipe', () => {
    expect(Object.keys(SFX_TRIM).sort()).toEqual(SFX_LIST.map((r) => r.id).sort());
    for (const [id, trim] of Object.entries(SFX_TRIM)) {
      expect(trim, id).toBeGreaterThan(0.02);
      expect(trim, id).toBeLessThan(4);
    }
    expect(Object.keys(ENGINE_TRIM).sort()).toEqual(ENGINE_RECIPES.map((r) => r.key).sort());
  });

  it('loudness windows are ordered the way the mix is meant to be', () => {
    for (const cat of CATEGORIES) {
      const t = LOUDNESS_TARGETS[cat];
      expect(t.min).toBeLessThan(t.aim);
      expect(t.aim).toBeLessThan(t.max);
      expect(t.max).toBeLessThanOrEqual(-7);
    }
    // Explosions over shots over small impacts over status loops; warnings over the weapons.
    expect(LOUDNESS_TARGETS.explosion.aim).toBeGreaterThan(LOUDNESS_TARGETS.fire_big.aim);
    expect(LOUDNESS_TARGETS.fire_big.aim).toBeGreaterThan(LOUDNESS_TARGETS.fire_small.aim);
    expect(LOUDNESS_TARGETS.fire_small.aim).toBeGreaterThan(LOUDNESS_TARGETS.impact_small.aim);
    expect(LOUDNESS_TARGETS.impact_small.aim).toBeGreaterThan(LOUDNESS_TARGETS.status.aim);
    expect(LOUDNESS_TARGETS.alert.aim).toBeGreaterThan(LOUDNESS_TARGETS.fire_small.aim);
    expect(LOUDNESS_TARGETS.ui.aim).toBeLessThan(LOUDNESS_TARGETS.fire_small.aim);
  });

  it('the sounds that must never be stolen are protected, and nothing else is', () => {
    const protectedIds = SFX_LIST.filter((r) => r.pri >= PROTECTED_PRIORITY).map((r) => r.id);
    expect(protectedIds.sort()).toEqual(['ko_blast', 'warn_lock', 'warn_missile']);
    // Machine-gun rounds and bullet hits are rate limited (Section 14.3).
    for (const id of [
      'mg_fire',
      'sentry_fire',
      'turret_fire',
      'hit_armor',
      'hit_body',
      'burn_tick',
    ])
      expect(SFX[id]!.limitMs, id).toBeGreaterThanOrEqual(50);
    // The biggest sounds duck the music.
    for (const id of ['explode_rocket', 'explode_mortar', 'explode_mine', 'explode_seeker'])
      expect(SFX[id]!.duck, id).toBeGreaterThanOrEqual(0.9);
  });
});

describe('every part of the catalog resolves to sound', () => {
  it('every part id has an install sound that exists', () => {
    const parts = allParts();
    expect(parts.length).toBe(
      Object.keys(CATALOG.chassis).length +
        Object.keys(CATALOG.engines).length +
        Object.keys(CATALOG.tires).length +
        Object.keys(CATALOG.parts).length,
    );
    for (const part of parts) {
      const sound = partSound(part.id);
      expect(sound, `${part.id} (soundKey ${part.soundKey})`).toBeDefined();
      expect(SFX[sound!.install.id], `${part.id} installs with ${sound!.install.id}`).toBeDefined();
      expect(SFX[sound!.install.id]!.cat).toBe('install');
      expect(sound!.install.pitch).toBeGreaterThan(0.8);
      expect(sound!.install.pitch).toBeLessThan(1.3);
      for (const id of sound!.race) expect(SFX[id], `${part.id} plays ${id}`).toBeDefined();
    }
    expect(Object.keys(PART_SOUNDS).length).toBe(parts.length);
    expect(partSound('constructor')).toBeUndefined();
    expect(partSound('nope')).toBeUndefined();
  });

  it('each of the twenty engines has its own voice', () => {
    const engines = partsByCategory('engine');
    expect(engines.length).toBe(20);
    const keys = new Set<string>();
    for (const engine of engines) {
      const recipe = engineRecipe(engine.soundKey);
      expect(recipe, `${engine.id} has soundKey ${engine.soundKey}`).toBeDefined();
      expect(partSound(engine.id)!.engineKey).toBe(engine.soundKey);
      keys.add(engine.soundKey);
    }
    expect(keys.size).toBe(20);
    expect(ENGINE_RECIPES.length).toBe(20);
    for (const recipe of ENGINE_RECIPES) expect(engineProblems(recipe), recipe.key).toEqual([]);
    // Section 14.3, by name: electric motors have no idle, the V8 is the lowest of the vees,
    // the turbine and the turbos follow the spool, the rocket pulses, the spring drive clicks.
    for (const key of ['engine_electric_small', 'engine_electric_sport', 'engine_electric_eco']) {
      expect(engineRecipe(key)!.level.idle, key).toBe(0);
      expect(engineRecipe(key)!.gears, key).toBe(1);
    }
    expect(engineRecipe('engine_v8')!.idleHz).toBeLessThan(engineRecipe('engine_v6')!.idleHz);
    expect(engineRecipe('engine_v6')!.idleHz).toBeLessThan(engineRecipe('engine_v12')!.idleHz);
    expect(engineRecipe('engine_v8')!.lump!.depth).toBeGreaterThan(0.4);
    expect(engineRecipe('engine_v12')!.lump).toBeUndefined();
    for (const key of ['engine_turbine', 'engine_turbo_small', 'engine_turbo_twin'])
      expect(engineRecipe(key)!.whine!.by, key).toBe('spool');
    expect(engineRecipe('engine_turbo_small')!.blowoff).toBe(true);
    expect(engineRecipe('engine_turbo_twin')!.whine!.twinCents).toBeGreaterThan(0);
    expect(engineRecipe('engine_supercharger')!.whine!.by).toBe('rpm');
    expect(engineRecipe('engine_rocket')!.noise!.gateHz).toBeGreaterThan(0);
    expect(engineRecipe('engine_spring')!.noise!.gate).toBeGreaterThan(0);
    expect(engineRecipe('engine_spring')!.burst).toBe('spring_release');
    expect(engineRecipe('engine_hybrid')!.electricBelow).toBeGreaterThan(0);
    expect(engineRecipe('engine_experimental')!.cycleWobble).toBeGreaterThan(0);
  });

  it('each of the twenty weapons has its own fire sound and its Section 13.4 phases', () => {
    const weapons = partsByCategory('weapon');
    expect(weapons.length).toBe(20);
    expect(Object.keys(WEAPON_SOUNDS).sort()).toEqual(weapons.map((w) => w.id).sort());
    const fires = new Set<string>();
    for (const weapon of weapons) {
      const sounds = WEAPON_SOUNDS[weapon.id]!;
      expect(SFX[sounds.fire], `${weapon.id} fires ${sounds.fire}`).toBeDefined();
      fires.add(sounds.fire);
      expect(partSound(weapon.id)!.race).toContain(sounds.fire);
      for (const id of partSound(weapon.id)!.race) expect(SFX[id], id).toBeDefined();
      if (sounds.travel) expect(SFX[sounds.travel]!.loop, sounds.travel).toBe(true);
      if (sounds.area) expect(SFX[sounds.area]!.loop, sounds.area).toBe(true);
    }
    expect(fires.size).toBe(20);
    // The special phases the brief names.
    expect(WEAPON_SOUNDS.weapon_railshot!.windup!.id).toBe('rail_charge');
    expect(WEAPON_SOUNDS.weapon_emp!.windup!.id).toBe('emp_charge');
    expect(WEAPON_SOUNDS.weapon_hammer!.windup!.id).toBe('hammer_draw');
    expect(WEAPON_SOUNDS.weapon_homing!.lock).toBe('seeker_lock');
    expect(WEAPON_SOUNDS.weapon_mortar!.telegraph!.id).toBe('mortar_whistle');
    for (const id of ['weapon_rocket', 'weapon_homing', 'weapon_boomerang'])
      expect(WEAPON_SOUNDS[id]!.travel, id).toBeDefined();
    expect(WEAPON_SOUNDS.weapon_flame!.area).toBe('flame_stream');
    expect(WEAPON_SOUNDS.weapon_boomerang!.impact!.caught).toBe('boomerang_catch');
    // A wind-up recipe is as long as the simulation's wind-up (30 ticks a second).
    for (const [id, sounds] of Object.entries(WEAPON_SOUNDS)) {
      if (!sounds.windup) continue;
      const seconds = recipeDuration(SFX[sounds.windup.id]!);
      expect(Math.abs(seconds - sounds.windup.ticks / 30), id).toBeLessThan(0.08);
    }
    expect(Math.abs(recipeDuration(SFX.mortar_whistle!) - 42 / 30)).toBeLessThan(0.05);
  });

  it('every defense and utility that does something in a race has a sound for it', () => {
    const active = [...partsByCategory('defense'), ...partsByCategory('utility')].filter(
      (part) => part.triggerMode === 'manual' || part.id in DEFENSE_SOUNDS,
    );
    expect(active.length).toBeGreaterThanOrEqual(12);
    for (const part of active)
      expect(partSound(part.id)!.race.length, `${part.id} is silent in a race`).toBeGreaterThan(0);
    const tables: Array<Record<string, Record<string, string>>> = [DEFENSE_SOUNDS, UTILITY_SOUNDS];
    for (const table of tables)
      for (const [partId, sounds] of Object.entries(table)) {
        expect(partSound(partId), partId).toBeDefined();
        for (const id of Object.values(sounds)) expect(SFX[id], `${partId}: ${id}`).toBeDefined();
      }
    // Tire and chassis families colour the driving sounds.
    for (const kit of partsByCategory('tires'))
      expect(TIRE_CHARACTER[partSound(kit.id)!.family!], kit.id).toBeDefined();
    for (const chassis of partsByCategory('chassis'))
      expect(['chassis_light', 'chassis_heavy']).toContain(partSound(chassis.id)!.family);
    expect(Object.keys(SURFACE_CHARACTER).sort()).toEqual(
      ['asphalt', 'cobble', 'dirt', 'ice', 'metal', 'mud', 'sand', 'snow'].sort(),
    );
  });

  it('every interface sound exists', () => {
    for (const [kind, id] of Object.entries(UI_SOUNDS)) expect(SFX[id], kind).toBeDefined();
    expect(Object.keys(UI_SOUNDS)).toEqual(
      expect.arrayContaining([
        'tap',
        'confirm',
        'deny',
        'install',
        'remove',
        'ready',
        'timer_tick',
      ]),
    );
  });
});

describe('every event resolves to sound', () => {
  /** One or more of every event type. The record's key type makes the compiler check coverage. */
  const SAMPLES: Record<RaceEventType, RaceEvent[]> = {
    checkpoint: [event('checkpoint', { car: 0, index: 2 })],
    lap: [
      event('lap', { car: 0, lap: 1, lapTimeMs: 30000 }),
      event('lap', { car: 0, lap: 2, lapTimeMs: 30000 }),
    ],
    finish: [event('finish', { car: 0, raceTimeMs: 90000, finished: true })],
    wall: [event('wall', { car: 1, speed: 150 })],
    position: [
      event('position', { leader: 0, gapMeters: 2 }),
      event('position', { leader: 1, gapMeters: 2 }),
    ],
    windup: [event('windup', { car: 0, part: 0, weapon: 'weapon_railshot', ticks: 24 })],
    shot: [
      event('shot', {
        car: 0,
        part: 0,
        weapon: 'weapon_rocket',
        x: 0,
        y: 0,
        dir: 0,
        projectile: 7,
        n: 0,
        of: 1,
      }),
    ],
    beam: [
      event('beam', {
        car: 1,
        part: 0,
        weapon: 'defense_antimissile',
        x: 0,
        y: 0,
        toX: 10,
        toY: 10,
        hit: -1,
      }),
    ],
    area: [
      event('area', {
        car: 0,
        part: 0,
        weapon: 'weapon_flame',
        x: 0,
        y: 0,
        dir: 0,
        half: 0.3,
        range: 80,
        ticks: 60,
      }),
    ],
    telegraph: [
      event('telegraph', {
        car: 0,
        part: 0,
        weapon: 'weapon_mortar',
        x: 50,
        y: 50,
        radius: 40,
        ticks: 42,
        projectile: 3,
      }),
    ],
    lock: [
      event('lock', { car: 0, part: 0, weapon: 'weapon_homing', target: 1, locked: true }),
      event('lock', { car: 0, part: 0, weapon: 'weapon_homing', target: 1, locked: false }),
    ],
    warning: (['lock', 'lock_lost', 'missile', 'trap'] as const).map((kind) =>
      event('warning', { car: 0, kind, by: 1, value: 12 }),
    ),
    hit: (['bullet', 'direct', 'heavy', 'ram', 'burn'] as const).map((cls) =>
      event('hit', {
        car: 1,
        by: 0,
        weapon: cls === 'ram' ? 'ram' : 'weapon_rocket',
        cls,
        x: 0,
        y: 0,
        component: 2,
        damage: 10,
        chassis: 4,
        shield: 0,
        armor: 0,
        absorbed: 0,
        projectile: 0,
      }),
    ),
    explosion: [
      event('explosion', { by: 0, weapon: 'weapon_mortar', x: 0, y: 0, radius: 60, projectile: 3 }),
    ],
    impact: (
      ['wall', 'obstacle', 'ground', 'expired', 'caught', 'intercepted', 'scrambled'] as const
    ).map((on) => event('impact', { weapon: 'weapon_rocket', x: 0, y: 0, projectile: 7, on })),
    status: STATUS_FAMILIES.flatMap((family) =>
      (['applied', 'expired', 'blocked'] as const).map((state) =>
        event('status', { car: 1, by: 0, family, state, magnitude: 1, ticks: 45 }),
      ),
    ),
    impulse: [event('impulse', { car: 1, by: 0, weapon: 'weapon_mine', dx: 120, dy: 0 })],
    component: (['healthy', 'damaged', 'critical', 'disabled'] as const).flatMap((condition) =>
      [false, true].map((repaired) =>
        event('component', { car: 0, component: 0, condition, integrity: 30, repaired }),
      ),
    ),
    shield: (['up', 'down', 'broken'] as const).map((state) =>
      event('shield', { car: 1, part: 0, state, points: 25 }),
    ),
    hazard: HAZARD_KINDS.flatMap((kind) =>
      (['placed', 'armed', 'triggered', 'expired', 'cleared', 'ignited', 'melted'] as const).map(
        (state) => event('hazard', { hazard: 4, kind, by: 0, state, x: 0, y: 0, car: -1 }),
      ),
    ),
    tether: (['attached', 'released'] as const).map((state) =>
      event('tether', { car: 0, part: 0, target: 1, state }),
    ),
    utility: (['started', 'done', 'interrupted'] as const).map((state) =>
      event('utility', { car: 0, part: 1, utility: 'utility_repair', state, value: 0 }),
    ),
    misfire: [event('misfire', { car: 0, part: 0, weapon: 'weapon_rocket' })],
    refused: (Object.keys(REFUSAL_SOUNDS) as Array<keyof typeof REFUSAL_SOUNDS>).map((reason) =>
      event('refused', { car: 0, part: 0, reason }),
    ),
    ko: [event('ko', { car: 1, by: 0 })],
    result: [
      event('result', { winner: 0, reason: 'finish' }),
      event('result', { winner: 1, reason: 'ko' }),
      event('result', { winner: -1, reason: 'timeout' }),
    ],
  };

  it('has a handler for every event type, and every type makes at least one sound', () => {
    expect(Object.keys(EVENT_HANDLERS).sort()).toEqual(Object.keys(SAMPLES).sort());
    for (const [type, samples] of Object.entries(SAMPLES)) {
      let sounded = 0;
      for (const sample of samples) {
        const cues = cuesForEvent(sample, context());
        for (const id of playIds(cues)) expect(SFX[id], `${type} plays ${id}`).toBeDefined();
        sounded += playIds(cues).length;
      }
      expect(sounded, `${type} is silent`).toBeGreaterThan(0);
    }
  });

  it('every status family, hazard kind and refusal reason is decided', () => {
    expect(Object.keys(STATUS_SOUNDS).sort()).toEqual([...STATUS_FAMILIES].sort());
    for (const [family, sounds] of Object.entries(STATUS_SOUNDS)) {
      // `immune` is the one deliberate silence.
      if (family === 'immune') expect(sounds).toBeNull();
      else expect(sounds, family).not.toBeNull();
      for (const id of Object.values(sounds ?? {}))
        expect(SFX[id], `${family}: ${id}`).toBeDefined();
      if (sounds?.loop) expect(SFX[sounds.loop]!.loop, sounds.loop).toBe(true);
    }
    for (const id of Object.values(REFUSAL_SOUNDS)) expect(SFX[id], id).toBeDefined();
    for (const id of Object.values(SURFACE_SOUNDS)) expect(SFX[id], id).toBeDefined();
    // Every hazard kind makes a sound at some point of its life.
    for (const kind of HAZARD_KINDS) {
      const heard = SAMPLES.hazard
        .filter((e) => e.type === 'hazard' && e.kind === kind)
        .flatMap((e) => playIds(cuesForEvent(e, context())));
      // Oil is heard as the spill (`shot`) and as the slide (`status`), not as a hazard event.
      if (kind !== 'oil') expect(heard.length, kind).toBeGreaterThan(0);
    }
  });

  it('a loop that an event starts is stopped by the event that ends it', () => {
    const keysStarted = (e: RaceEvent) =>
      cuesForEvent(e, context()).flatMap((c) => (c.kind === 'play' && c.key ? [c.key] : []));
    const keysStopped = (e: RaceEvent) =>
      cuesForEvent(e, context()).flatMap((c) => (c.kind === 'stop' ? [c.key] : []));
    for (const family of STATUS_FAMILIES) {
      if (!STATUS_SOUNDS[family]?.loop) continue;
      const on = event('status', {
        car: 1,
        by: 0,
        family,
        state: 'applied',
        magnitude: 1,
        ticks: 45,
      });
      const off = event('status', {
        car: 1,
        by: 0,
        family,
        state: 'expired',
        magnitude: 0,
        ticks: 0,
      });
      expect(keysStarted(on), family).toEqual([`status:1:${family}`]);
      expect(keysStopped(off), family).toEqual([`status:1:${family}`]);
    }
    const shot = SAMPLES.shot[0]!;
    expect(keysStarted(shot)).toEqual(['proj:7']);
    expect(
      keysStopped(
        event('impact', { weapon: 'weapon_rocket', x: 0, y: 0, projectile: 7, on: 'wall' }),
      ),
    ).toEqual(['proj:7']);
    expect(
      keysStopped(
        event('explosion', {
          by: 0,
          weapon: 'weapon_rocket',
          x: 0,
          y: 0,
          radius: 40,
          projectile: 7,
        }),
      ),
    ).toEqual(['proj:7']);
    expect(keysStarted(SAMPLES.tether[0]!)).toEqual(['tether:0']);
    expect(keysStopped(SAMPLES.tether[1]!)).toEqual(['tether:0']);
    expect(keysStarted(SAMPLES.warning[0]!)).toEqual(['warn']);
    expect(keysStopped(SAMPLES.warning[1]!)).toEqual(['warn']);
    // Every keyed voice has a time limit as well, in case the ending event never comes.
    for (const samples of Object.values(SAMPLES))
      for (const sample of samples)
        for (const cue of cuesForEvent(sample, context()))
          if (cue.kind === 'play' && cue.key) {
            expect(cue.ttl, `${cue.id} has no time limit`).toBeGreaterThan(0);
            expect(cue.ttl).toBeLessThanOrEqual(30);
          }
    // An EMP cancels a charge under way.
    const emp = event('status', {
      car: 1,
      by: 0,
      family: 'emp',
      state: 'applied',
      magnitude: 1,
      ticks: 45,
    });
    expect(cuesForEvent(emp, context())).toContainEqual({
      kind: 'stop',
      key: 'windup:1:',
      prefix: true,
    });
  });

  it('the ear can tell what was hit (Section 13.6)', () => {
    type Hit = Extract<RaceEvent, { type: 'hit' }>;
    const hit = (over: Partial<Hit>) =>
      ({
        ...(SAMPLES.hit[1] as Hit),
        component: -1,
        damage: 0,
        chassis: 0,
        shield: 0,
        armor: 0,
        ...over,
      }) as Hit;
    expect(hitSurface(hit({ shield: 20 }), 4)).toBe('shield');
    expect(hitSurface(hit({ shield: 5, damage: 10, chassis: 4, component: 0 }), 4)).toBe('engine');
    expect(hitSurface(hit({ armor: 12, damage: 3, chassis: 1, component: 3 }), 4)).toBe('armor');
    expect(hitSurface(hit({ armor: 2, damage: 10, chassis: 4, component: 3 }), 4)).toBe('wheel');
    expect(hitSurface(hit({ damage: 10, chassis: 4, component: 0 }), 4)).toBe('engine');
    expect(hitSurface(hit({ damage: 10, chassis: 4, component: 1 }), 4)).toBe('steering');
    expect(hitSurface(hit({ damage: 10, chassis: 4, component: 5 }), 4)).toBe('wheel');
    expect(hitSurface(hit({ damage: 10, chassis: 4, component: 6 }), 4)).toBe('module');
    // A six-wheeler's seventh and eighth components are still wheels.
    expect(hitSurface(hit({ damage: 10, chassis: 4, component: 7 }), 6)).toBe('wheel');
    expect(hitSurface(hit({ chassis: 12 }), 4)).toBe('body');
    // Seven surfaces, seven different sounds.
    expect(new Set(Object.values(SURFACE_SOUNDS)).size).toBe(7);
    // A heavy hit adds weight; a hit on the player's own car is felt.
    const heavy = cuesForEvent(
      hit({ cls: 'heavy', car: 0, damage: 20, chassis: 8, component: 0 }),
      context(),
    );
    expect(playIds(heavy)).toEqual(['hit_engine', 'impact_heavy']);
    expect(heavy.find((c) => c.kind === 'play')).toMatchObject({ haptic: 'hit_heavy' });
    const onRival = cuesForEvent(hit({ cls: 'direct', car: 1, chassis: 8 }), context());
    expect(onRival.find((c) => c.kind === 'play')).not.toHaveProperty('haptic');
    // The weapon leaves its own mark on top of the surface.
    const rail = cuesForEvent(
      hit({ cls: 'heavy', weapon: 'weapon_railshot', armor: 20 }),
      context(),
    );
    expect(playIds(rail)).toEqual(['hit_armor', 'hit_rail', 'impact_heavy']);
    // Bullets are small and counted against the burst allowance.
    const bullet = cuesForEvent(
      hit({ cls: 'bullet', weapon: 'weapon_front_mg', armor: 3 }),
      context(),
    );
    expect(bullet).toEqual([expect.objectContaining({ id: 'hit_armor', burst: true })]);
  });

  it('the details of the mapping that carry meaning', () => {
    const c = context();
    // Rounds of a burst alternate in pitch; a spread is one sound however many pellets.
    const round = (weapon: string, n: number) =>
      cuesForEvent(
        event('shot', { car: 0, part: 0, weapon, x: 0, y: 0, dir: 0, projectile: 0, n, of: 5 }),
        c,
      );
    expect(round('weapon_front_mg', 0)).toEqual([expect.objectContaining({ id: 'mg_fire' })]);
    expect(round('weapon_front_mg', 1)).toEqual([
      expect.objectContaining({ id: 'mg_fire', pitch: 0.92 }),
    ]);
    expect(round('weapon_shotgun', 0).length).toBe(1);
    expect(round('weapon_shotgun', 3)).toEqual([]);
    // A wind-up stretches to the ticks the simulation gives it (a Turret Computer shortens locks).
    const windup = cuesForEvent(
      event('windup', { car: 0, part: 0, weapon: 'weapon_railshot', ticks: 18 }),
      c,
    );
    expect(windup[0]).toMatchObject({ id: 'rail_charge', stretch: 0.75, key: 'windup:0:0' });
    // The shield event is read through the part that raised it.
    const shield = (car: number, part: number, state: 'up' | 'down' | 'broken') =>
      playIds(cuesForEvent(event('shield', { car, part, state, points: 10 }), c));
    expect(shield(0, 1, 'down')).toEqual(['shield_down']);
    expect(shield(0, 1, 'up')).toEqual(['shield_up']);
    expect(shield(1, 0, 'broken')).toEqual(['armor_break']);
    expect(shield(1, 1, 'down')).toEqual(['reactive_puff']);
    // Frost and oil both cost grip and do not sound alike.
    const grip = event('status', {
      car: 1,
      by: 0,
      family: 'grip',
      state: 'applied',
      magnitude: 0.3,
      ticks: 60,
    });
    expect(playIds(cuesForEvent(grip, context({ gripSource: () => 'oil' })))).toEqual(['oil_slip']);
    expect(playIds(cuesForEvent(grip, context({ gripSource: () => 'frost' })))).toEqual([
      'frost_crackle',
    ]);
    // Laps: a chime, the final-lap fanfare, and nothing on the lap that is the finish.
    const lap = (n: number) =>
      playIds(cuesForEvent(event('lap', { car: 0, lap: n, lapTimeMs: 1 }), c));
    expect(lap(1)).toEqual(['lap_chime']);
    expect(lap(2)).toEqual(['final_lap']);
    expect(lap(3)).toEqual([]);
    expect(playIds(cuesForEvent(event('lap', { car: 1, lap: 1, lapTimeMs: 1 }), c))).toEqual([]);
    // The result is heard from the player's side.
    const result = (winner: number, you: number) =>
      playIds(cuesForEvent(event('result', { winner, reason: 'finish' }), context({ you })));
    expect(result(0, 0)).toEqual(['stinger_win']);
    expect(result(0, 1)).toEqual(['stinger_lose']);
    expect(result(-1, 0)).toEqual(['stinger_draw']);
    // The player's own wall strike is the scene's to report; the event is marked so it is not doubled.
    expect(cuesForEvent(event('wall', { car: 0, speed: 100 }), c)[0]).toMatchObject({
      dedupe: 'wall',
    });
    expect(cuesForEvent(event('wall', { car: 1, speed: 100 }), c)[0]).not.toHaveProperty('dedupe');
    // A missile warning lasts as long as the missile has to fly, and a little more.
    const missile = cuesForEvent(
      event('warning', { car: 0, kind: 'missile', by: 1, value: 15 }),
      c,
    );
    expect(missile).toContainEqual(
      expect.objectContaining({ id: 'warn_missile', key: 'warn', ttl: 1 }),
    );
  });

  it('every event of every showcase scenario maps to recipes that exist', () => {
    let events = 0;
    const heard = new Set<string>();
    for (const def of SCENARIOS) {
      const run = runScenario(def);
      const parts = run.setup.entries.map((entry) =>
        entry.build.blueprint.parts.map((p) => p.partId),
      );
      const c = context({
        parts,
        wheels: run.setup.entries.map((entry) => entry.build.chassis.wheelCount),
      });
      for (const e of run.events) {
        events++;
        for (const id of playIds(cuesForEvent(e, c))) {
          expect(SFX[id], `${def.id}: ${e.type} plays ${id}`).toBeDefined();
          heard.add(id);
        }
      }
    }
    expect(events).toBeGreaterThan(300);
    // The scenarios between them exercise most of the race sounds.
    expect(heard.size).toBeGreaterThan(55);
    // And the hand-written expectations name only sounds that exist.
    expect(Object.keys(SCENARIO_SOUNDS).sort()).toEqual(SCENARIOS.map((s) => s.id).sort());
    for (const [id, list] of Object.entries(SCENARIO_SOUNDS))
      for (const want of list) {
        const known = want.endsWith('_')
          ? SFX_LIST.some((r) => r.id.startsWith(want))
          : SFX[want] !== undefined;
        expect(known, `${id} expects ${want}`).toBe(true);
      }
    expect(firstMissing(['a', 'hit_body', 'b'], ['a', 'hit_', 'b'])).toBeNull();
    expect(firstMissing(['a', 'b'], ['b', 'a'])).toBe('a');
    expect(firstMissing(['a'], ['a', 'a'])).toBe('a');
  });
});

describe('mixer maths', () => {
  it('distance: full level near, silent far, falling all the way between', () => {
    expect(distanceGain(0)).toBe(1);
    expect(distanceGain(SPACE.near)).toBe(1);
    expect(distanceGain(SPACE.far)).toBe(0);
    expect(distanceGain(5000)).toBe(0);
    let last = 1;
    for (let d = SPACE.near; d <= SPACE.far; d += 10) {
      const g = distanceGain(d);
      expect(g).toBeLessThanOrEqual(last);
      expect(g).toBeGreaterThanOrEqual(0);
      last = g;
    }
    // Half way out is clearly quieter but still there.
    const half = distanceGain((SPACE.near + SPACE.far) / 2);
    expect(half).toBeGreaterThan(0.15);
    expect(half).toBeLessThan(0.4);
    expect(distanceGain(Number.NaN)).toBe(1);
  });

  it('pan: modest, signed, and limited (Section 14.3)', () => {
    expect(panFor(0)).toBe(0);
    expect(panFor(100)).toBeGreaterThan(0);
    expect(panFor(-100)).toBe(-panFor(100));
    expect(panFor(10_000)).toBe(SPACE.panLimit);
    expect(panFor(-10_000)).toBe(-SPACE.panLimit);
    expect(SPACE.panLimit).toBeLessThan(0.8);
  });

  it("placement: the player's own sounds are centred and full; the rival's are quieter and to the side", () => {
    expect(place(100, 100, 900, 900, 'own')).toEqual({ gain: 1, pan: 0 });
    const beside = place(100, 100, 150, 100, 'rival');
    expect(beside.gain).toBeCloseTo(SPACE.rivalTrim, 5);
    expect(beside.pan).toBeGreaterThan(0);
    const left = place(100, 100, -200, 100, 'rival');
    expect(left.pan).toBeLessThan(0);
    expect(left.gain).toBeLessThan(beside.gain);
    expect(place(0, 0, 0, 2000, 'rival').gain).toBe(0);
    // Something out in the world (an explosion, a mine) is not trimmed as the rival's car is.
    expect(place(100, 100, 150, 100, 'world').gain).toBe(1);
    // The scratch object is reused, not allocated.
    const out = { gain: 0, pan: 0 };
    expect(place(0, 0, 10, 0, 'world', out)).toBe(out);
  });

  it('ducking: music most, engines some, and it lets go', () => {
    expect(duckTargets(0)).toEqual({ music: 1, engine: 1, ambience: 1 });
    const full = duckTargets(1);
    expect(full.music).toBeLessThan(0.4);
    expect(full.music).toBeGreaterThan(0.2);
    expect(full.engine).toBeGreaterThan(full.music);
    expect(full.ambience).toBeGreaterThan(full.engine);
    expect(duckTargets(5)).toEqual(full);
    expect(duckTargets(0.5).music).toBeGreaterThan(full.music);
    // "Briefly": never longer than 0.7 s, never so short it pumps.
    for (const seconds of [0.02, 0.3, 1.2, 10]) {
      expect(duckHold(1, seconds)).toBeGreaterThanOrEqual(0.12);
      expect(duckHold(1, seconds)).toBeLessThanOrEqual(0.7);
    }
    expect(duckHold(0.3, 1)).toBeLessThan(duckHold(1, 1));
  });

  const slot = (id: string, bus: VoiceSlot['bus'], pri: number, start: number): VoiceSlot => ({
    id,
    bus,
    pri,
    start,
  });

  it('voice stealing: room, copies, a full bus, a full pool, and the protected', () => {
    // Room: play.
    expect(decideVoice([], { id: 'a', bus: 'weapons', pri: 50 })).toEqual({ action: 'play' });

    // Over its own copy limit: the oldest copy goes, whatever else is playing.
    const copies = [
      slot('mg', 'weapons', 50, 3),
      slot('x', 'weapons', 10, 0),
      slot('mg', 'weapons', 50, 1),
      slot('mg', 'weapons', 50, 2),
    ];
    expect(decideVoice(copies, { id: 'mg', bus: 'weapons', pri: 50, poly: 3 })).toEqual({
      action: 'steal',
      index: 2,
    });
    expect(decideVoice(copies, { id: 'mg', bus: 'weapons', pri: 50, poly: 4 })).toEqual({
      action: 'play',
    });

    // A full bus gives up its weakest voice; among equals, the oldest.
    const bus = Array.from({ length: CAPS.bus.impacts }, (_, i) =>
      slot(`h${i}`, 'impacts', 60, 10 - i),
    );
    bus[3] = slot('weak', 'impacts', 30, 99);
    expect(decideVoice(bus, { id: 'new', bus: 'impacts', pri: 60 })).toEqual({
      action: 'steal',
      index: 3,
    });
    bus[3] = slot('h3', 'impacts', 60, 7);
    expect(decideVoice(bus, { id: 'new', bus: 'impacts', pri: 60 })).toEqual({
      action: 'steal',
      index: CAPS.bus.impacts - 1,
    });
    // The other buses are not touched by it.
    expect(decideVoice(bus, { id: 'new', bus: 'weapons', pri: 1 })).toEqual({ action: 'play' });

    // A newcomer weaker than everything it could replace is dropped.
    expect(decideVoice(bus, { id: 'tick', bus: 'impacts', pri: 20 })).toEqual({ action: 'drop' });
    // Equal priority replaces: the newer sound is the one that matters.
    expect(decideVoice(bus, { id: 'same', bus: 'impacts', pri: 60 }).action).toBe('steal');

    // A full pool: the weakest anywhere outside the music goes.
    const pool: VoiceSlot[] = [];
    const order: VoiceSlot['bus'][] = ['weapons', 'impacts', 'ambience', 'ui'];
    for (let i = 0; i < CAPS.totalVoices; i++)
      pool.push(slot(`v${i}`, order[i % 4]!, 50 + (i % 5), i));
    pool.push(slot('music', 'music', 1, 0));
    const full = decideVoice(pool, { id: 'big', bus: 'alerts', pri: 90 });
    expect(full).toEqual({ action: 'steal', index: 0 });
    expect(decideVoice(pool, { id: 'small', bus: 'alerts', pri: 10 })).toEqual({ action: 'drop' });
    // Music is counted apart and never stolen for an effect, nor the other way round.
    expect(decideVoice(pool, { id: 'note', bus: 'music', pri: 5 })).toEqual({ action: 'play' });

    // Protected voices are never stolen. With nothing else to take, a protected newcomer is
    // dropped rather than cut another protected voice; an ordinary one is dropped too.
    const alerts = [
      slot('warn_lock', 'alerts', PROTECTED_PRIORITY, 0),
      slot('warn_missile', 'alerts', PROTECTED_PRIORITY, 1),
    ];
    expect(decideVoice(alerts, { id: 'x', bus: 'alerts', pri: 90 })).toEqual({ action: 'drop' });
    expect(decideVoice(alerts, { id: 'y', bus: 'alerts', pri: PROTECTED_PRIORITY })).toEqual({
      action: 'drop',
    });
    // A protected newcomer does take an ordinary voice, even a strong one.
    const mixed = [
      slot('warn_lock', 'alerts', PROTECTED_PRIORITY, 0),
      slot('warn_trap', 'alerts', 90, 1),
    ];
    expect(
      decideVoice(mixed, { id: 'warn_missile', bus: 'alerts', pri: PROTECTED_PRIORITY }),
    ).toEqual({ action: 'steal', index: 1 });
  });

  it('the caps add up', () => {
    const buses = Object.entries(CAPS.bus).filter(([bus]) => bus !== 'music' && bus !== 'engine');
    for (const [bus, cap] of buses) expect(cap, bus).toBeLessThan(CAPS.totalVoices);
    expect(CAPS.totalVoices).toBeLessThanOrEqual(24);
    // The worst case in nodes: every voice at five layers of eight nodes, plus its output and pan.
    const worst =
      (CAPS.totalVoices + CAPS.bus.music) * (CAPS.layersPerVoice * CAPS.nodesPerLayer + 2) +
      CAPS.engineNodes;
    expect(worst).toBeLessThan(1700);
  });

  it('rate limiter: one sound per interval per key', () => {
    const limiter = new RateLimiter();
    expect(limiter.allow('mg:own', 0, 60)).toBe(true);
    expect(limiter.allow('mg:own', 0.033, 60)).toBe(false);
    expect(limiter.allow('mg:rival', 0.033, 60)).toBe(true);
    expect(limiter.allow('mg:own', 0.059, 60)).toBe(false);
    expect(limiter.allow('mg:own', 0.06, 60)).toBe(true);
    // A refused attempt does not push the next one back.
    expect(limiter.allow('mg:own', 0.1, 60)).toBe(false);
    expect(limiter.allow('mg:own', 0.12, 60)).toBe(true);
    // A burst of thirty rounds a second comes out at no more than seventeen.
    let through = 0;
    const burst = new RateLimiter();
    for (let i = 0; i < 300; i++) if (burst.allow('k', i / 30, 60)) through++;
    expect(through).toBe(150);
    // A clock that jumps back (a new context) does not lock the key out.
    expect(limiter.allow('mg:own', 0.01, 60)).toBe(true);
    limiter.reset();
    expect(limiter.allow('mg:rival', 0.034, 60)).toBe(true);
  });

  it('token bucket: lets a burst through, then holds the rate', () => {
    const bucket = new TokenBucket(4, 12);
    let through = 0;
    for (let i = 0; i < 8; i++) if (bucket.take(0)) through++;
    expect(through).toBe(4);
    // One second of sixty requests a second: twelve more.
    through = 0;
    for (let i = 1; i <= 60; i++) if (bucket.take(i / 60)) through++;
    expect(through).toBe(12);
    // After a rest the allowance is back, and no bigger than its capacity.
    through = 0;
    for (let i = 0; i < 8; i++) if (bucket.take(10)) through++;
    expect(through).toBe(4);
    bucket.reset();
    expect(bucket.take(0)).toBe(true);
  });

  it('engine speed: rises with the road, falls at each upshift, and does not hunt', () => {
    const state = { gear: 1 };
    let last = 0;
    let shifts = 0;
    for (let share = 0; share <= 1; share += 0.005) {
      const gear = state.gear;
      const rpm = engineSpeed(share, 4, state);
      expect(rpm).toBeGreaterThanOrEqual(0.2);
      expect(rpm).toBeLessThanOrEqual(1.05);
      if (state.gear === gear) expect(rpm).toBeGreaterThanOrEqual(last);
      else {
        shifts++;
        expect(rpm).toBeLessThan(last - 0.2);
      }
      last = rpm;
    }
    expect(shifts).toBe(3);
    expect(state.gear).toBe(4);
    // Hysteresis: hovering on a shift point changes gear once, not every frame.
    const hover = { gear: 1 };
    let changes = 0;
    let previous = hover.gear;
    for (let i = 0; i < 200; i++) {
      engineSpeed(0.26 + (i % 2 === 0 ? 0.01 : -0.01), 4, hover);
      if (hover.gear !== previous) changes++;
      previous = hover.gear;
    }
    expect(changes).toBe(1);
    // Slowing right down comes back through the gears.
    for (let share = 1; share >= 0; share -= 0.01) engineSpeed(share, 4, state);
    expect(state.gear).toBe(1);
    // No gears: engine speed simply follows the road.
    const single = { gear: 1 };
    let before = 0;
    for (let share = 0; share <= 1; share += 0.05) {
      const rpm = engineSpeed(share, 1, single);
      expect(rpm).toBeGreaterThanOrEqual(before);
      before = rpm;
    }
    expect(single.gear).toBe(1);
  });
});

describe('haptics (Section 14.4)', () => {
  const nav = globalThis.navigator as unknown as { vibrate?: unknown };
  afterEach(() => {
    resetHaptics();
    delete nav.vibrate;
  });

  it('has a short pattern for every kind', () => {
    expect(Object.keys(HAPTIC_PATTERNS).sort()).toEqual([...HAPTIC_KINDS].sort());
    for (const kind of HAPTIC_KINDS) {
      const pattern = HAPTIC_PATTERNS[kind];
      expect(pattern.length % 2, `${kind} ends on a pulse`).toBe(1);
      expect(
        pattern.reduce((a, b) => a + b, 0),
        kind,
      ).toBeLessThanOrEqual(250);
    }
    expect(hapticPattern('explosion', 1)).toEqual([40, 30, 22]);
    // Strength scales the pulses and leaves the gaps; reduced intensity halves the pulses.
    expect(hapticPattern('explosion', 0.5)).toEqual([20, 30, 11]);
    expect(hapticPattern('explosion', 1, true)).toEqual([20, 30, 11]);
    expect(hapticPattern('tap', 0)).toEqual([4]);
  });

  it('does nothing where the browser cannot vibrate, and nothing until the player turns it on', () => {
    expect(hapticsSupported()).toBe(false);
    setHapticsEnabled(true);
    expect(haptic('hit_heavy')).toBe(false);

    const calls: unknown[] = [];
    Object.defineProperty(nav, 'vibrate', {
      configurable: true,
      value: (pattern: unknown) => {
        calls.push(pattern);
        return true;
      },
    });
    resetHaptics();
    expect(hapticsSupported()).toBe(true);
    // Supported, but off by default.
    expect(haptic('hit_heavy', 1, 1000)).toBe(false);
    expect(calls).toEqual([]);

    setHapticsEnabled(true);
    expect(haptic('hit_heavy', 1, 1000)).toBe(true);
    expect(calls).toEqual([[32]]);
    // A burst of hits is one pulse, not ten.
    expect(haptic('hit_light', 1, 1000 + HAPTIC_MIN_GAP_MS - 1)).toBe(false);
    expect(haptic('hit_light', 1, 1000 + HAPTIC_MIN_GAP_MS)).toBe(true);
    setHapticsReduced(true);
    expect(haptic('ko', 1, 5000)).toBe(true);
    expect(calls[2]).toEqual([35, 40, 55]);
    // Turning it off cancels whatever is running.
    setHapticsEnabled(false);
    expect(calls[3]).toBe(0);
    expect(haptic('ko', 1, 9000)).toBe(false);
  });

  it('a device that throws is treated as one that cannot', () => {
    Object.defineProperty(nav, 'vibrate', {
      configurable: true,
      value: () => {
        throw new Error('not allowed');
      },
    });
    setHapticsEnabled(true);
    expect(haptic('tap', 1, 0)).toBe(false);
  });
});

describe('music', () => {
  it('the theme is in tempo range and its notes fit their bars', () => {
    expect(Object.values(THEMES)).toContain(DEFAULT_THEME);
    for (const theme of Object.values(THEMES)) {
      for (const bpm of [theme.bpm, theme.bpmFinal]) {
        expect(bpm).toBeGreaterThanOrEqual(100);
        expect(bpm).toBeLessThanOrEqual(145);
      }
      expect(theme.bpmFinal).toBeGreaterThan(theme.bpm);
      expect(theme.lead.length).toBe(theme.bars.length);
      for (const bar of theme.lead) {
        let end = 0;
        for (const [step, midi, steps] of bar) {
          expect(step).toBeGreaterThanOrEqual(end);
          end = step + steps;
          expect(midi).toBeGreaterThanOrEqual(60);
          expect(midi).toBeLessThanOrEqual(96);
        }
        expect(end).toBeLessThanOrEqual(16);
      }
    }
  });

  it('the final-lap arrangement is denser than the normal one, and the loop varies', () => {
    const count = (intensity: 'normal' | 'final', cycle: number) => {
      let notes = 0;
      for (let bar = 0; bar < 8; bar++)
        for (let step = 0; step < 16; step++)
          notes += stepEvents(DEFAULT_THEME, bar, step, cycle, intensity).length;
      return notes;
    };
    expect(count('final', 0)).toBeGreaterThan(count('normal', 1) * 1.2);
    // The arpeggio joins every other time round.
    expect(count('normal', 1)).toBeGreaterThan(count('normal', 0));
    // Never more notes on one step than the music bus has voices.
    for (let bar = 0; bar < 8; bar++)
      for (let step = 0; step < 16; step++)
        expect(stepEvents(DEFAULT_THEME, bar, step, 1, 'final').length).toBeLessThanOrEqual(6);
    // Every bar starts with a kick and a bass note.
    for (let bar = 0; bar < 8; bar++) {
      const first = stepEvents(DEFAULT_THEME, bar, 0, 0, 'normal').map((e) => e.instrument);
      expect(first).toEqual(expect.arrayContaining(['kick', 'bass', 'lead']));
    }
  });
});

describe('audio preferences', () => {
  it('defaults: music low, haptics off, nothing reduced', () => {
    expect(DEFAULT_AUDIO_PREFS).toEqual({
      musicVolume: 0.5,
      uiVolume: 0.8,
      musicEnabled: true,
      haptics: false,
      reducedIntensity: false,
    });
    expect(parseAudioPrefs(null)).toEqual(DEFAULT_AUDIO_PREFS);
    expect(parseAudioPrefs('not json')).toEqual(DEFAULT_AUDIO_PREFS);
  });

  it('keeps what is valid, clamps volumes and drops the rest', () => {
    const parsed = parseAudioPrefs(
      JSON.stringify({
        musicVolume: 7,
        uiVolume: -1,
        haptics: true,
        musicEnabled: 'yes',
        extra: 1,
      }),
    );
    expect(parsed).toEqual({ ...DEFAULT_AUDIO_PREFS, musicVolume: 1, uiVolume: 0, haptics: true });
    expect(parsed).not.toHaveProperty('extra');
  });
});
