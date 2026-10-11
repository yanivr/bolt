import { STRINGS, getTrack, getWeatherPreset } from '@bolt/content';
import type { BuildStats } from '@bolt/shared';
import { TRACK_ID, WEATHER_PRESET_ID } from '../../app/App.js';
import { Glyph } from '../../components/Glyph.js';
import type { GlyphName } from '../../components/glyphs.js';
import { weatherGlyph } from '../../pages/TrackPreviewScreen.js';
import { fill, signedDelta } from '../text.js';
import type { BuildPreview } from './useBuildStats.js';

const SCORES = ['speed', 'control', 'defense', 'firepower', 'utility'] as const;
const SCORE_GLYPH: Record<(typeof SCORES)[number], GlyphName> = {
  speed: 'bolt',
  control: 'tires',
  defense: 'defense',
  firepower: 'weapon',
  utility: 'utility',
};

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
};

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * The garage header (Section 5.6): Back, the track and weather badge, the build timer, the
 * five predicted scores with live deltas for whatever is being previewed, and Credits Left.
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
}: Props) {
  const track = getTrack(TRACK_ID);
  const preset = getWeatherPreset(WEATHER_PRESET_ID);
  const urgent = secondsLeft !== null && secondsLeft <= 10;
  const left = stats?.indicators.budget.left ?? 0;
  const leftAfter = preview?.stats.indicators.budget.left;
  return (
    <header className="g-top">
      <button
        className="btn btn-small g-back"
        onClick={onBack}
        disabled={locked}
        aria-label={STRINGS.garage.back}
      >
        <Glyph name="back" size={12} />
        <span>{STRINGS.garage.back}</span>
      </button>
      <button
        className="btn btn-small btn-square"
        onClick={onUndo}
        disabled={!canUndo || locked}
        aria-label={STRINGS.garage.undo}
        title={STRINGS.garage.undo}
      >
        <Glyph name="undo" size={24} />
      </button>
      <button
        className="btn btn-small btn-square"
        onClick={onRedo}
        disabled={!canRedo || locked}
        aria-label={STRINGS.garage.redo}
        title={STRINGS.garage.redo}
      >
        <Glyph name="redo" size={24} />
      </button>
      {track && preset && (
        <div className="g-track" aria-label={`${track.name}, ${preset.displayName}`}>
          <Glyph name={weatherGlyph(preset.weather, preset.timeOfDay)} size={24} />
          <span className="g-track-text">
            <strong>{track.name}</strong>
            <span>{preset.displayName}</span>
          </span>
        </div>
      )}
      {secondsLeft !== null && (
        <div
          className={`g-timer${urgent ? ' is-urgent' : ''}`}
          role="timer"
          aria-label={`${STRINGS.garage.timer}: ${fill(STRINGS.garage.timerLeft, { seconds: secondsLeft })}`}
          data-testid="build-timer"
          data-seconds={secondsLeft}
        >
          <Glyph name="clock" size={12} />
          <span aria-hidden="true">{clock(secondsLeft)}</span>
        </div>
      )}
      <dl className="g-scores" aria-label={STRINGS.garage.performance}>
        {SCORES.map((key) => {
          const base = stats?.scores[key] ?? 0;
          const change = preview?.delta.scores[key];
          const shown = change ? change.after : base;
          const low = Math.min(base, shown);
          const high = Math.max(base, shown);
          return (
            <div key={key} className="g-score" data-testid={`score-${key}`}>
              <dt>
                <Glyph name={SCORE_GLYPH[key]} size={12} />
                <span className="g-score-name">{STRINGS.garage.scores[key]}</span>
              </dt>
              <dd>
                <span className="g-score-value">{shown}</span>
                {change && change.delta !== 0 && (
                  <span className={`delta ${change.better ? 'is-better' : 'is-worse'}`}>
                    <span className="delta-number">{signedDelta(change.delta)}</span>
                    <span className="delta-arrow">
                      <Glyph name={change.delta > 0 ? 'up' : 'down'} size={12} />
                    </span>
                  </span>
                )}
              </dd>
              <div className="bar" aria-hidden="true">
                <span className="bar-fill" style={{ width: `${low}%` }} />
                {high > low && (
                  <span
                    className={`bar-delta ${shown > base ? 'is-better' : 'is-worse'}`}
                    style={{ left: `${low}%`, width: `${high - low}%` }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </dl>
      <div
        className="g-credits"
        role="group"
        aria-label={STRINGS.garage.creditsLeft}
        data-testid="credits-left"
        data-credits={left}
      >
        <span className="g-credits-label">{STRINGS.garage.creditsLeft}</span>
        <span className="g-credits-value">
          <Glyph name="coin" size={24} />
          <span aria-live="polite" aria-atomic="true">
            {left.toLocaleString('en-US')}
          </span>
          {leftAfter !== undefined && leftAfter !== left && (
            <span className={`delta ${leftAfter > left ? 'is-better' : 'is-worse'}`}>
              {signedDelta(leftAfter - left)}
            </span>
          )}
        </span>
      </div>
    </header>
  );
}
