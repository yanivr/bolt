# Garage API

Reference for the garage UI engineer and for the artists drawing the remaining parts. It
covers the data and rules half of Milestone B: the catalog, blueprints, validation, editing,
build stats and the geometry that parts and mounts share.

Everything here is pure TypeScript with no browser or Node dependency. The garage calls the
same functions the server calls, so a build the garage shows as legal is a build the server
accepts, and a number the garage shows is the number the race uses.

```ts
import { CATALOG, CATALOG_VERSION, TEMPLATES, partsByCategory, partCard, conditionsFor } from '@bolt/content';
import {
  validateBlueprint, installPart, removePart, movePart, rotatePart, swapChassis, swapEngine,
  swapTires, assignActionSlot, suggestMount, repairBlueprint, computeBuildStats,
  compareBuildStats, createHistory, pushHistory, undo, redo, buildHash, serializeBlueprint,
} from '@bolt/shared';
```

Every shared function takes the catalog as an argument (`CATALOG` from `@bolt/content`).
Nothing is mutated anywhere: every function returns new values, and a blueprint may be frozen.

Contents: [Geometry](#geometry) · [Blueprints](#blueprints) · [Catalog](#the-catalog-and-part-cards)
· [Validation](#validation) · [Editing](#editing) · [Build stats](#build-stats) ·
[Rules in brief](#rules-in-brief) · [Sprites](#sprites-for-artists) · [Part table](#every-part) ·
[Chassis layouts](#every-chassis)

## Geometry

- **Chassis-local coordinates.** Origin at the body centre. **Front is negative Y, right is
  positive X.** Units are world pixels, the same pixels the track and the sprites use. The
  Beetle body is 34 x 58.
- **Footprint.** `{ w, h }` in world pixels at rotation 0: `w` across the car, `h` along it.
  For a weapon, rotation 0 points the muzzle at the front of the car.
- **Rotation** is in quarter turns clockwise seen from above: `0` forward, `1` right, `2`
  rear, `3` left. Odd turns swap the footprint: a part 8 x 12 at rotation 1 occupies 12 x 8.
  `rotatedFootprint(footprint, turns)` does this.
- **Mount.** A named hardpoint with a centre `(x, y)`, a `maxFootprint` and an installation
  region `regionHalfW`, `regionHalfH`. A part fits when its rotated footprint is no larger
  than `maxFootprint` in either direction.
- **Offset.** `offsetX`, `offsetY` on an installed part move it from the mount centre, in
  whole pixels, by at most the region half-extents. The part's centre is
  `(mount.x + offsetX, mount.y + offsetY)` and its mass sits there.
- **Part box.** The centre plus and minus half the rotated footprint. `placePart` and
  `installedParts(blueprint, catalog)` return it as `rect: { x0, y0, x1, y1 }` with the
  centre in `x`, `y` and the rotated size in `w`, `h`.
- **Clearance.** Two part boxes conflict when they are closer than 2 px on both axes. The
  same rule applies between a part box and a wheel well.
- **Wheel well.** An 8 x 14 box centred on each wheel anchor, whatever wheel kit is fitted.
  Wheel kit footprints are sprite sizes only.
- **Mount layout rules** every chassis obeys (tested): each mount's `maxFootprint` box keeps
  2 px clear of every wheel well and of every other mount's box, overhangs the body outline
  by at most 4 px, and left and right mounts are mirrored pairs (the Chameleon is the
  specified exception). So two parts that each fit their mount fit together until one is
  nudged toward the other.
- **The engine** sits inside the body at `engine_bay`, below deck level. Accessory mounts may
  be above it, and an engine never conflicts with a mounted part. Any engine fits any chassis.
- **Allowed rotations.** `mount.allowedQuarterTurns` lists the orientations a rotatable part
  may take there, default first. Front mounts allow `0 3 1`, rear mounts `2 3 1`, left mounts
  `3 0 2`, right mounts `1 0 2` (never back across the cabin); roof, utility and universal
  mounts allow all four, and so do the Crab's side mounts. A part with `rotatable: false`
  must stay at rotation 0. `allowedRotations(mount, part)` gives the list for a pair.
- **Which mount takes which part.** `mountAccepts(mount, part)`: a `UNIVERSAL` mount takes any
  accessory; the Horseshoe's `front_cavity` (`acceptsAnyWeapon`) takes any weapon; otherwise
  the mount's categories and the part's `compatibleMounts` must share an entry.
- **Racks.** `mount.capacity` is how many `hardpointUse: 'shared'` parts may sit on the mount
  together (they must still clear each other, so they need offsets). A `'full'` part always
  takes the whole mount. Most mounts have capacity 1.

## Blueprints

```ts
type VehicleBlueprint = {
  formatVersion: 1;
  catalogVersion: string;      // CATALOG_VERSION at the time it was built
  name: string;                // 1 to 24 characters: letters, digits, space and ' . ! ? & + # -
  chassisId: string;
  engineId: string;
  tireKitId: string;
  paintId: string;
  parts: Array<{
    instanceId: string;        // unique within the blueprint; the helpers issue p1, p2, ...
    partId: string;
    mountId: string;
    offsetX: number;           // whole pixels after canonicalization
    offsetY: number;
    rotationQuarterTurns: 0 | 1 | 2 | 3;
    assignedActionSlot?: 0 | 1;  // primary or secondary fire button
    autoMode?: boolean;          // a hybrid weapon left to fire by itself
  }>;
  createdAt: string;           // ISO 8601
};
```

| Function | Purpose |
| :-- | :-- |
| `canonicalizeBlueprint(bp)` | Offsets snapped to whole pixels, parts sorted by mount then part id, optional fields only when set, fixed key order. |
| `serializeBlueprint(bp)` | Stable JSON of the canonical form. Use for storage and transport. |
| `buildHash(bp)` | SHA-256, lower-case hex, of the mechanical JSON: catalog version, chassis, engine, wheel kit, and each part's mount, id, offset, rotation, fire button and auto flag. **Not** the name, paint, creation time or instance ids. The same car bought in any order has the same hash. |
| `blueprintSchema` | zod schema for untrusted input: strict (unknown keys are refused), bounded sizes, closed character sets, finite numbers. |
| `sanitizeBlueprintName(raw)` | Turns what a player typed into an allowed name. |
| `baselineBlueprint({ chassisId?, engineId?, tireKitId?, paintId? }, name?)` (content) | A bare car. Omitted ids default to the chassis' `defaultEngineId` and Street Tires. |
| `resolveBlueprint(bp, catalog)` | Looks every id up. Returns `{ chassis, engine, tires, parts: PlacedPart[], unresolved }` or `null` when an essential is unknown. Does not judge legality. |
| `blueprintCost(bp, catalog)` | `{ chassis, engine, tires, parts, total, lines }` from catalog prices. The wheel kit is `round(price * wheelCount / 4)`. |

Fire control, per Section 8.3:

- A **manual** weapon fires only from a button: `assignedActionSlot` 0 or 1. Without one it
  is installed but inactive, and the validator warns (`WEAPON_INACTIVE`).
- A **hybrid** weapon takes a button (manual confirmation) or `autoMode: true`, not both.
- An **automatic** weapon takes neither.
- Each button holds one weapon, so at most two weapons are manually fired.
- Manual utilities (spare wheel, repair kit, nitro and so on) do not use these slots. They are
  activated by part instance in the race protocol, which arrives with Milestone C.

## The catalog and part cards

`CATALOG` holds `chassis`, `engines`, `tires`, `parts` (weapons, defenses and utilities) and
`paints`, each keyed by id, plus `version`. `GET /api/v1/catalog` returns the same data as
arrays, with the shipped templates.

```ts
partsByCategory('weapon');            // the 20 weapons, in Section 11 table order
allParts();                           // all 120
getPart('utility_fan');               // any part by id; never resolves inherited names
partCard(part, wheelCount?);          // what a card shows
```

`partCard` returns everything Section 5.6 puts on a card:

| Field | Meaning |
| :-- | :-- |
| `price` | Exact credits. For a wheel kit, adjusted for `wheelCount` (default 4). |
| `massKg` | Weight. For a wheel kit, adjusted for `wheelCount`. |
| `powerPerSecond` | Energy draw (positive) or output (negative) per second. For weapons this is energy per shot divided by cooldown, the draw at the fastest rate of fire. |
| `heatPerSecond` | Heat effect per second: positive heats, negative cools. Engines: heat at sustained full throttle. |
| `charges` | Uses per match, or 0 when not limited by charges. |
| `benefit` | The one-line benefit (`description`). |
| `downside` | The one-line downside (`drawback`). |
| `triggerMode` | `manual`, `automatic`, `hybrid` or `passive`. |
| `maxPerCar` | Limit per car, or `null`. |
| `spriteKey` | Equal to the part id. |

Further fields on the definitions themselves: `footprint`, `compatibleMounts`, `soundKey`,
`behaviorId`, `params` (every number of the part's effect, flat), `actions` (the same effect
as Section 11.8 active primitives, for Milestone C), `modifiers` (passive primitives), and for
accessories `hardpointUse`, `rotatable`, `heightLevel`. Chassis add `wheelAnchors`, `mounts`,
`bodyHalfWidth`, `bodyHalfLength`, `recommendedLoadKg`, `maxLoadKg`, `baseIntegrity`,
`stabilityThreshold`, `armorLoadShare`, `defaultEngineId` and `handling`. Engines add
`forceIndex`, `heatPerSecond`, `powerDraw` and `curve`. Wheel kits add `grip` and `powerDraw`.

Templates: `TEMPLATES` (also `STARTER_TEMPLATES`, `EXAMPLE_TEMPLATES`, `BASELINE_BLUEPRINT`,
`ROOKIE_BLUEPRINT`, `getTemplate(id)`). Each is `{ id, group, name, description, blueprint }`
and every blueprint is legal.

## Validation

```ts
validateBlueprint(blueprint: VehicleBlueprint, catalog: Catalog): BlueprintValidation
validateUntrustedBlueprint(input: unknown, catalog: Catalog): BlueprintValidation  // never throws
```

Use `validateUntrustedBlueprint` at every boundary (a request body, a pasted code, local
storage). It accepts an object or a JSON string, bounds its size, parses it with
`blueprintSchema` and then validates. Use `validateBlueprint` for blueprints your own code
built.

```ts
type BlueprintValidation =
  | { ok: true;  blueprint; buildHash; totalCost; creditsLeft; loadKg; build; issues }  // warnings only
  | { ok: false; blueprint; totalCost; creditsLeft; loadKg; issues };

type BlueprintIssue = {
  code: BlueprintIssueCode;
  severity: 'error' | 'warning';
  message: string;            // short player copy for the highlight
  hint?: string;              // longer approved sentence, when there is one
  instanceId?: string;        // the offending installed part
  partId?: string;
  mountId?: string;
  otherInstanceId?: string;   // the other party to a conflict
  slot?: 'chassis' | 'engine' | 'tires' | 'paint';
  detail?: Record<string, number | string>;
};
```

`blueprint` in the result is the canonical form: store and race that. `ok` is true when there
are no errors; warnings do not block a race. Issues come in a stable order. Parts are judged
in canonical order, so of two parts in conflict the later one in that order is reported, with
the earlier in `otherInstanceId`. After an edit the helpers report the part the player just
touched instead.

| Code | Severity | Player copy (`message`) | When |
| :-- | :-- | :-- | :-- |
| `MALFORMED` | error | We couldn't read that car. Check the code and try again. | Untrusted input failed the schema or the size bound. |
| `UNSUPPORTED_FORMAT` | error | This build was saved by a newer version of the game. | `formatVersion` is not 1. |
| `CATALOG_MISMATCH` | error | This build uses older part values. Review it before racing. | `catalogVersion` differs from the catalog's. `repairBlueprint` re-stamps it. |
| `BAD_NAME` | error | Use letters, numbers and simple punctuation in the name. | Name outside the allowed set or length. |
| `UNKNOWN_PART` | error | This part is no longer available. | An id the catalog does not have. `slot` or `instanceId` says where. |
| `MISSING_ESSENTIAL` | error | Your car needs an engine and a complete set of wheels. | A mandatory slot holds something that is not that kind of part. |
| `DUPLICATE_INSTANCE` | error | This part is listed twice. | Two parts share an `instanceId`. |
| `UNKNOWN_MOUNT` | error | No compatible mount | The chassis has no mount of that id. |
| `NO_COMPATIBLE_MOUNT` | error | No compatible mount | The mount does not take this part, or the car has nowhere for it. |
| `PART_TOO_LARGE` | error | Too large for this mount. | Rotated footprint exceeds `maxFootprint`. `detail` has `w`, `h`, `maxW`, `maxH`. |
| `BAD_ROTATION` | error | This part can't face that way here. | Rotation not allowed on this mount, or the part cannot rotate. |
| `OUT_OF_REGION` | error | Too far from the mount. | Offset beyond the installation region. |
| `MOUNT_OCCUPIED` | error | This mount is full. | A full-hardpoint part shares its mount, or a rack is over capacity. |
| `PART_BLOCKS_ANOTHER` | error | This part blocks another attachment. | Two part boxes closer than 2 px. When the blocked part is a Swivel Turret the message is `This part blocks your turret`. |
| `OVERLAPS_WHEEL` | error | This part blocks a wheel. | A part box closer than 2 px to a wheel well. `detail.wheelId` names it. |
| `ONE_PER_CAR` | error | One per car | A second copy of a part with `maxPerCar: 1`. |
| `PART_LIMIT` | error | You have the most a car can carry of this part. | Past a `maxPerCar` above 1. |
| `TOO_MANY_REPAIR_ITEMS` | error | A car can carry one spare wheel and two repair kits. | A third repair kit, or more than three repair units. |
| `TOO_MANY_WEAPONS` | error | A car can carry six weapons. | A seventh offensive module. |
| `TOO_MANY_MANUAL_WEAPONS` | error | Only two weapons can have a fire button. | Two weapons on the same button. |
| `BAD_ACTION_SLOT` | error | This part can't use a fire button. | A button on an automatic weapon or a non-weapon. |
| `BAD_AUTO_MODE` | error | This part can't fire on its own. | `autoMode` on anything but a hybrid, or together with a button. |
| `TOO_MUCH_ARMOR` | error | Too much armor for this chassis. | Armor plate mass over the chassis allowance. |
| `TOO_HEAVY` | error | Too much weight | Installed mass over `maxLoadKg`. `hint`: `Too heavy for this chassis. Remove weight or swap frames.` |
| `NOT_ENOUGH_CREDITS` | error | Not enough credits | Total over 1,000. `detail` has `totalCost`, `budget`, `over`. |
| `WEAPON_INACTIVE` | warning | This weapon has no fire button and will stay inactive. | A manual or hybrid weapon with neither a button nor auto mode. |

The copy lives in `BLUEPRINT_ISSUE_COPY`, `TURRET_BLOCKED_COPY` and `OVERWEIGHT_HINT`.

On the wire, a drive-room join carries `blueprint`. The server refuses with
`ILLEGAL_BUILD` (4423), `UNKNOWN_PART` (4422), `CATALOG_MISMATCH` (4426) or `BAD_REQUEST`
(4400, schema failure). The refusal message is the first issue's `hint` or `message`.

## Editing

Every edit returns an `EditResult`:

```ts
type EditResult =
  | { ok: true;  blueprint: VehicleBlueprint; spend: SpendBreakdown; removed: RemovedPart[]; instanceId?: string }
  | { ok: false; blueprint: VehicleBlueprint; issue: BlueprintIssue };   // blueprint is the unchanged input

type SpendBreakdown = { newSpend: number; refund: number; net: number; totalCost: number; creditsLeft: number };
type RemovedPart   = { instance: BlueprintPart; refund: number; reason: BlueprintIssueCode; message: string };
type Placement     = { mountId: string; offsetX: number; offsetY: number; rotationQuarterTurns: 0 | 1 | 2 | 3 };
```

An edit is accepted unless it introduces an error the blueprint did not already have, or
makes a budget or weight overrun worse. So nothing is ever spent past 1,000 credits, and a
draft that arrives illegal (an imported build after a balance patch) can still be moved
toward legality one edit at a time. `spend` always shows new spend and refund separately.

| Function | Behaviour |
| :-- | :-- |
| `installPart(bp, catalog, partId, placement?: Partial<Placement>)` | Buys and installs. With no placement, uses `suggestMount`. With only `mountId`, picks the first legal rotation and offset on that mount. With a full placement, uses it exactly. A manual or hybrid weapon takes the first free fire button; with both taken a hybrid goes automatic and a manual weapon is installed inactive. `instanceId` in the result is the new part. |
| `removePart(bp, catalog, instanceId)` | Sells the part for its full price. |
| `movePart(bp, catalog, instanceId, to: Partial<Placement>)` | Moves within the region, to another mount, or both. A change of mount resets the offset and, when the current rotation is not allowed or does not fit there, picks the first that does. Costs nothing. |
| `rotatePart(bp, catalog, instanceId, turns?)` | Sets a rotation, or with no argument steps to the next one that is legal where the part is. |
| `swapChassis(bp, catalog, chassisId)` | One atomic step. Each part goes to the mount of the same id if it fits, else the nearest mount of the same category, else any mount that takes it; parts with nowhere to go, and armor over the new allowance, are removed, refunded and listed in `removed`. The wheel kit is re-priced for the new wheel count. Refused whole (`NOT_ENOUGH_CREDITS` or `TOO_HEAVY`) if the result would be over budget or over weight. |
| `swapEngine(bp, catalog, engineId)` | Replaces the engine. |
| `swapTires(bp, catalog, tireKitId)` | Replaces the whole wheel kit, priced for the chassis wheel count. |
| `assignActionSlot(bp, catalog, instanceId, slot: 0 \| 1 \| 'auto' \| null)` | Binds a weapon to a button, taking it from whichever weapon had it (a displaced hybrid goes automatic, a displaced manual weapon inactive); `'auto'` makes a hybrid automatic; `null` makes the weapon inactive. |
| `setPaint(bp, catalog, paintId)`, `renameBlueprint(bp, catalog, name)` | Cosmetic. Free, and the build hash does not change. |
| `suggestMount(bp, catalog, partId): Placement \| null` | The best free mount with a legal offset and rotation, or `null` when the car has nowhere for the part. Prefers the mount categories the part lists first, then the smallest mount that fits, and shares a rack only when nothing else is free. A suggestion is always accepted by `installPart`. |
| `compareCost(before, after, catalog): SpendBreakdown` | New spend and refund between any two blueprints. |
| `repairBlueprint(bp, catalog): RepairResult` | The auto-repair of Section 15.6. Re-stamps the catalog version, then removes optional parts until the build is legal: parts an error points at first, otherwise any part, always the most expensive first. Never touches the chassis, engine or wheel kit. Returns `{ ok, blueprint, removed, spend }`, or `{ ok: false, blueprint, removed, issues }` when the essentials themselves are illegal. The input is untouched: save the result as a new revision. |
| `installedParts(bp, catalog): PlacedPart[]` | Installed parts in canonical order with their mount, centre, rotated size and box, for drawing the workbench. |
| `nextInstanceId(bp)` | The id the next install will use. |

Undo and redo are a plain value, capped at the 20 transactions Section 6.6 asks for:

```ts
let history = createHistory(BASELINE_BLUEPRINT);          // { past, present, future }
const edit = installPart(history.present, CATALOG, 'weapon_front_mg');
if (edit.ok) history = pushHistory(history, edit.blueprint);
history = undo(history);                                   // present is the baseline again
history = redo(history);
```

A chassis swap is one `pushHistory`, so it is one undo step.

### Examples

```ts
import { BASELINE_BLUEPRINT, CATALOG } from '@bolt/content';

// Install on the best free mount. The machine gun lands on front_center, on fire button 0.
const a = installPart(BASELINE_BLUEPRINT, CATALOG, 'weapon_front_mg');
// a.ok === true
// a.spend => { newSpend: 70, refund: 0, net: 70, totalCost: 440, creditsLeft: 560 }
// a.instanceId === 'p1'

// A refusal names the reason in approved copy and returns the blueprint unchanged.
const b = installPart(a.blueprint, CATALOG, 'weapon_saw');
// b.ok === false, b.issue.code === 'NO_COMPATIBLE_MOUNT', b.issue.message === 'No compatible mount'

// Nudge, then turn.
const c = movePart(a.blueprint, CATALOG, 'p1', { offsetX: 2 });
const d = rotatePart(c.blueprint, CATALOG, 'p1');          // next allowed orientation: 1

// Swap frames. Everything that fits is carried over; the rest comes back refunded.
const e = swapChassis(d.blueprint, CATALOG, 'chassis_arrow');
// e.spend => { newSpend: 180, refund: 150, ... }, e.removed === []

// Preview a part before buying it.
const conditions = conditionsFor('city_01', 'city_rain_night')!;
const before = computeBuildStats(a.blueprint, CATALOG, conditions)!;
const trial = installPart(a.blueprint, CATALOG, 'defense_heavy_plate');
if (trial.ok) {
  const delta = compareBuildStats(before, computeBuildStats(trial.blueprint, CATALOG, conditions)!);
  // delta.scores.defense.delta > 0, delta.scores.speed.delta < 0, trial.spend.newSpend === 110
}
```

## Build stats

```ts
computeBuildStats(blueprint, catalog, conditions?): BuildStats | null
compareBuildStats(before: BuildStats, after: BuildStats): BuildStatsDelta
conditionsFor(trackId, weatherPresetId): BuildConditions | undefined   // from @bolt/content
```

`conditions` is the published track and weather: `{ weather, timeOfDay, surfaceMix? }`.
Without it a clear day on asphalt is assumed. `null` comes back only when the chassis, engine
or wheel kit is unknown; an illegal draft still gets full stats with `legal: false`.

```ts
type BuildStats = {
  buildHash: string;
  legal: boolean;                       // would the server accept it as it stands
  issues: BlueprintIssue[];             // the validator's list
  indicators: { budget; load; energy; heat; stability };
  scores: { speed; control; defense; firepower; utility };   // whole numbers 0 to 100
  details: { speed; control; defense; firepower; utility };  // measurements and lines
  warnings: Array<{ code; message }>;
  mass: { totalKg; loadKg; recommendedKg; maxKg; overload; comX; comY };
};
```

Every indicator has `gauge` (0 to 1, for the bar), `status` (`'ok' | 'caution' | 'over'`) and
`lines` (plain-English sentences for the detail popover, most important first), plus its raw
numbers:

| Indicator | Raw fields | Gauge | Status |
| :-- | :-- | :-- | :-- |
| `budget` | `credits` (1000), `spent`, `left` | `spent / 1000` | `over` when `left < 0` |
| `load` | `loadKg`, `recommendedKg`, `maxKg`, `totalMassKg`, `recommendedMark` | `loadKg / maxKg`; draw a tick at `recommendedMark` | `caution` above recommended, `over` above max |
| `energy` | `drawPerSecond`, `generationPerSecond`, `batteryCapacity`, `burstReserve`, `ratio`, `batterySeconds` | `ratio / 2`, so the limit is mid-bar | `caution` above 1, `over` above 1.5 |
| `heat` | `productionPerSecond`, `coolingPerSecond`, `ratio`, `equilibriumHeat` | `ratio / 2`, so the limit is mid-bar | `caution` above 1, `over` above 1.25 |
| `stability` | `score` (10 to 100), `threshold`, `raw`, `powered`, and each term of the formula | `score / 100` | `caution` below `threshold` |

How each is computed:

- **Load** is installed mass: engine, wheel kit scaled to the wheel count, and every mounted
  part. The chassis' own mass is not load. Above recommended, the car loses up to 18% of its
  drive force and 25% of its braking and makes up to 12% more engine heat, in proportion to
  how far it is toward the maximum.
- **Energy** `ratio` is peak sustained draw over generation. Draw is the electric drivetrain
  at full throttle, every continuous consumer, and every active weapon firing as fast as its
  cooldown allows. Generation is the base 10 a second plus generators, plus solar for the
  published time of day and weather. `batterySeconds` is how long a full battery covers the
  shortfall, or `null`.
- **Heat** `ratio` is sustained production over cooling capacity at the car's performance
  threshold (90, or 75 with a Rotary) under the published weather. At 1.0 a car held flat out
  settles exactly on that threshold. `equilibriumHeat` is where it settles.
- **Stability** is `100 - lateralWeightPenalty - highCenterPenalty - wheelbasePenalty -
  damagePenalty + stabilizationBonus`, clamped to 10 to 100, from the real centre of mass
  (part positions and masses), the wheel anchors, tall and roof-mounted parts, tire grip and
  stabilisers. Below `threshold` the car loses cornering grip progressively.

Scores, each a whole number from 0 to 100:

| Score | Formula |
| :-- | :-- |
| `speed` | `100 * (0.5 * norm(topSpeed, 170, 370) + 0.5 * norm(distance8s, 600, 1500))`. Top speed (px/s) and the distance covered in the first 8 seconds come from running the real powertrain flat out for 30 seconds on each surface of the track's mix under the published weather, weighted by the mix. |
| `control` | `100 * (0.5 * norm(cornerGrip, 0.35, 1.3) + 0.2 * stability / 100 + 0.15 * norm(brake, 0.6, 1.1) + 0.1 * norm(yaw, 0.8, 1.1) + 0.05 * norm(slideGrip, 0.7, 1))`. Corner grip is the mix-weighted grip for the weather with instability applied; brake and yaw are relative to the default car. |
| `defense` | `100 * norm(effectiveHp, 70, 420)`, where effective hit points are chassis integrity, armor on all arcs, each damage reduction weighted by how common that damage is, and shields and reactive parts valued over a 120-second race. |
| `firepower` | `100 * (1 - exp(-threat / 12))`. Threat sums, for each weapon that can fire, damage plus control effects per second of cooldown, scaled by how wide it can aim, its reach, its trigger mode and its charges. Inactive weapons count for nothing. |
| `utility` | `100 * (1 - exp(-points / 25))`. Points come from repairs carried, cooling and power added, handling aids, boosts and sensors. |

`norm(v, lo, hi)` is `(v - lo) / (hi - lo)` clamped to 0 to 1. `details` carries the inputs:
`speed.topSpeedMph`, `speed.zeroToSixtySeconds` (`null` when the car never reaches 60 MPH),
`control.cornerGrip`, `defense.effectiveHp`, `firepower.activeWeapons` and so on, each with
its own `lines`.

Warnings use approved copy (`STATS_WARNING_COPY`):

| Code | Message |
| :-- | :-- |
| `RUNS_HOT` | This build runs hot. Add cooling or manage your throttle. |
| `LOW_POWER` | Not enough power for every system at once. |
| `OVER_RECOMMENDED_LOAD` | Over the recommended load. Expect slower acceleration and longer braking. |
| `OVER_MAX_LOAD` | Too heavy for this chassis. Remove weight or swap frames. |
| `UNSTABLE` | This build is unstable. It will slide wide in fast corners. |
| `OVER_BUDGET` | Not enough credits |

`compareBuildStats` returns `scores` (the five scores) and `indicators` (`creditsLeft`, `loadKg`,
`energyRatio`, `heatRatio`, `stability`), each entry `{ before, after, delta, better }` where `better` is `true`,
`false` or `null` (no change), plus `newWarnings`, `clearedWarnings`, `becomesLegal` and
`becomesIllegal`. One preview (an edit, two stat computations and a comparison) takes a few
milliseconds.

## Rules in brief

- Exactly one chassis, one engine and one wheel kit. Total cost at most 1,000 credits.
- Installed mass at most the chassis `maxLoadKg`.
- Armor plate (defenses with `params.armorPlate: true`) at most `armorLimitKg(chassis)`: 45% of
  the maximum load, 15% less on the Buggy, and 27% of it on the Needle, which also has only
  one armor-capable mount.
- At most six weapons. At most two on fire buttons. One spare wheel, two repair kits, three
  repair units in all. Parts with `maxPerCar` are limited to that many.
- Plates mount on `ARMOR`-capable mounts and protect the arc they face (rotation). Side
  Shields protect both sides from either side mount. Bumpers go front or rear only.
- Chassis specials: the Horseshoe's `front_cavity` takes any weapon and is the largest mount
  in the game; Crab side mounts allow all four rotations and widen aim by 45 degrees;
  Scorpion rear mounts add 8% range; the Wagon's two racks and the Pickup's two cargo mounts
  have capacity 2; the Platform and Chameleon are all universal mounts.

## Sprites, for artists

- `spriteKey` equals the part id. Chassis, engine and wheel sheets go in the car atlas
  manifest under `chassis`, `engines` and `wheels`, as today. Mounted parts go under the new
  optional `parts` record (`PartSpriteManifest` in `packages/shared/src/assets.ts`): one
  frame per heading, packed like a chassis sheet.
- Size a mounted part's art to its footprint in the table below at heading 0, `w` across and
  `h` along the car, muzzle or leading edge toward the top of the frame. Connectors, bolts
  and cables may spill a pixel or two outside; the footprint is what the rules keep clear.
- Model each chassis around its mounts and wheel anchors in the layout tables. A part must
  look attached at the mount centre and still look attached when nudged to the edge of the
  mount's region.
- `tests/unit/assets.test.ts` holds `SPRITES_PENDING`, the ids with no art yet. When a sheet
  lands in the manifest, remove its id from that list; the test fails until the list and the
  atlas agree, in both directions. Today the atlas has 4 chassis, 1 engine and 1 wheel kit.
- Until then the client offers only chassis that have art (`drawableChassisIds`) and draws an
  engine or wheel kit without art using the Four-Cylinder and Street Tires sheets
  (`resolveCarSprites`). That substitution is for drawing only. The physics, the validation
  and the build hash always use the real blueprint.

## Every part

Generated by `npx tsx tests/tools/catalogTables.ts`; `tests/unit/docs.test.ts` fails when
this table and the catalog disagree. Hardpoint: `full` takes the whole mount, `shared` may
share a rack. Turns: whether the part can be rotated. Height: 0 flush, 1 raised, 2 tall.

<!-- BEGIN PART TABLE -->
| Part id | Name | Footprint w x h | Compatible mounts | Hardpoint | Turns | Height | Trigger | Max per car |
| :-- | :-- | :-- | :-- | :-- | :-- | --: | :-- | --: |
| `chassis_beetle` | Beetle | 34 x 58 | body | n/a | n/a | n/a | passive | n/a |
| `chassis_needle` | Needle | 26 x 72 | body | n/a | n/a | n/a | passive | n/a |
| `chassis_turtle` | Turtle | 42 x 62 | body | n/a | n/a | n/a | passive | n/a |
| `chassis_spider` | Spider | 48 x 68 | body | n/a | n/a | n/a | passive | n/a |
| `chassis_crab` | Crab | 56 x 60 | body | n/a | n/a | n/a | passive | n/a |
| `chassis_cobra` | Cobra | 32 x 74 | body | n/a | n/a | n/a | passive | n/a |
| `chassis_scorpion` | Scorpion | 34 x 72 | body | n/a | n/a | n/a | passive | n/a |
| `chassis_buggy` | Buggy | 34 x 56 | body | n/a | n/a | n/a | passive | n/a |
| `chassis_chameleon` | Chameleon | 38 x 68 | body | n/a | n/a | n/a | passive | n/a |
| `chassis_brick` | Brick | 52 x 76 | body | n/a | n/a | n/a | passive | n/a |
| `chassis_trike` | Trike | 26 x 48 | body | n/a | n/a | n/a | passive | n/a |
| `chassis_arrow` | Arrow | 28 x 62 | body | n/a | n/a | n/a | passive | n/a |
| `chassis_wagon` | Wagon | 40 x 80 | body | n/a | n/a | n/a | passive | n/a |
| `chassis_rammer` | Rammer | 46 x 68 | body | n/a | n/a | n/a | passive | n/a |
| `chassis_drifter` | Drifter | 34 x 60 | body | n/a | n/a | n/a | passive | n/a |
| `chassis_kangaroo` | Kangaroo | 38 x 64 | body | n/a | n/a | n/a | passive | n/a |
| `chassis_horseshoe` | Horseshoe | 44 x 70 | body | n/a | n/a | n/a | passive | n/a |
| `chassis_pickup` | Pickup | 38 x 74 | body | n/a | n/a | n/a | passive | n/a |
| `chassis_twins` | Twins | 56 x 72 | body | n/a | n/a | n/a | passive | n/a |
| `chassis_platform` | Platform | 48 x 72 | body | n/a | n/a | n/a | passive | n/a |
| `engine_mini_electric` | Mini Electric | 12 x 10 | ENGINE | n/a | n/a | n/a | passive | n/a |
| `engine_four_cylinder` | Four-Cylinder | 18 x 14 | ENGINE | n/a | n/a | n/a | passive | n/a |
| `engine_v6` | V6 | 18 x 14 | ENGINE | n/a | n/a | n/a | passive | n/a |
| `engine_v8` | V8 | 20 x 16 | ENGINE | n/a | n/a | n/a | passive | n/a |
| `engine_v12` | V12 | 20 x 18 | ENGINE | n/a | n/a | n/a | passive | n/a |
| `engine_small_turbo` | Small Turbo | 16 x 14 | ENGINE | n/a | n/a | n/a | passive | n/a |
| `engine_twin_turbo` | Twin Turbo | 20 x 16 | ENGINE | n/a | n/a | n/a | passive | n/a |
| `engine_supercharger` | Supercharger | 20 x 16 | ENGINE | n/a | n/a | n/a | passive | n/a |
| `engine_diesel` | Torque Diesel | 20 x 16 | ENGINE | n/a | n/a | n/a | passive | n/a |
| `engine_electric_sport` | Sport Electric | 18 x 12 | ENGINE | n/a | n/a | n/a | passive | n/a |
| `engine_electric_eco` | Eco Electric | 16 x 12 | ENGINE | n/a | n/a | n/a | passive | n/a |
| `engine_hybrid` | Hybrid | 18 x 16 | ENGINE | n/a | n/a | n/a | passive | n/a |
| `engine_rotary` | Rotary | 14 x 12 | ENGINE | n/a | n/a | n/a | passive | n/a |
| `engine_turbine` | Turbine | 16 x 18 | ENGINE | n/a | n/a | n/a | passive | n/a |
| `engine_rocket` | Rocket Engine | 16 x 18 | ENGINE | n/a | n/a | n/a | passive | n/a |
| `engine_twin` | Twin Drive | 22 x 16 | ENGINE | n/a | n/a | n/a | passive | n/a |
| `engine_spring` | Spring Drive | 16 x 14 | ENGINE | n/a | n/a | n/a | passive | n/a |
| `engine_offroad` | Trail Engine | 18 x 16 | ENGINE | n/a | n/a | n/a | passive | n/a |
| `engine_resilient` | Ironheart | 18 x 16 | ENGINE | n/a | n/a | n/a | passive | n/a |
| `engine_experimental` | Wildcard Motor | 16 x 14 | ENGINE | n/a | n/a | n/a | passive | n/a |
| `tires_slick` | Slicks | 8 x 14 | WHEEL | n/a | n/a | n/a | passive | n/a |
| `tires_street` | Street Tires | 8 x 14 | WHEEL | n/a | n/a | n/a | passive | n/a |
| `tires_rain` | Rain Runners | 8 x 14 | WHEEL | n/a | n/a | n/a | passive | n/a |
| `tires_sand` | Sand Paddles | 8 x 14 | WHEEL | n/a | n/a | n/a | passive | n/a |
| `tires_mud` | Mud Claws | 8 x 14 | WHEEL | n/a | n/a | n/a | passive | n/a |
| `tires_snow` | Snow Treads | 8 x 14 | WHEEL | n/a | n/a | n/a | passive | n/a |
| `tires_ice` | Ice Spikes | 8 x 14 | WHEEL | n/a | n/a | n/a | passive | n/a |
| `tires_soft` | Soft Compound | 8 x 14 | WHEEL | n/a | n/a | n/a | passive | n/a |
| `tires_hard` | Hard Compound | 8 x 14 | WHEEL | n/a | n/a | n/a | passive | n/a |
| `tires_drift` | Drift Rings | 8 x 14 | WHEEL | n/a | n/a | n/a | passive | n/a |
| `tires_armored` | Armored Tires | 8 x 14 | WHEEL | n/a | n/a | n/a | passive | n/a |
| `tires_solid` | Solid Core | 8 x 14 | WHEEL | n/a | n/a | n/a | passive | n/a |
| `tires_balloon` | Balloon Tires | 8 x 14 | WHEEL | n/a | n/a | n/a | passive | n/a |
| `tires_monster` | Monster Wheels | 8 x 14 | WHEEL | n/a | n/a | n/a | passive | n/a |
| `tires_micro` | Micro Wheels | 8 x 14 | WHEEL | n/a | n/a | n/a | passive | n/a |
| `tires_halftrack` | Half Tracks | 8 x 14 | WHEEL | n/a | n/a | n/a | passive | n/a |
| `tires_track` | Full Tracks | 8 x 14 | WHEEL | n/a | n/a | n/a | passive | n/a |
| `tires_magnetic` | Magnetic Rollers | 8 x 14 | WHEEL | n/a | n/a | n/a | passive | n/a |
| `tires_adaptive` | Adaptive Tires | 8 x 14 | WHEEL | n/a | n/a | n/a | passive | n/a |
| `tires_blades` | Razor Wheels | 8 x 14 | WHEEL | n/a | n/a | n/a | passive | n/a |
| `weapon_front_mg` | Front Machine Gun | 8 x 12 | FRONT, ROOF, LEFT, RIGHT, REAR | shared | yes | 0 | manual | n/a |
| `weapon_rear_mg` | Rear Sentry | 8 x 10 | REAR, ROOF, LEFT, RIGHT | shared | yes | 0 | automatic | n/a |
| `weapon_turret` | Swivel Turret | 12 x 12 | ROOF, FRONT, REAR | full | yes | 2 | hybrid | n/a |
| `weapon_shotgun` | Road Shotgun | 8 x 12 | FRONT, ROOF, LEFT, RIGHT, REAR | shared | yes | 0 | manual | n/a |
| `weapon_railshot` | Needle Railgun | 8 x 18 | FRONT, ROOF | full | yes | 1 | hybrid | n/a |
| `weapon_rocket` | Straight Rocket | 8 x 14 | FRONT, ROOF, LEFT, RIGHT, REAR | full | yes | 0 | manual | n/a |
| `weapon_homing` | Seeker Missile | 10 x 14 | ROOF, REAR, FRONT | full | yes | 1 | hybrid | n/a |
| `weapon_mine` | Road Mine | 10 x 8 | REAR, UTILITY | shared | no | 0 | manual | n/a |
| `weapon_oil` | Oil Slick | 10 x 8 | REAR, UTILITY | shared | no | 0 | manual | n/a |
| `weapon_foam` | Sticky Foam | 10 x 12 | FRONT, ROOF, LEFT, RIGHT | full | yes | 0 | manual | n/a |
| `weapon_emp` | EMP Pulse | 12 x 12 | ROOF, UTILITY | full | no | 1 | manual | 1 |
| `weapon_tesla` | Tesla Arc | 8 x 8 | ROOF, LEFT, RIGHT, FRONT, REAR | shared | no | 1 | automatic | n/a |
| `weapon_flame` | Flame Spitter | 8 x 14 | FRONT, LEFT, RIGHT, REAR | full | yes | 0 | manual | n/a |
| `weapon_frost` | Frost Cannon | 8 x 14 | FRONT, ROOF, LEFT, RIGHT, REAR | full | yes | 0 | manual | n/a |
| `weapon_hammer` | Crash Hammer | 12 x 16 | FRONT, LEFT, RIGHT | full | yes | 1 | manual | n/a |
| `weapon_saw` | Side Saw | 6 x 14 | LEFT, RIGHT | full | no | 0 | automatic | n/a |
| `weapon_harpoon` | Grapple Harpoon | 8 x 14 | FRONT, ROOF, LEFT, RIGHT, REAR | full | yes | 0 | manual | 1 |
| `weapon_air` | Air Cannon | 10 x 12 | FRONT, ROOF, LEFT, RIGHT, REAR | full | yes | 0 | manual | n/a |
| `weapon_boomerang` | Steel Boomerang | 12 x 8 | FRONT, ROOF, LEFT, RIGHT | full | yes | 0 | manual | n/a |
| `weapon_mortar` | Arc Mortar | 16 x 16 | ROOF, REAR | full | no | 2 | hybrid | n/a |
| `defense_light_plate` | Light Plates | 12 x 4 | ARMOR | full | yes | 0 | passive | 4 |
| `defense_heavy_plate` | Heavy Plating | 14 x 6 | ARMOR | full | yes | 0 | passive | 4 |
| `defense_front_bumper` | Crash Bumper | 14 x 5 | FRONT | full | no | 0 | passive | 1 |
| `defense_rear_bumper` | Rear Guard | 14 x 5 | REAR | full | no | 0 | passive | 1 |
| `defense_side_panels` | Side Shields | 5 x 14 | LEFT, RIGHT | full | no | 0 | passive | 1 |
| `defense_wheel_cage` | Wheel Cage | 8 x 10 | UTILITY, ROOF, ARMOR | full | no | 0 | passive | 1 |
| `defense_engine_case` | Engine Shell | 8 x 12 | UTILITY, ROOF, ARMOR | full | no | 0 | passive | 1 |
| `defense_ceramic` | Ceramic Panels | 8 x 12 | UTILITY, ROOF, ARMOR | full | no | 0 | passive | 1 |
| `defense_breakaway` | Breakaway Armor | 8 x 10 | UTILITY, ROOF, ARMOR | full | no | 0 | automatic | 1 |
| `defense_composite` | Composite Shell | 8 x 12 | UTILITY, ROOF, ARMOR | full | no | 0 | passive | 1 |
| `defense_energy_shield` | Energy Shield | 10 x 10 | ROOF, UTILITY | full | no | 1 | automatic | 1 |
| `defense_faraday` | Faraday Cage | 8 x 10 | UTILITY, ROOF, ARMOR | full | no | 0 | passive | 1 |
| `defense_heatguard` | Heat Guard | 8 x 8 | UTILITY, ROOF, ARMOR | shared | no | 0 | passive | 1 |
| `defense_antimissile` | Missile Interceptor | 10 x 10 | ROOF | full | no | 1 | automatic | 1 |
| `defense_minesweeper` | Mine Sweeper | 12 x 6 | FRONT | full | no | 0 | automatic | 1 |
| `defense_fireproof` | Fireproof Lining | 8 x 8 | UTILITY, ROOF, ARMOR | shared | no | 0 | passive | 1 |
| `defense_oilproof` | Grip Coating | 8 x 8 | UTILITY, ROOF, ARMOR | shared | no | 0 | passive | 1 |
| `defense_damper` | Shock Dampers | 8 x 10 | UTILITY, ROOF, ARMOR | full | no | 0 | passive | 1 |
| `defense_steer_assist` | Steering Stabilizer | 8 x 8 | UTILITY, ROOF, ARMOR | shared | no | 0 | passive | 1 |
| `defense_reactive` | Reactive Foam | 8 x 12 | UTILITY, ROOF, ARMOR | full | no | 0 | automatic | 1 |
| `utility_spare` | Spare Wheel | 8 x 12 | UTILITY, ROOF, REAR, LEFT, RIGHT | shared | no | 0 | manual | 1 |
| `utility_repair` | Repair Kit | 8 x 8 | UTILITY, ROOF, REAR, LEFT, RIGHT | shared | no | 0 | manual | 2 |
| `utility_fan` | Cooling Fan | 8 x 8 | UTILITY, ROOF, FRONT, REAR, LEFT, RIGHT | shared | no | 0 | passive | 2 |
| `utility_radiator` | Racing Radiator | 14 x 6 | FRONT, UTILITY, ROOF | full | no | 0 | passive | 2 |
| `utility_battery` | Extra Battery | 8 x 10 | UTILITY, ROOF, REAR, LEFT, RIGHT | shared | no | 0 | passive | 3 |
| `utility_generator` | Auxiliary Generator | 8 x 12 | UTILITY, ROOF, REAR, LEFT, RIGHT | shared | no | 0 | passive | 2 |
| `utility_capacitor` | Burst Capacitor | 8 x 8 | UTILITY, ROOF, REAR, LEFT, RIGHT | shared | no | 0 | automatic | 1 |
| `utility_nitro` | Nitro Tank | 8 x 14 | UTILITY, ROOF, REAR, LEFT, RIGHT | full | no | 0 | manual | 1 |
| `utility_overdrive` | Emergency Booster | 8 x 12 | UTILITY, ROOF, REAR, LEFT, RIGHT | shared | no | 0 | manual | 1 |
| `utility_traction` | Traction Computer | 8 x 8 | UTILITY, ROOF, REAR, LEFT, RIGHT | shared | no | 0 | passive | 1 |
| `utility_gyro` | Gyro Stabilizer | 8 x 10 | UTILITY, ROOF, REAR, LEFT, RIGHT | shared | no | 0 | passive | 1 |
| `utility_radar` | Radar | 8 x 8 | ROOF, UTILITY | shared | no | 1 | passive | 1 |
| `utility_minesensor` | Mine Detector | 8 x 6 | FRONT, UTILITY, ROOF | shared | no | 0 | automatic | 1 |
| `utility_decoy` | Decoy Drone | 8 x 10 | UTILITY, ROOF, REAR, LEFT, RIGHT | shared | no | 0 | manual | 1 |
| `utility_jump` | Jump Pad | 14 x 12 | UTILITY, REAR | full | no | 0 | manual | 1 |
| `utility_winch` | Recovery Winch | 8 x 10 | FRONT, UTILITY, LEFT, RIGHT | shared | no | 0 | manual | 1 |
| `utility_ballast` | Sliding Ballast | 8 x 12 | UTILITY, ROOF, REAR, LEFT, RIGHT | shared | no | 0 | automatic | 1 |
| `utility_spoiler` | Active Wing | 16 x 6 | REAR, ROOF | full | no | 2 | automatic | 1 |
| `utility_targeting` | Turret Computer | 8 x 8 | UTILITY, ROOF, REAR | shared | no | 0 | passive | 1 |
| `utility_solar` | Solar Panel | 14 x 10 | ROOF, UTILITY | full | no | 0 | passive | 2 |
<!-- END PART TABLE -->

## Every chassis

Generated by the same script. Coordinates are chassis-local world pixels. Turns are listed
default first.

<!-- BEGIN CHASSIS TABLES -->
#### Beetle (`chassis_beetle`)

Body 34 x 58. Engine bay at (0, 20). Wheels: `front_left` (-14.5, -17) steers; `front_right` (14.5, -17) steers; `rear_left` (-14.5, 17.5) driven; `rear_right` (14.5, 17.5) driven.

| Mount id | Categories | Centre x, y | Max footprint w x h | Region +/- x, y | Turns allowed | Capacity |
| :-- | :-- | :-- | :-- | :-- | :-- | --: |
| `front_center` | FRONT, ARMOR | 0, -22 | 16 x 12 | 2, 2 | 0 3 1 | 1 |
| `roof_mid` | ROOF | 0, 0 | 14 x 14 | 2, 2 | 0 1 2 3 | 1 |
| `left_utility` | UTILITY | -13, 0 | 8 x 14 | 2, 2 | 0 1 2 3 | 1 |
| `right_utility` | UTILITY | 13, 0 | 8 x 14 | 2, 2 | 0 1 2 3 | 1 |
| `rear_center` | REAR, ARMOR | 0, 23 | 16 x 10 | 2, 2 | 2 3 1 | 1 |

#### Needle (`chassis_needle`)

Body 26 x 72. Engine bay at (0, 22). Wheels: `front_left` (-11, -11) steers; `front_right` (11, -11) steers; `rear_left` (-11.5, 22) driven; `rear_right` (11.5, 22) driven.

| Mount id | Categories | Centre x, y | Max footprint w x h | Region +/- x, y | Turns allowed | Capacity |
| :-- | :-- | :-- | :-- | :-- | :-- | --: |
| `front_nose` | FRONT, ARMOR | 0, -29 | 14 x 18 | 2, 2 | 0 3 1 | 1 |
| `front_spine` | FRONT | 0, -11 | 10 x 12 | 2, 2 | 0 3 1 | 1 |
| `roof_mid` | ROOF | 0, 5 | 12 x 14 | 2, 2 | 0 1 2 3 | 1 |
| `roof_rear` | ROOF | 0, 22 | 10 x 12 | 2, 2 | 0 1 2 3 | 1 |

#### Turtle (`chassis_turtle`)

Body 42 x 62. Engine bay at (0, 21). Wheels: `front_left` (-15.5, -19) steers; `front_right` (15.5, -19) steers; `rear_left` (-15.5, 19.5) driven; `rear_right` (15.5, 19.5) driven.

| Mount id | Categories | Centre x, y | Max footprint w x h | Region +/- x, y | Turns allowed | Capacity |
| :-- | :-- | :-- | :-- | :-- | :-- | --: |
| `front_center` | FRONT, ARMOR | 0, -24 | 18 x 12 | 2, 2 | 0 3 1 | 1 |
| `roof_front` | ROOF | 0, -11 | 16 x 10 | 2, 2 | 0 1 2 3 | 1 |
| `roof_mid` | ROOF | 0, 2 | 16 x 12 | 3, 2 | 0 1 2 3 | 1 |
| `roof_rear` | ROOF | 0, 14 | 16 x 8 | 2, 2 | 0 1 2 3 | 1 |
| `left_mid` | LEFT, ARMOR | -16.5, 0 | 8 x 18 | 2, 2 | 3 0 2 | 1 |
| `right_mid` | RIGHT, ARMOR | 16.5, 0 | 8 x 18 | 2, 2 | 1 0 2 | 1 |
| `rear_center` | REAR, ARMOR | 0, 25 | 18 x 10 | 2, 2 | 2 3 1 | 1 |

#### Spider (`chassis_spider`)

Body 48 x 68. Engine bay at (0, 24). Wheels: `front_left` (-22.5, -24) steers; `front_right` (22.5, -24) steers; `mid_left` (-24.5, 0) driven; `mid_right` (24.5, 0) driven; `rear_left` (-22.5, 24) driven; `rear_right` (22.5, 24) driven.

| Mount id | Categories | Centre x, y | Max footprint w x h | Region +/- x, y | Turns allowed | Capacity |
| :-- | :-- | :-- | :-- | :-- | :-- | --: |
| `front_utility` | UTILITY | 0, -28 | 14 x 8 | 2, 2 | 0 1 2 3 | 1 |
| `left_front` | LEFT, ARMOR | -12, -14 | 8 x 14 | 2, 2 | 3 0 2 | 1 |
| `right_front` | RIGHT, ARMOR | 12, -14 | 8 x 14 | 2, 2 | 1 0 2 | 1 |
| `roof_front` | ROOF | 0, -14 | 12 x 14 | 2, 2 | 0 1 2 3 | 1 |
| `roof_mid` | ROOF | 0, 2 | 12 x 14 | 2, 2 | 0 1 2 3 | 1 |
| `left_rear` | LEFT, ARMOR | -12, 14 | 8 x 14 | 2, 2 | 3 0 2 | 1 |
| `right_rear` | RIGHT, ARMOR | 12, 14 | 8 x 14 | 2, 2 | 1 0 2 | 1 |
| `rear_utility` | UTILITY | 0, 17 | 12 x 12 | 2, 2 | 0 1 2 3 | 1 |

#### Crab (`chassis_crab`)

Body 56 x 60. Engine bay at (0, 20). Wheels: `front_left` (-12, -18) steers; `front_right` (12, -18) steers; `rear_left` (-12, 18) driven; `rear_right` (12, 18) driven.

| Mount id | Categories | Centre x, y | Max footprint w x h | Region +/- x, y | Turns allowed | Capacity |
| :-- | :-- | :-- | :-- | :-- | :-- | --: |
| `left_front` | LEFT, ARMOR | -24, -17 | 12 x 12 | 2, 2 | 3 0 2 1 | 1 |
| `right_front` | RIGHT, ARMOR | 24, -17 | 12 x 12 | 2, 2 | 1 0 2 3 | 1 |
| `left_mid` | LEFT, ARMOR | -24, 0 | 12 x 16 | 2, 2 | 3 0 2 1 | 1 |
| `right_mid` | RIGHT, ARMOR | 24, 0 | 12 x 16 | 2, 2 | 1 0 2 3 | 1 |
| `left_rear` | LEFT, ARMOR | -24, 17 | 12 x 12 | 2, 2 | 3 0 2 1 | 1 |
| `right_rear` | RIGHT, ARMOR | 24, 17 | 12 x 12 | 2, 2 | 1 0 2 3 | 1 |
| `roof_front` | ROOF | 0, -12 | 12 x 12 | 2, 2 | 0 1 2 3 | 1 |
| `roof_mid` | ROOF | 0, 2 | 12 x 12 | 2, 2 | 0 1 2 3 | 1 |

#### Cobra (`chassis_cobra`)

Body 32 x 74. Engine bay at (0, 22). Wheels: `front_left` (-13, -12) steers; `front_right` (13, -12) steers; `rear_left` (-13.5, 23) driven; `rear_right` (13.5, 23) driven.

| Mount id | Categories | Centre x, y | Max footprint w x h | Region +/- x, y | Turns allowed | Capacity |
| :-- | :-- | :-- | :-- | :-- | :-- | --: |
| `front_nose` | FRONT, ARMOR | 0, -31 | 16 x 12 | 2, 2 | 0 3 1 | 1 |
| `front_spine` | FRONT | 0, -14 | 12 x 18 | 2, 2 | 0 3 1 | 1 |
| `roof_front` | ROOF | 0, 2 | 14 x 10 | 2, 2 | 0 1 2 3 | 1 |
| `roof_rear` | ROOF | 0, 15 | 12 x 12 | 2, 2 | 0 1 2 3 | 1 |
| `rear_deck` | REAR | 0, 27 | 12 x 8 | 2, 2 | 2 3 1 | 1 |
| `rear_center` | REAR, ARMOR | 0, 37 | 16 x 8 | 2, 2 | 2 3 1 | 1 |

#### Scorpion (`chassis_scorpion`)

Body 34 x 72. Engine bay at (0, 10). Wheels: `front_left` (-13, -18) steers; `front_right` (13, -18) steers; `rear_left` (-14.5, 14) driven; `rear_right` (14.5, 14) driven.

| Mount id | Categories | Centre x, y | Max footprint w x h | Region +/- x, y | Turns allowed | Capacity |
| :-- | :-- | :-- | :-- | :-- | :-- | --: |
| `roof_front` | ROOF | 0, -17 | 12 x 12 | 2, 2 | 0 1 2 3 | 1 |
| `roof_mid` | ROOF | 0, -2 | 14 x 12 | 2, 2 | 0 1 2 3 | 1 |
| `left_utility` | UTILITY | -13, -2 | 8 x 12 | 2, 2 | 0 1 2 3 | 1 |
| `right_utility` | UTILITY | 13, -2 | 8 x 12 | 2, 2 | 0 1 2 3 | 1 |
| `rear_center` | REAR, ARMOR | 0, 14 | 14 x 10 | 2, 2 | 2 3 1 | 1 |
| `rear_boom` | REAR | 0, 31 | 16 x 16 | 2, 2 | 2 3 1 | 1 |

#### Buggy (`chassis_buggy`)

Body 34 x 56. Engine bay at (0, 19). Wheels: `front_left` (-17, -17) steers; `front_right` (17, -17) steers; `rear_left` (-17, 17) driven; `rear_right` (17, 17) driven.

| Mount id | Categories | Centre x, y | Max footprint w x h | Region +/- x, y | Turns allowed | Capacity |
| :-- | :-- | :-- | :-- | :-- | :-- | --: |
| `front_center` | FRONT, ARMOR | 0, -22 | 16 x 12 | 2, 2 | 0 3 1 | 1 |
| `roof_front` | ROOF | 0, -8 | 14 x 12 | 2, 2 | 0 1 2 3 | 1 |
| `roof_rear` | ROOF | 0, 6 | 14 x 12 | 2, 2 | 0 1 2 3 | 1 |
| `left_utility` | UTILITY | -14, 0 | 8 x 14 | 2, 2 | 0 1 2 3 | 1 |
| `right_utility` | UTILITY | 14, 0 | 8 x 14 | 2, 2 | 0 1 2 3 | 1 |
| `rear_center` | REAR, ARMOR | 0, 22 | 16 x 10 | 2, 2 | 2 3 1 | 1 |

#### Chameleon (`chassis_chameleon`)

Body 38 x 68. Engine bay at (0, 20). Wheels: `front_left` (-15, -18) steers; `front_right` (15, -18) steers; `rear_left` (-15, 20) driven; `rear_right` (15, 20) driven.

| Mount id | Categories | Centre x, y | Max footprint w x h | Region +/- x, y | Turns allowed | Capacity |
| :-- | :-- | :-- | :-- | :-- | :-- | --: |
| `rail_front` | UNIVERSAL | 0, -28 | 16 x 10 | 2, 2 | 0 3 1 2 | 1 |
| `rail_hood` | UNIVERSAL | 0, -16 | 14 x 10 | 2, 2 | 0 1 2 3 | 1 |
| `rail_roof` | UNIVERSAL | -2, -2 | 12 x 12 | 2, 2 | 0 1 2 3 | 1 |
| `rail_right` | UNIVERSAL | 13, 1 | 8 x 16 | 2, 2 | 1 0 2 3 | 1 |
| `pod_left_front` | UNIVERSAL | -14, -4 | 8 x 8 | 2, 2 | 3 0 2 1 | 1 |
| `pod_left_rear` | UNIVERSAL | -14, 6 | 8 x 8 | 2, 2 | 3 0 2 1 | 1 |
| `rail_deck` | UNIVERSAL | 0, 11 | 14 x 10 | 2, 2 | 0 1 2 3 | 1 |
| `rail_rear` | UNIVERSAL | 0, 27 | 16 x 10 | 2, 2 | 2 3 1 0 | 1 |

#### Brick (`chassis_brick`)

Body 52 x 76. Engine bay at (0, 26). Wheels: `front_left` (-20, -24) steers; `front_right` (20, -24) steers; `rear_left` (-20, 24) driven; `rear_right` (20, 24) driven.

| Mount id | Categories | Centre x, y | Max footprint w x h | Region +/- x, y | Turns allowed | Capacity |
| :-- | :-- | :-- | :-- | :-- | :-- | --: |
| `front_center` | FRONT, ARMOR | 0, -32 | 24 x 10 | 2, 2 | 0 3 1 | 1 |
| `front_utility` | UTILITY | 0, -19 | 16 x 12 | 2, 2 | 0 1 2 3 | 1 |
| `left_front` | LEFT, ARMOR | -20, -7 | 10 x 12 | 2, 2 | 3 0 2 | 1 |
| `right_front` | RIGHT, ARMOR | 20, -7 | 10 x 12 | 2, 2 | 1 0 2 | 1 |
| `roof_mid` | ROOF | 0, 0 | 18 x 20 | 5, 4 | 0 1 2 3 | 2 |
| `left_rear` | LEFT, ARMOR | -20, 7 | 10 x 12 | 2, 2 | 3 0 2 | 1 |
| `right_rear` | RIGHT, ARMOR | 20, 7 | 10 x 12 | 2, 2 | 1 0 2 | 1 |
| `rear_utility` | UTILITY | 0, 19 | 16 x 12 | 2, 2 | 0 1 2 3 | 1 |
| `rear_center` | REAR, ARMOR | 0, 32 | 24 x 10 | 2, 2 | 2 3 1 | 1 |

#### Trike (`chassis_trike`)

Body 26 x 48. Engine bay at (0, 3). Wheels: `front_left` (-11.5, -13) steers; `front_right` (11.5, -13) steers; `rear_center` (0, 16) driven.

| Mount id | Categories | Centre x, y | Max footprint w x h | Region +/- x, y | Turns allowed | Capacity |
| :-- | :-- | :-- | :-- | :-- | :-- | --: |
| `front_center` | FRONT, ARMOR | 0, -15 | 10 x 14 | 2, 2 | 0 3 1 | 1 |
| `roof_mid` | ROOF | 0, 1 | 14 x 10 | 2, 2 | 0 1 2 3 | 1 |
| `left_rear` | REAR | -10.5, 15 | 8 x 12 | 2, 2 | 2 3 1 | 1 |
| `right_rear` | REAR | 10.5, 15 | 8 x 12 | 2, 2 | 2 3 1 | 1 |

#### Arrow (`chassis_arrow`)

Body 28 x 62. Engine bay at (0, 20). Wheels: `front_left` (-11.5, -14) steers; `front_right` (11.5, -14) steers; `rear_left` (-13, 19) driven; `rear_right` (13, 19) driven.

| Mount id | Categories | Centre x, y | Max footprint w x h | Region +/- x, y | Turns allowed | Capacity |
| :-- | :-- | :-- | :-- | :-- | :-- | --: |
| `front_center` | FRONT, ARMOR | 0, -29 | 14 x 12 | 2, 2 | 0 3 1 | 1 |
| `roof_mid` | ROOF | 0, 2 | 12 x 14 | 2, 2 | 0 1 2 3 | 1 |
| `roof_rear` | ROOF | 0, 17 | 12 x 12 | 2, 2 | 0 1 2 3 | 1 |
| `rear_center` | REAR, ARMOR | 0, 29 | 14 x 8 | 2, 2 | 2 3 1 | 1 |

#### Wagon (`chassis_wagon`)

Body 40 x 80. Engine bay at (0, -24). Wheels: `front_left` (-16.5, -24) steers; `front_right` (16.5, -24) steers; `rear_left` (-16.5, 22) driven; `rear_right` (16.5, 22) driven.

| Mount id | Categories | Centre x, y | Max footprint w x h | Region +/- x, y | Turns allowed | Capacity |
| :-- | :-- | :-- | :-- | :-- | :-- | --: |
| `roof_front` | ROOF | 0, -27 | 16 x 10 | 2, 2 | 0 1 2 3 | 1 |
| `roof_mid` | ROOF | 0, -13 | 18 x 14 | 3, 2 | 0 1 2 3 | 1 |
| `rack_upper` | UTILITY | 0, 1 | 18 x 10 | 5, 1 | 0 1 2 3 | 2 |
| `left_utility` | UTILITY | -15, 1 | 8 x 14 | 2, 2 | 0 1 2 3 | 1 |
| `right_utility` | UTILITY | 15, 1 | 8 x 14 | 2, 2 | 0 1 2 3 | 1 |
| `rack_deck` | UTILITY | 0, 13 | 18 x 10 | 5, 1 | 0 1 2 3 | 2 |
| `rear_rack` | REAR | 0, 25 | 18 x 10 | 2, 2 | 2 3 1 | 1 |
| `rear_center` | REAR, ARMOR | 0, 37 | 18 x 10 | 2, 2 | 2 3 1 | 1 |

#### Rammer (`chassis_rammer`)

Body 46 x 68. Engine bay at (0, 4). Wheels: `front_left` (-18, -18) steers; `front_right` (18, -18) steers; `rear_left` (-18, 20) driven; `rear_right` (18, 20) driven.

| Mount id | Categories | Centre x, y | Max footprint w x h | Region +/- x, y | Turns allowed | Capacity |
| :-- | :-- | :-- | :-- | :-- | :-- | --: |
| `front_ram` | FRONT, ARMOR | 0, -33 | 24 x 8 | 2, 2 | 0 3 1 | 1 |
| `front_left` | FRONT | -6.5, -20 | 10 x 12 | 2, 2 | 0 3 1 | 1 |
| `front_right` | FRONT | 6.5, -20 | 10 x 12 | 2, 2 | 0 3 1 | 1 |
| `left_shoulder` | LEFT, ARMOR | -18, -1 | 10 x 16 | 2, 2 | 3 0 2 | 1 |
| `right_shoulder` | RIGHT, ARMOR | 18, -1 | 10 x 16 | 2, 2 | 1 0 2 | 1 |
| `left_rear` | LEFT, ARMOR | -6.5, 22 | 10 x 14 | 2, 2 | 3 0 2 | 1 |
| `right_rear` | RIGHT, ARMOR | 6.5, 22 | 10 x 14 | 2, 2 | 1 0 2 | 1 |

#### Drifter (`chassis_drifter`)

Body 34 x 60. Engine bay at (0, -16). Wheels: `front_left` (-14, -17) steers; `front_right` (14, -17) steers; `rear_left` (-15.5, 18) driven; `rear_right` (15.5, 18) driven.

| Mount id | Categories | Centre x, y | Max footprint w x h | Region +/- x, y | Turns allowed | Capacity |
| :-- | :-- | :-- | :-- | :-- | :-- | --: |
| `roof_front` | ROOF | 0, -15 | 14 x 12 | 2, 2 | 0 1 2 3 | 1 |
| `roof_mid` | ROOF | 0, 0 | 12 x 14 | 2, 2 | 0 1 2 3 | 1 |
| `left_mid` | LEFT, ARMOR | -13, 0 | 8 x 14 | 2, 2 | 3 0 2 | 1 |
| `right_mid` | RIGHT, ARMOR | 13, 0 | 8 x 14 | 2, 2 | 1 0 2 | 1 |
| `rear_deck` | REAR | 0, 14 | 14 x 10 | 2, 2 | 2 3 1 | 1 |
| `rear_center` | REAR, ARMOR | 0, 26 | 16 x 10 | 2, 2 | 2 3 1 | 1 |

#### Kangaroo (`chassis_kangaroo`)

Body 38 x 64. Engine bay at (0, 20). Wheels: `front_left` (-16.5, -19) steers; `front_right` (16.5, -19) steers; `rear_left` (-16.5, 20) driven; `rear_right` (16.5, 20) driven.

| Mount id | Categories | Centre x, y | Max footprint w x h | Region +/- x, y | Turns allowed | Capacity |
| :-- | :-- | :-- | :-- | :-- | :-- | --: |
| `front_center` | FRONT, ARMOR | 0, -25 | 18 x 12 | 2, 2 | 0 3 1 | 1 |
| `utility_front` | UTILITY | 0, -11 | 16 x 12 | 2, 2 | 0 1 2 3 | 1 |
| `utility_mid` | UTILITY | 0, 4 | 16 x 14 | 3, 2 | 0 1 2 3 | 1 |
| `utility_rear` | UTILITY | 0, 17 | 14 x 8 | 2, 2 | 0 1 2 3 | 1 |
| `rear_center` | REAR, ARMOR | 0, 28 | 18 x 10 | 2, 2 | 2 3 1 | 1 |

#### Horseshoe (`chassis_horseshoe`)

Body 44 x 70. Engine bay at (0, 20). Wheels: `front_left` (-18, -14) steers; `front_right` (18, -14) steers; `rear_left` (-18, 22) driven; `rear_right` (18, 22) driven.

| Mount id | Categories | Centre x, y | Max footprint w x h | Region +/- x, y | Turns allowed | Capacity |
| :-- | :-- | :-- | :-- | :-- | :-- | --: |
| `front_cavity` | FRONT (any weapon) | 0, -22 | 20 x 26 | 2, 2 | 0 3 1 | 1 |
| `left_prong` | LEFT, ARMOR | -17, -30 | 8 x 12 | 2, 2 | 3 0 2 | 1 |
| `right_prong` | RIGHT, ARMOR | 17, -30 | 8 x 12 | 2, 2 | 1 0 2 | 1 |
| `front_brace` | FRONT | 0, -1 | 16 x 12 | 2, 2 | 0 3 1 | 1 |
| `left_mid` | LEFT, ARMOR | -17, 4 | 8 x 14 | 2, 2 | 3 0 2 | 1 |
| `right_mid` | RIGHT, ARMOR | 17, 4 | 8 x 14 | 2, 2 | 1 0 2 | 1 |

#### Pickup (`chassis_pickup`)

Body 38 x 74. Engine bay at (0, -22). Wheels: `front_left` (-15.5, -23) steers; `front_right` (15.5, -23) steers; `rear_left` (-15.5, 22) driven; `rear_right` (15.5, 22) driven.

| Mount id | Categories | Centre x, y | Max footprint w x h | Region +/- x, y | Turns allowed | Capacity |
| :-- | :-- | :-- | :-- | :-- | :-- | --: |
| `utility_hood` | UTILITY | 0, -26 | 14 x 10 | 2, 2 | 0 1 2 3 | 1 |
| `left_utility` | UTILITY | -15, -8 | 8 x 10 | 2, 2 | 0 1 2 3 | 1 |
| `right_utility` | UTILITY | 15, -8 | 8 x 10 | 2, 2 | 0 1 2 3 | 1 |
| `bed_front` | UTILITY | 0, 2 | 18 x 14 | 5, 2 | 0 1 2 3 | 2 |
| `left_bed` | REAR | -15, 6 | 8 x 12 | 2, 2 | 2 3 1 | 1 |
| `right_bed` | REAR | 15, 6 | 8 x 12 | 2, 2 | 2 3 1 | 1 |
| `bed_rear` | UTILITY | 0, 18 | 18 x 14 | 5, 2 | 0 1 2 3 | 2 |
| `rear_center` | REAR, ARMOR | 0, 32 | 18 x 10 | 2, 2 | 2 3 1 | 1 |

#### Twins (`chassis_twins`)

Body 56 x 72. Engine bay at (0, 20). Wheels: `front_left` (-22, -22) steers; `front_right` (22, -22) steers; `rear_left` (-22, 22) driven; `rear_right` (22, 22) driven.

| Mount id | Categories | Centre x, y | Max footprint w x h | Region +/- x, y | Turns allowed | Capacity |
| :-- | :-- | :-- | :-- | :-- | :-- | --: |
| `left_nose` | LEFT, ARMOR | -21, -35 | 10 x 8 | 2, 2 | 3 0 2 | 1 |
| `right_nose` | RIGHT, ARMOR | 21, -35 | 10 x 8 | 2, 2 | 1 0 2 | 1 |
| `roof_front` | ROOF | 0, -12 | 16 x 14 | 2, 2 | 0 1 2 3 | 1 |
| `left_front` | LEFT, ARMOR | -21, -7 | 12 x 10 | 2, 2 | 3 0 2 | 1 |
| `right_front` | RIGHT, ARMOR | 21, -7 | 12 x 10 | 2, 2 | 1 0 2 | 1 |
| `roof_rear` | ROOF | 0, 5 | 18 x 16 | 5, 3 | 0 1 2 3 | 2 |
| `left_rear` | LEFT, ARMOR | -21, 6 | 12 x 12 | 2, 2 | 3 0 2 | 1 |
| `right_rear` | RIGHT, ARMOR | 21, 6 | 12 x 12 | 2, 2 | 1 0 2 | 1 |

#### Platform (`chassis_platform`)

Body 48 x 72. Engine bay at (0, 18). Wheels: `front_left` (-20, -24) steers; `front_right` (20, -24) steers; `rear_left` (-20, 24) driven; `rear_right` (20, 24) driven.

| Mount id | Categories | Centre x, y | Max footprint w x h | Region +/- x, y | Turns allowed | Capacity |
| :-- | :-- | :-- | :-- | :-- | :-- | --: |
| `deck_front` | UNIVERSAL | 0, -29 | 20 x 12 | 2, 2 | 0 3 1 2 | 1 |
| `deck_fore` | UNIVERSAL | 0, -12 | 18 x 18 | 3, 2 | 0 1 2 3 | 1 |
| `left_edge_front` | UNIVERSAL | -18, -10 | 10 x 8 | 2, 2 | 3 0 2 1 | 1 |
| `right_edge_front` | UNIVERSAL | 18, -10 | 10 x 8 | 2, 2 | 1 0 2 3 | 1 |
| `left_edge_mid` | UNIVERSAL | -18, 0 | 10 x 8 | 2, 2 | 3 0 2 1 | 1 |
| `right_edge_mid` | UNIVERSAL | 18, 0 | 10 x 8 | 2, 2 | 1 0 2 3 | 1 |
| `left_edge_rear` | UNIVERSAL | -18, 10 | 10 x 8 | 2, 2 | 3 0 2 1 | 1 |
| `right_edge_rear` | UNIVERSAL | 18, 10 | 10 x 8 | 2, 2 | 1 0 2 3 | 1 |
| `deck_aft` | UNIVERSAL | 0, 8 | 18 x 18 | 5, 3 | 0 1 2 3 | 2 |
| `deck_rear` | UNIVERSAL | 0, 28 | 20 x 14 | 2, 2 | 2 3 1 0 | 1 |
<!-- END CHASSIS TABLES -->
