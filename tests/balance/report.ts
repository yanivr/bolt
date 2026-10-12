import { RIVAL_TEMPLATES } from '@bolt/content';
import { TOW } from '@bolt/shared';
import type { BalanceReport, RacingSummary, WeaponBench } from './harness.js';
import {
  NEON_CLEAR,
  NEON_RAIN,
  REACH_BANDS,
  WEAPON_REACH_PX,
  WIN_RATE_HIGH,
  WIN_RATE_LOW,
  formatBalance,
  formatBench,
  formatMatrix,
  reachBandLabel,
  runBalance,
  runWeaponBench,
} from './harness.js';
import type { UpgradeLine } from './upgrade.js';
import { UPGRADE_PAIRS, formatUpgrades, runUpgradeTest, upgradePace } from './upgrade.js';

/**
 * Prints the combat balance report as Markdown, for docs/evidence/balance/: the four targets of
 * the tow with it off and on, the matchup matrix, the upgrade test, how close the racing was,
 * every shipped build against every other and the weapon bench, over the same seeds.
 *
 *   npx tsx tests/balance/report.ts            four seeds, clear night
 *   npx tsx tests/balance/report.ts 8          eight seeds
 *   npx tsx tests/balance/report.ts 4 rain     in the rain
 *   npx tsx tests/balance/report.ts 4 clear bench   the weapon bench only, off and on
 *
 * The tow's own study, setting by setting, is `tests/balance/towStudy.ts`.
 */

const count = Math.max(1, Number(process.argv[2] ?? 4));
const weather = process.argv[3] === 'rain' ? NEON_RAIN : NEON_CLEAR;
const benchOnly = process.argv[4] === 'bench';
const seeds = Array.from({ length: count }, (_, i) => 1001 + i * 7919);
const started = Date.now();
const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
const f = (v: number, d = 1) => v.toFixed(d);

type Run = { balance: BalanceReport | null; bench: WeaponBench; upgrades: UpgradeLine[] | null };
const runs: Record<'off' | 'on', Run> = {
  off: {
    balance: benchOnly ? null : runBalance(seeds, weather, RIVAL_TEMPLATES, false),
    bench: runWeaponBench(seeds, weather, undefined, false),
    upgrades: benchOnly ? null : runUpgradeTest(seeds, false, weather),
  },
  on: {
    balance: benchOnly ? null : runBalance(seeds, weather, RIVAL_TEMPLATES, true),
    bench: runWeaponBench(seeds, weather, undefined, true),
    upgrades: benchOnly ? null : runUpgradeTest(seeds, true, weather),
  },
};

console.log(
  `Weather \`${weather}\`, seeds ${seeds.join(', ')}. Tow table (\`TOW\` in packages/shared/src/balance.ts): ` +
    `threshold ${TOW.thresholdGap} s, engage ${TOW.engageGap} s, whole bonus ${pct(TOW.maxBonus)} of top speed from ${TOW.fullGap} s, ` +
    `ramp ${TOW.rampUpPerSecond} up and ${TOW.rampDownPerSecond} down (whole bonuses a second), decided every ${TOW.updateSeconds} s, ` +
    `none in the first ${TOW.startDelaySeconds} s.\n`,
);

if (runs.off.balance && runs.on.balance && runs.off.upgrades && runs.on.upgrades) {
  const off = runs.off.balance;
  const on = runs.on.balance;
  const outside = (r: BalanceReport) =>
    r.templates.filter((t) => t.winRate > WIN_RATE_HIGH || t.winRate < WIN_RATE_LOW);
  const extremes = (r: BalanceReport) => {
    const rates = r.templates.map((t) => t.winRate);
    return `${pct(Math.min(...rates))} to ${pct(Math.max(...rates))}`;
  };
  const fmg = (r: BalanceReport, id: string) => r.weapons.find((w) => w.id === id);
  const upgradeCell = (lines: UpgradeLine[]) =>
    lines.map((l) => pct(l.winRate)).join(', ') +
    ` (lowest ${pct(Math.min(...lines.map((l) => l.winRate)))})`;
  const racing = (r: BalanceReport): RacingSummary => r.racing;

  console.log('## The four targets, tow off and on\n');
  console.log('| Target | Measure | Tow off | Tow on | Aim |');
  console.log('| :-- | :-- | --: | --: | :-- |');
  console.log(
    `| 1. Leading still pays | Races won by the car ahead at the end of lap 1 | ${pct(racing(off).lap1LeaderWins)} | ${pct(racing(on).lap1LeaderWins)} | 60 to 75%; under 60 the tow is too strong |`,
  );
  console.log(
    `| 2. No build outside 30 to 70% | Builds outside | ${outside(off).length} | ${outside(on).length} | none |`,
  );
  console.log(`|  | Lowest to highest win rate | ${extremes(off)} | ${extremes(on)} | 30 to 70% |`);
  console.log(
    `| 3. Combat happens | Seconds a race within ${WEAPON_REACH_PX} px | ${f(racing(off).reachSecondsPerRace)} | ${f(racing(on).reachSecondsPerRace)} | several times more |`,
  );
  console.log(
    `|  | Weapon activations a race (rounds) | ${f(racing(off).usesPerRace)} (${f(racing(off).roundsPerRace)}) | ${f(racing(on).usesPerRace)} (${f(racing(on).roundsPerRace)}) | several times more |`,
  );
  console.log(
    `|  | Damage dealt a race, both cars | ${f(racing(off).damagePerRace)} | ${f(racing(on).damagePerRace)} | several times more |`,
  );
  for (const id of ['weapon_front_mg', 'weapon_rear_mg']) {
    const a = fmg(off, id);
    const b = fmg(on, id);
    if (a && b)
      console.log(
        `|  | ${a.name}: activations a race (rounds) | ${f(a.meanUses)} (${f(a.meanRounds)}) | ${f(b.meanUses)} (${f(b.meanRounds)}) | |`,
      );
  }
  console.log(
    `| 4. Building well still pays | Upgraded twin's wins, each pair | ${upgradeCell(runs.off.upgrades)} | ${upgradeCell(runs.on.upgrades)} | clearly more than half |`,
  );
  console.log(
    `| Also | Lead changes a race | ${f(racing(off).leadChangesPerRace, 2)} | ${f(racing(on).leadChangesPerRace, 2)} | |`,
  );
  console.log(
    `|  | Of them, by a car with tow in the second before | ${racing(off).towPasses} | ${racing(on).towPasses} | 0 |`,
  );
  console.log(
    `|  | Mean time gap s | ${f(racing(off).meanGapSeconds, 2)} | ${f(racing(on).meanGapSeconds, 2)} | |`,
  );
  console.log(
    `|  | Share of the race a car had tow | ${pct(racing(off).towShare)} | ${pct(racing(on).towShare)} | |`,
  );
  console.log('');

  console.log(`## Time within ${WEAPON_REACH_PX} px and changes of the lead, per race\n`);
  console.log(
    `| Seconds within ${WEAPON_REACH_PX} px in a race | ${REACH_BANDS.map(reachBandLabel).join(' | ')} |`,
  );
  console.log(`| :-- | ${REACH_BANDS.map(() => '--:').join(' | ')} |`);
  for (const [label, r] of [
    ['Tow off', off],
    ['Tow on', on],
  ] as const)
    console.log(`| ${label} | ${racing(r).reachSpread.map(pct).join(' | ')} |`);
  console.log('');
  console.log('| Changes of the lead in a race | 0 | 1 | 2 | 3 or more |');
  console.log('| :-- | --: | --: | --: | --: |');
  for (const [label, r] of [
    ['Tow off', off],
    ['Tow on', on],
  ] as const)
    console.log(`| ${label} | ${racing(r).leadChangeSpread.map(pct).join(' | ')} |`);
  console.log('');

  console.log('## Upgrade test\n');
  console.log(
    'Each shipped build against the same build with one upgrade, armed as it ships, both grid slots, every seed.\n',
  );
  const pace = new Map(UPGRADE_PAIRS.map((pair) => [pair.id, upgradePace(pair)]));
  console.log(formatUpgrades(runs.off.upgrades, runs.on.upgrades, pace));
  console.log('');

  console.log('## Matchup matrix, tow off\n');
  console.log(formatMatrix(off));
  console.log('');
  console.log('## Matchup matrix, tow on\n');
  console.log(formatMatrix(on));
  console.log('');

  console.log('## Shipped builds, tow off\n');
  console.log(formatBalance(off));
  console.log('');
  console.log('## Shipped builds, tow on\n');
  console.log(formatBalance(on));
  console.log('');
}

console.log('## Weapon bench, tow off\n');
console.log(formatBench(runs.off.bench));
console.log('');
console.log('## Weapon bench, tow on\n');
console.log(formatBench(runs.on.bench));
console.log('');
console.log(`Simulated in ${((Date.now() - started) / 1000).toFixed(1)} s.`);
