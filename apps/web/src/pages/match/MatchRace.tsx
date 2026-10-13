import { STRINGS } from '@bolt/content';
import type { RematchChoice } from '@bolt/shared';
import { activeMatch, useMatch } from '../../network/matchClient.js';
import { useSecondsUntil } from './parts.js';

/**
 * What a friend race shows on top of the race view (Sections 3.3, 5.10 and 5.14): this
 * player's own reconnection with the time left, the rival's dropped connection while the
 * autopilot drives their car, and the wait for the rival to load the track.
 */
export function MatchRaceNotices() {
  const status = useMatch((s) => s.status);
  const reconnectEndsAt = useMatch((s) => s.reconnectEndsAt);
  const phase = useMatch((s) => s.phase);
  const rival = useMatch((s) => (s.seat >= 0 ? s.seats[s.seat === 0 ? 1 : 0] : null));
  const mine = useMatch((s) => (s.seat >= 0 ? s.seats[s.seat] : null));
  const ownLeft = useSecondsUntil(status === 'reconnecting' ? reconnectEndsAt : 0);
  const racing = phase === 'COUNTDOWN' || phase === 'RACING' || phase === 'VS_REVEAL';
  const rivalAway = racing && rival?.present === true && !rival.connected;
  const rivalLeft = useSecondsUntil(rivalAway ? rival.graceEndsAt : 0);
  const m = STRINGS.match;

  if (status === 'reconnecting')
    return (
      <div className="overlay" role="alert" data-testid="match-reconnecting">
        <div className="panel dialog">
          <p>{STRINGS.connection.lost}</p>
          <p className="dim">{m.reconnecting.replace('{seconds}', String(ownLeft))}</p>
        </div>
      </div>
    );
  if (rivalAway)
    return (
      <p className="match-banner is-warn" role="status" data-testid="rival-away">
        {m.rivalAutopilot.replace('{seconds}', String(rivalLeft))}
      </p>
    );
  if (phase === 'VS_REVEAL' && mine?.loaded && rival && !rival.loaded)
    return (
      <p className="match-banner" role="status" data-testid="rival-loading">
        {m.loadingRival}
      </p>
    );
  return null;
}

/**
 * The results actions of a friend race (Section 5.11): nothing starts without both players.
 * `Race Again` keeps both cars (on swapped sides), `Swap Cars` trades them, `Change My Build`
 * opens a new build phase for both. A vote can be taken back. If the rival has gone, the
 * player can open the lobby again for someone new with the same code.
 */
export function MatchResultsActions({ onHome }: { onHome: () => void }) {
  const seat = useMatch((s) => s.seat);
  const seats = useMatch((s) => s.seats);
  const m = STRINGS.match;
  const me = seat >= 0 ? seats[seat] : null;
  const rival = seat >= 0 ? seats[seat === 0 ? 1 : 0] : null;
  const client = activeMatch();
  const vote = (choice: RematchChoice) => client?.vote(me?.vote === choice ? 'none' : choice);
  const rivalHere = rival?.present === true;
  const asVote = (v: string | undefined): 'race' | 'swap' | 'build' | '' =>
    v === 'race' || v === 'swap' || v === 'build' ? v : '';
  const myVote = asVote(me?.vote);
  const theirVote = rivalHere ? asVote(rival?.vote) : '';

  const line = !rivalHere
    ? m.rivalGone
    : myVote
      ? m.votes.you[myVote]
      : theirVote
        ? m.votes.rival[theirVote]
        : '';

  return (
    <div className="match-results-actions" data-testid="match-results-actions">
      {line && (
        <p className="match-vote-line" role="status" data-testid="vote-line">
          {line}
        </p>
      )}
      <div className="dialog-actions results-actions">
        {rivalHere ? (
          <>
            <button
              className={`btn btn-primary${myVote === 'race' ? ' is-on' : ''}${theirVote === 'race' ? ' is-asked' : ''}`}
              aria-pressed={myVote === 'race'}
              onClick={() => vote('race')}
              data-testid="vote-race"
            >
              {myVote === 'race' ? m.cancelVote : m.raceAgain}
            </button>
            <button
              className={`btn${myVote === 'swap' ? ' is-on' : ''}${theirVote === 'swap' ? ' is-asked' : ''}`}
              aria-pressed={myVote === 'swap'}
              onClick={() => vote('swap')}
              data-testid="vote-swap"
            >
              {myVote === 'swap' ? m.cancelVote : m.swapCars}
            </button>
            <button
              className={`btn${myVote === 'build' ? ' is-on' : ''}${theirVote === 'build' ? ' is-asked' : ''}`}
              aria-pressed={myVote === 'build'}
              onClick={() => vote('build')}
              data-testid="vote-build"
            >
              {myVote === 'build' ? m.cancelVote : m.changeBuild}
            </button>
          </>
        ) : (
          <button className="btn btn-primary" onClick={() => client?.reopen()} data-testid="reopen">
            {m.newRival}
          </button>
        )}
        <button className="btn" onClick={onHome} data-testid="match-home">
          {m.backHome}
        </button>
      </div>
    </div>
  );
}
