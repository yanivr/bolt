import type { ReactNode } from 'react';
import { useRef } from 'react';
import { uiSound } from '../game/audio/index.js';

type Props = {
  onPress: () => void;
  label: string;
  className?: string;
  /** A tooltip, which is also the button's accessible description. */
  title?: string;
  children: ReactNode;
};

/**
 * A HUD control that works while another finger is steering. Browsers only synthesize `click`
 * for the primary touch, so a button pressed by a second finger would never fire. This one
 * acts on its own pointer's release instead, and keeps `click` only for keyboard activation.
 * It is for menu controls. Weapon and equipment buttons act on the press and hold, and are
 * `FireButton`.
 */
export function HudButton({ onPress, label, className, title, children }: Props) {
  const active = useRef<number | null>(null);
  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      title={title}
      onPointerDown={(event) => {
        active.current = event.pointerId;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        uiSound('tap');
      }}
      onPointerUp={(event) => {
        if (active.current !== event.pointerId) return;
        active.current = null;
        const rect = event.currentTarget.getBoundingClientRect();
        // Sliding off the button before lifting cancels the press.
        const inside =
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom;
        if (inside) onPress();
      }}
      onPointerCancel={() => {
        active.current = null;
      }}
      onClick={(event) => {
        // detail is 0 for keyboard activation; pointer presses were handled above.
        if (event.detail === 0) onPress();
      }}
    >
      {children}
    </button>
  );
}
