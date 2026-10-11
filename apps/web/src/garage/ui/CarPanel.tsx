import { STRINGS } from '@bolt/content';
import type { BuildStats } from '@bolt/shared';
import { STARTING_CREDITS } from '@bolt/shared';
import type { ReactNode } from 'react';
import { Glyph } from '../../components/Glyph.js';
import type { GlyphName } from '../../components/glyphs.js';
import { fill } from '../text.js';

const SCORES = ['speed', 'control', 'defense', 'firepower', 'utility'] as const;
const SCORE_GLYPH: Record<(typeof SCORES)[number], GlyphName> = {
  speed: 'bolt',
  control: 'tires',
  defense: 'defense',
  firepower: 'weapon',
  utility: 'utility',
};

type Props = {
  name: string;
  /** The paint's main color, for the swatch on the name button. */
  swatch: string;
  stats: BuildStats | null;
  /** What keeps the car out of a race, in approved copy. Null when it is ready. */
  blocked: string | null;
  locked: boolean;
  onPaint: () => void;
  onBrowse: () => void;
  /** Offered while the build is not legal. */
  onRepair: (() => void) | null;
  /** The first-build steps, while they are still being taught. */
  children?: ReactNode;
};

/**
 * The idle panel: the whole car at a glance. Its name and paint, whether it can race, the
 * five predicted scores, how much of the budget is spent, and where to go next. The scores
 * live here and in the compare pane rather than in the header, which keeps the header for
 * the things that are needed at every moment.
 */
export function CarPanel({
  name,
  swatch,
  stats,
  blocked,
  locked,
  onPaint,
  onBrowse,
  onRepair,
  children,
}: Props) {
  const g = STRINGS.garage;
  const used = stats?.indicators.budget.spent ?? 0;
  return (
    <section className="g-carpanel" aria-label={g.yourCar} data-testid="car-panel">
      <header className="g-carpanel-head">
        <button
          type="button"
          className="g-name"
          onClick={onPaint}
          disabled={locked}
          aria-label={`${g.paintAndName}: ${name}`}
          title={g.paintAndName}
        >
          <span className="g-name-swatch" style={{ background: swatch }} aria-hidden="true" />
          <span className="g-name-text">
            <span className="g-name-label">{g.yourCar}</span>
            <strong data-testid="car-name">{name}</strong>
          </span>
          <Glyph name="paint" size={12} />
        </button>
        <p className={`g-carpanel-state${blocked ? ' is-blocked' : ''}`}>
          <Glyph name={blocked ? 'warn' : 'check'} size={12} />
          <span>{blocked ? g.readyBlocked : g.readyToRace}</span>
        </p>
      </header>
      <div className="g-carpanel-body">
        {blocked && (
          <div className="g-carpanel-issue">
            <p className="g-warning">
              <Glyph name="warn" size={12} />
              <span>{blocked}</span>
            </p>
            {onRepair && (
              <button className="btn btn-small" onClick={onRepair} disabled={locked}>
                {g.repair}
              </button>
            )}
          </div>
        )}
        <dl className="g-scores" aria-label={g.performance}>
          {SCORES.map((key) => {
            const value = stats?.scores[key] ?? 0;
            return (
              <div key={key} className="g-score" data-testid={`score-${key}`}>
                <dt>
                  <Glyph name={SCORE_GLYPH[key]} size={12} />
                  <span className="g-score-name">{g.scores[key]}</span>
                </dt>
                <dd>{value}</dd>
                <div className="bar" aria-hidden="true">
                  <span className="bar-fill" style={{ width: `${value}%` }} />
                </div>
              </div>
            );
          })}
        </dl>
        <p className="g-carpanel-credits">
          <Glyph name="coin" size={12} />
          <span>
            {fill(g.creditsUsed, { used, total: STARTING_CREDITS.toLocaleString('en-US') })}
          </span>
        </p>
        {children}
        <div className="g-carpanel-next">
          <p className="dim">{g.tapMount}</p>
          <button className="btn btn-small" onClick={onBrowse} disabled={locked}>
            <Glyph name="grid" size={12} />
            <span>{g.browseAll}</span>
          </button>
        </div>
      </div>
    </section>
  );
}
