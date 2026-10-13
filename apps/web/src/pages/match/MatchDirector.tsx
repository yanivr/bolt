import { STRINGS } from '@bolt/content';
import type { MatchPhase } from '@bolt/shared';
import { useEffect } from 'react';
import type { Screen } from '../../app/store.js';
import { useApp } from '../../app/store.js';
import { activeMatch, clearMatch, useMatch } from '../../network/matchClient.js';
import './match.css';

/** Which screen shows a match phase (Section 3.3). The server owns the phase; screens follow. */
export function screenForPhase(phase: MatchPhase): Screen | null {
  switch (phase) {
    case 'CREATED':
    case 'WAITING_FOR_OPPONENT':
      return 'lobby';
    case 'TRACK_REVEAL':
      return 'preview';
    case 'BUILDING':
      return 'garage';
    case 'VS_REVEAL':
    case 'COUNTDOWN':
    case 'RACING':
    case 'FINISHED':
    case 'RESULTS':
    case 'REMATCH_VOTE':
      return 'race';
    default:
      return null;
  }
}

/**
 * While this page is in a match, the room's phase decides the screen: both players move
 * together, and a client only ever shows what the current phase allows. When the match is
 * gone for good (the seat was given up, the room closed, the network never came back) this
 * says so and offers the way home.
 */
export function MatchDirector() {
  const active = useMatch((s) => s.active);
  const phase = useMatch((s) => s.phase);
  const status = useMatch((s) => s.status);
  const lostReason = useMatch((s) => s.lostReason);
  const setScreen = useApp((s) => s.setScreen);

  useEffect(() => {
    if (!active || status === 'lost') return;
    const target = screenForPhase(phase);
    if (target && useApp.getState().screen !== target) setScreen(target);
  }, [active, phase, status, setScreen]);

  if (!active || status !== 'lost') return null;
  const m = STRINGS.match;
  const text =
    lostReason === 'closed'
      ? m.closed
      : lostReason === 'seat'
        ? m.lost
        : STRINGS.connection.serverUnavailable;
  return (
    <div className="overlay overlay-solid match-lost" role="alert" data-testid="match-lost">
      <div className="panel dialog">
        <p>{text}</p>
        <div className="dialog-actions">
          <button
            className="btn btn-primary"
            onClick={() => {
              activeMatch()?.leave();
              clearMatch();
              setScreen('home');
            }}
            autoFocus
          >
            {m.backHome}
          </button>
        </div>
      </div>
    </div>
  );
}
