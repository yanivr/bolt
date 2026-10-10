import { useEffect, useRef } from 'react';
import { useHud } from '../app/store.js';
import type { GameManifests } from '../game/assets.js';

/** Small readable route ribbon with the local car's position. Never rotates with the camera. */
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
      const ctx = ref.current?.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, minimap.width, minimap.height);
      ctx.imageSmoothingEnabled = false;
      if (image.current) ctx.drawImage(image.current, 0, 0);
      const px = Math.round(x * minimap.worldScale);
      const py = Math.round(y * minimap.worldScale);
      ctx.fillStyle = '#151C2C';
      ctx.fillRect(px - 4, py - 4, 9, 9);
      ctx.fillStyle = '#46D5E6';
      ctx.fillRect(px - 3, py - 3, 7, 7);
      ctx.fillStyle = '#F5EED9';
      ctx.fillRect(px - 1, py - 1, 3, 3);
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
    />
  );
}
