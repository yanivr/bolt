import { CATALOG, STRINGS } from '@bolt/content';
import { mountedPartSprites, resolveCarSprites } from '@bolt/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { TRACK_ID, WEATHER_PRESET_ID, bootAssets } from '../app/App.js';
import { useApp, useHud } from '../app/store.js';
import { PixelText } from '../components/PixelText.js';
import type { RaceGameHandle } from '../game/RaceGame.js';
import { createRaceGame } from '../game/RaceGame.js';
import type { GameManifests } from '../game/assets.js';
import { EngineAudio } from '../game/audio/EngineAudio.js';
import type { DriveSetupError } from '../game/startDrive.js';
import { startDrive } from '../game/startDrive.js';
import { Hud, formatRaceTime } from '../hud/Hud.js';
import { SettingsPanel } from '../hud/SettingsPanel.js';
import { DriveInput } from '../input/driveInput.js';

type LoadState =
  | { kind: 'loading'; stage: 'connecting' | 'track'; progress: number }
  | { kind: 'ready' }
  | { kind: 'error'; reason: DriveSetupError | 'assets' };

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
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [portraitOk, setPortraitOk] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const paused = useApp((s) => s.paused);
  const setPaused = useApp((s) => s.setPaused);
  const setScreen = useApp((s) => s.setScreen);
  const finished = useHud((s) => s.finished);
  const raceTimeMs = useHud((s) => s.raceTimeMs);
  const bestLapMs = useHud((s) => s.bestLapMs);
  const linkStatus = useHud((s) => s.linkStatus);
  const linkMode = useHud((s) => s.linkMode);
  const portrait = usePortrait();

  useEffect(() => {
    const host = canvasHost.current;
    const touch = surface.current;
    if (!host || !touch) return;
    let cancelled = false;
    let leave: (() => void) | null = null;
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
          startDrive(TRACK_ID, WEATHER_PRESET_ID, useApp.getState().blueprint),
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
        setManifests(m);
        setLoad({ kind: 'loading', stage: 'track', progress: 0 });
        input.attach(touch);
        game.current = createRaceGame(host, {
          manifests: m,
          session: setup.session,
          link: setup.link,
          loadout: sprites,
          parts: mountedPartSprites(m.cars, setup.blueprint, CATALOG),
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

  const raceAgain = useCallback(() => game.current?.restart(), []);
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
      {load.kind === 'ready' && manifests && (
        <Hud manifests={manifests} onPause={() => setPaused(true)} />
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

      {load.kind === 'ready' && finished && !paused && (
        <div className="overlay overlay-finish">
          <div className="panel dialog finish">
            <PixelText text={STRINGS.race.finish} scale={6} color="#F6C35B" shadow="#6e3212" />
            <dl className="finish-times">
              <div>
                <dt>{STRINGS.race.time}</dt>
                <dd>{formatRaceTime(raceTimeMs)}</dd>
              </div>
              <div>
                <dt>{STRINGS.race.bestLap}</dt>
                <dd>{bestLapMs > 0 ? formatRaceTime(bestLapMs) : '-:--.--'}</dd>
              </div>
            </dl>
            <div className="dialog-actions">
              <button className="btn btn-primary" onClick={raceAgain} autoFocus>
                {STRINGS.race.raceAgain}
              </button>
              <button className="btn" onClick={changeBuild}>
                {STRINGS.race.changeBuild}
              </button>
              <button className="btn" onClick={goHome}>
                {STRINGS.race.backHome}
              </button>
            </div>
          </div>
        </div>
      )}

      {paused && !confirmLeave && (
        <SettingsPanel
          onClose={() => setPaused(false)}
          closeLabel={STRINGS.race.resume}
          notice={
            linkMode === 'online' ? <p className="notice">{STRINGS.race.pauseNote}</p> : undefined
          }
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
