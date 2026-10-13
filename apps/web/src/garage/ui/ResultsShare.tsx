import { STRINGS } from '@bolt/content';
import { useState } from 'react';
import { useApp } from '../../app/store.js';
import { Glyph } from '../../components/Glyph.js';
import { useCodeUi } from '../codeStore.js';
import { ensureSaved, savedEntryFor } from '../shareFlow.js';
import { useLibrary } from '../libraryStore.js';

/**
 * `Save This Car` and `Share Blueprint` on the results screen (Section 5.11), for the car that
 * was just raced. A small self-contained component so the results screen only has to place it
 * between `Change My Build` and `Back Home`. Saving is local and instant; sharing saves first,
 * then opens the share sheet, which asks the server for the code.
 */
export function ResultsShare() {
  const c = STRINGS.codes;
  const blueprint = useApp((s) => s.blueprint);
  // Subscribed to the library, so a car saved anywhere else shows as saved here too.
  const saved = useLibrary(() => savedEntryFor(blueprint));
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const save = () => {
    const result = ensureSaved(blueprint);
    setMessage(
      result.ok
        ? { ok: true, text: result.added ? c.saved : c.alreadySaved }
        : { ok: false, text: result.text },
    );
  };

  const share = () => {
    const result = ensureSaved(blueprint);
    if (!result.ok) {
      setMessage({ ok: false, text: result.text });
      return;
    }
    useCodeUi.getState().openShare(result.entry.id);
  };

  return (
    <>
      <button
        className="btn results-glyph-btn"
        onClick={save}
        aria-describedby="results-share-status"
        data-testid="results-save"
        data-saved={saved !== undefined}
      >
        {saved && <Glyph name="check" size={24} />}
        <span>{c.saveCar}</span>
      </button>
      <button className="btn" onClick={share} data-testid="results-share">
        <span>{c.shareCar}</span>
      </button>
      <span
        id="results-share-status"
        // Success shows on the button itself (the check); only a problem takes visible room.
        className={message?.ok === false ? 'results-share-status' : 'visually-hidden'}
        role="status"
        aria-live="polite"
        data-tone={message?.ok === false ? 'warn' : 'ok'}
      >
        {message?.text ?? ''}
      </span>
    </>
  );
}
