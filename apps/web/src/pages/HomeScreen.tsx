import { CATALOG, STRINGS, baselineBlueprint } from '@bolt/content';
import { blueprintCost, drawableChassisIds } from '@bolt/shared';
import { useEffect, useState } from 'react';
import { getManifests } from '../app/App.js';
import { enterImmersive } from '../app/immersive.js';
import { MILESTONE_BUILT, useApp } from '../app/store.js';
import { isDrawable } from '../components/BlueprintCard.js';
import { CarCanvas } from '../components/CarCanvas.js';
import { Dialog } from '../components/Dialog.js';
import { Emblem } from '../components/Emblem.js';
import { Glyph } from '../components/Glyph.js';
import { StarterList } from '../components/StarterList.js';
import { useViewport } from '../components/useViewport.js';
import { useCodeUi } from '../garage/codeStore.js';
import { fill } from '../garage/text.js';
import { SettingsPanel } from '../hud/SettingsPanel.js';

/**
 * Home (Section 5.3). Only actions that exist are shown: there are no decorative buttons for
 * the modes later milestones add. `Start Racing` leads through the track preview and the
 * garage; a returning player has `Use Last Build`, which goes straight to the grid.
 */
export function HomeScreen() {
  const setScreen = useApp((s) => s.setScreen);
  const blueprint = useApp((s) => s.blueprint);
  const setBlueprint = useApp((s) => s.setBlueprint);
  const returning = useApp((s) => s.milestones[MILESTONE_BUILT] === true);
  const completeMilestone = useApp((s) => s.completeMilestone);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const manifests = getManifests();
  const { width, height } = useViewport();
  const compact = height < 470;
  const portrait = height > width;

  // A stored car on a chassis without art cannot be shown or raced yet: fall back to the
  // first one that can, on the same paint. This lifts by itself as the atlas fills.
  const drawable = manifests ? isDrawable(manifests, blueprint) : false;
  const firstDrawable = manifests ? drawableChassisIds(manifests.cars, CATALOG)[0] : undefined;
  useEffect(() => {
    if (!drawable && firstDrawable)
      setBlueprint(baselineBlueprint({ chassisId: firstDrawable, paintId: blueprint.paintId }));
  }, [drawable, firstDrawable, blueprint.paintId, setBlueprint]);

  const chassis = CATALOG.chassis[blueprint.chassisId];
  const cost = blueprintCost(blueprint, CATALOG).total;
  const stage = portrait
    ? Math.min(width * 0.7, height * 0.3)
    : Math.min(height * 0.58, width * 0.44);
  const scale = Math.max(1, Math.min(4, Math.floor(stage / 110)));

  const race = () => {
    if (!drawable) return;
    void enterImmersive();
    setScreen('race');
  };

  return (
    <main className="screen home">
      <section className="home-stage">
        <div className="turntable" aria-hidden="true">
          <div className="turntable-disc" />
          {manifests && drawable && (
            <CarCanvas manifests={manifests} blueprint={blueprint} scale={scale} spin />
          )}
        </div>
        <div className="panel home-car" aria-live="polite">
          <span className="home-car-label">
            {returning ? STRINGS.home.lastBuild : STRINGS.home.yourCar}
          </span>
          <strong className="home-car-name" data-testid="home-car-name">
            {blueprint.name}
          </strong>
          <span className="home-car-meta">
            <span data-testid="home-car-chassis">{chassis?.displayName}</span>
            <span className="credits">
              <Glyph name="coin" size={12} />
              {fill(STRINGS.home.credits, { cost })}
            </span>
          </span>
        </div>
      </section>
      <section className="home-menu">
        <Emblem scale={compact ? 2 : 3} />
        <button
          className="btn btn-primary btn-large"
          onClick={() => {
            void enterImmersive();
            setScreen('preview');
          }}
          autoFocus
        >
          {STRINGS.home.startRacing}
        </button>
        <div className="home-row home-friend">
          <button
            className="btn"
            onClick={() => {
              void enterImmersive();
              setScreen('lobby');
            }}
            data-testid="challenge-friend"
          >
            {STRINGS.home.challengeFriend}
          </button>
          <button className="btn" onClick={() => setScreen('join')} data-testid="join-with-code">
            {STRINGS.home.joinWithCode}
          </button>
        </div>
        <div className="home-row">
          {returning && (
            <button className="btn" onClick={race} disabled={!drawable}>
              {STRINGS.home.useLastBuild}
            </button>
          )}
          <button className="btn" onClick={() => setQuickOpen(true)}>
            {STRINGS.home.quickBuild}
          </button>
          <button className="btn" onClick={() => useCodeUi.getState().openLoad()}>
            {STRINGS.codes.loadCode}
          </button>
        </div>
        <div className="home-row">
          <button className="btn" onClick={() => setScreen('blueprints')}>
            {STRINGS.home.myBlueprints}
          </button>
          <button className="btn" onClick={() => setSettingsOpen(true)}>
            {STRINGS.home.settings}
          </button>
        </div>
      </section>
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      {quickOpen && manifests && (
        <Dialog
          title={STRINGS.home.quickBuildTitle}
          onClose={() => setQuickOpen(false)}
          className="sheet"
          head={
            <button className="btn btn-small" onClick={() => setQuickOpen(false)}>
              {STRINGS.home.close}
            </button>
          }
        >
          <p className="sheet-note">{STRINGS.home.quickBuildNote}</p>
          <div className="sheet-body">
            <StarterList
              manifests={manifests}
              actionLabel={STRINGS.home.raceThisCar}
              onPick={(template) => {
                if (!setBlueprint(template.blueprint)) return;
                completeMilestone(MILESTONE_BUILT);
                void enterImmersive();
                setScreen('race');
              }}
            />
          </div>
        </Dialog>
      )}
    </main>
  );
}
