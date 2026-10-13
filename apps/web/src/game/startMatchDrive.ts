import { conditionsFor, environmentFor, getTrack, resolveBuild } from '@bolt/content';
import type { TrackRuntime } from '@bolt/shared';
import { blueprintSchema, buildTrack, createDriveSession } from '@bolt/shared';
import type { MatchClient } from '../network/matchClient.js';
import { useMatch } from '../network/matchClient.js';
import type { DriveSetup, DriveSetupError, RivalSetup } from './startDrive.js';

const trackCache = new Map<string, TrackRuntime>();
function runtimeFor(trackId: string): TrackRuntime | null {
  const cached = trackCache.get(trackId);
  if (cached) return cached;
  const def = getTrack(trackId);
  if (!def) return null;
  const runtime = buildTrack(def);
  trackCache.set(trackId, runtime);
  return runtime;
}

/**
 * The race view's setup for a race in a friend match: the car the server locked for this
 * player (after a swap, the rival's build), on the grid slot the room gave it, against the
 * other player's car as the room publishes it. Like the race against the computer, the
 * predicted car is derived here from the same blueprint and published conditions as the
 * server's, so prediction and authority start from identical coefficients.
 */
export async function startMatchDrive(
  match: MatchClient,
): Promise<DriveSetup | { error: DriveSetupError }> {
  const link = match.linkForRace();
  // The room writes this player's view of the race and sends the build it locked for it with
  // the phase change; wait for both.
  const deadline = performance.now() + 5000;
  while (
    (!link.view() || useMatch.getState().locked?.raceId !== link.raceId) &&
    performance.now() < deadline
  )
    await new Promise((resolve) => window.setTimeout(resolve, 30));
  const state = useMatch.getState();
  const locked = state.locked?.raceId === link.raceId ? state.locked : null;
  const track = runtimeFor(state.trackId);
  const env = environmentFor(state.weatherPresetId);
  const conditions = conditionsFor(state.trackId, state.weatherPresetId);
  if (!locked || !track || !env || !conditions) return { error: 'content' };
  const resolved = resolveBuild(locked.blueprint, conditions);
  if (!resolved.ok) return { error: 'content' };
  const view = link.view();
  if (!view) return { error: 'server' };
  const you = view.you ?? 0;
  let rival: RivalSetup | null = null;
  try {
    const parsed = blueprintSchema.safeParse(JSON.parse(view.rivalBlueprint));
    if (parsed.success) {
      const r = resolveBuild(parsed.data, conditions);
      if (r.ok) rival = { blueprint: r.build.blueprint, params: r.params };
    }
  } catch {
    rival = null;
  }
  return {
    link,
    session: createDriveSession(track, env, resolved.params, you),
    track,
    blueprint: resolved.build.blueprint,
    buildHash: resolved.buildHash,
    build: resolved.build,
    conditions,
    rival,
    script: null,
    scenario: null,
  };
}
