import { readFileSync } from 'node:fs';
import { ACCESSORIES } from '@bolt/content';
import { CONTROL_WEAPONS, formatSummary } from './harness.js';
import type { TowStudyRow } from './tow.js';
import { STUDY_HEADER, byPace, formatStudyRow, unarmedVerdict } from './tow.js';

/**
 * Turns rows measured by `tests/balance/towStudy.ts` into the tables of
 * docs/evidence/balance/tow-study.md.
 *
 *   npx tsx tests/balance/towReport.ts off.json a.json b.json ...        the table of settings
 *   npx tsx tests/balance/towReport.ts off.json chosen.json --detail     off against one setting
 *
 * The first file is always the reference with the tow off.
 */

const args = process.argv.slice(2);
const detail = args.includes('--detail');
const rows = args
  .filter((arg) => !arg.startsWith('--'))
  .map((file) => JSON.parse(readFileSync(file, 'utf8')) as TowStudyRow);
const off = rows[0];
if (!off) throw new Error('give the reference row first');
const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
const name = (id: string) => ACCESSORIES[id]?.displayName ?? id;

if (!detail) {
  console.log(STUDY_HEADER.join('\n'));
  for (const row of rows) console.log(formatStudyRow(row, off));
} else {
  const on = rows[1];
  if (!on) throw new Error('give the setting to compare');
  console.log(`Seeds ${on.seeds.join(', ')}. Table: \`${JSON.stringify(on.tuning)}\`\n`);
  console.log(formatSummary('Shipped builds, tow off', off.armed));
  console.log('');
  console.log(formatSummary('Shipped builds, tow on', on.armed));
  console.log('');
  console.log('| Build | Win rate, tow off | Win rate, tow on |');
  console.log('| :-- | --: | --: |');
  for (const line of off.winRates) {
    const after = on.winRates.find((w) => w.id === line.id)!;
    console.log(`| ${line.name} | ${pct(line.winRate)} | ${pct(after.winRate)} |`);
  }
  console.log('');
  console.log(
    '| Weapon on a shipped build | Uses a race, off | Uses a race, on | Factor | Damage a race, off | Damage a race, on |',
  );
  console.log('| :-- | --: | --: | --: | --: | --: |');
  for (const w of off.weaponUses) {
    const after = on.weaponUses.find((x) => x.id === w.id)!;
    console.log(
      `| ${name(w.id)} | ${w.meanUses.toFixed(1)} | ${after.meanUses.toFixed(1)} | ${w.meanUses > 0 ? (after.meanUses / w.meanUses).toFixed(1) : 'n/a'}x | ${w.meanDamage.toFixed(1)} | ${after.meanDamage.toFixed(1)} |`,
    );
  }
  if (off.armedRaces && on.armedRaces) {
    console.log('');
    console.log(
      '| Pace apart (gap at the line, unarmed, tow off) | Pairings | Uses a race, off to on | Factor | Damage a race, off to on | Within 1.5 s, off to on | Within 220 px, off to on | Beyond 3 s, off to on |',
    );
    console.log('| :-- | --: | :-- | --: | :-- | :-- | :-- | :-- |');
    for (const band of byPace(off, on))
      console.log(
        `| ${band.label} | ${band.pairings} | ${band.uses[0].toFixed(1)} to ${band.uses[1].toFixed(1)} | ${band.uses[0] > 0 ? (band.uses[1] / band.uses[0]).toFixed(1) : 'n/a'}x | ${band.damage[0].toFixed(0)} to ${band.damage[1].toFixed(0)} | ${pct(band.within15[0])} to ${pct(band.within15[1])} | ${pct(band.withinReach[0])} to ${pct(band.withinReach[1])} | ${pct(band.beyond3[0])} to ${pct(band.beyond3[1])} |`,
      );
  }
  console.log('');
  console.log(formatSummary('Unarmed pairs, tow off', off.unarmed));
  console.log('');
  console.log(formatSummary('Unarmed pairs, tow on', on.unarmed));
  const v = unarmedVerdict(off, on);
  console.log('');
  console.log(
    `Unarmed: the car that won with the tow off won with it on in ${v.held} of ${v.races} races. ` +
      `Mean gap when the winner crossed the line: ${v.meanGapOff.toFixed(2)} s off, ${v.meanGapOn.toFixed(2)} s on. ` +
      `Changes of the lead after the first five seconds: ${v.leadChanges}, of which ${v.towPasses} by a car with tow in the second before.`,
  );
  for (const flip of v.flipped)
    console.log(
      `- flipped: ${flip.key}, won by ${flip.offGap?.toFixed(2) ?? 'n/a'} s off, by ${flip.onGap?.toFixed(2) ?? 'n/a'} s the other way on`,
    );
  if (off.bench && on.bench) {
    console.log('');
    console.log(formatSummary('Weapon bench, tow off', off.bench.racing));
    console.log('');
    console.log(formatSummary('Weapon bench, tow on', on.bench.racing));
    console.log('');
    console.log(
      `| Weapon (bench) | Price | Uses off | Uses on | Damage off | Damage on | Per 100 credits off | Per 100 credits on | Against median off (${off.bench.medianDamagePer100.toFixed(1)}) | Against median on (${on.bench.medianDamagePer100.toFixed(1)}) | Wins vs twin off | on | Twin wrecked off | on | Peak heat on | Race share over the heat threshold on |`,
    );
    console.log(
      '| :-- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |',
    );
    for (const line of on.bench.lines) {
      const before = off.bench.lines.find((l) => l.id === line.id)!;
      const control = CONTROL_WEAPONS.has(line.id);
      console.log(
        `| ${name(line.id)} | ${ACCESSORIES[line.id]?.price ?? 0} | ${before.meanUses.toFixed(1)} | ${line.meanUses.toFixed(1)} | ${before.meanDamage.toFixed(1)} | ${line.meanDamage.toFixed(1)} | ${before.damagePer100.toFixed(1)} | ${line.damagePer100.toFixed(1)} | ${control ? 'control' : `${before.ratio.toFixed(2)}x`} | ${control ? 'control' : `${line.ratio.toFixed(2)}x`} | ${pct(before.winRate)} | ${pct(line.winRate)} | ${before.wrecks} | ${line.wrecks} | ${line.peakHeat?.toFixed(0) ?? 'n/a'} | ${line.heatLimited === undefined ? 'n/a' : pct(line.heatLimited)} |`,
      );
    }
  }
}
