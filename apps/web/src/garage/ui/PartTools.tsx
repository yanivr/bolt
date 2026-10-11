import { STRINGS, partCard } from '@bolt/content';
import type { PlacedPart } from '@bolt/shared';
import { allowedRotations, takesFireButton } from '@bolt/shared';
import { Glyph } from '../../components/Glyph.js';
import { PartIcon } from '../../components/PartIcon.js';
import type { GameManifests } from '../../game/assets.js';
import type { FireChoice } from '../buildSession.js';
import { fill, mountName } from '../text.js';
import { FactRow, partFacts } from './partFacts.js';

type Props = {
  manifests: GameManifests;
  part: PlacedPart;
  locked: boolean;
  /** Starts replacing this part: the list shows what else fits its mount. */
  onReplace: () => void;
  onNudge: (dx: number, dy: number) => void;
  onRotate: () => void;
  onFire: (slot: FireChoice) => void;
  onRemove: () => void;
};

/**
 * Tools for the installed part that is selected on the car: nudge it inside its mount's
 * region in grid steps, turn it, give it a fire button, or sell it back. The same moves are
 * on the car itself (drag) and on the keyboard (arrow keys, R, Delete).
 */
export function PartTools({
  manifests,
  part,
  locked,
  onReplace,
  onNudge,
  onRotate,
  onFire,
  onRemove,
}: Props) {
  const g = STRINGS.garage;
  const { def, instance, mount } = part;
  const card = partCard(def);
  const canTurn = allowedRotations(mount, def).length > 1;
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

  return (
    <section className="g-tools" aria-label={g.selectedPart} data-instance={instance.instanceId}>
      <header className="g-pane-head">
        <PartIcon manifests={manifests} partId={def.id} category={def.category} size={36} />
        <div className="g-tools-title">
          <h2>{def.displayName}</h2>
          <span className="dim">{mountName(mount.id)}</span>
        </div>
        <span className="g-pane-spacer" />
        <button className="btn btn-small" onClick={onReplace} disabled={locked}>
          {g.replace}
        </button>
        <button
          className="btn btn-small g-remove"
          onClick={onRemove}
          disabled={locked}
          data-testid="remove"
          aria-label={fill(g.removeRefund, { price: def.price })}
        >
          <Glyph name="trash" size={12} />
          <span>{g.remove}</span>
          <span className="credits">+{def.price}</span>
        </button>
      </header>
      <div className="g-pane-body g-tools-body">
        <div className="g-tools-move">
          <div className="dpad" role="group" aria-label={g.move}>
            <button
              className="btn btn-small btn-square dpad-up"
              onClick={() => onNudge(0, -1)}
              disabled={locked || !movable}
              aria-label={g.moveUp}
            >
              <Glyph name="up" size={12} />
            </button>
            <button
              className="btn btn-small btn-square dpad-left"
              onClick={() => onNudge(-1, 0)}
              disabled={locked || !movable}
              aria-label={g.moveLeft}
            >
              <Glyph name="left" size={12} />
            </button>
            <span className="dpad-mid" data-testid="part-offset">
              {instance.offsetX}, {instance.offsetY}
            </span>
            <button
              className="btn btn-small btn-square dpad-right"
              onClick={() => onNudge(1, 0)}
              disabled={locked || !movable}
              aria-label={g.moveRight}
            >
              <Glyph name="right" size={12} />
            </button>
            <button
              className="btn btn-small btn-square dpad-down"
              onClick={() => onNudge(0, 1)}
              disabled={locked || !movable}
              aria-label={g.moveDown}
            >
              <Glyph name="down" size={12} />
            </button>
          </div>
        </div>
        <div className="g-tools-side">
          <div className="g-turn-row">
            <button
              className="btn btn-small g-turn"
              onClick={onRotate}
              disabled={locked || !canTurn}
              data-testid="rotate-part"
            >
              <Glyph name="rotate" size={12} />
              <span>{g.rotatePart}</span>
            </button>
            <span className="dim" data-testid="part-facing">
              {g.facing[instance.rotationQuarterTurns]}
            </span>
          </div>
          {fires && (
            <div className="g-fire" role="radiogroup" aria-label={g.fireButton}>
              <span className="g-block-title">{g.fireButton}</span>
              <div className="chips">
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
            </div>
          )}
        </div>
        <div className="g-tools-facts">
          <FactRow facts={partFacts(def, card)} />
          {fires && <p className="dim">{g.fireNote}</p>}
          <p className="dim">{g.dragHint}</p>
        </div>
      </div>
    </section>
  );
}
