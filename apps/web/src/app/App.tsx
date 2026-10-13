import { getTrack } from '@bolt/content';
import { buildTrack } from '@bolt/shared';
import { useEffect } from 'react';
import { loadCoreManifests, loadCourseManifests } from '../game/assets.js';
import type { CoreManifests, GameManifests } from '../game/assets.js';
import { BootScreen } from '../pages/BootScreen.js';
import { CodeHost } from '../garage/ui/CodeHost.js';
import { BlueprintsScreen } from '../pages/BlueprintsScreen.js';
import { GarageScreen } from '../pages/GarageScreen.js';
import { HomeScreen } from '../pages/HomeScreen.js';
import { JoinScreen } from '../pages/JoinScreen.js';
import { LobbyScreen } from '../pages/LobbyScreen.js';
import { MatchDirector } from '../pages/match/MatchDirector.js';
import { openedAtInvite } from '../network/invite.js';
import { MatchClient } from '../network/matchClient.js';
import { PrivacyScreen, openedAtPrivacy } from '../pages/PrivacyScreen.js';
import { RaceScreen } from '../pages/RaceScreen.js';
import { TrackPreviewScreen } from '../pages/TrackPreviewScreen.js';
import type { Course, CourseOption } from './course.js';
import { availableCourses, settleCourse } from './course.js';
import { debugEnabled } from './flags.js';
import { useApp } from './store.js';

let corePromise: Promise<CoreManifests> | null = null;
let core: CoreManifests | null = null;
let manifests: GameManifests | null = null;
const courseCache = new Map<string, Promise<GameManifests>>();

/** The art of the course last loaded, or null before boot. */
export function getManifests(): GameManifests | null {
  return manifests;
}

/** The track-independent manifests, or null before boot. */
export function getCoreManifests(): CoreManifests | null {
  return core;
}

/**
 * The courses this build may offer: every track and weather with baked terrain, and in a
 * development or `?debug=1` build all eight tracks and both of their weathers (`app/course.ts`).
 */
export function courseOptions(): CourseOption[] {
  return availableCourses(core?.artIndex ?? { version: 1, maps: [] }, debugEnabled());
}

/** The art for a course, loaded once. Rejects only when a baked course fails to download. */
export function courseAssets(course: Course): Promise<GameManifests> {
  const key = `${course.trackId}/${course.presetId}`;
  let pending = courseCache.get(key);
  if (!pending) {
    const def = getTrack(course.trackId);
    pending = (corePromise ?? Promise.reject(new Error('assets are not booted')))
      .then((c) => {
        if (!def) throw new Error(`no track ${course.trackId}`);
        return loadCourseManifests(c, course, buildTrack(def));
      })
      .then((m) => {
        manifests = m;
        return m;
      });
    pending.catch(() => courseCache.delete(key));
    courseCache.set(key, pending);
  }
  return pending;
}

/**
 * Loads the art manifests once, then the terrain of the chosen course (settled onto one this
 * build may offer). Safe under React strict mode's double effects.
 */
export function bootAssets(): Promise<GameManifests> {
  corePromise ??= loadCoreManifests().then((c) => {
    core = c;
    return c;
  });
  return corePromise.then(() => {
    const wanted = useApp.getState().course;
    const settled = settleCourse(wanted, courseOptions());
    if (settled.trackId !== wanted.trackId || settled.presetId !== wanted.presetId)
      useApp.getState().setCourse({ trackId: settled.trackId, presetId: settled.presetId });
    return courseAssets(settled);
  });
}

export function App() {
  const screen = useApp((s) => s.screen);
  const settings = useApp((s) => s.settings);
  const setBoot = useApp((s) => s.setBoot);
  const setScreen = useApp((s) => s.setScreen);

  useEffect(() => {
    let cancelled = false;
    setBoot({ stage: 'garage', progress: 0.2 });
    bootAssets()
      .then(() => {
        if (cancelled) return;
        setBoot({ stage: 'ready' });
        setScreen(openedAtPrivacy() ? 'privacy' : openedAtInvite() ? 'join' : 'home');
        // A refresh in the middle of a friend match takes this tab's seat back, if it is kept.
        if (!openedAtInvite()) void MatchClient.resume().catch(() => undefined);
      })
      .catch(() => {
        corePromise = null;
        if (!cancelled) setBoot({ stage: 'error', kind: 'assets' });
      });
    return () => {
      cancelled = true;
    };
  }, [setBoot, setScreen]);

  return (
    <div
      className={`app hand-${settings.drivingHand}${settings.reduceFlashes ? ' reduce-flashes' : ''}`}
    >
      {screen === 'boot' && <BootScreen />}
      {screen === 'home' && <HomeScreen />}
      {screen === 'preview' && <TrackPreviewScreen />}
      {screen === 'garage' && <GarageScreen />}
      {screen === 'blueprints' && <BlueprintsScreen />}
      {screen === 'race' && <RaceScreen />}
      {screen === 'privacy' && <PrivacyScreen />}
      {screen === 'lobby' && <LobbyScreen />}
      {screen === 'join' && <JoinScreen />}
      <MatchDirector />
      <CodeHost />
    </div>
  );
}
