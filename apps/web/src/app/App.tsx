import { useEffect } from 'react';
import { loadManifests } from '../game/assets.js';
import type { GameManifests } from '../game/assets.js';
import { BootScreen } from '../pages/BootScreen.js';
import { HomeScreen } from '../pages/HomeScreen.js';
import { RaceScreen } from '../pages/RaceScreen.js';
import { useApp } from './store.js';

export const TRACK_ID = 'city_01';
export const WEATHER_PRESET_ID = 'city_clear_night';

let manifestsPromise: Promise<GameManifests> | null = null;
let manifests: GameManifests | null = null;

export function getManifests(): GameManifests | null {
  return manifests;
}

/** Loads the art manifests once. Safe under React strict mode's double effects. */
export function bootAssets(): Promise<GameManifests> {
  manifestsPromise ??= loadManifests(TRACK_ID, WEATHER_PRESET_ID).then((m) => {
    manifests = m;
    return m;
  });
  return manifestsPromise;
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
        setScreen('home');
      })
      .catch(() => {
        manifestsPromise = null;
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
      {screen === 'race' && <RaceScreen />}
    </div>
  );
}
