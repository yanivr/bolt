import { CATALOG, STRINGS, getScenario } from '@bolt/content';
import { mountedPartSprites, resolveBlueprint, resolveCarSprites } from '@bolt/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { bootAssets, courseAssets, courseOptions } from '../app/App.js';
import type { Course } from '../app/course.js';
import { settleCourse } from '../app/course.js';
import { debugEnabled } from '../app/flags.js';
import { useApp, useHud } from '../app/store.js';
import type { RaceGameHandle } from '../game/RaceGame.js';
import { createRaceGame } from '../game/RaceGame.js';
import type { GameManifests } from '../game/assets.js';
import { EngineAudio } from '../game/audio/EngineAudio.js';
import { setAudioRaceContext } from '../game/audio/index.js';
import { LAYOUT_LABEL } from '../game/layout/layoutCanvas.js';
import type { DriveOptions, DriveSetup, DriveSetupError } from '../game/startDrive.js';
import { startDrive } from '../game/startDrive.js';
import { Hud } from '../hud/Hud.js';
import { Results } from '../hud/Results.js';
import { SettingsPanel } from '../hud/SettingsPanel.js';
import { hudLive, setHudFrozen, startHudFeed, useCombat } from '../hud/hudStore.js';
import type { HudLoadout } from '../hud/model.js';
import { buildHudLoadout, formatRaceTime } from '../hud/model.js';
import { DriveInput } from '../input/driveInput.js';
import { startMatchDrive } from '../game/startMatchDrive.js';
import { activeMatch, useMatch } from '../network/matchClient.js';
import { MatchResultsActions, MatchRaceNotices } from './match/MatchRace.js';

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
  // The AI's difficulty is the player's choice on the preview, not a debug switch.
  const options: DriveOptions = { difficulty: useApp.getState().difficulty };
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

/**
 * The top of the pause menu: what the race is doing while the menu is open, the label that
 * says a race is running on the device and not on the server, and the lap times that are no
 * longer on the HUD itself.
 */
function PauseNotice({ online, onTimeout }: { online: boolean; onTimeout: () => void }) {
  const [left, setLeft] = useState(PAUSE_LIMIT_SECONDS);
  const bestLapMs = useHud((s) => s.bestLapMs);
  const lastLapMs = useHud((s) => s.lastLapMs);
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
  const r = STRINGS.race;
  return (
    <div className="pause-info">
      <p className="notice" data-testid="pause-notice">
        {online ? r.pauseNote : r.pausedNote.replace('{time}', clock(left))}
      </p>
      <div className="pause-facts">
        {!online && (
          <span className="badge" data-testid="offline-badge">
            {r.offlineBadge}
          </span>
        )}
        <dl className="pause-laps" data-testid="pause-laps">
          <div>
            <dt>{r.bestLap}</dt>
            <dd>{bestLapMs > 0 ? formatRaceTime(bestLapMs) : r.noLapTime}</dd>
          </div>
          <div>
            <dt>{r.lastLap}</dt>
            <dd>{lastLapMs > 0 ? formatRaceTime(lastLapMs) : r.noLapTime}</dd>
          </div>
        </dl>
      </div>
    </div>
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
  // Race a Friend: the race comes from the match room, and a rematch is a new race in it.
  const inMatch = useMatch((s) => s.active);
  const matchRaceId = useMatch((s) => s.raceId);

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
        // The course: a showcase scenario brings its own; a friend match the one its host
        // locked; otherwise the one chosen on the preview, settled onto one this build offers.
        const options = driveOptions();
        const scenario = options.scenarioId ? getScenario(options.scenarioId) : undefined;
        const match = activeMatch();
        let course: Course;
        if (scenario) course = { trackId: scenario.trackId, presetId: scenario.weatherPresetId };
        else if (match) {
          await bootAssets();
          const state = useMatch.getState();
          course = { trackId: state.trackId, presetId: state.weatherPresetId };
        } else {
          // What may be offered is known once the art index has loaded.
          await bootAssets();
          const c = settleCourse(useApp.getState().course, courseOptions());
          course = { trackId: c.trackId, presetId: c.presetId };
        }
        const [m, setup] = await Promise.all([
          bootAssets().then(() => courseAssets(course)),
          match
            ? startMatchDrive(match)
            : startDrive(course.trackId, course.presetId, useApp.getState().blueprint, options),
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
        if (!scenario)
          setAudioRaceContext({
            blueprint: setup.blueprint,
            trackId: course.trackId,
            weatherPresetId: course.presetId,
            track: setup.track,
          });
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
          onReady: () => {
            if (cancelled) return;
            setLoad({ kind: 'ready' });
            // The room starts the countdown when both players have the race on screen.
            match?.roomReady();
          },
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
      setAudioRaceContext(null);
    };
  }, [attempt, matchRaceId]);

  // Section 5.10: a page going to the background tells the room at once, so the car is driven
  // safely rather than on whatever the last sample held.
  useEffect(() => {
    if (!inMatch) return;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') activeMatch()?.away();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [inMatch]);

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
  const goHome = useCallback(() => {
    // Leaving a friend match from here gives up the seat (a forfeit if the race is on).
    activeMatch()?.leave();
    setScreen('home');
  }, [setScreen]);
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
      {load.kind === 'ready' && manifests && manifests.terrainArt === 'layout' && (
        <span className="layout-badge" data-testid="layout-badge">
          {LAYOUT_LABEL}
        </span>
      )}
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

      {load.kind === 'ready' && inMatch && <MatchRaceNotices />}

      {load.kind === 'ready' && linkStatus !== 'connected' && !inMatch && (
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
          offline={linkMode === 'offline'}
          onRaceAgain={raceAgain}
          onChangeBuild={changeBuild}
          onHome={goHome}
          {...(inMatch ? { actions: <MatchResultsActions onHome={goHome} /> } : {})}
        />
      )}

      {paused && !confirmLeave && (
        <SettingsPanel
          onClose={resume}
          closeLabel={STRINGS.race.resume}
          notice={<PauseNotice online={linkMode === 'online'} onTimeout={resume} />}
          actions={
            <>
              {!inMatch && (
                <button className="btn" onClick={raceAgain}>
                  {STRINGS.race.raceAgain}
                </button>
              )}
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
