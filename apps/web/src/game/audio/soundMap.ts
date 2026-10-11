import { allParts } from '@bolt/content';
import type { RaceEvent, RaceEventType, StatusFamily } from '@bolt/shared';
import { DEFAULT_ENGINE_KEY, engineRecipe } from './engineRecipes.js';
import type { HapticKind } from './haptics.js';

/**
 * Which sound answers what. Everything here is a table or a pure function of one event, so a
 * Node test can prove that every event type and every part id of the catalog resolves to a
 * recipe that exists.
 */

// --- Cues ----------------------------------------------------------------------------------

/** What a loop stays attached to, so it can be placed in the world and stopped when that goes. */
export type Follow =
  | { kind: 'car'; car: number }
  | { kind: 'projectile'; id: number; owner: number }
  | { kind: 'hazard'; id: number }
  | { kind: 'point'; x: number; y: number };

export type PlayCue = {
  kind: 'play';
  id: string;
  /** The car the sound belongs to. The player's own car is heard centred and at full level. */
  car?: number;
  /** A place in the world, for sounds that are not on a car. */
  x?: number;
  y?: number;
  gain?: number;
  pitch?: number;
  stretch?: number;
  /** Counts against the shared allowance for bursts of small impacts. */
  burst?: boolean;
  /** Keeps the voice under a key: a loop until stopped, or a one-shot that can be cut. */
  key?: string;
  /** Seconds after which a keyed voice is stopped whatever happens. */
  ttl?: number;
  follow?: Follow;
  /** Vibration to go with it, when it is the player's and haptics are on. */
  haptic?: HapticKind;
  /** The scene already reports the player's own wall strikes: skip when it just did. */
  dedupe?: 'wall';
};

export type StopCue = { kind: 'stop'; key: string; prefix?: boolean };

export type Cue = PlayCue | StopCue;

const play = (id: string, extra: Omit<PlayCue, 'kind' | 'id'> = {}): PlayCue => ({
  kind: 'play',
  id,
  ...extra,
});
const stop = (key: string, prefix = false): StopCue => ({ kind: 'stop', key, prefix });

// --- Weapons (Section 13.4) ----------------------------------------------------------------

export type ImpactOn = Extract<RaceEvent, { type: 'impact' }>['on'];

export type WeaponSounds = {
  /** Charge, draw-back or pivot, and the ticks the recipe was written for. */
  windup?: { id: string; ticks: number };
  /** The shot. `everyRound` plays it for each round of a burst; otherwise once per activation. */
  fire: string;
  everyRound?: boolean;
  /** Loop that follows the projectile. */
  travel?: string;
  /** A tracking weapon acquiring its target. */
  lock?: string;
  /** Loop for as long as an `area` lasts (the flame). */
  area?: string;
  /** Sound for the whole of a `telegraph`, and the ticks it was written for. */
  telegraph?: { id: string; ticks: number };
  /** The weapon's own mark on a hit, on top of what the struck surface sounds like. */
  hit?: string;
  explosion?: string;
  /** A projectile that ended on something other than a car. Missing means the default. */
  impact?: Partial<Record<ImpactOn, string | null>>;
  /** Vibration when the player fires it. */
  haptic?: HapticKind;
};

export const WEAPON_SOUNDS: Readonly<Record<string, WeaponSounds>> = {
  weapon_front_mg: { fire: 'mg_fire', everyRound: true, haptic: 'fire_light' },
  weapon_rear_mg: {
    windup: { id: 'sentry_pivot', ticks: 8 },
    fire: 'sentry_fire',
    everyRound: true,
  },
  weapon_turret: {
    lock: 'turret_lock',
    fire: 'turret_fire',
    everyRound: true,
    haptic: 'fire_light',
  },
  weapon_shotgun: { fire: 'shotgun_fire', hit: 'hit_pellets', haptic: 'fire_heavy' },
  weapon_railshot: {
    windup: { id: 'rail_charge', ticks: 24 },
    fire: 'rail_fire',
    hit: 'hit_rail',
    haptic: 'fire_heavy',
  },
  weapon_rocket: {
    fire: 'rocket_launch',
    travel: 'rocket_fly',
    explosion: 'explode_rocket',
    haptic: 'fire_heavy',
  },
  weapon_homing: {
    lock: 'seeker_lock',
    fire: 'seeker_launch',
    travel: 'seeker_fly',
    explosion: 'explode_seeker',
    haptic: 'fire_heavy',
  },
  weapon_mine: { fire: 'mine_drop', explosion: 'explode_mine' },
  weapon_oil: { fire: 'oil_spill' },
  weapon_foam: {
    fire: 'foam_launch',
    telegraph: { id: 'foam_fall', ticks: 15 },
    // The puddle forming is the landing sound (`hazard placed`).
    impact: { ground: null },
  },
  weapon_emp: { windup: { id: 'emp_charge', ticks: 18 }, fire: 'emp_burst', haptic: 'fire_heavy' },
  weapon_tesla: { fire: 'tesla_arc' },
  weapon_flame: { fire: 'flame_ignite', area: 'flame_stream' },
  weapon_frost: {
    fire: 'frost_fire',
    impact: { wall: 'frost_shatter', obstacle: 'frost_shatter' },
  },
  weapon_hammer: {
    windup: { id: 'hammer_draw', ticks: 8 },
    fire: 'hammer_swing',
    hit: 'hammer_clang',
    haptic: 'fire_heavy',
  },
  weapon_saw: { fire: 'saw_bite' },
  weapon_harpoon: { fire: 'harpoon_fire', haptic: 'fire_light' },
  weapon_air: { fire: 'air_blast', haptic: 'fire_heavy' },
  weapon_boomerang: {
    fire: 'boomerang_throw',
    travel: 'boomerang_spin',
    hit: 'boomerang_slash',
    impact: { caught: 'boomerang_catch' },
  },
  weapon_mortar: {
    lock: 'mortar_lock',
    fire: 'mortar_launch',
    telegraph: { id: 'mortar_whistle', ticks: 42 },
    explosion: 'explode_mortar',
    haptic: 'fire_heavy',
  },
};

/** A projectile that ends without a car: what it sounds like unless its weapon says otherwise. */
const DEFAULT_IMPACT: Record<ImpactOn, string> = {
  wall: 'proj_thud',
  obstacle: 'proj_thud',
  ground: 'proj_thud',
  expired: 'proj_fizzle',
  caught: 'boomerang_catch',
  intercepted: 'intercept_pop',
  scrambled: 'proj_fizzle',
};
const BULLET_WEAPONS = new Set([
  'weapon_front_mg',
  'weapon_rear_mg',
  'weapon_turret',
  'weapon_shotgun',
]);

// --- Defenses and utilities ----------------------------------------------------------------

/** Reactive defenses: the instant line they fire, and their answer to a `shield` event. */
export const DEFENSE_SOUNDS: Readonly<
  Record<string, { beam?: string; up?: string; down?: string; broken?: string }>
> = {
  defense_energy_shield: { up: 'shield_up', down: 'shield_down' },
  defense_breakaway: { broken: 'armor_break' },
  defense_reactive: { down: 'reactive_puff' },
  defense_antimissile: { beam: 'interceptor_fire' },
  defense_minesweeper: { beam: 'sweeper_zap' },
};

export const UTILITY_SOUNDS: Readonly<Record<string, { started?: string; done?: string }>> = {
  utility_spare: { started: 'spare_start', done: 'spare_done' },
  utility_repair: { started: 'repair_start', done: 'repair_done' },
  utility_nitro: { started: 'nitro_kick' },
  utility_overdrive: { started: 'booster_kick' },
  utility_decoy: { started: 'decoy_launch' },
  utility_jump: { started: 'jump_launch' },
  utility_winch: { started: 'winch_pull' },
  utility_capacitor: { started: 'capacitor_zap' },
};

// --- Statuses ------------------------------------------------------------------------------

/**
 * One entry per status family. `loop` runs from `applied` to `expired`; `on` and `off` are
 * one-shots. `null` is a decision: `immune` is shown, never heard, because it begins in the
 * same tick as the disable that grants it and a second sound there would only blur the first.
 */
export const STATUS_SOUNDS: Readonly<
  Record<StatusFamily, { loop?: string; on?: string; off?: string } | null>
> = {
  slow: { on: 'status_slow' },
  // Oil and frost both cost grip and sound nothing alike: see `gripSource`.
  grip: { loop: 'oil_slip' },
  burn: { loop: 'status_burn' },
  emp: { loop: 'status_emp' },
  jam: { loop: 'status_jam' },
  boost: { loop: 'boost_loop' },
  refit: { loop: 'repair_work' },
  airborne: { off: 'jump_land' },
  immune: null,
};

// --- Hits (Section 13.6) -------------------------------------------------------------------

export type HitSurface = 'shield' | 'armor' | 'engine' | 'steering' | 'wheel' | 'module' | 'body';

export const SURFACE_SOUNDS: Readonly<Record<HitSurface, string>> = {
  shield: 'hit_shield',
  armor: 'hit_armor',
  engine: 'hit_engine',
  steering: 'hit_steering',
  wheel: 'hit_wheel',
  module: 'hit_module',
  body: 'hit_body',
};

type HitEvent = Extract<RaceEvent, { type: 'hit' }>;

/**
 * What a hit sounds like it struck. Whatever stood in the way and took most of it wins: a hit
 * a shield swallowed is a shield, one a plate mostly stopped is armor, and only then the
 * component (engine 0, steering 1, the wheels, then mounted parts) or bare bodywork.
 */
export function hitSurface(event: HitEvent, wheels: number): HitSurface {
  const through = event.damage + event.chassis;
  if (event.shield > 0 && event.shield >= through) return 'shield';
  if (event.armor > 0 && event.armor >= through) return 'armor';
  if (event.component === 0) return 'engine';
  if (event.component === 1) return 'steering';
  if (event.component >= 2 && event.component < 2 + wheels) return 'wheel';
  if (event.component >= 2 + wheels) return 'module';
  return 'body';
}

// --- Refusals ------------------------------------------------------------------------------

type RefusedEvent = Extract<RaceEvent, { type: 'refused' }>;

export const REFUSAL_SOUNDS: Readonly<Record<RefusedEvent['reason'], string>> = {
  no_weapon: 'refuse_tick',
  cooldown: 'refuse_tick',
  no_ammo: 'empty_click',
  low_power: 'warn_low_power',
  overheat: 'warn_heat',
  disabled: 'ui_deny',
  jammed: 'ui_deny',
  no_target: 'refuse_tick',
  not_needed: 'refuse_tick',
  busy: 'refuse_tick',
};

// --- Events --------------------------------------------------------------------------------

export type MapContext = {
  /** Index of the player's car. */
  you: number;
  /** Mounted part ids of each car, in canonical blueprint order. */
  parts: readonly (readonly string[])[];
  /** Wheels of each car. */
  wheels: readonly number[];
  /** Laps in the race. */
  laps: number;
  /** What a loss of grip on this car most likely came from. */
  gripSource: (car: number) => 'frost' | 'oil';
};

const TICK = 1 / 30;

type Handlers = {
  [T in RaceEventType]: (e: Extract<RaceEvent, { type: T }>, c: MapContext) => Cue[];
};

/** One handler per event type: the compiler refuses a missing one. */
export const EVENT_HANDLERS: Handlers = {
  checkpoint: (e, c) => (e.car === c.you ? [play('checkpoint_tick', { car: e.car })] : []),

  lap: (e, c) => {
    if (e.car !== c.you || e.lap >= c.laps) return [];
    return [play(e.lap === c.laps - 1 ? 'final_lap' : 'lap_chime', { car: e.car })];
  },

  finish: (e, c) =>
    e.car === c.you && e.finished ? [play('finish_line', { car: e.car, haptic: 'go' })] : [],

  wall: (e, c) => {
    const gain = Math.min(1, 0.35 + e.speed / 300);
    const cue = play('wall_thump', { car: e.car, gain });
    if (e.car === c.you) cue.dedupe = 'wall';
    return [cue];
  },

  position: (e, c) => [play(e.leader === c.you ? 'pos_gain' : 'pos_loss', { car: c.you })],

  windup: (e) => {
    const sounds = WEAPON_SOUNDS[e.weapon]?.windup;
    if (!sounds) return [];
    return [
      play(sounds.id, {
        car: e.car,
        stretch: Math.max(0.4, e.ticks / sounds.ticks),
        key: `windup:${e.car}:${e.part}`,
        ttl: e.ticks * TICK + 0.1,
      }),
    ];
  },

  shot: (e, c) => {
    const sounds = WEAPON_SOUNDS[e.weapon];
    if (!sounds) return [];
    const cues: Cue[] = [];
    if (sounds.everyRound || e.n === 0) {
      const cue = play(sounds.fire, { car: e.car, x: e.x, y: e.y });
      // The barrels of a burst alternate: every other round sits a shade lower.
      if (sounds.everyRound && e.n % 2 === 1) cue.pitch = 0.92;
      if (e.car === c.you && sounds.haptic && e.n === 0) cue.haptic = sounds.haptic;
      cues.push(cue);
    }
    if (sounds.travel && e.projectile > 0)
      cues.push(
        play(sounds.travel, {
          car: e.car,
          x: e.x,
          y: e.y,
          key: `proj:${e.projectile}`,
          ttl: 8,
          follow: { kind: 'projectile', id: e.projectile, owner: e.car },
        }),
      );
    return cues;
  },

  beam: (e) => {
    const id = DEFENSE_SOUNDS[e.weapon]?.beam;
    // A weapon's beam is drawn from the same instant as its `shot`, which carries the sound.
    return id ? [play(id, { car: e.car, x: e.x, y: e.y })] : [];
  },

  area: (e) => {
    const id = WEAPON_SOUNDS[e.weapon]?.area;
    if (!id) return [];
    return [
      play(id, {
        car: e.car,
        key: `area:${e.car}:${e.part}`,
        ttl: e.ticks * TICK,
        follow: { kind: 'car', car: e.car },
      }),
    ];
  },

  telegraph: (e) => {
    const sounds = WEAPON_SOUNDS[e.weapon]?.telegraph;
    if (!sounds) return [];
    // Heard from where it will land: a shell coming down on the player is the loud one.
    return [play(sounds.id, { x: e.x, y: e.y, stretch: Math.max(0.3, e.ticks / sounds.ticks) })];
  },

  lock: (e, c) => {
    // The lock cue is the gunner's own. The target hears the `warning` instead.
    if (e.car !== c.you) return [];
    const id = WEAPON_SOUNDS[e.weapon]?.lock;
    if (!e.locked) return [play('lock_lost', { car: e.car })];
    return id ? [play(id, { car: e.car })] : [];
  },

  warning: (e) => {
    switch (e.kind) {
      case 'lock':
        return [play('warn_lock', { car: e.car, key: 'warn', ttl: 30 })];
      case 'missile':
        return [
          stop('warn'),
          play('warn_missile', {
            car: e.car,
            key: 'warn',
            ttl: Math.max(0.4, e.value * TICK + 0.5),
            haptic: 'warning',
          }),
        ];
      case 'lock_lost':
        return [stop('warn'), play('warn_clear', { car: e.car })];
      case 'trap':
        return [play('warn_trap', { car: e.car })];
    }
  },

  hit: (e, c) => {
    const own = e.car === c.you;
    const at = { car: e.car, x: e.x, y: e.y };
    if (e.cls === 'burn') return [play('burn_tick', at)];
    const surface = hitSurface(e, c.wheels[e.car] ?? 4);
    const cues: Cue[] = [];
    const signature = WEAPON_SOUNDS[e.weapon]?.hit;
    if (e.cls === 'bullet') {
      // Pellets arrive together and have their own fan of ticks; single bullets are small,
      // quick and counted against the burst allowance so a long burst cannot pile up.
      if (signature) cues.push(play(signature, at));
      cues.push(play(SURFACE_SOUNDS[surface], { ...at, gain: 0.6, pitch: 1.25, burst: true }));
      if (own)
        cues[cues.length - 1] = { ...(cues[cues.length - 1] as PlayCue), haptic: 'hit_light' };
      return cues;
    }
    if (e.cls === 'ram') {
      const force = Math.min(1, 0.4 + (e.damage + e.chassis) / 20);
      cues.push(
        play('ram_crunch', {
          ...at,
          gain: force,
          ...(own ? { haptic: 'hit_heavy' as const } : {}),
        }),
      );
      cues.push(play(SURFACE_SOUNDS[surface], { ...at, gain: 0.6 }));
      return cues;
    }
    const heavy = e.cls === 'heavy';
    cues.push(
      play(SURFACE_SOUNDS[surface], {
        ...at,
        pitch: heavy ? 0.85 : 1,
        ...(own ? { haptic: heavy ? ('hit_heavy' as const) : ('hit_light' as const) } : {}),
      }),
    );
    if (signature) cues.push(play(signature, at));
    if (heavy) cues.push(play('impact_heavy', at));
    return cues;
  },

  explosion: (e) => {
    const id = WEAPON_SOUNDS[e.weapon]?.explosion ?? 'explode_rocket';
    return [stop(`proj:${e.projectile}`), play(id, { x: e.x, y: e.y, haptic: 'explosion' })];
  },

  impact: (e) => {
    const cues: Cue[] = [stop(`proj:${e.projectile}`)];
    const own = WEAPON_SOUNDS[e.weapon]?.impact;
    let id: string | null = own && e.on in own ? (own[e.on] ?? null) : DEFAULT_IMPACT[e.on];
    if (BULLET_WEAPONS.has(e.weapon) && (e.on === 'wall' || e.on === 'obstacle')) id = 'ricochet';
    if (id)
      cues.push(play(id, { x: e.x, y: e.y, ...(e.on === 'scrambled' ? { pitch: 1.5 } : {}) }));
    return cues;
  },

  status: (e, c) => {
    const key = `status:${e.car}:${e.family}`;
    if (e.state === 'blocked') return [play('status_blocked', { car: e.car })];
    const sounds = STATUS_SOUNDS[e.family];
    if (!sounds) return [];
    if (e.state === 'expired') {
      const cues: Cue[] = [stop(key)];
      if (sounds.off) cues.push(play(sounds.off, { car: e.car }));
      return cues;
    }
    const cues: Cue[] = [];
    // An EMP cancels a charge that is under way, and its sound with it.
    if (e.family === 'emp') cues.push(stop(`windup:${e.car}:`, true));
    if (sounds.on) cues.push(play(sounds.on, { car: e.car }));
    if (sounds.loop) {
      const id =
        e.family === 'grip' && c.gripSource(e.car) === 'frost' ? 'frost_crackle' : sounds.loop;
      cues.push(
        play(id, {
          car: e.car,
          key,
          ttl: e.ticks * TICK + 0.5,
          follow: { kind: 'car', car: e.car },
        }),
      );
    }
    return cues;
  },

  impulse: (e) => {
    // The hammer and the air cannon have their own, bigger sounds for the same moment.
    if (WEAPON_SOUNDS[e.weapon]?.hit === 'hammer_clang' || e.weapon === 'weapon_air') return [];
    const force = Math.hypot(e.dx, e.dy);
    if (force < 25) return [];
    return [play('shove', { car: e.car, gain: Math.min(1, 0.4 + force / 300) })];
  },

  component: (e, c) => {
    if (e.repaired) return [play('part_repaired', { car: e.car })];
    if (e.condition === 'disabled')
      return [
        play('part_destroyed', {
          car: e.car,
          ...(e.car === c.you ? { haptic: 'ko' as const } : {}),
        }),
      ];
    if (e.condition === 'critical' && e.car === c.you)
      return [play('part_critical', { car: e.car, haptic: 'warning' })];
    if (e.condition === 'healthy') return [];
    return [play('part_damaged', { car: e.car })];
  },

  shield: (e, c) => {
    const part = c.parts[e.car]?.[e.part];
    const sounds = part ? DEFENSE_SOUNDS[part] : undefined;
    const id =
      sounds?.[e.state] ??
      (e.state === 'up' ? 'shield_up' : e.state === 'broken' ? 'armor_break' : 'shield_down');
    return [play(id, { car: e.car })];
  },

  hazard: (e) => {
    const at = { x: e.x, y: e.y };
    const key = `hazard:${e.hazard}`;
    switch (e.state) {
      case 'placed':
        if (e.kind === 'mine') return [play('mine_blink', at)];
        if (e.kind === 'foam') return [play('foam_splat', at)];
        if (e.kind === 'frost') return [play('frost_shatter', at)];
        if (e.kind === 'fire') return [play('fire_ignite', at)];
        if (e.kind === 'decoy')
          return [
            play('decoy_hum', { ...at, key, ttl: 12, follow: { kind: 'hazard', id: e.hazard } }),
          ];
        // Oil: the spill is the `shot`.
        return [];
      case 'armed':
        return e.kind === 'mine' ? [play('mine_armed', at)] : [];
      case 'triggered':
        // A mine's trigger is its explosion, which follows in the same tick.
        if (e.kind === 'mine') return [stop(key)];
        if (e.kind === 'decoy') return [stop(key), play('intercept_pop', at)];
        return [play('splash', at)];
      case 'cleared':
        return [stop(key), play('trap_cleared', at)];
      case 'ignited':
        return [play('fire_ignite', at)];
      case 'melted':
        return [play('frost_melt', at)];
      case 'expired':
        return [stop(key)];
    }
  },

  tether: (e) => {
    const key = `tether:${e.car}`;
    if (e.state === 'attached')
      return [
        play('harpoon_hook', { car: e.target }),
        play('tether_tension', { car: e.car, key, ttl: 3, follow: { kind: 'car', car: e.car } }),
      ];
    return [stop(key), play('harpoon_release', { car: e.car })];
  },

  utility: (e) => {
    if (e.state === 'interrupted') return [play('utility_interrupted', { car: e.car })];
    const id = UTILITY_SOUNDS[e.utility]?.[e.state];
    return id ? [play(id, { car: e.car })] : [];
  },

  misfire: (e) => [play('misfire', { car: e.car })],

  refused: (e) => [play(REFUSAL_SOUNDS[e.reason], { car: e.car })],

  ko: (e, c) => [
    play('ko_blast', { car: e.car, ...(e.car === c.you ? { haptic: 'ko' as const } : {}) }),
  ],

  result: (e, c) => [
    stop('warn'),
    play(e.winner === c.you ? 'stinger_win' : e.winner < 0 ? 'stinger_draw' : 'stinger_lose', {
      car: c.you,
      haptic: 'go',
    }),
  ],
};

/** The sounds one event asks for, in order. */
export function cuesForEvent(event: RaceEvent, context: MapContext): Cue[] {
  const handler = EVENT_HANDLERS[event.type] as (e: RaceEvent, c: MapContext) => Cue[];
  return handler(event, context);
}

// --- Parts ---------------------------------------------------------------------------------

export type PartSound = {
  /** Heard when the part goes onto the car in the garage. */
  install: { id: string; pitch: number };
  /** Every recipe this part can cause during a race. */
  race: string[];
  /** Engines: the engine voice. Tires and chassis: the family that colours skids and thumps. */
  engineKey?: string;
  family?: string;
};

/** Install sound per catalog `soundKey`. Parts that share a key are told apart by pitch. */
const INSTALL_BY_KEY: Readonly<Record<string, string>> = {
  chassis_light: 'install_chassis_light',
  chassis_heavy: 'install_chassis_heavy',
  tires_road: 'install_tires_road',
  tires_offroad: 'install_tires_offroad',
  tires_studded: 'install_tires_studded',
  tires_heavy: 'install_tires_heavy',
  tires_track: 'install_tires_track',
  defense_plate: 'install_plate',
  defense_shield: 'install_shield',
  defense_system: 'install_system',
  defense_interceptor: 'install_interceptor',
  utility_repair: 'install_repair',
  utility_nitro: 'install_nitro',
};

/** The catalog gives fourteen utilities one generic key; these tell them apart. */
const INSTALL_BY_ID: Readonly<Record<string, string>> = {
  utility_fan: 'install_fan',
  utility_radiator: 'install_fan',
  utility_battery: 'install_power',
  utility_generator: 'install_power',
  utility_capacitor: 'install_power',
  utility_solar: 'install_power',
  utility_traction: 'install_computer',
  utility_gyro: 'install_computer',
  utility_radar: 'install_computer',
  utility_minesensor: 'install_computer',
  utility_targeting: 'install_computer',
  utility_decoy: 'install_computer',
  utility_jump: 'install_servo',
  utility_winch: 'install_servo',
  utility_ballast: 'install_servo',
  utility_spoiler: 'install_servo',
};

/** What a passive part is heard as during a race, where it is heard at all. */
const RACE_BY_ID: Readonly<Record<string, string[]>> = {
  utility_radar: ['warn_missile'],
  utility_minesensor: ['warn_trap'],
  utility_nitro: ['nitro_kick', 'boost_loop'],
  utility_overdrive: ['booster_kick', 'boost_loop'],
  utility_spare: ['spare_start', 'repair_work', 'spare_done', 'part_repaired'],
  utility_repair: ['repair_start', 'repair_work', 'repair_done', 'part_repaired'],
  utility_decoy: ['decoy_launch', 'decoy_hum'],
  utility_jump: ['jump_launch', 'jump_land'],
  defense_antimissile: ['interceptor_fire', 'intercept_pop'],
  defense_minesweeper: ['sweeper_zap', 'trap_cleared'],
};

function weaponRecipes(sounds: WeaponSounds): string[] {
  const ids = [sounds.fire];
  if (sounds.windup) ids.push(sounds.windup.id);
  if (sounds.travel) ids.push(sounds.travel);
  if (sounds.lock) ids.push(sounds.lock);
  if (sounds.area) ids.push(sounds.area);
  if (sounds.telegraph) ids.push(sounds.telegraph.id);
  if (sounds.hit) ids.push(sounds.hit);
  if (sounds.explosion) ids.push(sounds.explosion);
  for (const id of Object.values(sounds.impact ?? {})) if (id) ids.push(id);
  return ids;
}

function buildPartSounds(): Record<string, PartSound> {
  const table: Record<string, PartSound> = {};
  const seen = new Map<string, number>();
  for (const part of allParts()) {
    const base =
      INSTALL_BY_ID[part.id] ??
      INSTALL_BY_KEY[part.soundKey] ??
      (part.category === 'engine'
        ? 'install_engine'
        : part.category === 'weapon'
          ? 'install_weapon'
          : undefined);
    if (!base) continue;
    // Parts sharing an install sound step through a seven-note scale, so no two in a row match.
    const index = seen.get(base) ?? 0;
    seen.set(base, index + 1);
    const pitch = Math.pow(2, ((index % 7) - 3) / 12);
    const sound: PartSound = { install: { id: base, pitch }, race: [] };
    if (part.category === 'engine') {
      sound.engineKey = engineRecipe(part.soundKey) ? part.soundKey : DEFAULT_ENGINE_KEY;
    } else if (part.category === 'tires' || part.category === 'chassis') {
      sound.family = part.soundKey;
      if (part.category === 'chassis')
        sound.race.push(part.soundKey === 'chassis_heavy' ? 'wall_thump_heavy' : 'wall_thump');
    } else if (part.category === 'weapon') {
      const weapon = WEAPON_SOUNDS[part.id];
      if (weapon) sound.race.push(...weaponRecipes(weapon));
    } else {
      const defense = DEFENSE_SOUNDS[part.id];
      if (defense) for (const id of Object.values(defense)) sound.race.push(id);
      const utility = UTILITY_SOUNDS[part.id];
      if (utility) for (const id of Object.values(utility)) sound.race.push(id);
      for (const id of RACE_BY_ID[part.id] ?? []) if (!sound.race.includes(id)) sound.race.push(id);
    }
    table[part.id] = sound;
  }
  return table;
}

/** Every part of the catalog, by id. */
export const PART_SOUNDS: Readonly<Record<string, PartSound>> = buildPartSounds();

export function partSound(partId: string): PartSound | undefined {
  return Object.prototype.hasOwnProperty.call(PART_SOUNDS, partId)
    ? PART_SOUNDS[partId]
    : undefined;
}
