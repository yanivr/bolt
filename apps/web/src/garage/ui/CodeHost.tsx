import { STRINGS } from '@bolt/content';
import type { VehicleBlueprint } from '@bolt/shared';
import { useEffect, useRef } from 'react';
import { getManifests } from '../../app/App.js';
import { useApp } from '../../app/store.js';
import { codes } from '../codes.js';
import { useCodeUi } from '../codeStore.js';
import { garageStore, useGarage } from '../garageStore.js';
import { fill } from '../text.js';
import { LoadCodeDialog } from './LoadCodeDialog.js';
import { ShareSheet } from './ShareSheet.js';
import './codes.css';

/** The query parameter a share link lands on (`/car/<code>` redirects to `/?car=<code>`). */
export const CAR_LINK_PARAM = 'car';

/** Reads and removes `?car=` from the address, so a reload does not reopen the overlay. */
function takeLinkedCode(): string | null {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(CAR_LINK_PARAM)) return null;
    const code = url.searchParams.get(CAR_LINK_PARAM) ?? '';
    url.searchParams.delete(CAR_LINK_PARAM);
    window.history.replaceState(
      window.history.state,
      '',
      `${url.pathname}${url.search}${url.hash}`,
    );
    return code;
  } catch {
    return null;
  }
}

/**
 * Hosts the Load Code overlay and the share sheet over any screen. `Use This Build` replaces
 * the garage draft while the garage is open, and the player's car everywhere else.
 */
export function CodeHost() {
  const screen = useApp((s) => s.screen);
  const blueprint = useApp((s) => s.blueprint);
  const setBlueprint = useApp((s) => s.setBlueprint);
  const garageCar = useGarage((s) => s.session?.history.present ?? null);
  const load = useCodeUi((s) => s.load);
  const share = useCodeUi((s) => s.share);
  const linked = useRef(false);

  // A share link opens Load Code with its code once the game has booted.
  useEffect(() => {
    if (screen === 'boot' || linked.current) return;
    linked.current = true;
    // Sliding expiry: a returning guest's session is renewed once per visit, and deletions
    // made while offline are sent.
    if (codes.hasGuest()) void codes.renew().then(() => codes.flushPending());
    const code = takeLinkedCode();
    if (code !== null) useCodeUi.getState().openLoad(code);
  }, [screen]);

  const manifests = getManifests();
  if (!manifests || screen === 'boot') return null;
  const inGarage = screen === 'garage' && garageCar !== null;
  const current = inGarage ? garageCar : blueprint;

  const use = (picked: VehicleBlueprint) => {
    const message = fill(STRINGS.codes.nowUsing, { name: picked.name });
    if (inGarage) garageStore.getState().load(picked, message);
    else if (!setBlueprint(picked)) return;
    useCodeUi.getState().closeLoad();
  };

  return (
    <>
      {load && (
        <LoadCodeDialog
          manifests={manifests}
          initial={load.initial}
          current={current}
          onUse={use}
          onClose={() => useCodeUi.getState().closeLoad()}
        />
      )}
      {share && (
        <ShareSheet entryId={share.entryId} onClose={() => useCodeUi.getState().closeShare()} />
      )}
    </>
  );
}
