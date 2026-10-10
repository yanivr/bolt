import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chassisTables, partTable } from './catalogTables.js';

/**
 * Rewrites the generated tables inside docs/GARAGE_API.md from the catalog.
 *
 *   npx tsx tests/tools/syncGarageDoc.ts
 */

const path = resolve('docs/GARAGE_API.md');
let text = readFileSync(path, 'utf8');
for (const [name, body] of [
  ['PART TABLE', partTable()],
  ['CHASSIS TABLES', chassisTables().trimEnd()],
] as const) {
  const begin = `<!-- BEGIN ${name} -->`;
  const end = `<!-- END ${name} -->`;
  const from = text.indexOf(begin);
  const to = text.indexOf(end);
  if (from < 0 || to < 0) throw new Error(`markers for ${name} not found`);
  text = `${text.slice(0, from + begin.length)}\n${body}\n${text.slice(to)}`;
}
writeFileSync(path, text);
console.log(`wrote ${path}`);
