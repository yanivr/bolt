import type { ControlInput } from '@bolt/shared';
import {
  JOYSTICK_DEAD_ZONE,
  JOYSTICK_RADIUS_PX,
  NEUTRAL_INPUT,
  angleDelta,
  clamp,
  clampToDisc,
  joystickToControl,
  keysToControl,
} from '@bolt/shared';

/**
 * Floating pull joystick plus keyboard, converging on one normalized control sample
 * (Sections 7.1 and 7.2).
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
  /** When true the world is drawn north-up and the stick points where the car should go. */
  northUp = false;
  /** Set once the driver has demonstrated each gesture, so teaching prompts can fade. */
  steered = false;
  braked = false;
  enabled = true;

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
   * One control sample for the next simulation tick. `screenHeading` is the car's heading
   * relative to screen-up and is only used by the north-up mapping.
   */
  sample(screenHeading: number): ControlInput {
    if (!this.enabled) return NEUTRAL_INPUT;
    if (this.pointerId !== null) {
      let control: ControlInput;
      if (this.northUp) {
        // Stable-camera option: push the stick toward where the car should head on screen.
        const magnitude = Math.hypot(this.dx, this.dy) / JOYSTICK_RADIUS_PX;
        if (magnitude <= JOYSTICK_DEAD_ZONE) {
          control = { steer: 0, brake: 0, coast: false };
        } else {
          const wanted = Math.atan2(this.dx, -this.dy);
          const turn = angleDelta(screenHeading, wanted);
          const reverseAsk = Math.abs(turn) > 2.3;
          control = { steer: reverseAsk ? 0 : clamp(turn / 0.7, -1, 1), brake: reverseAsk ? 0.9 : 0, coast: false };
        }
      } else {
        control = joystickToControl(this.dx, this.dy);
      }
      if (Math.abs(control.steer) > 0.25) this.steered = true;
      if (control.brake > 0.5) this.braked = true;
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
    this.dx = event.clientX - rect.left - this.originX;
    this.dy = event.clientY - rect.top - this.originY;
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
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
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
