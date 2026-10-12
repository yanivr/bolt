import { TRACKS, getTrack } from '@bolt/content';
import { buildTrack, layoutPrimitives, rasterizeLayout } from '@bolt/shared';
import { PixelBuffer, writePng } from '../../art/scripts/lib/pixels.js';
import { driveDefaultCar } from '../helpers/trackDrive.js';

/**
 * Review tool for track layouts: writes the layout view of a track as a PNG (flat surfaces,
 * walls, obstacles, hazards, checkpoints and corner signs, with the default car's driven line
 * on top) and prints the default car's race time on it.
 *
 *   npx tsx tests/tools/trackview.ts <trackId|all> [scale] [outDir] [presetId]
 */

const [which = 'all', scaleArg = '0.25', outDir = 'art/preview/tracks', presetArg] =
  process.argv.slice(2);
const ids = which === 'all' ? Object.keys(TRACKS) : [which];
const scale = Number(scaleArg);
for (const id of ids) {
  const def = getTrack(id);
  if (!def) throw new Error(`no track ${id}`);
  const t0 = performance.now();
  const track = buildTrack(def);
  const built = performance.now() - t0;
  const preset = presetArg ?? def.weatherPresetIds[0]!;
  const run = driveDefaultCar(track, preset);
  const prims = layoutPrimitives(track, { anchors: true });
  const w = Math.ceil(def.worldWidth * scale);
  const h = Math.ceil(def.worldHeight * scale);
  const img = rasterizeLayout(prims, w, h, scale);
  const buf = new PixelBuffer(w, h);
  buf.data.set(img.data);
  // The driven line: cyan dots, darker where the car was slow.
  for (const p of run.path) {
    const x = Math.round(p.x * scale);
    const y = Math.round(p.y * scale);
    const k = Math.min(1, p.speed / 270);
    buf.set(x, y, [Math.round(40 + 60 * k), Math.round(120 + 135 * k), 255, 255]);
  }
  const file = `${outDir}/${id}_layout.png`;
  writePng(file, buf);
  console.log(
    `${id} ${def.name}: world ${def.worldWidth}x${def.worldHeight}, lap ${Math.round(track.lapLength)} px, built in ${built.toFixed(0)} ms; ` +
      `${preset}: race ${run.raceSeconds.toFixed(1)} s, laps ${run.laps.map((l) => (l / 1000).toFixed(1)).join(' / ')} s, ` +
      `walls ${run.wallStrikes}, offroad ${(run.offroadShare * 100).toFixed(1)}%, finished ${run.finished}; ` +
      `surfaces ${Object.entries(run.surfaceShare)
        .map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`)
        .join(
          ', ',
        )}; signs ${track.cornerSigns.length}; checkpoints ${track.checkpoints.length} -> ${file}`,
  );
}
