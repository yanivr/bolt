import type {
  BuildConditions,
  ControlInput,
  MountedPartSprite,
  CarSnapshot,
  DriveSession,
  InputSample,
  RaceEvent,
  RaceSnapshot,
  ResolvedBuild,
  TerrainAnimatedProp,
  TerrainOverlay,
  VehicleLoadout,
  VehicleParams,
  WeatherAtlasManifest,
} from '@bolt/shared';
import { CATALOG, getWeatherPreset } from '@bolt/content';
import {
  MAX_INPUTS_PER_PACKET,
  MPH_PER_WORLD_SPEED,
  NOMINAL_TOP_SPEED,
  SIM_DT,
  anchorToWorld,
  angleDelta,
  bendAhead,
  blueprintSchema,
  hazardState,
  clamp,
  createDriverScratch,
  driveCenterline,
  engineSheetFor,
  isWrongWay,
  lapPosition,
  lerp,
  mulberry32,
  resolveBlueprint,
  wrapAngle,
} from '@bolt/shared';
import Phaser from 'phaser';
import { debugEnabled } from '../../app/flags.js';
import { useApp, useHud } from '../../app/store.js';
import type { DriveInput } from '../../input/driveInput.js';
import type { DriveLink } from '../../network/link.js';
import { raceFeed } from '../raceFeed.js';
import { Predictor } from '../../network/prediction.js';
import type { GameManifests } from '../assets.js';
import type { EngineAudio } from '../audio/EngineAudio.js';
import { CarView } from '../composition/CarView.js';
import { createPaintedBody } from '../composition/paint.js';
import { Effects } from '../particles/Effects.js';
import type { CameraDistance, SimPose } from '../rendering/frame.js';
import { BodyMotion, RenderPipeline, chunksInView } from '../rendering/frame.js';
import { CombatView, FX_TEXTURE } from '../combat/CombatView.js';
import '../debugHook.js';
import { CombatStage } from '../combat/stage.js';
import { LAYOUT_RESOLUTION, layoutChunks } from '../layout/layoutCanvas.js';
import { runStress } from '../combat/stress.js';
import { FxAtlas } from '../vfx/atlas.js';
import { QualityGovernor, setVfxQuality, vfxQualitySetting } from '../vfx/quality.js';
import type { RivalSprites } from './rivalSheets.js';
// Weather and environment layer (Milestone D): cosmetic, see docs/VFX_GUIDE.md "Weather".
import { WeatherAtlas } from '../weather/atlas.js';
import { collectCombatLights } from '../weather/lights.js';
import { reducedMotionPreferred } from '../weather/motion.js';
import { easeOverlay, overlayTarget } from '../weather/overlayFade.js';
import type { OverlayCoverage } from '../weather/overlayFade.js';
import { coverageOfTexture, isTimetableLoop, timetableFrame } from '../weather/terrainArt.js';
import { LightList, WeatherStage } from '../weather/stage.js';
import { WX_MANIFEST, WX_TEXTURE, WeatherView } from '../weather/view.js';
import { carTextureKeys, rivalSheets } from './rivalSheets.js';

export type RaceSceneConfig = {
  manifests: GameManifests;
  session: DriveSession;
  link: DriveLink;
  loadout: VehicleLoadout;
  /** Mounted accessories that have art, positioned for the compositor. */
  parts: MountedPartSprite[];
  /** The local car's build and race conditions, so prediction can follow part failures. */
  build: ResolvedBuild;
  conditions: BuildConditions;
  /** The other car: its art, and its body for predicting contact. Null when it cannot be drawn. */
  rival: (RivalSprites & { params: VehicleParams }) | null;
  /** Showcase scenarios: the local car's controls come from here instead of the driver. */
  script: ((session: DriveSession) => ControlInput) | null;
  input: DriveInput;
  audio: EngineAudio;
  /** Development aid: a centerline driver replaces the controls for capture and soak runs. */
  autopilot: boolean;
  /**
   * Whole canvas pixels per world pixel, and the `Camera` setting it came from. Owned by the
   * game shell, which also sizes the canvas and changes these in place when the setting does.
   */
  view: { scale: number; distance: CameraDistance; filter: 'pixelated' | 'smooth' };
  onLoadProgress: (fraction: number) => void;
  onLoadError: () => void;
  onReady: () => void;
};

const HUD_INTERVAL_MS = 80;
const SURFACE_SMOKE: Record<string, number> = {
  asphalt: 0xdfe4ee,
  cobble: 0xd6c8b8,
  sand: 0xe0c58f,
  dirt: 0xb99a72,
  mud: 0x8a6a4a,
  snow: 0xf4f8ff,
  ice: 0xd8f0ff,
  metal: 0xc8d2e0,
};

export class RaceScene extends Phaser.Scene {
  private cfg!: RaceSceneConfig;
  private predictor!: Predictor;
  private pipeline = new RenderPipeline();
  private body = new BodyMotion();
  private car!: CarView;
  private effects!: Effects;
  private overlays: Array<{
    def: TerrainOverlay;
    image: Phaser.GameObjects.Image;
    /** Where its pixels are, read from the texture the first time a car comes near. */
    coverage?: OverlayCoverage | null;
  }> = [];
  /** Terrain loops that follow a hazard's timetable: their frame comes from the race clock. */
  private timetableLoops: Array<{
    sprite: Phaser.GameObjects.Sprite;
    anim: TerrainAnimatedProp;
    frame: number;
  }> = [];
  /** Timed hazards over the layout view: drawn by the scene while there is no art for them. */
  private layoutHazards: Phaser.GameObjects.Graphics | null = null;
  private outbox: InputSample[] = [];
  private lastSendMs = 0;
  private lastHudMs = 0;
  private roll = 0;
  private exhaustTimer = 0;
  private tickCount = 0;
  private rng = mulberry32(90210);
  private lastCountdown = -1;
  private lastPhase = '';
  private fpsSmooth = 60;
  private idleClock = 0;
  /** Forward acceleration over the last simulated tick, for body squat and dive. */
  private forwardAccel = 0;
  private scratchPose: SimPose = { x: 0, y: 0, heading: 0, vx: 0, vy: 0 };
  private readonly ownPose = {
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
  private driverScratch = createDriverScratch();
  private stage!: CombatStage;
  private combat: CombatView | null = null;
  private readonly governor = new QualityGovernor();
  private rivalIndex = 1;
  private rivalRigged = false;
  /** Manual clock for frame-exact captures: the race advances only when asked to. */
  private manual = false;
  private manualPending = 0;
  private virtualTime = 0;
  private stress = false;
  private frameMsPeak = 0;
  private race: RaceSnapshot | null = null;
  private readonly buttons = { fire: 0, use: 0 };
  private readonly control: ControlInput = { steer: 0, brake: 0, coast: true, fire: 0, use: 0 };
  private eventCount = 0;
  private lastEvent = '';
  // --- Weather layer (Milestone D) ---
  private weather: WeatherStage | null = null;
  private weatherView: WeatherView | null = null;
  private readonly wxLights = new LightList();
  private readonly fadeOwn = { present: true, x: 0, y: 0 };
  private readonly fadeRival = { present: false, x: 0, y: 0 };

  constructor() {
    super('race');
  }

  init(data: RaceSceneConfig): void {
    this.cfg = data;
    this.predictor = new Predictor(data.session);
    this.predictor.setBuild(data.build, data.conditions);
    this.predictor.setRivalBody(data.rival ? data.rival.params : null);
  }

  preload(): void {
    const { manifests, loadout } = this.cfg;
    this.load.on('progress', (value: number) => this.cfg.onLoadProgress(value));
    this.load.on('loaderror', () => this.cfg.onLoadError());

    const chassis = manifests.cars.chassis[loadout.chassisId]!;
    const sheet = (
      key: string,
      base: string,
      ref: { file: string; frameWidth: number; frameHeight: number },
    ) =>
      this.load.spritesheet(key, `${base}/${ref.file}`, {
        frameWidth: ref.frameWidth,
        frameHeight: ref.frameHeight,
      });
    sheet(`car:${chassis.id}:body`, manifests.carsBase, chassis.body);
    sheet(`car:${chassis.id}:shadow`, manifests.carsBase, chassis.shadow);
    sheet(`car:${chassis.id}:brake`, manifests.carsBase, chassis.brakeLights);
    sheet(`car:${chassis.id}:head`, manifests.carsBase, chassis.headlights);
    sheet(
      `wheel:${loadout.tireKitId}`,
      manifests.carsBase,
      manifests.cars.wheels[loadout.tireKitId]!.sheet,
    );
    sheet(
      `engine:${loadout.engineId}:${chassis.engineInBay ? 'bay' : 'tail'}`,
      manifests.carsBase,
      engineSheetFor(chassis, manifests.cars.engines[loadout.engineId]!),
    );
    for (const partId of new Set(this.cfg.parts.map((p) => p.partId))) {
      const ref = manifests.cars.parts?.[partId];
      if (ref) sheet(`part:${partId}`, manifests.carsBase, ref.sheet);
    }
    // The rival is drawn with the same compositor; its sheets load beside the local car's
    // (shared keys are simply loaded once).
    if (this.cfg.rival)
      for (const [key, ref] of rivalSheets(manifests, this.cfg.rival))
        if (!this.textures.exists(key)) sheet(key, manifests.carsBase, ref);
    for (const strip of Object.values(manifests.vfx.strips))
      sheet(`vfx:${strip.id}`, manifests.vfxBase, strip);
    // Every combat effect is in one atlas: one texture, one batch per layer.
    this.load.image(FX_TEXTURE, `${manifests.fxBase}/${manifests.fx.file}`);
    // Weather layer (Milestone D): its atlas sits beside the combat one. A missing atlas only
    // means no weather is drawn; it is not a load error for the race.
    const wxBase = manifests.fxBase.replace(/vfx_combat$/, 'vfx_weather');
    this.load.json(WX_MANIFEST, `${wxBase}/manifest.json`);
    this.load.image(WX_TEXTURE, `${wxBase}/atlas.png`);
    if (manifests.damage) {
      const wanted = new Set([loadout.chassisId, this.cfg.rival?.loadout.chassisId]);
      for (const id of wanted) {
        const ref = id ? manifests.damage.chassis[id] : undefined;
        if (id && ref) sheet(`car:${id}:overlay`, manifests.damageBase, ref);
      }
    }
    for (const chunk of manifests.terrain.ground)
      this.load.image(`ground:${chunk.col}_${chunk.row}`, `${manifests.terrainBase}/${chunk.file}`);
    for (const overlay of manifests.terrain.overlays)
      this.load.image(`over:${overlay.id}`, `${manifests.terrainBase}/${overlay.file}`);
    for (const anim of manifests.terrain.animated)
      sheet(`anim:${anim.id}`, manifests.terrainBase, anim);
  }

  create(): void {
    const { manifests, loadout, session } = this.cfg;
    this.cameras.main.setBackgroundColor('#151C2C');

    // A track whose terrain is not baked yet is drawn in the layout view: flat shapes from its
    // data, labelled as such (development and `?debug=1` builds only offer it).
    if (manifests.terrainArt === 'layout') {
      layoutChunks(session.track).forEach((chunk, k) => {
        const key = `layout:${session.track.def.id}:${k}`;
        if (!this.textures.exists(key)) this.textures.addCanvas(key, chunk.canvas);
        this.add
          .image(chunk.x, chunk.y, key)
          .setOrigin(0, 0)
          .setScale(1 / LAYOUT_RESOLUTION)
          .setDepth(0);
      });
      if (
        session.track.crossings.length > 0 ||
        session.track.hazards.some((h) => h.kind === 'steam_vent')
      )
        this.layoutHazards = this.add.graphics().setDepth(1);
    }
    // Nothing rotates and the scale is a whole number, so every chunk lands exactly on the
    // device pixel grid at its authored size. No overlap is needed to hide seams.
    for (const chunk of manifests.terrain.ground) {
      this.add
        .image(chunk.x, chunk.y, `ground:${chunk.col}_${chunk.row}`)
        .setOrigin(0, 0)
        .setDepth(0);
    }

    for (const anim of manifests.terrain.animated) {
      const key = `anim:${anim.id}`;
      if (!this.anims.exists(key)) {
        this.anims.create({
          key,
          frames: this.anims.generateFrameNumbers(key, { start: 0, end: anim.frameCount - 1 }),
          frameRate: anim.fps,
          repeat: -1,
        });
      }
      const sprite = this.add
        .sprite(anim.x, anim.y, key)
        .setOrigin(0, 0)
        .setDepth(anim.above ? 60 : 8);
      if (anim.blend === 'add') sprite.setBlendMode(Phaser.BlendModes.ADD);
      // A crossing's boom or a vent's blast is drawn from the race clock, so the picture is
      // down exactly when the physics is (ART_GUIDE, "Timetable loops"); ambient loops play.
      if (isTimetableLoop(anim)) {
        sprite.setFrame(0);
        this.timetableLoops.push({ sprite, anim, frame: 0 });
      } else sprite.play(key);
    }

    const cone = () =>
      this.add
        .image(0, 0, 'vfx:headlight_cone')
        .setOrigin(0.5, 1)
        .setDepth(20)
        .setBlendMode(Phaser.BlendModes.ADD);

    this.effects = new Effects(this, manifests.vfx);

    for (const def of manifests.terrain.overlays) {
      const image = this.add.image(def.x, def.y, `over:${def.id}`).setOrigin(0, 0).setDepth(70);
      this.overlays.push({ def, image });
    }

    // One world camera draws everything. Each car is placed in world space on the same device
    // pixel grid as the ground and is drawn from authored heading frames, never rotated.
    const build = (sprites: RivalSprites): CarView | null => {
      const chassis = manifests.cars.chassis[sprites.loadout.chassisId];
      const wheels = manifests.cars.wheels[sprites.loadout.tireKitId];
      const engine = manifests.cars.engines[sprites.loadout.engineId];
      if (!chassis || !wheels || !engine) return null;
      const paint = manifests.cars.paints[sprites.loadout.paintId];
      const keys = carTextureKeys(manifests, sprites);
      if (paint) keys.body = createPaintedBody(this, keys.body, chassis, paint);
      if (!keys.overlay || !this.textures.exists(keys.overlay)) delete keys.overlay;
      return new CarView(this, chassis, wheels, engine, keys, sprites.parts);
    };
    this.car = build({ loadout, parts: this.cfg.parts })!;
    const rivalView = this.cfg.rival ? build(this.cfg.rival) : null;

    // The combat presentation: a pure stage that turns snapshots and events into pooled
    // sprites and pixel shapes, and a view that copies them onto Phaser objects.
    const query = new URLSearchParams(window.location.search);
    const debug = debugEnabled();
    this.stage = new CombatStage(new FxAtlas(manifests.fx), manifests.cars, {
      kick: (pixels, seconds) => this.pipeline.camera.kick(pixels, seconds),
      skid: (x, y, rotation, heavy) => this.effects.skid(x, y, rotation, heavy),
      exhaust: (x, y, vx, vy) => this.effects.exhaust(x, y, vx, vy),
    });
    this.stage.setCar(0, this.cfg.build);
    const views: Array<CarView | null> = [this.car, rivalView];
    this.combat = new CombatView(this, this.stage, views, [cone(), rivalView ? cone() : null]);
    // --- Weather layer (Milestone D) ---
    const wxManifest = this.cache.json.get(WX_MANIFEST) as WeatherAtlasManifest | undefined;
    // The Section 19.5 stress scenario runs in the heaviest weather there is.
    const wxStress = debug && query.get('vfxStress') === '1';
    const preset = getWeatherPreset(wxStress ? 'forest_heavy_rain' : manifests.course.presetId);
    // `?debug=1&weather=0` leaves the layer out, to measure what it costs.
    const wxOff = debug && query.get('weather') === '0';
    if (wxManifest && preset && !wxOff && this.textures.exists(WX_TEXTURE)) {
      this.weather = new WeatherStage(new WeatherAtlas(wxManifest), session.track, preset, {
        lamps: manifests.terrain.lights,
        reducedMotion: reducedMotionPreferred(),
      });
      this.weatherView = new WeatherView(this, this.weather);
    }
    if (debug) {
      this.manual = query.get('manual') === '1';
      this.stress = query.get('vfxStress') === '1';
      const quality = query.get('vfx');
      if (quality === 'high' || quality === 'low' || quality === 'auto') setVfxQuality(quality);
      window.__boltRace = {
        manual: this.manual,
        advance: (frames) => {
          this.manualPending += Math.max(0, Math.floor(frames));
        },
        run: (frames) => {
          if (!this.manual) return;
          for (let i = 0; i < frames; i++) {
            this.virtualTime += 1000 / 60;
            this.frame(this.virtualTime);
          }
        },
        pending: () => this.manualPending,
        raceTick: () => this.predictor.session.raceTicks,
        tick: () => this.stage.latestTick,
        stats: () => ({
          ...this.stage.stats(),
          ...(this.weather?.stats() ?? {}),
          wxDrawn: this.weatherView?.drawn ?? 0,
          wxPreset: this.weather?.preset.id ?? '',
          wxLayers: this.weather ? [...this.weather.plan.layers].join(' ') : '',
          drawn: this.combat?.drawn ?? 0,
          quality: this.stage.quality,
          setting: vfxQualitySetting(),
          frameMs: Math.round(this.governor.frameMs * 10) / 10,
          frameMsPeak: Math.round(this.frameMsPeak * 10) / 10,
          recycled: this.stage.pool.recycled,
          refused: this.stage.pool.refused,
          peak: this.stage.pool.peak.join(','),
        }),
        focus: () => {
          const a = this.stage.cars[0]!;
          const b = this.stage.cars[1]!;
          const x = b.present ? (a.x + b.x) / 2 : a.x;
          const y = b.present ? (a.y + b.y) / 2 : a.y;
          const cam = this.cameras.main;
          const css = this.scale.displayScale;
          return {
            x: ((x - cam.scrollX) * cam.zoom) / css.x,
            y: ((y - cam.scrollY) * cam.zoom) / css.y,
          };
        },
        setQuality: (value) => setVfxQuality(value),
        ownCar: () => {
          const a = this.stage.cars[this.stage.you]!;
          const cam = this.cameras.main;
          const css = this.scale.displayScale;
          return {
            x: ((a.x - cam.scrollX) * cam.zoom) / css.x,
            y: ((a.y - cam.scrollY) * cam.zoom) / css.y,
          };
        },
        view: () => {
          const scale = Math.max(1, Math.round(this.cfg.view.scale));
          const cam = this.cameras.main;
          const world = {
            worldWidth: this.scale.width / scale,
            worldHeight: this.scale.height / scale,
          };
          const x1 = cam.scrollX + world.worldWidth;
          const y1 = cam.scrollY + world.worldHeight;
          let chunks = 0;
          for (const chunk of manifests.terrain.ground)
            if (
              chunk.x < x1 &&
              chunk.x + chunk.w > cam.scrollX &&
              chunk.y < y1 &&
              chunk.y + chunk.h > cam.scrollY
            )
              chunks++;
          return {
            distance: this.cfg.view.distance,
            filter: this.cfg.view.filter,
            scale,
            widthPx: this.scale.width,
            heightPx: this.scale.height,
            ...world,
            cssPerWorld:
              (scale * this.game.canvas.getBoundingClientRect().width) / this.scale.width,
            scrollX: cam.scrollX,
            scrollY: cam.scrollY,
            chunks,
            chunksMax: chunksInView(world, manifests.terrain.chunkSize),
            chunksTotal: manifests.terrain.ground.length,
          };
        },
      };
    }

    this.pipeline.place(this.readPose());

    this.cfg.link.onSnapshot = (snapshot) => this.onSnapshot(snapshot);
    this.cfg.link.onRace = (race) => this.onRace(race);
    this.cfg.link.onEvent = (event) => this.onRaceEvent(event);
    this.cfg.link.onStatus = (status) => useHud.setState({ linkStatus: status });
    useHud.setState({
      linkMode: this.cfg.link.mode,
      linkStatus: 'connected',
      laps: session.track.def.laps,
      finished: false,
      phase: session.phase,
      hasSteered: false,
      hasBraked: false,
    });

    this.scale.on('resize', this.layout, this);
    this.layout();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.layout, this);
      raceFeed.reset();
      this.cfg.link.onSnapshot = null;
      this.cfg.link.onRace = null;
      this.cfg.link.onEvent = null;
      this.cfg.link.onStatus = null;
      this.combat?.destroy();
      this.combat = null;
      this.weatherView?.destroy();
      this.weatherView = null;
      this.weather = null;
      if (window.__boltRace) delete window.__boltRace;
    });
    this.cfg.onReady();
  }

  /** Crossing barriers and steam vents in the layout view, from the race clock. */
  private drawLayoutHazards(session: DriveSession): void {
    const g = this.layoutHazards!;
    g.clear();
    const clock = session.raceTicks;
    for (const h of session.track.hazards) {
      const state = hazardState(h, clock);
      if (h.kind === 'crossing') {
        const color = state.phase === 'idle' ? 0x7d828c : 0xe8433a;
        if (state.phase === 'active') {
          g.lineStyle(h.thickness, 0xe8433a, 1);
          g.lineBetween(h.a.x, h.a.y, h.b.x, h.b.y);
        }
        const blink = state.phase === 'idle' || Math.floor(state.periodTime * 3) % 2 === 0;
        g.fillStyle(color, blink ? 1 : 0.35);
        for (const l of h.lights) g.fillCircle(l.x, l.y, 7);
      } else if (h.kind === 'steam_vent' && h.shape.type === 'circle' && state.phase !== 'idle') {
        g.fillStyle(0xe9f2ff, state.phase === 'active' ? 0.75 : 0.25);
        g.fillCircle(h.shape.x, h.shape.y, h.shape.radius);
      }
    }
  }

  /** The predicted car as the render pipeline wants it. The returned object is reused. */
  private readPose(): SimPose {
    const m = this.predictor.session.motion;
    const pose = this.scratchPose;
    pose.x = m.x;
    pose.y = m.y;
    pose.heading = m.headingRad;
    pose.vx = m.velocityX;
    pose.vy = m.velocityY;
    return pose;
  }

  private layout(): void {
    const scale = Math.max(1, Math.round(this.cfg.view.scale));
    const def = this.predictor.session.track.def;
    this.pipeline.configure({
      widthPx: this.scale.width,
      heightPx: this.scale.height,
      scale,
      worldWidth: def.worldWidth,
      worldHeight: def.worldHeight,
    });
    const cam = this.cameras.main;
    // Origin at the corner makes the camera transform exactly (world - scroll) * scale.
    cam.setOrigin(0, 0);
    cam.setZoom(scale);
    cam.setRotation(0);
  }

  private onSnapshot(snapshot: CarSnapshot): void {
    const session = this.predictor.session;
    const m = session.motion;
    const bx = m.x;
    const by = m.y;
    const bh = m.headingRad;
    const wasCountdown = session.phase === 'COUNTDOWN';
    this.predictor.reconcile(snapshot);
    if (session.phase === 'COUNTDOWN' && !wasCountdown) {
      // The car was put back on the grid: show it there, do not slide it across the map.
      this.predictor.clearError();
      this.pipeline.place(this.readPose());
      this.body.reset();
      return;
    }
    // Carry the interpolation endpoints along with the correction; the predictor's decaying
    // error offset is what the player actually sees, so nothing pops.
    this.pipeline.poses.rebase(this.readPose(), m.x - bx, m.y - by, angleDelta(bh, m.headingRad));
  }

  /** The race around the local car: the rival, projectiles, hazards and standings. */
  private onRace(race: RaceSnapshot): void {
    this.race = race;
    this.predictor.setRival(race.rival, race.tick);
    this.rigCars(race);
    this.stage.onRace(race);
    raceFeed.publishRace(race, performance.now());
  }

  private onRaceEvent(event: RaceEvent): void {
    // Lap and finish events now come for both cars; only the local car's end the local race.
    if (event.type === 'finish' && event.car === (this.race?.you ?? 0))
      useHud.setState({ finished: true });
    if (event.type === 'result') useHud.setState({ finished: true });
    this.stage.onEvent(event);
    raceFeed.publishEvent(event);
    this.eventCount++;
    if (event.type !== 'checkpoint' && event.type !== 'position') this.lastEvent = event.type;
  }

  /**
   * Gives the stage each car's rig the first time the race says who is who. The local car's
   * build is known from the start; the rival's comes with the snapshot as canonical JSON.
   */
  private rigCars(race: RaceSnapshot): void {
    if (this.rivalRigged) return;
    this.rivalRigged = true;
    this.rivalIndex = race.you === 0 ? 1 : 0;
    this.stage.setCar(race.you, this.cfg.build);
    let rival = null;
    try {
      const parsed = blueprintSchema.safeParse(JSON.parse(race.rivalBlueprint));
      if (parsed.success) rival = resolveBlueprint(parsed.data, CATALOG);
    } catch {
      rival = null;
    }
    this.stage.setCar(this.rivalIndex, this.cfg.rival ? rival : null);
    if (race.you !== 0) this.combat?.swapCars();
  }

  /** Puts the car back on the grid for another run. */
  restart(): void {
    this.predictor.clearPending();
    this.outbox.length = 0;
    this.effects.clear();
    this.stage.clear();
    this.weather?.clear();
    raceFeed.reset();
    this.race = null;
    this.cfg.link.resetCar();
    this.pipeline.camera.cut();
    useHud.setState({ finished: false });
  }

  override update(time: number): void {
    if (!this.manual) {
      this.frame(time);
      return;
    }
    // Manual clock: every queued frame is a whole 60 Hz step, and nothing moves in between,
    // so a capture tool can stop on any frame of any effect.
    if (this.manualPending <= 0) {
      this.frame(this.virtualTime);
      return;
    }
    const batch = Math.min(this.manualPending, 240);
    for (let i = 0; i < batch; i++) {
      this.virtualTime += 1000 / 60;
      this.frame(this.virtualTime);
    }
    this.manualPending -= batch;
  }

  private frame(time: number): void {
    const app = useApp.getState();
    const settings = app.settings;
    const session = this.predictor.session;
    const input = this.cfg.input;
    input.mode = settings.steering;
    // Solo and offline sessions simply stop sampling while the menu is open. An online race
    // keeps running on the server, so the car receives neutral input instead. While the
    // authority holds the race on the grid (both players loading), nothing is predicted.
    const frozen = (app.paused && this.cfg.link.mode === 'offline') || this.cfg.link.held === true;
    input.enabled = !app.paused;

    const steps = this.pipeline.begin(time, frozen);
    for (let i = 0; i < steps; i++) this.simulate();

    const m = session.motion;
    const t = session.telemetry;
    const dt = this.pipeline.frameDt;
    this.predictor.decayError(dt);
    const view = this.pipeline.finish(
      this.predictor.errorX,
      this.predictor.errorY,
      this.predictor.errorHeading,
      settings.cameraShake,
    );
    this.cameras.main.setScroll(view.scrollX, view.scrollY);
    this.effects.update(dt);
    if (this.layoutHazards) this.drawLayoutHazards(session);
    for (const loop of this.timetableLoops) {
      const frame = timetableFrame(loop.anim, session.raceTicks * SIM_DT);
      if (frame !== loop.frame) {
        loop.frame = frame;
        loop.sprite.setFrame(frame);
      }
    }

    // --- Car pose ------------------------------------------------------------------------------
    const speed = t.speed;
    this.roll += dt * clamp(Math.abs(t.forwardSpeed) / 6, 0, 18) * Math.sign(t.forwardSpeed || 1);
    this.idleClock += dt;
    this.body.update(dt, m.yawRate * t.forwardSpeed, this.forwardAccel, speed, this.idleClock);
    const heading = view.pose.heading;
    const x = view.pose.x;
    const y = view.pose.y;

    // --- Combat presentation: the rival, everything in flight and on the road, every effect ----
    const scale = Math.max(1, Math.round(this.cfg.view.scale));
    const stage = this.stage;
    stage.scale = scale;
    stage.reduceFlashes = settings.reduceFlashes;
    stage.viewX0 = view.scrollX;
    stage.viewY0 = view.scrollY;
    stage.viewX1 = view.scrollX + this.scale.width / scale;
    stage.viewY1 = view.scrollY + this.scale.height / scale;
    if (dt > 0 && !this.manual) {
      stage.setQuality(this.governor.update(dt));
      this.frameMsPeak = Math.max(this.frameMsPeak * 0.995, dt * 1000);
    } else stage.setQuality(vfxQualitySetting() === 'low' ? 'low' : 'high');
    const own = this.ownPose;
    own.x = view.carX;
    own.y = view.carY;
    own.heading = heading;
    own.frameHeading = view.frameHeading;
    own.vx = view.pose.vx;
    own.vy = view.pose.vy;
    own.steer = m.steeringInput;
    own.braking = m.brakeInput > 0.3 || m.reversing;
    own.roll = this.roll;
    own.bodyShiftX = this.body.shiftX;
    own.bodyShiftY = this.body.shiftY;
    // A race run in the page is shown exactly one tick behind its newest snapshot, in step
    // with the local car's own interpolation; a server race is paced from snapshot arrivals.
    const alpha = this.cfg.link.mode === 'offline' ? (frozen ? 1 : this.pipeline.clock.alpha) : -1;
    if (this.stress && !frozen) runStress(stage, dt, x, y);
    stage.frame(frozen ? 0 : dt, own, alpha);
    this.combat?.sync();

    // --- Weather layer (Milestone D): after the combat stage, which places the rival. ---
    const viewW = this.scale.width / scale;
    const viewH = this.scale.height / scale;
    if (this.weather && this.weatherView) {
      collectCombatLights(stage.pool, stage.atlas, this.wxLights);
      this.weather.frame(
        {
          dt: frozen ? 0 : dt,
          clockTicks: session.raceTicks,
          viewX: view.scrollX,
          viewY: view.scrollY,
          viewW,
          viewH,
          you: stage.you,
          reduceFlashes: settings.reduceFlashes,
          low: stage.quality === 'low',
          stress: this.stress,
        },
        stage.cars,
        this.wxLights,
      );
      this.weatherView.sync(scale, view.scrollX, view.scrollY, viewW, viewH);
    }

    // Foreground occlusion (Section 9.1), for every overlay kind the bakes mark: fades under
    // the local car and, less, under the rival (weather/overlayFade.ts).
    const rivalCar = stage.cars[stage.you === 0 ? 1 : 0]!;
    this.fadeOwn.x = x;
    this.fadeOwn.y = y;
    this.fadeRival.present = rivalCar.present;
    this.fadeRival.x = rivalCar.x;
    this.fadeRival.y = rivalCar.y;
    for (const entry of this.overlays) {
      const { def, image } = entry;
      if (!def.fadeNearPlayer) continue;
      const target = overlayTarget(def, this.fadeOwn, this.fadeRival, () => {
        // Read once; a texture that cannot be read stays null (the box is used instead).
        if (entry.coverage === undefined)
          entry.coverage = coverageOfTexture(this, `over:${def.id}`);
        return entry.coverage;
      });
      const next = easeOverlay(image.alpha, target, dt);
      if (next !== image.alpha) image.setAlpha(next);
    }

    this.cfg.audio.setVolumes(settings.engineVolume, settings.effectsVolume, settings.muted);
    this.cfg.audio.update(
      t.forwardSpeed,
      m.throttleFraction,
      t.slipRatio,
      NOMINAL_TOP_SPEED,
      !frozen && session.phase !== 'FINISHED',
    );

    this.watchPhase();
    if (dt > 0) this.fpsSmooth = this.fpsSmooth * 0.95 + (1 / dt) * 0.05;
    const now = performance.now();
    if (now - this.lastHudMs >= HUD_INTERVAL_MS) {
      this.lastHudMs = now;
      this.pushHud(x, y, heading);
    }
  }

  /** One fixed simulation step: sample the controls, predict, queue the sample for the server. */
  private simulate(): void {
    const session = this.predictor.session;
    const input = this.cfg.input;
    const source = this.cfg.script
      ? this.cfg.script(session)
      : this.cfg.autopilot && !input.touching
        ? driveCenterline(
            session.track,
            session.motion,
            session.params,
            session.env,
            this.driverScratch,
          )
        : input.sample(session.motion, session.params, session.telemetry.grip);
    // The two fire buttons and the utility buttons ride along with the driving sample. A
    // scenario's script supplies its own.
    const control = this.control;
    control.steer = source.steer;
    control.brake = source.brake;
    control.coast = source.coast;
    if (this.cfg.script) {
      control.fire = source.fire ?? 0;
      control.use = source.use ?? 0;
      control.target = source.target ?? 0;
    } else {
      input.buttons(this.buttons);
      control.fire = this.buttons.fire;
      control.use = this.buttons.use;
      control.target = 0;
    }
    const before = session.telemetry.forwardSpeed;
    const { sample } = this.predictor.step(control);
    this.forwardAccel =
      session.phase === 'COUNTDOWN' ? 0 : (session.telemetry.forwardSpeed - before) / SIM_DT;
    // Record the new state before anything can reconcile, so a correction that arrives inside
    // the flush below moves both ends of the interpolation together.
    this.pipeline.push(this.readPose());
    this.outbox.push(sample);
    // An offline link answers synchronously inside sendInputs, so flush every tick there.
    const now = performance.now();
    if (this.cfg.link.mode === 'offline' || this.outbox.length >= 2 || now - this.lastSendMs > 60)
      this.flush(now);
    this.emitEffects();
    this.tickCount++;
  }

  private flush(now: number): void {
    if (this.outbox.length === 0) return;
    this.lastSendMs = now;
    const batch = this.outbox.splice(0, MAX_INPUTS_PER_PACKET);
    this.cfg.link.sendInputs(batch);
  }

  /** Cosmetic effects for the tick that was just simulated. Never affects gameplay. */
  private emitEffects(): void {
    const session = this.predictor.session;
    const m = session.motion;
    const t = session.telemetry;
    const chassis = this.cfg.manifests.cars.chassis[this.cfg.loadout.chassisId]!;
    const rng = this.rng;
    const racing = session.phase === 'RACING';
    const tint = SURFACE_SMOKE[t.surface] ?? 0xdfe4ee;
    const travel = Math.atan2(m.velocityY, m.velocityX) + Math.PI / 2;
    const rear = chassis.wheelAnchors.filter((w) => !w.steers);
    const tick = this.tickCount;

    const sliding = t.slipRatio > 0.38 && t.speed > 70;
    const braking = m.brakeInput > 0.6 && t.speed > 80;
    const launching = racing && m.throttleFraction > 0.9 && t.speed > 2 && t.speed < 64;
    if (sliding || braking || launching) {
      for (let i = 0; i < rear.length; i++) {
        const p = anchorToWorld(rear[i]!, m.x, m.y, m.headingRad);
        if (sliding || braking || t.speed < 30)
          this.effects.skid(p.x, p.y, travel, sliding && t.slipRatio > 0.7);
        const every = sliding ? 1 : 3;
        if (
          (tick + i) % (every * rear.length > 2 ? 2 : every) === 0 ||
          (sliding && (tick + i) % 2 === 0)
        ) {
          this.effects.smoke(
            p.x + (rng() - 0.5) * 4,
            p.y + (rng() - 0.5) * 4,
            m.velocityX * 0.22 + (rng() - 0.5) * 26,
            m.velocityY * 0.22 + (rng() - 0.5) * 26,
            tint,
            sliding ? 0.85 : 0.6,
            !sliding,
          );
        }
      }
    } else if (t.onShoulder && t.speed > 60 && tick % 3 === 0) {
      const p = anchorToWorld(rear[tick % rear.length]!, m.x, m.y, m.headingRad);
      this.effects.smoke(p.x, p.y, m.velocityX * 0.2, m.velocityY * 0.2, 0xc9bca8, 0.55, true);
    }

    this.exhaustTimer -= SIM_DT;
    if (this.exhaustTimer <= 0 && session.phase !== 'FINISHED') {
      this.exhaustTimer = lerp(0.42, 0.11, m.throttleFraction) + rng() * 0.05;
      const fx = Math.sin(m.headingRad);
      const fy = -Math.cos(m.headingRad);
      for (const anchor of chassis.exhausts) {
        const p = anchorToWorld(anchor, m.x, m.y, m.headingRad);
        this.effects.exhaust(p.x, p.y, m.velocityX * 0.35 - fx * 34, m.velocityY * 0.35 - fy * 34);
      }
    }

    if (t.wallContact) {
      const cx = m.x + t.wallNormalX * 17;
      const cy = m.y + t.wallNormalY * 17;
      if (t.wallImpactSpeed > 0) {
        const severity = clamp(t.wallImpactSpeed / 190, 0, 1);
        this.effects.impact(cx, cy);
        const count = 5 + Math.round(severity * 9);
        for (let i = 0; i < count; i++) {
          // Sparks leave along the wall and back into the road, never into the wall.
          const along = (rng() - 0.5) * 2;
          const out = -(0.3 + rng() * 0.9);
          const speed = 70 + rng() * 150 * (0.5 + severity);
          this.effects.spark(
            cx,
            cy,
            (t.wallNormalX * out + -t.wallNormalY * along) * speed + m.velocityX * 0.3,
            (t.wallNormalY * out + t.wallNormalX * along) * speed + m.velocityY * 0.3,
          );
        }
        this.pipeline.camera.kick(1 + severity * 1.6, 0.11);
        this.cfg.audio.thump(severity);
      } else if (t.speed > 50 && tick % 2 === 0) {
        this.effects.spark(
          cx,
          cy,
          m.velocityX * 0.5 - t.wallNormalX * 60 + (rng() - 0.5) * 60,
          m.velocityY * 0.5 - t.wallNormalY * 60 + (rng() - 0.5) * 60,
        );
      }
    }
  }

  private watchPhase(): void {
    const session = this.predictor.session;
    const countdown =
      session.phase === 'COUNTDOWN' ? Math.ceil(session.countdownTicks * SIM_DT) : 0;
    if (session.phase === 'COUNTDOWN' && countdown !== this.lastCountdown && countdown > 0)
      this.cfg.audio.beep(false);
    if (session.phase === 'RACING' && this.lastPhase === 'COUNTDOWN') {
      this.cfg.audio.beep(true);
      useHud.setState({ goStamp: useHud.getState().goStamp + 1 });
    }
    this.lastCountdown = countdown;
    this.lastPhase = session.phase;
  }

  private pushHud(x: number, y: number, heading: number): void {
    const session = this.predictor.session;
    const track = session.track;
    const lapPos = lapPosition(track, session.scratch.loc);
    const bend = bendAhead(track, lapPos, 110, 340);
    const radius = Math.abs(bend.curvature) > 1e-6 ? 1 / Math.abs(bend.curvature) : Infinity;
    const severity = radius < 115 ? 3 : radius < 170 ? 2 : radius < 270 ? 1 : 0;
    const input = this.cfg.input;
    useHud.setState({
      phase: session.phase,
      countdown: session.phase === 'COUNTDOWN' ? Math.ceil(session.countdownTicks * SIM_DT) : 0,
      speed: session.telemetry.speed * MPH_PER_WORLD_SPEED,
      lap: clamp(session.progress.lap, 1, track.def.laps),
      raceTimeMs: Math.round(session.raceTicks * SIM_DT * 1000),
      lastLapMs: session.lastLapMs,
      bestLapMs: session.bestLapMs,
      wrongWay: isWrongWay(session.progress),
      bendDirection: severity > 0 ? Math.sign(bend.curvature) : 0,
      bendSeverity: severity,
      lapFraction: lapPos / track.lapLength,
      mapX: x,
      mapY: y,
      finished: session.phase === 'FINISHED' || useHud.getState().finished,
      latencyMs: this.cfg.link.latencyMs,
      fps: Math.round(this.fpsSmooth),
      headingDeg: Math.round((wrapAngle(heading) * 180) / Math.PI + 360) % 360,
      reversing: session.motion.reversing,
      coreHeat: Math.round(session.motion.coreHeat),
      batteryEnergy: Math.round(session.motion.batteryEnergy),
      hasSteered: input.steered,
      hasBraked: input.braked,
      pendingInputs: this.predictor.pendingCount,
      corrections: this.predictor.corrections,
      maxCorrection: this.predictor.maxCorrection,
      position: this.race?.position ?? 1,
      gapMeters: this.race?.gapMeters ?? 0,
      chassis: Math.round(this.race?.car.combat?.chassis ?? 0),
      rivalChassis: Math.round(this.race?.rival.chassis ?? 0),
      projectiles: this.race?.projectiles.length ?? 0,
      hazards: this.race?.hazards.length ?? 0,
      raceEvents: this.eventCount,
      lastEvent: this.lastEvent,
      statuses: this.race?.car.combat?.statuses.map((status) => status.family).join(' ') ?? '',
      result: this.race?.result ? `${this.race.result.reason}:${this.race.result.winner}` : '',
      renderer: this.game.config.renderType === Phaser.WEBGL ? 'webgl' : 'canvas',
    });
  }
}
