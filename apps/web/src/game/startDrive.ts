import { DEFAULT_LOADOUT, environmentFor, getTrack, resolveLoadout } from '@bolt/content';
import type { DriveSession, TrackRuntime, VehicleLoadout } from '@bolt/shared';
import { PROTOCOL_VERSION, buildTrack, createDriveSession } from '@bolt/shared';
import { ensureGuest, probeServer } from '../network/api.js';
import type { DriveLink } from '../network/link.js';
import { OfflineLink } from '../network/offlineLink.js';
import { JoinError, OnlineLink } from '../network/onlineLink.js';

export type DriveSetup = {
  link: DriveLink;
  /** The locally predicted session. The link owns the authoritative one. */
  session: DriveSession;
  track: TrackRuntime;
  loadout: VehicleLoadout;
};

export type DriveSetupError = 'version' | 'server' | 'content';

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

const FORCE_OFFLINE = import.meta.env.VITE_FORCE_OFFLINE === '1';
/** The offline test drive is a Milestone A development aid; production builds can turn it off. */
const ALLOW_OFFLINE = import.meta.env.VITE_ALLOW_OFFLINE !== '0';

/**
 * Connects a test drive. The authoritative server is always preferred. If it cannot be
 * reached and offline driving is allowed, the same shared simulation runs in the page and the
 * HUD says so; it is never presented as a real race.
 */
export async function startDrive(
  trackId: string,
  weatherPresetId: string,
  loadout: VehicleLoadout = DEFAULT_LOADOUT,
): Promise<DriveSetup | { error: DriveSetupError }> {
  const track = runtimeFor(trackId);
  const env = environmentFor(weatherPresetId);
  const resolved = resolveLoadout(loadout);
  if (!track || !env || !resolved.ok) return { error: 'content' };
  const predicted = () => createDriveSession(track, env, resolved.params, 0);

  if (!FORCE_OFFLINE) {
    const probe = await probeServer();
    if (probe.reachable) {
      if (!probe.versionOk) return { error: 'version' };
      try {
        const guest = await ensureGuest();
        const link = await OnlineLink.join({
          protocolVersion: PROTOCOL_VERSION,
          guestToken: guest.token,
          trackId,
          weatherPresetId,
          loadout,
        });
        return { link, session: predicted(), track, loadout };
      } catch (error) {
        if (error instanceof JoinError && error.reason === 'version') return { error: 'version' };
        if (!ALLOW_OFFLINE) return { error: 'server' };
      }
    } else if (!ALLOW_OFFLINE) {
      return { error: 'server' };
    }
  }

  const authority = createDriveSession(track, env, resolved.params, 0);
  return { link: new OfflineLink(authority), session: predicted(), track, loadout };
}
