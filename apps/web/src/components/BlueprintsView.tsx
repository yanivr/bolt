import { CATALOG, STRINGS, conditionsFor, getTrack } from '@bolt/content';
import type { VehicleBlueprint } from '@bolt/shared';
import {
  MAX_BLUEPRINT_NAME_LENGTH,
  computeBuildStats,
  own,
  sanitizeBlueprintName,
} from '@bolt/shared';
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../app/store.js';
import type { GameManifests } from '../game/assets.js';
import type { LibraryEntry } from '../garage/blueprintLibrary.js';
import { MAX_SAVED_BLUEPRINTS } from '../garage/blueprintLibrary.js';
import { codes } from '../garage/codes.js';
import { useCodeUi } from '../garage/codeStore.js';
import { useLibrary } from '../garage/libraryStore.js';
import { fill, listNames } from '../garage/text.js';
import { BlueprintCard, isDrawable } from './BlueprintCard.js';
import { Dialog } from './Dialog.js';
import { Glyph } from './Glyph.js';
import { StarterList } from './StarterList.js';

type Props = {
  manifests: GameManifests;
  /** The car `Save This Car` stores: the last build at home, the draft in the garage. */
  current: VehicleBlueprint;
  /** Hash of the car in use, to tag its card. */
  currentHash?: string;
  onUse: (blueprint: VehicleBlueprint) => void;
  /** Opens a build that is not legal in the garage, to look at and fix by hand. */
  onReview: (blueprint: VehicleBlueprint) => void;
  onClose: () => void;
  closeLabel: string;
};

type Tab = 'mine' | 'starters';
type Message = { tone: 'ok' | 'warn'; text: string };

function flagFor(entry: LibraryEntry): string | undefined {
  if (entry.legal) return undefined;
  if (entry.issues.some((i) => i.code === 'CATALOG_MISMATCH')) return STRINGS.blueprints.outdated;
  const first = entry.issues[0];
  return first ? (first.hint ?? first.message) : STRINGS.blueprints.outdated;
}

/**
 * My Blueprints (Section 5.12): the saved cars and the starter cars, each a card with a
 * thumbnail composed from the real sprites. The cards live in this browser and work offline;
 * `Copy Code` gets a server code for a card (once, then the card shows it) and opens the share
 * sheet. `Load Code` brings in a car someone else shared.
 */
export function BlueprintsView({
  manifests,
  current,
  currentHash,
  onUse,
  onReview,
  onClose,
  closeLabel,
}: Props) {
  const entries = useLibrary((s) => s.entries);
  const persisted = useLibrary((s) => s.persisted);
  const refresh = useLibrary((s) => s.refresh);
  const save = useLibrary((s) => s.save);
  const duplicate = useLibrary((s) => s.duplicate);
  const rename = useLibrary((s) => s.rename);
  const remove = useLibrary((s) => s.remove);
  const repair = useLibrary((s) => s.repair);
  const [tab, setTab] = useState<Tab>('mine');
  const [message, setMessage] = useState<Message | null>(null);
  const [renaming, setRenaming] = useState<LibraryEntry | null>(null);
  const [draftName, setDraftName] = useState('');
  const [deleting, setDeleting] = useState<LibraryEntry | null>(null);

  useEffect(() => {
    refresh();
    // Deletions made while offline are sent now that the screen is open again.
    if (codes.hasGuest()) void codes.flushPending();
  }, [refresh]);
  const openShare = useCodeUi((s) => s.openShare);
  const openLoad = useCodeUi((s) => s.openLoad);

  const course = useApp((s) => s.course);
  const track = getTrack(course.trackId);
  const hints = useMemo(() => {
    const conditions = conditionsFor(course.trackId, course.presetId);
    const map = new Map<string, string>();
    for (const entry of entries) {
      if (!entry.legal) continue;
      const stats = computeBuildStats(entry.blueprint, CATALOG, conditions);
      if (stats && track)
        map.set(
          entry.id,
          fill(STRINGS.blueprints.suits, {
            track: track.name,
            speed: stats.scores.speed,
            control: stats.scores.control,
          }),
        );
    }
    return map;
  }, [entries, track, course.trackId, course.presetId]);

  const full = entries.length >= MAX_SAVED_BLUEPRINTS;
  const say = (tone: Message['tone'], text: string) => setMessage({ tone, text });

  const saveCurrent = () => {
    const result = save(current);
    if (result.ok) say('ok', STRINGS.blueprints.saved);
    else if (result.reason === 'duplicate') say('warn', STRINGS.blueprints.alreadySaved);
    else say('warn', STRINGS.blueprints.full);
  };

  const names = (ids: string[]) =>
    listNames(ids.map((id) => own(CATALOG.parts, id)?.displayName ?? id));

  return (
    <div className="bp-view">
      <header className="bp-head">
        <div className="tabs" role="tablist" aria-label={STRINGS.blueprints.title}>
          {(
            [
              ['mine', STRINGS.blueprints.myBuilds],
              ['starters', STRINGS.blueprints.starterCars],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              id={`bp-tab-${id}`}
              aria-selected={tab === id}
              aria-controls="bp-panel"
              className={`tab${tab === id ? ' is-selected' : ''}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="bp-count">
          {fill(STRINGS.blueprints.count, { count: entries.length })}
        </span>
        <button
          className="btn btn-primary btn-small"
          onClick={saveCurrent}
          aria-disabled={full}
          data-autofocus
        >
          {STRINGS.blueprints.saveThisCar}
        </button>
        <button className="btn btn-small" onClick={() => openLoad()}>
          {STRINGS.codes.loadCode}
        </button>
        <button className="btn btn-small" onClick={onClose}>
          {closeLabel}
        </button>
      </header>
      <p className={`bp-message tone-${message?.tone ?? 'ok'}`} role="status" aria-live="polite">
        {message && <Glyph name={message.tone === 'ok' ? 'check' : 'warn'} size={12} />}
        {message?.text ?? (persisted ? '' : STRINGS.blueprints.storageFailed)}
      </p>
      <div
        className="bp-scroll"
        role="tabpanel"
        id="bp-panel"
        aria-labelledby={`bp-tab-${tab}`}
        tabIndex={-1}
      >
        {tab === 'starters' ? (
          <StarterList
            manifests={manifests}
            actionLabel={STRINGS.blueprints.use}
            onPick={(template) => onUse(template.blueprint)}
          />
        ) : entries.length === 0 ? (
          <p className="bp-empty">{STRINGS.blueprints.empty}</p>
        ) : (
          <div className="bp-grid">
            {entries.map((entry) => {
              const usable = entry.legal && isDrawable(manifests, entry.blueprint);
              return (
                <BlueprintCard
                  key={entry.id}
                  manifests={manifests}
                  blueprint={entry.blueprint}
                  note={hints.get(entry.id)}
                  warning={flagFor(entry)}
                  tag={
                    entry.buildHash === currentHash && entry.legal
                      ? STRINGS.blueprints.inUse
                      : undefined
                  }
                  code={entry.share?.code}
                >
                  {entry.legal ? (
                    <button
                      className="btn btn-primary btn-small"
                      disabled={!usable}
                      onClick={() => onUse(entry.blueprint)}
                    >
                      {STRINGS.blueprints.use}
                    </button>
                  ) : (
                    <button
                      className="btn btn-primary btn-small"
                      onClick={() => {
                        const result = repair(entry.id);
                        const removedNames = names(result.removed.map((r) => r.instance.partId));
                        const chassis = result.rebuiltOn
                          ? (CATALOG.chassis[result.rebuiltOn]?.displayName ?? '')
                          : '';
                        if (!result.ok) say('warn', STRINGS.blueprints.cannotRepair);
                        else if (result.rebuiltOn)
                          say(
                            'warn',
                            result.removed.length > 0
                              ? fill(STRINGS.blueprints.rebuiltRemoved, {
                                  chassis,
                                  names: removedNames,
                                })
                              : fill(STRINGS.blueprints.rebuilt, { chassis }),
                          );
                        else if (result.removed.length > 0)
                          say(
                            'warn',
                            fill(STRINGS.blueprints.repairedRemoved, {
                              names: removedNames,
                            }),
                          );
                        else say('ok', STRINGS.blueprints.repaired);
                      }}
                    >
                      {STRINGS.blueprints.repair}
                    </button>
                  )}
                  {entry.legal && (
                    <button
                      className="btn btn-small"
                      onClick={() => openShare(entry.id)}
                      data-testid="copy-code"
                    >
                      {STRINGS.codes.copyCode}
                    </button>
                  )}
                  {!entry.legal && isDrawable(manifests, entry.blueprint) && (
                    <button className="btn btn-small" onClick={() => onReview(entry.blueprint)}>
                      {STRINGS.blueprints.review}
                    </button>
                  )}
                  <button
                    className="btn btn-small"
                    aria-disabled={full}
                    onClick={() => {
                      const result = duplicate(entry.id);
                      if (result.ok)
                        say(
                          'ok',
                          fill(STRINGS.blueprints.duplicated, {
                            name: result.entry.blueprint.name,
                          }),
                        );
                      else say('warn', STRINGS.blueprints.full);
                    }}
                  >
                    {STRINGS.blueprints.duplicate}
                  </button>
                  <button
                    className="btn btn-small"
                    onClick={() => {
                      setDraftName(entry.blueprint.name);
                      setRenaming(entry);
                    }}
                  >
                    {STRINGS.blueprints.rename}
                  </button>
                  <button className="btn btn-small btn-danger" onClick={() => setDeleting(entry)}>
                    {STRINGS.blueprints.delete}
                  </button>
                </BlueprintCard>
              );
            })}
          </div>
        )}
      </div>

      {renaming && (
        <Dialog
          title={STRINGS.blueprints.rename}
          onClose={() => setRenaming(null)}
          className="dialog"
        >
          <form
            className="name-form"
            onSubmit={(event) => {
              event.preventDefault();
              const result = rename(renaming.id, draftName);
              if (result.ok)
                say('ok', fill(STRINGS.garage.renamed, { name: result.entry.blueprint.name }));
              setRenaming(null);
            }}
          >
            <label className="field">
              <span>{STRINGS.garage.name}</span>
              <input
                type="text"
                value={draftName}
                maxLength={MAX_BLUEPRINT_NAME_LENGTH}
                autoComplete="off"
                autoCapitalize="words"
                spellCheck={false}
                enterKeyHint="done"
                data-autofocus
                onChange={(event) =>
                  setDraftName(event.target.value.replace(/[^A-Za-z0-9 '.!?&+#-]/g, ''))
                }
              />
            </label>
            <p className="field-hint">{STRINGS.garage.nameHint}</p>
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={() => setRenaming(null)}>
                {STRINGS.garage.cancel}
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={sanitizeBlueprintName(draftName, '') === ''}
              >
                {STRINGS.garage.done}
              </button>
            </div>
          </form>
        </Dialog>
      )}

      {deleting && (
        <Dialog
          title={STRINGS.blueprints.delete}
          role="alertdialog"
          onClose={() => setDeleting(null)}
          className="dialog"
          hideTitle
        >
          <p>
            {fill(STRINGS.blueprints.deleteConfirm, { name: deleting.blueprint.name })}
            {deleting.share && ` ${STRINGS.codes.deleteSharedNote}`}
          </p>
          <div className="dialog-actions">
            <button
              className="btn btn-danger"
              onClick={() => {
                remove(deleting.id);
                say('ok', STRINGS.blueprints.deleted);
                setDeleting(null);
              }}
            >
              {STRINGS.blueprints.delete}
            </button>
            <button className="btn btn-primary" onClick={() => setDeleting(null)} data-autofocus>
              {STRINGS.blueprints.keep}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
