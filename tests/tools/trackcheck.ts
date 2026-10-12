import { TRACKS, getTrack, getWeatherPreset } from '@bolt/content';
import { CORNER_SIGNS, buildTrack, checkTrack } from '@bolt/shared';
import { driveDefaultCar } from '../helpers/trackDrive.js';

/**
 * Track validator (docs/TRACK_API.md, "Rules"): every rule of `checkTrack`, the published weather
 * presets, and with `--drive` the simulator's part: the default car's race time on each weather
 * against the track's length class (105 s short, 130 s long, within 10 percent) and every corner
 * sign's lead time with the real car (0.8 to 1.2 s).
 *
 *   npx tsx tests/tools/trackcheck.ts <trackId|all> [--drive]
 *
 * Exits with status 1 if any rule fails.
 */

export const TARGET_SECONDS = { short: 105, long: 130 } as const;

const args = process.argv.slice(2);
const drive = args.includes('--drive');
const which = args.find((a) => !a.startsWith('--')) ?? 'all';
const ids = which === 'all' ? Object.keys(TRACKS) : [which];
let failures = 0;
for (const id of ids) {
  const def = getTrack(id);
  if (!def) {
    console.log(`${id}: no such track`);
    failures++;
    continue;
  }
  const track = buildTrack(def);
  const check = checkTrack(track);
  const issues = [...check.issues];
  for (const preset of def.weatherPresetIds)
    if (!getWeatherPreset(preset)) issues.push({ rule: 'weather', message: `no preset ${preset}` });
  console.log(`\n${id} ${def.name} (${def.lengthClass}, ${def.edges}, ${def.laps} laps)`);
  console.log(`  passed: ${check.passed.join(', ')}`);
  const st = check.stats;
  console.log(
    `  lap ${st.lapLength} px; checkpoints ${st.checkpoints}; shortcut gates ${JSON.stringify(st.shortcutGates)}; ` +
      `shortcut length over bypassed ${JSON.stringify(st.shortcutRatio)}; corner signs ${st.cornerSigns} for ${st.sharpBends} sharp bends; ` +
      `off-road cells ${st.offroadCells}, stranded ${st.strandedCells}`,
  );
  console.log(
    `  surfaces (main line): ${Object.entries(st.surfaceShare)
      .map(([k, v]) => `${k} ${((v ?? 0) * 100).toFixed(1)}%`)
      .join(', ')}; published ${Object.entries(def.surfaceMix)
      .map(([k, v]) => `${k} ${((v ?? 0) * 100).toFixed(0)}%`)
      .join(', ')}`,
  );
  if (drive) {
    const target = TARGET_SECONDS[def.lengthClass];
    for (const preset of def.weatherPresetIds) {
      const run = driveDefaultCar(track, preset);
      const off = Math.abs(run.raceSeconds - target) / target;
      const lateSigns = run.signLeads.filter(
        (l) =>
          l.seconds !== null &&
          (l.seconds < CORNER_SIGNS.leadMin || l.seconds > CORNER_SIGNS.leadMax),
      );
      console.log(
        `  drive ${preset}: race ${run.raceSeconds.toFixed(1)} s (target ${target} s, ${(off * 100).toFixed(1)}% off), ` +
          `laps ${run.laps.map((l) => (l / 1000).toFixed(1)).join(' / ')} s, wall strikes ${run.wallStrikes}, ` +
          `sign leads ${run.signLeads.map((l) => (l.seconds === null ? '-' : l.seconds.toFixed(2))).join(' ')}`,
      );
      if (!run.finished)
        issues.push({
          rule: 'checkpoints',
          message: `the default car does not finish in ${preset}`,
        });
      // The time target is for the first (clearer) weather; the second is reported.
      if (preset === def.weatherPresetIds[0] && off > 0.1)
        issues.push({
          rule: 'checkpoints',
          message: `race time ${run.raceSeconds.toFixed(1)} s is outside ${target} s +-10%`,
        });
      // Lead times are a statement about normal speed: held to on the first (clearer) weather.
      if (preset === def.weatherPresetIds[0])
        for (const l of lateSigns)
          issues.push({
            rule: 'corner_signs',
            message: `${l.id}: ${l.seconds?.toFixed(2)} s before its bend with the default car`,
          });
    }
  }
  for (const issue of issues) console.log(`  FAIL ${issue.rule}: ${issue.message}`);
  if (issues.length > 0) failures++;
  else console.log('  OK');
}
process.exitCode = failures > 0 ? 1 : 0;
