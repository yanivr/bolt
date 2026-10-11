# Test plan

What is tested, how to run it, and what cannot be tested from this repository. Section 19 of
the specification is the requirement list; rows are added here as milestones land.

## Commands

| Command                           | Scope                                                                   |
| :-------------------------------- | :---------------------------------------------------------------------- |
| `pnpm lint`                       | ESLint over the whole workspace                                         |
| `pnpm typecheck`                  | `tsc -b` with strict settings across all packages                       |
| `pnpm test`                       | Vitest: unit and integration (starts real servers on ephemeral ports)   |
| `pnpm test:e2e`                   | Playwright against the production build in a phone-sized touch viewport |
| `pnpm art:check`                  | Car atlases match the pipeline byte for byte                            |
| `npx tsx tests/visual/capture.ts` | Screenshots and a recording for visual review                           |
| `npx tsx tests/visual/garage.ts <url> <dir> [sizes]` | Garage states (idle, slot list, compare, part card, rotated, Crab, Platform, Browse All, illegal build, More) at 870x370, 844x390, 667x375, 450x840 and 1440x900 |
| `npx tsx tests/feel/report.ts`    | Handling tables for every chassis (yaw, slip, radius, direction steps)  |
| `npx tsx tests/feel/pacingReport.ts` | Frame pacing of the shipped render pipeline at 60, 90 and 120 Hz     |
| `npx tsx tests/feel/buildsReport.ts` | Race time, top speed, launch, heat and stability of every shipped build |
| `npx tsx tests/tools/syncGarageDoc.ts` | Regenerates the part and chassis tables in `docs/GARAGE_API.md` |
| `npx tsx tests/feel/netcodeReport.ts` | Prediction corrections under latency, jitter and frame hitches      |

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
- `catalog.test.ts`: exactly 120 parts, 20 per category; every id, name, price and mass
  against the Section 11 tables; card copy free of em dashes, double hyphens and filler;
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
- `handling.test.ts` now runs all 20 chassis (two with loose limits, see Decisions 59).

**Integration and end to end**

- Drive room: join with a blueprint; refusal of illegal, unknown-part, stale-catalog and
  malformed builds; the snapshot carries heat, battery and build hash.
- `GET /api/v1/catalog` returns all 120 parts and the templates.
- Playwright: a pick saved by the Milestone A build is migrated to a blueprint and survives a
  reload; a build with parts that have no art yet races online with stand-in sprites.

Not covered yet: nothing fires, takes damage or repairs (Milestone C), so Defense, Firepower
and Utility scores are checked for arithmetic and ordering, not against combat outcomes.

## Automated coverage added in Milestone B (garage and flow)

**Unit (`tests/unit/garageStore.test.ts`, 56 tests)** against the garage store on a controlled
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
fits; `layoutBench` for all 20 chassis at 844 x 390, 870 x 340, 667 x 375 and 932 x 430, in
all four views and with two body extents (no tile on another tile or on the car, tiles and
car on the floor, every leader from its tile's edge to its mount, no leader under a tile, no
two leaders crossing, scrolling only for more than eight mounts); column order; scale of two
or better on every phone; a unique short label for every mount.

**End to end (`tests/e2e/garage.spec.ts`, 31 tests)** on the production build: the first-run
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
views); the Crab and the Platform loaded with parts at five phone sizes; portrait at 450 x
840 (car strip of about 30 percent, one row of slots in car order, one-line tips, six whole
rows, gauges directly above Ready); home, preview and blueprints at 667 x 375.

`tests/e2e/drive.spec.ts` now reaches a race through the garage (Start Racing, Build Your
Car, Ready) and picks chassis there, from the Chassis slot.

Not automated: screen-reader output, real touch drag on a phone, Reduced Motion (the styles
and the still outline are there; nothing asserts them), the redesign on the owner's real
phone (it has been checked only in headless Chromium at his viewport sizes), and whether a
child finds the garage clear in 60 seconds.

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
- Playtesting with people who have not seen the game (Milestone F gate).

Headless Chromium here renders with software GL at 10 to 35 frames per second, so automated
runs say nothing about frame rate on a phone.

## Later milestones

Section 19.1 rows for damage, armor in combat, weapons, repairs and AI; the fourteen-step two-client match in 19.2; the stress test in 19.5;
the security list in 19.6 beyond what the drive room already covers; and the 100-room load
exercise arrive with the features they test.
