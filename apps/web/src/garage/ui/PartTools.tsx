import { STRINGS } from '@bolt/content';
import type { PlacedPart, QuarterTurn } from '@bolt/shared';
import { allowedRotations, takesFireButton } from '@bolt/shared';
import { Glyph } from '../../components/Glyph.js';
import type { GlyphName } from '../../components/glyphs.js';
import { PartIcon } from '../../components/PartIcon.js';
import type { GameManifests } from '../../game/assets.js';
import type { FireChoice } from '../buildSession.js';
import { fill, mountName } from '../text.js';

type Props = {
  manifests: GameManifests;
  part: PlacedPart;
  locked: boolean;
  /** Starts replacing this part: the list shows what else fits its mount. */
  onReplace: () => void;
  onNudge: (dx: number, dy: number) => void;
  /** Points the part front (0), right (1), rear (2) or left (3) of the car. */
  onFace: (turn: QuarterTurn) => void;
  onFire: (slot: FireChoice) => void;
  onRemove: () => void;
};

/** The compass: where each direction sits on the pad, relative to the car, and its arrow. */
const COMPASS: ReadonlyArray<readonly [QuarterTurn, 'up' | 'right' | 'down' | 'left']> = [
  [0, 'up'],
  [1, 'right'],
  [2, 'down'],
  [3, 'left'],
];

/**
 * The card for the part on the selected slot: what it is and where, its fire button, and the
 * things that can be done to it. Two compact three-by-three pads sit side by side: `Facing`,
 * a compass relative to the car with the current direction lit and the ones this mount does
 * not have dimmed (a press on a dimmed one says why), and `Position`, the nudge arrows around
 * the offset. Replace and Remove, with its refund on a line of its own, stand beside them.
 * A part whose direction is not the player's to choose has no compass. Everything is on one
 * card with nothing to scroll on a landscape phone. The same moves are on the keyboard (arrow
 * keys, R, Delete on the slot tile) and a drag on the car.
 */
export function PartTools({
  manifests,
  part,
  locked,
  onReplace,
  onNudge,
  onFace,
  onFire,
  onRemove,
}: Props) {
  const g = STRINGS.garage;
  const { def, instance, mount } = part;
  const allowed = allowedRotations(mount, def);
  const aims = def.facing === 'free';
  const fires = takesFireButton(def);
  const fire: FireChoice =
    instance.assignedActionSlot ?? (instance.autoMode === true ? 'auto' : null);
  const choices: Array<[FireChoice, string]> = [
    [0, g.firePrimary],
    [1, g.fireSecondary],
  ];
  if (def.triggerMode === 'hybrid') choices.push(['auto', g.fireAuto]);
  choices.push([null, g.fireOff]);
  const movable = mount.regionHalfW > 0 || mount.regionHalfH > 0;
  const nudges: Array<[string, GlyphName, number, number, string]> = [
    ['up', 'up', 0, -1, g.moveUp],
    ['left', 'left', -1, 0, g.moveLeft],
    ['right', 'right', 1, 0, g.moveRight],
    ['down', 'down', 0, 1, g.moveDown],
  ];

  return (
    <section
      className={`g-tools${aims ? ' has-facing' : ''}${fires ? ' has-fire' : ''}`}
      aria-label={g.selectedPart}
      data-instance={instance.instanceId}
    >
      <header className="g-tools-head">
        <PartIcon manifests={manifests} partId={def.id} category={def.category} size={48} />
        <div className="g-tools-title">
          <h2>{def.displayName}</h2>
          <span className="dim">{mountName(mount.id)}</span>
        </div>
      </header>
      <div className="g-tools-body">
        {fires && (
          <div className="g-fire-row" role="radiogroup" aria-label={g.fireButton}>
            <span className="g-block-title" aria-hidden="true">
              {g.fireButton}
            </span>
            {choices.map(([slot, text]) => (
              <button
                key={String(slot)}
                type="button"
                role="radio"
                aria-checked={fire === slot}
                className={`chip${fire === slot ? ' is-selected' : ''}`}
                disabled={locked}
                onClick={() => onFire(slot)}
              >
                {text}
              </button>
            ))}
          </div>
        )}
        {fires && <p className="g-fire-note dim">{g.fireNote}</p>}
        <div className="g-tools-grid">
          {aims && (
            <div
              className="pad pad-facing"
              role="radiogroup"
              aria-label={g.facingTitle}
              data-testid="facing-picker"
              data-facing={instance.rotationQuarterTurns}
            >
              <span className="pad-title" aria-hidden="true">
                {g.facingTitle}
              </span>
              {COMPASS.map(([turn, arrow]) => {
                const on = instance.rotationQuarterTurns === turn;
                const off = !allowed.includes(turn);
                return (
                  <button
                    key={turn}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-disabled={off || locked}
                    aria-label={g.faceTo[turn]}
                    title={g.faceTo[turn]}
                    className={`btn btn-small btn-square pad-${arrow}${on ? ' is-on' : ''}`}
                    data-testid={`face-${turn}`}
                    onClick={() => {
                      if (!locked) onFace(turn);
                    }}
                  >
                    <Glyph name={arrow} size={12} />
                  </button>
                );
              })}
              <span className="pad-mid pad-car" aria-hidden="true">
                <Glyph name="chassis" size={24} />
              </span>
            </div>
          )}
          <div className="pad pad-move" role="group" aria-label={g.offset}>
            <span className="pad-title" aria-hidden="true">
              {g.offset}
            </span>
            {nudges.map(([where, arrow, dx, dy, label]) => (
              <button
                key={where}
                type="button"
                className={`btn btn-small btn-square pad-${where}`}
                onClick={() => onNudge(dx, dy)}
                disabled={locked || !movable}
                aria-label={label}
              >
                <Glyph name={arrow} size={12} />
              </button>
            ))}
            <span className="pad-mid" title={g.offset}>
              <span className="visually-hidden">{g.offset}: </span>
              <span data-testid="part-offset">
                {instance.offsetX}, {instance.offsetY}
              </span>
            </span>
          </div>
          <div className="g-tools-actions">
            <button
              type="button"
              className="btn btn-small"
              onClick={onReplace}
              disabled={locked}
              data-testid="replace"
            >
              {g.replace}
            </button>
            <button
              type="button"
              className="btn btn-small g-remove"
              onClick={onRemove}
              disabled={locked}
              data-testid="remove"
              aria-label={fill(g.removeRefund, { price: def.price })}
            >
              <span className="g-remove-word">
                <Glyph name="trash" size={12} />
                <span>{g.remove}</span>
              </span>
              <span className="credits" data-testid="remove-refund">
                +{def.price}
              </span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
