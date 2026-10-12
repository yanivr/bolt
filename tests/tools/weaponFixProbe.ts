import { writeFileSync } from 'node:fs';
import { ACCESSORIES, RIVAL_TEMPLATES } from '@bolt/content';
import {
  NEON_CLEAR,
  WIN_RATE_HIGH,
  WIN_RATE_LOW,
  runBalance,
  runWeaponBench,
} from '../balance/harness.js';
import { runUpgradeTest } from '../balance/upgrade.js';

/**
 * Measures a candidate change to the bullet guns WITHOUT applying it to the catalog: the
 * change is written into the in-memory part params for the length of this process only.
 * Weapon balance is the product owner's call; this tool only produces the numbers for a
 * proposal (docs/BALANCE_CHANGELOG.md).
 *
 *   npx tsx tests/tools/weaponFixProbe.ts <fix> [seeds] [out.json]
 *
 * Fixes: none, dmg2 (3 to 2 damage a round), ammo (a magazine of bursts a race), heat (more heat
 * a burst), cooldown (longer wait between bursts). Front Machine Gun, Rear Sentry and Swivel
 * Turret.
 */

type Change = Record<string, Record<string, number>>;
const FIXES: Record<string, Change> = {
  none: {},
  dmg2: {
    weapon_front_mg: { damagePerBullet: 2 },
    weapon_rear_mg: { damagePerBullet: 2 },
    weapon_turret: { damage: 12 },
  },
  ammo: {
    weapon_front_mg: { charges: 12 },
    weapon_rear_mg: { charges: 8 },
    weapon_turret: { charges: 8 },
  },
  heat: {
    weapon_front_mg: { heatPerShot: 8 },
    weapon_rear_mg: { heatPerShot: 8 },
    weapon_turret: { heatPerShot: 12 },
  },
  cooldown: {
    weapon_front_mg: { cooldownSeconds: 2.1 },
    weapon_rear_mg: { cooldownSeconds: 4.8 },
    weapon_turret: { cooldownSeconds: 4.5 },
  },
};

const [fix = 'none', count = '4', out] = process.argv.slice(2);
const change = FIXES[fix];
if (!change) throw new Error(`unknown fix ${fix}`);
for (const [id, params] of Object.entries(change)) {
  const def = ACCESSORIES[id];
  if (!def) throw new Error(`no part ${id}`);
  Object.assign(def.params, params);
}
const seeds = Array.from({ length: Number(count) }, (_, i) => 1001 + i * 7919);
const started = Date.now();
const bench = runWeaponBench(seeds, NEON_CLEAR, undefined, true);
const balance = runBalance(seeds, NEON_CLEAR, RIVAL_TEMPLATES, true);
const upgrades = runUpgradeTest(seeds, true);
const row = {
  fix,
  change,
  bench: {
    median: bench.medianDamagePer100,
    lines: bench.lines.map((l) => ({
      id: l.id,
      ratio: l.ratio,
      damagePer100: l.damagePer100,
      winRate: l.winRate,
      wrecks: l.wrecks,
      uses: l.meanUses,
      peakHeat: l.peakHeat,
      heatLimited: l.heatLimited,
      thermalBlocked: l.thermalBlocked,
    })),
  },
  lap1LeaderWins: balance.racing.lap1LeaderWins,
  outside: balance.templates
    .filter((t) => t.winRate > WIN_RATE_HIGH || t.winRate < WIN_RATE_LOW)
    .map((t) => `${t.name} ${(t.winRate * 100).toFixed(0)}%`),
  reachSeconds: balance.racing.reachSecondsPerRace,
  uses: balance.racing.usesPerRace,
  damage: balance.racing.damagePerRace,
  weapons: balance.weapons.map((w) => ({
    id: w.id,
    ratio: w.ratio,
    uses: w.meanUses,
    damage: w.meanDamage,
    thermalBlocked: w.thermalBlocked,
  })),
  upgrades: upgrades.map((u) => ({ id: u.pair.id, winRate: u.winRate, meanGap: u.meanGap })),
  seconds: (Date.now() - started) / 1000,
};
if (out) writeFileSync(out, JSON.stringify(row));
console.log(JSON.stringify(row, null, 1));
