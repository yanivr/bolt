import { useEffect, useRef } from 'react';
import { GLYPH_HEIGHT, glyphRows, glyphSpan, measurePixelText } from './pixelFont.js';

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
  /** Punctuation gives up its empty columns: for clocks and scores where width is short. */
  tight?: boolean;
  /** What a screen reader is told, when that is more than the text drawn. */
  label?: string;
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
  tight = false,
  label,
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const pad = shadow ? 1 : 0;
  const width = Math.max(1, measurePixelText(text, tight) + pad);
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
        const [start, span] = glyphSpan(char, tight);
        for (let r = 0; r < GLYPH_HEIGHT; r++) {
          const row = rows[r]!;
          for (let c = 0; c < span; c++)
            if (row[start + c] === '#') ctx.fillRect(x + c, oy + r, 1, 1);
        }
        x += span + 1;
      }
    };
    if (shadow) paint(shadow, 1, 1);
    paint(color, 0, 0);
  }, [text, color, shadow, tight]);

  return (
    <canvas
      ref={ref}
      className={className ? `pixel-text ${className}` : 'pixel-text'}
      width={width}
      height={height}
      style={{ width: width * scale, height: height * scale }}
      role={decorative ? 'presentation' : 'img'}
      aria-label={decorative ? undefined : (label ?? text)}
      aria-hidden={decorative ? true : undefined}
    />
  );
}
