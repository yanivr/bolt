import { STRINGS } from '@bolt/content';
import { useEffect } from 'react';
import { useApp } from '../app/store.js';
import { PrivacyView } from '../components/PrivacyView.js';

/** The privacy page as a screen of its own, at `/privacy` (Section 5.14 footer link). */
export function PrivacyScreen() {
  const setScreen = useApp((s) => s.setScreen);
  const leave = () => {
    try {
      if (window.location.pathname === '/privacy') window.history.replaceState(null, '', '/');
    } catch {
      // The address stays; the screen still changes.
    }
    setScreen('home');
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('[role="alertdialog"]')) leave();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <main className="screen privacy-screen" aria-label={STRINGS.privacy.title}>
      <PrivacyView onClose={leave} />
    </main>
  );
}

/** True when the page was opened at `/privacy`. */
export function openedAtPrivacy(): boolean {
  try {
    return window.location.pathname === '/privacy';
  } catch {
    return false;
  }
}
