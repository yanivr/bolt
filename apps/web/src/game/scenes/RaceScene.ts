import type { CarPose, CarSnapshot, DriveSession, InputSample, RaceEvent, TerrainOverlay, VehicleLoadout } from '@bolt/shared';
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
  isWrongWay,
  lapPosition,
  lerp,
  mulberry32,
} from '@bolt/shared';
import Phaser from 'phaser';
import { useApp, useHud } from '../../app/store.js';
import type { DriveInput } from '../../input/driveInput.js';
import type { DriveLink } from '../../network/link.js';
import { Predictor } from '../../network/prediction.js';
import type { GameManifests } from '../assets.js';
import type { EngineAudio } from '../audio/EngineAudio.js';
import { ChaseCamera } from '../cameras/ChaseCamera.js';
import { CarView } from '../composition/CarView.js';
import { createPaintedBody } from '../composition/paint.js';
import { Effects } from '../particles/Effects.js';

export type RaceSceneConfig = {
  manifests: GameManifests;
  session: DriveSession;
  link: DriveLink;
  loadout: VehicleLoadout;
  input: DriveInput;
  audio: EngineAudio;
  /** Development aid: a centerline driver replaces the controls for capture and soak runs. */
  autopilot: boolean;
  onLoadProgress: (fraction: number) => void;
  onLoadError: () => void;
  onReady: () => void;
};

/** Camera anchor inside the view (Section 5.15): the local car sits low and near centre. */
const ANCHOR_X = 0.52;
const ANCHOR_Y = 0.62;
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

type Pose = { x: number; y: number; heading: number };

export class RaceScene extends Phaser.Scene {
  private cfg!: RaceSceneConfig;
  private predictor!: Predictor;
  private chase = new ChaseCamera();
  private carsCam!: Phaser.Cameras.Scene2D.Camera;
  private overCam!: Phaser.Cameras.Scene2D.Camera;
  private car!: CarView;
  private cone!: Phaser.GameObjects.Image;
  private effects!: Effects;
  private overlays: Array<{ def: TerrainOverlay; image: Phaser.GameObjects.Image }> = [];
  private accumulator = 0;
  private prev: Pose = { x: 0, y: 0, heading: 0 };
  private curr: Pose = { x: 0, y: 0, heading: 0 };
  private outbox: InputSample[] = [];
  private lastSendMs = 0;
  private lastHudMs = 0;
  private roll = 0;
  private exhaustTimer = 0;
  private tickCount = 0;
  private rng = mulberry32(90210);
  private viewScale = 1;
  private lastCountdown = -1;
  private lastPhase = '';
  private view = { x: 0, y: 0 };
  private fpsSmooth = 60;
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
    const sheet = (key: string, base: string, ref: { file: string; frameWidth: number; frameHeight: number }) =>
      this.load.spritesheet(key, `${base}/${ref.file}`, { frameWidth: ref.frameWidth, frameHeight: ref.frameHeight });
    sheet(`car:${chassis.id}:body`, manifests.carsBase, chassis.body);
    sheet(`car:${chassis.id}:shadow`, manifests.carsBase, chassis.shadow);
    sheet(`car:${chassis.id}:brake`, manifests.carsBase, chassis.brakeLights);
    sheet(`car:${chassis.id}:head`, manifests.carsBase, chassis.headlights);
    sheet(`wheel:${loadout.tireKitId}`, manifests.carsBase, manifests.cars.wheels[loadout.tireKitId]!.sheet);
    sheet(`engine:${loadout.engineId}`, manifests.carsBase, manifests.cars.engines[loadout.engineId]!.sheet);
    for (const strip of Object.values(manifests.vfx.strips)) sheet(`vfx:${strip.id}`, manifests.vfxBase, strip);
    for (const chunk of manifests.terrain.ground) this.load.image(`ground:${chunk.col}_${chunk.row}`, `${manifests.terrainBase}/${chunk.file}`);
    for (const overlay of manifests.terrain.overlays) this.load.image(`over:${overlay.id}`, `${manifests.terrainBase}/${overlay.file}`);
    for (const anim of manifests.terrain.animated) sheet(`anim:${anim.id}`, manifests.terrainBase, anim);
  }

  create(): void {
    const { manifests, loadout, session } = this.cfg;
    const ground = this.cameras.main;
    ground.setBackgroundColor('#151C2C');
    this.carsCam = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.overCam = this.cameras.add(0, 0, this.scale.width, this.scale.height);

    const groundObjects: Phaser.GameObjects.GameObject[] = [];
    const overObjects: Phaser.GameObjects.GameObject[] = [];

    for (const chunk of manifests.terrain.ground) {
      const image = this.add.image(chunk.x, chunk.y, `ground:${chunk.col}_${chunk.row}`).setOrigin(0, 0).setDepth(0);
      // A hair of overlap hides the seams that rotation would otherwise open between chunks.
      image.setDisplaySize(chunk.w + 0.6, chunk.h + 0.6);
      groundObjects.push(image);
    }

    for (const anim of manifests.terrain.animated) {
      const key = `anim:${anim.id}`;
      if (!this.anims.exists(key)) {
        this.anims.create({ key, frames: this.anims.generateFrameNumbers(key, { start: 0, end: anim.frameCount - 1 }), frameRate: anim.fps, repeat: -1 });
      }
      const sprite = this.add.sprite(anim.x, anim.y, key).setOrigin(0, 0).setDepth(anim.above ? 60 : 8);
      if (anim.blend === 'add') sprite.setBlendMode(Phaser.BlendModes.ADD);
      sprite.play(key);
      (anim.above ? overObjects : groundObjects).push(sprite);
    }

    this.cone = this.add.image(0, 0, 'vfx:headlight_cone').setOrigin(0.5, 1).setDepth(20).setBlendMode(Phaser.BlendModes.ADD);
    groundObjects.push(this.cone);

    this.effects = new Effects(this, manifests.vfx);
    groundObjects.push(...this.effects.objects());

    for (const def of manifests.terrain.overlays) {
      const image = this.add.image(def.x, def.y, `over:${def.id}`).setOrigin(0, 0).setDepth(70);
      this.overlays.push({ def, image });
      overObjects.push(image);
    }

    const chassis = manifests.cars.chassis[loadout.chassisId]!;
    const paint = manifests.cars.paints[loadout.paintId];
    const bodyKey = paint ? createPaintedBody(this, `car:${chassis.id}:body`, chassis, paint) : `car:${chassis.id}:body`;
    this.car = new CarView(this, chassis, manifests.cars.wheels[loadout.tireKitId]!, manifests.cars.engines[loadout.engineId]!, {
      body: bodyKey,
      shadow: `car:${chassis.id}:shadow`,
      brake: `car:${chassis.id}:brake`,
      head: `car:${chassis.id}:head`,
      wheels: `wheel:${loadout.tireKitId}`,
      engine: `engine:${loadout.engineId}`,
    });
    const carObjects = this.car.objects();

    // Three passes: ground and effects rotate with the world, cars are drawn upright in view
    // space from authored heading frames, and foreground art goes on top of the cars.
    ground.ignore([...carObjects, ...overObjects]);
    this.carsCam.ignore([...groundObjects, ...overObjects]);
    this.overCam.ignore([...groundObjects, ...carObjects]);

    const m = session.motion;
    this.prev = { x: m.x, y: m.y, heading: m.headingRad };
    this.curr = { ...this.prev };
    this.chase.snapTo(m.x, m.y, useApp.getState().settings.reducedCamera ? 0 : m.headingRad);

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

  /** Integer device pixels per world pixel at camera zoom 1.0, chosen for a 300 to 420 px tall view. */
  private layout(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    this.viewScale = Math.max(1, Math.ceil(Math.min(w, h) / 420));
    this.carsCam.setSize(w, h);
    this.overCam.setSize(w, h);
  }

  private onSnapshot(snapshot: CarSnapshot): void {
    const m = this.predictor.session.motion;
    const bx = m.x;
    const by = m.y;
    const bh = m.headingRad;
    this.predictor.reconcile(snapshot);
    // Carry the interpolation endpoints along with the correction; the predictor's decaying
    // error offset is what the player actually sees, so nothing pops.
    const dx = m.x - bx;
    const dy = m.y - by;
    const dh = angleDelta(bh, m.headingRad);
    this.prev.x += dx;
    this.prev.y += dy;
    this.prev.heading += dh;
    this.curr.x = m.x;
    this.curr.y = m.y;
    this.curr.heading = m.headingRad;
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
    useHud.setState({ finished: false });
  }

  override update(_time: number, deltaMs: number): void {
    const dt = Math.min(0.1, deltaMs / 1000);
    const app = useApp.getState();
    const settings = app.settings;
    const session = this.predictor.session;
    const input = this.cfg.input;
    input.northUp = settings.reducedCamera;
    // Solo and offline sessions simply stop sampling while the menu is open. An online race
    // keeps running on the server, so the car receives neutral input instead.
    const frozen = app.paused && this.cfg.link.mode === 'offline';
    input.enabled = !app.paused;

    if (!frozen) {
      this.accumulator = Math.min(this.accumulator + dt, SIM_DT * 5);
      while (this.accumulator >= SIM_DT) {
        this.accumulator -= SIM_DT;
        const screenHeading = angleDelta(this.chase.heading, session.motion.headingRad);
        const control =
          this.cfg.autopilot && !input.touching
            ? driveCenterline(session.track, session.motion, session.params, session.env, this.driverScratch)
            : input.sample(screenHeading);
        this.prev.x = this.curr.x;
        this.prev.y = this.curr.y;
        this.prev.heading = this.curr.heading;
        const { sample } = this.predictor.step(control);
        this.outbox.push(sample);
        // An offline link answers synchronously inside sendInputs, so flush every tick there.
        const now = performance.now();
        if (this.cfg.link.mode === 'offline' || this.outbox.length >= 2 || now - this.lastSendMs > 60) this.flush(now);
        const m = session.motion;
        this.curr.x = m.x;
        this.curr.y = m.y;
        this.curr.heading = m.headingRad;
        this.emitEffects();
        this.tickCount++;
      }
    }

    const alpha = frozen ? 1 : this.accumulator / SIM_DT;
    this.predictor.decayError(dt);
    const x = lerp(this.prev.x, this.curr.x, alpha) + this.predictor.errorX;
    const y = lerp(this.prev.y, this.curr.y, alpha) + this.predictor.errorY;
    const heading = this.prev.heading + angleDelta(this.prev.heading, this.curr.heading) * alpha + this.predictor.errorHeading;
    const m = session.motion;
    const t = session.telemetry;

    this.chase.update(dt, x, y, heading, m.velocityX, m.velocityY, settings.reducedCamera, settings.cameraShake);
    this.applyCameras();
    this.effects.update(dt);

    // --- Car pose ------------------------------------------------------------------------------
    const racing = session.phase === 'RACING';
    const speed = t.speed;
    this.roll += dt * clamp(Math.abs(t.forwardSpeed) / 6, 0, 18) * Math.sign(t.forwardSpeed || 1);
    let shiftX = 0;
    let shiftY = 0;
    if (speed > 90 && Math.abs(m.steeringInput) > 0.55) shiftX = -Math.sign(m.steeringInput) * (t.slipRatio > 0.55 ? 2 : 1);
    if (racing && m.throttleFraction > 0.8 && speed < 110 && speed > 3) shiftY = 1;
    else if (m.brakeInput > 0.45 && speed > 40) shiftY = -1;
    else if (speed < 8 && Math.floor(this.time.now / 90) % 3 === 0) shiftY = 1;
    const pose: CarPose = {
      headingRad: angleDelta(this.chase.heading, heading),
      steer: m.steeringInput,
      roll: this.roll,
      braking: m.brakeInput > 0.3 || m.reversing,
      headlights: true,
      bodyShiftX: shiftX,
      bodyShiftY: shiftY,
    };
    this.car.apply(pose);
    this.chase.toView(x, y, this.view);
    const zoom = this.viewScale * this.chase.zoom;
    // Snap to device pixels so the upright sprite never shimmers while the world slides by.
    this.car.setPosition(Math.round(this.view.x * zoom) / zoom, Math.round(this.view.y * zoom) / zoom);

    const fx = Math.sin(heading);
    const fy = -Math.cos(heading);
    this.cone.setPosition(x + fx * 22, y + fy * 22);
    this.cone.setRotation(heading);

    for (const { def, image } of this.overlays) {
      if (!def.fadeNearPlayer) continue;
      const near = x > def.x - 26 && x < def.x + def.w + 26 && y > def.y - 26 && y < def.y + def.h + 26;
      const target = near ? 0.28 : 1;
      image.setAlpha(image.alpha + (target - image.alpha) * Math.min(1, dt * 9));
    }

    this.cfg.audio.setVolumes(settings.engineVolume, settings.effectsVolume, settings.muted);
    this.cfg.audio.update(t.forwardSpeed, m.throttleFraction, t.slipRatio, NOMINAL_TOP_SPEED, !frozen && session.phase !== 'FINISHED');

    this.watchPhase();
    this.fpsSmooth = this.fpsSmooth * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
    const now = performance.now();
    if (now - this.lastHudMs >= HUD_INTERVAL_MS) {
      this.lastHudMs = now;
      this.pushHud(x, y);
    }
  }

  private flush(now: number): void {
    if (this.outbox.length === 0) return;
    this.lastSendMs = now;
    const batch = this.outbox.splice(0, MAX_INPUTS_PER_PACKET);
    this.cfg.link.sendInputs(batch);
  }

  private applyCameras(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    const zoom = this.viewScale * this.chase.zoom;
    const hand = useApp.getState().settings.drivingHand;
    // Left-handed layouts mirror HUD furniture only; the anchor nudges toward the steering side.
    const ax = hand === 'left' ? ANCHOR_X : 1 - ANCHOR_X;
    const ox = w * ax;
    const oy = h * ANCHOR_Y;
    const sx = this.chase.shakeX * this.viewScale;
    const sy = this.chase.shakeY * this.viewScale;
    for (const cam of [this.cameras.main, this.overCam]) {
      cam.setPosition(sx, sy);
      cam.setOrigin(ax, ANCHOR_Y);
      cam.setZoom(zoom);
      cam.setRotation(-this.chase.heading);
      cam.setScroll(this.chase.x - ox, this.chase.y - oy);
    }
    this.carsCam.setPosition(sx, sy);
    this.carsCam.setOrigin(ax, ANCHOR_Y);
    this.carsCam.setZoom(zoom);
    this.carsCam.setScroll(-ox, -oy);
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
        if (sliding || braking || t.speed < 30) this.effects.skid(p.x, p.y, travel, sliding && t.slipRatio > 0.7);
        const every = sliding ? 1 : 3;
        if ((tick + i) % (every * rear.length > 2 ? 2 : every) === 0 || (sliding && (tick + i) % 2 === 0)) {
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
        this.chase.kick(1 + severity * 1.6, 0.11);
        this.cfg.audio.thump(severity);
      } else if (t.speed > 50 && tick % 2 === 0) {
        this.effects.spark(cx, cy, m.velocityX * 0.5 - t.wallNormalX * 60 + (rng() - 0.5) * 60, m.velocityY * 0.5 - t.wallNormalY * 60 + (rng() - 0.5) * 60);
      }
    }
  }

  private watchPhase(): void {
    const session = this.predictor.session;
    const countdown = session.phase === 'COUNTDOWN' ? Math.ceil(session.countdownTicks * SIM_DT) : 0;
    if (session.phase === 'COUNTDOWN' && countdown !== this.lastCountdown && countdown > 0) this.cfg.audio.beep(false);
    if (session.phase === 'RACING' && this.lastPhase === 'COUNTDOWN') {
      this.cfg.audio.beep(true);
      useHud.setState({ goStamp: useHud.getState().goStamp + 1 });
    }
    this.lastCountdown = countdown;
    this.lastPhase = session.phase;
  }

  private pushHud(x: number, y: number): void {
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
      hasSteered: input.steered,
      hasBraked: input.braked,
    });
  }
}
