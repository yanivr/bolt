import { sampleBranch } from '@bolt/shared';
import type { TrackRuntime } from '@bolt/shared';
import { Canvas } from './canvas.js';
import type { Color } from './canvas.js';

/** Corridor-only minimap on transparency: thick main line, thin shortcuts, a start bar. */
export function drawMinimap(
  track: TrackRuntime,
  width: number,
  colors: { road: Color; shortcut: Color; start: Color; outline: Color },
): { canvas: Canvas; worldScale: number } {
  const scale = width / track.def.worldWidth;
  const height = Math.round(track.def.worldHeight * scale);
  const cv = new Canvas(width, height);
  const dot = (wx: number, wy: number, size: number, c: Color): void => {
    const x = Math.round(wx * scale - size / 2);
    const y = Math.round(wy * scale - size / 2);
    cv.rect(x, y, size, size, c);
  };
  // Dark outline first so the line holds up over any HUD backing.
  for (const branch of track.branches) {
    const size = branch.index === 0 ? 4 : 3;
    for (let s = 0; s <= branch.length; s += 2) {
      const p = sampleBranch(branch, s);
      dot(p.x, p.y, size, colors.outline);
    }
  }
  for (const branch of track.branches) {
    if (branch.index === 0) continue;
    for (let s = 0; s <= branch.length; s += 2) {
      const p = sampleBranch(branch, s);
      dot(p.x, p.y, 1, colors.shortcut);
    }
  }
  for (let s = 0; s <= track.main.length; s += 2) {
    const p = sampleBranch(track.main, s);
    dot(p.x, p.y, 2, colors.road);
  }
  const st = sampleBranch(track.main, track.startS);
  for (let k = -3; k <= 3; k++) {
    const wx = st.x + (-st.ty * k) / scale;
    const wy = st.y + (st.tx * k) / scale;
    const x = Math.round(wx * scale - 1);
    const y = Math.round(wy * scale - 1);
    cv.rect(x, y, 3, 2, Math.abs(k) === 3 ? colors.outline : colors.start);
  }
  return { canvas: cv, worldScale: scale };
}
