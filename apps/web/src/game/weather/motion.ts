import { debugEnabled } from '../../app/flags.js';

/**
 * Reduced Motion (Section 16). The game has no setting of its own for it, so the weather layer
 * follows the system preference (`prefers-reduced-motion: reduce`), as the garage's animations
 * already do. `?debug=1&motion=reduce` (or `motion=full`) forces it for review and tests.
 * Under it the weather is thinned to half, falls and blows slower, the haze does not drift,
 * light shafts do not breathe and there is no lightning.
 */
export function reducedMotionPreferred(): boolean {
  try {
    if (debugEnabled()) {
      const forced = new URLSearchParams(window.location.search).get('motion');
      if (forced === 'reduce') return true;
      if (forced === 'full') return false;
    }
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}
