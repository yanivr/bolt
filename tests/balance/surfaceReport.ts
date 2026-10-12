import { writeFileSync } from 'node:fs';
import { RIVAL_TEMPLATES, conditionsFor, environmentFor, raceEntry } from '@bolt/content';
import type { BuildConditions, RaceEnvironment, SurfaceId } from '@bolt/shared';
import {
  DEEP_GROUND_FLOOR,
  createMotionState,
  createPowertrainOutput,
  createTelemetry,
  stepStraight,
} from '@bolt/shared';
import { runSolo } from '../tournament/harness.js';
import { COURSES } from '../tournament/plan.js';

/**
 * Can every shipped build get round every course, and how much does the ground cost each one?
 * (docs/BALANCE_CHANGELOG.md, loose-ground resistance.) Two parts:
 *
 * - Straight line: forward speed after 5, 10 and 30 s flat out from rest, and after 60 s (about
 *   terminal), on each loose surface in the weather of a course that has it, for every starter
 *   and example build. `stepStraight` runs the same powertrain, heat, grip and rolling terms as
 *   the race.
 * - Solo races: each build alone on each of the 16 courses, driven by the AI (Racer, tactical,
 *   shortcuts as planned), three laps, the race limit. DNF if it is not home by then.
 *
 * `--deep-off` measures the game without the deep-ground floor (the "before" of
 * docs/BALANCE_CHANGELOG.md, the deep-ground floor): sand and mud fall back to the crawl band.
 *
 *   npx tsx tests/balance/surfaceReport.ts [--straight] [--deep-off] [--out <file.md>]
 */

const args = process.argv.slice(2);
const straightOnly = args.includes('--straight');
const deepOff = args.includes('--deep-off');
if (deepOff)
  for (const k of Object.keys(DEEP_GROUND_FLOOR)) delete DEEP_GROUND_FLOOR[k as SurfaceId];
const outIndex = args.indexOf('--out');
const out = outIndex >= 0 ? args[outIndex + 1]! : null;

const STRAIGHT: Array<{ label: string; trackId: string; presetId: string; surface: SurfaceId }> = [
  {
    label: 'asphalt, city clear',
    trackId: 'city_01',
    presetId: 'city_clear_night',
    surface: 'asphalt',
  },
  {
    label: 'sand, Dust Devil clear',
    trackId: 'desert_01',
    presetId: 'desert_clear',
    surface: 'sand',
  },
  {
    label: 'sand, Canyon Switch dry heat',
    trackId: 'desert_02',
    presetId: 'desert_dry_heat',
    surface: 'sand',
  },
  { label: 'mud, Moss Run rain', trackId: 'forest_01', presetId: 'forest_rain', surface: 'mud' },
  {
    label: 'dirt, Timber Dash clear',
    trackId: 'forest_02',
    presetId: 'forest_clear',
    surface: 'dirt',
  },
  {
    label: 'snow, Whiteout Pass snowfall',
    trackId: 'snow_01',
    presetId: 'snow_snowfall',
    surface: 'snow',
  },
];

function speeds(templateId: string, trackId: string, presetId: string, surface: SurfaceId) {
  const conditions = conditionsFor(trackId, presetId) as BuildConditions;
  const env = environmentFor(presetId) as RaceEnvironment;
  const t = RIVAL_TEMPLATES.find((x) => x.id === templateId)!;
  const params = raceEntry(t.blueprint, conditions)!.params;
  const state = createMotionState(0, 0, 0, params);
  const power = createPowertrainOutput();
  const telemetry = createTelemetry();
  let v = 0;
  const at: number[] = [];
  const marks = [5, 10, 30, 60];
  for (let i = 1, m = 0; m < marks.length; i++) {
    v = stepStraight(state, v, params, env, surface, 1 / 30, power, telemetry);
    if (i === marks[m]! * 30) {
      at.push(v);
      m++;
    }
  }
  return at;
}

const lines: string[] = [];
const json: Record<string, unknown> = {};
lines.push('# Surfaces: straight-line speed and solo finishes of the shipped builds', '');
lines.push(
  `Command: \`npx tsx tests/balance/surfaceReport.ts${straightOnly ? ' --straight' : ''}${deepOff ? ' --deep-off' : ''}\`${deepOff ? ' (without the deep-ground floor)' : ''}`,
  '',
);
lines.push('## Straight line, px/s after 5 / 10 / 30 / 60 s flat out from rest', '');
lines.push(`| Build | ${STRAIGHT.map((s) => s.label).join(' | ')} |`);
lines.push(`| :-- | ${STRAIGHT.map(() => '--:').join(' | ')} |`);
const straight: Record<string, number[][]> = {};
for (const t of RIVAL_TEMPLATES) {
  const row = STRAIGHT.map((s) => speeds(t.id, s.trackId, s.presetId, s.surface));
  straight[t.id] = row;
  lines.push(
    `| ${t.name} | ${row.map((r) => r.map((v) => v.toFixed(0)).join(' / ')).join(' | ')} |`,
  );
}
json.straight = straight;
lines.push('');

if (!straightOnly) {
  lines.push('## Solo races, AI Racer (tactical), seconds for three laps; DNF past the limit', '');
  const heads = COURSES.map(
    (c) => `${c.trackId.replace('_0', '')} ${c.presetId.split('_').slice(1).join(' ')}`,
  );
  lines.push(`| Build | ${heads.join(' | ')} |`);
  lines.push(`| :-- | ${heads.map(() => '--:').join(' | ')} |`);
  const solo: Record<string, Array<number | null>> = {};
  let dnf = 0;
  const started = Date.now();
  for (const t of RIVAL_TEMPLATES) {
    const row = COURSES.map(
      (c) =>
        runSolo(
          c.trackId,
          c.presetId,
          { templateId: t.id, difficulty: 'racer', style: 'tactical' },
          'plan',
        ).seconds,
    );
    solo[t.id] = row;
    dnf += row.filter((x) => x === null).length;
    lines.push(
      `| ${t.name} | ${row.map((x) => (x === null ? '**DNF**' : x.toFixed(1))).join(' | ')} |`,
    );
    console.error(`${t.id} done, ${((Date.now() - started) / 1000).toFixed(0)} s`);
  }
  lines.push('', `DNF: ${dnf} of ${RIVAL_TEMPLATES.length * COURSES.length}.`);
  json.solo = solo;
  json.courses = COURSES;
}

const text = lines.join('\n');
if (out) {
  writeFileSync(out, `${text}\n`);
  writeFileSync(out.replace(/\.md$/, '.json'), JSON.stringify(json, null, 1));
}
console.log(text);
