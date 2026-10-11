import type { VehicleBlueprint } from '@bolt/shared';
import { CAR_HEADINGS } from '@bolt/shared';
import { useEffect, useRef, useState } from 'react';
import type { GameManifests } from '../game/assets.js';
import type { CarSheets } from './carSprites.js';
import { CAR_CANVAS_PAD, drawCar, loadCarSheets } from './carSprites.js';

type Props = {
  manifests: GameManifests;
  blueprint: VehicleBlueprint;
  /** Whole CSS pixels per sprite pixel. */
  scale: number;
  /** Heading frame to show, 0 (nose up) to 63, clockwise. Ignored while spinning. */
  frame?: number;
  /** Slow turntable rotation. Off under Reduced Motion. */
  spin?: boolean;
  headlights?: boolean;
  className?: string;
  /** Called with false when the chassis has no art and nothing can be drawn. */
  onDrawable?: (drawable: boolean) => void;
  /**
   * A mounted part to pick out with an outline traced around its own shape. `select` pulses
   * gently in gold (it holds still under Reduced Motion); `bad` is a steady red.
   */
  highlight?: { instanceId: string; tone: 'select' | 'bad' | 'target' } | null;
  /**
   * Focus dimming: everything but one thing is drawn darker, so that thing stands out. `part`
   * keeps a mounted part bright, `engine` the engine, and `all` dims the whole car (an empty
   * mount, whose socket is drawn over the canvas). It fades in quickly, and is instant under
   * Reduced Motion.
   */
  dim?: { part: string } | { engine: true } | 'all' | null;
};

/** How much darker the rest of the car is drawn in focus: 40 percent. */
export const FOCUS_DIM = 0.4;
const DIM_FADE_MS = 140;

const OUTLINE = {
  select: ['#f6c35b', '#fff0c2'],
  bad: ['#ff5a66', '#ff5a66'],
  target: ['#67dea7', '#c9f7e2'],
} as const;

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Any blueprint, drawn from the real sprite sheets at an integer scale with nearest-neighbor
 * sampling. This is the only car renderer outside the race scene: the home turntable, the
 * garage workbench and every thumbnail use it.
 */
export function CarCanvas({
  manifests,
  blueprint,
  scale,
  frame = 0,
  spin = false,
  headlights = true,
  className,
  onDrawable,
  highlight = null,
  dim = null,
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [sheets, setSheets] = useState<CarSheets | null>(null);
  const size = sheets?.size ?? manifests.cars.chassis[blueprint.chassisId]?.body.frameWidth ?? 96;

  useEffect(() => {
    let stale = false;
    loadCarSheets(manifests, blueprint)
      .then((loaded) => {
        if (stale) return;
        setSheets(loaded);
        onDrawable?.(loaded !== null);
      })
      .catch(() => {
        if (!stale) setSheets(null);
      });
    return () => {
      stale = true;
    };
  }, [manifests, blueprint, onDrawable]);

  const highlightId = highlight?.instanceId ?? null;
  const highlightTone = highlight?.tone ?? null;
  const dimKey =
    dim === null ? '' : dim === 'all' ? 'all' : 'part' in dim ? `part:${dim.part}` : 'engine';
  // The dimming in force, eased toward its target between renders of the effect below.
  const dimLevel = useRef(0);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx || !sheets) return;
    const keep =
      dimKey === '' || dimKey === 'all'
        ? null
        : dimKey === 'engine'
          ? ({ engine: true } as const)
          : { part: dimKey.slice(5) };
    let phase = 0;
    let at = frame;
    const spinning = spin && !prefersReducedMotion();
    const colors = highlightId && highlightTone ? OUTLINE[highlightTone] : null;
    const render = () => {
      drawCar(ctx, sheets, {
        frame: spinning ? at : frame,
        headlights,
        ...(spinning ? { bodyShiftY: at % 4 === 0 ? 1 : 0 } : {}),
        outline:
          colors && highlightId ? { instanceId: highlightId, color: colors[phase % 2]! } : null,
        dim: dimLevel.current > 0 ? { amount: dimLevel.current, keep } : null,
      });
      ctx.canvas.dataset.dim = dimLevel.current.toFixed(2);
      ctx.canvas.dataset.dimKeep = dimLevel.current > 0 ? dimKey : '';
    };

    // The fade: a few frames from where the dimming is to where it should be.
    const target = dimKey === '' ? 0 : FOCUS_DIM;
    let fade = 0;
    if (prefersReducedMotion() || dimLevel.current === target) dimLevel.current = target;
    else {
      const from = dimLevel.current;
      const started = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - started) / DIM_FADE_MS);
        dimLevel.current = from + (target - from) * t;
        render();
        fade = t < 1 ? requestAnimationFrame(step) : 0;
      };
      fade = requestAnimationFrame(step);
    }

    render();
    let timer = 0;
    if (spinning) {
      const step = () => {
        // A one-pixel shudder every few frames keeps the engine visibly alive.
        render();
        at = (at + 1) % CAR_HEADINGS;
        timer = window.setTimeout(step, 90);
      };
      step();
    } else if (colors && colors[0] !== colors[1] && !prefersReducedMotion()) {
      timer = window.setInterval(() => {
        phase++;
        render();
      }, 520);
    }
    return () => {
      if (fade) cancelAnimationFrame(fade);
      window.clearTimeout(timer);
      window.clearInterval(timer);
    };
  }, [sheets, frame, spin, headlights, highlightId, highlightTone, dimKey]);

  return (
    <canvas
      ref={ref}
      className={className ? `car-canvas ${className}` : 'car-canvas'}
      width={size + 2 * CAR_CANVAS_PAD}
      height={size + 2 * CAR_CANVAS_PAD}
      style={{
        width: (size + 2 * CAR_CANVAS_PAD) * scale,
        height: (size + 2 * CAR_CANVAS_PAD) * scale,
        // Pulled back by the pad, so the element takes the room of the chassis cell alone.
        margin: -CAR_CANVAS_PAD * scale,
      }}
      aria-hidden="true"
    />
  );
}
