import { STRINGS, getTrack, getWeatherPreset } from '@bolt/content';
import { EMBLEM_COUNT, NICKNAMES, buildTrack } from '@bolt/shared';
import { useEffect, useMemo, useState } from 'react';
import { courseAssets, courseOptions, getManifests } from '../app/App.js';
import { useApp } from '../app/store.js';
import { Glyph } from '../components/Glyph.js';
import { PixelText } from '../components/PixelText.js';
import { layoutMinimap } from '../game/layout/layoutCanvas.js';
import { displayCode, inviteLink } from '../network/invite.js';
import type { MatchFailure } from '../network/matchClient.js';
import {
  MatchClient,
  MatchJoinError,
  activeMatch,
  loadProfile,
  useMatch,
} from '../network/matchClient.js';
import { joinFailureCopy } from './JoinScreen.js';
import { weatherGlyph } from './TrackPreviewScreen.js';
import { LeaveConfirm, SeatCard } from './match/parts.js';

type Opening = { kind: 'opening' } | { kind: 'ready' } | { kind: 'error'; reason: MatchFailure };

/** The course map: the baked one once the course art has loaded, else drawn from the layout. */
function useMinimap(trackId: string, presetId: string) {
  const [loadedKey, setLoadedKey] = useState('');
  useEffect(() => {
    let cancelled = false;
    if (!trackId || !presetId) return;
    courseAssets({ trackId, presetId })
      .then(() => !cancelled && setLoadedKey(`${trackId}/${presetId}`))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [trackId, presetId]);
  return useMemo(() => {
    const loaded = getManifests();
    if (
      loadedKey === `${trackId}/${presetId}` &&
      loaded &&
      loaded.course.trackId === trackId &&
      loaded.terrainArt !== 'layout'
    ) {
      const m = loaded.terrain.minimap;
      return { src: loaded.minimapSrc, width: m.width, height: m.height };
    }
    const def = getTrack(trackId);
    return def ? layoutMinimap(buildTrack(def)) : null;
  }, [trackId, presetId, loadedKey]);
}

/**
 * The friend lobby (Sections 3.2 and 5.4): the bold match code with `Share Link` (where the
 * device can share), `Copy Invite Link` and `Copy Code`; a two-slot podium showing who is here,
 * each with a preset emblem, nickname and connection quality; and the track and weather card,
 * which the host chooses (or leaves to `Random`) and the guest watches change. The host locks
 * it with `Start Build`, which reveals the course to both.
 */
export function LobbyScreen() {
  const setScreen = useApp((s) => s.setScreen);
  const match = useMatch();
  const [opening, setOpening] = useState<Opening>(() =>
    activeMatch() ? { kind: 'ready' } : { kind: 'opening' },
  );
  const [toast, setToast] = useState('');
  const [confirmLeave, setConfirmLeave] = useState(false);
  const m = STRINGS.match;

  // Opened from Home with no match yet: open a lobby as host.
  useEffect(() => {
    if (opening.kind !== 'opening') return;
    let cancelled = false;
    MatchClient.open(loadProfile(NICKNAMES.length, EMBLEM_COUNT), useApp.getState().blueprint)
      .then(() => !cancelled && setOpening({ kind: 'ready' }))
      .catch((error: unknown) => {
        if (!cancelled)
          setOpening({
            kind: 'error',
            reason: error instanceof MatchJoinError ? error.reason : 'server',
          });
      });
    return () => {
      cancelled = true;
    };
  }, [opening.kind]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const options = useMemo(() => courseOptions(), []);
  const trackIds = useMemo(() => [...new Set(options.map((o) => o.trackId))], [options]);
  const track = getTrack(match.trackId);
  const preset = getWeatherPreset(match.weatherPresetId);
  const map = useMinimap(match.trackId || 'city_01', match.weatherPresetId || 'city_clear_night');
  const me = match.seat >= 0 ? match.seats[match.seat] : null;
  const rival = match.seat >= 0 ? match.seats[match.seat === 0 ? 1 : 0] : null;
  const host = me?.host === true;
  const rivalHere = rival?.present === true && rival.connected;

  if (opening.kind === 'error')
    return (
      <main className="screen lobby" data-testid="lobby-screen">
        <div className="overlay overlay-solid" role="alert">
          <div className="panel dialog">
            <p>{joinFailureCopy(opening.reason)}</p>
            <div className="dialog-actions">
              <button className="btn btn-primary" onClick={() => setOpening({ kind: 'opening' })}>
                {STRINGS.loading.retry}
              </button>
              <button className="btn" onClick={() => setScreen('home')}>
                {m.backHome}
              </button>
            </div>
          </div>
        </div>
      </main>
    );

  if (opening.kind === 'opening' || !match.active || !me)
    return (
      <main className="screen lobby" data-testid="lobby-screen">
        <div className="overlay overlay-solid" role="status">
          <p className="lobby-opening">{m.opening}</p>
        </div>
      </main>
    );

  const client = activeMatch();
  const code = match.code;
  const link = inviteLink(code);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const copy = async (text: string, done: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setToast(done);
    } catch {
      setToast(m.copyFailed);
    }
  };
  const share = async () => {
    try {
      await navigator.share({
        title: STRINGS.productName,
        text: m.shareText.replace('{code}', displayCode(code)),
        url: link,
      });
    } catch {
      // Dismissed: nothing to do.
    }
  };

  const choose = (trackId: string, presetId: string) => client?.selectTrack(trackId, presetId);
  const stepTrack = (delta: number) => {
    const at = Math.max(0, trackIds.indexOf(match.trackId));
    const next = trackIds[(at + delta + trackIds.length) % trackIds.length]!;
    const slot = (track?.weatherPresetIds ?? []).indexOf(match.weatherPresetId);
    const ofNext = options.filter((o) => o.trackId === next);
    const pick = ofNext[Math.max(0, slot)] ?? ofNext[0];
    if (pick) choose(pick.trackId, pick.presetId);
  };
  const weathers = options.filter((o) => o.trackId === match.trackId);
  const rename = () => {
    if (!me) return;
    client?.setProfile({
      nickname: (me.nickname + 1) % NICKNAMES.length,
      emblem: (me.emblem + 1) % EMBLEM_COUNT,
    });
  };
  const notice = match.notice ? m.notices[match.notice] : '';

  return (
    <main className="screen lobby" data-testid="lobby-screen" data-phase={match.phase}>
      <section className="lobby-left">
        <div className="lobby-top">
          <button className="btn btn-small" onClick={() => setConfirmLeave(true)}>
            <Glyph name="back" size={12} />
            <span>{m.leaveLobby}</span>
          </button>
          <span className="lobby-title">{m.lobbyTitle}</span>
        </div>
        <div
          className="panel lobby-code"
          aria-label={m.codeLabel.replace('{code}', displayCode(code))}
        >
          <span className="lobby-code-label">{m.code}</span>
          <span className="lobby-code-value" data-testid="match-code" data-code={code}>
            <PixelText
              text={displayCode(code)}
              scale={5}
              color="#F6C35B"
              shadow="#6e3212"
              decorative
            />
          </span>
          <div className="lobby-code-actions">
            {canShare && (
              <button className="btn btn-small" onClick={() => void share()}>
                <Glyph name="share" size={12} />
                <span>{m.shareLink}</span>
              </button>
            )}
            <button
              className="btn btn-small"
              onClick={() => void copy(link, m.linkCopied)}
              data-testid="copy-link"
            >
              <Glyph name="copy" size={12} />
              <span>{m.copyInviteLink}</span>
            </button>
            <button
              className="btn btn-small"
              onClick={() => void copy(displayCode(code), m.codeCopied)}
            >
              <span>{m.copyCode}</span>
            </button>
          </div>
        </div>
        <div className="lobby-podium">
          <SeatCard seat={me} mine side="you" rttMs={match.rttMs} onRename={rename} />
          <span className="lobby-vs" aria-hidden="true">
            <PixelText text="VS" scale={3} color="#F5EED9" shadow="#0e1320" decorative />
          </span>
          <SeatCard seat={rival!} mine={false} side="rival" rttMs={match.rttMs} />
        </div>
        <p className="lobby-notice" role="status" data-testid="lobby-notice">
          {toast || notice}
        </p>
      </section>
      <section className="panel lobby-course" data-testid="lobby-course">
        <div className="lobby-course-head">
          <span className="lobby-course-label">{m.track}</span>
          {host && trackIds.length > 1 && !match.randomTrack && (
            <span className="lobby-course-step">
              <button
                className="btn btn-small"
                aria-label={STRINGS.preview.previousTrack}
                onClick={() => stepTrack(-1)}
              >
                <Glyph name="back" size={12} />
              </button>
              <button
                className="btn btn-small preview-pick-next"
                aria-label={STRINGS.preview.nextTrack}
                onClick={() => stepTrack(1)}
                data-testid="next-track"
              >
                <Glyph name="back" size={12} />
              </button>
            </span>
          )}
        </div>
        {match.randomTrack ? (
          <div className="lobby-random">
            <PixelText text="?" scale={8} color="#F6C35B" shadow="#6e3212" decorative />
            <p>{m.randomNote}</p>
          </div>
        ) : (
          <>
            <div className="lobby-map">
              {map && (
                <img
                  src={map.src}
                  width={map.width}
                  height={map.height}
                  alt={STRINGS.preview.mapAlt.replace('{track}', track?.name ?? '')}
                  draggable={false}
                />
              )}
            </div>
            <strong className="lobby-track-name" data-testid="lobby-track">
              {track?.name ?? ''}
            </strong>
            {host && weathers.length > 1 ? (
              <div className="preview-pick-weather" role="radiogroup" aria-label={m.weather}>
                {weathers.map((w) => {
                  const p = getWeatherPreset(w.presetId);
                  const on = w.presetId === match.weatherPresetId;
                  return (
                    <button
                      key={w.presetId}
                      role="radio"
                      aria-checked={on}
                      className={`weather-badge weather-choice${on ? ' is-on' : ''}`}
                      onClick={() => choose(w.trackId, w.presetId)}
                    >
                      {p && (
                        <Glyph name={weatherGlyph(p.weather, p.timeOfDay)} size={on ? 24 : 16} />
                      )}
                      <span>{p?.displayName ?? w.presetId}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              preset && (
                <p className="weather-badge" data-testid="lobby-weather">
                  <Glyph name={weatherGlyph(preset.weather, preset.timeOfDay)} size={24} />
                  <span>{preset.displayName}</span>
                </p>
              )
            )}
          </>
        )}
        <p className="lobby-course-note">{host ? m.youPick : m.hostPicks}</p>
        {host ? (
          <div className="lobby-actions">
            <button
              className={`btn${match.randomTrack ? ' is-on' : ''}`}
              aria-pressed={match.randomTrack}
              onClick={() =>
                match.randomTrack
                  ? choose(match.trackId, match.weatherPresetId)
                  : client?.selectRandom()
              }
            >
              {m.random}
            </button>
            <button
              className="btn btn-primary"
              disabled={!rivalHere}
              aria-disabled={!rivalHere}
              onClick={() => client?.lockTrack()}
              data-testid="start-build"
              title={rivalHere ? undefined : m.startBuildHint}
            >
              {m.startBuild}
            </button>
          </div>
        ) : (
          <p
            className={`lobby-wait-host${rivalHere ? ' is-ready' : ''}`}
            data-testid="guest-status"
          >
            {rivalHere ? m.readyToBuild : m.waiting}
          </p>
        )}
      </section>
      {confirmLeave && (
        <LeaveConfirm
          text={m.leaveLobbyConfirm}
          leaveLabel={m.leaveLobby}
          onLeave={() => {
            activeMatch()?.leave();
            setScreen('home');
          }}
          onStay={() => setConfirmLeave(false)}
        />
      )}
    </main>
  );
}
