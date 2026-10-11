import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SFX_LIST } from '../../apps/web/src/game/audio/sfxRecipes.js';
import { AUDIO_DOC_TABLES } from '../tools/audioTables.js';

/** docs/AUDIO_GUIDE.md quotes the audio tables. This keeps it honest. */

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

const guide = readFileSync(resolve('docs/AUDIO_GUIDE.md'), 'utf8');

describe('docs/AUDIO_GUIDE.md', () => {
  it('carries the generated tables exactly as the code has them', () => {
    for (const [name, build] of Object.entries(AUDIO_DOC_TABLES)) {
      const begin = `<!-- BEGIN ${name} -->`;
      const end = `<!-- END ${name} -->`;
      expect(guide.includes(begin) && guide.includes(end), `markers for ${name}`).toBe(true);
      const body = guide.slice(guide.indexOf(begin) + begin.length, guide.indexOf(end));
      expect(rows(body), `${name}: run npx tsx tests/tools/syncAudioDoc.ts`).toEqual(rows(build()));
    }
  });

  it('names every recipe, and says plainly that nobody has listened', () => {
    for (const recipe of SFX_LIST) expect(guide, recipe.id).toContain(`\`${recipe.id}\``);
    expect(guide).toMatch(/no (person|human) has listened/i);
  });

  it('the evidence it points to exists', () => {
    for (const file of ['loudness.md', 'engines.md', 'weapon-distances.md', 'scenarios.md'])
      expect(existsSync(resolve('docs/evidence/audio', file)), file).toBe(true);
  });
});
