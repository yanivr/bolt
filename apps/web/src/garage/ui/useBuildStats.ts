import { CATALOG, conditionsFor } from '@bolt/content';
import type { BuildStats, BuildStatsDelta, VehicleBlueprint } from '@bolt/shared';
import { compareBuildStats, computeBuildStats } from '@bolt/shared';
import { useMemo } from 'react';
import { useApp } from '../../app/store.js';

/**
 * Build stats for the published track and weather, straight from the shared model. The
 * interface never recomputes a rule: it shows these numbers and the differences between them.
 */
export function useBuildStats(blueprint: VehicleBlueprint | null): BuildStats | null {
  const { trackId, presetId } = useApp((s) => s.course);
  return useMemo(
    () =>
      blueprint ? computeBuildStats(blueprint, CATALOG, conditionsFor(trackId, presetId)) : null,
    [blueprint, trackId, presetId],
  );
}

export type BuildPreview = { stats: BuildStats; delta: BuildStatsDelta };

/** What a change would do to the stats, or null when there is nothing to preview. */
export function useBuildPreview(
  before: BuildStats | null,
  after: VehicleBlueprint | null,
): BuildPreview | null {
  const stats = useBuildStats(after);
  return useMemo(
    () => (before && stats ? { stats, delta: compareBuildStats(before, stats) } : null),
    [before, stats],
  );
}
