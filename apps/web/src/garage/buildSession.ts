import { BASELINE_BLUEPRINT, STRINGS, getPart } from '@bolt/content';
import type {
  BlueprintIssue,
  BuildHistory,
  Catalog,
  EditResult,
  PartCategory,
  PlacedPart,
  QuarterTurn,
  RemovedPart,
  VehicleBlueprint,
} from '@bolt/shared';
import {
  BUILD_SECONDS,
  allowedRotations,
  assignActionSlot,
  compareCost,
  createHistory,
  installPart,
  installedParts,
  movePart,
  own,
  pushHistory,
  redo,
  removePart,
  renameBlueprint,
  repairBlueprint,
  rotatePart,
  sanitizeBlueprintName,
  setPaint,
  swapChassis,
  swapEngine,
  swapTires,
  undo,
  validateBlueprint,
} from '@bolt/shared';
import { fill, listNames } from './text.js';

/**
 * One garage visit as a plain value, with pure reducers over it. Every rule lives in the
 * shared edit helpers; this module only decides which helper a press means, keeps the undo
 * history, remembers the last snapshot the validator accepted, and runs the build clock.
 * Nothing here touches the browser, so the whole thing is unit tested.
 */

export type Selection =
  | { kind: 'none' }
  /**
   * A mount to fill: the part list is filtered to what fits there. Usually an empty mount;
   * an occupied one when the player asked to replace what is on it.
   */
  | { kind: 'mount'; mountId: string }
  /** An installed part, with its move, rotate, fire-button and remove tools. */
  | { kind: 'instance'; instanceId: string };

/**
 * A place on the car that holds something: the three essentials, or one accessory mount of
 * the chassis. The garage is navigated by slot: tap one and the panel shows what goes there.
 */
export type Slot = { kind: 'chassis' | 'engine' | 'tires' } | { kind: 'mount'; mountId: string };

/**
 * What the side panel is for. `car` is the idle view of the whole build; `parts` is the
 * selected slot (its list, or the card of the part on it); `browse` is the whole catalog by
 * category, for finding parts that fit no mount on this chassis.
 */
export type PanelView = 'car' | 'parts' | 'browse';

export type NoticeTone = 'ok' | 'warn' | 'error';

export type Notice = {
  tone: NoticeTone;
  text: string;
  /** Bumped for every notice so the live region re-announces a repeated line. */
  stamp: number;
  /** The refusal behind an error notice. */
  issue?: BlueprintIssue;
};

export type GaragePhase = 'building' | 'locked';

export type GarageSession = {
  history: BuildHistory;
  /** The newest snapshot the validator accepted. This is what the timer locks. */
  lastLegal: VehicleBlueprint;
  selection: Selection;
  /** The essential slot that is open, or the category being browsed. */
  category: PartCategory;
  view: PanelView;
  /** The catalog card open in the detail pane. */
  focusPartId: string | null;
  /** A mount the player picked for the focused part, overriding the suggestion. */
  targetMountId: string | null;
  /** Epoch milliseconds at which the build locks. Null means no clock is running. */
  deadline: number | null;
  phase: GaragePhase;
  /** The car that goes to the race, set exactly once when the build locks. */
  locked: VehicleBlueprint | null;
  /** Why it locked: the player pressed Ready, or the clock ran out. */
  lockReason: 'ready' | 'timer' | null;
  notice: Notice | null;
  /** Installed parts to flag after a refusal. */
  flagged: string[];
  /** Parts the last chassis swap could not carry over. */
  lastRemoved: RemovedPart[];
};

export type StartOptions = {
  /** Epoch milliseconds now. */
  now: number;
  /** Build time in seconds. Zero or less runs no clock. */
  seconds?: number;
  /** The last legal car, when the draft itself is not legal. */
  fallback?: VehicleBlueprint;
  category?: PartCategory;
};

function legalForm(blueprint: VehicleBlueprint, catalog: Catalog): VehicleBlueprint | null {
  const check = validateBlueprint(blueprint, catalog);
  return check.ok ? check.blueprint : null;
}

export function startSession(
  blueprint: VehicleBlueprint,
  catalog: Catalog,
  options: StartOptions,
): GarageSession {
  const seconds = options.seconds ?? BUILD_SECONDS;
  const legal = legalForm(blueprint, catalog);
  const fallback = options.fallback ? legalForm(options.fallback, catalog) : null;
  return {
    history: createHistory(blueprint),
    lastLegal: legal ?? fallback ?? BASELINE_BLUEPRINT,
    selection: { kind: 'none' },
    category: options.category ?? 'chassis',
    view: 'car',
    focusPartId: null,
    targetMountId: null,
    deadline: seconds > 0 ? options.now + seconds * 1000 : null,
    phase: 'building',
    locked: null,
    lockReason: null,
    notice: null,
    flagged: [],
    lastRemoved: [],
  };
}

export function currentBlueprint(session: GarageSession): VehicleBlueprint {
  return session.history.present;
}

function note(
  session: GarageSession,
  tone: NoticeTone,
  text: string,
  issue?: BlueprintIssue,
): Notice {
  const notice: Notice = { tone, text, stamp: (session.notice?.stamp ?? 0) + 1 };
  if (issue) notice.issue = issue;
  return notice;
}

/** The sentence shown for a refusal: the longer approved line when there is one. */
export function issueText(issue: BlueprintIssue): string {
  return issue.hint ?? issue.message;
}

function partName(catalog: Catalog, partId: string): string {
  return (
    own(catalog.parts, partId)?.displayName ??
    own(catalog.chassis, partId)?.displayName ??
    own(catalog.engines, partId)?.displayName ??
    own(catalog.tires, partId)?.displayName ??
    getPart(partId)?.displayName ??
    partId
  );
}

/** Drops a selection that no longer points at anything on the car. */
function keepSelection(
  selection: Selection,
  blueprint: VehicleBlueprint,
  catalog: Catalog,
): Selection {
  if (selection.kind === 'instance')
    return blueprint.parts.some((p) => p.instanceId === selection.instanceId)
      ? selection
      : { kind: 'none' };
  if (selection.kind === 'mount') {
    const chassis = own(catalog.chassis, blueprint.chassisId);
    return chassis?.mounts.some((m) => m.id === selection.mountId) ? selection : { kind: 'none' };
  }
  return selection;
}

/** Moves to a new present blueprint (already in the history) and refreshes what hangs off it. */
function settle(
  session: GarageSession,
  history: BuildHistory,
  catalog: Catalog,
  patch: Partial<GarageSession> = {},
): GarageSession {
  const present = history.present;
  const selection = keepSelection(patch.selection ?? session.selection, present, catalog);
  const chassis = own(catalog.chassis, present.chassisId);
  const targetMountId =
    patch.targetMountId !== undefined ? patch.targetMountId : session.targetMountId;
  return {
    ...session,
    flagged: [],
    lastRemoved: [],
    ...patch,
    history,
    lastLegal: legalForm(present, catalog) ?? session.lastLegal,
    selection,
    targetMountId:
      targetMountId !== null && chassis?.mounts.some((m) => m.id === targetMountId)
        ? targetMountId
        : null,
  };
}

function refused(session: GarageSession, issue: BlueprintIssue): GarageSession {
  const flagged = [issue.instanceId, issue.otherInstanceId].filter(
    (id): id is string => typeof id === 'string',
  );
  return { ...session, notice: note(session, 'error', issueText(issue), issue), flagged };
}

function building(session: GarageSession): boolean {
  return session.phase === 'building';
}

/** Records an accepted edit as one undo step, or reports a refusal and changes nothing. */
function commit(
  session: GarageSession,
  catalog: Catalog,
  result: EditResult,
  okText: string,
  patch: Partial<GarageSession> = {},
): GarageSession {
  if (!building(session)) return session;
  if (!result.ok) return refused(session, result.issue);
  return settle(session, pushHistory(session.history, result.blueprint), catalog, {
    notice: note(session, 'ok', okText),
    ...patch,
  });
}

// --- Buying -------------------------------------------------------------------------------------

export type InstallPlan = {
  /** What the button says and does. */
  action: 'install' | 'replace' | 'swap' | 'current';
  result: EditResult;
  /** The mount an accessory will go on, when the plan found one. */
  mountId: string | null;
  /** The part that comes off to make room. */
  replaced: PlacedPart | null;
};

/** Parts sitting on one mount, in canonical order. */
export function partsOnMount(
  blueprint: VehicleBlueprint,
  catalog: Catalog,
  mountId: string,
): PlacedPart[] {
  return installedParts(blueprint, catalog).filter((p) => p.mount.id === mountId);
}

/** The mount a selection asks to fill. A selected part is being adjusted, not replaced. */
export function selectionMountId(selection: Selection): string | null {
  return selection.kind === 'mount' ? selection.mountId : null;
}

function current(blueprint: VehicleBlueprint, catalog: Catalog): EditResult {
  return { ok: true, blueprint, spend: compareCost(blueprint, blueprint, catalog), removed: [] };
}

/**
 * What pressing the buy button for a card would do, without doing it. The preview, the
 * card's "cannot install" reason and the press itself all go through this one function, so
 * what the player is shown is exactly what the press does.
 *
 * `mountId` is where an accessory should go. Without one the rules pick the best free mount.
 * When that mount is taken and cannot be shared, the plan is a replacement: the part that is
 * there (the one named by `instanceId` when it sits on that mount) is sold and the new part
 * takes its place, as one transaction.
 */
export function planInstall(
  blueprint: VehicleBlueprint,
  catalog: Catalog,
  partId: string,
  mountId: string | null = null,
  instanceId: string | null = null,
): InstallPlan {
  if (own(catalog.chassis, partId)) {
    if (partId === blueprint.chassisId)
      return {
        action: 'current',
        result: current(blueprint, catalog),
        mountId: null,
        replaced: null,
      };
    return {
      action: 'swap',
      result: swapChassis(blueprint, catalog, partId),
      mountId: null,
      replaced: null,
    };
  }
  if (own(catalog.engines, partId)) {
    if (partId === blueprint.engineId)
      return {
        action: 'current',
        result: current(blueprint, catalog),
        mountId: null,
        replaced: null,
      };
    return {
      action: 'swap',
      result: swapEngine(blueprint, catalog, partId),
      mountId: null,
      replaced: null,
    };
  }
  if (own(catalog.tires, partId)) {
    if (partId === blueprint.tireKitId)
      return {
        action: 'current',
        result: current(blueprint, catalog),
        mountId: null,
        replaced: null,
      };
    return {
      action: 'swap',
      result: swapTires(blueprint, catalog, partId),
      mountId: null,
      replaced: null,
    };
  }

  if (mountId === null) {
    const result = installPart(blueprint, catalog, partId);
    const placed = result.ok
      ? result.blueprint.parts.find((p) => p.instanceId === result.instanceId)
      : undefined;
    return { action: 'install', result, mountId: placed?.mountId ?? null, replaced: null };
  }

  const occupants = partsOnMount(blueprint, catalog, mountId);
  if (occupants.length > 0) {
    // Try to share the mount first (racks hold two small parts).
    const shared = installPart(blueprint, catalog, partId, { mountId });
    if (shared.ok) return { action: 'install', result: shared, mountId, replaced: null };
    const leaving = occupants.find((p) => p.instance.instanceId === instanceId) ?? occupants[0]!;
    // The same part is already there: nothing to buy.
    if (leaving.def.id === partId)
      return { action: 'current', result: current(blueprint, catalog), mountId, replaced: null };
    const cleared = removePart(blueprint, catalog, leaving.instance.instanceId);
    if (!cleared.ok) return { action: 'replace', result: cleared, mountId, replaced: leaving };
    const fitted = installPart(cleared.blueprint, catalog, partId, { mountId });
    if (!fitted.ok)
      return {
        action: 'replace',
        result: { ok: false, blueprint, issue: fitted.issue },
        mountId,
        replaced: leaving,
      };
    return {
      action: 'replace',
      result: { ...fitted, spend: compareCost(blueprint, fitted.blueprint, catalog) },
      mountId,
      replaced: leaving,
    };
  }
  return {
    action: 'install',
    result: installPart(blueprint, catalog, partId, { mountId }),
    mountId,
    replaced: null,
  };
}

/** The mount the focused card is aimed at: an explicit pick, else the selected mount. */
export function targetMountFor(session: GarageSession): string | null {
  return session.targetMountId ?? selectionMountId(session.selection);
}

/** The plan for a card under the session's current selection. */
export function planFor(session: GarageSession, catalog: Catalog, partId: string): InstallPlan {
  return planInstall(currentBlueprint(session), catalog, partId, targetMountFor(session));
}

function removedNote(removed: RemovedPart[], catalog: Catalog): string {
  if (removed.length === 0) return STRINGS.garage.chassisKept;
  const names = listNames(removed.map((r) => partName(catalog, r.instance.partId)));
  const credits = removed.reduce((sum, r) => sum + r.refund, 0);
  const line =
    removed.length === 1
      ? fill(STRINGS.garage.chassisRefundedOne, { names })
      : fill(STRINGS.garage.chassisRefunded, { count: removed.length, names });
  return `${line} ${fill(STRINGS.garage.refundTotal, { credits })}`;
}

/** The deliberate purchase: Install, Replace or Swap for one card. */
export function install(session: GarageSession, catalog: Catalog, partId: string): GarageSession {
  if (!building(session)) return session;
  const plan = planFor(session, catalog, partId);
  if (plan.action === 'current') return session;
  const name = partName(catalog, partId);
  if (!plan.result.ok) return refused(session, plan.result.issue);
  if (own(catalog.chassis, partId)) {
    const removed = plan.result.removed;
    const next = commit(
      session,
      catalog,
      plan.result,
      `${fill(STRINGS.garage.swappedMsg, { part: name })} ${removedNote(removed, catalog)}`,
      { selection: { kind: 'none' }, targetMountId: null, focusPartId: null },
    );
    return {
      ...next,
      lastRemoved: removed,
      notice: next.notice ? { ...next.notice, tone: removed.length > 0 ? 'warn' : 'ok' } : null,
    };
  }
  if (plan.action === 'swap')
    return commit(session, catalog, plan.result, fill(STRINGS.garage.swappedMsg, { part: name }), {
      focusPartId: null,
    });
  const instanceId = plan.result.instanceId;
  return commit(
    session,
    catalog,
    plan.result,
    fill(STRINGS.garage.installedMsg, { part: name }),
    instanceId
      ? {
          selection: { kind: 'instance', instanceId },
          targetMountId: null,
          focusPartId: null,
          view: 'parts',
        }
      : {},
  );
}

export function remove(
  session: GarageSession,
  catalog: Catalog,
  instanceId: string,
): GarageSession {
  const blueprint = currentBlueprint(session);
  const instance = blueprint.parts.find((p) => p.instanceId === instanceId);
  const def = instance ? own(catalog.parts, instance.partId) : undefined;
  const text = fill(STRINGS.garage.removedMsg, {
    part: def?.displayName ?? STRINGS.garage.selectedPart,
    price: def?.price ?? 0,
  });
  const next = commit(session, catalog, removePart(blueprint, catalog, instanceId), text);
  if (next === session || next.notice?.tone === 'error' || !instance) return next;
  // The emptied mount stays selected, so the list shows what else fits there.
  return { ...next, selection: { kind: 'mount', mountId: instance.mountId }, view: 'parts' };
}

// --- Placing ------------------------------------------------------------------------------------

/** Moves a part by whole grid steps inside its mount's region. */
export function nudge(
  session: GarageSession,
  catalog: Catalog,
  instanceId: string,
  dx: number,
  dy: number,
): GarageSession {
  const blueprint = currentBlueprint(session);
  const part = blueprint.parts.find((p) => p.instanceId === instanceId);
  if (!part) return session;
  return moveTo(session, catalog, instanceId, part.offsetX + dx, part.offsetY + dy);
}

/** Sets a part's offset on its mount, as the end of a drag does. */
export function moveTo(
  session: GarageSession,
  catalog: Catalog,
  instanceId: string,
  offsetX: number,
  offsetY: number,
): GarageSession {
  const blueprint = currentBlueprint(session);
  const part = blueprint.parts.find((p) => p.instanceId === instanceId);
  if (!part || !building(session)) return session;
  if (part.offsetX === offsetX && part.offsetY === offsetY) return session;
  const result = movePart(blueprint, catalog, instanceId, { offsetX, offsetY });
  if (!result.ok) return refused(session, result.issue);
  const moved = result.blueprint.parts.find((p) => p.instanceId === instanceId);
  return commit(
    session,
    catalog,
    result,
    fill(STRINGS.garage.position, { x: moved?.offsetX ?? 0, y: moved?.offsetY ?? 0 }),
  );
}

/** Whether a part could sit at an offset, for the live colour of a drag. */
export function tryMove(
  blueprint: VehicleBlueprint,
  catalog: Catalog,
  instanceId: string,
  offsetX: number,
  offsetY: number,
): EditResult {
  return movePart(blueprint, catalog, instanceId, { offsetX, offsetY });
}

/** Steps a part clockwise to the next facing its mount allows (the R key). */
export function rotate(
  session: GarageSession,
  catalog: Catalog,
  instanceId: string,
): GarageSession {
  if (!building(session)) return session;
  const blueprint = currentBlueprint(session);
  const part = installedParts(blueprint, catalog).find((p) => p.instance.instanceId === instanceId);
  if (!part) return session;
  const allowed = allowedRotations(part.mount, part.def);
  for (let step = 1; step <= 3; step++) {
    const turn = ((part.instance.rotationQuarterTurns + step) % 4) as QuarterTurn;
    if (allowed.includes(turn)) return face(session, catalog, instanceId, turn);
  }
  // Nowhere to step to: say which single way this part or mount faces.
  return face(
    session,
    catalog,
    instanceId,
    ((part.instance.rotationQuarterTurns + 1) % 4) as QuarterTurn,
  );
}

/**
 * Why a part cannot face a way on its mount, in approved copy, or null when it can. The
 * direction picker shows this on a press of a dimmed arrow, and `face` refuses with it.
 */
export function facingBlocked(part: PlacedPart, turn: QuarterTurn): string | null {
  const allowed = allowedRotations(part.mount, part.def);
  if (allowed.includes(turn)) return null;
  if (part.def.facing === 'none') return STRINGS.garage.facingNone;
  if (part.def.facing === 'fixed') return STRINGS.garage.facingFixed[allowed[0] ?? 0];
  return allowed.length === 1
    ? STRINGS.garage.facingOnly[allowed[0]!]
    : STRINGS.garage.facingBlocked[turn];
}

/** Points a part one of the four ways: 0 front, 1 right, 2 rear, 3 left. */
export function face(
  session: GarageSession,
  catalog: Catalog,
  instanceId: string,
  turn: QuarterTurn,
): GarageSession {
  if (!building(session)) return session;
  const blueprint = currentBlueprint(session);
  const part = installedParts(blueprint, catalog).find((p) => p.instance.instanceId === instanceId);
  if (!part) return session;
  const reason = facingBlocked(part, turn);
  if (reason !== null)
    return refused(session, {
      code: 'BAD_ROTATION',
      severity: 'error',
      message: reason,
      instanceId,
      mountId: part.mount.id,
    });
  if (part.instance.rotationQuarterTurns === turn) return session;
  return commit(
    session,
    catalog,
    rotatePart(blueprint, catalog, instanceId, turn),
    STRINGS.garage.facing[turn],
  );
}

export type FireChoice = 0 | 1 | 'auto' | null;

export function setFire(
  session: GarageSession,
  catalog: Catalog,
  instanceId: string,
  slot: FireChoice,
): GarageSession {
  const text =
    slot === 0
      ? STRINGS.garage.firePrimary
      : slot === 1
        ? STRINGS.garage.fireSecondary
        : slot === 'auto'
          ? STRINGS.garage.fireAuto
          : STRINGS.garage.fireOff;
  return commit(
    session,
    catalog,
    assignActionSlot(currentBlueprint(session), catalog, instanceId, slot),
    `${STRINGS.garage.fireButton}: ${text}`,
  );
}

// --- Whole-car changes --------------------------------------------------------------------------

export function paint(session: GarageSession, catalog: Catalog, paintId: string): GarageSession {
  if (currentBlueprint(session).paintId === paintId) return session;
  return commit(
    session,
    catalog,
    setPaint(currentBlueprint(session), catalog, paintId),
    STRINGS.garage.paintSet,
  );
}

export function rename(session: GarageSession, catalog: Catalog, raw: string): GarageSession {
  const blueprint = currentBlueprint(session);
  const name = sanitizeBlueprintName(raw, blueprint.name);
  if (name === blueprint.name) return session;
  return commit(
    session,
    catalog,
    renameBlueprint(blueprint, catalog, name),
    fill(STRINGS.garage.renamed, { name }),
  );
}

/**
 * Replaces the whole draft with another blueprint (a starter, a saved car, the stock car) as
 * one undo step. The blueprint is taken as it is, legal or not: an old saved build can be
 * opened, looked at and repaired here. It only ever reaches a race through `ready` or the
 * timer, and both insist on a legal car.
 */
export function load(
  session: GarageSession,
  catalog: Catalog,
  blueprint: VehicleBlueprint,
  text: string,
): GarageSession {
  if (!building(session)) return session;
  const check = validateBlueprint(blueprint, catalog);
  const next = check.blueprint ?? blueprint;
  const errors = check.issues.filter((i) => i.severity === 'error');
  const settled = settle(session, pushHistory(session.history, next), catalog, {
    selection: { kind: 'none' },
    view: 'car',
    targetMountId: null,
    focusPartId: null,
    notice: errors[0]
      ? note(session, 'error', issueText(errors[0]), errors[0])
      : note(session, 'ok', text),
  });
  return {
    ...settled,
    flagged: errors.flatMap((i) => (i.instanceId ? [i.instanceId] : [])),
  };
}

export function reset(session: GarageSession, catalog: Catalog): GarageSession {
  const blueprint = currentBlueprint(session);
  const stock: VehicleBlueprint = {
    ...BASELINE_BLUEPRINT,
    name: blueprint.name,
    paintId: blueprint.paintId,
  };
  return load(session, catalog, stock, STRINGS.garage.resetDone);
}

/** The explicit auto-repair for a draft that is not legal, as one undo step. */
export function repair(session: GarageSession, catalog: Catalog): GarageSession {
  if (!building(session)) return session;
  const result = repairBlueprint(currentBlueprint(session), catalog, {
    fallbackChassisId: BASELINE_BLUEPRINT.chassisId,
  });
  if (!result.ok)
    return { ...session, notice: note(session, 'error', STRINGS.garage.cannotRepair) };
  const names = listNames(result.removed.map((r) => partName(catalog, r.instance.partId)));
  return settle(session, pushHistory(session.history, result.blueprint), catalog, {
    notice: note(
      session,
      result.removed.length > 0 ? 'warn' : 'ok',
      result.removed.length > 0
        ? fill(STRINGS.garage.repairedRemoved, { names })
        : STRINGS.garage.repaired,
    ),
    lastRemoved: result.removed,
  });
}

export function undoEdit(session: GarageSession, catalog: Catalog): GarageSession {
  if (!building(session) || session.history.past.length === 0) return session;
  return settle(session, undo(session.history), catalog, {
    notice: note(session, 'ok', STRINGS.garage.undone),
  });
}

export function redoEdit(session: GarageSession, catalog: Catalog): GarageSession {
  if (!building(session) || session.history.future.length === 0) return session;
  return settle(session, redo(session.history), catalog, {
    notice: note(session, 'ok', STRINGS.garage.redone),
  });
}

// --- Looking ------------------------------------------------------------------------------------

const ACCESSORY: readonly PartCategory[] = ['weapon', 'defense', 'utility'];

/**
 * Opens a category from the rail. A mount picked for filling stays picked, so the player can
 * look through weapons, defenses and utilities for it; a part that was only selected for
 * adjusting is let go, so the list is the whole category again.
 */
export function setCategory(session: GarageSession, category: PartCategory): GarageSession {
  const selection: Selection =
    session.selection.kind === 'instance' ? { kind: 'none' } : session.selection;
  if (
    session.category === category &&
    session.focusPartId === null &&
    selection === session.selection
  )
    return session;
  return {
    ...session,
    category,
    selection,
    focusPartId: null,
    targetMountId: null,
    notice: null,
    flagged: [],
  };
}

/**
 * Asks to replace whatever is on a mount: the mount becomes the target and the list shows
 * what fits there. Nothing is bought or sold until the Replace button is pressed.
 */
export function targetMount(
  session: GarageSession,
  catalog: Catalog,
  mountId: string,
): GarageSession {
  const chassis = own(catalog.chassis, currentBlueprint(session).chassisId);
  if (!chassis?.mounts.some((m) => m.id === mountId)) return session;
  return {
    ...session,
    selection: { kind: 'mount', mountId },
    view: 'parts',
    targetMountId: null,
    focusPartId: null,
    category: ACCESSORY.includes(session.category) ? session.category : 'weapon',
    flagged: [],
  };
}

/** Opens a card in the detail pane, or closes the pane with null. */
export function focusPart(session: GarageSession, partId: string | null): GarageSession {
  return { ...session, focusPartId: partId, targetMountId: null, notice: null, flagged: [] };
}

export function chooseMount(session: GarageSession, mountId: string | null): GarageSession {
  return { ...session, targetMountId: mountId, notice: null, flagged: [] };
}

/**
 * A tap on a mount marker. An occupied mount selects its part (the next one on a shared
 * rack when tapped again); an empty mount filters the list to what fits. Tapping never buys.
 */
export function tapMount(session: GarageSession, catalog: Catalog, mountId: string): GarageSession {
  const chassis = own(catalog.chassis, currentBlueprint(session).chassisId);
  if (!chassis?.mounts.some((m) => m.id === mountId)) return session;
  const occupants = partsOnMount(currentBlueprint(session), catalog, mountId);
  if (occupants.length === 0) {
    if (
      session.selection.kind === 'mount' &&
      session.selection.mountId === mountId &&
      session.focusPartId === null
    )
      return { ...session, selection: { kind: 'none' }, view: 'car', targetMountId: null };
    return {
      ...session,
      selection: { kind: 'mount', mountId },
      view: 'parts',
      targetMountId: null,
      focusPartId: null,
      category: ACCESSORY.includes(session.category) ? session.category : 'weapon',
      flagged: [],
    };
  }
  const selected =
    session.selection.kind === 'instance'
      ? occupants.findIndex(
          (p) =>
            session.selection.kind === 'instance' &&
            p.instance.instanceId === session.selection.instanceId,
        )
      : -1;
  const next = occupants[(selected + 1) % occupants.length]!;
  return selectInstance(session, catalog, next.instance.instanceId);
}

export function selectInstance(
  session: GarageSession,
  catalog: Catalog,
  instanceId: string,
): GarageSession {
  const part = currentBlueprint(session).parts.find((p) => p.instanceId === instanceId);
  if (!part) return session;
  const def = own(catalog.parts, part.partId);
  return {
    ...session,
    selection: { kind: 'instance', instanceId },
    view: 'parts',
    targetMountId: null,
    focusPartId: null,
    category: def?.category ?? session.category,
    flagged: [],
  };
}

/** Lets go of whatever is selected and goes back to the idle view of the whole car. */
export function clearSelection(session: GarageSession): GarageSession {
  if (
    session.selection.kind === 'none' &&
    session.targetMountId === null &&
    session.view === 'car' &&
    session.focusPartId === null
  )
    return session;
  return {
    ...session,
    selection: { kind: 'none' },
    view: 'car',
    targetMountId: null,
    focusPartId: null,
  };
}

const ESSENTIAL: readonly PartCategory[] = ['chassis', 'engine', 'tires'];

/**
 * The slot the panel is showing: the mount of the selection, or the open essential. Null in
 * the idle view and while browsing the whole catalog.
 */
export function activeSlot(session: GarageSession, catalog: Catalog): Slot | null {
  const { selection } = session;
  if (selection.kind === 'mount') return { kind: 'mount', mountId: selection.mountId };
  if (selection.kind === 'instance') {
    const part = currentBlueprint(session).parts.find((p) => p.instanceId === selection.instanceId);
    const chassis = own(catalog.chassis, currentBlueprint(session).chassisId);
    return part && chassis?.mounts.some((m) => m.id === part.mountId)
      ? { kind: 'mount', mountId: part.mountId }
      : null;
  }
  if (session.view === 'parts' && ESSENTIAL.includes(session.category))
    return { kind: session.category as 'chassis' | 'engine' | 'tires' };
  return null;
}

/**
 * A tap on a slot tile. An essential opens its list (a second tap closes it); a mount behaves
 * as `tapMount` says: an empty one lists what fits, an occupied one shows its part. Tapping
 * never buys.
 */
export function selectSlot(session: GarageSession, catalog: Catalog, slot: Slot): GarageSession {
  if (slot.kind === 'mount') return tapMount(session, catalog, slot.mountId);
  const open = activeSlot(session, catalog);
  if (open?.kind === slot.kind && session.focusPartId === null)
    return { ...session, view: 'car', targetMountId: null };
  return {
    ...session,
    view: 'parts',
    category: slot.kind,
    selection: { kind: 'none' },
    targetMountId: null,
    focusPartId: null,
    flagged: [],
  };
}

/**
 * Opens the whole catalog at a category. Nothing on the car stays selected, so an accessory
 * bought from here goes to the best free mount unless the player picks another.
 */
export function browse(session: GarageSession, category?: PartCategory): GarageSession {
  const next = category ?? (ACCESSORY.includes(session.category) ? session.category : 'weapon');
  if (
    session.view === 'browse' &&
    session.category === next &&
    session.focusPartId === null &&
    session.selection.kind === 'none'
  )
    return session;
  return {
    ...session,
    view: 'browse',
    category: next,
    selection: { kind: 'none' },
    targetMountId: null,
    focusPartId: null,
    flagged: [],
  };
}

export function dismissNotice(session: GarageSession): GarageSession {
  return session.notice || session.flagged.length > 0
    ? { ...session, notice: null, flagged: [] }
    : session;
}

// --- The build clock and Ready ------------------------------------------------------------------

/** Whole seconds left on the clock, never negative. Null when no clock is running. */
export function secondsLeft(session: GarageSession, now: number): number | null {
  if (session.deadline === null) return null;
  return Math.max(0, Math.ceil((session.deadline - now) / 1000));
}

/** The first error that keeps the draft out of a race, or null when it is legal. */
export function blockingIssue(
  blueprint: VehicleBlueprint,
  catalog: Catalog,
): BlueprintIssue | null {
  const check = validateBlueprint(blueprint, catalog);
  return check.ok ? null : (check.issues.find((i) => i.severity === 'error') ?? null);
}

/** Ready: locks the present build if, and only if, the validator accepts it. */
export function ready(session: GarageSession, catalog: Catalog): GarageSession {
  if (!building(session)) return session;
  const check = validateBlueprint(currentBlueprint(session), catalog);
  if (!check.ok) {
    const issue = check.issues.find((i) => i.severity === 'error');
    return issue ? refused(session, issue) : session;
  }
  return {
    ...session,
    phase: 'locked',
    locked: check.blueprint,
    lockReason: 'ready',
    lastLegal: check.blueprint,
    notice: note(session, 'ok', STRINGS.garage.readyToRace),
  };
}

/**
 * Locks the last legal snapshot when the clock runs out (Section 5.6). The draft on screen
 * may be anything; what races is the newest build the validator accepted, so there is never
 * an overspend. A server deadline drives this the same way: set `deadline`, call `tick`.
 */
export function tick(session: GarageSession, now: number): GarageSession {
  if (!building(session) || session.deadline === null || now < session.deadline) return session;
  return lockWith(session, session.lastLegal, 'timer');
}

/** Locks a given snapshot, for a server that owns the build phase. */
export function lockWith(
  session: GarageSession,
  snapshot: VehicleBlueprint,
  reason: 'ready' | 'timer' = 'timer',
): GarageSession {
  if (!building(session)) return session;
  return {
    ...session,
    phase: 'locked',
    locked: snapshot,
    lockReason: reason,
    selection: { kind: 'none' },
    view: 'car',
    targetMountId: null,
    notice: note(session, 'warn', STRINGS.garage.locked),
  };
}

/** Moves the deadline, for a server-owned build phase. */
export function setDeadline(session: GarageSession, deadline: number | null): GarageSession {
  return building(session) ? { ...session, deadline } : session;
}
