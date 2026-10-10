import { TEMPLATES } from '@bolt/content';
import { NEON_DRY, NEON_RAIN, runBuild } from './builds.js';

/**
 * Prints the measured table for every shipped blueprint on Neon Cut, dry and in the rain, as
 * Markdown for docs/BALANCE_CHANGELOG.md.
 *
 *   npx tsx tests/feel/buildsReport.ts
 */

const f = (v: number | null, d = 1) => (v === null ? 'n/a' : v.toFixed(d));

console.log(
  '| Build | Cost | Mass kg | Stability | Dry race s | Dry best lap s | Dry top MPH | 0 to 60 s | Rain race s | Rain top MPH | Peak slip dry / rain | Peak heat dry | Low power s dry | Walls dry / rain |',
);
console.log(
  '| :-- | --: | --: | --: | --: | --: | --: | --: | --: | --: | :-- | --: | --: | :-- |',
);
for (const template of TEMPLATES) {
  const dry = runBuild(template.blueprint, NEON_DRY);
  const rain = runBuild(template.blueprint, NEON_RAIN);
  console.log(
    `| ${template.name} | ${dry.cost} | ${f(dry.massKg, 0)} | ${dry.stability} | ${f(dry.raceSeconds)}${dry.finished ? '' : ' (DNF)'} | ${f(dry.bestLapSeconds)} | ${f(dry.topMph)} | ${f(dry.zeroToSixty, 2)} | ${f(rain.raceSeconds)}${rain.finished ? '' : ' (DNF)'} | ${f(rain.topMph)} | ${f(dry.peakSlipDeg)} / ${f(rain.peakSlipDeg)} | ${f(dry.peakHeat, 0)} | ${f(dry.lowPowerSeconds)} | ${dry.wallStrikes} / ${rain.wallStrikes} |`,
  );
}
