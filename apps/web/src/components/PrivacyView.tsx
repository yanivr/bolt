import { STRINGS } from '@bolt/content';
import { useEffect, useState } from 'react';
import { codes } from '../garage/codes.js';
import { useLibrary } from '../garage/libraryStore.js';
import { clearDevice, deleteEverything, restartFresh } from '../garage/privacy.js';
import { fill } from '../garage/text.js';
import { Dialog } from './Dialog.js';
import { Glyph } from './Glyph.js';

type Props = { onClose: () => void; closeLabel?: string };

type Step =
  | { kind: 'idle' }
  | { kind: 'confirm' }
  | { kind: 'deleting' }
  | { kind: 'done' }
  | { kind: 'failed'; text: string };

/** How long the confirmation stays up before the game restarts from a blank slate. */
const RESTART_MS = 1600;

/**
 * The privacy page (Sections 5.13, 15.8 and 16): what exists on this device and on the
 * server, how long each is kept, and a delete control that actually deletes. Reached from
 * Settings (`Privacy Info`) and at `/privacy`.
 */
export function PrivacyView({ onClose, closeLabel = STRINGS.privacy.back }: Props) {
  const p = STRINGS.privacy;
  const cars = useLibrary((s) => s.entries.length);
  const [serverCodes, setServerCodes] = useState<number | null | 'unknown'>(null);
  const [step, setStep] = useState<Step>({ kind: 'idle' });

  useEffect(() => {
    let live = true;
    // Only asked when this browser already has a guest: looking never creates one.
    if (!codes.hasGuest()) {
      setServerCodes(0);
      return;
    }
    void codes.listMine().then((result) => {
      if (live) setServerCodes(result.ok ? result.value.blueprints.length : 'unknown');
    });
    return () => {
      live = false;
    };
  }, []);

  const remove = async () => {
    setStep({ kind: 'deleting' });
    const outcome = await deleteEverything(codes);
    if (!outcome.ok) {
      setStep({ kind: 'failed', text: outcome.text });
      return;
    }
    setStep({ kind: 'done' });
    window.setTimeout(restartFresh, RESTART_MS);
  };

  const serverLine =
    serverCodes === null || serverCodes === 'unknown'
      ? p.countsServerUnknown
      : serverCodes === 0
        ? p.countsServerNone
        : fill(p.countsServer, { codes: serverCodes });

  return (
    <div className="privacy" data-testid="privacy">
      <header className="privacy-head">
        <h1 className="privacy-title">
          <Glyph name="privacy" size={24} />
          {p.title}
        </h1>
        <button className="btn btn-small" onClick={onClose}>
          {closeLabel}
        </button>
      </header>
      <div className="privacy-scroll" tabIndex={0}>
        <p className="privacy-intro">{p.intro}</p>
        <div className="privacy-grid">
          <section>
            <h2>{p.deviceTitle}</h2>
            <ul>
              {p.deviceItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
          <section>
            <h2>{p.serverTitle}</h2>
            <ul>
              {p.serverItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
          <section>
            <h2>{p.neverTitle}</h2>
            <ul>
              {p.neverItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
          <section className="privacy-delete" aria-labelledby="privacy-delete-title">
            <h2 id="privacy-delete-title">{p.deleteTitle}</h2>
            <p className="privacy-counts" data-testid="privacy-counts">
              <span>{fill(p.countsDevice, { cars })}</span>
              <span>{serverLine}</span>
            </p>
            <p>{p.deleteNote}</p>
            {step.kind === 'done' ? (
              <p className="privacy-status tone-ok" role="status" data-testid="privacy-status">
                <Glyph name="check" size={12} />
                {p.deleted}
              </p>
            ) : (
              <button
                className="btn btn-danger"
                onClick={() => setStep({ kind: 'confirm' })}
                aria-disabled={step.kind === 'deleting'}
              >
                <Glyph name="trash" size={24} />
                <span>{step.kind === 'deleting' ? p.deleting : p.deleteAll}</span>
              </button>
            )}
            {step.kind === 'failed' && (
              <div className="privacy-failed" role="alert">
                <p className="privacy-status tone-warn" data-testid="privacy-status">
                  <Glyph name="warn" size={12} />
                  {step.text}
                </p>
                <p className="privacy-small">{p.deviceOnlyNote}</p>
                <button
                  className="btn btn-small"
                  onClick={() => {
                    clearDevice();
                    setStep({ kind: 'done' });
                    window.setTimeout(restartFresh, RESTART_MS);
                  }}
                >
                  {p.deviceOnly}
                </button>
              </div>
            )}
          </section>
        </div>
        <p className="privacy-small">{p.legal}</p>
      </div>
      {step.kind === 'confirm' && (
        <Dialog
          title={p.deleteAll}
          role="alertdialog"
          className="dialog"
          hideTitle
          onClose={() => setStep({ kind: 'idle' })}
        >
          <p>{p.deleteConfirm}</p>
          <div className="dialog-actions">
            <button className="btn btn-danger" onClick={() => void remove()}>
              {p.deleteYes}
            </button>
            <button
              className="btn btn-primary"
              onClick={() => setStep({ kind: 'idle' })}
              data-autofocus
            >
              {p.keep}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
