import type {
  MountedPartSprite,
  CarPose,
  CarSnapshot,
  DriveSession,
  InputSample,
  RaceEvent,
  TerrainOverlay,
  VehicleLoadout,
} from '@bolt/shared';
import {
  MAX_INPUTS_PER_PACKET,
  MPH_PER_WORLD_SPEED,
  NOMINAL_TOP_SPEED,
  SIM_DT,
  anchorToWorld,
  angleDelta,
  bendAhead,
  clamp,
  createDriverScratch,
  driveCenterline,
  engineSheetFor,
  isWrongWay,
  lapPosition,
  lerp,
  mulberry32,
  wrapAngle,
} from '@bolt/shared';
import Phaser from 'phaser';
import { useApp, useHud } from '../../app/store.js';
import type { DriveInput } from '../../input/driveInput.js';
import type { DriveLink } from '../../network/link.js';
import { Predictor } from '../../network/prediction.js';
import type { GameManifests } from '../assets.js';
import type { EngineAudio } from '../audio/EngineAudio.js';
import { CarView } from '../composition/CarView.js';
import { createPaintedBody } from '../composition/paint.js';
import { Effects } from '../particles/Effects.js';
import type { SimPose } from '../rendering/frame.js';
import { BodyMotion, RenderPipeline } from '../rendering/frame.js';

export type RaceSceneConfig = {
  manifests: GameManifests;
  session: DriveSession;
  link: DriveLink;
  loadout: VehicleLoadout;
  /** Mounted accessories that have art, positioned for the compositor. */
  parts: MountedPartSprite[];
  input: DriveInput;
  audio: EngineAudio;
  /** Development aid: a centerline driver replaces the controls for capture and soak runs. */
  autopilot: boolean;
  /** Whole canvas pixels per world pixel. Owned by the game shell, which also sizes the canvas. */
  view: { scale: number };
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

/** Draw order within the single world camera. Ground art sits at 0, foreground art at 70. */
const DEPTH_CAR = 50;

export class RaceScene extends Phaser.Scene {
  private cfg!: RaceSceneConfig;
  private predictor!: Predictor;
  private pipeline = new RenderPipeline();
  private body = new BodyMotion();
  private car!: CarView;
  private cone!: Phaser.GameObjects.Image;
  private effects!: Effects;
  private overlays: Array<{ def: TerrainOverlay; image: Phaser.GameObjects.Image }> = [];
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
  private driverScratch = createDriverScratch();

  constructor() {
    super('race');
  }

  init(data: RaceSceneConfig): void {
    this.cfg = data;
    this.predictor = new Predictor(data.session);
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
    for (const strip of Object.values(manifests.vfx.strips))
      sheet(`vfx:${strip.id}`, manifests.vfxBase, strip);
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
      sprite.play(key);
    }

    this.cone = this.add
      .image(0, 0, 'vfx:headlight_cone')
      .setOrigin(0.5, 1)
      .setDepth(20)
      .setBlendMode(Phaser.BlendModes.ADD);

    this.effects = new Effects(this, manifests.vfx);

    for (const def of manifests.terrain.overlays) {
      const image = this.add.image(def.x, def.y, `over:${def.id}`).setOrigin(0, 0).setDepth(70);
      this.overlays.push({ def, image });
    }

    const chassis = manifests.cars.chassis[loadout.chassisId]!;
    const paint = manifests.cars.paints[loadout.paintId];
    const bodyKey = paint
      ? createPaintedBody(this, `car:${chassis.id}:body`, chassis, paint)
      : `car:${chassis.id}:body`;
    // One world camera draws everything. The car is placed in world space on the same device
    // pixel grid as the ground and is drawn from authored heading frames, never rotated.
    this.car = new CarView(
      this,
      chassis,
      manifests.cars.wheels[loadout.tireKitId]!,
      manifests.cars.engines[loadout.engineId]!,
      {
        body: bodyKey,
        shadow: `car:${chassis.id}:shadow`,
        brake: `car:${chassis.id}:brake`,
        head: `car:${chassis.id}:head`,
        wheels: `wheel:${loadout.tireKitId}`,
        engine: `engine:${loadout.engineId}:${chassis.engineInBay ? 'bay' : 'tail'}`,
        parts: Object.fromEntries(this.cfg.parts.map((p) => [p.partId, `part:${p.partId}`])),
      },
      this.cfg.parts,
    );
    this.car.container.setDepth(DEPTH_CAR);

    this.pipeline.place(this.readPose());

    this.cfg.link.onSnapshot = (snapshot) => this.onSnapshot(snapshot);
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
      this.cfg.link.onSnapshot = null;
      this.cfg.link.onEvent = null;
      this.cfg.link.onStatus = null;
    });
    this.cfg.onReady();
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

  private onRaceEvent(event: RaceEvent): void {
    if (event.type === 'finish') useHud.setState({ finished: true });
  }

  /** Puts the car back on the grid for another run. */
  restart(): void {
    this.predictor.clearPending();
    this.outbox.length = 0;
    this.effects.clear();
    this.cfg.link.resetCar();
    this.pipeline.camera.cut();
    useHud.setState({ finished: false });
  }

  override update(time: number): void {
    const app = useApp.getState();
    const settings = app.settings;
    const session = this.predictor.session;
    const input = this.cfg.input;
    input.mode = settings.steering;
    // Solo and offline sessions simply stop sampling while the menu is open. An online race
    // keeps running on the server, so the car receives neutral input instead.
    const frozen = app.paused && this.cfg.link.mode === 'offline';
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

    // --- Car pose ------------------------------------------------------------------------------
    const speed = t.speed;
    this.roll += dt * clamp(Math.abs(t.forwardSpeed) / 6, 0, 18) * Math.sign(t.forwardSpeed || 1);
    this.idleClock += dt;
    this.body.update(dt, m.yawRate * t.forwardSpeed, this.forwardAccel, speed, this.idleClock);
    const pose: CarPose = {
      headingRad: view.frameHeading,
      steer: m.steeringInput,
      roll: this.roll,
      braking: m.brakeInput > 0.3 || m.reversing,
      headlights: true,
      bodyShiftX: this.body.shiftX,
      bodyShiftY: this.body.shiftY,
    };
    this.car.apply(pose);
    this.car.setPosition(view.carX, view.carY);

    // The light cone follows the drawn car, so it cannot wobble against the sprite.
    const heading = view.pose.heading;
    const x = view.pose.x;
    const y = view.pose.y;
    this.cone.setPosition(view.carX + Math.sin(heading) * 22, view.carY - Math.cos(heading) * 22);
    this.cone.setRotation(heading);

    for (const { def, image } of this.overlays) {
      if (!def.fadeNearPlayer) continue;
      const near =
        x > def.x - 26 && x < def.x + def.w + 26 && y > def.y - 26 && y < def.y + def.h + 26;
      const target = near ? 0.28 : 1;
      image.setAlpha(image.alpha + (target - image.alpha) * Math.min(1, dt * 9));
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
    const control =
      this.cfg.autopilot && !input.touching
        ? driveCenterline(
            session.track,
            session.motion,
            session.params,
            session.env,
            this.driverScratch,
          )
        : input.sample(session.motion, session.params, session.telemetry.grip);
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
      renderer: this.game.config.renderType === Phaser.WEBGL ? 'webgl' : 'canvas',
    });
  }
}
