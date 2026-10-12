import type { LayoutPrimitive } from './layout.js';

/**
 * A small software rasterizer for the layout view's primitives, for Node (review images, the
 * track preview's map in tests) and anywhere a canvas is not at hand. Even-odd polygon fill at
 * pixel centres, thick lines as quads with round joins, alpha blending. Not antialiased.
 */

export type RasterImage = { width: number; height: number; data: Uint8ClampedArray };

function parseColor(c: string): [number, number, number, number] {
  const h = c.slice(1);
  const n = parseInt(h.slice(0, 6), 16);
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
}

function blend(img: RasterImage, x: number, y: number, c: readonly number[]): void {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (y * img.width + x) * 4;
  const a = c[3]! / 255;
  const d = img.data;
  d[i] = d[i]! + (c[0]! - d[i]!) * a;
  d[i + 1] = d[i + 1]! + (c[1]! - d[i + 1]!) * a;
  d[i + 2] = d[i + 2]! + (c[2]! - d[i + 2]!) * a;
  d[i + 3] = Math.max(d[i + 3]!, c[3]!);
}

function fillPolygon(img: RasterImage, pts: readonly number[], color: readonly number[]): void {
  const n = pts.length / 2;
  if (n < 3) return;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let k = 0; k < n; k++) {
    y0 = Math.min(y0, pts[k * 2 + 1]!);
    y1 = Math.max(y1, pts[k * 2 + 1]!);
  }
  const ys = Math.max(0, Math.floor(y0));
  const ye = Math.min(img.height - 1, Math.ceil(y1));
  const xs: number[] = [];
  for (let y = ys; y <= ye; y++) {
    const cy = y + 0.5;
    xs.length = 0;
    for (let k = 0, j = n - 1; k < n; j = k++) {
      const ay = pts[k * 2 + 1]!;
      const by = pts[j * 2 + 1]!;
      if (ay > cy !== by > cy) {
        const ax = pts[k * 2]!;
        const bx = pts[j * 2]!;
        xs.push(ax + ((cy - ay) * (bx - ax)) / (by - ay));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k]! - 0.5));
      const to = Math.min(img.width - 1, Math.floor(xs[k + 1]! - 0.5));
      for (let x = from; x <= to; x++) blend(img, x, y, color);
    }
  }
}

function fillCircle(img: RasterImage, cx: number, cy: number, r: number, color: readonly number[]) {
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(img.width - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(img.height - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r * r) blend(img, x, y, color);
    }
}

/**
 * Draws primitives given in world pixels into a new image of `width` x `height`, mapping a
 * world point p to `(p - origin) * scale`.
 */
export function rasterizeLayout(
  prims: readonly LayoutPrimitive[],
  width: number,
  height: number,
  scale: number,
  originX = 0,
  originY = 0,
): RasterImage {
  const img: RasterImage = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  const X = (v: number) => (v - originX) * scale;
  const Y = (v: number) => (v - originY) * scale;
  for (const p of prims) {
    if (p.t === 'poly') {
      const pts: number[] = [];
      for (let k = 0; k < p.points.length; k += 2) pts.push(X(p.points[k]!), Y(p.points[k + 1]!));
      fillPolygon(img, pts, parseColor(p.fill));
    } else if (p.t === 'circle') {
      fillCircle(img, X(p.x), Y(p.y), Math.max(0.5, p.r * scale), parseColor(p.fill));
    } else {
      const color = parseColor(p.color);
      const half = Math.max(0.5, (p.width * scale) / 2);
      const n = p.points.length / 2;
      const segs = p.closed ? n : n - 1;
      for (let k = 0; k < segs; k++) {
        const j = (k + 1) % n;
        const ax = X(p.points[k * 2]!);
        const ay = Y(p.points[k * 2 + 1]!);
        const bx = X(p.points[j * 2]!);
        const by = Y(p.points[j * 2 + 1]!);
        const dx = bx - ax;
        const dy = by - ay;
        const len = Math.hypot(dx, dy) || 1;
        const nx = (-dy / len) * half;
        const ny = (dx / len) * half;
        fillPolygon(
          img,
          [ax + nx, ay + ny, bx + nx, by + ny, bx - nx, by - ny, ax - nx, ay - ny],
          color,
        );
        if (half >= 1.5) fillCircle(img, bx, by, half, color);
      }
    }
  }
  return img;
}
