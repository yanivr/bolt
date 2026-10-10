import { CHASSIS, CITY_01, PAINTS, STRINGS, WEATHER_PRESETS } from '@bolt/content';
import { useEffect, useState } from 'react';
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
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (o: string) => Promise<void>;
    };
    await orientation.lock?.('landscape');
  } catch {
    // Unsupported or refused: the rotate prompt covers it.
  }
}

/** True on short landscape phones, where the menu must fit about 360 CSS pixels of height. */
function useCompact(): boolean {
  const [compact, setCompact] = useState(() => window.innerHeight < 470);
  useEffect(() => {
    const update = () => setCompact(window.innerHeight < 470);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return compact;
}

/**
 * Home for the Milestone A build. Only actions that exist are shown: there are no decorative
 * buttons for modes that later milestones add (Section 0, definition of finished).
 */
export function HomeScreen() {
  const setScreen = useApp((s) => s.setScreen);
  const loadout = useApp((s) => s.loadout);
  const setLoadout = useApp((s) => s.setLoadout);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const manifests = getManifests();
  const weather = WEATHER_PRESETS[WEATHER_PRESET_ID];

  const compact = useCompact();
  const chassisIds = Object.keys(CHASSIS);
  const chassis = CHASSIS[loadout.chassisId] ?? CHASSIS[chassisIds[0]!]!;
  const cycle = (step: number) => {
    const at = chassisIds.indexOf(chassis.id);
    setLoadout({ chassisId: chassisIds[(at + step + chassisIds.length) % chassisIds.length]! });
  };

  const start = () => {
    void enterImmersive();
    setScreen('race');
  };

  return (
    <main className="screen home">
      <section className="home-stage">
        <div className="turntable" aria-hidden="true">
          <div className="turntable-disc" />
          {manifests && (
            <CarTurntable
              manifests={manifests}
              chassisId={chassis.id}
              engineId={loadout.engineId}
              tireKitId={loadout.tireKitId}
              paintId={loadout.paintId}
              scale={compact ? 2 : 3}
            />
          )}
        </div>
        <div className="panel car-pick">
          <div className="car-pick-row">
            <button
              className="btn btn-small"
              onClick={() => cycle(-1)}
              aria-label={STRINGS.home.previousCar}
            >
              <span className="icon-arrow icon-arrow-left" aria-hidden="true" />
            </button>
            <div className="car-pick-name" aria-live="polite">
              <strong>{chassis.displayName}</strong>
              <span>{chassis.description}</span>
            </div>
            <button
              className="btn btn-small"
              onClick={() => cycle(1)}
              aria-label={STRINGS.home.nextCar}
            >
              <span className="icon-arrow" aria-hidden="true" />
            </button>
          </div>
          <div className="swatches" role="radiogroup" aria-label={STRINGS.home.paint}>
            {Object.values(PAINTS).map((paint) => (
              <button
                key={paint.id}
                role="radio"
                aria-checked={loadout.paintId === paint.id}
                aria-label={paint.displayName}
                className={`swatch swatch-${paint.id}${loadout.paintId === paint.id ? ' is-selected' : ''}`}
                onClick={() => setLoadout({ paintId: paint.id })}
              />
            ))}
          </div>
        </div>
      </section>
      <section className="home-menu">
        <Emblem scale={compact ? 2 : 3} />
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
