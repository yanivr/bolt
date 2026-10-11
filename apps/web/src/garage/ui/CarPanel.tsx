import { STRINGS } from '@bolt/content';
import type { BuildStats, PlacedPart } from '@bolt/shared';
import type { ReactNode } from 'react';
import { Glyph } from '../../components/Glyph.js';
import type { GlyphName } from '../../components/glyphs.js';
import { PartIcon } from '../../components/PartIcon.js';
import type { GameManifests } from '../../game/assets.js';
import { SCORE_KEYS, summarizeCar } from '../carSummary.js';
import { fill, listNames, mountName } from '../text.js';
import type { IndicatorKey } from './IndicatorBar.js';

const SCORE_GLYPH: Record<(typeof SCORE_KEYS)[number], GlyphName> = {
  speed: 'bolt',
  control: 'tires',
  defense: 'defense',
  firepower: 'weapon',
  utility: 'utility',
};

const INDICATORS: readonly IndicatorKey[] = ['budget', 'load', 'energy', 'heat', 'stability'];

type Props = {
  manifests: GameManifests;
  name: string;
  /** The paint's main color, for the swatch on the name button. */
  swatch: string;
  stats: BuildStats | null;
  /** Everything mounted on the car, in canonical order. */
  parts: readonly PlacedPart[];
  /** How many accessory mounts the chassis has. */
  mountCount: number;
  /** What keeps the car out of a race, in approved copy. Null when it is ready. */
  blocked: string | null;
  locked: boolean;
  onPaint: () => void;
  onBrowse: () => void;
  /** Opens the working behind one indicator. */
  onIndicator: (key: IndicatorKey) => void;
  /** Opens the slot a mounted part is on. */
  onMount: (mountId: string) => void;
  /** Offered while the build is not legal. */
  onRepair: (() => void) | null;
  /** The first-build steps, while they are still being taught. */
  children?: ReactNode;
};

/**
 * The idle panel: the whole car at a glance. Its name and paint and whether it can race; the
 * five predicted scores; the five engineering indicators as one row of states; what the car
 * is best and worst at, worked out from those scores; and everything mounted on it as a list
 * whose rows open their slot. Nothing here is written copy about a car: every line is a
 * number the shared model produced.
 */
export function CarPanel({
  manifests,
  name,
  swatch,
  stats,
  parts,
  mountCount,
  blocked,
  locked,
  onPaint,
  onBrowse,
  onIndicator,
  onMount,
  onRepair,
  children,
}: Props) {
  const g = STRINGS.garage;
  const summary = stats ? summarizeCar(stats.scores) : null;
  const scoreText = (entry: { key: (typeof SCORE_KEYS)[number]; value: number }) =>
    fill(g.scoreValue, { name: g.scores[entry.key], value: entry.value });
  const usedMounts = new Set(parts.map((p) => p.mount.id)).size;
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
          {SCORE_KEYS.map((key) => {
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
        {stats && (
          <div className="g-states" role="group" aria-label={g.engineering}>
            {INDICATORS.map((key) => {
              const status = stats.indicators[key].status;
              return (
                <button
                  key={key}
                  type="button"
                  className={`g-state is-${status}`}
                  data-state={key}
                  data-status={status}
                  aria-haspopup="dialog"
                  aria-label={`${fill(g.indicatorState, {
                    name: g.indicators[key],
                    status: g.status[status],
                  })}. ${fill(g.indicatorHelp, { name: g.indicators[key] })}`}
                  onClick={() => onIndicator(key)}
                >
                  <span className="g-state-name">{g.indicators[key]}</span>
                  <span className="g-state-value">{g.statusShort[status]}</span>
                </button>
              );
            })}
          </div>
        )}
        {summary && (
          <div className="g-summary" data-testid="car-summary">
            <p className="g-summary-line is-strong">
              <Glyph name="up" size={12} />
              <span>
                {summary.strengths.length > 0
                  ? fill(g.summaryStrong, { list: listNames(summary.strengths.map(scoreText)) })
                  : fill(g.summaryBest, { list: scoreText(summary.best) })}
              </span>
            </p>
            <p className={`g-summary-line ${summary.weakness ? 'is-weak' : 'is-even'}`}>
              <Glyph name={summary.weakness ? 'down' : 'check'} size={12} />
              <span>
                {summary.weakness
                  ? fill(g.summaryWeak, {
                      name: g.scores[summary.weakness.key],
                      value: summary.weakness.value,
                    })
                  : g.summaryEven}
              </span>
            </p>
          </div>
        )}
        {children}
        <div className="g-equipment">
          <div className="g-equipment-head">
            <h3 className="g-block-title">
              <span>{g.equipment}</span>
              <span className="dim">
                {fill(g.equipmentCount, { used: usedMounts, total: mountCount })}
              </span>
            </h3>
            <button className="btn btn-small" onClick={onBrowse} disabled={locked}>
              <Glyph name="grid" size={12} />
              <span>{g.browseAll}</span>
            </button>
          </div>
          {parts.length === 0 ? (
            <p className="g-equipment-empty dim">{g.equipmentEmpty}</p>
          ) : (
            <ul className="g-equipment-list">
              {parts.map((part) => (
                <li key={part.instance.instanceId}>
                  <button
                    type="button"
                    className="g-equipment-row"
                    data-equipment={part.instance.instanceId}
                    data-mount={part.mount.id}
                    aria-label={fill(g.equipmentOpen, {
                      part: part.def.displayName,
                      mount: mountName(part.mount.id),
                    })}
                    disabled={locked}
                    onClick={() => onMount(part.mount.id)}
                  >
                    <PartIcon
                      manifests={manifests}
                      partId={part.def.id}
                      category={part.def.category}
                      size={32}
                    />
                    <span className="g-equipment-name">{part.def.displayName}</span>
                    <span className="g-equipment-mount dim">{mountName(part.mount.id)}</span>
                    <Glyph name="right" size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
