import { useEffect, useState } from 'react';

export type Viewport = { width: number; height: number };

/** The layout viewport in CSS pixels, kept current through rotations and resizes. */
export function useViewport(): Viewport {
  const [size, setSize] = useState<Viewport>(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  useEffect(() => {
    const update = () =>
      setSize((old) =>
        old.width === window.innerWidth && old.height === window.innerHeight
          ? old
          : { width: window.innerWidth, height: window.innerHeight },
      );
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);
  return size;
}
