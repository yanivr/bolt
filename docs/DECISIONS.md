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
76. **The garage is navigated by slot, not by category (redesign after the owner's phone test).** The product owner used the Milestone B garage on a real iPhone inside the host page, where the usable viewport is about 870 x 370 in landscape and 450 x 840 in portrait. His verdict: the idea is right, the screen is cramped. Mount markers sat on the car and hid the parts, the car was small, the list showed about two and a half parts (many of them "No compatible mount"), and in portrait about one. Decisions 62 to 65 and 67 are replaced by 76 to 84. The rules, the store's edit reducers and `planInstall` (66) are unchanged.
77. **Slots around the car, not on it.** Every accessory mount is a tile beside the car (54 x 48 px, 50 x 44 when a column is full) joined to the mount's real position by a one-pixel leader line. The position comes from `projectPoints`, which runs `layoutCar`, so the line ends where the compositor draws the part, tilt and mount height included. `layoutBench` in `garage/benchLayout.ts` is a pure function: mounts go left or right by their place on screen, a column is ordered by on-screen y, and any two leaders that cross trade tiles (each trade shortens both, so it ends). When one column per side is not enough a second, outer column sits level with the gaps of the inner one, so its leaders run through a gap and never under a tile. Scrolling columns without leaders are the last resort; today only the nine-mount Brick and ten-mount Platform on a 667 px wide phone need them. Top and bottom rows were not built: on a short landscape phone they cost car height, and on a tall screen one column per side already holds every chassis.
78. **The car is drawn clean and as large as its art allows.** Nothing interactive or boxed is drawn over the sprite. The scale is the largest whole number at which the car fits between the columns; its extent is measured from the opaque pixels of the body and shadow sheets (`measureChassis`), with the largest part box of every mount added, because the chassis' own half-sizes overstate a rounded body by several pixels and cost a whole scale step on a phone. The selected part is picked out by a one-pixel outline traced around its own sprite (its frame as a flat silhouette, drawn one pixel out in four directions under the part), pulsing gently and holding still under Reduced Motion. An empty selected mount shows a dashed socket. Drag-to-nudge remains through an invisible handle over the selected part only; the arrow buttons are the primary way.
79. **View headings.** The rotate-view control steps through frames 18, 46, 50 and 14 of 64: three-quarter views with the nose right or left and a little toward or away from the viewer. Chosen from renders: roof, hood and one side all read, and the car lies along the long axis of a landscape workbench. The steeper 45 degree views looked no better and dropped most chassis a scale step at 340 to 370 px of height.
80. **No category rail.** Chassis, Engine and Wheels are three fixed tiles under the car, with `Stats` (the idle view) and `View` beside them. A tap on any slot lists only what can go there: for a mount, every weapon, defense and utility that physically fits it (`partsForSlot` in `garage/slots.ts`), under sticky 20 px headers, with filter chips on a list of more than twelve where the panel is at least 400 px tall. `Browse All Parts` (last row of every list, the idle panel, the More menu) opens the whole catalog by category; there a part says where it would go, offers to replace what holds its only mount, or says that this chassis has no mount for it and which kinds of mount it needs.
81. **One row per part.** 56 px rows (52 px under 390 px of height, 48 px under 360 px): the 32 px icon at one and a half times on a lighter plate with no padding (exact on a 2x screen, within a device pixel on a 3x one), name, price, weight and one line. The benefit sentence is shown only where the list is 380 px wide or more (the brief said 400; the owner's panel is 393 px and the line is otherwise empty). A blocked row shows the validator's reason there instead.
82. **The side panel runs the full height under the header; the gauges sit under the workbench.** The approved sketch had the gauge strip across the whole width. At 340 px of height that leaves 240 px for the panel, which is exactly five 48 px rows with no header and no borders. Putting the four gauges and `More` under the workbench instead gives the panel 285 px: five rows at 870 x 340 and at 870 x 370, checked end to end. Budget is not a gauge: it is the Credits Left number, which is now a button that opens the same breakdown.
83. **Less permanent chrome.** The header keeps Back, Undo, Redo, the timer, the track badge (dropped under 740 px), Credits Left and Ready, which is the only gold control and moves to a full-width bar at the bottom in portrait. The five scores live in the compare pane and in the idle `Your Car` panel (name, paint, ready or not, scores, credits used). Reset, Save, Quick Build and Paint and Name are in `More`. The status line is a short strip over the clear floor above the car, shown only when there is something to say; a standing reason (the build cannot race) is on the idle panel with `Repair Build`, and as one line over the workbench while a list is open.
84. **After a purchase.** A swap of chassis, engine or wheels returns to that slot's list. An accessory lands on its card (fire button, rotate, nudge, replace, remove), which is the occupied slot's view; the brief's "returns to the list" is read that way, because the next thing a player does to a new weapon is give it a fire button. On a wide screen the mount's list stays beside the card.
85. **First-build tips.** The three steps are numbered badges on the Chassis and Wheels tiles and on the first free mount that takes a weapon. The steps, `Use Starter Car` and `Skip tips` are a block on the idle panel in landscape and one 48 px line in portrait; an open list names its step in its header. `Skip tips` is also in `More`.
86. **Not done in the redesign:** the filter chips are hidden on panels shorter than 400 px (every landscape phone and the portrait list), where a row is worth more; in portrait the `Stats` and `View` buttons float on the corners of the car strip and are not reserved in the layout, so an unusually large frame could pass under them; the leader lines cross the car's own pixels on their way to a roof mount.

## Five chassis and garage focus mode (October 11, 2026)

87. **The game has five chassis, not twenty (product-owner decision of October 11, 2026).** The specification lists twenty (Sections 6.4 and 11.2) and `docs/MASTER_SPEC.md` is left as written; this entry overrides it. The owner, after using the garage on a real iPhone, chose fewer and better differentiated frames that work well in the garage and in the race: three ordinary and two strange. They are `chassis_beetle` (the balanced starting point), `chassis_arrow` (light and fast, little room for equipment), `chassis_pickup` (the heavy hauler with an open bed for equipment), `chassis_spider` (six wheels on arms, very stable, many mounts) and `chassis_trike` (three wheels, tiny and cheap, leaves budget for weapons, easy to tip). The catalog is 105 parts and version 0.4.0. The fifteen others are removed from the catalog, the templates, the atlas and the tests, not hidden; their art models are kept unbaked in `art/scripts/cars/chassis/retired`. The five were tuned as a set so each is best at one thing and pays for it in a number the garage shows; the table and every change are in `docs/BALANCE_CHANGELOG.md` 0.4.0, and `tests/unit/catalog.test.ts` holds the claims to the data. Entries 41, 42, 53 and 59 are superseded where they name retired frames. Wherever Section 19.7 or a test says "20 chassis" or "120 parts", read 5 and 105.
88. **What the cut did to the parts.** Two weapons lost every mount with the retired frames: the Needle Railgun (8 x 18) and the Arc Mortar (16 x 16). The Arrow's spine mount was lengthened to 10 x 18 for the railgun (10 wide, not 12, to stay 2 px clear of the front wheel wells, so 12 x 12 parts now go on its rear roof mount). The Pickup's bed became two `UNIVERSAL` mounts: a rack behind the cab that holds two small parts of any kind, and the bed floor, 18 x 16, which takes any one part and is the mortar's only home. The Pickup's hood mount was removed, because its engine stands through the hood there, and replaced by a small mount on the cab roof. The one-off rules of retired frames (reduced armor allowances, the any-weapon cavity, aim overrides) remain as data primitives that no chassis uses; nothing was deleted from `packages/shared`.
89. **A saved car on a retired chassis is rebuilt on the Beetle.** It is read back like any other stored blueprint (never dropped, never a crash), flagged with the existing "older part values" line, shown as `Retired frame`, and cannot be used until repaired. `repairBlueprint` takes an optional `fallbackChassisId`: the car keeps its engine, wheel kit, paint and name, every part that has a home on the fallback frame is bought again there (most expensive first, with its fire button kept where legal), and the rest are refunded and named. The garage and My Blueprints pass the Beetle. The server never repairs: a join on a retired chassis is refused as `UNKNOWN_PART`, or as `CATALOG_MISMATCH` when it still carries the old catalog version. The last-raced car in storage is not repaired silently either: if it is no longer legal the session starts on the baseline, as before.
90. **Focus mode (approved option).** With nothing selected the workbench is the overview of entry 77: the whole car, a tile and a leader for every mount. Selecting an accessory mount, empty or occupied, or the engine, moves the view in on it: the car is drawn one or two whole steps larger (4x or 5x on the owner's phone, where the overview is 3x) and panned so the slot is in the middle of the floor the tiles leave free. Chassis and Wheels show the whole car. The other tiles keep their side and order at the compact 50 x 44 size, so switching slots is one tap; only the selected slot keeps its leader. `Whole Car` (the Stats tile, which is the same action and changes its label and glyph while a slot is open), Escape, and a tap on the bare floor go back. The camera is a pure function, `focusCamera` in `garage/benchLayout.ts`: the largest candidate scale at which the largest part that mount takes, plus 9 sprite pixels of bodywork on every side, fits the free floor; then the part centred, except that the pan stops before more than a tenth of the floor is empty beside the car, and an axis on which the whole car fits is centred and not panned. Scales and offsets are whole numbers. The move is a snap and an ease: the scale switches at once and the pan eases over 150 ms from where the slot was (Web Animations on the car element, nothing drawn between scales), and nothing moves under Reduced Motion.
91. **What is drawn on the car in focus.** The selected part keeps its gold outline (entry 78). Added: a thin dashed box for the room its mount gives it, so a nudge reads against something still; a gold chevron just ahead of the part for the way it faces, projected like everything else, so it turns with the part and with the view; and for the engine, which has no outline to trace, a dashed box like an empty socket. The car element takes no presses of its own; only the drag handle over the selected part is live.
92. **The status line has a place of its own** (replaces the strip over the floor in entry 83). In landscape it is the free middle of the header, between the track badge and Credits Left, two lines at most with the whole text in its title; in portrait it is a 22 px row under the slots. Its size is reserved whether or not there is anything to say, so it never lies over the car and nothing shifts. With nothing to report it says `Ready to Race` quietly. A long reason is cut there; the idle panel and the blocked button carry it in full.
93. **Essentials tiles.** Chassis, Engine and Wheels show the category small on top and the icon (24 px, from the 24 px sheet) and the item's name on one line under it, cut with an ellipsis and never wrapped. Under 740 px of width the icon gives its room to the name. In portrait they are a row of their own with full names.
94. **Nothing on the workbench scrolls** (replaces the scrolling fallback of entry 77). No chassis has more than eight mounts, so one column a side always holds them at the five landscape sizes; the scrolling columns were dead code and are gone. A floor too short for four tiles a side (a phone under 340 px tall) falls back to the second, outer column. In portrait the mounts are one row under the car (two when eight would be under 44 px each) and the essentials another; Stats and View are a column beside the car strip, reserved in the layout, so neither can sit over the car.
95. **The car is measured whole, and short phones give the floor more height.** `measureChassis` now measures the composed bare car (wheels included: the Spider's stand outside its body), and the halo slack goes round the part boxes only. Under 390 px of height the essentials row is 44 px and the padding 3 px. Together with a leader gap of 8 px this is what draws the Spider at 3x, not 2x, at 870 x 370 and 667 x 375. The Pickup is 3x at 870 x 370 and 2x at 667 x 375, where it would need 22 px more width.
96. **Compare pane and idle panel.** The comparison is a two-column table, the five scores on the left and the five indicators on the right, and on a short pane the title, the two sentences and the rows tighten (each sentence one line, the arrow between the two numbers dropped under 340 px of width) so it fits 667 x 375 without scrolling; the full sentences are on the list row. The idle `Your Car` panel now shows the five scores, the five indicators as a row of states that open their working, two lines derived from the scores (`summarizeCar`: the best one or two at 60 or more, and the lowest when it is under 45; no written copy about any car), and the mounted equipment as a list whose rows open their slot.
97. **Cost of the redesign in portrait.** The second slot row and the status row take 70 px from the list at 450 x 840: five whole part rows show where six did (five with the first-build line up as well, at 48 px a row). The car strip is 28.5 percent of the height, which still draws the Beetle at 4x.
98. **Not done.** The focus move is not animated for the tiles, which change size at once. A wheel kit much larger than Street Tires can stand a pixel or two outside the measured box. In focus the tiles at the edges stand over the enlarged car by design; on a narrow phone they cover some of its ends. Two-finger zoom is still not built (entry 73): focus is its replacement for positioning parts.

## Facing, the hero pass and anchors (October 11, 2026)

99. **Facing is the player's choice, not a side effect of geometry (product-owner decision).** On his phone the owner put a Road Shotgun (8 x 12) on the Trike's roof (14 x 10) and could only face it left or right, because that was the only way the oblong fitted the box. `allowedRotations` mixed "which way may this face here" with "does the turned rectangle fit". They are now separate, catalog 0.5.0:
    - _The part says how its direction is decided_, as data: `facing: 'free' | 'fixed' | 'none'`, with `fixedTurn` (a quarter turn, or `'outward'`) for a fixed part. `rotatable` is gone. Free: thirteen weapons that fire along their axis (Front Machine Gun, Rear Sentry, Road Shotgun, Needle Railgun, Straight Rocket, Seeker Missile, Sticky Foam, Flame Spitter, Frost Cannon, Crash Hammer, Grapple Harpoon, Air Cannon, Steel Boomerang) and the two plates. Fixed: Road Mine and Oil Slick (rear), Rear Guard (rear), Crash Bumper and Mine Sweeper (front), Side Saw and Side Shields (outward). None: Swivel Turret, EMP Pulse, Tesla Arc and Arc Mortar, which find their own target all round, the other sixteen defenses and all twenty utilities. No utility has a direction a player could usefully choose; the booster's nozzle and the radar's dish are part of the box.
    - _The room a free part takes is a square base_, the smaller side of its footprint (`partBase`, `occupiedFootprint`), the same at every quarter turn. Fit, overlap, wheel and nudge checks use it. The smaller side was chosen over a per-part number because it is the one rule under which everything that fitted before still fits (a part that fitted some way round had its smaller side inside both sides of the box), and it needs no table to maintain. Barrels, nozzles and rails overhang the base and may overhang the mount; that is drawing only. A fixed part takes its footprint turned with it, a part with no facing its footprint as written, so a bumper is still 14 wide.
    - _The mount says which ways a free part may point_, as a statement about the car: front mounts forward only; rear mounts backward only; left and right mounts outward, forward or backward and never inward across the cabin (a gun on a flank firing forward is a sponson, and that was already allowed); roof, universal and utility mounts all four. The Pickup's bed rails are rear mounts on a side wall and allow backward and outward. A fixed part ignores the mount's list: a mine drops behind from a tail mount, a sill pod or the Spider's nose bay alike.
    - _The convention is unchanged_: quarter turn 0 faces the front of the car, 1 right, 2 rear, 3 left, which is what `layoutCar` already drew (frame of the car heading plus a quarter turn a step). `partHeadingRad` and `partDirection` give the weapon's world firing direction for the combat milestone.
    - _What it changed._ Nothing that could be installed stopped being installable (884 combinations, held by a fixture generated before the change). Thirty-two more can be, listed in `docs/BALANCE_CHANGELOG.md` 0.5.0; the one that matters is the Needle Railgun, which entry 88 gave to the Arrow alone and which now goes on most front and roof mounts. That is a consequence of the approved rule, not a retune, and is flagged for the balance pass. A free part can no longer face sideways on a nose or tail mount.
    - _Saved cars._ A blueprint from 0.4.0 is flagged like any other out-of-date build. `refaceBlueprint` turns each part to a legal facing (its own turn if still legal, else its fixed turn or the mount's default) and `repairBlueprint` runs it first, so `Repair Build` keeps every part. Three templates carried a fixed part at turn 0 and now carry it at turn 2. Entry 89 stands: the last-raced car is not repaired silently.
100. **The direction picker and the part card.** The cycling `Rotate` button and the "Facing right" text are replaced by a compass of four arrow buttons relative to the car (Front up, Right, Rear, Left), a radio group with the current one lit. A direction the mount does not have is dimmed, stays focusable (`aria-disabled`) and says why on a press: "This mount only faces forward." for a mount with one facing, "This mount can't face right." for one with several. R still steps clockwise through what is allowed, and says the same when there is nowhere to step. A part whose facing is fixed or none has no picker. The card is two three-by-three pads side by side, `Facing` and `Position` (the nudge arrows round the offset readout), each named in its free corner, with Replace and Remove beside them; Remove carries its refund on a second line, so four digits fit. On a card narrower than 388 px (667 x 375) the two actions are a row under the pads and the refund goes back beside the word. The drag hint is gone, and the fire-button note is one line ("Two weapons can have a fire button.") shown only where the card has the height to spare (not at 667 x 375). Nothing on the card scrolls at 870 x 370, 870 x 340, 844 x 390 or 667 x 375 (asserted end to end).
101. **The facing mark is an arrow past the muzzle, not from the centre** (replaces the chevron of entry 91). The brief asked for a short arrow from the part's centre. Drawn from the centre it lay across the barrel, which is the thing the hero pass made worth looking at. It is on the line from the centre along the facing, on the bodywork plane, and starts three sprite pixels past the far end of the drawing (the muzzle anchor where there is one): a shaft of eight pixels and a head. It is projected by `projectPoints` like the part, so it agrees with the picker in every view heading (asserted end to end against the sprite frame). Shown for free and fixed parts; a fixed part has no picker, so the arrow is how the garage says a mine drops behind.
102. **Hero pass on the 60 mounted parts (approved direction: moderate).** On the car at 3x to 5x the parts were small grey shapes that sank into the bodywork. Four things, all in the art pipeline: - _Scale._ Models are still written at their catalog footprint and finished larger (`Kit.done(id, cell, { scale })`): weapons 1.08 to 1.18, defenses 1.10 (shield and interceptor 1.18), utilities 1.12 (mine detector 1.3; wing, jump pad and solar panel 1.06). Barrels, lances, rails, darts and the saw blade were lengthened by hand on top of that. The base rule of entry 99 is what makes the overhang legal. - _One signature shape a weapon_, named above each function in `art/scripts/cars/parts/weapons.ts`. Rebuilt outright: the Side Saw (a flat toothed disc reaching out past the flank, where it was a blade on edge along it), the Road Mine (a fat mine with its hatch behind it, where the hatch hid it), the Oil Slick (a black drum with amber bands, where an amber drum vanished on Sunflare). - _Separation._ (a) An outline in one near-black cool color (`#0a0d18`) all the way round, through a new `outlineColor` option of the modeller; chassis keep the selective outline. (b) A contact shadow baked into the sheet: the part's footprint on its surface pushed two pixels down and right and drawn only where the part is not, in an opaque dark navy (`#1b2134`) a step lighter than the outline. Baked, not a compositor layer: `layoutCar` still draws one sprite a part, and sheets stay fully opaque or clear. (c) Weapon metal (`gunmetal`, `iron`) is lighter and cooler than the midtone of all four paints; utility housings and armor steel were lightened with it. - _A ceiling of 16 authored units._ Nothing stands more than that above its mount once finished. The garage overview is sized to the pixel so the Spider is drawn at three times on the owner's phone (entry 95), and that is the room its roof mounts have before the top of the floor cuts a part; a radar finished at 1.2 was cut by one CSS pixel, so it is 1.12 and the Tesla Arc 1.16. An end-to-end test puts both on the Spider's roof at every phone size. - _The overview no longer clips the car._ The floor is sized for the car with a part of ordinary height on every mount (entry 78). A barrel turned outward on a high mount (a shotgun on the Pickup's bed rail, in the view where that rail is at the top) stands two or three sprite pixels past that and was cut by the floor's edge; outside focus the floor now lets it show over its border. In focus the car is larger than the floor on purpose and is still clipped. Sizing the floor for the worst part instead would have cost the Spider its third step of scale on the owner's phone. - _Cells_ grew to hold the drawing at every heading with two clear pixels (26 to 52 px, was 28 to 44). The car canvas outside the race keeps 16 sprite pixels of clear room round the chassis cell (`CAR_CANVAS_PAD`), pulled back by a negative margin so layout still sees the cell: a harpoon on the Arrow's nose was otherwise cut at the canvas edge with the nose up. - _Icons._ `modelExtent` sized an icon from the ground radius plus half the lift of the first solid over each point, which cropped tall parts and left the rest small; a zero-height `iconFit` marker solid worked round it. Both are gone. `art/scripts/lib/icon.ts` frames an icon from the true on-screen box of the model at the icon heading and corrects the scale against the drawn pixels, so the longer side of every icon fills its tile less one pixel of margin (asserted). - _Not done / weak._ The pass was reviewed by the developer only, in `art/preview/parts`. The weakest five, frankly: Heat Guard (a gold dome that nearly vanishes on Sunflare), Traction Computer and Turret Computer (small boxes with a light on, told apart only by their icons), Composite Shell (reads as a second Heavy Plating) and Decoy Drone (too small for its rotors to read at 3x). A fully loaded Trike is more equipment than car; that is four hero parts on a 26 x 48 frame.
103. **Muzzle and pivot anchors for the combat milestone.** `PartArt` and `PartSpriteManifest` carry `muzzles?: PartAnchor[]` and `pivot?: PartAnchor`, `{ x, y, z }` in the part's own space at heading 0: `x` right and `y` toward the rear in sprite pixels from the part's centre, `z` up from the mount surface in authored height units (those of `mountHeights`). Every weapon has at least one muzzle, one per barrel in firing order (two on the Front Machine Gun, the Seeker Missile and the Tesla Arc); for the weapons with no facing it is where the effect starts (the EMP core, the mortar's mouth). The Swivel Turret alone has a pivot. `partAnchorOffset(anchor, headingRad)` in `packages/shared/src/assets.ts` puts one on screen with the baker's own arithmetic; a test checks every anchor lies on its drawing at all 64 headings. The Section 13.4 animation tags (`muzzle`, `barrel`, `charge0..`, `hatch`, `spool`, `nozzle`, `pilot`, `arm`, `spring`, `teeth`, `sensor`, `blink`) are all still on their solids.

## The combat simulation: Milestone C part 1 (October 11, 2026)

104. **One race object, one step, for every caller.** `RaceSession` (`packages/shared/src/race.ts`) holds N cars (two at launch), projectiles and hazards; `stepRace` advances all of it one tick in the order of Section 11.8 and leaves the tick's events in `race.events`. The server room, the offline link, the scenario runner, the balance harness and the tests call the same function. The single-car `DriveSession` of Milestones A and B is unchanged and is what a car in a race still is: combat reaches a car's physics only through `VehicleEffects`, a record of multipliers whose neutral values give bit-identical physics to before (all 1,029 earlier tests pass untouched in their expectations, bar three listed in entry 121).
105. **A room's race advances once per input sample of its one human driver.** This keeps the Milestone A promise (the client predicts its own car exactly, nothing is corrected on screen) with a second car on the track, and it makes the whole race a pure function of the seed and the player's samples, which is why the offline link reproduces a server race tick for tick (asserted for all 33 scenarios). It is right only while there is one human in the room: the rival's clock is slaved to the player's connection. Milestone E must step two-player rooms on room ticks; `InputPacer` is the seam, and the client already treats the rival as interpolated, never predicted.
106. **Primitives.** Twenty weapons on eighteen primitives (the three bullet guns share `burst` and differ in how they aim), five reactive defenses and eleven utility primitives; the other fifteen defenses and nine utilities are passive modifier totals. `compileModules` is the only place a `behaviorId` is read and every number comes from the part's catalog `params`: a missing number fails when the race is created, not as a silent default. The `actions` arrays written in Milestone B remain as documentation of intent; the simulation reads `params`.
107. **Rule-side muzzles.** The simulation does not read the art manifest. A weapon fires from its mount position plus half its footprint along its facing (`ModuleSpec.lx`, `ly`, `muzzle`). Part 2 may draw the flash at the art anchor; the two are within a few pixels, and the `shot` event's position is the simulation's.
108. **Damage localisation and shares.** A hit goes to the component nearest its point within 15 px; 40 percent of it also goes to the chassis; a hit on bare bodywork puts 70 percent on the chassis and nothing on a component. Armor is a pool per arc, separate from chassis, and a worn plate lets a share through (never under half absorbed). These numbers are ours (the spec fixes the 0 to 100 integrity scale and the states, not the shares) and are in `balance.ts`.
109. **Knockout and limp.** Exactly Section 3.4: chassis at zero and two of engine, steering and locomotion (half the wheels) disabled for three seconds. In a duel a knockout ends the race at once, reason `ko`, the survivor wins. Zero chassis alone is limp mode (drive x 0.6). There is no respawn; the spec has none, and the Recovery Winch is a short pull, not a reset. KO incidence in 440 bot races: zero.
110. **Slows are a cap on top speed, not a force.** A `slow` holds the car to a share below the speed it was caught at (never below the speed its engine holds full force to), eased in at 300 px/s per second, so two slows cannot stack into a stop and the 45 percent cap of Section 8.1 is a property of the status, not of tuning. Grip loss is capped at 60 percent.
111. **Immunity.** A hard disable (`emp`, `jam`) grants immunity for its length plus two seconds; a major shove (over 90 px/s) grants two. Immunity blocks the control effect only: the second hammer blow still does its damage. It is announced as a status so a client can show it.
112. **Self-damage and friendly rules.** Nothing knows whose side it is on. A car inside its own blast is hurt by it, its own mine goes off under it if it drives back over it, and its own oil and foam affect it. A projectile cannot strike the car that fired it. Fire on oil burns whoever is in it. Ram damage is shared by mass and closing speed, forgiven under 45 px/s, and scaled to 30 percent for the first 1.5 s after GO.
113. **The seeker fires without a lock.** Pressing fire with no lock launches the missile straight ahead rather than refusing: a refusal costs nothing and teaches nothing, a wasted missile does both. With a lock the button fires when pressed; held, it fires on acquiring.
114. **A button held through the countdown is a press at GO.** Edge detection restarts when the race does. It is what a player holding the trigger on the grid expects, and nothing can fire before GO.
115. **Debug options.** A join may name a rival template id, a seed or a scenario id. The server honours them only when `debugOptions` is on, which is the default outside production; with it off the join is refused. The rival is always a shipped template named by id, never a blueprint from the client. The client reads `rival`, `seed` and `scenario` from the query string only with `?debug=1`.
116. **Schema nesting.** Colyseus schemas hold at most 64 fields a class. The room state keeps the player's car flat at the root, as before, and puts effects, combat, the race and the rival in nested schemas, with projectiles and hazards as maps keyed by id. The player's own motion stays float64 (prediction), the rival's is float32 (interpolation). Ballistic projectiles are written once.
117. **What the client predicts.** Its own car's motion only. Effects come from the snapshot, so a slow is felt one snapshot late and never fought; disabled parts re-derive the coefficients on both sides; the rival is a ghost for contact. Firing is not predicted: a shot appears when the server says so. See `docs/COMBAT_API.md`.
118. **The sparring rival is not the AI.** `SparringBrain` is a centerline driver with simple rules for passing, firing, traps and repairs, seeded for its reaction times. It acts only through the control sample a player sends. It does not pick builds, has no difficulty levels and no racing line. Milestone D implements `RaceBrain`.
119. **Scenario rooms keep the fire buttons on the wire.** In a scenario room the server drives both cars' steering from the script but takes the player car's fire and utility bits from the client's samples, so the integration tests exercise the real input path and the real refusals.
120. **Lobbed projectiles and tethers count from the tick of their event.** A shell lands exactly `ticks` after its `telegraph`; the harpoon line lasts exactly its two seconds from `attached`. Both were one tick short until a test measured them.
121. **Changes to earlier behaviour.** (a) `NEUTRAL_BRAKE` is 0.58, not 0.75: a car that had finished sat on a brake value past the reverse threshold and backed away from the line for the rest of the finishing window. Found by the two-car race, present since Milestone A. (b) The offline link takes a race, not a session. (c) `inputPacer` carries three more fields. Three existing tests were edited for (b) and (c) and for the room's new default of a seeded rival (`tests/integration/driveRoom.test.ts` pins the unarmed baseline as rival so its single-car assertions stand).
122. **Catalog 0.6.0.** Combat parameters were added to weapons and utilities (spread, projectile radius, lock times, blast radii, hazard sizes and lives, and so on), bullets gained range falloff, and the Decoy Drone's drop distance moved outside the hull. No price or mass changed. See `docs/BALANCE_CHANGELOG.md`. As with every catalog bump, saved blueprints stamped 0.5.0 are flagged out of date until repaired.
123. **Not done in part 1, on purpose.** No combat art, sound, particles or HUD: `CombatDebugView` and the two debug rows in the HUD are marked stand-ins. No pit lanes or repair pads on the track (Section 8.2's track-side repairs need track data that arrives with the other tracks). Wind does not move projectiles. No destructible obstacles. Weather does not change mid-race.

## Sound: Milestone C part 2, track A (October 11, 2026)

124. **All sound is synthesized, and every sound is data.** There are no audio files and none may be added. A sound is a recipe (`apps/web/src/game/audio/recipe.ts`): one to five layers, each a channel of an imaginary sound chip (50, 25 and 12.5 percent pulse, triangle, saw, sine, white noise, the 15-bit shift register and its 93-step short mode), a pitch curve that glides or steps, an envelope, and optionally two-operator FM, an LFO, a filter and a bit-crush. `synth.ts` turns a recipe into nodes on any `BaseAudioContext`, so the offline renders the tests measure run exactly the code the game runs. Engines are a second kind of recipe on a fixed graph. Nothing outside `recipe.ts`, the recipe tables and `soundMap.ts` needs to change to add or retune a sound.
125. **One audio system, owned by its module; `EngineAudio` is its front.** The Milestone A `EngineAudio` was created by the race screen and was the whole of the sound. It keeps its five calls (`unlock`, `setVolumes`, `update`, `thump`, `beep`) and `dispose`, unchanged, and now forwards them to a module singleton in `game/audio/index.ts` that owns the one `AudioContext`. The singleton listens for gestures itself, so interface sounds work on screens that never construct `EngineAudio`, and `dispose` ends the race's sounds without closing the context. No call site in the scene or the race screen was edited.
126. **The audio hears the race only through `raceFeed`, and infers what the feed does not carry.** It subscribes when the context is created. The snapshot does not carry the viewer's own blueprint, the track, the laps or the surface under the car, so `index.ts` works them out: the car is the saved blueprint in the app store, or the scenario's car when `?debug=1&scenario=` names one; the track is `city_01` with `city_clear_night`, the one pairing `app/App.tsx` races today, built a second time for the surface lookup. That default is a constant in `game/audio/index.ts` and is wrong the day a second track ships: the race screen should then call `setAudioRaceContext({ blueprint, trackId, weatherPresetId, track })`, which exists for it. What else the event stream lacks is listed in `docs/AUDIO_GUIDE.md`.
127. **Levels are calibrated by measurement, not set by hand.** A recipe has a category, and a category has a loudness target: the loudest 100 ms RMS of the sound alone, after the master chain, every slider at full (explosions -12 dBFS, big shots -15, alerts -16, impacts and stingers -17, small shots, race cues and utilities -19, installs -21, small impacts -22, mechanisms -23, interface -24, travel loops -25, status loops -26; engines -20 at full throttle). `tests/audio/calibrate.ts` renders every recipe in headless Chromium, moves its gain until it sits on the target and writes `sfxTrim.ts`. A recipe edited without recalibrating fails the render test. The targets themselves are ours: Section 14.3 gives an order of importance, not numbers.
128. **Every sound must survive a phone speaker, and the engines were raised to do it.** The render test requires at least a fifth of each sound's energy (-7 dB) between 300 Hz and 8 kHz, and the same of each engine at speed. The first designs failed it for 30 recipes and 11 engines. Thuds were given a noise or pulse layer above their sine, and the piston engines were re-pitched about a third of an octave up (the V8 now idles at a firing frequency of 44 Hz and reaches 168) with weaker sub-octaves and brighter filters. Section 14.3 says the heavy V8 "roars low"; it is still the lowest of the vees, but it is higher than a recording of one would be. `impact_heavy`, a sub drop that only plays under another sound, is exempt.
129. **Seven buses, four sliders, and where the warnings sit.** Buses: engine, weapons, impacts, ambience, alerts, interface, music, into a compressor and a soft clipper that cannot pass -1.7 dBFS. Engine follows the Engine slider; weapons, impacts, ambience and alerts follow Effects; interface and music have their own (Section 5.13). Lock, missile, heat and damage warnings are on the alerts bus under Effects, not Interface, so turning the interface down cannot hide a missile. Countdown beeps, lap chimes and the win and lose stingers are on the interface bus: a change, because the Milestone A beep followed the Effects slider. Tire noise follows Effects.
130. **Voice caps, priorities and what a burst may do.** At most 20 effect voices at once and 16 music voices, with a cap per bus; a voice is at most five layers of at most eight nodes. A full bus or pool gives up its weakest voice (lowest priority, then oldest) with a 12 ms fade; a newcomer weaker than everything is dropped; priority 100 (the two warning loops, the knockout) is never stolen. Section 14.3's "wall of noise" is prevented three ways: a least interval per recipe and per source (a machine-gun round 60 ms), a shared allowance for small impacts (four at once, then twelve a second), and one sound for a spread of pellets. The numbers are in `mixMath.ts` (`CAPS`) and are asserted against a six-second stress mix.
131. **Event sounds are placed by tick, not by arrival.** Events of several ticks can arrive together: a slow frame steps the offline race several times, and a network message can carry more than one tick. Played on arrival, a five-round burst became two or three cracks (found by the browser test, which runs at 10 to 30 frames a second). Each event is scheduled at its own tick on a clock re-anchored to now whenever it would be late or more than a quarter second early. On time, that is now; in a batch, the rounds keep their 100 ms spacing at the cost of up to that much delay.
132. **Loops are reconciled against every snapshot.** A loop (a status, a travelling projectile, the lock warning, fire on the road) starts on its event and stops on its ending event, but also stops when the snapshot has not shown its subject for three snapshots, and when a time limit passes; and a status or warning the snapshot shows with no loop playing gets one. So a reconnect, a tab that was hidden, or a missed event cannot leave a sound stuck on or missing. `raceFeed.reset()` stops everything and frees the engine graphs.
133. **Statuses with no stated source: grip, and immunity.** Oil and frost both apply `grip`, and the `status` event names a family, not a weapon. Which loop plays (`oil_slip` or `frost_crackle`) is decided from the frost and oil hazards near the car, and a frost shell seen in the air just before. It can be wrong where the two overlap. `immune` is silent on purpose: it starts in the same tick as the disable that grants it.
134. **Music: one theme, and the final lap stands in for the last 30 seconds.** Section 14.3 requires track themes with adaptive layers, so there is music: "Neon Cut", original, A minor at 128 BPM, sequenced in code on the audio clock. It begins at GO, changes to a 140 BPM arrangement on the final lap or when the finishing window opens, and stops for the result stinger. The spec's layer for "the last 30 seconds" is not done because the client is not told the time limit. The music bus is trimmed to sit well under the engines and its slider defaults to half. Seven more themes are owed with the seven more tracks.
135. **Audio preferences live beside the settings store for now.** Section 5.13 asks for Music, Engine, Effects and UI sliders; the store has Engine, Effects and Mute, and belongs to the HUD track. `game/audio/settings.ts` holds `musicVolume` (0.5), `uiVolume` (0.8), `musicEnabled`, `haptics` (off) and `reducedIntensity` (off), persisted on `bolt.audio.v1`, behind `getAudioPrefs`, `setAudioPrefs` and `onAudioPrefs`. The audio reads Engine, Effects and Mute from the store. Reduced intensity lowers explosions, big shots and impacts by 4.4 dB, softens the EMP stutter of the engine and halves vibration; it is not in the spec's list by that name and is offered as the audio half of Section 16's "controllable" effects.
136. **Haptics are off by default and never required.** Section 14.4. `haptics.ts` calls `navigator.vibrate` only when it exists and the player has turned haptics on, never before a touch, at most once every 70 ms, and only for the player's own events and explosions within 140 px. iOS Safari has no vibration and gets none.
137. **Call sites the other tracks should add.** None of these were added, because the files are not the audio track's. All are one line, imported from `game/audio/index.js`, and safe before the first gesture. Garage (`garage/garageStore.ts` or the components that call it): `uiSound('install', partId)` after a successful `install`, `uiSound('remove')`, `uiSound('rotate')`, `uiSound('illegal')` when a placement or a facing is refused, `uiSound('select')` on choosing a slot or a part card, `uiSound('save')` on saving a blueprint. Build clock (`pages/GarageScreen.tsx`): `uiSound('timer_tick')` once a second from ten seconds left, `uiSound('timer_urgent')` for the last three, `uiSound('timer_end')` at the lock, and `uiSound('ready')` on the Ready button. Buttons (`hud/HudButton.tsx`, `components/Dialog.tsx`, page buttons): `uiSound('tap')` on press, `uiSound('confirm')` and `uiSound('back')` on dialog answers, `uiSound('open')` and `uiSound('close')` for overlays, `uiSound('deny')` for a disabled control, `uiSound('error')` on a load or connection error screen. Settings (`hud/SettingsPanel.tsx`): `uiSound('toggle_on' | 'toggle_off')`, `uiSound('slider')`, and four new controls bound to `getAudioPrefs()` and `setAudioPrefs()`: a Music slider (`musicVolume`), a UI slider (`uiVolume`), a Haptics switch (`haptics`, shown only if `hapticsSupported()`), and Reduced Intensity (`reducedIntensity`). Fire buttons need nothing: refusals already answer through the `refused` event.
138. **The debug hook, the render harness, and what is in the bundle.** With `?debug=1` the audio module puts `window.__boltAudio` on the page: the context state, live node counts by owner, a log of every voice started, stopped, stolen, dropped or rate-limited, and `harness()`, which loads the offline render code as its own 5 kB chunk. A normal page load never fetches it. The harness simulates a scenario in the page tick by tick, stops an `OfflineAudioContext` at each tick and feeds the audio system as `raceFeed` would. Node counts are the audio system's own ledger of nodes it created and disconnected, not a browser measurement.
139. **Nobody has listened.** The audio was written and reviewed where nothing can be heard. What is known is measured: peaks, DC, clicks at note edges, loudness windows, lengths, silence after release, energy above 300 Hz, node counts back to baseline, polyphony inside the caps, and a spectral fingerprint that puts the two closest of the twenty weapons at a distance of 1.7 where 1 is plainly different on one axis. What is not known is everything that matters to a listener: whether the engines read as engines, whether the loops tire, whether the mix pumps, whether the music is good, how any of it sounds on a phone, and whether iOS Safari unlocks as documented. A human listening pass is a launch blocker, and `docs/AUDIO_GUIDE.md` says where it should start.


## Combat rendering: Milestone C part 2, track V (October 11, 2026)

140. **The combat picture is a pure stage and a thin Phaser view.** `game/combat/stage.ts` turns snapshots and events into car states, pooled sprites and pixel primitives and imports nothing from Phaser; `CombatView.ts` only uploads them (one Blitter per atlas layer, one Graphics for pixel particles and beams, `CarView` for the cars). The stage therefore runs in Node: the unit tests play all 33 scenarios through it, and `tests/visual/stageRender.ts` draws its output in software for review. `CombatDebugView.ts` is deleted. `docs/COMBAT_API.md` still names it and belongs to the simulation track.
141. **Everything remote is drawn one tick behind, and events wait for that clock.** Offline the rendered tick is the latest tick minus one plus the frame's alpha, the same interpolation the own car uses; online it is the estimated server tick minus one snapshot interval and a half. Events are queued (512) and dispatched when the rendered tick reaches their tick, so a muzzle flash, its projectile and its impact appear in order on the cars as drawn, not as last received. The feed to the HUD and the audio is untouched: `raceFeed` still gets every snapshot and every event exactly once, on arrival.
142. **A hit is drawn on the car, not at a world point.** The `hit` event's point is converted to the victim's chassis frame with the authoritative pose of that tick (a short pose history per car) and replayed on the car as rendered, so sparks stay on the panel that was hit when the two timelines differ by a tick or the car is being smoothed.
143. **One effects atlas, eight layers, no rotation or scaling at run time.** `vfx_combat` is one indexed PNG (1024 x 1610, 101 strips, 990 frames, about 66 kB) with a typed manifest (`VfxAtlasManifest` in `packages/shared/src/assets.ts`). Directional effects are baked at 16 headings (the saw slash at 8), so a sprite is never rotated or scaled and pixels stay whole. Layers are decal, glow, ground, smoke, body, fire, flash and mark; glow and flash are additive, and each layer is one Blitter and so one batch. `mark` exists because status icons and lock markers baked on `flash` were being added to the road instead of drawn over it.
144. **Fixed caps, and two kinds of sprite.** `EffectPool` is struct-of-arrays over typed arrays with a capacity per layer (96, 40, 640, 192, 352, 608, 256, 48: 2,232 sprites) and a smaller decorative cap inside each. Decorative sprites (smoke, debris, embers) recycle the oldest when full and are not spawned off screen; pinned sprites (projectiles, hazards, status marks) are never dropped. `PixelFx` adds 448 pixel particles and 64 shapes. Nothing is allocated per frame after warm-up. The caps are asserted by `tests/unit/vfx.test.ts` and by the stress scenario (`?debug=1&vfxStress=1`).
145. **Two quality tiers, chosen by a governor.** `vfx/quality.ts`: `auto` drops to `low` after half a second of frames slower than 21 ms and returns after five seconds faster than 17.5 ms. Low halves every decorative count and decorative cap and keeps every gameplay signal (projectiles, hazards, status marks and telegraphs are pinned and unaffected). `setVfxQuality('auto' | 'high' | 'low')` and `vfxQuality()` are exported for a settings control; none was added because the settings panel is the HUD track's. `?vfx=high|low|auto` forces it for tests.
146. **Shake, flashes and hit-stop.** Camera shake is an impulse of 1 px for a hit that involves the player, 2 px for a rocket, a mine or a wreck and 3 px for the mortar, for about a tenth of a second; the camera clamps it at 3 px and scales it by the Screen Shake setting (zero is zero). Explosions do not yet fall off with distance from the camera, which only matters once a race has more than two cars. Reduce Flashes replaces each full-screen-bright flash frame by its baked outline (`fallback` in the manifest), and halves additive glow and the mortar's particle counts. There is no scene-wide hit-stop: the race is server authoritative and shared, and Section 13.6 asks only for readable feedback. The hit car's part flashes white for one or two frames and the weapon recoils instead.
147. **Damage is baked from the body sheets.** `vfx_damage/<chassis>_damage.png` holds three blocks of 64 headings per chassis (scuffed, battered, frosted), made by the baker from the committed body sheets so marks follow the silhouette at every heading. 46 to 69 kB each, about 291 kB for all five; a race loads two. Smoke, sparks and fire come from the component that is actually damaged (Section 8.5), a destroyed wheel is hidden and the car lists, and the spare wheel drops in with a mint burst when `module_used` reports it.
148. **Hazards are invisible until the snapshot says they are revealed.** A mine or an oil patch the simulation has not revealed to this player is not drawn at all, including its placement puff; the enemy's rear dropper still animates, since that is visible on the car.
149. **What the client derives because the events do not say.** (a) `projectile_ended` and `hit` carry no weapon id for some paths, so the stage remembers projectile id to weapon from `shot` and the snapshot. (b) The `grip` and `slow` statuses name a family, not a source: oil, frost and foam are told apart by the nearest hazard and a recent frost shell. (c) Burn and frost ticks have no hit point: they are drawn at the car's centre with a small random offset. (d) The harpoon's hook point is not sent: the line is drawn to the side of the victim's hull that faces the thrower. (e) The boomerang's turn is inferred from its velocity reversing. (f) A seeker that expires in the air reports radius 0: a small pop is drawn. None of these needed a change to the simulation.
150. **The debug hook and the manual clock.** `?debug=1` exposes `window.__boltRace` (tick, stats, focus, `setQuality`); adding `manual=1` stops the frame loop so a test can `advance` or `run` an exact number of frames. `tests/visual/combat.ts` uses it to take bursts of consecutive frames around each event on a slow software renderer. Neither is reachable without `debug=1`.
151. **Rain is not faked.** The `wet_road` scenario plays on the clear-weather track bake; the road shows no rain or puddles because the track art has none yet. The lower grip is real and the tire spray is drawn. Weather art is owed with the remaining tracks.
152. **Frame rate is not verified on a phone.** Measured here, on two shared cores with no GPU and other work running: the stage itself costs 1.5 ms mean and 4.6 ms at the 95th percentile in the stress scenario (455 sprites, 147 pixel particles, about 1,070 rectangles at peak); the browser, rendering in software, took about 32 ms a frame at high quality and 21 ms at low in the same scenario. These are evidence that the caps hold and the governor works, not evidence of 60 FPS on a device. A test on real phones is a launch blocker for Section 19.5.
153. **Known weak effects.** The mortar column, the boomerang in flight, the saw's teeth at small sizes, the charge lights of the EMP and the rail gun, and the tesla arc at short range are the least convincing of the set. `docs/VFX_GUIDE.md` lists them with what would fix each.

## The race HUD, results and two garage additions: Milestone C part 2, track H (October 11, 2026)

Screenshots of every state named here are in `tests/visual/out/hud` (`npx tsx tests/visual/hud.ts`).
The rules behind them are pure functions in `apps/web/src/hud` (`model.ts`, `results.ts`,
`callouts.ts`, `hudCamera.ts`) and `apps/web/src/garage/coverage.ts`, with unit tests.

154. **The HUD is two columns that hug the sides; nothing is ever at the top or bottom middle.** The owner saw the clock sit on the car when driving down the screen. With the fixed north-up camera (entry 34) the car is not at one anchor: it wanders up to 12 percent of the width and 27 percent of the height from the middle, toward wherever it came from. So no fixed place in the middle band is safe, top centre least of all. Every persistent panel is in a column no wider than `38vw - 118px` less the safe-area inset (clamped 131 to 182 px, 228 px on a desktop): a 220 x 150 px box around the car cannot touch it from anywhere on that ellipse. This is asserted geometrically (`carCanReach`, unit and end to end at 870 x 370, 870 x 340, 844 x 390, 667 x 375 and 932 x 430, both hands), not only at the place the car happens to be. Section 5.9's wireframe (you top left, time top centre, rival top right) is superseded where it puts the clock. _Steering side, top down:_ the race panel (place and steadied gap; lap and clock; best lap, and last lap from 200 px of column), the car's condition (diagram, hull, heat, power, statuses), then one lane for the warning, at most two callouts and the first-drive hint. None of it takes a press: `pointer-events` is off, so the steering thumb may land on any of it and the floating stick still appears under it. _Action side, top down:_ the route ribbon with the menu button and speed beside it, the rival's hull, the next bend, and at the bottom the pips of automatic parts and the buttons: equipment in a column of 48 px buttons, then the secondary (64 px) above the primary (72 px) against the edge. _Transient, top centre:_ only the start countdown, `GO!` and `FINISH`, which appear while the car stands on the grid or the race is over. Wrong way is in the warning lane.
155. **`Driving Hand` swaps the two columns whole.** Sections 5.15 and 7.1 say only the action stack and its details mirror. With the condition widget and the race panel on the steering side, mirroring the action stack alone would put four panels and the buttons in one column, which does not fit 340 px of height. The world and the steering are not mirrored. `Driving Hand` is the Section 16 left-handed setting; it already existed and moved nothing but the speed readout.
156. **Fire buttons act on the press and hold (`FireButton`), menu buttons on the release (`HudButton`, entry 17).** A fire button captures its own pointer, sets its bit in the input sample on `pointerdown` and clears it on `pointerup`, `pointercancel` or lost capture, so the simulation's own rule applies unchanged: a press is a rising edge, and a held button fires again each time the weapon is ready (`stepWeapon`). A finger that slides off a held button still holds it. Every press is also held for at least two ticks (`MIN_PRESS_TICKS`), on screen and on the keyboard, so a tap shorter than a simulation tick, or one that falls between two frames of a struggling device, still reaches the server as a press. A hidden tab or a lost window releases every button. Verified with three and four simultaneous CDP touches (steer, hold primary, tap secondary, tap equipment).
157. **What a button shows.** A dark clock wipe over the whole face with a bright hand for the wait (from `readyTick` and `cooldownTicks`), a striped fill rising from the bottom for a charge-up or a repair (from the `windup` and `utility` events), the count left in the corner the thumb does not cover, a lock light, and the keyboard shortcut on devices with a fine pointer. A wait is a phase and never a block, because it ends by itself. A block is something the driver must do something about, and each has a word, a glyph of its own and a hatch of its own, so none is told by color: `Empty`, `Too hot`, `No power`, `Broken`, `EMP`, `Jammed`, `In the air`, `No target`. They are decided in the simulation's order of refusals (`actionView` mirrors `tryFire` and `activate`); a unit test replays all 33 scenarios and requires that every refusal the simulation issued was already shown on the button one tick earlier. A press that does nothing flashes the button's frame and, except for a plain cooldown, shows the server's reason from the `refused` event above it.
158. **Two kinds of HUD state, so a snapshot never re-renders the HUD.** `useCombat` (Zustand) holds what changes rarely (a part's tier, a button's phase and block, the statuses, the shown gap) and replaces a field only when its value changes. `hudLive` holds the newest snapshot and what is in progress. Dials, gauges, status rings and edge markers read `hudLive` inside one shared `requestAnimationFrame` loop (`onHudFrame`) and write their own DOM node (a CSS variable or a transform). The race tick between two 15 Hz snapshots is estimated from the snapshot's arrival time and never runs more than four ticks ahead, so a stalled race holds still, and it is frozen with a paused single-player race.
159. **The HUD runs its own copy of the camera.** The feed carries no camera and the HUD may not reach into the scene. `HudCamera` runs a second `FollowCamera` (imported, not modified) with the same view scale from the same canvas size, fed with the snapshot pose moved forward on its own velocity. It differs from the picture by the prediction lead and the decaying correction offset, a few pixels, which an edge arrow does not notice. The off-screen rival arrow (Section 7.5: `Ahead 85m`, `Behind 32m`, the distance stepped in fives past 30 m) and the threat marker are clamped to the rectangle between the two columns, 18 px inside the screen. The rival's arrow is shown only while the server reports `rivalTracked`, which is also when the route ribbon may show it. A threat that comes from where the rival is uses the rival's marker, restyled, instead of a second one on top of it.
160. **Warnings have a lane of their own and are never switched off; callouts are news and can be.** One warning at a time, most urgent first: a missile in the air (`INCOMING`, with a bar that empties to the impact tick from the `warning` event), a lock (`MISSILE LOCK`, the approved line), a trap the Mine Detector reported (`TRAP AHEAD`), wrong way, and the clock that starts when the first car finishes. Each has a glyph of its own and hazard stripes; the first three carry an arrow that points at the thing. Callouts: at most two, 1.9 s each, at least 0.35 s apart, the same news not repeated within 3 s, a more important one taking the place of a lesser; each is also written to a polite live region. `Race Callouts` in settings turns them off.
161. **Copy added for callouts.** Section 18.1 has `WHEEL HIT`, `ENGINE HOT`, `LOW POWER`, `WHEEL REPLACED`, `MISSILE LOCK`, `GO!`, `VICTORY` and `DEFEAT`, used exactly, and Section 13.6 names `ENGINE HIT`. Added in the same voice: `INCOMING`, `TRAP AHEAD`, `RIVAL FINISHED`, `DIRECT HIT`, `PART LOST`, `DESTROYED`, `REPAIRED`, `HULL CRITICAL`, `OUT OF AMMO`, `SYSTEMS DOWN`, `WEAPONS JAMMED`, `ON FIRE`, `SHIELD DOWN`, `MISFIRE`, `KNOCKED OUT`, `LAP 2`, `FINAL LAP` (already in the game), `LEAD TAKEN`, `LEAD LOST`, `FINISH`, `DRAW`. Small hits get no words: the part flashes on the diagram instead.
162. **The car diagram.** A nose-up schematic drawn from the chassis' own geometry: the body outline, each wheel in its arch, the engine in its bay, the steering rack, and every mounted part at its real place and size. Condition changes the drawing and the color together (Section 16): whole is a solid block, damaged is striped, critical is cross-hatched and blinks, destroyed is an empty dashed frame with a cross through it. A hit flashes the part it landed on (from the `hit` event's component), a repair draws a ring that closes on the part. Armor is a bar along each side that shortens in quarters; the snapshot has no armor ceiling, so the most seen on an arc is taken as its full strength (a car starts whole). The chassis bar borrows the Section 8.1 proportions (65 and 20 percent). The diagram's accessible name lists only what is not whole.
163. **Statuses, and two the HUD derives.** Icons with a ring that empties clockwise, harmful ones with cut corners in the warning color, ordered worst first. A status's length is not in the snapshot, only its end, so the remaining time first seen is the ring's full length and a later end starts it again. `shield` is shown while a shield part's pool is above zero. `tether` is shown from the `tether` event for two seconds, which is the catalog's line time; the event does not carry it.
164. **Low power is the HUD's reading, because the snapshot has no flag for it.** `telemetry.lowPower` is not in the snapshot. The gauge and `LOW POWER` come on when the battery is under a fifth of its capacity or holds less than a weapon on a fire button costs.
165. **The gap readout is steadied.** `gapSeconds` is distance over the chasing car's speed and twitches with every lift. `GapSmoother` eases it with a 0.45 s time constant and moves the shown tenth only when the eased value is 0.035 s inside another one; a jump of more than 3 s is taken at once. A wobble of a quarter second around a value changes the readout at most four times in twenty seconds, and a real change of a second shows within a second and a half (unit tested).
166. **Results are the server's verdict and the event log's sums.** `VICTORY`, `DEFEAT` or `DRAW` and the line under it come from `RaceResult` only (`verdictFor`): the margin in seconds when both finished (`The match was decided by 0.4 seconds.`), a rival or a driver who did not finish, a knockout, the time limit. The table of the two cars is `RaceResult`. Damage by weapon, damage taken by part, the biggest hit, parts lost and repairs are added up from events by `RaceLog`, with the simulation's own two definitions (taken is `damage + chassis`; dealt also counts `shield + armor + absorbed`); a unit test checks the sums against `CombatCar.stats` in all 33 scenarios, and the end-to-end test of a whole race checks them against the server's result. Of the Section 18.2 lines, three can be supported and are used with real numbers: the margin, seconds above safe engine temperature (counted from snapshots), and tire hits by axle. `Your rear turret never had a clear shot` is used for an automatic weapon that never fired in a finished race and was still working. The others (the mine before the final corner, armor costing time, the shortcut) are not used: the telemetry cannot establish them.
167. **Finish, and when there is no result.** Crossing the line shows `FINISH` and a countdown of the eight-second window; the rival crossing first shows `RIVAL FINISHED` and the seconds left. The results screen opens when the `result` arrives. If it has not come twelve seconds after the local car finished, the screen opens with what the log has, marked as not decided. `Race Again`, `Change My Build` and `Back Home` are as before. `Save This Car` and `Share Blueprint` (Section 5.11) are not on this screen: sharing needs the server codes of Milestone E, and saving is in the garage.
168. **Pause.** A single-player race in the page stops while its menu is open, with the Section 5.10 safety limit: after 120 seconds it resumes by itself, and the menu counts that down. A race on the server keeps going and the menu says so, as before. Pausing the server's race against the sparring rival while the menu is open, which Section 5.10 asks for in AI mode, is not done: it needs the scene to stop sampling for an online link (`frozen` in `RaceScene`) and the room to wait for samples longer than its 267 ms allowance. Neither file is this track's.
169. **HUD occupancy.** Section 5.9 asks for about 18 percent. Measured as the summed boxes of every panel and button with the fully armed test car: 18.9 percent at 870 x 370, 18.7 at 870 x 340, 18.5 at 844 x 390, 15.2 at 932 x 430, and 21.3 at 667 x 375, where a quarter less screen carries the same two fire buttons, two equipment buttons and the condition widget. Under 360 px of height the best-lap line is dropped (each lap's time is still called out as it ends) and the route ribbon is 84 px wide.
170. **Settings added:** `Race Callouts`, `Button Size` (`Standard`, `Larger Buttons`: 84, 72 and 52 px), and `Effects Quality` (`Auto`, `High`, `Low`), which hands the choice to the effects' own `setVfxQuality` and stores it with the other settings. For the audio track's entry 135 and 137: `Music` and `Interface` sliders, `Softer Impacts` (their `reducedIntensity`) and `Vibration` where the device has it, bound to their preferences module; interface sounds on menu buttons, toggles, sliders and choices; and in the garage a sound for an install (by part), a removal, a turn, a refusal, a selection, Ready, and the last ten seconds of the clock, decided from the session before and after (`garage/garageSounds.ts`) so a tap, a drag, a key and an undo are all heard the same way. Not wired: sounds for dialogs opening and closing, saving a blueprint, and error screens.
171. **Debug hooks, only with `?debug=1`.** `window.__boltDebug.hud` (the events the HUD has been given, the results summary, `showResults()`, the HUD's reading of the car's place on screen, the car's parts and components by index, `event()` to push an event through the HUD's own handler, and `override()`, which lays changes over each incoming snapshot before the HUD reads it) and `window.__boltDebug.input` (the fire and utility bits of the samples taken, and which were seen while a finger was steering). The override exists for screenshots and for the three states no scripted scenario reaches on the local car: thermal protection, a lock or a missile on the local car, and a rival placed off screen. It changes what a snapshot says, never what the HUD concludes. The old `DEBUG` fire buttons are gone; the two debug text lines remain, with `?debug=1` only.
172. **Not done on the HUD.** Choosing a repair target on the diagram (Section 8.2): the input sample has `target` and `DriveInput` now offers it, but `RaceScene` writes 0 into every sample, so the control would do nothing. The rival's components are not drawn, only its hull: its component integrity is in the snapshot, but the brief asked for a bar. No Section 5.11 podium animation or side-by-side car composition on the results screen. No portrait-specific HUD: the two columns are kept, narrower.
173. **A weapon's coverage on the workbench floor (approved addition).** With a weapon selected, the floor under the car shows what it covers: a wedge of its real arc and facing from its muzzle (85 degrees for the Front Machine Gun), a circle for what aims all round (Swivel Turret, EMP Pulse, Tesla Arc), a ring with its minimum range cut out for the Arc Mortar, a hatched drop zone behind the hatch with the ring that sets it off for the Road Mine and a strip for the Oil Slick, a path and a puddle for the Sticky Foam, a short sweep off the flank for the Side Saw. The shapes come from `compileModules`, which is what the race runs a weapon on, so the arc, range, minimum range, muzzle and drop distance are the simulation's, including any change a mount makes to an arc; nothing in `garage/coverage.ts` knows a weapon by name, and its cases follow the simulation's `release` one for one. It follows a change of facing, a nudge, a drag and a turn of the view as they happen. _Scaled range._ Weapons reach 14 to 350 px and a car is under 50 long. The first 16 px from the weapon are drawn true and the rest at 12 percent, so what is next to the car (a saw's reach) is its real size and longer weapons still look longer, in order. Angles are never changed. Drop zones are drawn at their real size where they really fall. _Fitted to the floor._ In focus the car is drawn four or five times its size and fills the floor, so a shape that would leave the floor between the tile columns is shrunk about the weapon until its far edge is on it, never below 10 sprite pixels. In focus, therefore, the drawing shows arc and facing reliably and range only roughly; this is the main weakness of the feature, and showing coverage in the overview as well would be the remedy. _At the mount's height, not on the ground._ The brief says on the floor under the car. Drawn at wheel height the shape starts below the muzzle it comes from (the camera is tilted and a roof mount is nine sprite pixels up), which in focus put the apex of a downward-facing cone off the floor. It is drawn at the height of the weapon's mount, under the car, and repeated faintly over the dimmed bodywork so it can be seen where the car covers it. _The gold arrow_ (entry 101) is no longer painted for a weapon; it remains for directional parts that are not weapons (plates, bumpers) and stays in the page for the tests of facing.
174. **The car steps back in focus (approved addition).** With a slot open in focus mode, everything but the selected part is drawn 40 percent darker: `drawCar` draws the car exactly as before, lays a flat wash of the interface's darkest navy over the pixels just drawn (`source-atop`, so nothing outside the car is touched and nothing is blurred), and draws the kept part and its outline once more on top. It is one option of the one shared drawing path, used only by the workbench. The engine slot keeps the engine bright; an empty mount dims the whole car under its dashed socket; a red or green outline (a refusal, a replacement preview) dims nothing. It fades over 140 ms and is instant under Reduced Motion.
175. **`Race Again` in a race on the server did nothing; fixed in the client link.** `onlineLink.resetCar` sent `RESET_CAR` with an empty object, and the room treats any payload on that message as malformed, counts a strike and ignores it. The integration test sends it bare, so nothing caught it; the end-to-end test of a whole race did, when the results screen's `Race Again` left the old race running. The client now sends the message bare. This is one line in `apps/web/src/network/onlineLink.ts`, outside the HUD's own files, made because the results screen cannot work without it.
