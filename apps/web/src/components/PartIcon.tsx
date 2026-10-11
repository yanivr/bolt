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
  const sheet =
    [...sheets]
      .filter((s) => Object.prototype.hasOwnProperty.call(s.index, partId))
      .sort((a, b) => b.size - a.size)[0] ?? null;
  if (manifests && sheet) {
    const index = sheet.index[partId] ?? 0;
    // Whole-number zoom keeps the pixels square.
    const zoom = Math.max(1, Math.floor(size / sheet.size));
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
