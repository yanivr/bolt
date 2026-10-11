import type { PartCategory } from '@bolt/shared';
import type { GameManifests } from '../game/assets.js';
import { Glyph } from './Glyph.js';

type Props = {
  manifests: GameManifests | null;
  partId: string;
  category: PartCategory;
  /** CSS pixels. */
  size?: number;
};

/**
 * A part's catalog icon. Parts the artists have drawn come from the icon sheet in the car
 * atlas manifest; the rest get their category glyph on a plain tile. There is never an image
 * element that could show as broken: the sheet is a CSS background.
 */
export function PartIcon({ manifests, partId, category, size = 40 }: Props) {
  const sheets = manifests?.cars.icons ?? [];
  // The largest sheet that fits the box at its own size; a box smaller than every sheet takes
  // the smallest, so a 24 pixel icon is the 24 pixel drawing and never a cropped 32.
  const drawn = [...sheets]
    .filter((s) => Object.prototype.hasOwnProperty.call(s.index, partId))
    .sort((a, b) => b.size - a.size);
  const sheet = drawn.find((s) => s.size <= size) ?? drawn[drawn.length - 1] ?? null;
  if (manifests && sheet) {
    const index = sheet.index[partId] ?? 0;
    // Whole and half steps: one and a half is exact on a 2x screen and all but exact on a 3x
    // one, and it lets a 32 pixel icon fill a 48 pixel row.
    const zoom = Math.max(1, Math.floor((size / sheet.size) * 2) / 2);
    const cell = sheet.size * zoom;
    return (
      <span
        className={`part-icon part-icon-${category}`}
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        <span
          className="part-icon-art"
          style={{
            width: cell,
            height: cell,
            backgroundImage: `url("${manifests.carsBase}/${sheet.file}")`,
            backgroundSize: `${sheet.columns * cell}px auto`,
            backgroundPosition: `-${(index % sheet.columns) * cell}px -${Math.floor(index / sheet.columns) * cell}px`,
          }}
        />
      </span>
    );
  }
  return (
    <span
      className={`part-icon part-icon-${category} is-glyph`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <Glyph name={category} size={Math.max(12, Math.floor((size * 0.6) / 12) * 12)} />
    </span>
  );
}
