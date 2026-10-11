import type {
  RaceEvent,
  RaceSnapshot,
  StatusSnapshot,
  SurfaceId,
  TrackRuntime,
} from '@bolt/shared';
import { NOMINAL_TOP_SPEED, createLocation, locate, surfaceAt } from '@bolt/shared';
import { DEFAULT_ENGINE_KEY, engineRecipe } from './engineRecipes.js';
import type { EngineExtra, EngineInput } from './engineVoice.js';
import { EngineVoice, TireVoice } from './engineVoice.js';
import type { HapticKind } from './haptics.js';
import { haptic } from './haptics.js';
import type { Placement } from './mixMath.js';
import { CAPS, SPACE, clamp, distanceGain, panFor, place } from './mixMath.js';
import type { Voice } from './mixer.js';
import { Mixer } from './mixer.js';
import type { Theme } from './music.js';
import { DEFAULT_THEME, MusicPlayer, THEMES } from './music.js';
import { SFX } from './sfxRecipes.js';
import type { Cue, Follow, MapContext, PlayCue } from './soundMap.js';
import { STATUS_SOUNDS, cuesForEvent, partSound } from './soundMap.js';

/**
 * The sound of a race. It is told three things, all through `raceFeed`: each race snapshot,
 * each event once, and resets. From those it runs the engines, the tires, every weapon and
 * status sound, the warnings and the music, on whatever `BaseAudioContext` it is given: the
 * live one in the game, an offline one in the render tests.
 *
 * Nothing here creates nodes per frame. Continuous sounds are fixed graphs whose parameters
 * glide; discrete sounds are pooled voices with hard caps (see `mixMath.ts`).
 */

/** What the system needs to know about the player's own car and the track, once per race. */
export type RaceAudioContext = {
  /** Catalog ids. */
  engineId: string;
  tireKitId: string;
  chassisId: string;
  /** Mounted part ids in canonical order, so an event's `part` index can be read. */
  parts: readonly string[];
  /** For the surface under the tires. Null when unknown: everything is then asphalt. */
  track: TrackRuntime | null;
  laps: number;
  /** Wet road: skids hiss more and screech less. */
  wet: boolean;
  /** Key into the music themes; usually the track id. */
  themeId: string;
};

export type AudioLevels = {
  engine: number;
  effects: number;
  ui: number;
  music: number;
  muted: boolean;
  musicEnabled: boolean;
  /** Softens the biggest sounds and the EMP stutter (accessibility, Section 16). */
  reducedIntensity: boolean;
};

export const DEFAULT_LEVELS: AudioLevels = {
  engine: 0.7,
  effects: 0.8,
  ui: 0.8,
  music: 0.5,
  muted: false,
  musicEnabled: true,
  reducedIntensity: false,
};

/** Interface sounds other code may ask for by name (see `uiSound` in `index.ts`). */
export const UI_SOUNDS = {
  tap: 'ui_tap',
  select: 'ui_select',
  confirm: 'ui_confirm',
  back: 'ui_back',
  deny: 'ui_deny',
  illegal: 'ui_illegal',
  toggle_on: 'ui_toggle_on',
  toggle_off: 'ui_toggle_off',
  slider: 'ui_slider',
  open: 'ui_open',
  close: 'ui_close',
  install: 'install_system',
  remove: 'ui_remove',
  rotate: 'ui_rotate',
  ready: 'ui_ready',
  timer_tick: 'ui_timer_tick',
  timer_urgent: 'ui_timer_urgent',
  timer_end: 'ui_timer_end',
  save: 'ui_save',
  error: 'ui_error',
} as const;
export type UiSoundKind = keyof typeof UI_SOUNDS;

type Keyed = {
  voice: Voice;
  until: number;
  follow: Follow | null;
  /** Snapshots in a row in which the thing it follows was not there. */
  missing: number;
  cents: number;
};

type CarAudio = {
  engineKey: string;
  tireKey: string;
  chassisKey: string;
  parts: readonly string[];
};

const FALLBACK_CAR: CarAudio = {
  engineKey: DEFAULT_ENGINE_KEY,
  tireKey: 'tires_road',
  chassisKey: 'chassis_light',
  parts: [],
};

/** Seconds of music scheduled ahead: longer than the gap between two housekeeping ticks. */
const MUSIC_LOOKAHEAD = 0.25;

/** Categories that reduced intensity turns down. */
const LOUD = new Set(['explosion', 'fire_big', 'impact']);

const NO_STATUSES: readonly StatusSnapshot[] = [];

function carAudio(
  engineId: string,
  tireKitId: string,
  chassisId: string,
  parts: readonly string[],
): CarAudio {
  return {
    engineKey: partSound(engineId)?.engineKey ?? DEFAULT_ENGINE_KEY,
    tireKey: partSound(tireKitId)?.family ?? 'tires_road',
    chassisKey: partSound(chassisId)?.family ?? 'chassis_light',
    parts,
  };
}

export class AudioSystem {
  readonly mixer: Mixer;
  readonly music: MusicPlayer;
  levels: AudioLevels = { ...DEFAULT_LEVELS };

  private readonly keyed = new Map<string, Keyed>();
  private context: RaceAudioContext | null = null;
  private own: CarAudio = FALLBACK_CAR;
  private rival: CarAudio = FALLBACK_CAR;
  private rivalJson = '';
  private theme: Theme = DEFAULT_THEME;
  private race: RaceSnapshot | null = null;
  private ownEngine: EngineVoice | null = null;
  private rivalEngine: EngineVoice | null = null;
  private tires: TireVoice | null = null;
  private preview: EngineVoice | null = null;
  private readonly loc = createLocation();
  private surface: SurfaceId = 'asphalt';

  // The listener: the player's car.
  private lx = 0;
  private ly = 0;
  private rx = 0;
  private ry = 0;
  private haveRival = false;

  private lastFrameAt = -10;
  private frameSpeed = 0;
  private frameSlip = 0;
  private topSpeed = NOMINAL_TOP_SPEED;
  private lastThumpAt = -10;
  private prevPhase: RaceSnapshot['phase'] | null = null;
  private prevBurst = 0;
  private prevHeat = 0;
  private prevLimited = false;
  private prevBattery = -1;
  private prevReserve = 0;
  private warnMissing = 0;
  private over = false;
  private musicDone = false;
  private readonly partsByCar: Array<readonly string[]> = [[], []];
  private readonly wheelsByCar: number[] = [4, 4];
  private readonly inputOwn: EngineInput = blankInput();
  private readonly inputRival: EngineInput = blankInput();
  private readonly mapContext: MapContext;

  /**
   * When set and false, nothing new is started (the live context is suspended: a voice started
   * on a stopped clock would play late, all at once, when it resumes). Stops still apply.
   */
  gate: (() => boolean) | null = null;

  /** Set by the debug hook: times the per-frame update, to show it costs next to nothing. */
  profile: FrameProfile | null = null;

  /** Asked once per race for the player's car and the track, when the first snapshot arrives. */
  resolveContext: ((race: RaceSnapshot) => RaceAudioContext | null) | null = null;

  constructor(
    readonly ctx: BaseAudioContext,
    options: { master?: boolean } = {},
  ) {
    this.mixer = new Mixer(ctx, options.master ?? true);
    this.music = new MusicPlayer(this.mixer);
    this.mapContext = {
      you: 0,
      parts: this.partsByCar,
      wheels: this.wheelsByCar,
      laps: 3,
      gripSource: (car) => this.gripSource(car),
    };
    this.applyLevels(this.levels);
  }

  // --- Settings ----------------------------------------------------------------------------

  applyLevels(levels: AudioLevels): void {
    const before = this.levels;
    this.levels = levels;
    const m = this.mixer;
    m.setBusVolume('engine', levels.engine);
    for (const bus of ['weapons', 'impacts', 'ambience', 'alerts'] as const)
      m.setBusVolume(bus, levels.effects);
    m.setBusVolume('ui', levels.ui);
    m.setBusVolume('music', levels.musicEnabled ? levels.music : 0);
    m.setMuted(levels.muted);
    if (before.musicEnabled && !levels.musicEnabled) this.music.stop();
  }

  // --- The race ----------------------------------------------------------------------------

  setContext(context: RaceAudioContext): void {
    this.context = context;
    this.own = carAudio(context.engineId, context.tireKitId, context.chassisId, context.parts);
    this.theme = THEMES[context.themeId] ?? DEFAULT_THEME;
    this.mapContext.laps = context.laps;
    // A different car: the engine voice is rebuilt on the next update.
    if (this.ownEngine && this.ownEngine.recipe.key !== this.own.engineKey) {
      this.ownEngine.dispose();
      this.ownEngine = null;
    }
  }

  private readRival(race: RaceSnapshot): void {
    if (race.rivalBlueprint === this.rivalJson) return;
    this.rivalJson = race.rivalBlueprint;
    this.rival = FALLBACK_CAR;
    try {
      const bp = JSON.parse(race.rivalBlueprint) as {
        engineId?: unknown;
        tireKitId?: unknown;
        chassisId?: unknown;
        parts?: unknown;
      };
      const parts = Array.isArray(bp.parts)
        ? bp.parts.map((p) => String((p as { partId?: unknown } | null)?.partId ?? ''))
        : [];
      this.rival = carAudio(String(bp.engineId), String(bp.tireKitId), String(bp.chassisId), parts);
    } catch {
      // An unreadable blueprint: the rival sounds like the baseline car.
    }
    if (this.rivalEngine && this.rivalEngine.recipe.key !== this.rival.engineKey) {
      this.rivalEngine.dispose();
      this.rivalEngine = null;
    }
  }

  onRace(race: RaceSnapshot): void {
    const first = this.race === null;
    this.race = race;
    if (first || !this.context) {
      const context = this.resolveContext?.(race);
      if (context) this.setContext(context);
    }
    this.readRival(race);
    const now = this.ctx.currentTime;
    const m = race.car.motion;
    this.lx = m.x;
    this.ly = m.y;
    this.haveRival = race.rival.buildHash !== '' || race.rivalBlueprint !== '';
    this.rx = race.rival.x;
    this.ry = race.rival.y;
    const map = this.mapContext;
    map.you = race.you;
    const other = race.you === 0 ? 1 : 0;
    this.partsByCar[race.you] = this.own.parts;
    this.partsByCar[other] = this.rival.parts;
    this.wheelsByCar[race.you] = race.car.wheelIntegrity.length || 4;
    this.wheelsByCar[other] = Math.max(
      1,
      race.rival.components.length - 2 - this.rival.parts.length,
    );

    // The music starts at GO, or when sound is first unlocked or the music switched on in the
    // middle of a race, and ends when the player's race does.
    if (this.prevPhase === 'COUNTDOWN' && race.phase === 'RACING') this.over = false;
    this.prevPhase = race.phase;
    if (
      race.phase === 'RACING' &&
      race.car.phase !== 'FINISHED' &&
      !race.result &&
      !this.over &&
      !this.musicDone &&
      this.levels.musicEnabled &&
      !this.music.isPlaying
    )
      this.music.start(this.theme, now);
    if (this.music.isPlaying) {
      const lastLap = race.car.progress.lap >= map.laps;
      if ((lastLap || race.finishWindowEndTick > 0) && this.music.currentIntensity !== 'final')
        this.music.setIntensity('final');
      if (race.result || race.phase === 'FINISHED' || race.car.phase === 'FINISHED') {
        this.musicDone = true;
        this.music.stop();
      }
    }

    // The surface under the tires, fifteen times a second.
    if (this.context?.track) {
      locate(this.context.track, m.x, m.y, this.loc);
      this.surface = surfaceAt(this.context.track, this.loc).surface;
    }

    const combat = race.car.combat;
    const ownStatuses = combat?.statuses ?? NO_STATUSES;
    const racing = race.phase !== 'FINISHED' && race.car.phase !== 'FINISHED';

    // Driving sounds from the snapshot, unless the scene is feeding frames.
    const speed = Math.hypot(m.velocityX, m.velocityY);
    const io = this.inputOwn;
    io.spool = m.engineSpool;
    io.clock = m.engineClock;
    io.stutter = hasStatus(ownStatuses, 'emp') ? (this.levels.reducedIntensity ? 0.45 : 1) : 0;
    if (now - this.lastFrameAt > 0.25) {
      const fx = Math.sin(m.headingRad);
      const fy = -Math.cos(m.headingRad);
      const forward = m.velocityX * fx + m.velocityY * fy;
      const lateral = Math.abs(m.velocityX * fy - m.velocityY * fx);
      io.speedShare = Math.abs(forward) / this.topSpeed;
      io.throttle = m.throttleFraction;
      io.active = racing;
      this.frameSpeed = speed;
      this.frameSlip = speed > 20 ? clamp(Math.atan2(lateral, Math.abs(forward)) / 0.5, 0, 1) : 0;
      this.driveOwn(0.09);
    }
    if (m.engineBurst > 0 && this.prevBurst <= 0 && race.phase === 'RACING')
      this.ownEngine?.burst(1);
    this.prevBurst = m.engineBurst;

    // The rival's engine, where it is.
    if (this.haveRival) {
      const r = race.rival;
      const ir = this.inputRival;
      const d = Math.hypot(r.x - this.lx, r.y - this.ly);
      ir.gain = distanceGain(d) * SPACE.rivalTrim * 0.8;
      ir.pan = panFor(r.x - this.lx);
      ir.speedShare = Math.hypot(r.velocityX, r.velocityY) / this.topSpeed;
      ir.throttle = r.braking ? 0.05 : 0.75;
      ir.spool = clamp(ir.speedShare * 1.4, 0, 1);
      ir.clock = (race.tick / 30) % 4;
      ir.active = race.phase !== 'FINISHED' && r.finishedAtMs === null && !r.ko;
      ir.stutter = hasStatus(r.statuses, 'emp') ? 1 : 0;
      if (!this.rivalEngine && ir.gain > 0.01)
        this.rivalEngine = this.makeEngine(this.rival.engineKey, false);
      this.rivalEngine?.update(ir, 0.09);
    }

    this.watchGauges(race, racing);
    this.reconcile(race, now);
    this.mixer.sweep(now);
    this.music.pump(now + MUSIC_LOOKAHEAD);
  }

  /** Heat and battery have no events: the warnings come from the gauges crossing a line. */
  private watchGauges(race: RaceSnapshot, racing: boolean): void {
    const m = race.car.motion;
    if (racing && race.phase === 'RACING') {
      if (m.thermalLimited && !this.prevLimited)
        this.cue({ kind: 'play', id: 'warn_overheat', car: race.you, haptic: 'warning' });
      else if (m.coreHeat >= 90 && this.prevHeat < 90)
        this.cue({ kind: 'play', id: 'warn_heat', car: race.you });
      if (this.prevBattery >= 12 && m.batteryEnergy < 12)
        this.cue({ kind: 'play', id: 'warn_low_power', car: race.you });
    }
    // The Burst Capacitor has no event either: its reserve falling in one step is the discharge.
    const reserve = race.car.combat?.reserve ?? 0;
    if (racing && this.prevReserve - reserve > 5)
      this.cue({ kind: 'play', id: 'capacitor_zap', car: race.you });
    this.prevReserve = reserve;
    this.prevHeat = m.coreHeat;
    this.prevLimited = m.thermalLimited;
    this.prevBattery = m.batteryEnergy;
  }

  /**
   * Brings the keyed voices in line with the snapshot: moves the ones that follow something,
   * stops the ones whose subject is gone or whose time is up, and starts status and warning
   * loops the snapshot shows but no event announced (after a reconnect, or a hidden tab).
   */
  private reconcile(race: RaceSnapshot, now: number): void {
    const you = race.you;
    const other = you === 0 ? 1 : 0;
    const statusOf = (car: number) =>
      car === you ? (race.car.combat?.statuses ?? NO_STATUSES) : race.rival.statuses;

    this.expire(now);
    for (const [key, entry] of this.keyed) {
      if (key.startsWith('status:')) {
        const [, carText, family] = key.split(':');
        const present = hasStatus(statusOf(Number(carText)), family ?? '');
        entry.missing = present ? 0 : entry.missing + 1;
        if (entry.missing >= 3) {
          this.stopKey(key);
          continue;
        }
      }
      const follow = entry.follow;
      if (!follow) continue;
      if (follow.kind === 'car') {
        this.placeVoice(entry.voice, follow.car);
      } else if (follow.kind === 'projectile') {
        const p = race.projectiles.find((q) => q.id === follow.id);
        if (!p) {
          if (++entry.missing >= 3) this.stopKey(key);
          continue;
        }
        entry.missing = 0;
        const dt = (race.tick - p.tick) / 30;
        const x = p.x + p.vx * dt;
        const y = p.y + p.vy * dt;
        this.placeAt(entry.voice, x, y, follow.owner);
        if (p.kind === 'boomerang') {
          // Coming home: the spin rises a minor third.
          const ox = follow.owner === you ? this.lx : this.rx;
          const oy = follow.owner === you ? this.ly : this.ry;
          const homing = p.vx * (ox - x) + p.vy * (oy - y) > 0;
          const cents = homing ? 300 : 0;
          if (cents !== entry.cents) {
            entry.cents = cents;
            this.mixer.bend(entry.voice, cents);
          }
        }
      } else if (follow.kind === 'hazard') {
        const h = race.hazards.find((q) => q.id === follow.id);
        if (!h) {
          if (++entry.missing >= 3) this.stopKey(key);
          continue;
        }
        entry.missing = 0;
        this.placeAt(entry.voice, h.x, h.y, -1);
      } else this.placeAt(entry.voice, follow.x, follow.y, -1);
    }

    if (this.over) return;

    // Status loops the snapshot shows and nothing is playing for.
    for (const car of [you, other]) {
      if (car === other && !this.haveRival) continue;
      for (const status of statusOf(car)) {
        const sounds = STATUS_SOUNDS[status.family];
        if (!sounds?.loop) continue;
        const key = `status:${car}:${status.family}`;
        if (this.keyed.has(key)) continue;
        const id =
          status.family === 'grip' && this.gripSource(car) === 'frost'
            ? 'frost_crackle'
            : sounds.loop;
        this.cue({
          kind: 'play',
          id,
          car,
          key,
          ttl: Math.max(0.2, (status.untilTick - race.tick) / 30 + 0.5),
          follow: { kind: 'car', car },
        });
      }
    }

    // The lock warning, as the snapshot has it.
    const warning = race.car.combat?.lockWarning ?? 0;
    const warn = this.keyed.get('warn');
    if (warning === 0) {
      if (warn && ++this.warnMissing >= 3) this.stopKey('warn');
    } else {
      this.warnMissing = 0;
      const id = warning === 2 ? 'warn_missile' : 'warn_lock';
      if (!warn || warn.voice.recipe.id !== id) {
        if (warn) this.stopKey('warn');
        this.cue({ kind: 'play', id, car: you, key: 'warn', ttl: 30 });
      }
    }

    // Fire on the road: one loop on the nearest patch.
    let nearest = -1;
    let best = Infinity;
    for (let i = 0; i < race.hazards.length; i++) {
      const h = race.hazards[i]!;
      if (h.kind !== 'fire') continue;
      const d = Math.hypot(h.x - this.lx, h.y - this.ly);
      if (d < best) {
        best = d;
        nearest = i;
      }
    }
    const fire = this.keyed.get('fire');
    if (nearest < 0 || best > SPACE.far) {
      if (fire) this.stopKey('fire');
    } else {
      const h = race.hazards[nearest]!;
      if (fire) {
        fire.until = now + 1;
        fire.follow = { kind: 'point', x: h.x, y: h.y };
      } else
        this.cue({
          kind: 'play',
          id: 'fire_area',
          x: h.x,
          y: h.y,
          key: 'fire',
          ttl: 1,
          follow: { kind: 'point', x: h.x, y: h.y },
        });
    }
  }

  /** Drops keyed voices that have ended, and stops the ones whose time is up. */
  private expire(now: number): void {
    for (const [key, entry] of this.keyed) {
      if (entry.voice.stopped || entry.voice.end <= now) this.keyed.delete(key);
      else if (now >= entry.until) this.stopKey(key);
    }
  }

  /** Oil and frost both take grip away. Which one this is can only be read off the road. */
  private gripSource(car: number): 'frost' | 'oil' {
    const race = this.race;
    if (!race) return 'oil';
    const own = car === race.you;
    const x = own ? this.lx : this.rx;
    const y = own ? this.ly : this.ry;
    let frost = Infinity;
    let oil = Infinity;
    for (const h of race.hazards) {
      if (h.kind !== 'frost' && h.kind !== 'oil') continue;
      const d = Math.hypot(h.x - x, h.y - y) - h.radius - h.halfLength;
      if (h.kind === 'frost') frost = Math.min(frost, d);
      else oil = Math.min(oil, d);
    }
    // A frost shell striking the car freezes it before its patch is on the road.
    for (const p of race.projectiles)
      if (p.kind === 'frost' && p.owner !== car) frost = Math.min(frost, 0);
    if (frost === Infinity && oil === Infinity) return this.recentFrost ? 'frost' : 'oil';
    return frost <= oil ? 'frost' : 'oil';
  }

  /** Ticks left during which a grip loss with nothing on the road is taken to be frost. */
  private recentFrost = false;
  private frostTick = -1000;

  onEvent(event: RaceEvent, race: RaceSnapshot | null): void {
    if (race && !this.race) this.onRace(race);
    this.mapContext.you = race?.you ?? this.mapContext.you;
    if (event.type === 'shot' && event.weapon === 'weapon_frost') this.frostTick = event.tick;
    this.recentFrost = event.tick - this.frostTick < 45;
    if (
      event.type === 'lap' &&
      event.car === this.mapContext.you &&
      event.lap === this.mapContext.laps - 1
    )
      this.music.setIntensity('final');
    if (event.type === 'finish' && event.car === this.mapContext.you) {
      this.musicDone = true;
      this.music.stop();
    }
    if (event.type === 'result') {
      // The race is over: every loop stops, the music makes room for the stinger.
      this.over = true;
      this.musicDone = true;
      this.music.stop();
      for (const key of [...this.keyed.keys()]) this.stopKey(key);
    }
    const when = this.eventTime(event.tick);
    for (const cue of cuesForEvent(event, this.mapContext)) this.cue(cue, when);
  }

  /**
   * When an event should be heard. Events of several ticks can arrive in one go (a slow frame,
   * a network patch); played on arrival, a five-round burst would collapse into one or two
   * cracks. Each event is placed by its own tick instead, 33 ms apart, on a clock that is
   * re-anchored to "now" whenever it would be late or more than a quarter second early. On
   * time, this is simply now.
   */
  private eventTime(tick: number): number {
    const now = this.ctx.currentTime;
    const at = tick / 30 + this.tickOffset;
    if (at < now || at > now + 0.25) {
      this.tickOffset = now - tick / 30;
      return now;
    }
    return at;
  }

  private tickOffset = -Infinity;

  onReset(): void {
    for (const key of [...this.keyed.keys()]) this.stopKey(key, 0.02);
    this.keyed.clear();
    this.music.stop();
    this.mixer.stopBuses(['weapons', 'impacts', 'ambience', 'alerts', 'engine'], 0.02);
    this.ownEngine?.dispose();
    this.rivalEngine?.dispose();
    this.tires?.dispose();
    this.ownEngine = null;
    this.rivalEngine = null;
    this.tires = null;
    this.mixer.resetLimits();
    this.race = null;
    this.context = null;
    this.rivalJson = '';
    this.prevPhase = null;
    this.prevBurst = 0;
    this.prevHeat = 0;
    this.prevLimited = false;
    this.prevBattery = -1;
    this.prevReserve = 0;
    this.warnMissing = 0;
    this.over = false;
    this.musicDone = false;
    this.lastFrameAt = -10;
    this.lastThumpAt = -10;
    this.frostTick = -1000;
    this.recentFrost = false;
    this.haveRival = false;
    this.tickOffset = -Infinity;
  }

  // --- Cues --------------------------------------------------------------------------------

  private stopKey(key: string, release?: number): void {
    const entry = this.keyed.get(key);
    if (!entry) return;
    this.mixer.stop(entry.voice, release);
    this.keyed.delete(key);
  }

  private placeVoice(voice: Voice, car: number): void {
    if (car === this.mapContext.you) this.mixer.place(voice, 1, 0);
    else this.placeAt(voice, this.rx, this.ry, car);
  }

  private placeAt(voice: Voice, x: number, y: number, car: number): void {
    const source = car === this.mapContext.you ? 'own' : car >= 0 ? 'rival' : 'world';
    const at = place(this.lx, this.ly, x, y, source, this.spot);
    this.mixer.place(voice, at.gain, at.pan);
  }

  private readonly spot: Placement = { gain: 1, pan: 0 };

  /** Plays or stops what a cue asks for. `when` is a context time, now when left out. */
  cue(cue: Cue, when?: number): Voice | null {
    if (cue.kind === 'stop') {
      if (cue.prefix) {
        for (const key of [...this.keyed.keys()]) if (key.startsWith(cue.key)) this.stopKey(key);
      } else this.stopKey(cue.key);
      return null;
    }
    return this.playCue(cue, when);
  }

  private playCue(cue: PlayCue, when?: number): Voice | null {
    // A heavy chassis against a wall has its own, lower thump, whoever is driving it.
    const id =
      cue.id === 'wall_thump' &&
      (cue.car === this.mapContext.you ? this.own : this.rival).chassisKey === 'chassis_heavy'
        ? 'wall_thump_heavy'
        : cue.id;
    const recipe = SFX[id];
    if (!recipe) return null;
    if (this.gate && !this.gate()) return null;
    const now = this.ctx.currentTime;
    const you = this.mapContext.you;
    const own = cue.car === you;
    if (cue.dedupe === 'wall' && now - this.lastThumpAt < 0.3) return null;

    let distance = 0;
    const at = this.spot;
    at.gain = 1;
    at.pan = 0;
    if (!own) {
      const x = cue.x ?? (cue.car !== undefined ? this.rx : this.lx);
      const y = cue.y ?? (cue.car !== undefined ? this.ry : this.ly);
      distance = Math.hypot(x - this.lx, y - this.ly);
      place(this.lx, this.ly, x, y, cue.car !== undefined ? 'rival' : 'world', at);
      // Too far to hear: not worth a voice.
      if (at.gain < 0.015) return null;
    }

    if (cue.key) {
      const existing = this.keyed.get(cue.key);
      if (existing && !existing.voice.stopped && existing.voice.end > now) {
        if (existing.voice.recipe.id === id && recipe.loop) {
          // The same loop asked for again (a status strengthened): keep it, extend it.
          existing.until = Math.max(existing.until, now + (cue.ttl ?? 30));
          return existing.voice;
        }
        this.stopKey(cue.key);
      }
    }

    let gain = cue.gain ?? 1;
    if (this.levels.reducedIntensity && LOUD.has(recipe.cat)) gain *= 0.6;
    const options: Parameters<Mixer['play']>[1] = {
      gain,
      place: at.gain,
      pan: at.pan,
      limitKey: own ? 'own' : cue.car !== undefined ? 'rival' : 'world',
    };
    if (cue.pitch !== undefined) options.pitch = cue.pitch;
    if (cue.stretch !== undefined) options.stretch = cue.stretch;
    if (cue.burst) options.burst = true;
    if (when !== undefined) options.when = when;
    const voice = this.mixer.play(id, options);
    if (!voice) return null;
    if (cue.key)
      this.keyed.set(cue.key, {
        voice,
        until: now + (cue.ttl ?? 30),
        follow: cue.follow ?? null,
        missing: 0,
        cents: 0,
      });
    if (cue.haptic) this.vibrate(cue.haptic, own, distance);
    return voice;
  }

  private vibrate(kind: HapticKind, own: boolean, distance: number): void {
    if (own) haptic(kind, 1);
    else if (kind === 'explosion' && distance < 140) haptic(kind, 1 - distance / 200);
  }

  // --- Driving -----------------------------------------------------------------------------

  private makeEngine(key: string, own: boolean): EngineVoice | null {
    const recipe = engineRecipe(key) ?? engineRecipe(DEFAULT_ENGINE_KEY);
    if (!recipe) return null;
    const extra = (name: EngineExtra, gain: number) => {
      const cue: PlayCue = { kind: 'play', id: name, gain };
      if (own) cue.car = this.mapContext.you;
      else cue.car = this.mapContext.you === 0 ? 1 : 0;
      this.cue(cue);
    };
    return new EngineVoice(
      this.mixer.res,
      recipe,
      this.mixer.input('engine'),
      this.mixer.ledger,
      extra,
    );
  }

  private driveOwn(tau: number): void {
    if (!this.ownEngine) this.ownEngine = this.makeEngine(this.own.engineKey, true);
    // Tire noise is an effect, not engine: it follows the Effects slider.
    if (!this.tires)
      this.tires = new TireVoice(this.mixer.res, this.mixer.input('impacts'), this.mixer.ledger);
    const io = this.inputOwn;
    io.gain = 1;
    io.pan = 0;
    this.ownEngine?.update(io, tau);
    this.tires.update(
      this.frameSlip,
      this.frameSpeed,
      this.surface,
      this.own.tireKey,
      this.context?.wet ?? false,
      io.active,
    );
  }

  /** Every frame, from the race scene: the predicted car. Speeds are world pixels a second. */
  frame(
    forwardSpeed: number,
    throttle: number,
    slipRatio: number,
    topSpeed: number,
    active: boolean,
  ): void {
    const began = this.profile ? performance.now() : 0;
    const now = this.ctx.currentTime;
    this.lastFrameAt = now;
    if (topSpeed > 0) this.topSpeed = topSpeed;
    const io = this.inputOwn;
    io.speedShare = Math.abs(forwardSpeed) / this.topSpeed;
    io.throttle = throttle;
    io.active = active;
    this.frameSpeed = Math.abs(forwardSpeed);
    this.frameSlip = slipRatio;
    this.driveOwn(0.035);
    if (this.profile) this.profile.add(performance.now() - began);
  }

  /** The player's car struck a wall. `severity` is 0 to 1. */
  thump(severity: number): void {
    const s = clamp(severity, 0, 1);
    this.lastThumpAt = this.ctx.currentTime;
    this.cue({
      kind: 'play',
      id: 'wall_thump',
      car: this.mapContext.you,
      gain: 0.45 + 0.55 * s,
    });
    haptic('collision', 0.4 + 0.6 * s);
  }

  /** Countdown lights, and GO. */
  beep(go: boolean): void {
    if (this.gate && !this.gate()) return;
    this.mixer.play(go ? 'race_go' : 'race_count');
    haptic(go ? 'go' : 'count');
  }

  // --- Interface ---------------------------------------------------------------------------

  /** An interface sound. For `install`, `detail` is the part id and the part answers itself. */
  ui(kind: UiSoundKind, detail?: string): void {
    if (kind === 'install' && detail) {
      const sound = partSound(detail);
      if (sound) {
        this.mixer.play(sound.install.id, { pitch: sound.install.pitch });
        if (sound.engineKey) this.previewEngine(sound.engineKey);
        haptic('install');
        return;
      }
    }
    this.mixer.play(UI_SOUNDS[kind]);
    if (kind === 'ready' || kind === 'confirm') haptic('tap');
  }

  /** Half a second of an engine, for the garage: a blip of the throttle. */
  previewEngine(key: string): void {
    const recipe = engineRecipe(key);
    if (!recipe || typeof window === 'undefined') return;
    this.preview?.dispose();
    const voice = new EngineVoice(
      this.mixer.res,
      recipe,
      this.mixer.input('ui'),
      this.mixer.ledger,
    );
    this.preview = voice;
    const input = blankInput();
    input.active = true;
    input.gain = 0.8;
    const steps: Array<[number, number, number, number]> = [
      [120, 0.05, 1, 0.3],
      [300, 0.2, 1, 0.8],
      [480, 0.12, 0, 0.5],
    ];
    for (const [ms, share, throttle, spool] of steps)
      window.setTimeout(() => {
        input.speedShare = share;
        input.throttle = throttle;
        input.spool = spool;
        voice.update(input, 0.05);
      }, ms);
    window.setTimeout(() => {
      voice.dispose();
      if (this.preview === voice) this.preview = null;
    }, 760);
  }

  // --- Housekeeping ------------------------------------------------------------------------

  /** Called a few times a second when no race is feeding the system: frees finished voices. */
  tick(): void {
    const now = this.ctx.currentTime;
    this.expire(now);
    this.mixer.sweep(now);
    this.music.pump(now + MUSIC_LOOKAHEAD);
  }

  /** Drops everything that is sounding, at once, without forgetting the race (tab hidden). */
  silence(): void {
    for (const key of [...this.keyed.keys()]) this.stopKey(key, 0.02);
    this.mixer.stopBuses(
      ['weapons', 'impacts', 'ambience', 'alerts', 'ui', 'music', 'engine'],
      0.02,
    );
  }

  get keys(): string[] {
    return [...this.keyed.keys()];
  }

  stats() {
    const ledger = this.mixer.ledger;
    return {
      nodes: {
        fixed: ledger.fixed,
        engine: ledger.engine,
        voices: ledger.voices,
        music: ledger.music,
        total: ledger.total,
      },
      gains: this.mixer.gains(),
      race: this.race
        ? { tick: this.race.tick, phase: this.race.phase, raceTimeMs: this.race.raceTimeMs }
        : null,
      voices: this.mixer.activeVoices,
      fading: this.mixer.fadingVoices,
      peakVoices: this.mixer.peakVoices,
      peakMusic: this.mixer.peakMusic,
      keys: this.keys,
      engine: this.ownEngine
        ? { key: this.ownEngine.recipe.key, rpm: this.ownEngine.rpm, hz: this.ownEngine.firingHz }
        : null,
      rivalEngine: this.rivalEngine ? this.rivalEngine.recipe.key : null,
      tires: this.tires ? { skid: this.tires.skid, rumble: this.tires.rumble } : null,
      surface: this.surface,
      music: { playing: this.music.isPlaying, intensity: this.music.currentIntensity },
      frameCost: this.profile ? this.profile.report() : null,
      caps: CAPS,
    };
  }
}

/** Milliseconds spent in the per-frame audio update: count, mean and worst. */
export class FrameProfile {
  private count = 0;
  private total = 0;
  private worst = 0;

  add(ms: number): void {
    this.count++;
    this.total += ms;
    if (ms > this.worst) this.worst = ms;
  }

  report(): { frames: number; meanMs: number; worstMs: number } {
    return {
      frames: this.count,
      meanMs: this.count > 0 ? this.total / this.count : 0,
      worstMs: this.worst,
    };
  }
}

function blankInput(): EngineInput {
  return {
    speedShare: 0,
    throttle: 0,
    spool: 0,
    clock: 0,
    active: false,
    stutter: 0,
    gain: 1,
    pan: 0,
  };
}

function hasStatus(statuses: readonly StatusSnapshot[], family: string): boolean {
  for (const status of statuses) if (status.family === family) return true;
  return false;
}
