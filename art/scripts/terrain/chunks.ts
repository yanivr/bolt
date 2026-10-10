import { join } from 'node:path';
import type { TerrainChunk } from '@bolt/shared';
import { PixelBuffer, writePng } from '../lib/pixels.js';
import type { Canvas } from './canvas.js';

/**
 * Slices the world into fixed-size chunks and writes each as PNG. A chunk richer than 256
 * colors has its rarest colors folded into their nearest common neighbor so it can still be
 * stored indexed; the fold is deterministic and touches only a handful of stray pixels.
 */

export type ChunkStats = { chunks: TerrainChunk[]; bytes: number; reduced: number; truecolor: number; maxColors: number };

/** Reduces a buffer to at most `limit` colors in place. Returns the original color count. */
export function reduceColors(buf: PixelBuffer, limit: number): number {
  const data = buf.data;
  const counts = new Map<number, number>();
  for (let i = 0; i < data.length; i += 4) {
    const key = data[i + 3] === 0 ? -1 : ((data[i]! << 24) | (data[i + 1]! << 16) | (data[i + 2]! << 8) | data[i + 3]!) >>> 0;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = counts.size;
  if (total <= limit) return total;
  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const kept = ordered.slice(0, limit).map((e) => e[0]);
  const remap = new Map<number, number>();
  for (const [key] of ordered.slice(limit)) {
    const r = (key >>> 24) & 255;
    const g = (key >>> 16) & 255;
    const b = (key >>> 8) & 255;
    const a = key & 255;
    let best = kept[0]!;
    let bestD = Infinity;
    for (const k of kept) {
      if (k < 0) continue;
      const dr = ((k >>> 24) & 255) - r;
      const dg = ((k >>> 16) & 255) - g;
      const db = ((k >>> 8) & 255) - b;
      const da = (k & 255) - a;
      const d = dr * dr * 2 + dg * dg * 4 + db * db * 3 + da * da * 4;
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    remap.set(key, best);
  }
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const key = ((data[i]! << 24) | (data[i + 1]! << 16) | (data[i + 2]! << 8) | data[i + 3]!) >>> 0;
    const to = remap.get(key);
    if (to === undefined) continue;
    data[i] = (to >>> 24) & 255;
    data[i + 1] = (to >>> 16) & 255;
    data[i + 2] = (to >>> 8) & 255;
    data[i + 3] = to & 255;
  }
  return total;
}

export function writeChunks(world: Canvas, chunkSize: number, outDir: string): ChunkStats {
  const cols = Math.ceil(world.w / chunkSize);
  const rows = Math.ceil(world.h / chunkSize);
  const stats: ChunkStats = { chunks: [], bytes: 0, reduced: 0, truecolor: 0, maxColors: 0 };
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * chunkSize;
      const y = row * chunkSize;
      const w = Math.min(chunkSize, world.w - x);
      const h = Math.min(chunkSize, world.h - y);
      const buf = new PixelBuffer(w, h);
      buf.copyFrom(world.buf, x, y, w, h, 0, 0);
      const colors = reduceColors(buf, 256);
      // Keep the world surface identical to what ships, so previews show the real output.
      if (colors > 256) world.buf.copyFrom(buf, 0, 0, w, h, x, y);
      stats.maxColors = Math.max(stats.maxColors, colors);
      if (colors > 256) stats.reduced++;
      const file = `ground_${col}_${row}.png`;
      const bytes = writePng(join(outDir, file), buf);
      stats.bytes += bytes;
      stats.chunks.push({ col, row, file, x, y, w, h });
    }
  }
  return stats;
}
