import { RIVAL_TEMPLATES } from '@bolt/content';
import { TOW } from '@bolt/shared';
import {
  NEON_CLEAR,
  WIN_RATE_HIGH,
  WIN_RATE_LOW,
  runBalance,
  runBotMatch,
} from '../balance/harness.js';
import { unarmed, withTow } from '../balance/tow.js';
import { runUpgradeTest } from '../balance/upgrade.js';

/** One-seed figures for the bands in tests/balance/balance.test.ts: off, as shipped, halved, doubled. */
const SEED = 1001;
const PAIRS: Array<[string, string]> = [
  ['example_straight_line_rocket', 'example_tiny_trouble'],
  ['example_tiny_trouble', 'starter_sprinter'],
  ['starter_sprinter', 'starter_tinker'],
  ['starter_tinker', 'example_back_alley_trap'],
  ['example_back_alley_trap', 'starter_rookie'],
  ['example_rain_runner', 'example_dust_spider'],
];
const t = (id: string) => RIVAL_TEMPLATES.find((x) => x.id === id)!;
for (const [label, tow, change] of [
  ['off', false, null],
  ['on', true, null],
  ['halved', true, { maxBonus: TOW.maxBonus / 2 }],
  ['doubled', true, { maxBonus: TOW.maxBonus * 2 }],
] as const) {
  withTow(change, () => {
    const r = runBalance([SEED], NEON_CLEAR, RIVAL_TEMPLATES, tow);
    let gap = 0;
    let fastWon = 0;
    let passes = 0;
    const gaps: string[] = [];
    for (const [fast, slow] of PAIRS)
      for (const slot of [0, 1]) {
        const cars = [unarmed(t(fast)), unarmed(t(slow))];
        const m =
          slot === 0
            ? runBotMatch(cars[0]!, cars[1]!, SEED, NEON_CLEAR, tow)
            : runBotMatch(cars[1]!, cars[0]!, SEED, NEON_CLEAR, tow);
        if (m.winner === slot) fastWon++;
        gap += m.gapAtFinish ?? 0;
        gaps.push((m.gapAtFinish ?? 0).toFixed(2));
        passes += m.towPasses;
      }
    const up = runUpgradeTest([SEED], tow);
    const outside = r.templates.filter(
      (x) => x.winRate > WIN_RATE_HIGH || x.winRate < WIN_RATE_LOW,
    ).length;
    console.log(
      label,
      `lap1 ${r.racing.lap1LeaderWins.toFixed(3)} towShare ${r.racing.towShare.toFixed(3)} uses ${r.racing.usesPerRace.toFixed(2)} reach ${r.racing.reachSecondsPerRace.toFixed(2)} within15 ${r.racing.within15.toFixed(3)} beyond3 ${r.racing.beyond3.toFixed(3)} dmg ${r.racing.damagePerRace.toFixed(1)} outside ${outside} armedPasses ${r.racing.towPasses}`,
      `| unarmed fastWon ${fastWon}/12 meanGap ${(gap / 12).toFixed(2)} passes ${passes} gaps ${gaps.join(' ')}`,
      `| upgrades ${up.map((u) => `${u.pair.id} ${u.wins}/${u.races}`).join(', ')}`,
    );
  });
}
