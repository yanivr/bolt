import { DEFAULT_LOADOUT } from '@bolt/content';
import type { BlueprintIssue, Catalog, RemovedPart, VehicleBlueprint } from '@bolt/shared';
import {
  MAX_BLUEPRINT_NAME_LENGTH,
  blueprintRecordIdSchema,
  blueprintSchema,
  buildHash,
  canonicalizeBlueprint,
  isCanonicalCarCode,
  own,
  repairBlueprint,
  sanitizeBlueprintName,
  validateBlueprint,
} from '@bolt/shared';

/**
 * My Blueprints, kept in local storage: the library works offline and never depends on the
 * server to keep a car. A car that has been shared carries its server code (Section 5.12); the
 * code names the exact build that was shared, so editing the car (rename, repair) drops it and
 * the next share issues a new one. The old code keeps naming the old build.
 *
 * Everything read back is untrusted: an older build wrote it, or the player edited it. Each
 * entry goes through the strict blueprint schema and then the validator. An entry that is
 * not a blueprint at all is dropped. An entry that is a blueprint but no longer legal (a
 * balance patch moved a price, or its chassis was retired) is kept and flagged, so the
 * player can repair it. A car on a retired chassis is rebuilt on the Beetle.
 */

export const LIBRARY_KEY = 'bolt.blueprints.v1';
export const LIBRARY_VERSION = 1;
export const MAX_SAVED_BLUEPRINTS = 30;

export type SavedBlueprint = {
  /** Stable within this browser. */
  id: string;
  blueprint: VehicleBlueprint;
  /** ISO 8601. */
  savedAt: string;
  /** The server code issued for this exact build, and the server record's id for deleting it. */
  share?: SavedShare;
};

export type SavedShare = { code: string; id: string };

export type LibraryEntry = SavedBlueprint & {
  legal: boolean;
  totalCost: number;
  buildHash: string;
  /** Errors that keep it out of a race. Empty when legal. */
  issues: BlueprintIssue[];
};

type StoredLibrary = { version: number; items: SavedBlueprint[] };

export type LibraryStorage = Pick<Storage, 'getItem' | 'setItem'>;

const ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T[\d:.]{5,15}Z$/;

function entry(saved: SavedBlueprint, catalog: Catalog): LibraryEntry {
  const check = validateBlueprint(saved.blueprint, catalog);
  return {
    ...saved,
    legal: check.ok,
    totalCost: check.totalCost,
    buildHash: buildHash(saved.blueprint),
    issues: check.issues.filter((i) => i.severity === 'error'),
  };
}

/** Parses whatever is in storage. Never throws; anything unreadable is left out. */
export function parseLibrary(raw: string | null, catalog: Catalog): LibraryEntry[] {
  if (raw === null || raw.length > 600_000) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return [];
  const stored = parsed as Partial<StoredLibrary>;
  if (stored.version !== LIBRARY_VERSION || !Array.isArray(stored.items)) return [];
  const entries: LibraryEntry[] = [];
  const seen = new Set<string>();
  for (const item of stored.items as unknown[]) {
    if (entries.length >= MAX_SAVED_BLUEPRINTS) break;
    if (typeof item !== 'object' || item === null) continue;
    const { id, blueprint, savedAt, share } = item as Record<string, unknown>;
    if (typeof id !== 'string' || !ID_PATTERN.test(id) || seen.has(id)) continue;
    const shaped = blueprintSchema.safeParse(blueprint);
    if (!shaped.success) continue;
    seen.add(id);
    const shared = readShare(share);
    entries.push(
      entry(
        {
          id,
          blueprint: canonicalizeBlueprint(shaped.data),
          savedAt:
            typeof savedAt === 'string' && TIME_PATTERN.test(savedAt)
              ? savedAt
              : shaped.data.createdAt,
          ...(shared ? { share: shared } : {}),
        },
        catalog,
      ),
    );
  }
  return entries;
}

/** A stored share, or nothing: a malformed one is dropped, never trusted. */
function readShare(value: unknown): SavedShare | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { code, id } = value as Record<string, unknown>;
  if (!isCanonicalCarCode(code) || !blueprintRecordIdSchema.safeParse(id).success) return undefined;
  return { code, id: id as string };
}

export function readLibrary(storage: LibraryStorage | null, catalog: Catalog): LibraryEntry[] {
  try {
    return parseLibrary(storage?.getItem(LIBRARY_KEY) ?? null, catalog);
  } catch {
    // Storage is blocked (private browsing, disabled cookies): an empty garage, not a crash.
    return [];
  }
}

export function serializeLibrary(entries: readonly SavedBlueprint[]): string {
  const stored: StoredLibrary = {
    version: LIBRARY_VERSION,
    items: entries.map(({ id, blueprint, savedAt, share }) => ({
      id,
      blueprint: canonicalizeBlueprint(blueprint),
      savedAt,
      ...(share ? { share: { code: share.code, id: share.id } } : {}),
    })),
  };
  return JSON.stringify(stored);
}

/** Writes the library. Returns false when the browser refused, so the screen can say so. */
export function writeLibrary(
  storage: LibraryStorage | null,
  entries: readonly SavedBlueprint[],
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(LIBRARY_KEY, serializeLibrary(entries));
    return true;
  } catch {
    return false;
  }
}

function freshId(entries: readonly SavedBlueprint[], seed: number): string {
  const used = new Set(entries.map((e) => e.id));
  for (let n = 0; ; n++) {
    const id = `b${(seed + n).toString(36)}`;
    if (!used.has(id)) return id;
  }
}

export type LibraryChange =
  | { ok: true; entries: LibraryEntry[]; entry: LibraryEntry }
  | { ok: false; entries: LibraryEntry[]; reason: 'full' | 'duplicate' | 'missing' };

/**
 * Saves a car as a new card. Drafts that are not legal may be saved too (Section 5.6); they
 * are flagged. Saving the very same car under the same name twice is refused as a duplicate.
 */
export function addBlueprint(
  entries: readonly LibraryEntry[],
  blueprint: VehicleBlueprint,
  catalog: Catalog,
  now: Date,
): LibraryChange {
  const list = [...entries];
  if (list.length >= MAX_SAVED_BLUEPRINTS) return { ok: false, entries: list, reason: 'full' };
  const canonical = canonicalizeBlueprint(blueprint);
  const hash = buildHash(canonical);
  if (
    list.some(
      (e) =>
        e.buildHash === hash &&
        e.blueprint.name === canonical.name &&
        e.blueprint.paintId === canonical.paintId,
    )
  )
    return { ok: false, entries: list, reason: 'duplicate' };
  const added = entry(
    { id: freshId(list, now.getTime()), blueprint: canonical, savedAt: now.toISOString() },
    catalog,
  );
  return { ok: true, entries: [added, ...list], entry: added };
}

/** A free name for a copy: "Rookie 2", "Rookie 3", within the 24-character limit. */
export function copyName(entries: readonly SavedBlueprint[], name: string): string {
  const used = new Set(entries.map((e) => e.blueprint.name.toLowerCase()));
  const stem = name.replace(/ \d+$/, '');
  for (let n = 2; n < 1000; n++) {
    const suffix = ` ${n}`;
    const candidate = sanitizeBlueprintName(
      stem.slice(0, MAX_BLUEPRINT_NAME_LENGTH - suffix.length).trim() + suffix,
      name,
    );
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return name;
}

export function duplicateBlueprint(
  entries: readonly LibraryEntry[],
  id: string,
  catalog: Catalog,
  now: Date,
): LibraryChange {
  const list = [...entries];
  const at = list.findIndex((e) => e.id === id);
  const source = list[at];
  if (!source) return { ok: false, entries: list, reason: 'missing' };
  if (list.length >= MAX_SAVED_BLUEPRINTS) return { ok: false, entries: list, reason: 'full' };
  // A copy is a new card with a new name: it has no code until it is shared itself.
  const copy = entry(
    {
      id: freshId(list, now.getTime()),
      blueprint: { ...source.blueprint, name: copyName(list, source.blueprint.name) },
      savedAt: now.toISOString(),
    },
    catalog,
  );
  list.splice(at + 1, 0, copy);
  return { ok: true, entries: list, entry: copy };
}

export function renameSaved(
  entries: readonly LibraryEntry[],
  id: string,
  rawName: string,
  catalog: Catalog,
): LibraryChange {
  const list = [...entries];
  const at = list.findIndex((e) => e.id === id);
  const source = list[at];
  if (!source) return { ok: false, entries: list, reason: 'missing' };
  const name = sanitizeBlueprintName(rawName, source.blueprint.name);
  // The code names the build as it was shared, name included; a renamed car shares anew.
  const { share: _old, ...rest } = source;
  const kept = name === source.blueprint.name ? source : rest;
  const renamed = entry({ ...kept, blueprint: { ...source.blueprint, name } }, catalog);
  list[at] = renamed;
  return { ok: true, entries: list, entry: renamed };
}

export function deleteSaved(entries: readonly LibraryEntry[], id: string): LibraryEntry[] {
  return entries.filter((e) => e.id !== id);
}

/**
 * Records the code the server issued for a card, when the card still holds the build that was
 * shared (the player may have renamed it while the request was in flight).
 */
export function attachShare(
  entries: readonly LibraryEntry[],
  id: string,
  share: SavedShare,
  sharedHash: string,
  sharedName: string,
): LibraryChange {
  const list = [...entries];
  const at = list.findIndex((e) => e.id === id);
  const source = list[at];
  if (!source || source.buildHash !== sharedHash || source.blueprint.name !== sharedName)
    return { ok: false, entries: list, reason: 'missing' };
  const shared: LibraryEntry = { ...source, share: { code: share.code, id: share.id } };
  list[at] = shared;
  return { ok: true, entries: list, entry: shared };
}

/** Clears every card's code, for a guest that no longer exists on the server. */
export function clearShares(entries: readonly LibraryEntry[]): LibraryEntry[] {
  return entries.map((e) => {
    if (!e.share) return e;
    const { share: _gone, ...rest } = e;
    return rest;
  });
}

/** The frame a saved car is rebuilt on when its own chassis has left the catalog. */
export const REPAIR_CHASSIS_ID = DEFAULT_LOADOUT.chassisId;

export type LibraryRepair =
  | {
      ok: true;
      entries: LibraryEntry[];
      entry: LibraryEntry;
      removed: RemovedPart[];
      /** Set when the saved chassis was retired and the car was moved to this one. */
      rebuiltOn: string | null;
    }
  | { ok: false; entries: LibraryEntry[] };

/**
 * Runs the Section 15.6 auto-repair on a flagged card and stores the result in its place:
 * the build is re-stamped for the current catalog and optional parts come off, priciest
 * first, until it is legal. A car whose chassis has been retired is moved onto the Beetle,
 * keeping its engine, wheel kit and every part that still fits. What was removed is reported,
 * never hidden.
 */
export function repairSaved(
  entries: readonly LibraryEntry[],
  id: string,
  catalog: Catalog,
): LibraryRepair {
  const list = [...entries];
  const at = list.findIndex((e) => e.id === id);
  const source = list[at];
  if (!source) return { ok: false, entries: list };
  const retired = !own(catalog.chassis, source.blueprint.chassisId);
  const result = repairBlueprint(source.blueprint, catalog, {
    fallbackChassisId: REPAIR_CHASSIS_ID,
  });
  if (!result.ok) return { ok: false, entries: list };
  const { share: _shared, ...unshared } = source;
  const repaired = entry({ ...unshared, blueprint: result.blueprint }, catalog);
  list[at] = repaired;
  return {
    ok: true,
    entries: list,
    entry: repaired,
    removed: result.removed,
    rebuiltOn: retired ? result.blueprint.chassisId : null,
  };
}
