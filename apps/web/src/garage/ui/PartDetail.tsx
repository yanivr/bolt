import { CATALOG, STRINGS, partCard } from '@bolt/content';
import type { AnyPartDefinition, BuildStats, StatDelta, VehicleBlueprint } from '@bolt/shared';
import { own } from '@bolt/shared';
import { Glyph } from '../../components/Glyph.js';
import { PartIcon } from '../../components/PartIcon.js';
import type { GameManifests } from '../../game/assets.js';
import type { InstallPlan } from '../buildSession.js';
import { issueText, partsOnMount } from '../buildSession.js';
import { mountsFor } from '../slots.js';
import { compactNumber, fill, listNames, mountName } from '../text.js';
import { Credits, FactRow, partFacts } from './partFacts.js';
import type { BuildPreview } from './useBuildStats.js';

const SCORES = ['speed', 'control', 'defense', 'firepower', 'utility'] as const;

type Props = {
  manifests: GameManifests;
  blueprint: VehicleBlueprint;
  part: AnyPartDefinition;
  plan: InstallPlan;
  stats: BuildStats | null;
  preview: BuildPreview | null;
  /** Copies of this part on the car. */
  installed: number;
  /** The mount the player picked for it, or null for the best free mount. */
  targetMountId: string | null;
  /**
   * Offers the choice of mount. Off when the part was opened from a slot: the slot is where
   * it goes.
   */
  pickMount: boolean;
  locked: boolean;
  onBack: () => void;
  onStep: (direction: 1 | -1) => void;
  onInstall: () => void;
  /** Removes one installed copy of this accessory. */
  onRemove: (() => void) | null;
  onChooseMount: (mountId: string | null) => void;
};

function Change({
  id,
  label,
  change,
  format,
}: {
  id?: string;
  label: string;
  change: StatDelta;
  format: (value: number) => string;
}) {
  const same = Math.abs(change.delta) < 1e-9 || format(change.before) === format(change.after);
  const tone = same || change.better === null ? '' : change.better ? ' is-better' : ' is-worse';
  return (
    <div className={`cmp-row${tone}${same ? ' is-same' : ''}`} data-testid={id}>
      <dt>{label}</dt>
      <dd>
        <span className="cmp-before">{format(change.before)}</span>
        <span className="cmp-arrow" aria-hidden="true">
          <Glyph name={same ? 'minus' : 'right'} size={12} />
        </span>
        <span className="visually-hidden"> to </span>
        <span className="cmp-after">{format(change.after)}</span>
        {!same && (
          <span className="cmp-mark" aria-hidden="true">
            <Glyph name={change.delta > 0 ? 'up' : 'down'} size={12} />
          </span>
        )}
      </dd>
    </div>
  );
}

const whole = (value: number) => String(Math.round(value));
const percent = (value: number) => fill(STRINGS.garage.percent, { value: Math.round(value * 100) });

/**
 * The compare pane for one catalog part: what it is, what installing it would do to the five
 * scores and five indicators of this build (a two-column table, so it fits a 667 x 375 phone
 * without scrolling), what it costs in new spend and refund, and the one deliberate button
 * that buys it. All of it is the plan the store would execute.
 */
export function PartDetail({
  manifests,
  blueprint,
  part,
  plan,
  stats,
  preview,
  installed,
  targetMountId,
  pickMount,
  locked,
  onBack,
  onStep,
  onInstall,
  onRemove,
  onChooseMount,
}: Props) {
  const g = STRINGS.garage;
  const chassis = own(CATALOG.chassis, blueprint.chassisId);
  const card = partCard(part, chassis?.wheelCount ?? 4);
  const accessory =
    part.category === 'weapon' || part.category === 'defense' || part.category === 'utility';
  const mounts = accessory ? mountsFor(blueprint, CATALOG, part) : [];
  const kinds =
    part.category === 'weapon' || part.category === 'defense' || part.category === 'utility'
      ? part.compatibleMounts
          .map((kind) => (g.mountKinds as Record<string, string>)[kind])
          .filter((name): name is string => typeof name === 'string')
      : [];
  const result = plan.result;
  const blocked = result.ok ? null : issueText(result.issue);
  const isCurrent = plan.action === 'current';
  const label = plan.action === 'replace' ? g.replace : plan.action === 'swap' ? g.swap : g.install;
  const removed = result.ok ? result.removed : [];
  const delta = preview?.delta;

  return (
    <section className="g-detail" aria-label={part.displayName} data-part={part.id}>
      <header className="g-pane-head">
        <button className="btn btn-small" onClick={onBack}>
          <Glyph name="back" size={12} />
          <span>{g.backToParts}</span>
        </button>
        <span className="g-pane-spacer" />
        <button
          className="btn btn-small btn-square"
          onClick={() => onStep(-1)}
          aria-label={g.previousPart}
        >
          <Glyph name="left" size={12} />
        </button>
        <button
          className="btn btn-small btn-square"
          onClick={() => onStep(1)}
          aria-label={g.nextPart}
        >
          <Glyph name="right" size={12} />
        </button>
      </header>
      <div className="g-pane-body">
        <div className="g-detail-title">
          <PartIcon manifests={manifests} partId={part.id} category={part.category} size={64} />
          <div>
            <h2>{part.displayName}</h2>
            <p className="g-detail-price">
              <Credits value={card.price} />
              {part.category === 'tires' && (
                <span className="dim">
                  {fill(g.wheelsFor, { count: chassis?.wheelCount ?? 4 })}
                </span>
              )}
              {installed > 0 && (
                <span className="tag tag-ok">
                  <Glyph name="check" size={12} />
                  {installed > 1 ? fill(g.installedCount, { count: installed }) : g.installed}
                </span>
              )}
            </p>
          </div>
        </div>
        <FactRow facts={partFacts(part, card)} />
        <p className="pc-line pc-good is-full">
          <Glyph name="plus" size={12} />
          <span>
            <span className="visually-hidden">{g.benefit}: </span>
            {card.benefit}
          </span>
        </p>
        <p className="pc-line pc-bad is-full">
          <Glyph name="minus" size={12} />
          <span>
            <span className="visually-hidden">{g.downside}: </span>
            {card.downside}
          </span>
        </p>
        {accessory && (
          <p className="g-detail-extra g-detail-trigger dim">
            {g.trigger[card.triggerMode as keyof typeof g.trigger] ?? ''}
            {card.charges > 0 ? `. ${fill(g.charges, { count: card.charges })}` : ''}
            {card.maxPerCar !== null ? `. ${fill(g.limit, { count: card.maxPerCar })}` : ''}
          </p>
        )}

        {accessory && mounts.length === 0 && (
          <p className="g-warning" data-testid="no-mount">
            <Glyph name="warn" size={12} />
            <span>
              {g.noMountHere}
              {kinds.length > 0 ? ` ${fill(g.fitsKinds, { kinds: listNames(kinds) })}` : ''}
            </span>
          </p>
        )}
        {accessory && pickMount && mounts.length > 0 && (
          <div className="g-mount-pick" role="radiogroup" aria-label={g.goesOn}>
            <span className="g-block-title">{g.goesOn}</span>
            <div className="chips">
              <button
                type="button"
                role="radio"
                aria-checked={targetMountId === null}
                className={`chip${targetMountId === null ? ' is-selected' : ''}`}
                onClick={() => onChooseMount(null)}
              >
                {g.autoMount}
              </button>
              {mounts.map((mount) => {
                const holding = partsOnMount(blueprint, CATALOG, mount.id);
                const active = targetMountId === mount.id;
                return (
                  <button
                    key={mount.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`chip${active ? ' is-selected' : ''}${
                      !active && plan.mountId === mount.id ? ' is-suggested' : ''
                    }`}
                    data-mount={mount.id}
                    onClick={() => onChooseMount(mount.id)}
                  >
                    <strong>{mountName(mount.id)}</strong>
                    <span className="dim">
                      {holding.length === 0
                        ? g.mountFree
                        : fill(g.mountHolds, {
                            part: listNames(holding.map((p) => p.def.displayName)),
                          })}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {!isCurrent && result.ok && delta && stats && (
          <div className="g-compare">
            <span className="g-block-title">{g.compare}</span>
            {/* Two columns side by side: what the part does to the five scores, and to the
                five indicators. Ten short rows that fit a 300 pixel pane without scrolling. */}
            <div className="cmp-table">
              <dl className="cmp" aria-label={g.performance}>
                {SCORES.map((key) => (
                  <Change
                    key={key}
                    id={`score-${key}`}
                    label={g.scores[key]}
                    change={delta.scores[key]}
                    format={whole}
                  />
                ))}
              </dl>
              <dl className="cmp" aria-label={g.engineering}>
                <Change
                  label={g.cmpShort.credits}
                  change={delta.indicators.creditsLeft}
                  format={whole}
                />
                <Change
                  label={g.cmpShort.load}
                  change={delta.indicators.loadKg}
                  format={compactNumber}
                />
                <Change
                  label={g.cmpShort.energy}
                  change={delta.indicators.energyRatio}
                  format={percent}
                />
                <Change
                  label={g.cmpShort.heat}
                  change={delta.indicators.heatRatio}
                  format={percent}
                />
                <Change
                  label={g.cmpShort.stability}
                  change={delta.indicators.stability}
                  format={whole}
                />
              </dl>
            </div>
            {delta.newWarnings.map((warning) => (
              <p key={warning.code} className="g-warning">
                <Glyph name="warn" size={12} />
                <span>{warning.message}</span>
              </p>
            ))}
            {delta.clearedWarnings.length > 0 && (
              <p className="g-fix">
                <Glyph name="check" size={12} />
                <span>
                  {g.clearedWarnings}: {delta.clearedWarnings.map((w) => w.message).join(' ')}
                </span>
              </p>
            )}
          </div>
        )}
        {removed.length > 0 && (
          <p className="g-warning">
            <Glyph name="warn" size={12} />
            <span>
              {fill(g.chassisWillRefund, {
                names: listNames(
                  removed.map((r) => own(CATALOG.parts, r.instance.partId)?.displayName ?? ''),
                ),
              })}
            </span>
          </p>
        )}
        {plan.replaced && result.ok && (
          <p className="g-detail-extra dim">
            {g.replace}: {plan.replaced.def.displayName}
          </p>
        )}
        {accessory && !pickMount && plan.mountId && !plan.replaced && !isCurrent && (
          <p className="g-detail-extra g-detail-goes dim">
            {fill(g.goesOnMount, { mount: mountName(plan.mountId) })}
          </p>
        )}
      </div>
      <footer className="g-pane-foot">
        {isCurrent ? (
          <p className="g-spend">
            <Glyph name="check" size={12} />
            <span>{g.currentPart}</span>
          </p>
        ) : result.ok ? (
          <dl className="g-spend" aria-live="polite">
            <div>
              <dt>{g.newSpend}</dt>
              <dd data-testid="new-spend">{result.spend.newSpend}</dd>
            </div>
            <div>
              <dt>{g.refund}</dt>
              <dd data-testid="refund">{result.spend.refund}</dd>
            </div>
            <div>
              <dt>{g.after}</dt>
              <dd data-testid="credits-after">{result.spend.creditsLeft}</dd>
            </div>
          </dl>
        ) : (
          <p className="g-spend is-blocked" data-testid="blocked-reason">
            <Glyph name="warn" size={12} />
            <span>{blocked}</span>
          </p>
        )}
        {onRemove && (
          <button className="btn btn-small" onClick={onRemove} disabled={locked}>
            {g.remove}
          </button>
        )}
        {!isCurrent && (
          <button
            className="btn btn-primary g-buy"
            onClick={onInstall}
            aria-disabled={!result.ok || locked}
            data-testid="install"
          >
            {label}
          </button>
        )}
      </footer>
    </section>
  );
}
