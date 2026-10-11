import { STRINGS } from '@bolt/content';
import type { BuildStats, StatsWarningCode } from '@bolt/shared';
import { Dialog } from '../../components/Dialog.js';
import { Glyph } from '../../components/Glyph.js';
import type { GlyphName } from '../../components/glyphs.js';
import { compactNumber, fill } from '../text.js';

const KEYS = ['load', 'energy', 'heat', 'stability'] as const;
export type IndicatorKey = 'budget' | (typeof KEYS)[number];
type Key = IndicatorKey;

const GLYPH: Record<Key, GlyphName> = {
  budget: 'coin',
  load: 'weight',
  energy: 'bolt',
  heat: 'flame',
  stability: 'balance',
};

const WARNINGS: Record<Key, StatsWarningCode[]> = {
  budget: ['OVER_BUDGET'],
  load: ['OVER_RECOMMENDED_LOAD', 'OVER_MAX_LOAD'],
  energy: ['LOW_POWER'],
  heat: ['RUNS_HOT'],
  stability: ['UNSTABLE'],
};

function reading(stats: BuildStats, key: Key): { value: string; mark: number | null } {
  const g = STRINGS.garage;
  const i = stats.indicators;
  switch (key) {
    case 'budget':
      return { value: fill(g.creditsValue, { value: i.budget.left }), mark: null };
    case 'load':
      return {
        value: fill(g.loadValue, { load: compactNumber(i.load.loadKg), max: i.load.maxKg }),
        mark: i.load.recommendedMark,
      };
    case 'energy':
      return { value: fill(g.percent, { value: Math.round(i.energy.ratio * 100) }), mark: 0.5 };
    case 'heat':
      return { value: fill(g.percent, { value: Math.round(i.heat.ratio * 100) }), mark: 0.5 };
    case 'stability':
      return { value: String(i.stability.score), mark: i.stability.threshold / 100 };
  }
}

/**
 * The engineering indicators (Section 6.2) as one thin row of labelled gauges with their raw
 * numbers: Load, Energy, Heat and Stability. Budget is the Credits Left number in the header.
 * Each is a button that opens the plain-English working behind the number and any warning.
 * Status is always carried by text and a glyph as well as by color.
 */
export function IndicatorBar({
  stats,
  onOpen,
}: {
  stats: BuildStats | null;
  onOpen: (key: IndicatorKey) => void;
}) {
  const g = STRINGS.garage;
  if (!stats) return <div className="g-indicators" />;
  return (
    <div className="g-indicators" role="group" aria-label={g.engineering}>
      {KEYS.map((key) => {
        const indicator = stats.indicators[key];
        const { value, mark } = reading(stats, key);
        return (
          <button
            key={key}
            type="button"
            className={`indicator is-${indicator.status}`}
            data-indicator={key}
            data-status={indicator.status}
            aria-haspopup="dialog"
            aria-label={`${g.indicators[key]}: ${value}. ${g.status[indicator.status]}. ${fill(
              g.indicatorHelp,
              { name: g.indicators[key] },
            )}`}
            onClick={() => onOpen(key)}
          >
            <span className="indicator-top">
              <span className="indicator-glyph">
                <Glyph name={indicator.status === 'ok' ? GLYPH[key] : 'warn'} size={12} />
              </span>
              <span className="indicator-name">{g.indicators[key]}</span>
            </span>
            <span className="indicator-value">{value}</span>
            <span className="bar" aria-hidden="true">
              <span
                className="bar-fill"
                style={{ width: `${Math.round(Math.min(1, indicator.gauge) * 100)}%` }}
              />
              {mark !== null && <span className="bar-mark" style={{ left: `${mark * 100}%` }} />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The working behind one indicator, with the warnings that belong to it. */
export function IndicatorDialog({
  stats,
  open,
  onClose,
}: {
  stats: BuildStats;
  open: IndicatorKey;
  onClose: () => void;
}) {
  const g = STRINGS.garage;
  const indicator = stats.indicators[open];
  return (
    <Dialog
      title={g.indicators[open]}
      onClose={onClose}
      className="sheet sheet-narrow"
      head={
        <button className="btn btn-small" onClick={onClose} data-autofocus>
          {STRINGS.home.close}
        </button>
      }
    >
      <div className="sheet-body" data-testid="indicator-detail">
        <p className={`indicator-status is-${indicator.status}`}>
          <Glyph name={indicator.status === 'ok' ? 'check' : 'warn'} size={12} />
          <strong>{reading(stats, open).value}</strong>
          <span>{g.status[indicator.status]}</span>
        </p>
        <ul className="indicator-lines">
          {indicator.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {stats.warnings
          .filter((warning) => WARNINGS[open].includes(warning.code))
          .map((warning) => (
            <p key={warning.code} className="g-warning">
              <Glyph name="warn" size={12} />
              <span>{warning.message}</span>
            </p>
          ))}
      </div>
    </Dialog>
  );
}
