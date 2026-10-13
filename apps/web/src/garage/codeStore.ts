import { create } from 'zustand';

/**
 * Which car code overlay is open. One `CodeHost` (mounted once in `App.tsx`) draws them over
 * whatever screen is up, so Home, My Blueprints, the garage and the results screen all open the
 * same Load Code overlay and the same share sheet.
 */
type CodeUi = {
  /** Load Code is open, with whatever was passed in (a deep link's code). */
  load: { initial: string } | null;
  /** The share sheet is open for this saved card. */
  share: { entryId: string } | null;
  openLoad: (initial?: string) => void;
  closeLoad: () => void;
  openShare: (entryId: string) => void;
  closeShare: () => void;
};

export const useCodeUi = create<CodeUi>((set) => ({
  load: null,
  share: null,
  openLoad: (initial = '') => set({ load: { initial: initial.slice(0, 128) }, share: null }),
  closeLoad: () => set({ load: null }),
  openShare: (entryId) => set({ share: { entryId }, load: null }),
  closeShare: () => set({ share: null }),
}));
