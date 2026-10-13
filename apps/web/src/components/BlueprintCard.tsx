import { CATALOG, STRINGS } from '@bolt/content';
import type { VehicleBlueprint } from '@bolt/shared';
import { blueprintCost, resolveCarSprites } from '@bolt/shared';
import type { ReactNode } from 'react';
import type { GameManifests } from '../game/assets.js';
import { fill } from '../garage/text.js';
import { CarCanvas } from './CarCanvas.js';
import { Glyph } from './Glyph.js';

type Props = {
  manifests: GameManifests;
  blueprint: VehicleBlueprint;
  /** A line under the name: a template description or a suitability hint. */
  note?: string;
  /** A flag line with a warning glyph, for builds that need attention. */
  warning?: string;
  /** A small tag beside the name, such as "Current car". */
  tag?: string;
  /** The server code this car was shared under, shown in the code face. */
  code?: string;
  /** The buttons. */
  children: ReactNode;
};

/** True when the car atlas can draw this blueprint's chassis today. */
export function isDrawable(manifests: GameManifests, blueprint: VehicleBlueprint): boolean {
  return resolveCarSprites(manifests.cars, blueprint).loadout !== null;
}

/**
 * One car as a card: a thumbnail composed from the real sprites, its name, its exact cost
 * and its actions. Used for saved blueprints, starter cars and the Quick Build list.
 */
export function BlueprintCard({ manifests, blueprint, note, warning, tag, code, children }: Props) {
  const drawable = isDrawable(manifests, blueprint);
  const cost = blueprintCost(blueprint, CATALOG).total;
  // A chassis the catalog no longer has (a retired frame) is not "art in progress": the
  // card says so and the flag line offers the repair.
  const known = CATALOG.chassis[blueprint.chassisId];
  const chassis = known?.displayName ?? STRINGS.blueprints.retiredFrame;
  return (
    <article className="panel bp-card" aria-label={blueprint.name}>
      <div className="bp-thumb">
        {drawable ? (
          <CarCanvas manifests={manifests} blueprint={blueprint} scale={1} frame={8} />
        ) : (
          <span className="bp-thumb-pending">
            <Glyph name="chassis" size={36} />
          </span>
        )}
      </div>
      <div className="bp-body">
        <h3 className="bp-name">
          {blueprint.name}
          {tag && <span className="tag">{tag}</span>}
        </h3>
        <p className="bp-meta">
          <span className="credits">
            <Glyph name="coin" size={12} />
            {fill(STRINGS.blueprints.cost, { cost })}
          </span>
          <span>{chassis}</span>
        </p>
        {code && (
          <p
            className="bp-code"
            data-testid="card-code"
            aria-label={fill(STRINGS.codes.codeLabel, { code })}
          >
            <Glyph name="share" size={12} />
            <span className="code-mono">{code}</span>
          </p>
        )}
        {note && <p className="bp-note">{note}</p>}
        {!drawable && known && (
          <p className="bp-flag">
            <Glyph name="warn" size={12} />
            {STRINGS.blueprints.artPending}
          </p>
        )}
        {warning && (
          <p className="bp-flag">
            <Glyph name="warn" size={12} />
            {warning}
          </p>
        )}
      </div>
      <div className="bp-actions">{children}</div>
    </article>
  );
}
