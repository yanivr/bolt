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
| `npx tsx tests/feel/report.ts`    | Handling tables for every chassis (yaw, slip, radius, direction steps)  |
| `npx tsx tests/feel/pacingReport.ts` | Frame pacing of the shipped render pipeline at 60, 90 and 120 Hz     |
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

Section 19.1 rows for parts, hardpoints, blueprint hashing, energy, heat, damage, armor,
weapons, repairs and AI; the fourteen-step two-client match in 19.2; the stress test in 19.5;
the security list in 19.6 beyond what the drive room already covers; and the 100-room load
exercise arrive with the features they test.
