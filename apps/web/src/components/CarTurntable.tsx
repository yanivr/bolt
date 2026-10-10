import type { CarPose } from '@bolt/shared';
import { CAR_HEADINGS, TAU, layoutCar } from '@bolt/shared';
import { useEffect, useRef } from 'react';
import type { GameManifests } from '../game/assets.js';

type Props = {
  manifests: GameManifests;
  chassisId: string;
  engineId: string;
  tireKitId: string;
  paintId: string;
  /** CSS pixels per sprite pixel. */
  scale: number;
};

function load(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load ${url}`));
    image.src = url;
  });
}

function hexToRgb(hex: string): [number, number, number] {
  const c = hex.replace('#', '');
  return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
}

/**
 * The featured car on its turntable. It is composed live from the same sprite sheets and the
 * same `layoutCar` function as the race, stepping through the sixteen authored headings, so
 * the menu never shows a car that differs from the one on the track.
 */
export function CarTurntable({ manifests, chassisId, engineId, tireKitId, paintId, scale }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const chassis = manifests.cars.chassis[chassisId];
  const size = chassis?.body.frameWidth ?? 96;

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    const wheels = manifests.cars.wheels[tireKitId];
    const engine = manifests.cars.engines[engineId];
    const paint = manifests.cars.paints[paintId];
    if (!canvas || !ctx || !chassis || !wheels || !engine) return;
    let stopped = false;
    let timer = 0;
    const base = manifests.carsBase;

    void Promise.all([
      load(`${base}/${chassis.body.file}`),
      load(`${base}/${chassis.shadow.file}`),
      load(`${base}/${chassis.headlights.file}`),
      load(`${base}/${wheels.sheet.file}`),
      load(`${base}/${engine.sheet.file}`),
    ])
      .then(([bodyImage, shadow, head, wheelSheet, engineSheet]) => {
        if (stopped) return;
        // Exact-color palette swap, the same rule the race renderer applies.
        const body = document.createElement('canvas');
        body.width = bodyImage.width;
        body.height = bodyImage.height;
        const bctx = body.getContext('2d', { willReadFrequently: true });
        if (bctx) {
          bctx.drawImage(bodyImage, 0, 0);
          if (paint) {
            const data = bctx.getImageData(0, 0, body.width, body.height);
            const from = chassis.paintKey.map(hexToRgb);
            const to = paint.ramp.map(hexToRgb);
            const px = data.data;
            for (let i = 0; i < px.length; i += 4) {
              if (px[i + 3] === 0) continue;
              for (let k = 0; k < from.length; k++) {
                const f = from[k]!;
                if (px[i] === f[0] && px[i + 1] === f[1] && px[i + 2] === f[2]) {
                  const t = to[k] ?? f;
                  px[i] = t[0];
                  px[i + 1] = t[1];
                  px[i + 2] = t[2];
                  break;
                }
              }
            }
            bctx.putImageData(data, 0, 0);
          }
        }

        let frame = 0;
        const draw = () => {
          if (stopped) return;
          const pose: CarPose = {
            headingRad: (frame * TAU) / CAR_HEADINGS,
            steer: 0,
            roll: 0,
            braking: false,
            headlights: true,
            // A one-pixel idle shudder every few frames keeps the engine visibly alive.
            bodyShiftX: 0,
            bodyShiftY: frame % 4 === 0 ? 1 : 0,
          };
          ctx.clearRect(0, 0, size, size);
          ctx.imageSmoothingEnabled = false;
          for (const op of layoutCar(chassis, wheels, engine, pose)) {
            let image: CanvasImageSource = body;
            let fw = chassis.body.frameWidth;
            let fh = chassis.body.frameHeight;
            let columns = chassis.body.columns;
            if (op.kind === 'shadow') image = shadow;
            else if (op.kind === 'headlight') image = head;
            else if (op.kind === 'brake') continue;
            else if (op.kind === 'wheel') {
              image = wheelSheet;
              fw = wheels.sheet.frameWidth;
              fh = wheels.sheet.frameHeight;
              columns = wheels.sheet.columns;
            } else if (op.kind === 'engine') {
              image = engineSheet;
              fw = engine.sheet.frameWidth;
              fh = engine.sheet.frameHeight;
              columns = engine.sheet.columns;
            }
            ctx.drawImage(
              image,
              (op.frame % columns) * fw,
              Math.floor(op.frame / columns) * fh,
              fw,
              fh,
              Math.round(size / 2 + op.dx - fw / 2),
              Math.round(size / 2 + op.dy - fh / 2),
              fw,
              fh,
            );
          }
          frame = (frame + 1) % CAR_HEADINGS;
          timer = window.setTimeout(draw, 60);
        };
        draw();
      })
      .catch(() => undefined);

    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [manifests, chassis, engineId, tireKitId, paintId, size]);

  return (
    <canvas
      ref={ref}
      className="turntable-car"
      width={size}
      height={size}
      style={{ width: size * scale, height: size * scale }}
      aria-hidden="true"
    />
  );
}
