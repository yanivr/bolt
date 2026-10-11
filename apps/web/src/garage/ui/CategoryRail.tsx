import { PART_CATEGORIES, STRINGS } from '@bolt/content';
import type { PartCategory } from '@bolt/shared';
import { Glyph } from '../../components/Glyph.js';

type Props = {
  category: PartCategory;
  /** Categories that hold something the validator objects to. */
  flagged: ReadonlySet<PartCategory>;
  /** First-build teaching: the step number shown on a category, if any. */
  steps: Partial<Record<PartCategory, { number: number; done: boolean; label: string }>>;
  onPick: (category: PartCategory) => void;
};

/** The six-category rail. A tab list: arrow keys move between categories. */
export function CategoryRail({ category, flagged, steps, onPick }: Props) {
  return (
    <nav
      className="g-rail"
      role="tablist"
      aria-orientation="vertical"
      aria-label={STRINGS.garage.title}
    >
      {PART_CATEGORIES.map((id, index) => {
        const step = steps[id];
        return (
          <button
            key={id}
            role="tab"
            id={`g-tab-${id}`}
            aria-selected={category === id}
            aria-controls="g-parts"
            tabIndex={category === id ? 0 : -1}
            className={`g-rail-tab${category === id ? ' is-selected' : ''}${step && !step.done ? ' is-step' : ''}`}
            data-category={id}
            onClick={() => onPick(id)}
            onKeyDown={(event) => {
              const move =
                event.key === 'ArrowDown' || event.key === 'ArrowRight'
                  ? 1
                  : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
                    ? -1
                    : 0;
              if (move === 0) return;
              event.preventDefault();
              const next =
                PART_CATEGORIES[(index + move + PART_CATEGORIES.length) % PART_CATEGORIES.length]!;
              onPick(next);
              document.getElementById(`g-tab-${next}`)?.focus();
            }}
          >
            <Glyph name={id} size={24} />
            <span className="g-rail-label">{STRINGS.garage.categories[id]}</span>
            {flagged.has(id) && (
              <span className="g-rail-flag">
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
      })}
    </nav>
  );
}
