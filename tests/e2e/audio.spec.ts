import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SCENARIOS } from '@bolt/content';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { TimelineStep } from '../../apps/web/src/game/audio/debugHarness.js';
import { CAPS } from '../../apps/web/src/game/audio/mixMath.js';
import { OUTPUT_CEILING } from '../../apps/web/src/game/audio/mixer.js';
import { ENGINE_LOUDNESS, LOUDNESS_TARGETS } from '../../apps/web/src/game/audio/recipe.js';
import type { Category } from '../../apps/web/src/game/audio/recipe.js';
import type { Fingerprint } from '../audio/analysis.js';
import {
  activeSpan,
  bandShare,
  dB,
  dcOffset,
  edgeLevels,
  encodeWav,
  fingerprint,
  fingerprintDistance,
  loudestWindow,
  mono,
  peak,
  rms,
  spectrogramPng,
} from '../audio/analysis.js';
import { SCENARIO_SOUNDS, firstMissing } from '../audio/expectations.js';
import type { AudioStats, Clip, Hook } from '../audio/harness.js';
import {
  ENGINE_RUN,
  engineKeys,
  openHarness,
  recipeInfo,
  renderEngine,
  renderMusic,
  renderRecipe,
  renderScenario,
  renderTimeline,
  scenarioIds,
} from '../audio/harness.js';

/**
 * The sound of the game, checked without ears.
 *
 * The first half renders every sound offline, in headless Chromium, through the same code the
 * game runs, and measures the result: level, clipping, DC, clicks, length, silence afterwards,
 * and whether the twenty weapons can be told apart. The second half plays the real client and
 * reads the audio system's own log of voices.
 *
 * `BOLT_AUDIO_EVIDENCE=1` also writes WAV files, spectrograms and the measured tables to
 * docs/evidence/audio/, for a person to listen to. Nobody has yet.
 */

const EVIDENCE = process.env.BOLT_AUDIO_EVIDENCE === '1';
const OUT = fileURLToPath(new URL('../../docs/evidence/audio/', import.meta.url));

function save(path: string, data: Buffer | string): void {
  if (!EVIDENCE) return;
  const full = OUT + path;
  mkdirSync(full.slice(0, full.lastIndexOf('/')), { recursive: true });
  writeFileSync(full, data);
}

function saveClip(path: string, clip: Clip, stereo = false): void {
  if (!EVIDENCE) return;
  const channels = stereo ? clip.channels : [mono(clip.channels)];
  save(`${path}.wav`, encodeWav(channels, clip.rate));
  save(`${path}.png`, spectrogramPng(mono(clip.channels), clip.rate));
}

/** The limiter's ceiling is -1.7 dBFS; the brief asks for peaks under -1. */
const PEAK_LIMIT_DB = -1;
/** Nothing may be left sounding: below this is silence. */
const SILENCE_DB = -80;
/** Largest sample allowed within a third of a millisecond of a sound's first and last, as a share of its peak. */
const EDGE_LIMIT = 0.4;
const DC_LIMIT = 0.02;
/** The music, with its slider at full, sits under everything else. */
const MUSIC_TARGET = { min: -34, max: -20 };
/** No two weapons may be closer than this in fingerprint distance. */
const WEAPON_DISTANCE_MIN = 0.9;
const ENGINE_DISTANCE_MIN = 0.35;
/**
 * A phone speaker gives almost nothing under 300 Hz. At least this share of every sound's
 * energy, in dB, must lie between 300 Hz and 8 kHz, or most players would not hear it.
 */
const SMALL_SPEAKER_MIN_DB = -7;
const ENGINE_SMALL_SPEAKER_MIN_DB = -7;
/** Pure sub layers that are only ever played under another sound. */
const SUB_ONLY = new Set(['impact_heavy']);
/** Mean cost of the per-frame audio update in the real client, milliseconds. */
const FRAME_COST_LIMIT_MS = 1;

const fmt = (n: number, width = 6) => n.toFixed(1).padStart(width);

test.describe('audio, rendered offline', () => {
  test.describe.configure({ timeout: 300_000 });

  test('every recipe is clean, sits in its loudness window, lasts as designed and ends in silence', async ({
    page,
  }) => {
    await openHarness(page);
    const infos = await recipeInfo(page);
    expect(infos.length).toBeGreaterThan(120);
    const rows: string[] = [];
    const problems: string[] = [];
    const byCategory = new Map<string, number[]>();
    for (const info of infos) {
      const clip = await renderRecipe(page, info.id);
      const x = clip.channels[0]!;
      const target = LOUDNESS_TARGETS[info.cat as Category];
      const peakDb = dB(peak(x));
      const loud = dB(loudestWindow(x, clip.rate));
      const { first, last } = activeSpan(x);
      const dc = first < 0 ? 0 : dcOffset(x, first, last + 1);
      const edges = edgeLevels(x, clip.rate);
      const heard = first < 0 ? 0 : (last - first) / clip.rate;
      const tail = dB(rms(x, x.length - Math.round(0.1 * clip.rate), x.length));
      const say = (text: string) => problems.push(`${info.id}: ${text}`);

      if (first < 0) say('renders nothing');
      if (peakDb > PEAK_LIMIT_DB) say(`peak ${fmt(peakDb)} dBFS`);
      if (loud < target.min || loud > target.max)
        say(`loudness ${fmt(loud)} dBFS outside ${target.min}..${target.max} for ${info.cat}`);
      if (Math.abs(dc) > DC_LIMIT) say(`DC offset ${dc.toFixed(4)}`);
      if (edges.on > EDGE_LIMIT) say(`click at note on (${edges.on.toFixed(2)} of peak)`);
      if (edges.off > EDGE_LIMIT) say(`click at note off (${edges.off.toFixed(2)} of peak)`);
      if (tail > SILENCE_DB) say(`still sounding at the end (${fmt(tail)} dBFS)`);
      if (clip.nodesEnd.voices !== 0) say(`${clip.nodesEnd.voices} nodes left alive`);
      const mids = first < 0 ? 0 : bandShare(x.subarray(first, last + 1), clip.rate, 300, 8000);
      if (mids < SMALL_SPEAKER_MIN_DB && !SUB_ONLY.has(info.id))
        say(`only ${fmt(mids)} dB of its energy is above 300 Hz: lost on a phone speaker`);
      // A one-shot is over when its envelope says so (the limiter adds a few milliseconds), and
      // it is audible for at least a third of that, or the design is mostly silence.
      if (!info.loop) {
        if (heard > clip.designed! + 0.06)
          say(`lasts ${heard.toFixed(3)} s, designed ${clip.designed!.toFixed(3)}`);
        if (heard < clip.designed! * 0.33)
          say(`audible for only ${heard.toFixed(3)} s of ${clip.designed!.toFixed(3)}`);
      } else if (heard < clip.designed!) say(`loop stopped early: ${heard.toFixed(3)} s`);

      byCategory.set(info.cat, [...(byCategory.get(info.cat) ?? []), loud]);
      rows.push(
        `| \`${info.id}\` | ${info.cat} | ${info.bus} | ${info.loop ? 'loop' : clip.designed!.toFixed(2) + ' s'} | ${fmt(loud)} | ${fmt(peakDb)} | ${dc.toFixed(4)} | ${edges.on.toFixed(2)} / ${edges.off.toFixed(2)} | ${fmt(mids)} | ${info.note} |`,
      );
      saveClip(`recipes/${info.id}`, clip);
    }
    const summary = [...byCategory.entries()]
      .map(([cat, values]) => {
        const t = LOUDNESS_TARGETS[cat as Category];
        return `| ${cat} | ${values.length} | ${t.min} to ${t.max} | ${t.aim} | ${fmt(Math.min(...values))} | ${fmt(Math.max(...values))} |`;
      })
      .join('\n');
    save(
      'loudness.md',
      `# Measured loudness\n\nEvery recipe rendered alone in headless Chromium through the master chain, at the player's own car, every slider at full. Loudness is the loudest 100 ms RMS in dBFS; peak is the largest sample; "above 300 Hz" is the share of the sound's energy a phone speaker can reproduce (0 is all of it; the test fails under ${SMALL_SPEAKER_MIN_DB}, except for the sub layer \`impact_heavy\`). Generated by \`tests/e2e/audio.spec.ts\`; no person has listened to these.\n\n## By category\n\n| Category | Sounds | Window (dBFS) | Aim | Quietest | Loudest |\n| :-- | --: | :-- | --: | --: | --: |\n${summary}\n\n## Every recipe\n\n| Sound | Category | Bus | Length | Loudness | Peak | DC | Edge on / off | Above 300 Hz (dB) | Design intent |\n| :-- | :-- | :-- | :-- | --: | --: | --: | :-- | --: | :-- |\n${rows.join('\n')}\n`,
    );
    expect(problems).toEqual([]);
  });

  test('every engine responds to the throttle, stays in its window, differs from the others and stops', async ({
    page,
  }) => {
    await openHarness(page);
    const keys = await engineKeys(page);
    expect(keys.length).toBe(20);
    const problems: string[] = [];
    const rows: string[] = [];
    const prints: Fingerprint[][] = [];
    for (const key of keys) {
      const clip = await renderEngine(page, key);
      const x = clip.channels[0]!;
      const at = (s: number) => Math.round(s * clip.rate);
      const idle = dB(rms(x, at(0.3), at(ENGINE_RUN.idleEnd)));
      const hold = dB(rms(x, at(ENGINE_RUN.pullEnd), at(ENGINE_RUN.holdEnd)));
      const peakDb = dB(peak(x));
      const end = dB(rms(x, at(ENGINE_RUN.total - 0.2), x.length));
      const idlePrint = fingerprint(x.subarray(at(0.3), at(ENGINE_RUN.idleEnd)), clip.rate);
      const holdPrint = fingerprint(
        x.subarray(at(ENGINE_RUN.pullEnd), at(ENGINE_RUN.holdEnd)),
        clip.rate,
      );
      const pullPrint = fingerprint(
        x.subarray(at(ENGINE_RUN.idleEnd), at(ENGINE_RUN.holdEnd)),
        clip.rate,
      );
      prints.push([idlePrint, pullPrint, holdPrint]);
      const mids = bandShare(
        x.subarray(at(ENGINE_RUN.pullEnd), at(ENGINE_RUN.holdEnd)),
        clip.rate,
        300,
        8000,
      );
      const say = (text: string) => problems.push(`${key}: ${text}`);
      if (peakDb > PEAK_LIMIT_DB) say(`peak ${fmt(peakDb)} dBFS`);
      if (hold < ENGINE_LOUDNESS.min || hold > ENGINE_LOUDNESS.max)
        say(`full throttle at ${fmt(hold)} dBFS`);
      if (idle > hold - 2)
        say(`idle (${fmt(idle)}) is not quieter than full throttle (${fmt(hold)})`);
      if (holdPrint.centroid < idlePrint.centroid + 0.15 && idle > -70)
        say(
          `does not brighten with revs (${idlePrint.centroid.toFixed(2)} to ${holdPrint.centroid.toFixed(2)} octaves)`,
        );
      if (Math.abs(dcOffset(x, at(ENGINE_RUN.pullEnd), at(ENGINE_RUN.holdEnd))) > DC_LIMIT)
        say('DC offset');
      if (end > -70) say(`still sounding after it was switched off (${fmt(end)} dBFS)`);
      if (mids < ENGINE_SMALL_SPEAKER_MIN_DB)
        say(`only ${fmt(mids)} dB of its energy at speed is above 300 Hz: lost on a phone speaker`);
      if (clip.nodesEnd.engine !== 0 || clip.nodesEnd.voices !== 0) say('nodes left alive');
      rows.push(
        `| \`${key}\` | ${fmt(idle)} | ${fmt(hold)} | ${fmt(peakDb)} | ${(20 * 2 ** idlePrint.centroid).toFixed(0)} | ${(20 * 2 ** holdPrint.centroid).toFixed(0)} | ${fmt(mids)} | ${idlePrint.modDepth.toFixed(2)} at ${idlePrint.modHz.toFixed(0)} Hz | ${holdPrint.modDepth.toFixed(2)} |`,
      );
      saveClip(`engines/${key}`, clip);
    }
    let closest = { d: Infinity, a: '', b: '' };
    for (let i = 0; i < keys.length; i++)
      for (let j = i + 1; j < keys.length; j++) {
        // Two engines are as different as their most different phase: at idle, pulling, or at speed.
        const d = Math.max(
          ...prints[i]!.map((print, k) => fingerprintDistance(print, prints[j]![k]!)),
        );
        if (d < closest.d) closest = { d, a: keys[i]!, b: keys[j]! };
      }
    save(
      'engines.md',
      `# Measured engines\n\nEach engine over the same seven-second run: idle, a pull through the gears at full throttle, a second held at speed, a lift, off. Levels in dBFS RMS with the Engine slider at full; brightness is the spectral centroid. Closest pair by fingerprint: \`${closest.a}\` and \`${closest.b}\`, distance ${closest.d.toFixed(2)} (floor ${ENGINE_DISTANCE_MIN}). No person has listened to these.\n\n| Engine | Idle | Full throttle | Peak | Centroid at idle (Hz) | Centroid at speed (Hz) | Above 300 Hz at speed (dB) | Wobble at idle | Wobble at speed |\n| :-- | --: | --: | --: | --: | --: | --: | :-- | --: |\n${rows.join('\n')}\n`,
    );
    if (closest.d < ENGINE_DISTANCE_MIN)
      problems.push(`${closest.a} and ${closest.b} are too alike (${closest.d.toFixed(2)})`);
    expect(problems).toEqual([]);
  });

  test('the twenty weapons have twenty different signatures', async ({ page }) => {
    await openHarness(page);
    const weapons = (await scenarioIds(page)).filter((id) => id.startsWith('weapon_'));
    expect(weapons.length).toBe(20);
    const prints: Fingerprint[] = [];
    const rows: string[] = [];
    for (const id of weapons) {
      // Weapons only: no engines, no countdown beeps, no music. The signature is the first
      // three seconds from the weapon's first sound: charge, shot, flight, impact, aftermath.
      const clip = await renderScenario(page, id, { levels: { engine: 0, ui: 0 } });
      const firstStart = clip.log.find(
        (e) => e.ev === 'start' && e.bus !== 'ui' && e.bus !== 'engine',
      );
      expect(firstStart, `${id} starts a weapon sound`).toBeTruthy();
      const x = mono(clip.channels);
      const from = Math.max(0, Math.round((firstStart!.t - 0.01) * clip.rate));
      const to = Math.min(Math.round(clip.resetAt! * clip.rate), from + 3 * clip.rate);
      const cut = x.subarray(from, to);
      const print = fingerprint(cut, clip.rate);
      prints.push(print);
      rows.push(
        `| \`${id}\` | ${print.seconds.toFixed(2)} | ${(20 * 2 ** print.centroid).toFixed(0)} | ${print.spread.toFixed(2)} | ${print.flatness.toFixed(3)} | ${print.attack.toFixed(2)} | ${print.modDepth.toFixed(2)} at ${print.modHz.toFixed(0)} Hz | ${print.pitch.map((p) => (20 * 2 ** p).toFixed(0)).join(' ')} | ${print.envelope.map((v) => v.toFixed(1)).join(' ')} |`,
      );
      saveClip(`weapons/${id}`, { ...clip, channels: [cut] });
    }
    const short = weapons.map((id) => id.replace('weapon_', ''));
    const matrix: string[] = [];
    let closest = { d: Infinity, a: '', b: '' };
    const nearest: string[] = [];
    for (let i = 0; i < weapons.length; i++) {
      const cells: string[] = [];
      let near = { d: Infinity, b: '' };
      for (let j = 0; j < weapons.length; j++) {
        if (i === j) {
          cells.push('-');
          continue;
        }
        const d = fingerprintDistance(prints[i]!, prints[j]!);
        cells.push(d.toFixed(1));
        if (d < near.d) near = { d, b: short[j]! };
        if (d < closest.d) closest = { d, a: weapons[i]!, b: weapons[j]! };
      }
      nearest.push(`| \`${short[i]}\` | \`${near.b}\` | ${near.d.toFixed(2)} |`);
      matrix.push(`| \`${short[i]}\` | ${cells.join(' | ')} |`);
    }
    save(
      'weapon-distances.md',
      `# Weapon distinctness\n\nEach weapon's showcase scenario rendered through the whole audio system with engines, interface and music silent, cut to three seconds from its first sound, and reduced to a fingerprint: spectral centroid and spread (octaves), flatness (0 tone, 1 noise), audible length, the loudness shape in eight slices, the strongest frequency in each quarter, and where the loudest slice falls. The distance scales each of those so that 1 is plainly different on that axis alone. The test fails under ${WEAPON_DISTANCE_MIN}.\n\n**Closest pair: \`${closest.a}\` and \`${closest.b}\`, distance ${closest.d.toFixed(2)}.** This is a measurement of difference in the signal, not a judgement by ear; no person has listened.\n\n## Nearest neighbour of each weapon\n\n| Weapon | Nearest | Distance |\n| :-- | :-- | --: |\n${nearest.join('\n')}\n\n## Fingerprints\n\n| Scenario | Audible (s) | Centroid (Hz) | Spread (oct) | Flatness | Attack | Wobble | Strongest Hz by quarter | Envelope by eighth |\n| :-- | --: | --: | --: | --: | --: | :-- | :-- | :-- |\n${rows.join('\n')}\n\n## Pairwise distance\n\n| | ${short.join(' | ')} |\n| :-- | ${short.map(() => '--:').join(' | ')} |\n${matrix.join('\n')}\n`,
    );
    expect(closest.d, `${closest.a} and ${closest.b}`).toBeGreaterThanOrEqual(WEAPON_DISTANCE_MIN);
  });

  test('all 33 scenarios: the expected sounds in order, inside the caps, no clipping, silence after the reset', async ({
    page,
  }) => {
    await openHarness(page);
    const ids = await scenarioIds(page);
    expect(ids.length).toBe(33);
    expect(Object.keys(SCENARIO_SOUNDS).sort()).toEqual([...ids].sort());
    const problems: string[] = [];
    const rows: string[] = [];
    for (const id of ids) {
      const clip = await renderScenario(page, id, { music: id === 'emp_burst' });
      const x = mono(clip.channels);
      const started = clip.log
        .filter((e) => e.ev === 'start' && e.bus !== 'music')
        .map((e) => e.id);
      const say = (text: string) => problems.push(`${id}: ${text}`);
      const missing = firstMissing(started, SCENARIO_SOUNDS[id]!);
      if (missing) say(`no "${missing}" in order; heard ${started.join(' ')}`);
      const peakDb = Math.max(...clip.channels.map((c) => dB(peak(c))));
      if (peakDb > PEAK_LIMIT_DB) say(`peak ${fmt(peakDb)} dBFS`);
      if (clip.peakVoices > CAPS.totalVoices) say(`${clip.peakVoices} voices at once`);
      if (clip.peakMusic > CAPS.bus.music) say(`${clip.peakMusic} music voices at once`);
      const worst = Math.max(...clip.log.map((e) => e.poly));
      if (worst > CAPS.totalVoices) say(`log shows ${worst} voices`);
      const tail = dB(rms(x, Math.round((clip.resetAt! + 0.5) * clip.rate), x.length));
      if (tail > -70) say(`${fmt(tail)} dBFS still sounding half a second after the reset`);
      const n = clip.nodesEnd;
      if (n.voices !== 0 || n.engine !== 0 || n.music !== 0 || n.fixed !== clip.nodesFixed)
        say(`nodes left after the reset: ${JSON.stringify(n)}`);
      rows.push(
        `| \`${id}\` | ${clip.resetAt!.toFixed(1)} | ${started.length} | ${clip.peakVoices} | ${fmt(dB(loudestWindow(x, clip.rate)))} | ${fmt(peakDb)} | ${fmt(tail, 7)} |`,
      );
      if (id === 'rocket_hit' || id === 'emp_burst') saveClip(`mixes/${id}`, clip, true);
    }
    save(
      'scenarios.md',
      `# Scenario renders\n\nEach showcase scenario simulated tick by tick and heard through the whole audio system at full sliders (music on only for \`emp_burst\`). Voices are one-shots and loops started, music excluded; the cap is ${CAPS.totalVoices}. The tail is the level from half a second after the feed is reset. No person has listened.\n\n| Scenario | Length (s) | Voices started | Most at once | Loudest 100 ms | Peak | Tail after reset |\n| :-- | --: | --: | --: | --: | --: | --: |\n${rows.join('\n')}\n`,
    );
    expect(problems).toEqual([]);
  });

  test('a wall of fire from every weapon stays inside the voice caps and under the ceiling', async ({
    page,
  }) => {
    await openHarness(page);
    // Six seconds: a rival machine-gunning the player without pause, while every weapon in
    // the catalog fires and lands around them, with the music in its final-lap arrangement.
    const steps: TimelineStep[] = [];
    for (let i = 0; i < 180; i++) {
      const t = 0.2 + i / 30;
      steps.push({ t, cue: { kind: 'play', id: 'mg_fire', car: 1, x: 80, y: 0 } });
      steps.push({
        t,
        cue: { kind: 'play', id: 'hit_armor', car: 0, gain: 0.6, pitch: 1.25, burst: true },
      });
      steps.push({
        t,
        cue: { kind: 'play', id: 'hit_body', car: 0, gain: 0.6, pitch: 1.25, burst: true },
      });
    }
    const big = [
      'shotgun_fire',
      'rail_fire',
      'rocket_launch',
      'explode_rocket',
      'seeker_launch',
      'explode_seeker',
      'mine_drop',
      'explode_mine',
      'oil_spill',
      'foam_launch',
      'foam_splat',
      'emp_burst',
      'tesla_arc',
      'flame_ignite',
      'frost_fire',
      'frost_shatter',
      'hammer_clang',
      'saw_bite',
      'harpoon_fire',
      'air_blast',
      'boomerang_throw',
      'boomerang_slash',
      'mortar_launch',
      'explode_mortar',
      'turret_fire',
      'sentry_fire',
      'hit_engine',
      'hit_wheel',
      'part_destroyed',
      'shield_down',
    ];
    big.forEach((id, i) => {
      for (const round of [0, 1])
        steps.push({
          t: 0.4 + round * 2.7 + i * 0.09,
          cue: { kind: 'play', id, x: (i % 5) * 70 - 140, y: (i % 3) * 60 - 60 },
        });
    });
    for (const id of [
      'rocket_fly',
      'seeker_fly',
      'flame_stream',
      'boomerang_spin',
      'status_burn',
      'status_emp',
      'oil_slip',
    ])
      steps.push({
        t: 0.5,
        cue: { kind: 'play', id, car: 1, x: -60, y: 40, key: `loop:${id}`, ttl: 4.5 },
      });
    steps.push({ t: 1, cue: { kind: 'play', id: 'warn_missile', car: 0, key: 'warn', ttl: 3 } });
    const clip = await renderTimeline(page, steps, 7, 'final');
    saveClip('mixes/busy_all_weapons', clip, true);

    const peakDb = Math.max(...clip.channels.map((c) => dB(peak(c))));
    expect(peakDb).toBeLessThan(PEAK_LIMIT_DB);
    expect(peakDb).toBeLessThanOrEqual(dB(OUTPUT_CEILING) + 0.1);
    expect(clip.peakVoices).toBeLessThanOrEqual(CAPS.totalVoices);
    expect(clip.peakMusic).toBeLessThanOrEqual(CAPS.bus.music);
    // The pool was really full: sounds were refused, stolen and rate-limited.
    const count = (ev: string) => clip.log.filter((e) => e.ev === ev).length;
    expect(count('steal')).toBeGreaterThan(0);
    expect(count('limit')).toBeGreaterThan(100);
    // The missile warning is never stolen: it starts once and is stopped by its own timer.
    const warn = clip.log.filter((e) => e.id === 'warn_missile');
    expect(warn.map((e) => e.ev)).toEqual(['start', 'stop', 'end']);
    // 180 rounds and 360 hits were asked for in six seconds. What actually started is bounded
    // by the rate limits: about 16 rounds a second, and a dozen small impacts a second.
    const started = (id: string) => clip.log.filter((e) => e.ev === 'start' && e.id === id).length;
    expect(started('mg_fire')).toBeLessThanOrEqual(110);
    expect(started('hit_armor') + started('hit_body')).toBeLessThanOrEqual(
      6 * CAPS.impactRefillPerSecond + CAPS.impactBurst + 2,
    );
    // And when it is over, it is over.
    const x = mono(clip.channels);
    expect(clip.nodesEnd.voices).toBe(0);
    expect(dB(rms(x, x.length - Math.round(0.15 * clip.rate), x.length))).toBeLessThan(-45);
  });

  test('the music stays low, in tempo, inside its own voice cap, and stops when told', async ({
    page,
  }) => {
    await openHarness(page);
    const seconds = 16;
    const clip = await renderMusic(page, seconds);
    saveClip('mixes/music_neon_cut', clip, true);
    const x = mono(clip.channels);
    const half = Math.round((seconds / 2) * clip.rate);
    const normal = dB(rms(x, clip.rate, half));
    const final = dB(rms(x, half + clip.rate, x.length - clip.rate));
    save(
      'music.md',
      `# Measured music\n\n"Neon Cut" rendered alone for ${seconds} seconds with the Music slider at full: the normal arrangement, then the final-lap arrangement. RMS in dBFS; the accepted window is ${MUSIC_TARGET.min} to ${MUSIC_TARGET.max}. For comparison every engine is calibrated to -20 dBFS at full throttle with its slider at full, and the Music slider defaults to half (a further 6 dB down). No person has listened.\n\n| Arrangement | Tempo | Level | Peak | Most voices at once (cap ${CAPS.bus.music}) |\n| :-- | --: | --: | --: | --: |\n| Normal | 128 BPM | ${fmt(normal)} | ${fmt(Math.max(...clip.channels.map((c) => dB(peak(c, 0, half)))))} | ${clip.peakMusic} |\n| Final lap | 140 BPM | ${fmt(final)} | ${fmt(Math.max(...clip.channels.map((c) => dB(peak(c, half)))))} | ${clip.peakMusic} |\n`,
    );
    expect(normal).toBeGreaterThan(MUSIC_TARGET.min);
    expect(normal).toBeLessThan(MUSIC_TARGET.max);
    expect(final).toBeGreaterThan(MUSIC_TARGET.min);
    expect(final).toBeLessThan(MUSIC_TARGET.max);
    expect(Math.max(...clip.channels.map((c) => dB(peak(c))))).toBeLessThan(-6);
    expect(clip.peakMusic).toBeLessThanOrEqual(CAPS.bus.music);
    // 128 beats a minute with kicks on steps 0, 6 and 8: 1.6 a second. Then 140 with four to
    // the bar: 2.33 a second.
    const kicks = clip.log.filter((e) => e.ev === 'start' && e.id === 'mus_kick').map((e) => e.t);
    const rate = (from: number, to: number) =>
      kicks.filter((t) => t >= from && t < to).length / (to - from);
    expect(rate(0, 7.5)).toBeGreaterThan(1.4);
    expect(rate(0, 7.5)).toBeLessThan(1.8);
    expect(rate(8.5, 15)).toBeGreaterThan(2.1);
    expect(rate(8.5, 15)).toBeLessThan(2.6);
    expect(dB(rms(x, x.length - Math.round(0.1 * clip.rate), x.length))).toBeLessThan(-60);
    // No note is ever cut to make room for another: the music fits inside its own cap.
    expect(clip.log.filter((e) => e.ev === 'steal' || e.ev === 'drop').length).toBe(0);
    expect(clip.nodesEnd.music).toBe(0);
  });
});

// --- The real client ---------------------------------------------------------------------------

type W = { __boltAudio: Hook };

const audioState = (page: Page) =>
  page.evaluate(() => (window as unknown as W).__boltAudio.state());
const audioStats = (page: Page): Promise<AudioStats | null> =>
  page.evaluate(() => (window as unknown as W).__boltAudio.stats());
const audioLog = (page: Page) => page.evaluate(() => (window as unknown as W).__boltAudio.log());

function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    // A missing file is the asset pipeline's business, not the sound's; other suites watch it.
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource'))
      problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(e.message));
  return problems;
}

/** Home, Track Preview, the garage, Ready: the same three taps a player makes. */
async function toTheGrid(page: Page, query: string): Promise<void> {
  await page.goto(`/${query}`);
  await page.getByRole('button', { name: 'Start Racing' }).tap();
  await page.getByRole('button', { name: 'Build Your Car' }).tap();
  await page.getByTestId('ready').tap();
  await expect
    .poll(async () => (await audioStats(page))?.race?.phase ?? null, { timeout: 60_000 })
    .not.toBeNull();
}

test.describe('audio in the client', () => {
  // A small landscape phone at one device pixel per pixel. The picture is not under test here,
  // and software rendering of a big canvas is what slows the race clock down.
  test.use({ viewport: { width: 568, height: 320 }, deviceScaleFactor: 1 });
  test.describe.configure({ timeout: 240_000 });

  test('nothing sounds before the first gesture; after it the context runs and the interface answers', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await page.goto('/?debug=1');
    await page.waitForFunction(() => '__boltAudio' in window);
    // No gesture yet: there is no audio context at all, and asking for a sound does nothing.
    expect(await audioState(page)).toBe('none');
    await page.evaluate(() => (window as unknown as W).__boltAudio.ui('tap'));
    expect(await audioState(page)).toBe('none');
    expect(await audioStats(page)).toBeNull();
    expect(await audioLog(page)).toEqual([]);

    // The first touch is the gesture.
    await page.getByRole('button', { name: 'Start Racing' }).tap();
    await expect.poll(() => audioState(page)).toBe('running');
    const before = await audioStats(page);
    expect(before!.nodes.voices).toBe(0);
    expect(before!.nodes.engine).toBe(0);
    expect(before!.nodes.total).toBe(before!.nodes.fixed);

    await page.evaluate(() => (window as unknown as W).__boltAudio.ui('confirm'));
    await page.evaluate(() => (window as unknown as W).__boltAudio.ui('install', 'weapon_rocket'));
    const log = await audioLog(page);
    expect(log.filter((e) => e.ev === 'start').map((e) => e.id)).toEqual([
      'ui_confirm',
      'install_weapon',
    ]);
    expect((await audioStats(page))!.nodes.voices).toBeGreaterThan(0);
    // An engine answers its own installation with half a second of itself, then is gone.
    await page.evaluate(() => (window as unknown as W).__boltAudio.ui('install', 'engine_v8'));
    await expect.poll(async () => (await audioStats(page))!.nodes.engine).toBeGreaterThan(0);
    // Everything played is released: the node count comes back to where it began.
    await expect
      .poll(async () => (await audioStats(page))!.nodes.total, { timeout: 5_000 })
      .toBe(before!.nodes.fixed);
    expect(problems).toEqual([]);
  });

  test('mute, the four volumes and the music switch reach the mixer', async ({ page }) => {
    await page.goto('/?debug=1');
    await page.getByRole('button', { name: 'Start Racing' }).tap();
    await expect.poll(() => audioState(page)).toBe('running');
    const gains = async () => (await audioStats(page))!.gains;
    const near = (value: number, want: number) => Math.abs(value - want) < 0.01;

    // The defaults: engine 0.7 and effects 0.8 from the settings store, interface 0.8, music 0.5.
    await expect.poll(async () => near((await gains()).engine, 0.7)).toBe(true);
    const start = await gains();
    expect(start.mute).toBeCloseTo(1, 2);
    for (const bus of ['weapons', 'impacts', 'ambience', 'alerts'] as const)
      expect(start[bus], bus).toBeCloseTo(0.8, 2);
    expect(start.ui).toBeCloseTo(0.8, 2);
    const musicTrim = start.music / 0.5;
    expect(musicTrim).toBeGreaterThan(0.1);
    expect(musicTrim).toBeLessThan(0.6);

    // The store's own setter, as the settings panel calls it.
    await page.evaluate(() =>
      (window as unknown as W).__boltAudio.settings({ engineVolume: 0.25, effectsVolume: 0.5 }),
    );
    await expect.poll(async () => near((await gains()).engine, 0.25)).toBe(true);
    await expect.poll(async () => near((await gains()).impacts, 0.5)).toBe(true);

    await page.evaluate(() => (window as unknown as W).__boltAudio.settings({ muted: true }));
    await expect.poll(async () => (await gains()).mute).toBeLessThan(0.001);
    // Muted, an interface sound is not even started.
    await page.evaluate(() => (window as unknown as W).__boltAudio.clearLog());
    await page.evaluate(() => (window as unknown as W).__boltAudio.ui('confirm'));
    expect(await audioLog(page)).toEqual([]);
    await page.evaluate(() => (window as unknown as W).__boltAudio.settings({ muted: false }));
    await expect.poll(async () => (await gains()).mute).toBeGreaterThan(0.999);

    // The audio module's own preferences.
    await page.evaluate(() =>
      (window as unknown as W).__boltAudio.prefs({ uiVolume: 0.3, musicVolume: 1 }),
    );
    await expect.poll(async () => near((await gains()).ui, 0.3)).toBe(true);
    await expect.poll(async () => near((await gains()).music, musicTrim)).toBe(true);
    await page.evaluate(() => (window as unknown as W).__boltAudio.prefs({ musicEnabled: false }));
    await expect.poll(async () => (await gains()).music).toBeLessThan(0.001);
    // And they persist on their own key.
    const stored = await page.evaluate(() => window.localStorage.getItem('bolt.audio.v1'));
    expect(JSON.parse(stored!)).toMatchObject({
      uiVolume: 0.3,
      musicVolume: 1,
      musicEnabled: false,
      haptics: false,
    });
  });

  test('a hidden tab goes silent and suspended, and comes back', async ({ page }) => {
    const problems = collectProblems(page);
    await toTheGrid(page, '?debug=1&scenario=weapon_flame');
    await expect.poll(() => audioState(page)).toBe('running');
    // The engine is running and, once the flame is lit, loops are sounding.
    await expect
      .poll(async () => (await audioStats(page))!.keys.some((k) => k.startsWith('status:')), {
        timeout: 150_000,
      })
      .toBe(true);
    const setVisibility = (state: 'hidden' | 'visible') =>
      page.evaluate((value) => {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => value,
        });
        Object.defineProperty(document, 'hidden', {
          configurable: true,
          get: () => value === 'hidden',
        });
        document.dispatchEvent(new Event('visibilitychange'));
      }, state);
    await setVisibility('hidden');
    // Every keyed loop is dropped at once, and the clock stops.
    expect((await audioStats(page))!.keys).toEqual([]);
    await expect.poll(() => audioState(page)).toBe('suspended');
    const logged = (await audioLog(page)).length;
    await page.waitForTimeout(600);
    // Suspended, nothing new is started: no backlog to blurt out on return.
    expect((await audioLog(page)).filter((e) => e.ev === 'start').length).toBe(
      (await audioLog(page)).slice(0, logged).filter((e) => e.ev === 'start').length,
    );
    await setVisibility('visible');
    await expect.poll(() => audioState(page)).toBe('running');
    expect(problems).toEqual([]);
  });

  test('every scenario in the real client: the expected sounds in order, inside the caps, and the node count back to baseline', async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(2_400_000);
    // `BOLT_AUDIO_SCENARIOS=rocket_hit,weapon_emp` plays only those, for work on one sound.
    const only = process.env.BOLT_AUDIO_SCENARIOS?.split(',');
    const ids = Object.keys(SCENARIO_SOUNDS).filter((id) => !only || only.includes(id));
    if (!only) expect(ids.length).toBe(33);
    const durations = new Map(
      SCENARIOS.map((s) => [s.id, (s.countdownTicks + s.durationTicks) / 30]),
    );
    const problems: string[] = [];
    const rows: string[] = [];
    let frames = 0;
    let frameMs = 0;
    let worstMs = 0;

    const run = async (id: string): Promise<void> => {
      const context = await browser.newContext({
        baseURL: baseURL!,
        // A small landscape phone at one device pixel per pixel: the picture is not under test
        // here, and software rendering is what slows the race clock down.
        viewport: { width: 568, height: 320 },
        deviceScaleFactor: 1,
        hasTouch: true,
        isMobile: true,
      });
      const page = await context.newPage();
      const errors = collectProblems(page);
      const say = (text: string) => problems.push(`${id}: ${text}`);
      try {
        await page.goto(`/?debug=1&scenario=${id}`);
        await page.getByRole('button', { name: 'Start Racing' }).tap();
        await expect.poll(() => audioState(page)).toBe('running');
        const baseline = (await audioStats(page))!.nodes;
        await page.getByRole('button', { name: 'Build Your Car' }).tap();
        await page.getByTestId('ready').tap();
        const seconds = durations.get(id)!;
        // The scenario has run its length on the race clock, plus a second for tails.
        await expect
          .poll(async () => (await audioStats(page))?.race?.raceTimeMs ?? -1, {
            timeout: 240_000,
            intervals: [250],
          })
          .toBeGreaterThanOrEqual((seconds - 1) * 1000 + 700);
        const stats = (await audioStats(page))!;
        const log = await audioLog(page);
        const started = log.filter((e) => e.ev === 'start' && e.bus !== 'music').map((e) => e.id);
        const missing = firstMissing(started, SCENARIO_SOUNDS[id]!);
        if (missing) say(`no "${missing}" in order; heard ${started.join(' ')}`);
        if (stats.peakVoices > CAPS.totalVoices) say(`${stats.peakVoices} voices at once`);
        if (stats.peakMusic > CAPS.bus.music) say(`${stats.peakMusic} music voices at once`);
        const worst = Math.max(0, ...log.map((e) => e.poly));
        if (worst > CAPS.totalVoices) say(`log shows ${worst} voices`);
        if (stats.nodes.engine > CAPS.engineNodes) say(`${stats.nodes.engine} engine nodes`);
        if (!stats.engine) say('no engine voice');
        // The per-frame audio update is parameter glides on a fixed graph. Even here, on a
        // loaded machine with software rendering, it must cost a small fraction of a frame.
        const cost = stats.frameCost;
        if (!cost || cost.frames < 10) say('the scene is not feeding frames to the audio');
        else if (cost.meanMs > FRAME_COST_LIMIT_MS)
          say(`the per-frame audio update costs ${cost.meanMs.toFixed(3)} ms on average`);
        if (cost) {
          frames += cost.frames;
          frameMs += cost.meanMs * cost.frames;
          worstMs = Math.max(worstMs, cost.worstMs);
        }
        // Times in the log only go forward.
        for (let i = 1; i < log.length; i++)
          if (log[i]!.t < log[i - 1]!.t - 0.3) {
            say(`log goes back in time at ${i}`);
            break;
          }

        // Leave the race as the Leave button does. Everything the race made must go.
        await page.evaluate(() => (window as unknown as W).__boltAudio.leaveRace());
        let after = (await audioStats(page))!.nodes;
        for (let i = 0; i < 20 && after.total !== baseline.total; i++) {
          await page.waitForTimeout(150);
          after = (await audioStats(page))!.nodes;
        }
        if (
          after.total !== baseline.total ||
          after.voices !== 0 ||
          after.engine !== 0 ||
          after.music !== 0
        )
          say(`nodes after leaving ${JSON.stringify(after)}, baseline ${JSON.stringify(baseline)}`);
        const left = (await audioStats(page))!;
        if (left.keys.length > 0) say(`loops left: ${left.keys.join(' ')}`);
        if (errors.length > 0) say(`page errors: ${errors.join(' | ')}`);
        rows.push(
          `| \`${id}\` | ${started.length} | ${stats.peakVoices} | ${stats.peakMusic} | ${stats.nodes.engine} | ${baseline.total} | ${after.total} |`,
        );
      } catch (error) {
        say(`did not finish: ${String(error).split('\n')[0]}`);
      } finally {
        await context.close();
      }
    };

    // One at a time. Two clients on a small machine each run slower than one after the other.
    for (const id of ids) await run(id);
    rows.sort();
    save(
      'live-scenarios.md',
      `# Scenarios in the real client\n\nEach showcase scenario played in the production build in headless Chromium, read from the audio system's own log (\`window.__boltAudio\`). The node counts are the audio system's ledger of live Web Audio nodes: before the race, and after leaving it. No person has listened.\n\nThe per-frame audio update (engine and tire parameters, no node creation) took ${(frameMs / Math.max(1, frames)).toFixed(3)} ms on average over ${frames} frames, worst ${worstMs.toFixed(2)} ms, on this machine under software rendering; a frame at 60 Hz is 16.7 ms.\n\n| Scenario | Voices started | Most at once (cap ${CAPS.totalVoices}) | Most music voices (cap ${CAPS.bus.music}) | Engine and tire nodes (cap ${CAPS.engineNodes}) | Nodes before | Nodes after |\n| :-- | --: | --: | --: | --: | --: | --: |\n${rows.join('\n')}\n`,
    );
    expect(problems).toEqual([]);
  });
});
