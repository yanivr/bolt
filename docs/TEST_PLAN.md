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

## Automated coverage in Milestone A

**Unit (`tests/unit`)**

- `physics.test.ts`: Section 6.5 feel targets (0 to 60, top speed, steering settle, moderate
  bend), pedal mapping and lift threshold, reverse rule, coasting, mass versus acceleration and
  top speed, the full Section 9.2 grip table for every weather and surface with the cap, rain
  versus dry, soft surfaces, wall strike loss, a two-minute random-input fuzz that must stay
  inside the corridor with finite state, and non-finite input handling.
- `track.test.ts`: track content contract, spawn fairness, surface mix, obstacle placement,
  ordered checkpoints, laps and finish, backwards crossings, skipped checkpoints, shortcut
  progress equivalence, monotonic progress, simulated race length inside the Section 9.3
  window, rain slower than dry, the 180-second limit, and the start hold.
- `input.test.ts`: dead zone, response curve, clamping, monotonicity, brake mapping, keys.
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
- Floating joystick appears under the finger, accelerates, brakes to a stop.
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
  outages. Packet loss and latency are covered in simulation by `prediction.test.ts` only.
- Human review of art at game size and at 4x (Section 12.7), and of motion from recordings.
- Playtesting with people who have not seen the game (Milestone F gate).

Headless Chromium here renders with software GL at 10 to 35 frames per second, so automated
runs say nothing about frame rate on a phone.

## Later milestones

Section 19.1 rows for parts, hardpoints, blueprint hashing, energy, heat, damage, armor,
weapons, repairs and AI; the fourteen-step two-client match in 19.2; the stress test in 19.5;
the security list in 19.6 beyond what the drive room already covers; and the 100-room load
exercise arrive with the features they test.
