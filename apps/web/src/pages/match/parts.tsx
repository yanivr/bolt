import { STRINGS } from '@bolt/content';
import { NICKNAMES, latencyQuality } from '@bolt/shared';
import { useEffect, useState } from 'react';
import { Glyph } from '../../components/Glyph.js';
import type { GlyphName } from '../../components/glyphs.js';
import type { SeatInfo } from '../../network/matchClient.js';

/** The eight preset emblems (Section 3.2: profile emblems), drawn with the game's own glyphs. */
export const EMBLEM_GLYPHS: readonly GlyphName[] = [
  'bolt',
  'flame',
  'star',
  'wrench',
  'flag',
  'sun',
  'moon',
  'engine',
];

export function nicknameOf(index: number): string {
  return NICKNAMES[index] ?? NICKNAMES[0];
}

/** Seconds left until a local-clock time, ticking. */
export function useSecondsUntil(at: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (at <= 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [at]);
  return at > 0 ? Math.max(0, Math.ceil((at - now) / 1000)) : 0;
}

/** The connection quality badge of Section 3.2, from a round trip. */
export function QualityBadge({ rttMs, testId }: { rttMs: number; testId?: string }) {
  const quality = latencyQuality(rttMs);
  return (
    <span className={`net-quality is-${quality}`} data-testid={testId} data-quality={quality}>
      <span className="net-bars" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>{STRINGS.match.quality[quality]}</span>
    </span>
  );
}

/**
 * One slot of the lobby's two-slot podium: the player's preset emblem and nickname, who hosts,
 * how the connection is, or the waiting line for an empty seat.
 */
export function SeatCard({
  seat,
  mine,
  side,
  rttMs,
  onRename,
}: {
  seat: SeatInfo;
  mine: boolean;
  side: 'you' | 'rival';
  rttMs: number;
  onRename?: () => void;
}) {
  const m = STRINGS.match;
  const away = useSecondsUntil(seat.present && !seat.connected ? seat.graceEndsAt : 0);
  if (!seat.present)
    return (
      <div className={`panel seat-card is-${side} is-empty`} data-testid={`seat-${side}`}>
        <span className="seat-emblem" aria-hidden="true">
          <Glyph name="empty" size={36} />
        </span>
        <span className="seat-name">{m.emptySeat}</span>
        <span className="seat-line waiting-dots">{m.waiting}</span>
      </div>
    );
  const name = nicknameOf(seat.nickname);
  return (
    <div
      className={`panel seat-card is-${side}${seat.connected ? '' : ' is-away'}`}
      data-testid={`seat-${side}`}
      data-connected={seat.connected}
    >
      <span className="seat-emblem" aria-hidden="true">
        <Glyph name={EMBLEM_GLYPHS[seat.emblem] ?? 'bolt'} size={36} />
      </span>
      {mine && onRename ? (
        <button className="seat-name seat-rename" onClick={onRename} aria-label={m.changeName}>
          {name}
        </button>
      ) : (
        <span className="seat-name">{name}</span>
      )}
      <span className="seat-tags">
        <span className="seat-tag">{mine ? m.you : m.rival}</span>
        {seat.host && <span className="seat-tag is-host">{m.host}</span>}
      </span>
      {seat.connected ? (
        <QualityBadge rttMs={mine ? rttMs : seat.latencyMs} testId={`quality-${side}`} />
      ) : (
        <span className="seat-line is-warn">
          {STRINGS.match.seatAway.replace('{seconds}', String(away))}
        </span>
      )}
    </div>
  );
}

/** A confirmation before leaving the match, with the action named on both buttons. */
export function LeaveConfirm({
  text,
  leaveLabel,
  onLeave,
  onStay,
}: {
  text: string;
  leaveLabel: string;
  onLeave: () => void;
  onStay: () => void;
}) {
  return (
    <div className="overlay" role="alertdialog" aria-modal="true">
      <div className="panel dialog">
        <p>{text}</p>
        <div className="dialog-actions">
          <button className="btn btn-danger" onClick={onLeave}>
            {leaveLabel}
          </button>
          <button className="btn btn-primary" onClick={onStay} autoFocus>
            {STRINGS.match.stay}
          </button>
        </div>
      </div>
    </div>
  );
}
