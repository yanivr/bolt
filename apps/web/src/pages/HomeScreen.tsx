import {
  CATALOG,
  CITY_01,
  PAINTS,
  STRINGS,
  WEATHER_PRESETS,
  baselineBlueprint,
} from '@bolt/content';
import { drawableChassisIds, resolveCarSprites } from '@bolt/shared';
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
  const blueprint = useApp((s) => s.blueprint);
  const setBlueprint = useApp((s) => s.setBlueprint);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const manifests = getManifests();
  const weather = WEATHER_PRESETS[WEATHER_PRESET_ID];

  const compact = useCompact();
  // The picker offers only chassis the artists have finished. The catalog and the server
  // already know all twenty; the rest appear here as their sprites land in the car atlas.
  const chassisIds = manifests ? drawableChassisIds(manifests.cars, CATALOG) : [];
  const drawable = chassisIds.includes(blueprint.chassisId);
  const chassis = CATALOG.chassis[drawable ? blueprint.chassisId : (chassisIds[0] ?? '')];
  const sprites =
    manifests && drawable ? resolveCarSprites(manifests.cars, blueprint).loadout : null;

  // A stored car on a chassis without art cannot be shown or raced yet: fall back to the
  // first one that can, on the same paint.
  const firstDrawable = chassisIds[0];
  useEffect(() => {
    if (!drawable && firstDrawable)
      setBlueprint(baselineBlueprint({ chassisId: firstDrawable, paintId: blueprint.paintId }));
  }, [drawable, firstDrawable, blueprint.paintId, setBlueprint]);

  // Until the garage arrives this picks a bare car: the chosen chassis with its default
  // engine and Street Tires, as a real blueprint the server validates like any other.
  const cycle = (step: number) => {
    if (!chassis || chassisIds.length === 0) return;
    const at = chassisIds.indexOf(chassis.id);
    const next = chassisIds[(at + step + chassisIds.length) % chassisIds.length]!;
    setBlueprint(baselineBlueprint({ chassisId: next, paintId: blueprint.paintId }));
  };

  const start = () => {
    if (!sprites) return;
    void enterImmersive();
    setScreen('race');
  };

  return (
    <main className="screen home">
      <section className="home-stage">
        <div className="turntable" aria-hidden="true">
          <div className="turntable-disc" />
          {manifests && sprites && (
            <CarTurntable
              manifests={manifests}
              chassisId={sprites.chassisId}
              engineId={sprites.engineId}
              tireKitId={sprites.tireKitId}
              paintId={sprites.paintId}
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
              <strong>{chassis?.displayName}</strong>
              <span>{chassis?.description}</span>
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
                aria-checked={blueprint.paintId === paint.id}
                aria-label={paint.displayName}
                className={`swatch swatch-${paint.id}${blueprint.paintId === paint.id ? ' is-selected' : ''}`}
                onClick={() => setBlueprint({ ...blueprint, paintId: paint.id })}
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
