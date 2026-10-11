import type { PartCategory } from '@bolt/shared';
import type { CSSProperties, KeyboardEvent } from 'react';
import { Glyph } from '../../components/Glyph.js';
import type { GlyphName } from '../../components/glyphs.js';
import { PartIcon } from '../../components/PartIcon.js';
import type { GameManifests } from '../../game/assets.js';

export type StepMark = { number: number; done: boolean; label: string };

type Props = {
  manifests: GameManifests;
  /** `chassis`, `engine`, `tires` or `mount:<id>`. */
  slotKey: string;
  /** The few letters under the icon, or the category above the name. */
  label: string;
  /**
   * The item's name. A tile that has one is laid out as the category small on top and the
   * icon and the name on one line under it, the name cut with an ellipsis and never wrapped.
   */
  name?: string;
  ariaLabel: string;
  /** What the slot holds. Null for an empty mount. */
  part: { id: string; category: PartCategory } | null;
  /** The glyph of an empty mount: where it is on the car, or what it takes. */
  glyph: GlyphName;
  /** How many parts share the mount, when more than one. */
  count?: number;
  instanceId?: string | null;
  mountId?: string;
  selected: boolean;
  bad?: boolean;
  /** The focused card would be installed here. */
  target?: boolean;
  step?: StepMark | undefined;
  disabled?: boolean;
  style?: CSSProperties;
  onPress: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
};

/**
 * One slot of the car as a touch target. An accessory mount beside the car is the icon of
 * what it holds (or a plus on its category glyph when empty) over a short label. The chassis,
 * engine and wheels under the car carry their category and the item's name.
 */
export function SlotTile({
  manifests,
  slotKey,
  label,
  name,
  ariaLabel,
  part,
  glyph,
  count = 0,
  instanceId = null,
  mountId,
  selected,
  bad = false,
  target = false,
  step,
  disabled = false,
  style,
  onPress,
  onKeyDown,
}: Props) {
  const classes = [
    'slot-tile',
    part ? 'is-filled' : 'is-empty',
    selected ? 'is-selected' : '',
    bad ? 'is-bad' : '',
    target ? 'is-target' : '',
    step && !step.done ? 'is-step' : '',
    name !== undefined ? 'has-name' : '',
  ];
  return (
    <button
      type="button"
      className={classes.filter(Boolean).join(' ')}
      style={style}
      aria-pressed={selected}
      aria-label={ariaLabel}
      data-slot={slotKey}
      data-mount={mountId}
      data-part={part?.id}
      data-instance={instanceId ?? undefined}
      data-bad={bad ? 'true' : undefined}
      disabled={disabled}
      onClick={onPress}
      onKeyDown={onKeyDown}
    >
      {name !== undefined ? (
        <>
          <span className="slot-label">{label}</span>
          <span className="slot-line">
            <span className="slot-art">
              {part && (
                <PartIcon
                  manifests={manifests}
                  partId={part.id}
                  category={part.category}
                  size={24}
                />
              )}
            </span>
            <span className="slot-name">{name}</span>
          </span>
        </>
      ) : (
        <>
          <span className="slot-art">
            {part ? (
              <PartIcon manifests={manifests} partId={part.id} category={part.category} size={32} />
            ) : (
              <>
                <Glyph name={glyph} size={24} />
                <span className="slot-plus">
                  <Glyph name="plus" size={12} />
                </span>
              </>
            )}
          </span>
          <span className="slot-text">
            <span className="slot-label">{label}</span>
          </span>
        </>
      )}
      {count > 1 && <span className="slot-count">{count}</span>}
      {bad && (
        <span className="slot-alert">
          <Glyph name="warn" size={12} />
        </span>
      )}
      {step && (
        <span className={`g-step${step.done ? ' is-done' : ''}`}>
          {step.done ? <Glyph name="check" size={12} /> : step.number}
          <span className="visually-hidden">{step.label}</span>
        </span>
      )}
    </button>
  );
}
