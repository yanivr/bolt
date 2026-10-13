import { STRINGS } from '@bolt/content';
import {
  EMBLEM_COUNT,
  MATCH_CODE_LENGTH,
  NICKNAMES,
  matchCodeIssue,
  normalizeMatchCode,
} from '@bolt/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../app/store.js';
import { Glyph } from '../components/Glyph.js';
import { PixelText } from '../components/PixelText.js';
import { takeInviteCode } from '../network/invite.js';
import type { MatchFailure } from '../network/matchClient.js';
import { MatchClient, MatchJoinError, loadProfile } from '../network/matchClient.js';

type JoinState = { kind: 'idle' } | { kind: 'joining' } | { kind: 'error'; reason: MatchFailure };

/** What the join screen says for a failure (Sections 5.4 and 5.14). */
export function joinFailureCopy(reason: MatchFailure): string {
  const m = STRINGS.match;
  switch (reason) {
    case 'expired':
      return m.expired;
    case 'full':
      return m.full;
    case 'already':
      return m.alreadyIn;
    case 'rate':
      return m.tooMany;
    case 'version':
      return STRINGS.connection.versionMismatch;
    case 'unauthorized':
      return STRINGS.connection.serverUnavailable;
    case 'build':
      return m.buildRefused;
    default:
      return STRINGS.connection.serverUnavailable;
  }
}

/**
 * Join with Code (Sections 3.2 and 5.4): a large, forgiving code field (any case, spaces and
 * dashes ignored, a pasted invite link reduced to its code), checked as it is typed, and the
 * approved messages when a code leads nowhere. Opened at `/join/<code>`, it joins at once.
 */
export function JoinScreen() {
  const setScreen = useApp((s) => s.setScreen);
  const [text, setText] = useState('');
  const [state, setState] = useState<JoinState>({ kind: 'idle' });
  const input = useRef<HTMLInputElement>(null);
  const m = STRINGS.match;
  const code = normalizeMatchCode(text);
  const issue = code.length > 0 ? matchCodeIssue(code) : 'short';
  const canPaste = typeof navigator !== 'undefined' && !!navigator.clipboard?.readText;

  const join = useCallback(
    async (raw: string) => {
      const value = normalizeMatchCode(raw);
      if (matchCodeIssue(value) !== null) return;
      setState({ kind: 'joining' });
      try {
        await MatchClient.join(
          value,
          loadProfile(NICKNAMES.length, EMBLEM_COUNT),
          useApp.getState().blueprint,
        );
        // The match director takes it from here: the lobby, then whatever the room says.
        setScreen('lobby');
      } catch (error) {
        setState({
          kind: 'error',
          reason: error instanceof MatchJoinError ? error.reason : 'server',
        });
      }
    },
    [setScreen],
  );

  // Opened at an invite link: fill it in and go.
  useEffect(() => {
    const invited = takeInviteCode();
    if (invited) {
      setText(invited);
      void join(invited);
    } else input.current?.focus();
  }, [join]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setScreen('home');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setScreen]);

  const paste = async () => {
    try {
      const clip = await navigator.clipboard.readText();
      const value = normalizeMatchCode(clip).slice(0, 12);
      setText(value);
      if (matchCodeIssue(value) === null) void join(value);
    } catch {
      input.current?.focus();
    }
  };

  const tryAnother = () => {
    setText('');
    setState({ kind: 'idle' });
    window.setTimeout(() => input.current?.focus(), 0);
  };

  const hint =
    issue === 'symbol'
      ? m.codeBadSymbol
      : code.length > 0 && issue === 'long'
        ? m.codeShort
        : m.joinPrompt;

  return (
    <main className="screen join" data-testid="join-screen">
      <section className="panel join-panel">
        <div className="join-head">
          <button className="btn btn-small join-back" onClick={() => setScreen('home')}>
            <Glyph name="back" size={12} />
            <span>{STRINGS.preview.back}</span>
          </button>
          <h1 className="join-title">
            <PixelText
              text={m.joinTitle.toUpperCase()}
              scale={3}
              color="#F5EED9"
              shadow="#0e1320"
            />
          </h1>
        </div>
        {state.kind === 'error' ? (
          <div
            className="join-error"
            role="alert"
            data-testid="join-error"
            data-reason={state.reason}
          >
            <Glyph name="warn" size={24} />
            <p>{joinFailureCopy(state.reason)}</p>
            <div className="dialog-actions">
              <button className="btn btn-primary" onClick={tryAnother} autoFocus>
                {m.tryAnotherCode}
              </button>
              <button className="btn" onClick={() => setScreen('home')}>
                {m.backHome}
              </button>
            </div>
          </div>
        ) : (
          <form
            className="join-form"
            onSubmit={(event) => {
              event.preventDefault();
              void join(text);
            }}
          >
            <label className="join-label" htmlFor="join-code">
              {m.codeInput}
            </label>
            <div className="join-row">
              <input
                id="join-code"
                ref={input}
                className={`join-input${issue === 'symbol' ? ' is-bad' : ''}`}
                data-testid="join-code"
                value={text}
                onChange={(event) => setText(event.target.value.slice(0, 64))}
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                maxLength={64}
                placeholder="K7M-Q2X"
                aria-describedby="join-hint"
                disabled={state.kind === 'joining'}
              />
              {canPaste && (
                <button type="button" className="btn join-paste" onClick={() => void paste()}>
                  <Glyph name="copy" size={12} />
                  <span>{m.paste}</span>
                </button>
              )}
            </div>
            <p
              id="join-hint"
              className={`join-hint${issue === 'symbol' ? ' is-bad' : ''}`}
              aria-live="polite"
            >
              {hint}
            </p>
            <div className="join-progress" aria-hidden="true">
              {Array.from({ length: MATCH_CODE_LENGTH }, (_, i) => (
                <span
                  key={i}
                  className={i < Math.min(code.length, MATCH_CODE_LENGTH) ? 'is-on' : ''}
                />
              ))}
            </div>
            <button
              type="submit"
              className="btn btn-primary btn-large join-go"
              disabled={issue !== null || state.kind === 'joining'}
              data-testid="join-go"
            >
              {state.kind === 'joining' ? m.joining : m.join}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
