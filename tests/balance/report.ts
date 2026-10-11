import {
  NEON_CLEAR,
  NEON_RAIN,
  formatBalance,
  formatBench,
  runBalance,
  runWeaponBench,
} from './harness.js';

/**
 * Prints the combat balance report as Markdown, for docs/evidence/balance/.
 *
 *   npx tsx tests/balance/report.ts            four seeds, clear night
 *   npx tsx tests/balance/report.ts 8          eight seeds
 *   npx tsx tests/balance/report.ts 4 rain     in the rain
 *   npx tsx tests/balance/report.ts 4 clear bench   the weapon bench only
 */

const count = Math.max(1, Number(process.argv[2] ?? 4));
const weather = process.argv[3] === 'rain' ? NEON_RAIN : NEON_CLEAR;
const seeds = Array.from({ length: count }, (_, i) => 1001 + i * 7919);
const started = Date.now();
if (process.argv[4] !== 'bench') {
  console.log(formatBalance(runBalance(seeds, weather)));
  console.log('');
}
console.log(formatBench(runWeaponBench(seeds, weather)));
console.log(`\nSimulated in ${((Date.now() - started) / 1000).toFixed(1)} s.`);
