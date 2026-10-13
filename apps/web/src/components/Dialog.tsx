import type { ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';

type Props = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** `alertdialog` for confirmations of destructive actions. */
  role?: 'dialog' | 'alertdialog';
  className?: string;
  /** Hides the visible heading when the content has its own. */
  hideTitle?: boolean;
  /** Header content beside the title, such as tabs. The close button is added by the caller. */
  head?: ReactNode;
};

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * A modal panel in the shared visual language. Escape closes it, focus moves inside when it
 * opens, Tab stays inside while it is open, and focus returns to whatever opened it.
 */
export function Dialog({
  title,
  onClose,
  children,
  role = 'dialog',
  className,
  hideTitle,
  head,
}: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const node = panel.current;
    if (node && !node.contains(document.activeElement)) {
      const first =
        node.querySelector<HTMLElement>('[data-autofocus]') ??
        node.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? node).focus({ preventScroll: true });
    }
    const onKey = (event: KeyboardEvent) => {
      // With dialogs stacked (a share sheet over My Blueprints), only the top one answers.
      const panels = document.querySelectorAll('.dialog-panel');
      if (node && panels.length > 1 && panels[panels.length - 1] !== node) return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        event.preventDefault();
        close.current();
        return;
      }
      if (event.key !== 'Tab' || !node) return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null,
      );
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div
      className="overlay"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        className={className ? `panel dialog-panel ${className}` : 'panel dialog-panel'}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className={hideTitle && !head ? 'visually-hidden' : 'dialog-head'}>
          <h2 id={titleId} className={hideTitle ? 'visually-hidden' : undefined}>
            {title}
          </h2>
          {head}
        </header>
        {children}
      </div>
    </div>
  );
}
