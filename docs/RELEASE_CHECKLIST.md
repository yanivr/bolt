# Release checklist

Tracks the milestone gates of Section 20 and the launch acceptance list of Section 19.7.
An item is checked only when it has actually been verified, and the note says how. "Done in
code" is not the same as "verified"; where those differ, the item stays open.

Last updated: October 10, 2026, end of Milestone A implementation.

## Milestone gates

### Milestone A: foundation and vertical car demo

Deliverables:

- [x] Monorepo, strict TypeScript, shared types, lint, tests. `pnpm check` passes: 157 unit and integration tests.
- [x] CI workflow written (`.github/workflows/ci.yml`). **Not yet run**: the repository could not be reached from the build session.
- [x] Phaser canvas, WebGL first with Canvas fallback configured. Canvas fallback is untested on a device without WebGL.
- [x] Basic server: Express API, Colyseus 0.16 drive room, fixed 30 Hz authoritative loop, input validation, reconnect.
- [x] Guest session: signed anonymous tokens, in-memory store behind the interface PostgreSQL will implement.
- [x] One authored city track: Neon Cut, with shortcut, checkpoints, obstacles, landmarks, overlays, ambient loops.
- [x] Beetle built from separate wheel and engine layers with directional steering; sixteen headings.
- [x] Three benchmark chassis modelled ahead of mass production (Arrow, Turtle, Spider), bare.
- [x] Single car that drives: floating joystick, keyboard, camera follow, prediction and reconciliation.

**Gate: "It runs on a real phone, is controllable with a floating joystick, and shows crisp
high-quality pixel art at 60 FPS on a standard test device."**

- [ ] Runs on a real phone. **Open.** Only headless Chromium in a phone-sized touch viewport has been used.
- [ ] Floating joystick feels right under a thumb. **Open.** Behaviour is covered by end-to-end tests; feel is not testable without hands.
- [ ] 60 FPS on a standard test device. **Open.** Software rendering here reaches 10 to 35 FPS and says nothing about a phone.
- [ ] Pixel art judged high quality by a person at game size and at 4x. **Open.** See `docs/ART_GUIDE.md` for what to look at and the known weak spots.
- [ ] Motion and camera judged "excellent". **Open.** Needs a person driving it.

Milestone A is therefore **implemented, not passed**. Milestone B should not start mass
production of the remaining sixteen chassis until the car art and driving feel are approved.

### Milestones B to G

Not started. B: garage, 120-part catalog, blueprint serializer, five indicators, heat, energy.
C: 20 weapons, defenses, utilities, damage, repairs, effects library, sound. D: seven more
tracks, weather presets, AI, bot tournament harness. E: two-player rooms, friend links,
PostgreSQL blueprints and codes. F: VS sequence, results, highlights, daily challenge, full
settings. G: load, security, Docker deployment, public HTTPS.

## Launch acceptance (Section 19.7)

- [ ] Public HTTPS browser build opens on target mobile devices. _No deployment; no URL exists._
- [ ] First-time onboarding and starter car work from a blank session. _Partial: a blank session reaches a drive with one steering hint. No garage or first race against AI yet._
- [ ] All seven principal screen families plus connection and error states are interactive. _Boot, a reduced Home, Race and Settings exist. Lobby, track preview, garage, load code, VS, results, blueprints do not._
- [ ] 20 chassis, 20 engines, 20 tire kits, 20 weapons, 20 defenses, 20 utilities. _4 chassis, 1 engine, 1 tire kit._
- [ ] All 120 catalog parts covered by behavior or primitive tests.
- [ ] Arbitrary legal assemblies composited and physically validated. _Compositor is general and tested for the three mandatory layers; mounted parts arrive in Milestone B._
- [ ] Multiplayer garage locks after 60 seconds and never spends more than 1,000 credits.
- [ ] Every car has meaningful heat, energy, mass and stability behavior. _Mass and grip only._
- [ ] Top-down float steering, braking and left-handed actions work with two fingers. _Automated two-finger tests pass; real-device check open. No action buttons beyond the menu yet._
- [ ] Two friends can enter by code or link and finish a synchronized match.
- [ ] AI uses the same physics, funds and weapon rules as a human. _A centerline driver exists and uses the same controls and physics; no rival car yet._
- [ ] Sixteen directional chassis frames and coherent attachments render without flicker. _Sixteen frames per chassis are baked and tested; "without flicker" needs a device._
- [ ] Each of 20 weapons has a unique visual and audible signature.
- [ ] Rocket and mortar explosions have layered flashes, fire, debris and smoke.
- [ ] Wet road reflections, rain spray, sand dust and forest ambience work on real phones.
- [ ] Damage appears on the correct component and a spare wheel visibly repairs it.
- [ ] All launch tracks, weather, checkpoints and shortcuts are operational. _1 of 8 tracks, 1 of its 2 weather presets is baked; the rain preset has physics but no art._
- [ ] One authoritative result is shown consistently to both players.
- [ ] Short car codes create, persist, import and validate across browsers.
- [ ] Rematch, edit build, swap cars and share flows work without an account.
- [ ] No placeholder buttons, stock images, generic square cars or empty scenes remain. _True of what exists: every control shown does what it says. The home scene is a plain workbench, not the animated garage of Section 5.3._
- [ ] Low-effects settings preserve readability and touch responsiveness. _Reduced camera motion, shake amount and reduced flashes exist; particle quality tiers do not._
- [ ] Device tests and network stress tests meet documented budgets.
- [ ] Privacy disclosure, deletion controls, error handling, backups and HTTPS are in place. _Guest tokens carry no personal data and can be cleared locally; no privacy page yet._
- [ ] Automated tests and clean install and build commands pass on the committed revision. _Passing locally at this revision. Clean-clone install and CI are unverified._

## Launch blockers known today

1. Hardware sign-off for Milestone A (above).
2. Repository access, so CI can run and the work is not confined to one machine.
3. A server and domain for deployment (Milestone G).
4. Human art review. Section 21 is explicit that code cannot vouch for its own visuals.
5. Legal review of child privacy and regional rules before public launch (Section 16).
6. Trademark check on the working name (document header).
