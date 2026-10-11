import type { GlyphName } from './glyphs.js';
import { glyphPath } from './glyphs.js';

type Props = {
  name: GlyphName;
  /** CSS pixels. Multiples of 12 keep every cell a whole number of pixels. */
  size?: number;
  className?: string;
};

/** A pixel icon. Always decorative: the control it sits in carries the name. */
export function Glyph({ name, size = 24, className }: Props) {
  return (
    <svg
      className={className ? `glyph ${className}` : 'glyph'}
      viewBox="0 0 12 12"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d={glyphPath(name)} />
    </svg>
  );
}
