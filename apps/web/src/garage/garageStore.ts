import { CATALOG } from '@bolt/content';
import type { Catalog, PartCategory, VehicleBlueprint } from '@bolt/shared';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { FireChoice, GarageSession, StartOptions } from './buildSession.js';
import * as build from './buildSession.js';

/**
 * The garage's own store: the current build session and the actions the screen dispatches.
 * All of the logic is in `buildSession.ts`; this wraps it so React can subscribe and so the
 * clock and the catalog can be swapped in tests. The deadline is an absolute time, and the
 * lock is one action, so a server that owns the build phase (Milestone E) only has to call
 * `setDeadline` when the phase starts and `lockWith` when it ends.
 */

export type GarageDeps = {
  catalog: Catalog;
  /** Epoch milliseconds. */
  now: () => number;
};

export type GarageState = {
  session: GarageSession | null;
  start: (blueprint: VehicleBlueprint, options?: Omit<StartOptions, 'now'>) => void;
  end: () => void;
  install: (partId: string) => void;
  remove: (instanceId: string) => void;
  nudge: (instanceId: string, dx: number, dy: number) => void;
  moveTo: (instanceId: string, offsetX: number, offsetY: number) => void;
  rotate: (instanceId: string) => void;
  setFire: (instanceId: string, slot: FireChoice) => void;
  paint: (paintId: string) => void;
  rename: (name: string) => void;
  load: (blueprint: VehicleBlueprint, text: string) => void;
  reset: () => void;
  repair: () => void;
  undo: () => void;
  redo: () => void;
  setCategory: (category: PartCategory) => void;
  focusPart: (partId: string | null) => void;
  chooseMount: (mountId: string | null) => void;
  tapMount: (mountId: string) => void;
  /** Starts replacing what is on an occupied mount. */
  targetMount: (mountId: string) => void;
  selectInstance: (instanceId: string) => void;
  clearSelection: () => void;
  dismissNotice: () => void;
  ready: () => void;
  /** Advances the build clock. Locks the last legal snapshot once the deadline has passed. */
  tick: () => void;
  lockWith: (snapshot: VehicleBlueprint) => void;
  setDeadline: (deadline: number | null) => void;
};

export function createGarageStore(deps: GarageDeps) {
  const { catalog } = deps;
  return createStore<GarageState>((set, get) => {
    const apply = (change: (session: GarageSession) => GarageSession) => {
      const session = get().session;
      if (!session) return;
      const next = change(session);
      if (next !== session) set({ session: next });
    };
    return {
      session: null,
      start: (blueprint, options = {}) =>
        set({ session: build.startSession(blueprint, catalog, { ...options, now: deps.now() }) }),
      end: () => set({ session: null }),
      install: (partId) => apply((s) => build.install(s, catalog, partId)),
      remove: (instanceId) => apply((s) => build.remove(s, catalog, instanceId)),
      nudge: (instanceId, dx, dy) => apply((s) => build.nudge(s, catalog, instanceId, dx, dy)),
      moveTo: (instanceId, x, y) => apply((s) => build.moveTo(s, catalog, instanceId, x, y)),
      rotate: (instanceId) => apply((s) => build.rotate(s, catalog, instanceId)),
      setFire: (instanceId, slot) => apply((s) => build.setFire(s, catalog, instanceId, slot)),
      paint: (paintId) => apply((s) => build.paint(s, catalog, paintId)),
      rename: (name) => apply((s) => build.rename(s, catalog, name)),
      load: (blueprint, text) => apply((s) => build.load(s, catalog, blueprint, text)),
      reset: () => apply((s) => build.reset(s, catalog)),
      repair: () => apply((s) => build.repair(s, catalog)),
      undo: () => apply((s) => build.undoEdit(s, catalog)),
      redo: () => apply((s) => build.redoEdit(s, catalog)),
      setCategory: (category) => apply((s) => build.setCategory(s, category)),
      focusPart: (partId) => apply((s) => build.focusPart(s, partId)),
      chooseMount: (mountId) => apply((s) => build.chooseMount(s, mountId)),
      tapMount: (mountId) => apply((s) => build.tapMount(s, catalog, mountId)),
      targetMount: (mountId) => apply((s) => build.targetMount(s, catalog, mountId)),
      selectInstance: (instanceId) => apply((s) => build.selectInstance(s, catalog, instanceId)),
      clearSelection: () => apply((s) => build.clearSelection(s)),
      dismissNotice: () => apply((s) => build.dismissNotice(s)),
      ready: () => apply((s) => build.ready(s, catalog)),
      tick: () => apply((s) => build.tick(s, deps.now())),
      lockWith: (snapshot) => apply((s) => build.lockWith(s, snapshot)),
      setDeadline: (deadline) => apply((s) => build.setDeadline(s, deadline)),
    };
  });
}

export const garageStore = createGarageStore({ catalog: CATALOG, now: () => Date.now() });

export function useGarage<T>(selector: (state: GarageState) => T): T {
  return useStore(garageStore, selector);
}
