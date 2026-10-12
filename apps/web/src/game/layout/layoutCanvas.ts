import type { LayoutPrimitive, TrackRuntime } from '@bolt/shared';
import { layoutPrimitives, sampleBranch } from '@bolt/shared';

/**
 * The layout view in the browser (`packages/shared/src/layout.ts` has the primitives): drawn
 * into canvases, for a track whose terrain art is not baked yet. Development and `?debug=1`
 * builds only; a production build never offers such a track (`app/course.ts`).
 */

export const LAYOUT_CHUNK = 1024;
/** Canvas pixels per world pixel: the layout view is drawn at half resolution and doubled. */
export const LAYOUT_RESOLUTION = 0.5;
export const LAYOUT_LABEL = 'Track art in progress';

function draw(ctx: CanvasRenderingContext2D, prims: readonly LayoutPrimitive[]): void {
  for (const p of prims) {
    if (p.t === 'poly') {
      ctx.fillStyle = p.fill;
      ctx.beginPath();
      ctx.moveTo(p.points[0]!, p.points[1]!);
      for (let k = 2; k < p.points.length; k += 2) ctx.lineTo(p.points[k]!, p.points[k + 1]!);
      ctx.closePath();
      ctx.fill();
    } else if (p.t === 'circle') {
      ctx.fillStyle = p.fill;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.width;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(p.points[0]!, p.points[1]!);
      for (let k = 2; k < p.points.length; k += 2) ctx.lineTo(p.points[k]!, p.points[k + 1]!);
      if (p.closed) ctx.closePath();
      ctx.stroke();
    }
  }
}

export type LayoutChunk = { x: number; y: number; w: number; h: number; canvas: HTMLCanvasElement };

/**
 * The whole world as canvases covering `LAYOUT_CHUNK` world pixels each, at
 * `LAYOUT_RESOLUTION` (drawn back at full size), with the label stencilled on the ground every
 * so often so nobody mistakes it for art.
 */
export function layoutChunks(track: TrackRuntime, clockTicks = 0): LayoutChunk[] {
  const prims = layoutPrimitives(track, { clockTicks, anchors: false });
  const { worldWidth: W, worldHeight: H } = track.def;
  const out: LayoutChunk[] = [];
  for (let y = 0; y < H; y += LAYOUT_CHUNK)
    for (let x = 0; x < W; x += LAYOUT_CHUNK) {
      const w = Math.min(LAYOUT_CHUNK, W - x);
      const h = Math.min(LAYOUT_CHUNK, H - y);
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(w * LAYOUT_RESOLUTION);
      canvas.height = Math.ceil(h * LAYOUT_RESOLUTION);
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      ctx.scale(LAYOUT_RESOLUTION, LAYOUT_RESOLUTION);
      ctx.translate(-x, -y);
      draw(ctx, prims);
      ctx.font = 'bold 26px sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
      ctx.textAlign = 'center';
      for (let ly = 300; ly < H; ly += 700)
        for (let lx = 400; lx < W; lx += 900)
          if (lx + 200 > x && lx - 200 < x + w && ly + 40 > y && ly - 40 < y + h)
            ctx.fillText(LAYOUT_LABEL.toUpperCase(), lx + ((ly / 700) % 2) * 450, ly);
      out.push({ x, y, w, h, canvas });
    }
  return out;
}

/**
 * The course map for the preview and the HUD, drawn from the layout exactly as the terrain
 * baker draws `minimap.png` (art/scripts/terrain/minimap.ts): a dark outline, thin shortcuts,
 * the main line and a start bar, on transparency.
 */
export function layoutMinimap(
  track: TrackRuntime,
  width = 240,
): { src: string; width: number; height: number; worldScale: number } {
  const scale = width / track.def.worldWidth;
  const height = Math.round(track.def.worldHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { src: '', width, height, worldScale: scale };
  const dot = (wx: number, wy: number, size: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(wx * scale - size / 2), Math.round(wy * scale - size / 2), size, size);
  };
  for (const branch of track.branches) {
    const size = branch.index === 0 ? 4 : 3;
    for (let s = 0; s <= branch.length; s += 2) {
      const p = sampleBranch(branch, s);
      dot(p.x, p.y, size, '#151C2C');
    }
  }
  for (const branch of track.branches) {
    if (branch.index === 0) continue;
    for (let s = 0; s <= branch.length; s += 2) {
      const p = sampleBranch(branch, s);
      dot(p.x, p.y, 1, '#F6C35B');
    }
  }
  for (let s = 0; s <= track.main.length; s += 2) {
    const p = sampleBranch(track.main, s);
    dot(p.x, p.y, 2, '#F5EED9');
  }
  const st = sampleBranch(track.main, track.startS);
  for (let k = -3; k <= 3; k++) {
    const wx = st.x + (-st.ty * k) / scale;
    const wy = st.y + (st.tx * k) / scale;
    ctx.fillStyle = Math.abs(k) === 3 ? '#151C2C' : '#F46B58';
    ctx.fillRect(Math.round(wx * scale - 1), Math.round(wy * scale - 1), 3, 2);
  }
  return { src: canvas.toDataURL('image/png'), width, height, worldScale: scale };
}
