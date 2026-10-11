import type { ControlInput, VehicleMotionState, VehicleParams } from '@bolt/shared';
import {
  DIRECTION_STOP_START,
  JOYSTICK_DEAD_ZONE,
  JOYSTICK_RADIUS_PX,
  NEUTRAL_INPUT,
  angleDelta,
  clampToDisc,
  directionToControl,
  joystickToControl,
  keysToControl,
  trailStickOrigin,
} from '@bolt/shared';

/**
 * How the floating stick is read. `direction` (the default): point the stick where the car
 * should go on screen. `wheel`: left and right turn the car relative to itself and pulling
 * down brakes, as on a steering wheel.
 */
export type SteeringMode = 'direction' | 'wheel';

/**
 * Floating joystick plus keyboard, converging on one normalized control sample
 * (Sections 7.1 and 7.2).
 *
 * The world is drawn north-up and never rotates, so by default the stick is a direction: push
 * it toward where the car should go. The shared heading controller turns that into ordinary
 * steering and brake values for the tick about to be simulated, which is all the server ever
 * sees. Keys stay relative to the car (left and right turn it, down brakes): two keys cannot
 * name a direction finely enough to follow a curve, and turn-left, turn-right is what every
 * fixed-camera racer on a keyboard has always used.
 *
 * The steering finger may land anywhere on the play surface. Only the first pointer that
 * starts on the surface itself owns the joystick; pointers that begin on a HUD button never
 * reach this element, and a steering finger that later slides across a button stays captured
 * here, so it can never fire anything by accident.
 */
export class DriveInput {
  private surface: HTMLElement | null = null;
  private disc: HTMLDivElement | null = null;
  private nub: HTMLDivElement | null = null;
  private arrow: HTMLDivElement | null = null;
  private pointerId: number | null = null;
  private originX = 0;
  private originY = 0;
  private dx = 0;
  private dy = 0;
  private keys = new Set<string>();
  mode: SteeringMode = 'direction';
  /** Set once the driver has demonstrated each gesture, so teaching prompts can fade. */
  steered = false;
  braked = false;
  enabled = true;
  /** Utility bits the repair key (R) presses: the car's spare wheel and repair kits. */
  repairMask = 0;
  /** Ticks left on a tapped fire button, per slot, and on a tapped utility button, per bit. */
  private readonly firePulse = [0, 0];
  private readonly usePulse = [0, 0, 0, 0, 0, 0, 0, 0];

  attach(surface: HTMLElement): void {
    this.surface = surface;
    const disc = document.createElement('div');
    disc.className = 'joy-disc';
    const arrow = document.createElement('div');
    arrow.className = 'joy-arrow';
    const nub = document.createElement('div');
    nub.className = 'joy-nub';
    disc.append(arrow, nub);
    disc.style.width = `${JOYSTICK_RADIUS_PX * 2}px`;
    disc.style.height = `${JOYSTICK_RADIUS_PX * 2}px`;
    surface.append(disc);
    this.disc = disc;
    this.nub = nub;
    this.arrow = arrow;

    surface.addEventListener('pointerdown', this.onDown);
    surface.addEventListener('pointermove', this.onMove);
    surface.addEventListener('pointerup', this.onUp);
    surface.addEventListener('pointercancel', this.onUp);
    surface.addEventListener('lostpointercapture', this.onLost);
    surface.addEventListener('contextmenu', this.block);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.release);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  detach(): void {
    const surface = this.surface;
    if (surface) {
      surface.removeEventListener('pointerdown', this.onDown);
      surface.removeEventListener('pointermove', this.onMove);
      surface.removeEventListener('pointerup', this.onUp);
      surface.removeEventListener('pointercancel', this.onUp);
      surface.removeEventListener('lostpointercapture', this.onLost);
      surface.removeEventListener('contextmenu', this.block);
    }
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.release);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.disc?.remove();
    this.surface = null;
    this.disc = null;
    this.pointerId = null;
    this.keys.clear();
  }

  /** True while a finger or mouse button is steering. */
  get touching(): boolean {
    return this.pointerId !== null;
  }

  /**
   * One control sample for the next simulation tick, computed against the state that tick
   * will start from.
   */
  sample(motion: VehicleMotionState, params: VehicleParams, grip: number): ControlInput {
    if (!this.enabled) return NEUTRAL_INPUT;
    if (this.pointerId !== null) {
      let control: ControlInput;
      let deliberateBrake: boolean;
      if (this.mode === 'direction') {
        const sx = this.dx / JOYSTICK_RADIUS_PX;
        const sy = this.dy / JOYSTICK_RADIUS_PX;
        control = directionToControl(sx, sy, motion, params, grip);
        // Corner assist can brake on its own; only a stick held behind the car counts as the
        // driver having found the brake.
        const behind =
          Math.hypot(sx, sy) > JOYSTICK_DEAD_ZONE &&
          Math.abs(angleDelta(motion.headingRad, Math.atan2(sx, -sy))) > DIRECTION_STOP_START;
        deliberateBrake = behind && control.brake > 0.5;
      } else {
        control = joystickToControl(this.dx, this.dy);
        deliberateBrake = control.brake > 0.5;
      }
      if (Math.abs(control.steer) > 0.25) this.steered = true;
      if (deliberateBrake) this.braked = true;
      return control;
    }
    const k = this.keys;
    const left = k.has('ArrowLeft') || k.has('KeyA');
    const right = k.has('ArrowRight') || k.has('KeyD');
    const brake = k.has('ArrowDown') || k.has('KeyS');
    const gas = k.has('ArrowUp') || k.has('KeyW');
    const control = keysToControl(left, right, brake, left || right || brake || gas);
    if (control.steer !== 0) this.steered = true;
    if (control.brake > 0.5) this.braked = true;
    return control;
  }

  /**
   * Holds a fire button for a few ticks, for an on-screen button that reports a tap rather
   * than a press and a release. Keys hold for as long as they are down.
   */
  tapFire(slot: 0 | 1, ticks = 6): void {
    this.firePulse[slot] = Math.max(this.firePulse[slot]!, ticks);
  }

  /** Presses a manual utility's button: the server acts on the press, not on the hold. */
  tapUse(bit: number, ticks = 3): void {
    if (bit >= 0 && bit < this.usePulse.length)
      this.usePulse[bit] = Math.max(this.usePulse[bit]!, ticks);
  }

  /**
   * Fire and utility buttons for the next simulation tick (Section 7.2: Space fires weapon 1,
   * E fires weapon 2, R repairs; the digit keys press the manual utilities in order). Call
   * once per tick: tapped buttons count down here.
   */
  buttons(out: { fire: number; use: number }): void {
    out.fire = 0;
    out.use = 0;
    const k = this.keys;
    for (let slot = 0; slot < 2; slot++) {
      if (this.firePulse[slot]! > 0) {
        this.firePulse[slot]!--;
        if (this.enabled) out.fire |= 1 << slot;
      }
    }
    for (let bit = 0; bit < this.usePulse.length; bit++) {
      if (this.usePulse[bit]! > 0) {
        this.usePulse[bit]!--;
        if (this.enabled) out.use |= 1 << bit;
      }
      if (this.enabled && k.has(`Digit${bit + 1}`)) out.use |= 1 << bit;
    }
    if (!this.enabled) return;
    if (k.has('Space')) out.fire |= 1;
    if (k.has('KeyE')) out.fire |= 2;
    if (k.has('KeyR')) out.use |= this.repairMask;
  }

  private block = (event: Event): void => {
    event.preventDefault();
  };

  private onDown = (event: PointerEvent): void => {
    if (!this.enabled || this.pointerId !== null || event.target !== this.surface) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    this.pointerId = event.pointerId;
    try {
      this.surface?.setPointerCapture(event.pointerId);
    } catch {
      // Capture can fail on synthetic events; moves on the surface still arrive.
    }
    const rect = this.surface!.getBoundingClientRect();
    this.originX = event.clientX - rect.left;
    this.originY = event.clientY - rect.top;
    this.dx = 0;
    this.dy = 0;
    this.draw();
  };

  private onMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId || !this.surface) return;
    const rect = this.surface.getBoundingClientRect();
    let dx = event.clientX - rect.left - this.originX;
    let dy = event.clientY - rect.top - this.originY;
    // The origin trails a thumb that wanders, so turning back never needs a long reach.
    const trail = trailStickOrigin(dx, dy);
    this.originX += trail.x;
    this.originY += trail.y;
    dx -= trail.x;
    dy -= trail.y;
    this.dx = dx;
    this.dy = dy;
    this.draw();
  };

  private onUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    this.releasePointer();
  };

  private onLost = (event: PointerEvent): void => {
    if (event.pointerId === this.pointerId) this.releasePointer();
  };

  private onVisibility = (): void => {
    // A hidden tab must send input-neutral, never a stuck steering value (Section 5.10).
    if (document.hidden) this.release();
  };

  private release = (): void => {
    this.keys.clear();
    this.releasePointer();
  };

  private releasePointer(): void {
    if (this.pointerId !== null && this.surface) {
      try {
        this.surface.releasePointerCapture(this.pointerId);
      } catch {
        // Already released.
      }
    }
    this.pointerId = null;
    this.dx = 0;
    this.dy = 0;
    this.draw();
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code))
      event.preventDefault();
    this.keys.add(event.code);
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private draw(): void {
    const disc = this.disc;
    const nub = this.nub;
    const arrow = this.arrow;
    if (!disc || !nub || !arrow) return;
    if (this.pointerId === null) {
      disc.classList.remove('is-active');
      return;
    }
    disc.classList.add('is-active');
    disc.style.transform = `translate(${this.originX - JOYSTICK_RADIUS_PX}px, ${this.originY - JOYSTICK_RADIUS_PX}px)`;
    const p = clampToDisc(this.dx, this.dy);
    nub.style.transform = `translate(${p.x}px, ${p.y}px)`;
    const len = Math.hypot(p.x, p.y);
    arrow.style.width = `${len}px`;
    arrow.style.transform = `rotate(${Math.atan2(p.y, p.x)}rad)`;
    arrow.style.opacity = len > 6 ? '1' : '0';
  }
}
