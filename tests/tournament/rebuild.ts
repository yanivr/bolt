import { readFileSync, writeFileSync } from 'node:fs';
import type { ConstructionRow, Played, ShortcutRow } from './report.js';
import { buildReport } from './report.js';

/**
 * Rebuilds a tournament report from its saved JSON without running a race (the report is a pure
 * function of the records). Older JSON without `raceSeconds` or `repeats` takes them as flags.
 *
 *   npx tsx tests/tournament/rebuild.ts <records.json> <out.md> [--race-seconds n] [--repeats n]
 */
const [jsonFile, outFile, ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const i = rest.indexOf(name);
  return i >= 0 ? Number(rest[i + 1]) : undefined;
};
const data = JSON.parse(readFileSync(jsonFile!, 'utf8')) as {
  command: string;
  seconds: number;
  raceSeconds?: number;
  workers: number;
  desync: string[];
  repeats?: number;
  quick?: boolean;
  races: Played[];
  shortcuts: ShortcutRow[];
  construction: ConstructionRow[];
  templateSolo: ConstructionRow[];
};
const report = buildReport(data.races, {
  command: data.command,
  seconds: data.seconds,
  raceSeconds: data.raceSeconds ?? flag('--race-seconds') ?? Number.NaN,
  workers: data.workers,
  desync: data.desync,
  repeats: data.repeats ?? flag('--repeats') ?? 0,
  quick: data.quick ?? data.command.includes('--quick'),
  shortcuts: data.shortcuts,
  construction: data.construction,
  templateSolo: data.templateSolo,
});
writeFileSync(outFile!, `${report}\n`);
console.error(`${data.races.length} races -> ${outFile}`);
