import { CATALOG, STRINGS } from '@bolt/content';
import { mountedPartSprites, resolveBlueprint, resolveCarSprites } from '@bolt/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { TRACK_ID, WEATHER_PRESET_ID, bootAssets } from '../app/App.js';
import { debugEnabled } from '../app/flags.js';
import { useApp, useHud } from '../app/store.js';
import type { RaceGameHandle } from '../game/RaceGame.js';
import { createRaceGame } from '../game/RaceGame.js';
import type { GameManifests } from '../game/assets.js';
import { EngineAudio } from '../game/audio/EngineAudio.js';
import type { DriveOptions, DriveSetup, DriveSetupError } from '../game/startDrive.js';
import { startDrive } from '../game/startDrive.js';
import { Hud } from '../hud/Hud.js';
import { Results } from '../hud/Results.js';
import { SettingsPanel } from '../hud/SettingsPanel.js';
import { hudLive, setHudFrozen, startHudFeed, useCombat } from '../hud/hudStore.js';
import type { HudLoadout } from '../hud/model.js';
import { buildHudLoadout } from '../hud/model.js';
import { DriveInput } from '../input/driveInput.js';

type LoadState =
  | { kind: 'loading'; stage: 'connecting' | 'track'; progress: number }
  | { kind: 'ready' }
  | { kind: 'error'; reason: DriveSetupError | 'assets' };

/**
 * Debug switches for the race, read from the query string (ignored in a production build
 * without `?debug=1`): `rival=<template id>` picks the sparring rival, `seed=<n>` its seed,
 * and `scenario=<id>` plays a showcase scenario in the page with both cars scripted.
 */
function driveOptions(): DriveOptions {
  const options: DriveOptions = {};
  if (!debugEnabled()) return options;
  const query = new URLSearchParams(window.location.search);
  const rival = query.get('rival');
  if (rival && /^[a-z0-9_]{1,48}$/.test(rival)) options.rivalTemplateId = rival;
  const seed = Number(query.get('seed'));
  if (query.has('seed') && Number.isInteger(seed) && seed >= 0 && seed <= 0x7fffffff)
    options.seed = seed;
  const scenario = query.get('scenario');
  if (scenario && /^[a-z0-9_]{1,48}$/.test(scenario)) options.scenarioId = scenario;
  return options;
}

/**
 * What the HUD needs to know about the two cars: the local car's buttons, components and
 * limits, and the names of the rival's components for callouts and results.
 */
function hudSetup(setup: DriveSetup): { loadout: HudLoadout; rivalNames: string[] } {
  const world = { width: setup.track.def.worldWidth, height: setup.track.def.worldHeight };
  const loadout = buildHudLoadout(setup.build, setup.session.params, world);
  const rivalBuild = setup.rival ? resolveBlueprint(setup.rival.blueprint, CATALOG) : null;
  const rivalNames =
    setup.rival && rivalBuild
      ? buildHudLoadout(rivalBuild, setup.rival.params, world).components.map((c) => c.name)
      : [];
  return { loadout, rivalNames };
}

/** Section 5.10: a paused single-player race resumes by itself after this long. */
const PAUSE_LIMIT_SECONDS = 120;
/** If the local car has finished and no result has come this long after, show what there is. */
const RESULT_PATIENCE_MS = 12_000;

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** The notice at the top of the pause menu: what the race is doing while the menu is open. */
function PauseNotice({ online, onTimeout }: { online: boolean; onTimeout: () => void }) {
  const [left, setLeft] = useState(PAUSE_LIMIT_SECONDS);
  useEffect(() => {
    if (online) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      const remaining = PAUSE_LIMIT_SECONDS - Math.floor((Date.now() - started) / 1000);
      setLeft(Math.max(0, remaining));
      if (remaining <= 0) onTimeout();
    }, 250);
    return () => window.clearInterval(timer);
  }, [online, onTimeout]);
  return (
    <p className="notice" data-testid="pause-notice">
      {online ? STRINGS.race.pauseNote : STRINGS.race.pausedNote.replace('{time}', clock(left))}
    </p>
  );
}

function usePortrait(): boolean {
  const [portrait, setPortrait] = useState(() => window.innerHeight > window.innerWidth * 1.05);
  useEffect(() => {
    const update = () => setPortrait(window.innerHeight > window.innerWidth * 1.05);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return portrait;
}

export function RaceScreen() {
  const canvasHost = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const game = useRef<RaceGameHandle | null>(null);
  const [load, setLoad] = useState<LoadState>({
    kind: 'loading',
    stage: 'connecting',
    progress: 0,
  });
  const [manifests, setManifests] = useState<GameManifests | null>(null);
  const [hud, setHud] = useState<{ loadout: HudLoadout; input: DriveInput } | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [portraitOk, setPortraitOk] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const paused = useApp((s) => s.paused);
  const setPaused = useApp((s) => s.setPaused);
  const setScreen = useApp((s) => s.setScreen);
  const finished = useHud((s) => s.finished);
  const result = useCombat((s) => s.result);
  const summary = useCombat((s) => s.summary);
  const preview = useCombat((s) => s.preview);
  const you = useCombat((s) => s.you);
  const linkStatus = useHud((s) => s.linkStatus);
  const linkMode = useHud((s) => s.linkMode);
  const portrait = usePortrait();

  useEffect(() => {
    const host = canvasHost.current;
    const touch = surface.current;
    if (!host || !touch) return;
    let cancelled = false;
    let leave: (() => void) | null = null;
    let stopFeed: (() => void) | null = null;
    const input = new DriveInput();
    const audio = new EngineAudio();
    const unlock = () => audio.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    setLoad({ kind: 'loading', stage: 'connecting', progress: 0 });

    void (async () => {
      try {
        const [m, setup] = await Promise.all([
          bootAssets(),
          startDrive(TRACK_ID, WEATHER_PRESET_ID, useApp.getState().blueprint, driveOptions()),
        ]);
        if ('error' in setup) {
          if (!cancelled) setLoad({ kind: 'error', reason: setup.error });
          return;
        }
        leave = () => setup.link.leave();
        if (cancelled) {
          leave();
          return;
        }
        // Until every part has art, engines and wheel kits without a sprite sheet are drawn
        // with the default one. The session above already runs the real blueprint.
        const sprites = resolveCarSprites(m.cars, setup.blueprint).loadout;
        if (!sprites) {
          leave();
          setLoad({ kind: 'error', reason: 'content' });
          return;
        }
        // The rival is drawn with the same compositor; without art for it, it is left out.
        const rivalSprites = setup.rival
          ? resolveCarSprites(m.cars, setup.rival.blueprint).loadout
          : null;
        setManifests(m);
        // The HUD listens to the race feed from before the first snapshot.
        const { loadout, rivalNames } = hudSetup(setup);
        input.repairMask = loadout.repairMask;
        stopFeed = startHudFeed({ loadout, rivalNames, laps: setup.track.def.laps });
        setHud({ loadout, input });
        setLoad({ kind: 'loading', stage: 'track', progress: 0 });
        input.attach(touch);
        game.current = createRaceGame(host, {
          manifests: m,
          session: setup.session,
          link: setup.link,
          loadout: sprites,
          parts: mountedPartSprites(m.cars, setup.blueprint, CATALOG),
          build: setup.build,
          conditions: setup.conditions,
          rival:
            setup.rival && rivalSprites
              ? {
                  loadout: rivalSprites,
                  parts: mountedPartSprites(m.cars, setup.rival.blueprint, CATALOG),
                  params: setup.rival.params,
                }
              : null,
          script: setup.script,
          input,
          audio,
          autopilot: new URLSearchParams(window.location.search).get('autopilot') === '1',
          onLoadProgress: (progress) =>
            !cancelled && setLoad({ kind: 'loading', stage: 'track', progress }),
          onLoadError: () => !cancelled && setLoad({ kind: 'error', reason: 'assets' }),
          onReady: () => !cancelled && setLoad({ kind: 'ready' }),
        });
      } catch {
        if (!cancelled) setLoad({ kind: 'error', reason: 'assets' });
      }
    })();

    return () => {
      cancelled = true;
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      input.detach();
      game.current?.destroy();
      game.current = null;
      stopFeed?.();
      setHud(null);
      leave?.();
      audio.dispose();
    };
  }, [attempt]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !useApp.getState().paused) setPaused(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setPaused]);

  const raceAgain = useCallback(() => {
    game.current?.restart();
    setPaused(false);
  }, [setPaused]);
  const resume = useCallback(() => setPaused(false), [setPaused]);

  // A single-player race stops while its menu is open, and the HUD's dials stop with it.
  useEffect(() => {
    setHudFrozen(paused && linkMode === 'offline');
    return () => setHudFrozen(false);
  }, [paused, linkMode]);

  // The result normally follows the finish within the eight-second window. If it never comes,
  // show the race as far as it is known rather than leave the driver at a finished race.
  useEffect(() => {
    if (!finished || result || summary) return;
    const timer = window.setTimeout(
      () => useCombat.setState({ summary: hudLive.log.summary(), preview: true }),
      RESULT_PATIENCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [finished, result, summary]);
  const showResults = summary !== null && (result !== null || preview);
  const goHome = useCallback(() => setScreen('home'), [setScreen]);
  // Back to the garage with the car that just raced, on a fresh build clock.
  const changeBuild = useCallback(() => setScreen('garage'), [setScreen]);

  const errorCopy =
    load.kind === 'error'
      ? load.reason === 'version'
        ? STRINGS.connection.versionMismatch
        : load.reason === 'server'
          ? STRINGS.connection.serverUnavailable
          : STRINGS.loading.assetFailure
      : '';

  return (
    <main className="screen race">
      <div className="race-canvas" ref={canvasHost} />
      <div className="race-surface" ref={surface} />
      {load.kind === 'ready' && manifests && hud && (
        <Hud
          manifests={manifests}
          loadout={hud.loadout}
          input={hud.input}
          onPause={() => setPaused(true)}
        />
      )}

      {load.kind === 'loading' && (
        <div className="overlay overlay-solid" role="status">
          <div className="boot-progress">
            <div className="boot-bar">
              <div className="boot-fill" style={{ width: `${Math.round(load.progress * 100)}%` }} />
            </div>
            <div className="boot-label">
              <span>
                {load.stage === 'connecting' ? STRINGS.loading.connecting : STRINGS.loading.track}
              </span>
              <span>{Math.round(load.progress * 100)}%</span>
            </div>
          </div>
        </div>
      )}

      {load.kind === 'error' && (
        <div className="overlay overlay-solid" role="alert">
          <div className="panel dialog">
            <p>{errorCopy}</p>
            <div className="dialog-actions">
              <button
                className="btn btn-primary"
                onClick={() =>
                  load.reason === 'version' ? window.location.reload() : setAttempt((n) => n + 1)
                }
              >
                {load.reason === 'version' ? STRINGS.connection.reload : STRINGS.loading.retry}
              </button>
              <button className="btn" onClick={goHome}>
                {STRINGS.race.backHome}
              </button>
            </div>
          </div>
        </div>
      )}

      {load.kind === 'ready' && linkStatus !== 'connected' && (
        <div className="overlay" role="alert">
          <div className="panel dialog">
            <p>
              {linkStatus === 'reconnecting'
                ? STRINGS.connection.lost
                : STRINGS.connection.serverUnavailable}
            </p>
            {linkStatus === 'lost' && (
              <div className="dialog-actions">
                <button className="btn btn-primary" onClick={() => setAttempt((n) => n + 1)}>
                  {STRINGS.loading.retry}
                </button>
                <button className="btn" onClick={goHome}>
                  {STRINGS.race.backHome}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {load.kind === 'ready' && showResults && !paused && manifests && hud && summary && (
        <Results
          manifests={manifests}
          loadout={hud.loadout}
          result={result}
          summary={summary}
          you={you}
          onRaceAgain={raceAgain}
          onChangeBuild={changeBuild}
          onHome={goHome}
        />
      )}

      {paused && !confirmLeave && (
        <SettingsPanel
          onClose={resume}
          closeLabel={STRINGS.race.resume}
          notice={<PauseNotice online={linkMode === 'online'} onTimeout={resume} />}
          actions={
            <>
              <button className="btn" onClick={raceAgain}>
                {STRINGS.race.raceAgain}
              </button>
              <button className="btn btn-danger" onClick={() => setConfirmLeave(true)}>
                {STRINGS.race.leave}
              </button>
            </>
          }
        />
      )}

      {paused && confirmLeave && (
        <div className="overlay" role="alertdialog" aria-modal="true">
          <div className="panel dialog">
            <p>{STRINGS.race.leaveConfirm}</p>
            <div className="dialog-actions">
              <button className="btn btn-danger" onClick={goHome}>
                {STRINGS.race.leave}
              </button>
              <button className="btn btn-primary" onClick={() => setConfirmLeave(false)} autoFocus>
                {STRINGS.race.resume}
              </button>
            </div>
          </div>
        </div>
      )}

      {portrait && !portraitOk && load.kind === 'ready' && (
        <div className="overlay overlay-solid rotate">
          <div className="rotate-phone" aria-hidden="true" />
          <p>{STRINGS.race.rotate}</p>
          <button className="btn" onClick={() => setPortraitOk(true)}>
            {STRINGS.race.continuePortrait}
          </button>
        </div>
      )}
    </main>
  );
}
