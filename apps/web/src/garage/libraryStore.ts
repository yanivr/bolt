import { CATALOG } from '@bolt/content';
import type { RemovedPart, VehicleBlueprint } from '@bolt/shared';
import { create } from 'zustand';
import type { LibraryChange, LibraryEntry, LibraryStorage } from './blueprintLibrary.js';
import {
  addBlueprint,
  deleteSaved,
  duplicateBlueprint,
  readLibrary,
  renameSaved,
  repairSaved,
  writeLibrary,
} from './blueprintLibrary.js';

function storage(): LibraryStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

type LibraryState = {
  entries: LibraryEntry[];
  /** False after a write the browser refused: the list then lives only in this tab. */
  persisted: boolean;
  /** Re-reads storage, so another tab's changes show up when the screen opens. */
  refresh: () => void;
  save: (blueprint: VehicleBlueprint) => LibraryChange;
  duplicate: (id: string) => LibraryChange;
  rename: (id: string, name: string) => LibraryChange;
  remove: (id: string) => void;
  repair: (id: string) => { ok: boolean; removed: RemovedPart[]; rebuiltOn: string | null };
};

/** My Blueprints as the screens see it: the validated list plus actions that persist. */
export const useLibrary = create<LibraryState>((set, get) => {
  const commit = (entries: LibraryEntry[]) =>
    set({ entries, persisted: writeLibrary(storage(), entries) });
  const settle = (change: LibraryChange): LibraryChange => {
    if (change.ok) commit(change.entries);
    return change;
  };
  return {
    entries: readLibrary(storage(), CATALOG),
    persisted: true,
    refresh: () => set({ entries: readLibrary(storage(), CATALOG) }),
    save: (blueprint) => settle(addBlueprint(get().entries, blueprint, CATALOG, new Date())),
    duplicate: (id) => settle(duplicateBlueprint(get().entries, id, CATALOG, new Date())),
    rename: (id, name) => settle(renameSaved(get().entries, id, name, CATALOG)),
    remove: (id) => commit(deleteSaved(get().entries, id)),
    repair: (id) => {
      const result = repairSaved(get().entries, id, CATALOG);
      if (!result.ok) return { ok: false, removed: [], rebuiltOn: null };
      commit(result.entries);
      return { ok: true, removed: result.removed, rebuiltOn: result.rebuiltOn };
    },
  };
});
