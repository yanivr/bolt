import { STRINGS } from '@bolt/content';
import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../../components/Dialog.js';
import { Glyph } from '../../components/Glyph.js';
import { useLibrary } from '../libraryStore.js';
import { canNativeShare, codeForEntry, copyText, nativeShare, shareLink } from '../shareFlow.js';

type Props = { entryId: string; onClose: () => void };

type State =
  { phase: 'making' } | { phase: 'ready'; code: string } | { phase: 'failed'; text: string };

/**
 * The share sheet (Sections 5.11 and 5.12): the code large in a mono face, `Copy Code`,
 * `Copy Link`, and `Share` where the system share sheet exists. The card is already saved
 * locally; a failure here never touches it.
 */
export function ShareSheet({ entryId, onClose }: Props) {
  const c = STRINGS.codes;
  const name = useLibrary((s) => s.entries.find((e) => e.id === entryId)?.blueprint.name ?? '');
  const [state, setState] = useState<State>({ phase: 'making' });
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const codeText = useRef<HTMLParagraphElement>(null);
  const attempt = useRef(0);

  const make = () => {
    const ticket = ++attempt.current;
    setState({ phase: 'making' });
    setNote(null);
    void codeForEntry(entryId).then((outcome) => {
      if (ticket !== attempt.current) return;
      setState(
        outcome.ok
          ? { phase: 'ready', code: outcome.code }
          : { phase: 'failed', text: outcome.text },
      );
    });
  };
  useEffect(make, [entryId]);

  const selectCode = () => {
    const node = codeText.current;
    const selection = window.getSelection();
    if (!node || !selection) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const copy = async (text: string, done: string) => {
    const ok = await copyText(text);
    if (!ok) selectCode();
    setNote({ ok, text: ok ? done : c.copyFailed });
  };

  return (
    <Dialog title={c.shareTitle} onClose={onClose} className="dialog share-sheet">
      <p className="share-car">{name}</p>
      {state.phase === 'making' && (
        <p className="share-code is-pending" aria-busy="true" data-testid="share-code">
          {c.making}
        </p>
      )}
      {state.phase === 'failed' && (
        <>
          <p className="share-fail" role="alert" data-testid="share-failed">
            <Glyph name="warn" size={12} />
            {state.text}
          </p>
          <div className="dialog-actions">
            <button className="btn btn-primary" onClick={make} data-autofocus>
              {c.retry}
            </button>
            <button className="btn" onClick={onClose}>
              {c.close}
            </button>
          </div>
        </>
      )}
      {state.phase === 'ready' && (
        <>
          <p
            ref={codeText}
            className="share-code"
            data-testid="share-code"
            aria-label={state.code.split('').join(' ')}
          >
            {state.code}
          </p>
          <div className="dialog-actions share-actions">
            <button
              className="btn btn-primary"
              onClick={() => void copy(state.code, c.copied)}
              data-autofocus
            >
              <Glyph name="copy" size={24} />
              <span>{c.copyCode}</span>
            </button>
            <button className="btn" onClick={() => void copy(shareLink(state.code), c.linkCopied)}>
              {c.copyLink}
            </button>
            {canNativeShare() && (
              <button
                className="btn"
                onClick={() =>
                  void nativeShare(state.code).then((outcome) => {
                    if (outcome === 'failed') void copy(shareLink(state.code), c.linkCopied);
                  })
                }
              >
                <Glyph name="share" size={24} />
                <span>{c.share}</span>
              </button>
            )}
            <button className="btn" onClick={onClose}>
              {c.close}
            </button>
          </div>
          <p
            className={`share-note${note ? (note.ok ? ' tone-ok' : ' tone-warn') : ''}`}
            role="status"
            aria-live="polite"
            data-testid="share-status"
          >
            {note && <Glyph name={note.ok ? 'check' : 'warn'} size={12} />}
            {note?.text ?? c.shareNote}
          </p>
        </>
      )}
    </Dialog>
  );
}
