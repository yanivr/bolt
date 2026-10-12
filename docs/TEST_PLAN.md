# Test plan

What is tested, how to run it, and what cannot be tested from this repository. Section 19 of
the specification is the requirement list; rows are added here as milestones land.

## Commands

| Command                                                             | Scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| :------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                                         | ESLint over the whole workspace                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `pnpm typecheck`                                                    | `tsc -b` with strict settings across all packages                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `pnpm test`                                                         | Vitest: unit and integration (starts real servers on ephemeral ports)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `pnpm test:e2e`                                                     | Playwright against the production build in a phone-sized touch viewport                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `pnpm art:check`                                                    | Car atlases match the pipeline byte for byte                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `npx tsx tests/visual/capture.ts`                                   | Screenshots and a recording for visual review                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `npx tsx tests/visual/garage.ts <url> <dir> [sizes]`                | Garage states at 870x370, 667x375, 450x840 and 1440x900: the idle overview of each of the five chassis, focus on an empty slot, on a roof weapon, on the part nudged and turned, on the engine, on the outer mounts of a loaded Spider and the bed of a loaded Pickup, each of the five chassis with every mount filled, the compare pane, Browse All Parts, the idle Your Car panel, an illegal build                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `npx tsx tests/visual/loaded.ts <url> <dir>`                        | A race screenshot of each of the five starter cars, one a chassis                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `npx tsx tests/visual/card.ts <url> <dir>`                          | The occupied-slot card at 870x370, 870x340, 844x390, 667x375 and 450x840 (a roof weapon with a three-digit refund, a nose gun with one facing and the reason shown, non-directional parts, a fixed part, a hybrid with four fire choices), and the Road Shotgun on the Trike roof in all four facings in all four view headings                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `npx tsx art/scripts/preview-parts.ts [--check]`                    | Review sheets of the 60 mounted parts on the five chassis on all four paints, and fully loaded cars; `--check` prints cell margins and fails on a clipped part or an anchor off its drawing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `npx tsx tests/feel/report.ts`                                      | Handling tables for every chassis (yaw, slip, radius, direction steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `npx tsx tests/feel/pacingReport.ts`                                | Frame pacing of the shipped render pipeline at 60, 90 and 120 Hz                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `npx tsx tests/feel/buildsReport.ts`                                | Race time, top speed, launch, heat and stability of every shipped build                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `npx tsx tests/tools/syncGarageDoc.ts`                              | Regenerates the part and chassis tables in `docs/GARAGE_API.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `npx tsx tests/feel/netcodeReport.ts`                               | Prediction corrections under latency, jitter and frame hitches                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `npx tsx tests/scenarios/run.ts [id \| all]`                        | Lists the combat showcase scenarios, prints the event timeline of one, or runs every one and reports unmet expectations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `npx tsx tests/balance/report.ts [seeds] [clear \| rain] [bench]`   | Combat balance: every starter and example build against every other on Neon Cut, and the twenty-weapon bench, as Markdown                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `npx tsx tests/tools/combatTimelines.ts`                            | The per-weapon event sequence table of `docs/COMBAT_API.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `BOLT_AUDIO_EVIDENCE=1 npx playwright test tests/e2e/audio.spec.ts` | The audio tests, also writing WAV files, spectrograms and the measured tables to `docs/evidence/audio/`. `BOLT_AUDIO_SCENARIOS=id,id` limits the live scenario test to those                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `npx tsx tests/audio/calibrate.ts`                                  | Sets every sound's level by measurement and writes `apps/web/src/game/audio/sfxTrim.ts`. Needs a built client on `BOLT_E2E_PORT`; build again afterwards                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `npx tsx tests/tools/syncAudioDoc.ts`                               | Regenerates the tables in `docs/AUDIO_GUIDE.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `npx tsx tests/visual/hud.ts <url> <dir> [sizes] [shots]`           | The slim race HUD at 870x370 and 844x390 (three device pixels) and 667x375 (two); 1440x900 when asked for with `all`. Most shots are taken in the offline drive on the manual clock, so the race stands still between them: one frame in each `Camera` setting, a hit with the diagram up, a destroyed wheel with its icon left behind, damage and statuses, thermal protection, low power, the tow, out of ammunition, a lock, a missile, the rival off screen in four directions, the pause menu and the results with the offline label, left-handed, larger buttons; `Medium` drawn three ways and `Close` and `Far` for reference, each with a burst of consecutive frames while driving; scenarios (trap warning, rail gun, repairs, results); and in the garage the coverage of nine weapons and focus dimming. Group `compare` takes the frame used for the before and after. States are laid over the snapshot with the `?debug=1` override (DECISIONS 171) |
| `npx tsx tests/visual/sheet.ts crop\|row\|column ...`               | Crops a screenshot at a whole-number zoom (a 1:1 crop shows the device pixels) and joins pictures side by side, with the repository's own PNG writer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

## Automated coverage in Milestone A

**Unit (`tests/unit`)**

- `physics.test.ts`: Section 6.5 feel targets (0 to 60, top speed, steering settle, moderate
  bend), the steering request curve, the continuous tire curve, no kink crossing centre, a
  stable drift at full lock, self-aligning after a knock, free cornering inside the grip
  limit, pedal mapping and lift threshold, reverse rule, coasting, mass versus acceleration and
  top speed, the full Section 9.2 grip table for every weather and surface with the cap, rain
  versus dry, soft surfaces, wall strike loss, a two-minute random-input fuzz that must stay
  inside the corridor with finite state, and non-finite input handling.
- `track.test.ts`: track content contract, spawn fairness, surface mix, obstacle placement,
  ordered checkpoints, laps and finish, backwards crossings, skipped checkpoints, shortcut
  progress equivalence, monotonic progress, simulated race length inside the Section 9.3
  window, rain slower than dry, the 180-second limit, and the start hold.
- `input.test.ts`: dead zone, response curve, clamping, monotonicity, brake mapping, keys;
  direction steering on every screen heading, damping, authority fade, corner assist, straight
  braking, trail braking, no half-brake dead band at a standstill, reverse and recovery,
  non-finite input; the trailing stick origin.
- `inputPacer.test.ts`: the drive room's input policy. Each sample simulated exactly once,
  waiting and catch-up, steps never exceed ticks, fallback to held then neutral input, gap
  fill, duplicates and resets, disconnected coast.
- `prediction.test.ts`: exact agreement at zero latency, replay under 100 ms each way, packet
  loss recovery without teleport, tick lead, and the offline link.
- `compose.test.ts`: heading snap, layer order, frame bounds over every pose, steering wheels
  only, wheels stay attached at every heading, body shift, anchor convention.
- `assets.test.ts`: PNG codec round trip, sprites for every shipped part, sixteen non-empty
  frames per layer, cell margins, paint key isolation, opaque-or-clear pixels, effect strips,
  terrain chunk coverage, referenced files, ambient loops and overlays, download budget.
- `content.test.ts`: default loadout cost, wheel-count price and mass, chassis anchors and
  mounts, unknown and prototype-polluting ids, derived coefficients, approved copy, and a
  scan of all player-facing strings for em dashes, double hyphens and filler.
- `guestTokens.test.ts`: issue, verify, tamper, expiry, wrong secret, malformed input.

**Feel (`tests/feel`)**

Benches with numeric acceptance thresholds, because driving feel cannot be judged headlessly.
Before and after output from the October 10 rework is kept in `docs/evidence/feel`.

- `handling.test.ts`, for all four chassis. Wheel steering: full-lock response between 0.12
  and 0.34 s, yaw overshoot at most 15 percent, slip at most 16 degrees and at least 90
  percent of speed kept at full lock, stick-to-yaw proportion, path response to ten percent
  more stick, no grip cliff in a slow sweep, a thumb twitch, slalom lag, brake and turn.
  Direction steering: heading steps of 10 to 135 degrees with at most 1.5 degrees of overshoot
  and no hunting, a small correction inside 0.58 s, proportion, a trembling thumb, corner
  assist, straight braking and reverse, and a driver who only points lapping Neon Cut with
  no wall strikes.
- `pacing.test.ts`: view scale on thirteen device sizes; at least 0.9 s of look-ahead in every
  direction for the fastest car; camera lead with no overshoot, no 30 Hz steps and no jerk;
  the frame pacer under timestamp noise, dropped frames, an off-nominal refresh and pauses;
  the step clock at 30 to 144 Hz; interpolation across a server correction; heading-frame and
  body-lean hysteresis; and the whole pipeline replayed on seven display models, where ground
  motion at steady speed must be even to within 0.1 device pixel per refresh before rounding
  and everything drawn must sit on the pixel grid within one pixel of its exact place.
- `netcode.test.ts`: zero visible corrections in two minutes on five network models, and
  bounded recovery when the client freezes for longer than the server will wait.

**Integration (`tests/integration`)**

- `server.test.ts`: health, guest issue and rotation, tracks, catalog, CORS, body limit, error
  shape, unknown routes.
- `driveRoom.test.ts`: join with a guest token; refusals for bad token, version, track, part;
  countdown to racing; inputs move the car and advance the acknowledgement; duplicate and old
  sequences ignored; malformed payloads rejected without moving state; reconnect resumes the
  same car.
- `rateLimit.test.ts`, `failures.test.ts`, `webClient.test.ts`: limiter windows, flood and
  malformed-message disconnects, static client serving and SPA fallback.

**End to end (`tests/e2e`)**

- Blank session to a server-authoritative drive with no console errors.
- Floating joystick appears under the finger, drives, brakes and reverses when pulled back,
  and drives forward again.
- Pointing the stick turns the car toward that direction on screen.
- The stick origin trails a wandering thumb.
- The `Left and Right` option steers relative to the car and brakes on a pull down.
- The canvas is at a whole-number scale and a stale `Reduced Camera Motion` setting is dropped.
- A second finger uses the menu while the first keeps steering.
- A finger that starts on a HUD button never becomes the steering finger.
- Left-handed layout mirrors the action side only; settings persist across reload.
- Prediction stays near the authoritative car through an autopilot lap.
- Offline fallback is badged and drivable.
- Portrait shows the rotate prompt with a working portrait option.
- Leaving a race asks first.
- Every shipped chassis can be picked and driven.

## Automated coverage added in Milestone B (data and rules)

**Unit (`tests/unit`)**

- `sha256.test.ts`: published vectors, block boundaries, agreement with Node.
- `catalog.test.ts`: exactly 105 parts (five chassis with the ids of DECISIONS 87, 20 in
  each other category); every engine, wheel kit and accessory id, name, price and mass against
  the Section 11 tables and every chassis row against the five-chassis table; the strength and
  the cost each chassis card claims, held to the data; every chassis used by a starter; card copy free of em dashes, double hyphens and filler;
  every chassis layout (mirrored mounts, clear of wheels and of each other, inside the body);
  every part fits at least one mount on some chassis; templates legal and at their stated
  costs (baseline 370, Rookie 480).
- `blueprint.test.ts`: schema bounds, canonical form, hash stable across purchase order and
  cosmetic changes and sensitive to every mechanical field, every validation code reached,
  approved copy on every issue.
- `edit.test.ts`: install, remove, move, rotate, chassis, engine and tire swaps, fire
  buttons, mount suggestion, repair, spend and refund arithmetic, undo and redo to 20 steps,
  inputs never mutated.
- `engines.test.ts`, `tires.test.ts`, `parts.test.ts`: the stated character of each engine
  and tire kit measured on a bench, and the passive modifiers and declared actions of each
  accessory.
- `powertrain.test.ts`: heat thresholds and recovery, cooling by weather and airflow, energy
  priority and the protected drivetrain minimum, overload, instability.
- `stats.test.ts`: the five indicators and five scores, warnings, comparisons, and that the
  numbers shown are the numbers the race uses.
- `fuzz.test.ts`: random and hostile blueprints never throw and are never accepted while
  illegal; random edit sequences never produce an over-budget or over-weight car; legal
  random builds simulate with finite state.
- `client.test.ts`: saved blueprint restore and legacy loadout migration, sprite fallback.
- `assets.test.ts`: `SPRITES_PENDING` equals exactly the catalog ids missing from the atlas.
- `docs.test.ts`: `docs/GARAGE_API.md` tables and copy match the catalog; the measured table
  in `docs/BALANCE_CHANGELOG.md` matches the simulator.

**Feel (`tests/feel`)**

- `builds.test.ts`: every shipped blueprint finishes Neon Cut dry and wet without a wall
  strike; the baseline stays in the Section 9.3 window; the six example builds differ the way
  Section 11.9 says.
- `handling.test.ts` runs all five chassis (the Trike with loose limits, see Decisions 59).

**Integration and end to end**

- Drive room: join with a blueprint; refusal of illegal, unknown-part, stale-catalog and
  malformed builds; the snapshot carries heat, battery and build hash.
- `GET /api/v1/catalog` returns all 105 parts and the templates.
- A join on any of the fifteen retired chassis ids is refused as `UNKNOWN_PART`, or as
  `CATALOG_MISMATCH` when the blueprint still carries the old catalog version.
- Playwright: a pick saved by the Milestone A build is migrated to a blueprint and survives a
  reload; a build with parts that have no art yet races online with stand-in sprites.

Not covered yet: nothing fires, takes damage or repairs (Milestone C), so Defense, Firepower
and Utility scores are checked for arithmetic and ordering, not against combat outcomes.

## Automated coverage added in Milestone B (garage and flow)

**Unit (`tests/unit/garageStore.test.ts`, 54 tests)** against the garage store on a controlled
clock: install, replace and remove with exact credits; a mount tap never buys; wheel kits
priced for the chassis; paint and name leave the hash alone; nudge, rotate and the two-button
rule; over-budget, overweight, no-mount, one-per-car and unknown-part refusals leave the build
untouched and carry the right issue; no sequence of presses passes 1,000 credits; undo, redo,
the 20-step cap and reset; chassis swaps that carry everything, that refund what does not fit
(one undo step, every credit accounted for) and that are refused; the timer locking the last
legal snapshot, edits ignored after the lock, Ready gating, a server-driven deadline and
lock, repair; My Blueprints round trip, corrupt and hostile storage, flagged stale builds,
repair, the 30-car limit, duplicate, rename, delete; track facts and tips checked against
the balance tables; copy helpers.

Added with the slot redesign (Decisions 76 to 86): slot selection (essentials open and close,
an empty mount lists, an occupied one shows its part, Browse All, the idle view after a load
or a lock); `partsForSlot` against the validator for every mount of every chassis (a listed
part installs or is refused for a reason that is not about fit; an unlisted part is refused
for a reason that is); blocked reasons equal to the plan the press would run; pending chassis;
Browse All offering a free mount, a replacement, or "No compatible mount" only when no mount
fits; a unique short label for every mount.

Added with the five-chassis decision and focus mode (Decisions 87 to 98):

- `tests/unit/benchLayout.test.ts` (17 tests). The overview, `layoutBench`, for all five
  chassis at 870 x 370, 870 x 340, 844 x 390, 667 x 375 and 932 x 430, in all four views and
  with two body extents: every mount has a tile and a two-point leader, one column a side
  (nothing scrolls, nothing is stacked), no tile on another tile or on the car, tiles and car
  on the floor, no leader under a tile, no two leaders crossing; the second-column fallback
  on a floor too short for four tiles. The focus camera, `focusCamera`, as a pure function:
  the largest scale at which the part and its context fit, the fallback to the smallest, a
  part centred, the pan stopped before a void, an axis left unpanned when the car fits, and
  4,000 random floors and cars with the part always on the free floor. Focus mode,
  `layoutFocus`, for every mount of all five chassis and the engine at those five sizes and
  450 x 840, four views, two body extents (1,536 cases): whole scales one or two steps above
  the overview, the mount inside the free floor with 20 px to spare and under no tile, the
  whole part on the free floor, tiles of 44 px or more that keep their side and order and stay
  out of the view, a leader for the selected slot only. `summarizeCar` on synthetic scores and
  on every shipped car. The floor sizes the stylesheet gives (`landscapeFloor`,
  `portraitFloor`), which the end-to-end tests check against the real page.
- `garageStore.test.ts`: a saved car on a retired chassis is read back, kept and flagged with
  the "older part values" line, and `Repair Build` rebuilds it on the Beetle with its engine,
  tires, paint, name and every part that fits, the rest refunded and named; all fifteen
  retired ids rebuild into a legal car; the same draft opened in the garage for review cannot
  be bought on or raced, and repairs there.
- `edit.test.ts`, `blueprint.test.ts`, `parts.test.ts`, `powertrain.test.ts`, `stats.test.ts`:
  ported from the retired frames to the five (the Pickup's bed stands in for the Platform's
  decks and the Brick's rack).

**End to end (`tests/e2e/garage.spec.ts`, 35 tests)** on the production build: the first-run
flow from a blank browser to a race in a car built in the garage, by slot; Use Starter Car and
skipped tips; over-budget and overweight attempts; undo and redo by button and keyboard, and
Reset from More; chassis swap with refund notice; nudge, drag on the clean car, rotate, fire
buttons with their explanation, replace and remove; a car with nothing drawn over it and
leaders that follow the four views; chassis without art (the manifest is filtered in the
test); the ten-second warning, the lock and the race; an illegal draft at zero racing the
last legal car; the test clock ignored without the debug flag; a flagged build (red tile with
badge, red leader, Ready held back and explaining itself, Repair Build); save, duplicate,
rename and delete across reloads; corrupt storage; three taps and one tap to a race; Quick
Build; Change My Build after a full race; a keyboard-only install, nudge, catalog tabs and
Ready; Browse All Parts; layout at 870 x 370, 870 x 340, 844 x 390, 667 x 375, 932 x 430,
1024 x 768 and 1440 x 900 (no page scroll, every control whole and inside the viewport, touch
targets of 44 px or more and rows of 48, Ready a full 48 px and the only primary control,
Ready and credits uncovered, the car drawn whole at an integer scale of two or more, no tile
on the car's drawn pixels or on another tile, five whole list rows with a slot selected, the
part card without scrolling from 370 px of height, no shift when messages appear, all four
views); the Spider and the Pickup loaded with parts at five phone sizes; portrait at 450 x
840 (car strip of a little under 30 percent, a row of mounts in car order and a row of
essentials with names, Stats and View beside the strip and not over it, the status row under
the slots, one-line tips, five whole rows, gauges directly above Ready); home, preview and
blueprints at 667 x 375.

Added with focus mode: `assertLayout` now also fails when the status line touches the car's
drawn bounds or the floor, when a tile column or a slot row scrolls, when Stats or View is
over the floor, and, in focus, when the selected mount is within 16 px of the floor's edge
or under a tile or when more than one leader is drawn. New tests: focus at 870 x 370 for
every mount of all five chassis (the drawn scale goes up by one or two whole steps, the
dashed socket is on the floor and under no tile, every other tile is 44 px or more, `Whole
Car`, Escape and a tap on the bare floor restore the overview scale and every leader, the
engine has a focus of its own and Chassis and Wheels show the whole car); nudges and turns
in focus (one step moves the part one sprite pixel on screen while the car stays put, the
arrow keys do the same, the chevron turns with the part, Rotate view keeps the focus); the
idle Your Car panel (five scores, five indicator states that open their working, the two
derived lines, equipment rows that open their slot); a saved car on a retired chassis
(flagged, `Retired frame`, not usable, rebuilt on the Beetle by Repair Build). The layout
test also checks that the compare pane does not scroll on any phone 370 px tall or more,
667 x 375 included, and that the essentials tiles show a category and a one-line name.

`tests/e2e/drive.spec.ts` now reaches a race through the garage (Start Racing, Build Your
Car, Ready) and picks chassis there, from the Chassis slot.

Not automated: screen-reader output, real touch drag on a phone, Reduced Motion (the styles
and the still outline are there; nothing asserts them), the redesign on the owner's real
phone (it has been checked only in headless Chromium at his viewport sizes), the 150 ms ease
of the focus move (the tests wait for it and check where it ends, not how it looks), and
whether a child finds the garage clear in 60 seconds.

## Automated coverage added with facing, the hero pass and anchors (catalog 0.5.0)

**Unit (`tests/unit/facing.test.ts`, 15 tests).** The facing of every accessory as data (the
free, fixed and no-facing lists pinned by id); the square base of every free part at every
turn and the footprint of the others; the allowed facings of every mount of the five chassis,
pinned as a table and checked by category; every free part that fits a roof mount legal at all
four turns on each chassis, through the placement rules and through `validateBlueprint`; a
free part on any mount legal at exactly the turns that mount allows; no fixed part turnable on
any mount it goes on, by the validator and by `rotatePart`; parts with no facing held at turn
0; **the 884 chassis, mount and part combinations installable under catalog 0.4.0 all still
installable** (`tests/unit/fixtures/installable-0.4.0.json`, generated from the old rules
before the change) and the 32 gained combinations pinned by name; `partHeadingRad` and
`partDirection` against the compositor's frame for 64 headings and four turns; every template
legal with its fixed parts at their turn; two 0.4.0 cars migrated by `refaceBlueprint` and
`repairBlueprint` with every part and fire button kept, and through My Blueprints storage; the
picker's reasons in approved copy.

`tests/unit/assets.test.ts` gained: every part sheet fits its cell with two clear pixels at
all 64 headings; every boundary pixel of a part is the outline or the contact shadow color;
every part is drawn wider than its base and every aimed weapon at least 1.6 times as long;
every weapon has a muzzle anchor that is finite, above its mount, inside the frame margin and
within two pixels of the drawing at all 64 headings, and ahead of its base when it has a
facing; only the turret has a pivot; `partAnchorOffset` against hand arithmetic; every part
icon within its tile and filling its longer side. `edit`, `blueprint`, `garageStore`, `fuzz`
(its independent overlap oracle now uses the base rule) and `catalog` tests were updated to
the rule.

**End to end (`tests/e2e/garage.spec.ts`).** The Road Shotgun bought onto the Trike roof
faces forward as installed, then backward, then forward: the picker's radio state, the sheet
frame the canvas really drew the part with (`data-part-frames`, written by `drawCar` from the
compositor's operations) and the direction of the arrow on the car all agree, for all four
facings in all four view headings, and R steps through them. A radar has no picker and no
arrow; a mine and a bumper have no picker and an arrow pointing the way they work, and R says
so. The part card at 870 x 370, 870 x 340, 844 x 390 and 667 x 375, for a roof weapon with a
three-digit refund and for a non-directional part with one: nothing scrolls, every button,
pad, label, readout and the refund is inside the panel and the viewport, no button is
clipped, covered, overlapping another or under 44 px, a four-digit refund still fits, and the
help paragraph is gone.

Not automated here: whether the redrawn parts read on a real phone (developer review of the
preview sheets only), and the combat use of the anchors (Milestone C).

## Automated coverage added in Milestone C part 1 (the combat simulation)

Rules only. Nothing here checks what combat looks or sounds like; that is part 2.

| File                                         | What it holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| :------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/unit/combat.test.ts` (69)             | Section 19.1 rows for damage and combat rules, apart from any one part: component states and what each does to the car, hit localisation by position and arc, the order of shield, breakaway armor, arc armor and component, penetration, status stacking and caps, the 45 percent slow cap, crowd-control immunity, knockout and limp, ramming by mass and the spawn grace, heat and energy limits on firing, swept projectiles against cars, walls and obstacles, line of sight, hazards and their weather, two-car determinism                                                                                                                                                                                                                   |
| `tests/unit/combatParts.test.ts` (127)       | All sixty weapons, defenses and utilities: for each, one test of what it is for and one of a limit or of what answers it (ammunition, cooldown, arc, range, a counter), with the catalog's own numbers. The last test is table-driven over the catalog and fails if any part has no behavior test or no limit test registered. Also that every part compiles from its `params` and a missing number fails loudly, and the wheel kits and engine with a combat property                                                                                                                                                                                                                                                                              |
| `tests/unit/race.test.ts` (29)               | Protocol 4 input and join shapes; the grid (side by side, equal distance to the first gate) and the countdown; positions and gaps from both sides; leader changes; finishing, the eight-second window and DNF; the 180-second limit and the tie-breaks in order; whole-race determinism twice over, in rain, across seeds and after a reset; the sparring rival (three clean laps in 110 to 140 s, fires only with the target in arc and range, drops traps only for a car close behind, fits its spare wheel, acts only through a valid control sample); the scenarios (one per weapon, legal builds of 1,000 credits or less, expectations met, identical on a second run, documented); event visibility per driver; the tick budget; entity caps |
| `tests/integration/combatRoom.test.ts` (10)  | Through a real room. All 33 scenarios are played with the fire and utility buttons crossing the wire, and the room's event stream must equal, id for id and field for field, the stream of the same scenario stepped in the test process: every event once and in order, and the server and offline paths the same race. Every one of the twenty weapons fires and takes effect. The server refuses a fire button with no weapon, firing during a cooldown, and any sample that carries ammunition, cooldowns or damage of its own. A connection dropped while a mortar shell is in the air comes back to the server's state, and the explosion and hit that happened meanwhile arrive once, in order                                               |
| `tests/integration/debugOptions.test.ts` (2) | A server with debug options off refuses a chosen rival, seed or scenario and still runs an ordinary two-car race                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `tests/integration/snapshotSize.test.ts` (1) | Bytes of the room's schema over whole races, with the room's own encoder: full state under 2 kB, a patch 159 bytes on average in the heaviest shipped pairing (p95 212, worst 290)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `tests/balance/balance.test.ts` (7)          | 110 bot races and the weapon bench at one seed: every pairing ends, mean race length inside 100 to 140 s, no timeouts, knockouts under 3 percent, the harness flags exactly what is outside its thresholds, the sparring driver gets all twenty weapons to go off                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `tests/e2e/combat.spec.ts` (2)               | In the browser: `?debug=1&scenario=rocket_hit` plays and the other car loses chassis; an ordinary online race has the rival chosen by `?rival=` on the grid and answers the fire key. No console errors                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

Tick cost, measured in `race.test.ts` on this machine over three whole bot races (11,847
ticks, two cars, two brains): mean 76 to 95 microseconds, 99th percentile 0.27 to 0.34 ms,
worst 1.8 to 2.9 ms across runs (the higher means are with the rest of the suite running
beside it). A tick is 33.3 ms.

Not automated here: anything visual or audible about combat; two human drivers in one room
(Milestone E); the rival against a human who fights back; whether the balance numbers match
what players do.

## Automated coverage added in Milestone C part 2, track A (sound)

**No person has listened to any of it.** These tests measure the signal and read the audio
system's own bookkeeping. They can show a sound is clean, present, the right length, inside
its loudness window and different from its neighbours. They cannot show that it sounds good.
`docs/AUDIO_GUIDE.md` has the method and the list of what a listener should check first.

| File                               | What it holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| :--------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tests/unit/audio.test.ts` (31)    | In Node, no browser. Every recipe is well formed, uniquely named and has a calibrated level, with none left over. Every one of the 105 part ids resolves to an install sound that exists; each of the 20 engines has its own voice with the Section 14.3 character in its data (no idle for motors, the V8 lowest of the vees, spool-driven whistles, a pulsing rocket, a clicking spring drive); each of the 20 weapons has its own fire sound and its Section 13.4 phases, and wind-up recipes are as long as the simulation's wind-ups; every defense and utility that acts in a race has a sound. Every event type has a handler (the compiler enforces it) and makes at least one sound from a sample of every variant; every status family, hazard kind, refusal reason and hit surface is decided; a loop an event starts is stopped by the event that ends it and has a time limit; what was hit decides the sound (Section 13.6). Every event of all 33 scenarios maps to recipes that exist. Mixer arithmetic: distance, pan, placement, ducking, voice stealing (copies, a full bus, a full pool, drops, the protected), the caps, the rate limiter and the burst allowance, the gear model with hysteresis. Haptics: off by default, a no-op where unsupported, rate limited, halved when reduced. The music's tempo range and arrangements. Audio preferences                                                                                                                                                                                                                                                                                                            |
| `tests/unit/audioDocs.test.ts` (3) | `docs/AUDIO_GUIDE.md` carries its generated tables exactly as the code has them, names every recipe, says that nobody has listened, and the evidence it points to exists                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `tests/e2e/audio.spec.ts` (10)     | Six tests render offline in headless Chromium, through the game's own synth, mixer and audio system on an `OfflineAudioContext`. Every recipe: peak under -1 dBFS, DC under 0.02, no click at note on or off, loudness inside its category's window, audible for a third of its designed length and not beyond it, silent afterwards, at least a fifth of its energy above 300 Hz, every node released. Every engine over one seven-second run: the same, plus quieter at idle, brighter with revs, silent when switched off, and no two alike in all three phases. The twenty weapons: no two fingerprints of their scenarios closer than 0.9. All 33 scenarios: the expected sounds in order (written by hand in `tests/audio/expectations.ts`), polyphony inside the cap, no clipping, silence and no live nodes after the reset. A six-second stress mix of every weapon under a continuous machine gun: inside the caps, under the ceiling, the missile warning never stolen, rounds and bullet hits bounded by the limits. The music: level, both tempos, its voice cap, a clean stop. Four tests play the real client: no audio context before the first gesture and a running one after, with every node released after interface sounds and an engine preview; mute, the four volumes and the music switch reaching the mixer, and preferences persisting; a hidden tab silencing every loop and suspending the context, with nothing started while suspended, and resuming; and all 33 scenarios played live, one after another, each with its expected sounds in order, the voice and node caps, and the live node count back to its pre-race value after leaving the race |

The live scenario test plays about four minutes of race and is the slowest in the suite: six
to ten minutes here, because headless software rendering runs the race clock slow. It waits on
race time, not wall time.

Not automated, and not possible here: listening. Also real phone speakers, iOS Safari's unlock
and interruption behaviour, Bluetooth latency, and vibration on a device.

## Automated coverage added in Milestone C part 2, track V (combat rendering)

`tests/unit/vfx.test.ts` (187 tests), with `tests/helpers/stage.ts`, which drives the real
`CombatStage` from real scenario timelines at 60 Hz with no browser.

| Area                  | What is asserted                                                                                                                                                                                                                                                                                                                                                                                                                            |
| :-------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Atlas                 | The committed atlas is the pipeline's output byte for byte; the manifest matches the image; no two frames touch or share padding; nothing is drawn outside a frame; every strip has a stable key, a layer, a positive rate, a non-empty first frame, a fallback that exists, and a blend mode that matches its layer; hard alpha everywhere except light, decals and shadows; fewer than 256 colors; rocket and mortar are the largest fire |
| Runtime names         | Every strip the runtime names is in the atlas; every strip in the atlas is named by the runtime or is a fallback                                                                                                                                                                                                                                                                                                                            |
| Damage overlays       | A sheet per chassis, three states of 64 headings, drawn only where the body sheet is opaque, battered clearly heavier than scuffed                                                                                                                                                                                                                                                                                                          |
| Pool                  | 20,000 spawns stay inside each layer's decorative cap; the oldest decorative sprite is recycled; slots are reused after expiry; pinned sprites survive a flood, the view and time; a layer full of pinned sprites refuses the next and says so; culling at spawn and on screen; the low tier halves counts and caps; arcs, landing and coming to rest; sprites that ride a car                                                              |
| Pixel effects         | Fixed stores; every rectangle on whole pixels; lines cover both ends, merge runs and dash; a ring costs rows, not pixels                                                                                                                                                                                                                                                                                                                    |
| Quality governor      | Drops after about half a second of slow frames, returns after five steady seconds, ignores one long hitch, obeys a forced tier                                                                                                                                                                                                                                                                                                              |
| Mapping               | A handler for every event type in the protocol (a new type fails to compile, then fails the test); an identity with a launch and a hit for each of the 20 catalog weapons; one synthetic event of each type changes what is on screen; each weapon's scenario draws a set of strips and shapes no other weapon's does; the four major examples are built from their layers, and the EMP has no fire, smoke or shrapnel                      |
| Scenarios             | All 33 play through the stage: every event shown exactly once, nothing refused, every peak inside its capacity, no strip on a layer of the wrong blend, camera impulses at most 3 px, bursts cleared 15 s later                                                                                                                                                                                                                             |
| Timeline and place    | Events are shown in id order, never before the render clock reaches their tick and at most one tick after; a machine-gun hit is drawn on the target's tail, riding the target; the turret is turned to its aim; the repair scenario's wheel and engine conditions change when its repairs land                                                                                                                                              |
| Stress (Section 19.5) | 900 frames of the stress scenario at both tiers: caps hold, 64 pinned sprites all survive, the stage's mean frame cost stays under 6 ms; 3,000 further frames do not grow the heap                                                                                                                                                                                                                                                          |

Visual review (not assertions): `tests/visual/combat.ts` captures every scenario in the
production build on a manual clock, eight consecutive frames per key moment, and records the
major examples; `tests/visual/stageRender.ts` draws the same stage in software for fast
iteration. See `docs/VFX_GUIDE.md`.

## Automated coverage added in Milestone C part 2, track H (the race HUD, results, garage coverage)

`tests/unit/hud.test.ts` (37 tests), `tests/unit/coverage.test.ts` (6) and
`tests/unit/garageSounds.test.ts` (3). Everything the HUD decides is a pure function in
`apps/web/src/hud` and is tested without a browser, against real scenario timelines where one
exists.

| Area              | What is asserted                                                                                                                                                                                                                                                               |
| :---------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loadout           | For every shipped car the HUD's buttons, input bits and component order are the simulation's own (`compileModules`, `createCombatCar`); the repair key presses repair kits and spare wheels only                                                                               |
| Tiers             | The four Section 8.1 states at their published limits, for components and the chassis                                                                                                                                                                                          |
| Dials             | The estimated tick never runs more than four ticks past a snapshot; a cooldown dial turns from full to empty; a charge fills from empty to full                                                                                                                                |
| Buttons           | A rocket launcher counts down and shows `Empty` before the server refuses; in all 33 scenarios every `refused` event was already shown on the button one tick earlier; each block reason in the simulation's order; utilities ignore heat and power; the mortar without a lock |
| Heat and power    | Four heat levels ending at thermal protection; power low under a fifth or under the cost of a bound shot                                                                                                                                                                       |
| Statuses          | A ring starts full and refills when extended; worst first; the derived shield and tether                                                                                                                                                                                       |
| Gap               | No flicker on a wobbling gap; a real change within about 1.5 s; a jump at once; a real minus sign; the arrow's distance steps                                                                                                                                                  |
| Results           | Dealt and taken totals equal `CombatCar.stats` in all 33 scenarios; repairs and parts lost; the verdict only from `RaceResult`; only facts the log supports                                                                                                                    |
| Callouts          | Never more than two, spaced, repeats dropped, priority takes a place; the approved lines exactly; nothing for small hits; no em dash or double hyphen in any HUD or results string                                                                                             |
| Keep-out          | A 220 x 150 box around the car cannot reach either column wherever the camera puts it, at five sizes, with a notch; the HUD's camera places the car where the scene's does; the off-screen marker sits on the play field's edge and points at the rival                        |
| Coverage (garage) | Every catalog weapon has a shape with area; each weapon's kind of shape; a quarter turn of the part rotates the shape about it; angles are true and longer ranges are drawn longer; the fit to a small floor keeps angle and facing; non-weapons draw nothing                  |
| Garage sounds     | An install by its part, a turn, a removal, a refusal; Ready; the clock from ten seconds                                                                                                                                                                                        |

End to end, `tests/e2e/hud.spec.ts` (12 tests, production build, real pointer and CDP touch
input) and two tests added to `tests/e2e/garage.spec.ts`:

| Test                | What is asserted                                                                                                                                                                                                                                                                                                                                                                     |
| :------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layout              | At 870x370, 870x340, 844x390, 667x375 and 932x430, right- and left-handed: both fire buttons are at least 64 px and equipment at least 48 px, inside the safe area, on the action side, in the thumb's corner; no panel overlaps another; no panel is inside the region the car can reach or over the car where it is; coverage of the screen is under 19 percent (21.5 at 667 wide) |
| Three fingers       | With one touch steering, a second holds the primary (the sample's fire bit stays set and the weapon fires repeatedly) and a third taps the secondary and an equipment button; all reach the simulation while the stick is held                                                                                                                                                       |
| Left-handed         | The buttons are on the left and work there; the world is not mirrored                                                                                                                                                                                                                                                                                                                |
| Diagram             | The repair scenario's repairs appear on the right parts and are called out                                                                                                                                                                                                                                                                                                           |
| Hit flashes         | Every hit on the local car in three scenarios flashes the part it landed on                                                                                                                                                                                                                                                                                                          |
| Rocket              | A hit lowers the rival bar; the button counts ammunition down and shows its cooldown; the results add up to the event log                                                                                                                                                                                                                                                            |
| Blocks              | `Empty` and `Too hot` differ by word, glyph and pattern, not only color; a refused press shows the server's reason                                                                                                                                                                                                                                                                   |
| Warnings            | A lock and a missile with direction, the off-screen arrow with its distance, and callouts off in settings                                                                                                                                                                                                                                                                            |
| Trap                | The trap warning and hazards on the route ribbon with a Mine Detector                                                                                                                                                                                                                                                                                                                |
| Countdown and pause | The countdown is clear of the car; pausing a single-player race stops its clock                                                                                                                                                                                                                                                                                                      |
| Keyboard            | On a desktop: steer, fire both, use equipment, pause, restart, with key hints shown                                                                                                                                                                                                                                                                                                  |
| Whole race          | To the flag: the finish banner, then results that agree with the server's result and the log                                                                                                                                                                                                                                                                                         |
| Garage coverage     | A selected weapon draws its coverage; the drawing turns with the facing and moves with a nudge                                                                                                                                                                                                                                                                                       |
| Garage focus        | Everything but the selected part is darker in focus; at once under Reduced Motion                                                                                                                                                                                                                                                                                                    |

These tests wait on race time and race state, not wall time, because the software renderer
here runs at a few frames a second when the machine is shared; several take minutes.

Visual review (not assertions): `tests/visual/hud.ts`, output in `tests/visual/out/hud`.

## Automated coverage added with the slim HUD and the Camera setting

`tests/unit/raceView.test.ts` (66 tests since the owner's brief of October 12, with the
three camera steps on 11 screens at one, two and three device pixels) and tests added to
`tests/unit/hud.test.ts` (44 in all); `tests/e2e/hud.spec.ts` has three more tests (15) and
its layout test is stricter.
The entries of the two tables above that these replace: `Keep-out` and `Layout`.

| Area (unit)       | What is asserted                                                                                                                                                                                                                                                                                                                                                                                                                           |
| :---------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| View per setting  | On five phones (870x370, 870x340, 844x390 and 932x430 at three device pixels, 667x375 at two): every setting draws at a whole-number scale and fills the screen; `Close` is the earlier view; `Medium` is a quarter more each way at `Close`'s scale with a 5:4 canvas, 56 percent more pixels, never over 4,096 across; `Far` is the next whole-number scale out (skipping one that would give less than 1.3 times `Close`) at `Close`'s own canvas resolution, at most 2,080 world pixels, native at three device pixels; a stored `wide` reads as `far` |
| The owner's phone | 870 x 370, 1,088 x 463 and 1,305 x 555 world pixels at scales 3, 3 and 2; terrain chunks a view can touch: 6, 8 and 12                                                                                                                                                                                                                                                                                                                     |
| Look-ahead        | In every setting the car sits at the same place on the screen and has at least 0.9 s of road in every direction; a wider view sees further                                                                                                                                                                                                                                                                                                 |
| HUD camera        | It has the same pixels per world pixel as the scene in every setting and places the car inside its roaming ellipse; changing the setting reconfigures it                                                                                                                                                                                                                                                                                   |
| Keep-out          | A 300 x 190 box around the car (220 x 150 under 760 px of width) cannot reach either column or the race strip at five sizes; the old 182 px column would be reached; with a notch the earlier box still holds                                                                                                                                                                                                                              |
| Edge tags         | A tag lies against the edge of the screen, slides along it past a panel to the nearer end, is on no panel and on an edge for every direction from three car positions, and steps inward only when an edge is full                                                                                                                                                                                                                          |
| Strip             | The clock in whole seconds; the gap in at most four characters; the tow (`tow`, 0 to 1) in three steps above 0.05, nothing at or under it, nothing for a missing, negative, infinite or non-number value                                                                                                                                                                                                                                                             |
| Camera steps      | On 11 screens (phones in and out of a host page, tablets, desktop windows) at one, two and three device pixels: each step fills the screen at a whole-number scale with the filter its canvas needs; `Close` in 760 to 1,040; `Medium` 1.25 times `Close` at its scale; `Far` at least 1.3 times `Close` and at most 2,080, a whole step out at `Close`'s canvas resolution wherever `Close` is above one canvas pixel per world pixel, the nearest such step, and otherwise drawn as `Medium` at 1.5; on a phone no canvas over 4,096 across; named cases (870x370 at 2 and 3, 844x390, iPhone SE, a 1x desktop, a 3x 1920 screen) |
| Broken parts      | Only critical and destroyed components are listed, destroyed first; the diagram comes up for a change of condition and not for the first snapshot                                                                                                                                                                                                                                                                                          |

| Test (end to end) | What is asserted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| :---------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Layout            | As before, and: the strip is 26 to 32 px tall and the three bars at most 8; the rival's hull is inside the ribbon's panel; nothing persistent is in the middle band of the screen; no panel is in the car's box where the car is (300 x 190, or 220 x 150 at 667 wide), and the owner's 260 x 170 box cannot reach any panel from anywhere the car can be, at every size; the default camera is `Close`; coverage at most 10 percent at 870x370, 870x340, 844x390 and 932x430 and 12 at 667x375, also with the tow showing and left-handed; `Larger Buttons` enlarges the bars and the strip                                                                                             |
| Camera            | At 870x370 and three device pixels, each setting chosen in the pause menu applies at once: the canvas fills the screen at a whole-number scale with the right filter, the visible world is 870, 1,088 and 1,305 pixels across (`Far` at scale 2 on `Close`'s canvas, unfiltered), the HUD's camera agrees with the scene's, the layout rules hold, a rival 500 pixels away is on or off screen as the view says, and far off in four directions its tag is within 40 px of that edge, compact, on no panel and never in the middle; the choice is stored                                                   |
| Bars and icons    | A whole car shows no diagram, no icons, no tow, no best lap and no offline label; a hit brings the diagram up beside the bars with that part marked, clear of the lane and of the car's box, and it leaves after about two seconds; a destroyed wheel's icon stays, crossed, named; a critical engine's icon is drawn differently; a damaged part has none; overheat and low power change the mark, the hatch and the frame, not only the color, and the blink stops with Reduce Flashing Effects; the tow shows nothing at 0, 0.04 and 0.05 and one to three chevrons inside the strip above that |
| Offline label     | Not on the HUD as text; a small mark on the menu button with the tooltip `Offline test drive` in a single-player race and none on the server; in the pause menu of a single-player race with the lap times, in the results of a scenario, and absent in a race on the server (also `tests/e2e/drive.spec.ts`)                                                                                                                                                                                                                                                                                                                                                                         |

## Cannot be verified from this repository

These are requirements, not optional extras, and they stay open in the release checklist
until someone does them:

- Real hardware: one small iPhone, one large iPhone, one midrange Android, one laptop
  (Section 19.3). Touch feel, 60 FPS, audio unlock, safe areas, orientation, tab switching,
  incoming calls, low battery, low memory.
- The Milestone A gate itself: "runs on a real phone, is controllable with a floating
  joystick, and shows crisp pixel art at 60 FPS on a standard test device".
- Network conditions on real links: 200 ms latency, 80 ms jitter, 5 percent loss, two-second
  outages. Packet loss, latency, jitter and client frame hitches are covered in simulation by
  `prediction.test.ts` and `tests/feel/netcode.test.ts` only.
- Whether the car feels good. The feel benches prove the car is proportionate, damped and
  free of steps, and that frames are paced evenly. They cannot prove that a thumb enjoys it.
- Human review of art at game size and at 4x (Section 12.7), and of motion from recordings.
- Human review of sound. Every sound, the mix and the music are unheard. The evidence WAV
  files in `docs/evidence/audio/` are there for it, and the game itself on a phone speaker
  and on headphones.
- Combat effects on hardware: frame rate with effects on a mid phone (the Milestone C gate's
  "stable frame rate"), whether additive flashes and ground light look right on a real panel,
  and whether each weapon can be named from its effect at racing speed by someone who did not
  draw it. The stress scenario (`?debug=1&vfxStress=1`) and `window.__boltRace.stats()` are
  there for the first; nothing here can stand in for the other two.
- Playtesting with people who have not seen the game (Milestone F gate).

Headless Chromium here renders with software GL at 10 to 35 frames per second, so automated
runs say nothing about frame rate on a phone.

## Later milestones

Section 19.1 rows for the full AI; the fourteen-step two-client match in 19.2; the stress test in 19.5;
the security list in 19.6 beyond what the drive room already covers; and the 100-room load
exercise arrive with the features they test.
