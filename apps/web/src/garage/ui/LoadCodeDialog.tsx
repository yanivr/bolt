import { CATALOG, STRINGS } from '@bolt/content';
import type { BlueprintIssue, PublicBlueprintResponse, VehicleBlueprint } from '@bolt/shared';
import {
  CAR_CODE_SYMBOLS,
  blueprintCost,
  buildHash,
  canonicalizeBlueprint,
  own,
  previewCarCode,
  readCarCode,
  repairBlueprint,
  validateBlueprint,
} from '@bolt/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { isDrawable } from '../../components/BlueprintCard.js';
import { CarCanvas } from '../../components/CarCanvas.js';
import { Dialog } from '../../components/Dialog.js';
import { Glyph } from '../../components/Glyph.js';
import type { GameManifests } from '../../game/assets.js';
import { REPAIR_CHASSIS_ID } from '../blueprintLibrary.js';
import { codes } from '../codes.js';
import { useLibrary } from '../libraryStore.js';
import { failureText } from '../shareFlow.js';
import { fill, listNames } from '../text.js';

type Props = {
  manifests: GameManifests;
  /** What was handed in: a deep link's code, or nothing. */
  initial: string;
  /** The car that `Use This Build` would replace, to ask before replacing it. */
  current: VehicleBlueprint;
  onUse: (blueprint: VehicleBlueprint) => void;
  onClose: () => void;
};

type Found = {
  response: PublicBlueprintResponse;
  /** The car as received, or as repaired here. Only ever a canonical blueprint. */
  blueprint: VehicleBlueprint;
  repairedNote: string | null;
};

type Lookup =
  | { phase: 'idle' }
  | { phase: 'checking'; code: string }
  | { phase: 'found'; code: string; found: Found }
  | { phase: 'failed'; code: string; text: string; retry: boolean };

type Tone = 'ok' | 'warn' | 'hint';

/**
 * Load Code (Section 5.7). The input forgives what people type and paste: case, spaces,
 * dashes, the prefix, a whole link. The checksum is checked as the player types, and the server
 * is asked only about a code that passes it. The car found is shown composed from the real
 * sprites with its name, cost and whether it can race, and is used or saved only on a press.
 */
export function LoadCodeDialog({ manifests, initial, current, onUse, onClose }: Props) {
  const c = STRINGS.codes;
  const [text, setText] = useState(initial);
  const [lookup, setLookup] = useState<Lookup>({ phase: 'idle' });
  const [confirming, setConfirming] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const save = useLibrary((s) => s.save);
  const asked = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  const reading = useMemo(() => readCarCode(text), [text]);

  const find = (code: string) => {
    const ticket = ++asked.current;
    setLookup({ phase: 'checking', code });
    setSaved(null);
    void codes.lookup(code).then((result) => {
      if (ticket !== asked.current) return;
      if (!result.ok) {
        setLookup({
          phase: 'failed',
          code,
          text: failureText(result.reason, result.message),
          retry: result.reason !== 'not_found' && result.reason !== 'invalid',
        });
        return;
      }
      setLookup({
        phase: 'found',
        code,
        found: {
          response: result.value,
          blueprint: canonicalizeBlueprint(result.value.blueprint),
          repairedNote: null,
        },
      });
    });
  };

  // A complete, valid code is looked up at once: pasting a link is one step.
  const validCode = reading.ok ? reading.code : null;
  useEffect(() => {
    if (validCode && (lookup.phase === 'idle' || lookup.code !== validCode)) find(validCode);
    if (!validCode && lookup.phase !== 'idle') {
      asked.current++;
      setLookup({ phase: 'idle' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validCode]);

  const status: { tone: Tone; text: string } = (() => {
    if (lookup.phase === 'checking') return { tone: 'hint', text: c.checking };
    if (lookup.phase === 'failed') return { tone: 'warn', text: lookup.text };
    if (lookup.phase === 'found') return { tone: 'ok', text: c.found };
    if (reading.ok) return { tone: 'hint', text: c.checking };
    switch (reading.reason) {
      case 'empty':
        return { tone: 'hint', text: c.hint };
      case 'incomplete':
        return {
          tone: 'hint',
          text: fill(c.keepTyping, { count: reading.symbols.length }),
        };
      case 'characters':
        return { tone: 'warn', text: c.badCharacter };
      case 'length':
        return { tone: 'warn', text: c.tooLong };
      case 'checksum':
        return { tone: 'warn', text: c.invalid };
    }
  })();

  const found = lookup.phase === 'found' ? lookup.found : null;
  const check = useMemo(
    () => (found ? validateBlueprint(found.blueprint, CATALOG) : null),
    [found],
  );
  const legal = check?.ok ?? false;
  const errors: BlueprintIssue[] = check ? check.issues.filter((i) => i.severity === 'error') : [];
  const outdated =
    !legal &&
    (errors.some((i) => i.code === 'CATALOG_MISMATCH') || (found?.response.stale ?? false));
  const problem = legal
    ? null
    : outdated
      ? c.outdated
      : errors[0]
        ? (errors[0].hint ?? errors[0].message)
        : c.needsWork;
  const drawable = found ? isDrawable(manifests, found.blueprint) : false;
  const cost = found ? blueprintCost(found.blueprint, CATALOG).total : 0;
  const sameAsCurrent =
    found !== null &&
    buildHash(found.blueprint) === buildHash(current) &&
    found.blueprint.name === current.name &&
    found.blueprint.paintId === current.paintId;

  const repair = () => {
    if (!found || lookup.phase !== 'found') return;
    const result = repairBlueprint(found.blueprint, CATALOG, {
      fallbackChassisId: REPAIR_CHASSIS_ID,
    });
    if (!result.ok) {
      setLookup({ ...lookup, found: { ...found, repairedNote: c.cannotRepair } });
      return;
    }
    const names = listNames(
      result.removed.map(
        (r) => own(CATALOG.parts, r.instance.partId)?.displayName ?? r.instance.partId,
      ),
    );
    setLookup({
      ...lookup,
      found: {
        ...found,
        blueprint: canonicalizeBlueprint(result.blueprint),
        repairedNote: result.removed.length > 0 ? fill(c.repairedRemoved, { names }) : c.repaired,
      },
    });
  };

  const use = () => {
    if (!found || !legal) return;
    if (!sameAsCurrent && !confirming) {
      setConfirming(true);
      return;
    }
    onUse(found.blueprint);
  };

  const saveCopy = () => {
    if (!found) return;
    const result = save(found.blueprint);
    setSaved(result.ok ? c.savedCopy : result.reason === 'duplicate' ? c.alreadySaved : c.full);
  };

  const shown = reading.ok
    ? reading.code
    : reading.symbols.length > 0 && reading.symbols.length <= CAR_CODE_SYMBOLS
      ? previewCarCode(reading.symbols)
      : '';

  return (
    <Dialog title={c.title} onClose={onClose} className="sheet code-sheet" hideTitle>
      <div className="code-load" data-testid="load-code">
        <section className="code-entry">
          <div className="code-title-row">
            <h2 className="code-title">{c.title}</h2>
            <button type="button" className="btn btn-small" onClick={onClose}>
              {c.close}
            </button>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (reading.ok) find(reading.code);
            }}
          >
            <label className="field code-field">
              <span>{c.label}</span>
              <input
                ref={input}
                type="text"
                className="code-input"
                value={text}
                placeholder={c.placeholder}
                maxLength={128}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="characters"
                spellCheck={false}
                inputMode="text"
                enterKeyHint="search"
                aria-describedby="code-status"
                aria-invalid={status.tone === 'warn'}
                data-autofocus
                onChange={(event) => {
                  // A pasted link or a code typed loosely becomes the printed code, so the
                  // field shows exactly what was found.
                  const value = event.target.value;
                  const read = readCarCode(value);
                  setText(read.ok && /[/=?]|\s|^.{14,}$/.test(value) ? read.code : value);
                }}
              />
            </label>
            <p
              id="code-status"
              className={`code-status tone-${status.tone}`}
              role="status"
              aria-live="polite"
              data-testid="code-status"
            >
              {status.tone === 'warn' && <Glyph name="warn" size={12} />}
              {status.tone === 'ok' && <Glyph name="check" size={12} />}
              <span>{status.text}</span>
            </p>
            {shown &&
              !reading.ok &&
              reading.reason === 'incomplete' &&
              shown !== text.trim().toUpperCase() && (
                <p className="code-echo" aria-hidden="true">
                  {shown}
                </p>
              )}
            <div className="code-entry-actions">
              {lookup.phase === 'failed' && lookup.retry ? (
                <button type="button" className="btn btn-small" onClick={() => find(lookup.code)}>
                  {c.retry}
                </button>
              ) : (
                <button
                  type="submit"
                  className="btn btn-small"
                  aria-disabled={!reading.ok || lookup.phase === 'checking'}
                >
                  {c.find}
                </button>
              )}
              {text !== '' && (
                <button
                  type="button"
                  className="btn btn-small btn-quiet"
                  onClick={() => {
                    setText('');
                    setConfirming(false);
                    input.current?.focus();
                  }}
                >
                  {c.tryAnother}
                </button>
              )}
            </div>
          </form>
        </section>

        <section className="code-preview" aria-live="polite" data-testid="code-preview">
          {found ? (
            <>
              <div className="code-car">
                <div className="bp-thumb code-thumb">
                  {drawable ? (
                    <CarCanvas
                      manifests={manifests}
                      blueprint={found.blueprint}
                      scale={1}
                      frame={8}
                    />
                  ) : (
                    <span className="bp-thumb-pending">
                      <Glyph name="chassis" size={36} />
                    </span>
                  )}
                </div>
                <div className="code-car-body">
                  <h3 className="bp-name" data-testid="code-car-name">
                    {found.blueprint.name}
                  </h3>
                  <p className="bp-meta">
                    <span className="credits">
                      <Glyph name="coin" size={12} />
                      {fill(c.cost, { cost })}
                    </span>
                    <span>
                      {CATALOG.chassis[found.blueprint.chassisId]?.displayName ?? c.retiredFrame}
                    </span>
                  </p>
                  <p
                    className={`code-badge ${legal ? 'is-ok' : 'is-warn'}`}
                    data-testid="code-badge"
                    data-legal={legal}
                    data-hash={buildHash(found.blueprint)}
                  >
                    <Glyph name={legal ? 'check' : 'warn'} size={12} />
                    {legal ? c.ready : problem}
                  </p>
                  {found.repairedNote && <p className="bp-note">{found.repairedNote}</p>}
                </div>
              </div>
              {confirming && !sameAsCurrent ? (
                <div className="code-confirm" role="alertdialog" aria-label={c.replaceTitle}>
                  <p>
                    {fill(c.replaceConfirm, { current: current.name, name: found.blueprint.name })}
                  </p>
                  <div className="code-actions">
                    <button className="btn btn-primary btn-small" onClick={use} data-autofocus>
                      {c.replace}
                    </button>
                    <button className="btn btn-small" onClick={() => setConfirming(false)}>
                      {c.keepMine}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="code-actions">
                  {legal ? (
                    <button className="btn btn-primary btn-small" onClick={use}>
                      {c.useBuild}
                    </button>
                  ) : (
                    <button className="btn btn-primary btn-small" onClick={repair}>
                      {c.repair}
                    </button>
                  )}
                  <button className="btn btn-small" onClick={saveCopy}>
                    {c.saveCopy}
                  </button>
                </div>
              )}
              {saved && (
                <p className="code-saved" role="status">
                  <Glyph name="check" size={12} />
                  {saved}
                </p>
              )}
            </>
          ) : (
            <div className="code-empty">
              <Glyph name="chassis" size={36} />
              <p>{c.portable}</p>
            </div>
          )}
        </section>
      </div>
    </Dialog>
  );
}
