import { writeFileSync } from 'node:fs';
import type { TowTuning } from '@bolt/shared';
import { measureSetting } from './tow.js';

/**
 * Measures one setting of the tow table and writes the row as JSON.
 *
 *   npx tsx tests/balance/towStudy.ts <label> off out.json            the reference, tow off
 *   npx tsx tests/balance/towStudy.ts <label> '{}' out.json           the table as shipped
 *   npx tsx tests/balance/towStudy.ts <label> '{"maxBonus":0.05}' out.json [seeds] [bench]
 *
 * `tests/balance/towReport.ts` turns a set of these rows into the study's tables.
 */

const [label = 'shipped', setting = '{}', out, count = '4', bench] = process.argv.slice(2);
const seeds = Array.from({ length: Math.max(1, Number(count)) }, (_, i) => 1001 + i * 7919);
const override = setting === 'off' ? null : (JSON.parse(setting) as Partial<TowTuning>);
const row = measureSetting(label, override, seeds, bench === 'bench');
if (out) writeFileSync(out, JSON.stringify(row));
const { unarmedRaces: _races, armedRaces: _armed, ...brief } = row;
void _races;
void _armed;
console.log(JSON.stringify(brief, null, 1));
