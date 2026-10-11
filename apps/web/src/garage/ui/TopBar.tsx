import { STRINGS, getTrack, getWeatherPreset } from '@bolt/content';
import type { BuildStats } from '@bolt/shared';
import type { ReactNode } from 'react';
import { TRACK_ID, WEATHER_PRESET_ID } from '../../app/App.js';
import { Glyph } from '../../components/Glyph.js';
import { weatherGlyph } from '../../pages/TrackPreviewScreen.js';
import { fill, signedDelta } from '../text.js';
import type { BuildPreview } from './useBuildStats.js';

type Props = {
  stats: BuildStats | null;
  preview: BuildPreview | null;
  secondsLeft: number | null;
  canUndo: boolean;
  canRedo: boolean;
  locked: boolean;
  onBack: () => void;
  onUndo: () => void;
  onRedo: () => void;
  /** Opens the working behind the credits number. */
  onCredits: () => void;
  /**
   * The status line, in the free middle of the bar (landscape). It has the bar's height
   * reserved for it whether or not there is anything to say, so nothing ever shifts and the
   * message never lies over the car.
   */
  statusLine?: ReactNode;
};

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * The garage header (Section 5.6), kept to what is needed at every moment: Back, Undo, Redo,
 * the build timer, the track and weather badge where there is width for it, the status line
 * in the space between, and Credits Left with the change the previewed part would make. Ready
 * sits at its right end.
 */
export function TopBar({
  stats,
  preview,
  secondsLeft,
  canUndo,
  canRedo,
  locked,
  onBack,
  onUndo,
  onRedo,
  onCredits,
  statusLine,
}: Props) {
  const g = STRINGS.garage;
  const track = getTrack(TRACK_ID);
  const preset = getWeatherPreset(WEATHER_PRESET_ID);
  const urgent = secondsLeft !== null && secondsLeft <= 10;
  const left = stats?.indicators.budget.left ?? 0;
  const status = stats?.indicators.budget.status ?? 'ok';
  const leftAfter = preview?.stats.indicators.budget.left;
  return (
    <header className="g-top">
      <button
        className="btn btn-small g-back"
        onClick={onBack}
        disabled={locked}
        aria-label={g.back}
      >
        <Glyph name="back" size={12} />
        <span>{g.back}</span>
      </button>
      <button
        className="btn btn-small btn-square"
        onClick={onUndo}
        disabled={!canUndo || locked}
        aria-label={g.undo}
        title={g.undo}
      >
        <Glyph name="undo" size={24} />
      </button>
      <button
        className="btn btn-small btn-square"
        onClick={onRedo}
        disabled={!canRedo || locked}
        aria-label={g.redo}
        title={g.redo}
      >
        <Glyph name="redo" size={24} />
      </button>
      {secondsLeft !== null && (
        <div
          className={`g-timer${urgent ? ' is-urgent' : ''}`}
          role="timer"
          aria-label={`${g.timer}: ${fill(g.timerLeft, { seconds: secondsLeft })}`}
          data-testid="build-timer"
          data-seconds={secondsLeft}
        >
          <Glyph name="clock" size={12} />
          <span aria-hidden="true">{clock(secondsLeft)}</span>
        </div>
      )}
      {track && preset && (
        <div className="g-track" aria-label={`${track.name}, ${preset.displayName}`}>
          <Glyph name={weatherGlyph(preset.weather, preset.timeOfDay)} size={24} />
          <span className="g-track-text">
            <strong>{track.name}</strong>
            <span>{preset.displayName}</span>
          </span>
        </div>
      )}
      <div className="g-top-space">{statusLine}</div>
      <button
        type="button"
        className={`g-credits is-${status}`}
        aria-label={`${g.creditsLeft}: ${left}. ${g.status[status]}. ${g.creditsHelp}`}
        aria-haspopup="dialog"
        data-testid="credits-left"
        data-credits={left}
        data-status={status}
        onClick={onCredits}
      >
        <span className="g-credits-label">{g.creditsLeft}</span>
        <span className="g-credits-value">
          <Glyph name={status === 'ok' ? 'coin' : 'warn'} size={24} />
          <span aria-live="polite" aria-atomic="true">
            {left.toLocaleString('en-US')}
          </span>
          {leftAfter !== undefined && leftAfter !== left && (
            <span className={`delta ${leftAfter > left ? 'is-better' : 'is-worse'}`}>
              {signedDelta(leftAfter - left)}
            </span>
          )}
        </span>
      </button>
    </header>
  );
}
