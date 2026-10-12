import { TEMPLATES, conditionsFor, environmentFor, getTrack, raceEntry } from '@bolt/content';
import type { BuildConditions, RaceEnvironment } from '@bolt/shared';
import { buildTrack, layoutPrimitives, rasterizeLayout, routePlan } from '@bolt/shared';
import { PixelBuffer, writePng } from '../../art/scripts/lib/pixels.js';

/**
 * Review tool for the AI's racing lines: the layout view of a track with the line a build
 * would drive on every branch (red on the main line, magenta on shortcuts, faint yellow for the
 * band of good ground it may use).
 *
 *   npx tsx tests/tournament/lineview.ts <trackId> [presetId] [templateId] [scale] [out.png]
 */
const [id = 'city_01', presetArg, templateId = 'baseline', scaleArg = '0.3', outArg] =
  process.argv.slice(2);
const def = getTrack(id)!;
const preset = presetArg ?? def.weatherPresetIds[0]!;
const track = buildTrack(def);
const env = environmentFor(preset) as RaceEnvironment;
const cond = conditionsFor(id, preset) as BuildConditions;
const params = raceEntry(TEMPLATES.find((t) => t.id === templateId)!.blueprint, cond)!.params;
const plan = routePlan(track, params, env);
const scale = Number(scaleArg);
const w = Math.ceil(def.worldWidth * scale);
const h = Math.ceil(def.worldHeight * scale);
const img = rasterizeLayout(layoutPrimitives(track, { anchors: false }), w, h, scale);
const buf = new PixelBuffer(w, h);
buf.data.set(img.data);
const mask = Number(process.env.MASK ?? (1 << plan.shortcuts.length) - 1);
for (const line of [plan.routes[0]!, plan.routes[mask]!]) {
  for (let i = 0; i < line.count; i++) {
    const nx = -line.ty[i]!;
    const ny = line.tx[i]!;
    for (const lat of [line.lo[i]!, line.hi[i]!]) {
      buf.set(
        Math.round((line.x[i]! + nx * lat) * scale),
        Math.round((line.y[i]! + ny * lat) * scale),
        [240, 220, 60, 255],
      );
    }
    const x = line.x[i]! + nx * line.offset[i]!;
    const y = line.y[i]! + ny * line.offset[i]!;
    const slow = Math.min(1, line.limit[i]! / 300);
    const color: [number, number, number, number] =
      line.mask === 0 ? [255, Math.round(255 * slow), 40, 255] : [255, 60, 255, 255];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        buf.set(Math.round(x * scale) + dx, Math.round(y * scale) + dy, color);
  }
}
const out = outArg ?? `${id}_${templateId}_line.png`;
const crop = process.argv[7]?.split(',').map(Number);
if (crop && crop.length === 3) {
  // A window round (x, y) in world pixels with a half-size, drawn at this scale.
  const [cx, cy, half] = crop as [number, number, number];
  const x0 = Math.max(0, Math.round((cx - half) * scale));
  const y0 = Math.max(0, Math.round((cy - half) * scale));
  const size = Math.round(2 * half * scale);
  const win = new PixelBuffer(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const k = ((y0 + y) * w + (x0 + x)) * 4;
      win.set(x, y, [buf.data[k]!, buf.data[k + 1]!, buf.data[k + 2]!, 255]);
    }
  writePng(out, win);
} else writePng(out, buf);
console.log(
  `${out}: laps ${plan.routes.map((r) => r.lapSeconds.toFixed(1)).join(' / ')}; shortcuts ${plan.shortcuts.map((s) => `${def.shortcuts[s.branch - 1]?.signName} gain ${s.gain.toFixed(2)} s (naive ${s.naiveGain.toFixed(2)})`).join(', ')}`,
);
