import { CATALOG, PART_CATEGORIES, STRINGS, partCard } from '@bolt/content';
import type { AnyPartDefinition, PartCategory, VehicleBlueprint } from '@bolt/shared';
import { accessoryMounts } from '@bolt/shared';
import { useEffect, useState } from 'react';
import { Glyph } from '../../components/Glyph.js';
import { PartIcon } from '../../components/PartIcon.js';
import type { GameManifests } from '../../game/assets.js';
import type { SlotEntry } from '../slots.js';
import { compactNumber, fill, mountName } from '../text.js';
import { Credits } from './partFacts.js';

/** A list longer than this gets the filter chips, where the panel has height for them. */
const LONG_LIST = 12;

type Props = {
  manifests: GameManifests;
  blueprint: VehicleBlueprint;
  entries: SlotEntry[];
  /** What the list is for: the slot's name. */
  heading: string;
  /** The list key: a slot, or `browse`. Scroll and filter start over when it changes. */
  listKey: string;
  /** A mount's list is grouped under Weapons, Defense and Utility. */
  grouped: boolean;
  /** Set while browsing the whole catalog: the open category and how to change it. */
  browse: { category: PartCategory; onCategory: (category: PartCategory) => void } | null;
  focusPartId: string | null;
  /** The first-build step this list belongs to, shown in its header. */
  coach: { number: number; label: string } | null;
  onFocus: (partId: string) => void;
  /** Opens the whole catalog. Null while it is already open. */
  onBrowse: (() => void) | null;
};

/** The one short line under a part's name: what it is good for, in as few words as fit. */
function note(part: AnyPartDefinition, benefit: string): string {
  const g = STRINGS.garage;
  if (part.category === 'chassis') {
    const facts = [
      fill(g.chassisLoad, { kg: part.maxLoadKg }),
      fill(g.chassisMounts, { count: accessoryMounts(part).length }),
    ];
    if (part.wheelCount !== 4) facts.push(fill(g.chassisWheels, { count: part.wheelCount }));
    return facts.join(', ');
  }
  if (part.category === 'engine') return fill(g.engineForce, { value: part.forceIndex });
  if (part.category === 'tires') return fill(g.tireGrip, { value: part.grip.toFixed(2) });
  return benefit;
}

/**
 * The parts for the selected slot, one compact row each: icon, name, price, weight and one
 * short line. A row that cannot be bought says why in place of that line. Tapping a row opens
 * the compare pane; nothing is bought from the list.
 */
export function PartList({
  manifests,
  blueprint,
  entries,
  heading,
  listKey,
  grouped,
  browse,
  focusPartId,
  coach,
  onFocus,
  onBrowse,
}: Props) {
  const g = STRINGS.garage;
  const wheelCount = CATALOG.chassis[blueprint.chassisId]?.wheelCount ?? 4;
  const [only, setOnly] = useState<PartCategory | null>(null);
  useEffect(() => setOnly(null), [listKey]);

  const categories = grouped
    ? PART_CATEGORIES.filter((id) => entries.some((e) => e.part.category === id))
    : [];
  const chips = grouped && categories.length > 1 && entries.length > LONG_LIST;
  const shown = only && chips ? entries.filter((e) => e.part.category === only) : entries;
  const groups: Array<{ id: string; title: string; rows: SlotEntry[] }> = grouped
    ? categories
        .map((id) => ({
          id,
          title: g.categories[id],
          rows: shown.filter((e) => e.part.category === id),
        }))
        .filter((group) => group.rows.length > 0)
    : [{ id: 'all', title: '', rows: shown }];

  const row = ({ part, installed, here, blocked, pending, mountId, replaces }: SlotEntry) => {
    const card = partCard(part, wheelCount);
    const state = pending ? ' is-pending' : blocked ? ' is-blocked' : '';
    const accessory =
      part.category === 'weapon' || part.category === 'defense' || part.category === 'utility';
    return (
      <li key={part.id}>
        <button
          type="button"
          className={`part-card${state}${installed > 0 ? ' is-installed' : ''}${
            here ? ' is-here' : ''
          }${focusPartId === part.id ? ' is-focused' : ''}`}
          data-part={part.id}
          aria-pressed={focusPartId === part.id}
          aria-disabled={pending}
          onClick={() => {
            if (!pending) onFocus(part.id);
          }}
        >
          <PartIcon manifests={manifests} partId={part.id} category={part.category} size={48} />
          <span className="pc-main">
            <span className="pc-top">
              <strong className="pc-name">{part.displayName}</strong>
              {installed > 0 && (
                <span className="tag tag-ok">
                  <Glyph name="check" size={12} />
                  {installed > 1 ? fill(g.installedCount, { count: installed }) : g.installed}
                </span>
              )}
              <Credits value={card.price} />
            </span>
            <span className="pc-sub">
              <span className="pc-weight" title={g.weightLabel}>
                <span className="visually-hidden">{g.weightLabel}: </span>
                {fill(g.weight, { kg: compactNumber(card.massKg) })}
              </span>
              {pending ? (
                <span className="pc-note pc-reason">
                  <Glyph name="lock" size={12} />
                  <span>{g.artInProgress}</span>
                </span>
              ) : blocked ? (
                <span className="pc-note pc-reason">
                  <Glyph name="warn" size={12} />
                  <span>{blocked}</span>
                </span>
              ) : browse && accessory && mountId ? (
                <span className="pc-note pc-where">
                  <span>
                    {replaces
                      ? fill(g.replacesOn, { part: replaces, mount: mountName(mountId) })
                      : fill(g.goesOnMount, { mount: mountName(mountId) })}
                  </span>
                </span>
              ) : (
                <span className={`pc-note${accessory ? ' pc-benefit' : ''}`}>
                  <span>{note(part, card.benefit)}</span>
                </span>
              )}
            </span>
          </span>
        </button>
      </li>
    );
  };

  return (
    <div
      className={`g-list${browse ? ' is-browse' : ''}`}
      id="g-parts"
      role={browse ? 'tabpanel' : 'region'}
      aria-labelledby={browse ? `g-tab-${browse.category}` : undefined}
      aria-label={browse ? undefined : heading}
      data-list={listKey}
      data-testid="part-list"
    >
      {browse && (
        <div className="g-tabs" role="tablist" aria-label={g.browseTitle}>
          {PART_CATEGORIES.map((id, index) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`g-tab-${id}`}
              aria-selected={browse.category === id}
              aria-controls="g-parts"
              tabIndex={browse.category === id ? 0 : -1}
              className={`tab g-tab${browse.category === id ? ' is-selected' : ''}`}
              data-category={id}
              onClick={() => browse.onCategory(id)}
              onKeyDown={(event) => {
                const move =
                  event.key === 'ArrowRight' || event.key === 'ArrowDown'
                    ? 1
                    : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
                      ? -1
                      : 0;
                if (move === 0) return;
                event.preventDefault();
                const next =
                  PART_CATEGORIES[
                    (index + move + PART_CATEGORIES.length) % PART_CATEGORIES.length
                  ]!;
                browse.onCategory(next);
                document.getElementById(`g-tab-${next}`)?.focus();
              }}
            >
              <Glyph name={id} size={12} />
              <span>{g.categories[id]}</span>
            </button>
          ))}
        </div>
      )}
      {chips && (
        <div className="g-chips" role="radiogroup" aria-label={g.filter}>
          {[null, ...categories].map((id) => (
            <button
              key={id ?? 'all'}
              type="button"
              role="radio"
              aria-checked={only === id}
              className={`chip${only === id ? ' is-selected' : ''}`}
              onClick={() => setOnly(id)}
            >
              {id ? g.categories[id] : g.filterAll}
            </button>
          ))}
        </div>
      )}
      {groups.map((group, index) => (
        <section key={group.id} className="g-group">
          {!browse && (
            <h2 className="g-group-head">
              {coach && index === 0 && (
                <span className="g-group-step">
                  <span className="g-step-number">{coach.number}</span>
                  {coach.label}
                </span>
              )}
              {!(coach && index === 0) && <span className="g-group-slot">{heading}</span>}
              {group.title && <span className="g-group-name">{group.title}</span>}
              <span className="g-group-count">
                {group.rows.length === 1
                  ? g.onePart
                  : fill(g.partsCount, { count: group.rows.length })}
              </span>
            </h2>
          )}
          <ul className="g-rows">{group.rows.map(row)}</ul>
        </section>
      ))}
      {entries.length === 0 && <p className="g-list-empty">{g.nothingFits}</p>}
      {onBrowse && (
        <button type="button" className="g-browse-row" onClick={onBrowse} data-testid="browse-all">
          <Glyph name="grid" size={24} />
          <span>{g.browseAll}</span>
          <Glyph name="right" size={12} />
        </button>
      )}
    </div>
  );
}
