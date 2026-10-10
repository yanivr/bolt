import { CITY_01, DEFAULT_LOADOUT, STRINGS, WEATHER_PRESETS } from '@bolt/content';
import { useState } from 'react';
import { WEATHER_PRESET_ID, getManifests } from '../app/App.js';
import { useApp } from '../app/store.js';
import { CarTurntable } from '../components/CarTurntable.js';
import { Emblem } from '../components/Emblem.js';
import { SettingsPanel } from '../hud/SettingsPanel.js';

/** Fullscreen and landscape are best-effort and only ever requested from a tap (Section 2). */
async function enterImmersive(): Promise<void> {
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    }
    const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    await orientation.lock?.('landscape');
  } catch {
    // Unsupported or refused: the rotate prompt covers it.
  }
}

/**
 * Home for the Milestone A build. Only actions that exist are shown: there are no decorative
 * buttons for modes that later milestones add (Section 0, definition of finished).
 */
export function HomeScreen() {
  const setScreen = useApp((s) => s.setScreen);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const manifests = getManifests();
  const weather = WEATHER_PRESETS[WEATHER_PRESET_ID];

  const start = () => {
    void enterImmersive();
    setScreen('race');
  };

  return (
    <main className="screen home">
      <section className="home-stage" aria-hidden="true">
        <div className="turntable">
          <div className="turntable-disc" />
          {manifests && (
            <CarTurntable
              manifests={manifests}
              chassisId={DEFAULT_LOADOUT.chassisId}
              engineId={DEFAULT_LOADOUT.engineId}
              tireKitId={DEFAULT_LOADOUT.tireKitId}
              paintId={DEFAULT_LOADOUT.paintId}
              scale={3}
            />
          )}
        </div>
      </section>
      <section className="home-menu">
        <Emblem scale={3} />
        <div className="panel track-card">
          <span className="track-card-name">{CITY_01.name}</span>
          <span className="track-card-meta">
            {weather?.displayName} · {CITY_01.laps} laps
          </span>
        </div>
        <button className="btn btn-primary btn-large" onClick={start} autoFocus>
          {STRINGS.home.startRacing}
        </button>
        <button className="btn" onClick={() => setSettingsOpen(true)}>
          {STRINGS.home.settings}
        </button>
      </section>
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </main>
  );
}
