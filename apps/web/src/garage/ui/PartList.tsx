import { CATALOG, STRINGS, partCard, partsByCategory } from '@bolt/content';
import type { AnyPartDefinition, PartCategory, VehicleBlueprint } from '@bolt/shared';
import { drawableChassisIds } from '@bolt/shared';
import { useMemo } from 'react';
import { Glyph } from '../../components/Glyph.js';
import { PartIcon } from '../../components/PartIcon.js';
import type { GameManifests } from '../../game/assets.js';
import type { GarageSession } from '../buildSession.js';
import { issueText, planFor, targetMountFor } from '../buildSession.js';
import { fill, mountName } from '../text.js';
import { Credits, FactRow, findMountOf, fitsMount, partFacts } from './partFacts.js';

export type ListedPart = {
  part: AnyPartDefinition;
  /** Copies on the car now: 1 for the current chassis, engine or wheel kit. */
  installed: number;
  /** Why it cannot be bought right now, in approved copy. Null when it can. */
  blocked: string | null;
  /** A chassis the car atlas cannot draw yet. */
  pending: boolean;
};

/**
 * The parts of a category as the list shows them: filtered to the selected mount, each with
 * its installed state and, when it cannot be installed, the validator's reason. The reason
 * comes from planning the very edit the Install button would make.
 */
export function useListedParts(
  session: GarageSession,
  blueprint: VehicleBlueprint,
  manifests: GameManifests,
): ListedPart[] {
  const { category, selection, targetMountId } = session;
  return useMemo(() => {
    const mount = findMountOf(blueprint.chassisId, targetMountFor(session));
    const drawable = new Set(drawableChassisIds(manifests.cars, CATALOG));
    const accessory = category === 'weapon' || category === 'defense' || category === 'utility';
    return partsByCategory(category)
      .filter((part) => !accessory || !mount || fitsMount(mount, part))
      .map((part): ListedPart => {
        const pending = part.category === 'chassis' && !drawable.has(part.id);
        const installed =
          part.id === blueprint.chassisId ||
          part.id === blueprint.engineId ||
          part.id === blueprint.tireKitId
            ? 1
            : blueprint.parts.filter((p) => p.partId === part.id).length;
        if (pending) return { part, installed, blocked: null, pending };
        const plan = planFor(session, CATALOG, part.id);
        return {
          part,
          installed,
          blocked: plan.result.ok ? null : issueText(plan.result.issue),
          pending,
        };
      });
    // The session fields that matter are listed; the rest of it does not change the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blueprint, category, selection, targetMountId, manifests]);
}

type Props = {
  manifests: GameManifests;
  blueprint: VehicleBlueprint;
  category: PartCategory;
  parts: ListedPart[];
  focusPartId: string | null;
  /** The mount the list is filtered to, if any. */
  filterMountId: string | null;
  onFocus: (partId: string) => void;
  onClearFilter: () => void;
};

/** The vertically scrolling list of part cards for the open category. */
export function PartList({
  manifests,
  blueprint,
  category,
  parts,
  focusPartId,
  filterMountId,
  onFocus,
  onClearFilter,
}: Props) {
  const wheelCount = CATALOG.chassis[blueprint.chassisId]?.wheelCount ?? 4;
  const accessory = category === 'weapon' || category === 'defense' || category === 'utility';
  return (
    <div
      className="g-list"
      id="g-parts"
      role="tabpanel"
      aria-labelledby={`g-tab-${category}`}
      data-category={category}
    >
      {accessory && filterMountId && (
        <div className="g-filter">
          <Glyph name="check" size={12} />
          <span>{fill(STRINGS.garage.fitsMount, { mount: mountName(filterMountId) })}</span>
          <button className="btn btn-small" onClick={onClearFilter}>
            {STRINGS.garage.clearFilter}
          </button>
        </div>
      )}
      {parts.length === 0 && <p className="g-list-empty">{STRINGS.garage.nothingFits}</p>}
      <ul className="g-cards">
        {parts.map(({ part, installed, blocked, pending }) => {
          const card = partCard(part, wheelCount);
          const state = pending ? 'is-pending' : blocked ? 'is-blocked' : '';
          return (
            <li key={part.id}>
              <button
                type="button"
                className={`part-card ${state}${installed > 0 ? ' is-installed' : ''}${
                  focusPartId === part.id ? ' is-focused' : ''
                }`}
                data-part={part.id}
                aria-pressed={focusPartId === part.id}
                aria-disabled={pending}
                onClick={() => {
                  if (!pending) onFocus(part.id);
                }}
              >
                <PartIcon manifests={manifests} partId={part.id} category={part.category} />
                <span className="pc-main">
                  <span className="pc-top">
                    <strong className="pc-name">{part.displayName}</strong>
                    {installed > 0 && (
                      <span className="tag tag-ok">
                        <Glyph name="check" size={12} />
                        {installed > 1
                          ? fill(STRINGS.garage.installedCount, { count: installed })
                          : STRINGS.garage.installed}
                      </span>
                    )}
                    <Credits value={card.price} />
                  </span>
                  <FactRow facts={partFacts(part, card)} />
                  <span className="pc-line pc-good">
                    <Glyph name="plus" size={12} />
                    <span>{card.benefit}</span>
                  </span>
                  <span className="pc-line pc-bad">
                    <Glyph name="minus" size={12} />
                    <span>{card.downside}</span>
                  </span>
                  {pending ? (
                    <span className="pc-line pc-reason">
                      <Glyph name="lock" size={12} />
                      <span>{STRINGS.garage.artInProgress}</span>
                    </span>
                  ) : (
                    blocked && (
                      <span className="pc-line pc-reason">
                        <Glyph name="warn" size={12} />
                        <span>{blocked}</span>
                      </span>
                    )
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
