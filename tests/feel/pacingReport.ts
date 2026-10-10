import { CITY_01 } from '@bolt/content';
import type { CameraView } from '../../apps/web/src/game/rendering/frame.js';
import { DISPLAYS, RESULT_HEADER, displayTimeline, formatResult, lapWorld, measure, straightWorld } from './pacing.js';
import { makeSkidPad } from './pad.js';
import { shippedPipeline } from './pipelineBench.js';

/**
 * Prints the frame-pacing tables for the shipped render pipeline.
 *
 *   npx tsx tests/feel/pacingReport.ts
 */
const pad = makeSkidPad();
const padView: CameraView = { widthPx: 1688, heightPx: 780, scale: 2, worldWidth: pad.worldWidth, worldHeight: pad.worldHeight };
const cityView: CameraView = { ...padView, worldWidth: CITY_01.worldWidth, worldHeight: CITY_01.worldHeight };

console.log('SHIPPED PIPELINE (north-up, fixed whole-number scale), 844x390 CSS at DPR 2, default Beetle\n');
console.log('Steady top speed on a straight');
console.log(RESULT_HEADER);
for (const d of DISPLAYS)
  console.log(formatResult(d.name, measure(shippedPipeline(straightWorld(), padView), displayTimeline(d.model, 14), d.model.hz, 4)));
console.log('\nSteady top speed on a diagonal (both axes moving)');
console.log(RESULT_HEADER);
for (const d of DISPLAYS)
  console.log(formatResult(d.name, measure(shippedPipeline(straightWorld(-2.2), padView), displayTimeline(d.model, 7), d.model.hz, 3)));
console.log('\nReference driver, Neon Cut, first 45 s');
console.log(RESULT_HEADER);
for (const d of DISPLAYS)
  console.log(formatResult(d.name, measure(shippedPipeline(lapWorld(), cityView), displayTimeline(d.model, 45), d.model.hz, 3.5)));
