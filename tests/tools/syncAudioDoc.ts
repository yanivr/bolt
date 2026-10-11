import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AUDIO_DOC_TABLES } from './audioTables.js';

/**
 * Rewrites the generated tables inside docs/AUDIO_GUIDE.md from the audio code.
 *
 *   npx tsx tests/tools/syncAudioDoc.ts
 */

const path = resolve('docs/AUDIO_GUIDE.md');
let text = readFileSync(path, 'utf8');
for (const [name, build] of Object.entries(AUDIO_DOC_TABLES)) {
  const begin = `<!-- BEGIN ${name} -->`;
  const end = `<!-- END ${name} -->`;
  const from = text.indexOf(begin);
  const to = text.indexOf(end);
  if (from < 0 || to < 0) throw new Error(`markers for ${name} not found`);
  text = `${text.slice(0, from + begin.length)}\n${build()}\n${text.slice(to)}`;
}
writeFileSync(path, text);
console.log(`wrote ${path}`);
