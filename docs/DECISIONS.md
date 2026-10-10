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

## Rendering

1. **Device-resolution canvas with whole-number world scale.** The specification asks for a
   640 x 360 logical framebuffer with integer scaling and also for a smoothly rotating camera.
   Rotating inside a 640 x 360 buffer makes every texel crawl. The canvas is therefore sized
   in device pixels and the world is scaled by a whole number at camera zoom 1.0, chosen so
   the view is 300 to 420 world pixels tall. Texels stay hard-edged squares that rotate
   smoothly. Wide phones see more to the sides; look-ahead (vertical) varies far less.
   Revisit if hardware testing shows shimmer or if view-size differences prove unfair.
2. **Cars are drawn upright in view space from sixteen authored frames**, never rotated as
   bitmaps. The frame is chosen from the car heading relative to the camera, and the sprite is
   snapped to device pixels. Three camera passes keep ordering correct: ground and effects,
   cars, then foreground overlays.
3. **Square 96 x 96 heading cells.** Section 12.4 names 64 x 96 cells. A 58-pixel body turned
   45 degrees is wider than 64, and the largest bodies approach 94 on the diagonal. The 64 x 96
   frame remains the heading-0 authoring cell (`art/source/cars`); directional sheets use 96.
4. **Camera zoom is whole-number only at speed.** Zoom eases from 1.25 when slow to 1.0 when
   fast, so the crispest scale is the one seen most of the time.
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
18. **North-up steering.** With Reduced Camera Motion the camera stops rotating and the stick
    points where the car should go on screen, which is the consistent screen-relative mapping
    Section 7.1 asks for.
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
