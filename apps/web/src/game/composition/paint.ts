import type { ChassisSpriteManifest, PaintDefinition } from '@bolt/shared';
import type Phaser from 'phaser';

function parse(hexColor: string): [number, number, number] {
  const c = hexColor.replace('#', '');
  return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
}

/**
 * Builds a painted copy of a chassis body sheet by exact-color palette swap. The pipeline
 * bakes bodies in a key ramp that no other material uses, so this never touches glass, steel
 * or lights, and the result stays pixel-crisp (no tinting, no filters).
 */
export function createPaintedBody(
  scene: Phaser.Scene,
  sourceKey: string,
  chassis: ChassisSpriteManifest,
  paint: PaintDefinition,
): string {
  const key = `${sourceKey}:${paint.id}`;
  if (scene.textures.exists(key)) return key;
  const source = scene.textures.get(sourceKey).getSourceImage() as HTMLImageElement;
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return sourceKey;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  const from = chassis.paintKey.map(parse);
  const to = paint.ramp.map(parse);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    for (let k = 0; k < from.length; k++) {
      const f = from[k]!;
      if (data[i] === f[0] && data[i + 1] === f[1] && data[i + 2] === f[2]) {
        const t = to[k] ?? f;
        data[i] = t[0];
        data[i + 1] = t[1];
        data[i + 2] = t[2];
        break;
      }
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = scene.textures.addCanvas(key, canvas);
  if (!texture) return sourceKey;
  const { frameWidth, frameHeight, columns, rows } = chassis.body;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) texture.add(r * columns + c, 0, c * frameWidth, r * frameHeight, frameWidth, frameHeight);
  }
  return key;
}
