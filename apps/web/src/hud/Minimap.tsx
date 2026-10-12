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
    img.src = manifests.minimapSrc;
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
      // The ribbon is shown smaller than it is drawn, so the marks are drawn larger: about
      // five CSS pixels for the cars however small the ribbon is.
      const shown = canvas.clientWidth > 0 ? canvas.clientWidth / minimap.width : 0.4;
      const k = Math.max(1, Math.min(3, Math.round(0.8 / shown) / 2));
      const u = (n: number) => Math.round(n * k);
      const race = hudLive.race;
      const loadout = hudLive.loadout;
      let hazards = 0;
      if (race && loadout && (loadout.hasRadar || loadout.hasMineSensor)) {
        for (const hazard of race.hazards) {
          if (!hazard.revealed || hazard.kind === 'decoy') continue;
          const hx = Math.round(hazard.x * s);
          const hy = Math.round(hazard.y * s);
          ctx.fillStyle = '#151C2C';
          ctx.fillRect(hx - u(4), hy - u(2), u(4) * 2 + 1, u(2) * 2 + 1);
          ctx.fillRect(hx - u(2), hy - u(4), u(2) * 2 + 1, u(4) * 2 + 1);
          ctx.fillStyle = '#FFB454';
          ctx.fillRect(hx - u(3), hy - u(1), u(3) * 2 + 1, u(1) * 2 + 1);
          ctx.fillRect(hx - u(1), hy - u(3), u(1) * 2 + 1, u(3) * 2 + 1);
          hazards++;
        }
      }
      const rivalShown = !!race && race.rivalTracked && race.rival.chassisMax > 0;
      if (race && rivalShown) {
        const rx = Math.round(race.rival.x * s);
        const ry = Math.round(race.rival.y * s);
        // A diamond: rows widening to the middle and narrowing again.
        for (const [fillStyle, r] of [
          ['#151C2C', u(5)],
          ['#F46B58', u(4)],
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
      ctx.fillRect(px - u(4), py - u(4), u(4) * 2 + 1, u(4) * 2 + 1);
      ctx.fillStyle = '#46D5E6';
      ctx.fillRect(px - u(3), py - u(3), u(3) * 2 + 1, u(3) * 2 + 1);
      ctx.fillStyle = '#F5EED9';
      ctx.fillRect(px - u(1), py - u(1), u(1) * 2 + 1, u(1) * 2 + 1);
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
