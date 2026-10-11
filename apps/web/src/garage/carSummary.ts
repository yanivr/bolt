import type { BuildStats } from '@bolt/shared';

/**
 * The car in two lines, derived from the numbers the shared model predicts and nothing else:
 * which of the five scores it leads with, and which it gives up. Pure, so it is unit tested.
 */

export const SCORE_KEYS = ['speed', 'control', 'defense', 'firepower', 'utility'] as const;
export type ScoreKey = (typeof SCORE_KEYS)[number];

/** A score at or above this is something the car is good at. */
export const STRONG_SCORE = 60;
/** A lowest score under this is a weakness worth naming; above it the car has none. */
export const WEAK_SCORE = 45;

export type CarSummary = {
  /** The best one or two scores, highest first. Empty when nothing reaches `STRONG_SCORE`. */
  strengths: Array<{ key: ScoreKey; value: number }>;
  /** The best score when none is strong, so the first line always has something true to say. */
  best: { key: ScoreKey; value: number };
  /** The lowest score, when it is low enough to matter. */
  weakness: { key: ScoreKey; value: number } | null;
};

export function summarizeCar(scores: BuildStats['scores']): CarSummary {
  // Ties keep the order of the score strip, so the summary never flickers between equals.
  const ranked = SCORE_KEYS.map((key, index) => ({ key, value: scores[key], index })).sort(
    (a, b) => b.value - a.value || a.index - b.index,
  );
  const pick = ({ key, value }: { key: ScoreKey; value: number }) => ({ key, value });
  const lowest = [...ranked].sort((a, b) => a.value - b.value || b.index - a.index)[0]!;
  return {
    strengths: ranked
      .filter((s) => s.value >= STRONG_SCORE)
      .slice(0, 2)
      .map(pick),
    best: pick(ranked[0]!),
    weakness: lowest.value < WEAK_SCORE && lowest.value < ranked[0]!.value ? pick(lowest) : null,
  };
}
