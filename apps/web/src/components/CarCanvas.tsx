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
};

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
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx || !sheets) return;
    if (!spin || prefersReducedMotion()) {
      if (!highlightId || !highlightTone) {
        drawCar(ctx, sheets, { frame, headlights });
        return;
      }
      const colors = OUTLINE[highlightTone];
      const draw = (phase: number) =>
        drawCar(ctx, sheets, {
          frame,
          headlights,
          outline: { instanceId: highlightId, color: colors[phase % 2]! },
        });
      draw(0);
      if (colors[0] === colors[1] || prefersReducedMotion()) return;
      let phase = 0;
      const pulse = window.setInterval(() => draw(++phase), 520);
      return () => window.clearInterval(pulse);
    }
    let at = frame;
    let timer = 0;
    const step = () => {
      // A one-pixel shudder every few frames keeps the engine visibly alive.
      drawCar(ctx, sheets, { frame: at, headlights, bodyShiftY: at % 4 === 0 ? 1 : 0 });
      at = (at + 1) % CAR_HEADINGS;
      timer = window.setTimeout(step, 90);
    };
    step();
    return () => window.clearTimeout(timer);
  }, [sheets, frame, spin, headlights, highlightId, highlightTone]);

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
