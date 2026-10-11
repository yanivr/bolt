# Release checklist

Tracks the milestone gates of Section 20 and the launch acceptance list of Section 19.7.
An item is checked only when it has actually been verified, and the note says how. "Done in
code" is not the same as "verified"; where those differ, the item stays open.

Last updated: October 11, 2026, Milestone B implemented: rules, garage and art for all 105 parts. The chassis list is five by product-owner decision (`docs/DECISIONS.md` entry 87); wherever Section 19.7 says 20 chassis, read five.

## Milestone gates

### Milestone A: foundation and vertical car demo

Deliverables:

- [x] Monorepo, strict TypeScript, shared types, lint, tests. `pnpm check` passes: 314 unit, integration and feel-bench tests.
- [x] CI workflow written (`.github/workflows/ci.yml`). **Not yet run**: the repository could not be reached from the build session.
- [x] Phaser canvas, WebGL first with Canvas fallback configured. Canvas fallback is untested on a device without WebGL.
- [x] Basic server: Express API, Colyseus 0.16 drive room, fixed 30 Hz authoritative loop, input validation, reconnect.
- [x] Guest session: signed anonymous tokens, in-memory store behind the interface PostgreSQL will implement.
- [x] One authored city track: Neon Cut, with shortcut, checkpoints, obstacles, landmarks, overlays, ambient loops.
- [x] Beetle built from separate wheel and engine layers with directional steering; 64 headings.
- [x] Three benchmark chassis modelled ahead of mass production (Arrow, Turtle, Spider), bare. _The Turtle has since been retired with fourteen others (DECISIONS 87); its model is kept, unbaked._
- [x] Single car that drives: floating joystick with direction steering, keyboard, fixed north-up camera with look-ahead, prediction and reconciliation.

**Gate: "It runs on a real phone, is controllable with a floating joystick, and shows crisp
high-quality pixel art at 60 FPS on a standard test device."**

- [ ] Runs on a real phone. **Open.** Only headless Chromium in a phone-sized touch viewport has been used.
- [ ] Floating joystick feels right under a thumb. **Open, and rejected once.** The owner found the first build jumpy and too sensitive. Steering, camera and frame pacing were reworked and now pass numeric thresholds (`tests/feel`, `docs/evidence/feel`). That is evidence of smoothness and proportion, not of feel; it needs driving again on a phone.
- [ ] 60 FPS on a standard test device. **Open.** Software rendering here reaches 10 to 35 FPS and says nothing about a phone.
- [ ] Pixel art judged high quality by a person at game size and at 4x. **Open.** See `docs/ART_GUIDE.md` for what to look at and the known weak spots.
- [ ] Motion and camera judged "excellent". **Open.** The camera is now fixed north-up at the reference distance, as the owner asked. Needs a person driving it.

Milestone A is therefore **implemented, not passed**. Milestone B should not start mass
production of further chassis until the car art and driving feel are approved. (The list was
later cut to five by the product owner; see Milestone B.)

### Milestone B: garage and engineering

Implemented and passing the automated suite (949 unit, integration and feel tests; 51
end-to-end tests in headless Chromium; the Vitest count fell from 1,390 because fifteen
chassis and their per-frame cases are gone). **Not passed**: nobody has used the garage on a real
phone, and the art has not been reviewed by a person.

Data and rules (verified by the automated suite, see `docs/TEST_PLAN.md`):

- [x] 105-part catalog: engines, wheel kits, weapons, defenses and utilities with exact Section 11 ids, names, prices and masses, card copy, footprints, mounts and typed parameters. Catalog 0.5.0 (facing as part data, DECISIONS 99).
- [x] Five chassis, by product-owner decision of October 11, 2026 (Beetle, Arrow, Pickup, Spider, Trike), with wheel anchors and mounts, tuned as a set so each has one clear strength and one clear cost (`docs/BALANCE_CHANGELOG.md` 0.4.0).
- [x] Blueprint format, canonical serializer, SHA-256 build hash, strict schema.
- [x] Validation with issue codes and approved player copy, shared by client and server.
- [x] Edit operations for the garage (install, remove, move, rotate, swaps, fire buttons, repair, cost preview, undo and redo). Reference: `docs/GARAGE_API.md`.
- [x] Five indicators and five scores computed from the same model the race runs.
- [x] Heat, energy, overload, stability and engine character in the authoritative simulation and in client prediction.
- [x] Baseline (370), Rookie (480), four more starters (one for each other chassis) and six example blueprints, all legal, all raced on Neon Cut.
- [x] Server accepts a blueprint on join and refuses illegal ones. Protocol 3.

Still open in Milestone B:

- [x] Garage screen (Section 5.6), redesigned after the product owner's test on a real iPhone (cramped: markers over the car, small car, two and a half parts in the list): a clean car at the largest whole-number scale with a slot tile and leader line for every mount, Chassis, Engine and Wheels tiles under it, a per-slot part list of compact rows (five or more at 870 x 340, six in portrait at 450 x 840), Browse All Parts, compare pane with the five scores and five indicators, one card for an installed part, four gauges with breakdowns, a More menu, undo and redo, paint and name, first-build tips on the tiles. Verified by 56 unit and 31 end-to-end tests in headless Chromium at the owner's viewport sizes, phone, tablet and desktop. **The redesign itself has not been used on a real phone or reviewed by a person yet.** See `docs/DECISIONS.md` 76 to 86.
- [x] Flow: Home, Track Preview, 60-second garage, race, `Change My Build`; `Use Last Build` and `Quick Build` from Home.
- [x] My Blueprints in local storage, 30 cars, with flagged stale builds and repair. A saved car on a retired chassis is flagged and rebuilt on the Beetle by Repair Build.
- [x] Garage focus mode and polish after the owner's second review (DECISIONS 90 to 98): selecting a mount or the engine moves the view in by one or two whole scale steps with the slot centred, `Whole Car`, Escape or the bare floor goes back; the status line has its own reserved place and never covers the car; essentials tiles show a one-line name; nothing on the workbench scrolls; the compare pane fits 667 x 375; the idle panel shows scores, indicator states, a derived summary and tappable equipment. Checked by unit and end-to-end tests and in screenshots at 870 x 370, 667 x 375, 450 x 840 and 1440 x 900. **Not checked on the owner's phone.**
- [ ] **Deferred to Milestone E:** short share codes (`Load Code`, `Copy Code`) and a server-owned build timer. The client clock locks the last legal snapshot today; `setDeadline` and `lockWith` are the hooks for the server. No code control is shown.
- [ ] **Not built:** two-finger zoom on the workbench, flipping paired parts, the biome diorama on Track Preview, a second weather preset to choose.
- [x] Sprites for all five chassis (with mount heights for every mount), 20 engines, 20 wheel kits and 60 mounted parts, plus 32 and 24 pixel catalog icons rendered from the same models. `SPRITES_PENDING` in `tests/unit/assets.test.ts` is empty and the test fails if any catalog part loses its sheet. The car atlas is 1.13 MB in 143 files (it was 2.23 MB in 203 with twenty chassis). **Art quality is unreviewed by a person.** Known weak spots: the Spider's wheels read as dark blobs at race size; the larger engines overhang the Pickup's hood and the Trike's frame; several tire kits (Balloon, Mud, Monster, Rain) differ mostly by size on a dark road; catalog icons are small inside their tiles.
- [x] Mounted parts drawn on the car in the race, the garage and every thumbnail through the one shared compositor, lifted to the bodywork height of their mount. Checked in screenshots (`tests/visual/loaded.ts`, `tests/visual/garage.ts`).
- [x] Engines in mid and front bays draw a sheet without tail pipes (`engineInBay`), so pipes no longer cross the cab.
- [x] Player-facing HUD for heat and power: two gauges in the car condition widget, with a marked limit, a pattern and a word when hot or low, and `ENGINE HOT` and `LOW POWER` callouts (Milestone C part 2, track H). Low power is the HUD's own reading; the snapshot has no flag for it (DECISIONS 164).
- [ ] Blueprint storage and codes on the server (PostgreSQL arrives in Milestone E); blueprints live in local storage today.
- [ ] Balance review of the values by a person, the five retuned chassis first. One known question, narrowed in 0.4.0: Tiny Trouble is 2.1 s behind the Straight-Line Rocket in the dry for two thirds of the price (`docs/BALANCE_CHANGELOG.md`).
- [x] Weapons, defenses and utilities act in a race (Milestone C part 1, below).

### Milestone C: combat

Part 1, the simulation (October 11, 2026). Contract for part 2: `docs/COMBAT_API.md`.

- [x] Two-car deterministic race: car against car by mass, grid, per-car progress, position and gap, wrong way, finish, the eight-second window, the 180-second limit and its tie-breaks, knockout (Section 3.4).
- [x] Component damage and its consequences (Section 8.1), repairs (8.2), the weapon lifecycle and input (8.3). Two fire buttons, utility buttons and a repair target in the input sample; protocol 4.
- [x] All 20 weapons, 20 defenses and 20 utilities behave in a race, on shared primitives driven by catalog `params` (Section 11.8). Each has a behavior test and a limit or interaction test; a table-driven test fails if one is missing. Where a part is not exactly as its catalog sentence reads is listed in `docs/COMBAT_API.md`.
- [x] Hazards, weather interactions (wet road, oil and fire, flame and frost), countermeasures (interceptor, sweeper, decoy, detector, radar).
- [x] Snapshots, events and prediction: the room schema carries combat, measured at 159 bytes a patch; events are delivered once and in order, held across a reconnect; the client predicts only its own car's motion.
- [x] The room is a two-car race against a seeded sparring rival; the offline link mirrors it tick for tick (asserted through a real room for 33 scenarios).
- [x] Scenario runner, 33 scenarios, on the command line, in the client (`?debug=1&scenario=`) and in a server room.
- [x] Balance harness and a first report (`docs/evidence/balance/`, `docs/BALANCE_CHANGELOG.md` 0.6.0). **Flags are open, not resolved:** six of eleven shipped builds win over 70 or under 30 percent of bot races because pace decides them; the bullet guns deal several times the median damage per credit when two cars stay together. Both are for the owner and a second pass.
- [ ] **The sparring rival is not the game's AI.** One simple driver, no difficulty levels, no build choice. Milestone D.
- [ ] **Part 2, not started:** weapon art and animation on the car, projectiles, impacts, explosions, status and damage visuals, the combat HUD (fire buttons, cooldowns, ammunition, damage silhouette, warnings, position and gap), sound. Today combat is drawn by `CombatDebugView` as dots, outlines and rings, the fire buttons are unstyled debug buttons, and state is a debug text row. None of it is final and none of it may ship.
- [x] Part 2, track A, sound: synthesized in code with no audio files. Twenty engine voices, tire skid and rumble by surface, a signature per weapon with its charge, lock, flight, impact and aftermath, what-was-hit impacts, status loops, warnings, race cues, interface and garage sounds, one adaptive music theme, haptics behind a switch, seven buses into a limiter, voice caps and rate limits. Rendered and measured offline and played through all 33 scenarios in the real client (`docs/AUDIO_GUIDE.md`, `docs/evidence/audio/`).
- [ ] **No person has listened to any sound, the mix or the music.** Measurements only. A listening pass on headphones and on a phone speaker is required before any of it can be called done.
- [x] Sound call sites owned by the interface track are wired (DECISIONS 170): `Music`, `Interface`, `Softer Impacts` and `Vibration` in settings; interface sounds on HUD and menu buttons, toggles, sliders and choices; garage sounds for install, removal, turn, refusal, selection, Ready and the last ten seconds of the clock. **Not wired:** dialogs opening and closing, saving a blueprint, error screens. Unheard by a person.
- [x] Part 2, track H, the race HUD and results (DECISIONS 154 to 172): hold-to-fire buttons with cooldown, charge, ammunition and worded block reasons; equipment buttons and pips for automatic parts; a car diagram with four condition tiers told by pattern, hit flashes and repair rings; armor, hull, heat and power; timed statuses; position and a steadied gap; an off-screen rival arrow; the rival's hull; lock, missile and trap warnings with direction; rate-limited callouts with a setting; countdown, pause and finish; a results screen from the server's result and the event log. Two columns that swap whole for the other hand, with nothing persistent in the band the car can reach, asserted at five phone sizes. Checked by unit and end-to-end tests (three-finger CDP touch) and in screenshots at 870 x 370, 667 x 375 and 1440 x 900 (`tests/visual/out/hud`). **Not checked on a phone, by a thumb, or by a person other than its author.**
- [ ] HUD gaps (DECISIONS 168, 169, 172): no repair target chooser (the scene sends target 0); the server's race does not pause for the menu in AI mode; HUD covers 21.3 percent of a 667 x 375 screen against a target of 18; no podium or car composition on the results screen; `Save This Car` and `Share Blueprint` are not on it; the rival's components are not shown, only its hull.
- [x] Garage: a selected weapon's coverage drawn on the workbench floor from the simulation's own module values, and the rest of the car dimmed in focus (DECISIONS 173, 174). In focus the drawing is fitted to the free floor, so range is approximate there; arc and facing are exact.
- [ ] Seven more music themes, with the seven more tracks. No "last 30 seconds" layer: the client is not told the time limit.
- [ ] Track-side repairs (Section 8.2 pit pads) and destructible track objects: no track data for them yet.
- [ ] Balance review by a person. Not checked on a phone.

### Milestones D to G

Not started. D: seven more
tracks, weather presets, AI, bot tournament harness. E: two-player rooms, friend links,
PostgreSQL blueprints and codes. F: VS sequence, results, highlights, daily challenge, full
settings. G: load, security, Docker deployment, public HTTPS.

## Launch acceptance (Section 19.7)

- [ ] Public HTTPS browser build opens on target mobile devices. _No deployment; no URL exists._
- [ ] First-time onboarding and starter car work from a blank session. _Partial: a blank session reaches a drive with one steering hint. No garage or first race against AI yet._
- [ ] All seven principal screen families plus connection and error states are interactive. _Boot, Home, Track Preview, Garage, My Blueprints, Race and Settings exist. Lobby, load code, VS and results do not._
- [ ] Five chassis (by product-owner decision of October 11, 2026, overriding the 20 of Section 19.7: Beetle, Arrow, Pickup, Spider, Trike; `docs/DECISIONS.md` entry 87), 20 engines, 20 tire kits, 20 weapons, 20 defenses, 20 utilities. _All 105 exist in rules and in art, and all 60 weapons, defenses and utilities behave in a race. Their combat visuals and sound do not exist yet._
- [ ] All 105 catalog parts covered by behavior or primitive tests. _The 60 mounted parts each have a behavior test and a limit test, enforced by a table-driven test. Chassis, engines and tire kits are covered by the Milestone B data and handling tests._
- [ ] Arbitrary legal assemblies composited and physically validated. _Compositor draws any legal blueprint including mounted parts; all templates are raced in tests._
- [ ] Multiplayer garage locks after 60 seconds and never spends more than 1,000 credits.
- [ ] Every car has meaningful heat, energy, mass and stability behavior. _Implemented in the simulation; only the debug readout shows heat and power in a race._
- [ ] Top-down float steering, braking and left-handed actions work with two fingers. _Automated two-finger tests pass; real-device check open. The designed fire and equipment buttons hold, fire on the press and work with three and four simultaneous touches in an automated CDP test, in both hand layouts; unverified under a real thumb._
- [ ] Two friends can enter by code or link and finish a synchronized match.
- [ ] AI uses the same physics, funds and weapon rules as a human. _The sparring rival races a legal 1,000-credit template and acts only through the control sample a player sends, with the same cooldowns, ammunition and physics (asserted). It is a stand-in for the AI of Milestone D._
- [ ] Sixteen directional chassis frames and coherent attachments render without flicker. _Sixteen frames per chassis are baked and tested; "without flicker" needs a device._
- [ ] Each of 20 weapons has a unique visual and audible signature. _Audible: each weapon has its own recipes, and their rendered scenarios differ by a measured fingerprint distance of at least 0.9; unheard by a person._
- [ ] Rocket and mortar explosions have layered flashes, fire, debris and smoke.
- [ ] Wet road reflections, rain spray, sand dust and forest ambience work on real phones.
- [ ] Damage appears on the correct component and a spare wheel visibly repairs it. _True in the simulation and its events (hit localisation and the spare wheel are tested). Nothing shows it on the car yet._
- [ ] All launch tracks, weather, checkpoints and shortcuts are operational. _1 of 8 tracks, 1 of its 2 weather presets is baked; the rain preset has physics but no art._
- [ ] One authoritative result is shown consistently to both players. _The server produces one `RaceResult` and sends it in the state; there is one human in a room. The results screen shows that result and nothing that contradicts it (the end-to-end test of a whole race compares them)._
- [ ] Short car codes create, persist, import and validate across browsers.
- [ ] Rematch, edit build, swap cars and share flows work without an account.
- [ ] No placeholder buttons, stock images, generic square cars or empty scenes remain. _True of what exists: every control shown does what it says. The home scene is a plain workbench, not the animated garage of Section 5.3._
- [ ] Low-effects settings preserve readability and touch responsiveness. _Shake amount and reduced flashes exist; the camera no longer rotates or zooms at all; particle quality tiers do not._
- [ ] Device tests and network stress tests meet documented budgets.
- [ ] Privacy disclosure, deletion controls, error handling, backups and HTTPS are in place. _Guest tokens carry no personal data and can be cleared locally; no privacy page yet._
- [ ] Automated tests and clean install and build commands pass on the committed revision. _Locally, on the working tree of October 11, 2026 after Milestone C part 1 (not committed; the directory is not a git repository): `tsc -b` and ESLint are clean, 1,274 Vitest tests in 39 files and 59 Playwright tests pass, and the build succeeds. CI itself has never run._

## Launch blockers known today

1. Hardware sign-off for Milestone A (above).
2. Repository access, so CI can run and the work is not confined to one machine.
3. A server and domain for deployment (Milestone G).
4. Human art review. Section 21 is explicit that code cannot vouch for its own visuals.
   4a. Human listening review. No sound in the game has been heard by a person.
5. Legal review of child privacy and regional rules before public launch (Section 16).
6. Trademark check on the working name (document header).
