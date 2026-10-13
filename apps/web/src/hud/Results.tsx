import { STRINGS, getPart } from '@bolt/content';
import type { RaceResult } from '@bolt/shared';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { PartIcon } from '../components/PartIcon.js';
import { PixelText } from '../components/PixelText.js';
import { ResultsShare } from '../garage/ui/ResultsShare.js';
import type { GameManifests } from '../game/assets.js';
import { hudLive } from './hudStore.js';
import type { HudLoadout } from './model.js';
import { formatRaceTime } from './model.js';
import type { ResultFact, ResultsSummary, Verdict } from './results.js';
import { resultFacts, verdictFor } from './results.js';

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));
}

/** A weapon id from a `hit` event as a name: a catalog part, a ram, bladed hubs, or the road. */
export function sourceName(weapon: string): string {
  const r = STRINGS.results;
  if (weapon === 'ram') return r.ram;
  if (weapon === '') return r.hazard;
  const part = getPart(weapon);
  if (!part) return r.hazard;
  return part.category === 'tires' ? r.blades : part.displayName;
}

function verdictLine(verdict: Verdict): string {
  const r = STRINGS.results;
  switch (verdict.reason) {
    case 'margin':
      return fill(r.decidedBy, { seconds: (verdict.marginSeconds ?? 0).toFixed(1) });
    case 'rival_dnf':
      return r.rivalDnf;
    case 'you_dnf':
      return r.youDnf;
    case 'rival_ko':
      return r.rivalKo;
    case 'you_ko':
      return r.youKo;
    case 'draw':
      return r.drawLine;
    case 'rival_forfeit':
      return verdict.forfeitCause === 'left' ? r.rivalLeftForfeit : r.rivalForfeit;
    case 'you_forfeit':
      return r.youForfeit;
    default:
      return r.timeout;
  }
}

function factLine(fact: ResultFact, loadout: HudLoadout): string {
  const r = STRINGS.results;
  switch (fact.kind) {
    case 'biggestHit':
      return fill(r.biggestHit, {
        weapon: sourceName(fact.weapon),
        damage: Math.round(fact.damage),
      });
    case 'bestWeapon':
      return fill(r.bestWeapon, {
        weapon: sourceName(fact.weapon),
        damage: Math.round(fact.damage),
      });
    case 'worstTaken':
      return fill(r.worstTaken, {
        weapon: sourceName(fact.weapon),
        damage: Math.round(fact.damage),
      });
    case 'hot':
      return fill(r.hot, { seconds: fact.seconds });
    case 'tireHits': {
      const words = r.count as Record<number, string>;
      return fill(r.tireHits, {
        where: r.where[fact.where],
        count: words[fact.count] ?? String(fact.count),
      });
    }
    case 'noShot':
      return fill(r.noShot, { weapon: loadout.parts[fact.part]?.name ?? '' });
  }
}

type Props = {
  manifests: GameManifests;
  loadout: HudLoadout;
  /** The server's result, or null for a debug preview of a race that has not been decided. */
  result: RaceResult | null;
  summary: ResultsSummary;
  you: number;
  /** The race ran on the device, not on the server: the results say so. */
  offline?: boolean;
  onRaceAgain: () => void;
  onChangeBuild: () => void;
  onHome: () => void;
  /**
   * Race a Friend: the rematch votes and the way home, in place of Race Again, Change My Build
   * and Back Home (Section 5.11: no new race without both players).
   */
  actions?: ReactNode;
};

type Column = {
  time: string;
  bestLap: string;
  laps: string;
  hull: string;
  dealt: number;
  hits: number;
};

/**
 * Results (Section 5.11). The verdict and the two cars' numbers are the server's; the
 * breakdown by weapon and by part is added up from the events the race sent. Nothing on this
 * screen is estimated, and nothing is shown to more precision than it was measured.
 */
export function Results({
  manifests,
  loadout,
  result,
  summary,
  you,
  offline = false,
  onRaceAgain,
  onChangeBuild,
  onHome,
  actions,
}: Props) {
  const r = STRINGS.results;
  const again = useRef<HTMLButtonElement>(null);
  useEffect(() => again.current?.focus(), []);

  const verdict = useMemo(() => (result ? verdictFor(result, you) : null), [result, you]);
  const rival = you === 0 ? 1 : 0;
  // Hull is shown as a share; the ceilings are in the last snapshot.
  const race = hudLive.race;
  const myMax = race?.car.combat?.chassisMax ?? 0;
  const rivalMax = race?.rival.chassisMax ?? 0;

  const column = (index: number, mine: boolean): Column => {
    const car = result?.cars[index];
    const laps = summary.laps[index] ?? [];
    const best = car?.bestLapMs ?? (laps.length > 0 ? Math.min(...laps) : 0);
    const chassis = car
      ? car.chassis
      : mine
        ? (race?.car.combat?.chassis ?? 0)
        : (race?.rival.chassis ?? 0);
    const max = mine ? myMax : rivalMax;
    return {
      time: car
        ? car.ko
          ? r.ko
          : car.finishTimeMs !== null
            ? formatRaceTime(car.finishTimeMs)
            : r.dnf
        : formatRaceTime(race?.raceTimeMs ?? 0),
      bestLap: best > 0 ? formatRaceTime(best) : '-:--.--',
      laps: `${laps.length}/${hudLive.laps}`,
      hull: max > 0 ? `${Math.max(0, Math.round((chassis / max) * 100))}%` : '-',
      dealt: Math.round(car ? car.damageDealt : mine ? summary.dealt.total : summary.rivalDealt),
      hits: car ? car.hitsLanded : mine ? summary.dealt.hits : summary.rivalHits,
    };
  };
  const mine = column(you, true);
  const theirs = column(rival, false);
  const hasRival = (result ? result.cars.length : 2) > 1 && rivalMax > 0;

  const facts = useMemo(() => {
    const ys = loadout.components.filter((c) => c.kind === 'wheel').map((c) => c.y);
    const front = Math.min(...ys);
    const rear = Math.max(...ys);
    const wheelRows = new Map<number, 'front' | 'rear' | 'middle'>();
    for (const c of loadout.components)
      if (c.kind === 'wheel')
        wheelRows.set(
          c.index,
          c.y <= front + 0.5 ? 'front' : c.y >= rear - 0.5 ? 'rear' : 'middle',
        );
    const components = race?.car.combat?.components ?? [];
    return resultFacts(summary, {
      wheelRows,
      workingAutoWeapons: loadout.autos
        .filter((a) => a.category === 'weapon' && (components[a.component] ?? 1) > 0)
        .map((a) => a.part),
      complete: result !== null,
    }).slice(0, 3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary, loadout, result]);

  const headline = verdict
    ? verdict.outcome === 'victory'
      ? r.victory
      : verdict.outcome === 'defeat'
        ? r.defeat
        : r.draw
    : STRINGS.hud.finished;
  const color =
    verdict?.outcome === 'defeat' ? '#F46B58' : verdict?.outcome === 'draw' ? '#F5EED9' : '#F6C35B';
  const topWeapon = summary.dealt.byWeapon[0]?.damage ?? 1;
  const takenParts = summary.taken.byComponent.slice(0, 4);
  const componentName = (index: number) => loadout.components[index]?.name ?? r.chassis;

  const rows: Array<[label: string, key: keyof Column]> = [
    [r.time, 'time'],
    [r.bestLap, 'bestLap'],
    [r.laps, 'laps'],
    [r.hull, 'hull'],
    [r.dealt, 'dealt'],
    [r.hits, 'hits'],
  ];

  return (
    <div className="overlay overlay-results" role="dialog" aria-modal="true" aria-label={r.title}>
      <div
        className={`panel results results-${verdict?.outcome ?? 'preview'}`}
        data-testid="results"
        data-outcome={verdict?.outcome ?? 'preview'}
        data-reason={verdict?.reason ?? 'preview'}
      >
        <header className="results-head">
          <PixelText text={headline} scale={4} color={color} shadow="#0e1320" />
          <p className="results-line" data-testid="results-line">
            {verdict ? verdictLine(verdict) : r.preview}
          </p>
          {offline && (
            <span className="badge results-offline" data-testid="offline-badge">
              {STRINGS.race.offlineBadge}
            </span>
          )}
        </header>

        <div className="results-body">
          <section className="results-compare" aria-label={r.title}>
            <table>
              <thead>
                <tr>
                  <td />
                  <th scope="col" className="is-you">
                    {r.you}
                  </th>
                  {hasRival && (
                    <th scope="col" className="is-rival">
                      {r.rival}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map(([label, key]) => (
                  <tr key={key}>
                    <th scope="row">{label}</th>
                    <td data-testid={`res-${key}-you`}>{mine[key]}</td>
                    {hasRival && <td data-testid={`res-${key}-rival`}>{theirs[key]}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="results-damage">
            <h3>{r.byWeapon}</h3>
            {summary.dealt.byWeapon.length === 0 ? (
              <p className="results-empty">{r.noDamageDealt}</p>
            ) : (
              <ul className="results-list" data-testid="res-by-weapon">
                {summary.dealt.byWeapon.slice(0, 4).map((w) => (
                  <li
                    key={w.weapon}
                    data-weapon={w.weapon}
                    data-damage={w.damage}
                    data-hits={w.hits}
                  >
                    <PartIcon
                      manifests={manifests}
                      partId={w.weapon}
                      category={getPart(w.weapon)?.category ?? 'weapon'}
                      size={24}
                    />
                    <span className="results-name">{sourceName(w.weapon)}</span>
                    <span className="results-sub">
                      {w.hits === 1 ? r.hitsCount.one : fill(r.hitsCount.many, { count: w.hits })}
                    </span>
                    <span className="results-num">{Math.round(w.damage)}</span>
                    <span className="results-bar" aria-hidden="true">
                      <span style={{ width: `${Math.max(4, (w.damage / topWeapon) * 100)}%` }} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <h3>
              {r.takenBy}
              {summary.taken.hits > 0 && (
                <span
                  className="results-total"
                  data-testid="res-taken-total"
                  data-value={summary.taken.total}
                >
                  {Math.round(summary.taken.total)}
                </span>
              )}
            </h3>
            {takenParts.length === 0 ? (
              <p className="results-empty">{r.noDamageTaken}</p>
            ) : (
              <ul className="results-list is-plain" data-testid="res-taken">
                {takenParts.map((c) => (
                  <li key={c.component} data-component={c.component} data-damage={c.damage}>
                    <span className="results-name">
                      {c.component >= 0 ? componentName(c.component) : r.chassis}
                    </span>
                    <span className="results-sub">
                      {c.hits === 1 ? r.hitsCount.one : fill(r.hitsCount.many, { count: c.hits })}
                    </span>
                    <span className="results-num">{Math.round(c.damage)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="results-notes">
            {facts.length > 0 && (
              <>
                <h3>{r.highlights}</h3>
                <ul className="results-facts" data-testid="res-facts">
                  {facts.map((fact, index) => (
                    <li key={index} data-kind={fact.kind}>
                      {factLine(fact, loadout)}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <h3>{r.partsLost}</h3>
            {summary.partsLost.length === 0 ? (
              <p className="results-empty">{r.none}</p>
            ) : (
              <ul className="results-tags" data-testid="res-parts-lost">
                {summary.partsLost.map((lost, index) => (
                  <li key={index} data-component={lost.component}>
                    {componentName(lost.component)}
                    {lost.repaired ? ` (${r.repaired})` : ''}
                  </li>
                ))}
              </ul>
            )}
            {summary.rivalPartsLost.length > 0 && (
              <>
                <h3>{r.partsDestroyed}</h3>
                <ul className="results-tags" data-testid="res-rival-lost">
                  {summary.rivalPartsLost.map((component) => (
                    <li key={component}>{hudLive.rivalNames[component] ?? r.chassis}</li>
                  ))}
                </ul>
              </>
            )}
            <h3>{r.repairs}</h3>
            {summary.repairs.length === 0 ? (
              <p className="results-empty">{r.none}</p>
            ) : (
              <ul className="results-tags" data-testid="res-repairs">
                {summary.repairs.map((repair, index) => (
                  <li key={index}>
                    {fill(r.repairLine, {
                      utility: sourceName(repair.utility),
                      part: componentName(repair.component),
                    })}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {actions ? (
          <footer className="results-match">
            {actions}
            <div className="dialog-actions results-actions">
              <ResultsShare />
            </div>
          </footer>
        ) : (
          <footer className="dialog-actions results-actions">
            <button className="btn btn-primary" onClick={onRaceAgain} ref={again}>
              {STRINGS.race.raceAgain}
            </button>
            <button className="btn" onClick={onChangeBuild}>
              {STRINGS.race.changeBuild}
            </button>
            {/* Save This Car and Share Blueprint (Section 5.11), owned by the garage code. */}
            <ResultsShare />
            <button className="btn" onClick={onHome}>
              {STRINGS.race.backHome}
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
