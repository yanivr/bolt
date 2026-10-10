import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CHASSIS_LIST, TEMPLATES, allParts } from '@bolt/content';
import {
  BLUEPRINT_ISSUE_CODES,
  BLUEPRINT_ISSUE_COPY,
  OVERWEIGHT_HINT,
  STATS_WARNING_COPY,
  TURRET_BLOCKED_COPY,
  accessoryMounts,
} from '@bolt/shared';
import { describe, expect, it } from 'vitest';
import { NEON_DRY, NEON_RAIN, runBuild } from '../feel/builds.js';
import { chassisTables, partTable } from '../tools/catalogTables.js';

/** The reference documents quote the catalog and measurements. These keep them honest. */

/** Text with table padding and separator rows removed, so reformatting a document is harmless. */
function rows(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !/^\|[\s:|-]+\|$/.test(line))
    .map((line) =>
      line.startsWith('|')
        ? line
            .split('|')
            .map((cell) => cell.trim())
            .join('|')
        : line,
    );
}

function between(text: string, name: string): string[] {
  const begin = `<!-- BEGIN ${name} -->`;
  const end = `<!-- END ${name} -->`;
  return rows(text.slice(text.indexOf(begin) + begin.length, text.indexOf(end)));
}

const garageText = readFileSync(resolve('docs/GARAGE_API.md'), 'utf8');
const garage = rows(garageText);
const balance = rows(readFileSync(resolve('docs/BALANCE_CHANGELOG.md'), 'utf8'));

describe('docs/GARAGE_API.md', () => {
  it('lists every part id with its current footprint and compatible mounts', () => {
    expect(between(garageText, 'PART TABLE')).toEqual(rows(partTable()));
    for (const part of allParts()) {
      const row = garage.find((line) => line.startsWith(`|\`${part.id}\`|`));
      expect(row, part.id).toBeDefined();
      expect(row, part.id).toContain(`|${part.footprint.w} x ${part.footprint.h}|`);
      if (part.category !== 'chassis')
        expect(row, part.id).toContain(part.compatibleMounts.join(', '));
    }
  });

  it('lists every mount of every chassis as the catalog has it', () => {
    expect(between(garageText, 'CHASSIS TABLES')).toEqual(rows(chassisTables()));
    for (const chassis of CHASSIS_LIST)
      for (const mount of accessoryMounts(chassis))
        expect(
          garage.some((line) => line.startsWith(`|\`${mount.id}\`|`)),
          `${chassis.id} ${mount.id}`,
        ).toBe(true);
  });

  it('documents every validation code with its exact player copy', () => {
    for (const code of BLUEPRINT_ISSUE_CODES) {
      const row = garage.find((line) => line.startsWith(`|\`${code}\`|`));
      expect(row, code).toBeDefined();
      expect(row, code).toContain(BLUEPRINT_ISSUE_COPY[code]);
    }
    expect(garageText).toContain(TURRET_BLOCKED_COPY);
    expect(garageText).toContain(OVERWEIGHT_HINT);
    for (const [code, message] of Object.entries(STATS_WARNING_COPY))
      expect(garage, code).toContain(`|\`${code}\`|${message}|`);
  });
});

describe('docs/BALANCE_CHANGELOG.md', () => {
  it(
    'records the measured table for every shipped blueprint as the simulator produces it today',
    { timeout: 300_000 },
    () => {
      const f = (v: number | null, d = 1) => (v === null ? 'n/a' : v.toFixed(d));
      for (const template of TEMPLATES) {
        const dry = runBuild(template.blueprint, NEON_DRY);
        const rain = runBuild(template.blueprint, NEON_RAIN);
        const row = balance.find((line) => line.startsWith(`|${template.name}|${dry.cost}|`));
        expect(row, template.name).toBeDefined();
        expect(row?.split('|').slice(3, 11), template.name).toEqual([
          f(dry.massKg, 0),
          String(dry.stability),
          f(dry.raceSeconds),
          f(dry.bestLapSeconds),
          f(dry.topMph),
          f(dry.zeroToSixty, 2),
          f(rain.raceSeconds),
          f(rain.topMph),
        ]);
      }
    },
  );
});
