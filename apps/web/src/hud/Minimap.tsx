import { useEffect, useRef } from 'react';
import { useHud } from '../app/store.js';
import type { GameManifests } from '../game/assets.js';
import { hudLive } from './hudStore.js';

/**
 * Small readable route ribbon. Never rotates with the camera. It shows the local car, the
 * rival while the server lets it be tracked (within 600 pixels, or 900 with Radar), and, for
 * a car that carries a Radar or a Mine Detector, the hazards it has been shown. The three are
 * different shapes as well as different colors: a square, a diamond and a cross.
 */
export function Minimap({ manifests }: { manifests: GameManifests }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const image = useRef<HTMLImageElement | null>(null);
  const { minimap } = manifests.terrain;

  useEffect(() => {
    const img = new Image();
    img.src = `${manifests.terrainBase}/${minimap.file}`;
    img.onload = () => {
      image.current = img;
    };
    const draw = (x: number, y: number) => {
      const canvas = ref.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      ctx.clearRect(0, 0, minimap.width, minimap.height);
      ctx.imageSmoothingEnabled = false;
      if (image.current) ctx.drawImage(image.current, 0, 0);
      const s = minimap.worldScale;
      const race = hudLive.race;
      const loadout = hudLive.loadout;
      let hazards = 0;
      if (race && loadout && (loadout.hasRadar || loadout.hasMineSensor)) {
        for (const hazard of race.hazards) {
          if (!hazard.revealed || hazard.kind === 'decoy') continue;
          const hx = Math.round(hazard.x * s);
          const hy = Math.round(hazard.y * s);
          ctx.fillStyle = '#151C2C';
          ctx.fillRect(hx - 4, hy - 2, 9, 5);
          ctx.fillRect(hx - 2, hy - 4, 5, 9);
          ctx.fillStyle = '#FFB454';
          ctx.fillRect(hx - 3, hy - 1, 7, 3);
          ctx.fillRect(hx - 1, hy - 3, 3, 7);
          hazards++;
        }
      }
      const rivalShown = !!race && race.rivalTracked && race.rival.chassisMax > 0;
      if (race && rivalShown) {
        const rx = Math.round(race.rival.x * s);
        const ry = Math.round(race.rival.y * s);
        // A diamond: rows widening to the middle and narrowing again.
        for (const [fillStyle, r] of [
          ['#151C2C', 5],
          ['#F46B58', 4],
        ] as const) {
          ctx.fillStyle = fillStyle;
          for (let dy = -r; dy <= r; dy++) {
            const half = r - Math.abs(dy);
            ctx.fillRect(rx - half, ry + dy, half * 2 + 1, 1);
          }
        }
      }
      const px = Math.round(x * s);
      const py = Math.round(y * s);
      ctx.fillStyle = '#151C2C';
      ctx.fillRect(px - 4, py - 4, 9, 9);
      ctx.fillStyle = '#46D5E6';
      ctx.fillRect(px - 3, py - 3, 7, 7);
      ctx.fillStyle = '#F5EED9';
      ctx.fillRect(px - 1, py - 1, 3, 3);
      canvas.dataset.rival = rivalShown ? '1' : '0';
      canvas.dataset.hazards = String(hazards);
    };
    draw(useHud.getState().mapX, useHud.getState().mapY);
    return useHud.subscribe((state) => draw(state.mapX, state.mapY));
  }, [manifests, minimap]);

  return (
    <canvas
      ref={ref}
      className="minimap"
      width={minimap.width}
      height={minimap.height}
      aria-hidden="true"
      data-testid="minimap"
    />
  );
}
