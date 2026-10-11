import { allParts, partsByCategory } from '@bolt/content';
import { ENGINE_RECIPES } from '../../apps/web/src/game/audio/engineRecipes.js';
import { CAPS } from '../../apps/web/src/game/audio/mixMath.js';
import {
  CATEGORIES,
  LOUDNESS_TARGETS,
  recipeDuration,
} from '../../apps/web/src/game/audio/recipe.js';
import { SFX_LIST } from '../../apps/web/src/game/audio/sfxRecipes.js';
import { PART_SOUNDS, WEAPON_SOUNDS } from '../../apps/web/src/game/audio/soundMap.js';

/**
 * The tables of docs/AUDIO_GUIDE.md that are generated from the audio code, so the guide
 * cannot drift from what plays. `npx tsx tests/tools/syncAudioDoc.ts` rewrites them, and
 * `tests/unit/audioDocs.test.ts` fails when the guide is stale.
 */

const code = (text: string) => `\`${text}\``;

export function engineTable(): string {
  const engines = partsByCategory('engine');
  const lines = [
    '| Engine | Voice (`soundKey`) | Firing frequency | Gears | Extras | Design intent |',
    '| :-- | :-- | :-- | --: | :-- | :-- |',
  ];
  for (const recipe of ENGINE_RECIPES) {
    const part = engines.find((e) => e.soundKey === recipe.key);
    const extras: string[] = [];
    if (recipe.lump) extras.push(`lump ${recipe.lump.depth}`);
    if (recipe.whine) extras.push(`whine by ${recipe.whine.by}`);
    if (recipe.noise) extras.push(`${recipe.noise.w} channel`);
    if (recipe.blowoff) extras.push('blow-off');
    if (recipe.burst) extras.push(code(recipe.burst));
    if (recipe.electricBelow !== undefined) extras.push('motor below 40% throttle');
    if (recipe.cycleWobble) extras.push('4 s pitch cycle');
    lines.push(
      `| ${part ? `${part.displayName} ${code(part.id)}` : '-'} | ${code(recipe.key)} | ${recipe.idleHz} to ${recipe.redHz} Hz | ${recipe.gears} | ${extras.join(', ') || '-'} | ${recipe.note} |`,
    );
  }
  return lines.join('\n');
}

export function loudnessTable(): string {
  const lines = [
    '| Category | Aim (dBFS) | Accepted window | Sounds | What is in it |',
    '| :-- | --: | :-- | --: | :-- |',
  ];
  const what: Record<string, string> = {
    ui: 'Buttons, sliders, checkpoint tick',
    race: 'Countdown, lap, position, build clock',
    stinger: 'GO, final lap, win, lose, Ready',
    alert: 'Lock and missile warnings, heat, power, critical part',
    fire_small: 'Bullets, arcs, sprays',
    fire_big: 'Shotgun, railgun, launches, EMP, air cannon',
    mech: 'Wind-ups, locks, hatches, clicks, whistles',
    travel: 'Loops that follow a projectile or a stream',
    impact_small: 'Ricochets, burn ticks, splashes',
    impact: 'What a hit struck, crunches, shield and part events',
    explosion: 'The four explosions, the hammer clang, the knockout',
    status: 'Status loops and fire on the road',
    utility: 'Repairs, boosts, jump, winch, shield up',
    install: 'Fitting a part in the garage',
  };
  for (const cat of CATEGORIES) {
    const t = LOUDNESS_TARGETS[cat];
    const n = SFX_LIST.filter((r) => r.cat === cat).length;
    lines.push(`| ${code(cat)} | ${t.aim} | ${t.min} to ${t.max} | ${n} | ${what[cat]} |`);
  }
  return lines.join('\n');
}

export function recipeTable(): string {
  const lines = [
    '| Sound | Bus | Category | Priority | Length | Limits | Design intent |',
    '| :-- | :-- | :-- | --: | :-- | :-- | :-- |',
  ];
  for (const r of SFX_LIST) {
    const limits: string[] = [];
    if (r.limitMs !== undefined) limits.push(`${r.limitMs} ms apart`);
    if (r.poly !== undefined) limits.push(`${r.poly} at once`);
    if (r.duck) limits.push(`ducks ${r.duck}`);
    lines.push(
      `| ${code(r.id)} | ${r.bus} | ${r.cat} | ${r.pri} | ${r.loop ? 'loop' : `${recipeDuration(r).toFixed(2)} s`} | ${limits.join(', ') || '-'} | ${r.note} |`,
    );
  }
  return lines.join('\n');
}

export function weaponTable(): string {
  const lines = [
    '| Weapon | Wind-up or lock | Fire | In flight | On a hit | Ending |',
    '| :-- | :-- | :-- | :-- | :-- | :-- |',
  ];
  for (const weapon of partsByCategory('weapon')) {
    const s = WEAPON_SOUNDS[weapon.id];
    if (!s) continue;
    const before = [s.windup?.id, s.lock].filter(Boolean).map((id) => code(id!));
    const flight = [s.travel, s.area, s.telegraph?.id].filter(Boolean).map((id) => code(id!));
    const ending = [s.explosion, ...Object.values(s.impact ?? {})]
      .filter((id): id is string => typeof id === 'string')
      .map(code);
    lines.push(
      `| ${weapon.displayName} ${code(weapon.id)} | ${before.join(', ') || '-'} | ${code(s.fire)}${s.everyRound ? ' per round' : ''} | ${flight.join(', ') || '-'} | ${s.hit ? `${code(s.hit)} over the surface` : 'the surface'} | ${ending.join(', ') || '-'} |`,
    );
  }
  return lines.join('\n');
}

export function partTable(): string {
  const lines = ['| Part | Install sound | In a race |', '| :-- | :-- | :-- |'];
  for (const part of allParts()) {
    const sound = PART_SOUNDS[part.id];
    if (!sound) continue;
    const race =
      part.category === 'engine'
        ? `engine voice ${code(sound.engineKey ?? '')}`
        : part.category === 'tires'
          ? `skid and rumble as ${code(sound.family ?? '')}`
          : part.category === 'chassis'
            ? sound.race.map(code).join(', ')
            : sound.race.length > 0
              ? sound.race.map(code).join(', ')
              : 'passive: no sound of its own';
    lines.push(`| ${part.displayName} ${code(part.id)} | ${code(sound.install.id)} | ${race} |`);
  }
  return lines.join('\n');
}

export function capsTable(): string {
  const lines = ['| Limit | Value |', '| :-- | --: |'];
  lines.push(`| One-shot and loop voices alive at once, music excluded | ${CAPS.totalVoices} |`);
  for (const [bus, cap] of Object.entries(CAPS.bus))
    lines.push(`| Voices on the ${code(bus)} bus | ${cap} |`);
  lines.push(`| Layers in one voice | ${CAPS.layersPerVoice} |`);
  lines.push(`| Nodes one layer can need | ${CAPS.nodesPerLayer} |`);
  lines.push(
    `| Nodes in the fixed driving graphs (two engines and the tires) | ${CAPS.engineNodes} |`,
  );
  lines.push(
    `| Small impacts let through at once, then per second | ${CAPS.impactBurst}, then ${CAPS.impactRefillPerSecond} |`,
  );
  return lines.join('\n');
}

export const AUDIO_DOC_TABLES = {
  'AUDIO CAPS': capsTable,
  'AUDIO LOUDNESS': loudnessTable,
  'AUDIO ENGINES': engineTable,
  'AUDIO WEAPONS': weaponTable,
  'AUDIO PARTS': partTable,
  'AUDIO RECIPES': recipeTable,
} as const;
