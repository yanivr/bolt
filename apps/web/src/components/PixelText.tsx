import { useEffect, useRef } from 'react';
import { GLYPH_HEIGHT, GLYPH_WIDTH, glyphRows, measurePixelText } from './pixelFont.js';

type Props = {
  text: string;
  /** CSS pixels per font cell. */
  scale?: number;
  color?: string;
  /** Optional one-cell drop shadow, for legibility over the track. */
  shadow?: string;
  className?: string;
  /** Screen readers get the plain string. Decorative uses can hide it. */
  decorative?: boolean;
};

/**
 * Draws a short headline in the BOLT 5x7 face on a canvas sized in whole cells and scaled with
 * nearest-neighbor, so every pixel stays square at any device pixel ratio.
 */
export function PixelText({
  text,
  scale = 2,
  color = '#F5EED9',
  shadow,
  className,
  decorative,
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const pad = shadow ? 1 : 0;
  const width = Math.max(1, measurePixelText(text) + pad);
  const height = GLYPH_HEIGHT + pad;

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const paint = (fill: string, ox: number, oy: number) => {
      ctx.fillStyle = fill;
      let x = ox;
      for (const char of text) {
        const rows = glyphRows(char);
        for (let r = 0; r < GLYPH_HEIGHT; r++) {
          const row = rows[r]!;
          for (let c = 0; c < GLYPH_WIDTH; c++)
            if (row[c] === '#') ctx.fillRect(x + c, oy + r, 1, 1);
        }
        x += GLYPH_WIDTH + 1;
      }
    };
    if (shadow) paint(shadow, 1, 1);
    paint(color, 0, 0);
  }, [text, color, shadow]);

  return (
    <canvas
      ref={ref}
      className={className ? `pixel-text ${className}` : 'pixel-text'}
      width={width}
      height={height}
      style={{ width: width * scale, height: height * scale }}
      role={decorative ? 'presentation' : 'img'}
      aria-label={decorative ? undefined : text}
      aria-hidden={decorative ? true : undefined}
    />
  );
}
