# Decisions

Minor technical choices the specification leaves open, recorded as they are made (Section 0).
Each entry says what was decided, why, and what would make us revisit it.

## Product owner input (October 10, 2026)

- **Art source:** procedural, code-drawn pixel art through the Section 12 to 14 pipeline. The
  user-supplied reference images show a richer hand-illustrated style than a code pipeline at
  64 x 96 cells produces; anything that misses the art gates is to be listed for replacement,
  not passed off as final.
- **Reference images versus the specification:** where they disagree (14,000 budget versus
  1,000, a fixed joystick versus a floating one, a side-on VS card versus top-down), the
  specification wins.
- **Review cadence:** stop for sign-off after Milestone A, before mass-producing content.
- **Repository:** `github.com/yanivr/bolt`. The session could not reach it (not found or not
  authorized), so work is committed locally until access is granted.
- **Hosting:** none yet. No public URL exists.

## Product owner input after the Milestone A review (October 10, 2026)

The owner drove Milestone A on a phone and rejected two things. Both override the
specification where they conflict.

- **Movement:** "The car's movement jumps, it is not natural and sometimes too sensitive."
  Treated as the most important problem in the project. Causes, fixes and measurements are in
  entries 26 to 33 and in `docs/evidence/feel`.
- **Camera:** the camera must not rotate with the car. The world is always drawn north-up, as
  in the supplied reference image, at a fixed distance: the car is about 6.5 percent of the
  screen width and the long side of the view shows about 900 world pixels. No zoom with speed.
  This replaces the rotating camera of Sections 7.1, 7.5 and 12.5 and the `Reduced Camera
  Motion` setting, which no longer has anything to switch off and was removed.

## Rendering

1. **Whole-number world scale chosen for a 900-pixel view.** The specification asks for a
   640 x 360 logical framebuffer with integer scaling. The canvas is instead sized in device
   pixels and the world is drawn at a whole number of canvas pixels per world pixel, chosen so
   the long side of the view shows 760 to 1,040 world pixels (target 900, which is 15 to 16
   car lengths). Common phones land in that band at their own resolution: 844 x 390 at 3x
   shows 844, a Pixel 7 shows 800, an iPad 1,024. Where a device cannot (a 667-point phone, a
   1,366-pixel laptop), the canvas is sized so the same whole-number scale shows the nearest
   allowed width and the browser resamples the finished frame by a few percent. Every player
   therefore sees about the same amount of road. `chooseViewScale` in
   `apps/web/src/game/rendering/frame.ts`; device table in `tests/feel/pacing.test.ts`.
   _Superseded October 10: this used to pick the scale from the short side for a 300 to 420
   pixel tall view under a rotating camera._
2. **Cars are drawn from authored heading frames in world space**, never rotated as bitmaps,
   now from 64 frames. The frame is chosen from the car's heading with a little hysteresis so
   it cannot flicker on a boundary. The car's position is rounded to the device pixel grid in
   world space, and so is the camera, so the car and the ground can never disagree by a
   fraction of a pixel. One camera draws everything in depth order. _Superseded October 10:
   three camera passes and an upright sprite snapped in a rotated view._
3. **Square 96 x 96 heading cells.** Section 12.4 names 64 x 96 cells. A 58-pixel body turned
   45 degrees is wider than 64, and the largest bodies approach 94 on the diagonal. The 64 x 96
   frame remains the heading-0 authoring cell (`art/source/cars`); directional sheets use 96.
4. **The camera never zooms.** The scale is fixed for the session. _Superseded October 10:
   zoom used to ease from 1.25 to 1.0 with speed, which left ground texels off the pixel grid
   whenever the speed was changing._
5. **Terrain is baked to 512-pixel indexed PNG chunks** (42 for Neon Cut, about 1.6 MB).
   Chunks whose baked lighting exceeds 256 colors have their rarest colors folded into the
   nearest common one so every chunk stays indexed.
6. **Paint is an exact-color palette swap** done once at load from a key ramp no other
   material may use; a build-time check enforces that. No tinting or CSS filters.

## Simulation

7. **World units.** One world pixel is one logical pixel. HUD speed is world speed times
   0.3125, so the default Beetle tops out near 85 MPH while still giving about a second of
   look-ahead. Section 6.5 allows abstract distance units.
8. **`coast` flag on input samples.** Section 15.5 lists steer and brake only, but Section 7.1
   requires gentle throttle and centred steering when nothing is touched. A boolean `coast`
   carries that state; the server validates it like any other field.
9. **Reverse.** Holding the brake at a standstill for 0.35 s engages a slow reverse. The
   specification does not mention reverse, but without it a car nosed into a wall is stuck
   until the winch utility exists. It cannot be used to cross a gate backwards.
10. **Corridor collision.** The drivable area is the union of corridors around the main line
    and each shortcut. Two body circles are pushed back inside; a push on one end rotates the
    car along the wall, and tangential speed is kept, minus 8 to 20 percent on a real strike.
11. **Spline straights need collinear neighbours.** A centripetal Catmull-Rom segment only
    runs straight when the control points on both sides are on the same line. Straights in
    track data are authored with that in mind so painted lines do not stair-step.
12. **Input cadence.** One input sample per simulation tick (30 per second), batched into
    packets at roughly 20 Hz. The server consumes one sample per tick, which is what makes
    client replay exact. Snapshots go out at 15 Hz.
13. **Synchronized state uses float64 for motion.** Quantizing would create a correction on
    every snapshot. Bandwidth for the current room size is small; revisit when two cars and
    projectiles share a room.
14. **Join refusals are numeric codes** (4400 to 4503) because Colyseus errors carry only a
    number. They live in the shared protocol.
15. **Reconnect grace is 20 seconds with neutral input.** Section 3.3 specifies 15 seconds
    under an emergency autopilot for races; that arrives with the AI controller in
    Milestone D and the two-player room in Milestone E.

## Client

16. **Offline test drive.** Section 5.14 says races require the server, and they do. To let
    the Milestone A gate (a real phone) be checked before any server is deployed, the client
    can run the same shared session in the page when the server is unreachable. It is badged
    in the HUD, uses the identical snapshot and event path, and can be compiled out.
17. **HUD buttons act on pointer release, not `click`.** Browsers synthesize `click` only for
    the primary touch, so a button pressed by a second finger while the first steers would
    never fire. Found by the two-finger end-to-end test.
18. **Direction steering is the default on touch.** See entry 28. _Superseded October 10:
    this entry used to describe north-up steering as an option tied to Reduced Camera Motion._
19. **Display font is drawn, not downloaded.** Headlines use an original 5 x 7 face rendered
    to a canvas at whole-cell scale. Body copy is the system sans-serif.
20. **Audio is synthesized.** Engine voice, tire scrub, impact thump and countdown beeps come
    from Web Audio nodes, so there are no audio files to license. Music and per-engine
    timbres are Milestone C and F.
21. **Car picker on the home screen.** There is no garage until Milestone B. So that the four
    shipped chassis and the paints can be reviewed and driven, the home screen has a real
    picker backed by catalog data and validated by the server. The garage replaces it.

## Tooling

22. **Pinned, widely used toolchain versions.** TypeScript 5.9, Vite 6, Vitest 3, React 18,
    Express 4, zod 3, ESLint 9, Phaser 3.90.0, the Colyseus 0.16 family, Playwright 1.56.0
    (matching the preinstalled Chromium). Newer majors exist; none is needed.
23. **No dependencies in the art pipeline.** The PNG codec, pixel buffer and sprite modeller
    are in-repo so bakes are reproducible and reviewable.
24. **Vitest uses worker threads.** Colyseus loads a module that writes to the parent IPC
    channel, which aborts Vitest's default forked pool.
25. **Colyseus schema is declared with `schema()`** rather than decorators, so every tool that
    compiles the server agrees without decorator configuration.

## Movement and camera rework (October 10, 2026)

Every claim here is backed by a bench in `tests/feel` and the before and after output in
`docs/evidence/feel`. Nobody on the team could feel the build by hand, so the acceptance
thresholds in `tests/feel/*.test.ts` are the working definition of "smooth" and "predictable".

26. **The render maths is a pure module.** `apps/web/src/game/rendering/frame.ts` holds frame
    pacing, the fixed-step clock, interpolation, the camera, pixel snapping, heading-frame
    choice and body lean. It has no Phaser in it. The race scene and the pacing bench call the
    same code.
27. **Frames are paced from timestamps, not from Phaser's smoothed delta.** Phaser's
    `smoothStep` averages the last ten frame gaps, so one dropped frame under-advanced the
    picture and then ran the next nine frames fast: a measured 6.4 device-pixel hitch out of a
    9-pixel step. It is switched off. `FramePacer` estimates the display's refresh period and
    advances by a whole number of periods (one normally, two for a dropped frame), with a slow
    correction that keeps game time on real time. Timestamp noise of 2 ms no longer reaches the
    screen. When the frame rate is not a steady refresh it falls back to raw gaps. A gap over
    250 ms is treated as a pause. The step clock runs up to eight simulation steps in a frame,
    so no gap short of a pause loses game time.
28. **Control scheme: point the stick where you want to go.** With a camera that never
    rotates, steering relative to the car reverses left and right on screen whenever the car
    drives toward the bottom. On a thumb that is confusing, so by default the stick is a
    direction. A heading controller in shared code (`directionToControl` in
    `packages/shared/src/input.ts`) turns the stick direction and the car's own predicted
    state into the ordinary `{ steer, brake, coast }` sample for the tick about to be
    simulated. The wire format, the zod schema, the server, the offline link and prediction
    replay are unchanged: they consume the numbers, not the scheme. Details:
    - Finger down inside the dead zone means go straight at full throttle. No finger means
      coast, as Section 7.1 requires.
    - Proportional control on heading error with yaw-rate damping, scaled by the car's yaw
      response at its current speed, so it arrives on the heading without overshoot at any
      speed (measured: 0.00 degrees overshoot, no steering reversals).
    - Authority fades in from the dead zone to 45 percent deflection, so a barely moved thumb
      cannot jerk the car.
    - Pointing 105 to 150 degrees off the nose trails the brake into the turn, scaled by speed
      so it never stalls. Pointing roughly straight behind brakes in a straight line to a stop,
      and held at a standstill it reverses. While reversing, the tail follows the stick until
      the stick comes round to within 80 degrees of the nose.
    - The stick origin trails the thumb beyond one and a half radii, so reversing direction
      never needs a long reach. The visible disc is still 42 pixels and still appears where
      the finger lands.
    - `Touch Steering` in settings offers `Left and Right`, which is the Section 7.1 mapping
      (horizontal steers relative to the car, pull down brakes), for players who prefer it and
      for A/B testing on hardware.
29. **Keys stay relative to the car.** Left and right turn the car, up is throttle, down is
    brake and reverse. Two keys can only name eight directions, which is too coarse to follow
    a curve, and turn-left, turn-right is what fixed-camera racers have always used on a
    keyboard. Mouse drag uses the same direction steering as touch.
30. **Corner assist in direction mode (Section 7.4).** Asking for a change of direction of
    more than 20 degrees at speed eases the throttle and leans on the brake, fully by 60
    degrees, starting at a lower speed on slippery surfaces. It acts only on the driver's own
    request and never steers. Without it, direction steering has no way to brake while
    aiming, because the stick is busy pointing. With it, a driver who only ever points at the
    road ahead finishes Neon Cut without touching a wall in every shipped chassis (enforced in
    `tests/feel/handling.test.ts`). A gentle correction costs no speed. The wheel option and
    the keyboard get no assist.
31. **Steering and tire model.** Three changes, all in `packages/shared/src/physics.ts`:
    - Full lock asks for a fixed low-speed turning circle (about 66 world pixels driven) and,
      above a hand-over speed, for a fixed lateral acceleration, so the stick maps to
      cornering force rather than to an angle. Half stick is half the yaw at every speed.
    - The tire curve is continuous: linear, a smooth knee, a gentle fade to 86 percent when
      fully sliding. The old curve switched from full grip to 82 percent in one tick, which
      measured as an 82 px/s2 step in lateral acceleration and a 40-degree slide from holding
      full lock at speed.
    - Self-aligning yaw pulls the nose toward the direction of travel in proportion to slip,
      so a slide settles at about 12 degrees instead of winding up, and a car knocked
      sideways straightens itself.
    Cornering inside 11 degrees of slip costs no speed; beyond that the tires' drag fades in.
    The steering filter no longer changes rate as it crosses centre.
32. **"Steering settle time 0.18 second" (Section 6.5) is read as the wheel filter.** The
    filtered steering reaches more than 80 percent of a new command within 0.18 s and is back
    near centre within 0.4 s of release, which is what `tests/unit/physics.test.ts` has always
    checked. The car's yaw rate takes 0.20 to 0.27 s to reach 90 percent of its steady value
    on a full-lock step, and the direction controller closes a 10-degree heading error to
    within 2 degrees in 0.33 to 0.40 s. A yaw response of 0.18 s end to end was measured in
    the old build as part of the twitch the owner objected to, so it is not the target.
33. **The server simulates each input sample exactly once.** When a car's input queue ran
    dry for a tick, the room used to repeat the last sample, which put the authoritative car
    one tick ahead of everything the client had predicted: a 9-pixel forward lurch each time,
    measured at 11.5 per minute on a mobile connection with frame hitches. The car now waits,
    for at most eight ticks (267 ms), and runs the missed steps when the late samples arrive,
    at most three extra per tick and only while a sample is left over for the next tick. Total
    steps can never exceed ticks elapsed, so sending faster gains nothing. Past the allowance
    it falls back to holding the last sample and then to a neutral coast, as before. A hole in
    the sequence numbers is filled with the previous sample and acknowledged. Consequences to
    remember for Milestone E: a car's own clock can trail room time by up to 267 ms, so finish
    order between two cars must be decided on room ticks, and the allowance is also the
    longest a client can hold its car still on purpose. `apps/server/src/rooms/inputPacer.ts`.
    For the same reason a car does not start until its driver has sent a first sample: the
    room is joined before the track art is downloaded, and the countdown used to run, and on
    a slow first load finish, before the player could see it. The offline link always worked
    this way. The room's idle timeout still disposes of a driver who never arrives.
34. **Camera lead.** With a fixed camera the car can drive toward any edge. The camera
    therefore leads in the direction of travel by up to 12 percent of the view width and 27
    percent of its height, which leaves 1.03 to 1.11 s of road ahead at top speed when
    driving up or down the screen (the hard case) and 1.8 s or more sideways, for every
    shipped chassis. The lead is driven by render-interpolated velocity through two equal
    low-pass stages of 0.2 s, so the camera's own speed has no step in it and it cannot
    overshoot. Its offset is rounded to the pixel grid separately from the car's position, so
    while the lead is steady the car sits on one whole pixel. The camera is clamped to the
    baked terrain and cuts instead of panning when the car is put back on the grid.
35. **Body lean, squat and dive use filtered accelerations with hysteresis.** They used to
    switch on raw steering and speed thresholds and could chatter by a whole sprite pixel.
36. **Protocol version 2, catalog 0.2.0.** The wire format did not change, but the simulation
    did, and a cached old client predicting old physics against a new server would be
    corrected on every snapshot. Bumping the protocol version sends it to the reload screen.

## Milestone B, data and rules (October 10, 2026)

The specification fixes ids, names, prices and masses and describes behaviour in words. The
numbers below it are ours. Every one is a seed value for balance testing (Section 11.1), lives
in catalog data or `packages/shared/src/balance.ts`, and can change without touching code.
`docs/GARAGE_API.md` is the reference for the functions and geometry.

37. **Load is installed mass.** Engine, wheel kit and mounted parts count against
    `recommendedLoadKg` and `maxLoadKg`; the chassis' own mass does not. Otherwise the Section
    11.2 limits could not be met by the bare baseline on several frames. Above recommended the
    car loses up to 18% drive force and 25% braking and gains up to 12% engine heat, in
    proportion to how far it is toward the maximum (Section 6.5 says performance falls, not
    by how much).
38. **A wheel kit is priced and weighed per four wheels.** The table price is a set of four;
    three-wheel and six-wheel frames pay and carry `wheelCount / 4` of it, rounded. The Trike
    is therefore cheaper to shoe and the Spider and Six-Wheeler dearer.
39. **Mount geometry.** Chassis-local pixels, front at negative Y. Each mount has a centre, a
    maximum footprint and a region for offsets. Parts keep 2 px clear of each other and of an
    8 x 14 wheel well at every anchor, the same for every wheel kit, so swapping tires can
    never make a legal car illegal. Offsets are whole pixels. Rotation is quarter turns and
    each mount lists the turns it allows (a left mount cannot fire across the cabin).
40. **The engine sits inside the body.** It is not part of the overlap check and any engine
    fits any chassis. Section 6.4 gives every frame an engine mount and no engine a size
    class, so there was nothing to refuse on. Mounted parts may sit above the engine bay.
41. **Mount lists per chassis** follow the Section 11.2 text. Where it only says "balanced" or
    "many", we laid out mounts to fit the body bounds, mirrored left to right, clear of the
    wheels. The Beetle, Arrow, Turtle and Spider keep their Milestone A wheel anchors, body
    bounds and engine bay. Racks (Wagon, Pickup cargo) hold two small `shared` parts.
    `UNIVERSAL` mounts take any accessory; the Horseshoe cavity takes any weapon.
42. **Armor limit.** Section 5.5 names a class limit without a number. It is 45% of the
    chassis maximum load, 15% lower on the Buggy ("armor capacity is 15% lower") and 27% on
    the Needle with a single armor mount ("armor mounts are severely limited").
43. **Passive effects are typed modifier primitives** (Section 11.8) on each part, summed by
    `aggregateModifiers`. Active effects are declared as primitive data (`actions`) and flat
    `params` now; Milestone C executes them. No part has bespoke code.
44. **Invented part numbers.** The catalog tables give price and mass only for engines and
    tires, and for accessories the text gives some figures and leaves others open. We chose:
    engine force index, torque curve shape, heat and electrical draw; tire grip per surface
    from the Section 11.4 descriptions; every accessory's energy per use, heat per use,
    cooldown, charges, footprint and mount categories wherever the text is silent. Figures
    the text does state (damage, percentages, durations, charges) are used as written.
45. **Engine characters** are data on the torque curve plus four small runtime states in the
    authoritative step: spool (turbo, jet), charge (spring, flywheel), a clock (pulse jet,
    rocket burst) and burst. They are part of the snapshot so prediction replays them.
46. **Heat model.** Heat rises by engine heat times throttle (20% at idle) plus parts, and is
    shed at `cooling x weather x airflow x (0.4 + heat / 75)`, airflow rising from 0.6 at
    rest to 1 at 170 px/s. Warning at 70, performance loss from 90 growing to 35% at 110,
    protection at 110 until the car cools to 75 (Section 5.4 names the three stages; the
    numbers are ours). Base cooling 8 per second.
47. **Energy model.** Base generation 10 per second and a 40 unit battery. The electric
    drivetrain is served first and always gets at least 55% of its demand, so a short car
    slows down and never stops; other consumers are served by priority and the HUD reports
    low power. Solar output scales with time of day (1, 0.45, 0.1) and weather.
48. **Indicators.** Energy is peak sustained draw over generation; Heat is sustained
    production over cooling at the performance threshold; both show their limit at mid-bar.
    Stability is the Section 6.5 formula with weights in `balance.ts`, clamped 10 to 100.
    The threshold is 55 (62 on the Trike, 50 on the Turtle, Spider, Brick and Twins).
49. **Instability costs cornering grip**, up to 30% at the bottom of the scale, and that loss
    applies to the steering limit as well as the tire limit. Applying it to the tires alone
    left an unstable car asking for more turn than it could hold, which felt twitchy, not
    loose.
50. **Scores** are measured, not hand-set: Speed runs the real powertrain flat out over the
    track's surface mix; Control is grip, stability, braking and yaw; Defense is effective
    hit points; Firepower and Utility saturate (`1 - exp(-x / k)`) so a sixth weapon adds
    less than the first. Formulas are in `docs/GARAGE_API.md`.
51. **Adaptive Tires** read "partial bonus on every terrain" as one fifth of the best
    specialist tire's advantage on each surface and in the wet, powered. The first reading
    (close a share of the gap to asphalt) beat Ice Spikes on ice.
52. **"Wet" includes snowfall** for parts whose text says wet weather; frost without snow is
    cold, not wet.
53. **Default engine per chassis.** `baselineBlueprint` gives five frames an engine other
    than the Four-Cylinder where the standard one leaves the frame undriveable or off
    character (the Trike gets the Mini Electric; the Brick, Rammer, Twins and Platform get the V6).
54. **Fire buttons.** Manual weapons need one of two buttons; hybrids take a button or auto
    mode; automatics take neither. A manual weapon without a button is legal but inactive,
    with a warning. Installing takes the first free button. Manual utilities are not on
    these buttons; they are activated by instance in Milestone C.
55. **Edits are refused only when they make things worse.** An edit must not add an error
    the draft did not have, nor deepen a budget or weight overrun. This keeps the 1,000
    credit rule exact and still lets a player repair an imported illegal build step by step.
56. **Build hash** is our own SHA-256 in TypeScript (no dependency was allowed, and Web
    Crypto is asynchronous and absent on insecure origins). It covers mechanical fields only,
    in canonical order. Checked against the published test vectors and Node's implementation.
57. **Join carries a blueprint.** Protocol version 3, catalog 0.3.0. The drive room validates
    the blueprint with the same function the garage uses and refuses with `ILLEGAL_BUILD`,
    `UNKNOWN_PART` or `CATALOG_MISMATCH`. The snapshot gained heat, battery, engine state,
    wheel integrity and the build hash. A saved Milestone A loadout is migrated on first load.
58. **Sprites that do not exist yet.** The picker offers only chassis with art. An engine or
    wheel kit without art is drawn with the Four-Cylinder or Street Tires sheet, for drawing
    only; physics, validation and the hash use the real part. Mounted parts are not drawn.
    `SPRITES_PENDING` in `tests/unit/assets.test.ts` lists what is owed and fails when the
    atlas and the list disagree. The car atlas manifest gained an optional `parts` record.
59. **Handling limits for the Trike and Drifter.** The handling bench holds eighteen frames
    to the Milestone A limits. The Trike and Drifter are specified as loose ("less stable
    during sharp turns", "controlled lateral motion") and use wider limits for slip and
    overshoot. The default Beetle's numbers are unchanged from 0.2.0.
60. **HUD.** No player-facing HUD was added for heat or power; that belongs to the HUD work.
    The debug readout shows both so the model can be watched while driving.

## Milestone B, garage and flow (October 10, 2026)

61. **One car renderer outside the race.** `components/CarCanvas.tsx` draws any blueprint from
    the real sheets through the shared `layoutCar`, with `resolveCarSprites` and
    `mountedPartSprites`, the exact-color paint swap, an integer CSS scale and nearest-neighbor
    sampling. The home turntable, the workbench and every thumbnail use it; `CarTurntable` is
    gone. A mounted part whose sheet is missing from the manifest, or fails to download, is
    left off the drawing and stays fully editable through its mount marker.
62. **Mount markers are placed by the compositor.** Mount centres, socket corners and part
    footprints are passed through `layoutCar` as if they were parts (`projectPoints`), so a
    marker is exactly where the part sprite is drawn, including the lift of the tilted view. A
    drag is turned back into chassis-local pixels with the inverse of the same rotation.
63. **Rotate view steps through four headings**, nose up, right, down and left. The diagonal
    headings need a much smaller scale to fit a phone and put mounts off the body, so they are
    left to the turntable. The workbench picks the largest whole-number scale (2 to 6) at
    which the body and every socket fit the current view.
64. **Layout.** Category rail on the far left for the full height (width is cheap on a
    landscape phone, height is not), the car in the middle, the part list on the right, the
    five indicators and the actions along the bottom, as in the owner's mockup. Section 5.15
    gives the car 48 percent; it has about 45 percent of what the rail leaves. Undo and Redo
    sit in the header beside Back. Under 740 px wide, Reset, Save and Quick Build fold into a
    `More` menu and the score strip shows glyphs instead of names, so nothing is clipped at
    667 x 375. From 1100 px the list and the compare pane are side by side.
65. **The compare pane replaces the list on a phone** and has previous and next buttons, so
    stepping through a category is one tap per part. A card's benefit and downside are each
    one line; when a part cannot be installed the validator's reason takes the place of the
    downside line, so cards never change height. The full text is in the compare pane
    (Section 5.15: secondary descriptions one tap away on a short phone).
66. **Buying is always the Install, Replace or Swap button.** `planInstall` in
    `garage/buildSession.ts` decides what a press means and is used for the card's reason,
    the preview and the press itself, so the three cannot disagree. A blocked button stays
    focusable (`aria-disabled`) and a press on it states the reason instead of doing nothing.
    Replace is remove plus install as one history step, with spend and refund compared
    against the build before either.
67. **Selection.** Tapping an empty mount filters the list to what fits it. Tapping an
    installed part opens its tools (nudge, rotate, fire button, remove, replace). `Replace`
    in the tools targets the mount; opening a category from the rail lets go of a part that
    was only selected for adjusting. Nudge arrows are relative to the car, not the screen.
68. **Build clock.** The session holds an absolute deadline and the newest snapshot the
    validator accepted. `tick` locks that snapshot at the deadline; `lockWith` and
    `setDeadline` exist so a server can own the phase in Milestone E. The clock is local
    today and runs in solo play because the brief asks for it. `?buildSeconds=N` changes it
    only in development builds or with `?debug=1`.
69. **Illegal drafts.** Garage edits cannot make one, so they come only from saved builds. A
    flagged card offers `Repair Build` (the shared auto-repair, reporting what it removed) and
    `Review`, which opens the draft in the garage with the offending part and category
    marked, Ready held back with the reason, and the same repair one press away.
70. **My Blueprints is local.** `bolt.blueprints.v1` holds up to 30 entries. Each is parsed
    with the shared zod schema and then validated; anything that is not a blueprint is
    dropped, anything no longer legal is kept and flagged. Share codes (`CAR-XXXXXX-XX`) need
    the server and are not shown anywhere.
71. **Track Preview shows the course map, not a diorama.** There is no biome diorama art.
    Corners are counted from the track runtime (bends tighter than 800 px radius through 45
    degrees or more), lap length from its measured length, and both tips from
    `SURFACE_GRIP`, `COOLING_MULTIPLIER` and the solar factors. Only the baked weather preset
    is offered.
72. **Home.** The Milestone A chassis picker is replaced by the garage. `Use Last Build`
    appears once a build has been raced. The modes of later milestones are still not shown.
73. **Not done from Section 5.6:** two-finger zoom on the workbench, flipping a paired part,
    and the inventory tray (a part that does not fit is refunded at once, which the
    specification also allows).

74. **Engines in a bay lose their tail pipes.** Six chassis (Scorpion, Trike, Wagon, Rammer, Drifter, Pickup) carry the engine ahead of the tail. Every engine is baked twice: the full sheet, and a `bay` sheet without the solids that hang below the deck. A chassis whose engine anchor is forward of y 15 is marked `engineInBay` and draws the bay sheet (`engineSheetFor`). The chassis art places its own exhaust anchors.
75. **Street tire cell is 24 px.** At 20 px the tilted render clipped at some directions.
