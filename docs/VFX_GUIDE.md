# VFX guide (Milestone C part 2)

How combat is drawn: what each weapon and event looks like, how the effects atlas is made, how
the pools and the timeline work, what the limits are, and how to review a change. Section 13 of
the specification is the requirement; `docs/COMBAT_API.md` is the data this draws from; this
file is the working practice. Nothing here feeds gameplay: the simulation never reads it.

## Where things are

| File | What it holds |
| :-- | :-- |
| `art/scripts/vfx/kit.ts` | Ramps, noise, the `cloud` routine behind every burst and puddle, the directional sprite builder |
| `art/scripts/vfx/explosions.ts`, `weapons.ts`, `hazards.ts`, `status.ts` | The strips: 101 animations, 990 frames |
| `art/scripts/vfx/damage.ts` | Damage and frost overlays, drawn from the baked body sheets |
| `art/scripts/vfx/pack.ts`, `art/scripts/bake-vfx.ts` | Atlas packer and bake entry (also run by `pnpm art` and `pnpm art:check`) |
| `apps/web/src/game/vfx/atlas.ts` | The atlas manifest as flat arrays |
| `apps/web/src/game/vfx/EffectPool.ts` | Pooled sprites: fixed capacity, struct of arrays, no Phaser |
| `apps/web/src/game/vfx/PixelFx.ts` | Pixel particles and procedural shapes (beams, bolts, rings, reticles, ropes) |
| `apps/web/src/game/vfx/recipes.ts` | The effect library: every blast as layers |
| `apps/web/src/game/vfx/quality.ts` | The quality tier and its governor |
| `apps/web/src/game/combat/stage.ts` | `CombatStage`: timeline, cars, projectiles, hazards, one handler per event type |
| `apps/web/src/game/combat/weaponFx.ts` | One identity per weapon |
| `apps/web/src/game/combat/rig.ts` | Where a car's components are, and its visual state |
| `apps/web/src/game/combat/CombatView.ts` | The only Phaser in the combat presentation: Blitters, Graphics, the two cars |
| `apps/web/src/game/combat/stress.ts` | The Section 19.5 stress scenario |
| `apps/web/src/game/composition/CarView.ts` | The car compositor's race side: damage, statuses, part animation |

Everything except `CombatView` and `CarView` runs without a browser. The unit tests and the
review renderer drive `CombatStage` directly with real scenario timelines.

## How a frame is put together

1. The link delivers a race snapshot and the tick's events. `CombatStage.onRace` records the
   cars' authoritative poses and what is in flight and on the road; `onEvent` queues the event.
2. `CombatStage.frame` advances the render clock, places the rival, plays every queued event
   whose tick the clock has reached, runs each car's state machine, moves projectiles and
   hazards, and updates the pools.
3. `CombatView.sync` copies the pools onto Blitter sprites, redraws the two Graphics objects
   and applies each car's pose and state through `CarView`.

**One moment for everything remote.** The rival, projectiles, hazards and all effects are drawn
at `renderTick`: exactly one tick behind the newest snapshot when the race runs in the page (in
step with the local car's own interpolation), about one snapshot interval behind on a server.
An event waits in the queue until that clock reaches its tick, so an explosion plays when the
rocket that is drawn arrives. Events are never dropped: a full queue (512) plays its oldest at
once. Each is shown exactly once; a restart clears everything.

**A hit lands on the car.** An event gives a world position at its own tick. `atCar` turns it
into a point on the car with the car's authoritative pose at that tick and draws it on the car
where the car is drawn now. The hot centre of an impact (flash, core) rides the car; what it
throws (sparks, debris, smoke) is released into the world with part of the car's velocity.

**The pixel grid.** Sprites are placed on the device pixel grid, like the ground and the cars.
Nothing in the atlas is rotated or scaled at run time: a sprite that points somewhere is baked
per heading (16 for most, 8 for the slash), and a lobbed shell changes size by changing frame.
Procedural shapes are axis-aligned rectangles on whole world pixels.

## Layers

One Blitter per layer, so order inside a blast never depends on creation order, and the whole
effects system is one texture.

| Layer | Depth | Blend | Holds | Capacity | Decorative cap |
| :-- | --: | :-- | :-- | --: | --: |
| `decal` | 11 | normal | Scorch marks | 96 | 96 |
| `ground` | 14 | normal | Hazard blobs, mines, dust, shadows of things in the air | 640 | 128 |
| ground shapes | 15 | normal | Reticles, landing markers, mine and fire outlines, shock rings | 64 shapes shared | |
| `glow` | 16 | add | Light on the road | 40 | 32 |
| driving effects | 12 to 36 | | Milestone A: skids, tire smoke, exhaust, wall sparks | 220 + 420 | |
| car shadows | 40 | normal | One image a car | | |
| cars | 50, 51 | normal | The car lower on screen is drawn over the other; 57 while a heavy blast would hide it | | |
| `smoke` | 54 | normal | Blast smoke, steam, vapour | 192 | 160 |
| `body` | 55 | normal | Projectiles, debris, casings, splats | 352 | 224 |
| `fire` | 56 | normal | Fireballs, flames, road fire, lobbed shells | 608 | 128 |
| air shapes | 58 | normal | Beams, bolts, sparks, brackets, ropes, charge lights, the shield | 448 pixels | |
| `flash` | 59 | add | Flashes, tracers, muzzle flashes, jets, shield fragments | 256 | 192 |
| `mark` | 60 | normal | Icons and markers with dark outlines | 48 | 32 |

Capacity is the number of sprites created up front; nothing is created while racing.
**Decorative** sprites (`spawn`) have a lifetime; when their share of a layer is used the oldest
is recycled, and one that would start outside the view is not created. **Pinned** sprites
(`pin`) belong to a projectile, a hazard or a marker and live until released: they are never
recycled, culled or dropped. Capacities leave room for every pinned sprite the simulation can
ask for (64 projectiles; 48 hazards of at most 10 blobs each on `ground` or `fire`).

Other fixed stores: 448 pixel particles (the oldest is overwritten), 64 shapes, 96 projectile
views, 64 hazard views, 8 locks, 8 streams, 512 queued events.

## Quality tiers

`vfx/quality.ts`. `high` is the default. `low` halves every decorative count (`scaled`) and
every decorative cap, and the pixel-particle store. Pinned sprites, telegraphs, warnings, lock
brackets and hazard outlines are the same at both tiers: nothing that carries gameplay is ever
reduced (Section 19.5). In `auto` (the default) the governor watches a smoothed frame time:
half a second over 21 ms drops to `low`, five steady seconds under 17.5 ms goes back to `high`.
`setVfxQuality('auto' | 'high' | 'low')` and `vfxQuality()` are exported for a settings row;
`?debug=1&vfx=low` forces a tier for review.

Two existing settings are honoured:

- **Reduce Flashes** (on by default, Section 5.13): a large flash is replaced by its outline
  strip (`fallback` in the manifest), a small one is drawn at half strength, light on the road
  is halved, and the mortar's particle counts are halved (Section 13.3).
- **Camera Shake**: every impulse goes through `FollowCamera.kick`, which shares one budget,
  never exceeds 3 world pixels, and is scaled by the setting. Requested: 1 px for a light hit
  on or by the local car, 2 px for a heavy hit, a rocket, a seeker, a mine; 3 px for the mortar.

Near the local car, blast smoke is drawn at 30 percent instead of 78, and when several blasts
go off there inside a second, debris, sparks and ground light are halved until it clears
(Section 8.5).

## Weapon inventory (Section 13.4)

| Weapon | Wind-up and launch | In flight | Impact | What stays |
| :-- | :-- | :-- | :-- | :-- |
| Front Machine Gun | Small orange spike alternating between the two barrels, a brass case flicked to each side, one-pixel part kick | Long yellow-white tracer | Two-frame star, eight sparks back along the shot, steel chips, tight gray puff | Cases on the road for half a second |
| Rear Sentry | The drum swings onto its target while an amber dot blinks at the muzzle | Short amber tracer | Amber flecks thrown hard back the way the round came, no chips | A shower of cases behind the car |
| Swivel Turret | The whole head is drawn at its aim; a red dot on the target at lock; round red-orange flash, two-pixel barrel kick | Fat red bolt | Compact orange blast with a ring of round metal chips | |
| Road Shotgun | The huge three-frame fan of flame fingers, drawn once for the eight pellets; smoke puff, car nudged back | Eight short-trailed pellets | A separate spark and puff per pellet, no star | |
| Needle Railgun | Six cells climb the rails over the 0.8 s charge; the last goes white | Instant white line with a cyan fringe, then cyan dashes that thin out | Needle slash across the panel, two concentric square pulses, cyan sparks | Cyan flecks along the path |
| Straight Rocket | Back-blast to the rear of the tube, ring of smoke | Rocket with a tail flame on its own clock, intermittent smoke, embers | Rocket explosion (below) | Scorch, rolling shrapnel, smoke |
| Seeker Missile | Red corner brackets close on the target and stay; they blink white when the missile is half a second out | Slim missile, dotted red exhaust that keeps the curve, white smoke | Pink four-lobed bloom with one hard ring: tighter than the rocket | Small scorch |
| Road Mine | Hatch puff at the tail | (dropped) | Low thump: a bright lens at axle height for two frames, a dust skirt, pavement chunks | Mine blinks amber while arming, red when live, inside a dashed outline; scorch |
| Oil Slick | Dark drops slosh from the nozzle; no light | (laid) | Tire splash, then dark spray and gray skid streaks while the car slides | Blue-black strip with a lit rim and drifting sheen |
| Sticky Foam | Pale puff and pellets | Glob that grows toward the camera over its arc, with a shadow and trailing clumps; dotted landing marker | Elastic splat with strands | Bubbly puddle; bits peel off a slowed car's wheels |
| EMP Pulse | Four posts light in turn round the emitter | (none) | Three staggered cyan and violet rings to the pulse's true range, circuit fragments, bolts to the mounts it shut down | The struck car: dim, lamps out, arcs between its corners |
| Tesla Arc | (automatic) | Jagged violet bolt from each electrode, redrawn every 50 ms, with a fork | Violet fork star and sparks on the component | Sparks on the jammed car's parts |
| Flame Spitter | Red glow at the nozzle | A stuttering stream of fire puffs along the cone, dark flecks | A lick of flame on the panel, embers | The car burns where it was caught; lit oil becomes road fire with a marching outline |
| Frost Cannon | Mist rolls off the muzzle | Faceted crystal turning, cold wake | Spoked crystal shatter with a square facet, diamond shards | Frost overlay and blue tint on the car, shards off the arches when it ends; icy patch with glints |
| Crash Hammer | The arm rotates back over the wind-up, then through and home | (none) | Oversized four-point clang with a hard ring, sparks, chips | Three shock stripes along the knock |
| Side Saw | Teeth run in stepped highlights round the blade all the time | (none) | A third of a second of sparks streaming off the blade; a bright scratch along the panel | |
| Grapple Harpoon | Puff and sparks at the spool | Barbed dart on a braided rope from the muzzle | Catch flash and sparks at the hook | Rope between the cars that bows when they close and straightens when they pull; the end flies home on release |
| Air Cannon | Opening bell of pale pixels | Three broken arcs run out along the cone with pale puffs | Dust ring and the target bounces on its suspension | |
| Steel Boomerang | Sparks at the arm | Hooked blade in eight spin frames, glints; a ring and staggered ticks at the turn | White crescent slash along its path | Catch flash at the arm |
| Arc Mortar | Flash and a rising ring of smoke at the mouth, tube and car settle | Shell that grows and shrinks over its arc, shadow that does the opposite, smoke thread; segmented reticle whose ring is the countdown | Mortar explosion (below) | Crater scorch, two-stage smoke |

Also: ramming and bladed hubs (sparks and chips scaled by the blow), the Missile Interceptor
(mint flash, thin beam, a clean pop at the missile), the Mine Sweeper (amber bolt, controlled
pop, dust, small scorch), the Decoy Drone (launch puff, a hovering drone with its shadow, a
mint pop when it goes).

### The four major examples (Section 13.3)

| Example | Layers, in draw order | Length |
| :-- | :-- | :-- |
| Small kinetic impact | light on the road; tight puff; steel chips; eight sparks; two-frame star | 0.35 s |
| Rocket explosion | scorch; segmented shock ring; light; smoke blossoms (delayed); 13 shards and 4 glowing ones that bounce and come to rest; fireball (two shapes) and a second smaller burst; sparks, embers; flash | 0.8 s, smoke to 1.3 s |
| Heavy mortar explosion | crater; three nested broken rings, yellow to red; dust disc; light; smoke at the foot, then a column; chunks and shards on high arcs; the white-hot column; sparks; flash | 1.1 s, smoke to 1.9 s |
| EMP burst | light; three rings; circuit fragments; cyan and violet flecks; flash. No fire, smoke or shrapnel | 0.5 s |
| Repair burst | clamp; mint weld sparks; mint flash; one subsystem icon over the car | 0.5 s |

During a mortar blast a car within its radius is lifted over the smoke and fire layers for
0.45 s, so its silhouette is not lost in it.

## Events

Every event type has a handler in `EVENT_HANDLERS` (`stage.ts`); a test fails if one is added
to the protocol without one.

| Event | What is drawn |
| :-- | :-- |
| `checkpoint` | Two cyan ticks flick out beside the car |
| `lap`, `finish`, `result` | Gold sparkle over the car; a small hop on a finish |
| `wall` | Flash and sparks at the other car's nose (the local car's scrapes come from its own telemetry, as in Milestone A) |
| `position` | A chevron over the new leader for 0.8 s |
| `windup`, `shot`, `beam`, `area`, `telegraph`, `lock` | The weapon's own (table above) |
| `warning` | `missile`: the brackets on the local car turn white and blink. `trap`: a ring pulses out from the revealed hazard |
| `hit` | The weapon's contact; the struck component flashes for one or two frames; the car recoils 1 px (2 px and a bounce for a heavy hit); armor flecks if a plate took some; a shield ripple if the shield did |
| `explosion`, `impact` | The weapon's blast, or its fizzle against a wall |
| `status` | Applied and expired flourishes per family (below); `blocked` is a quick white ring |
| `impulse` | Recoil along the shove, a bounce; the hammer's shock stripes |
| `component` | A burst from the component that got worse: rubber and a tire rolling away, engine smoke and fire, sparks and shards from a part |
| `shield` | Energy Shield: fragments fly outward on `down`, a ring closes in on `up`. Breakaway Armor: the plate tears off and tumbles, the part disappears. Reactive Foam: the cell bursts |
| `hazard` | Placed, armed, cleared, ignited, melted and expired each have a moment; the hazard itself is drawn from snapshots |
| `tether` | The rope and its catch |
| `utility` | Repairs (clamp, then the burst; a spare wheel knocks the old tire off and drops the new one on), boosts, the decoy, the jump pad, the winch, the capacitor |
| `misfire` | Sparks and a gray cough at the muzzle |
| `refused` | One dull red blip on the part |
| `ko` | A last burst, falling parts, and a dark smoking wreck |

## The car (Sections 8.5 and 12.8)

The rival is the same `CarView` as the local car, with its own blueprint and paint, moved by
interpolation between snapshots. `CarState` (`rig.ts`) holds what the simulation last said and
the animation state; `CarView.apply` copies it onto sprites.

| State | How it reads |
| :-- | :-- |
| Engine damaged, critical, disabled | Low smoke from the engine; denser smoke and sparks; flames, and the engine sprite goes dark |
| Steering damaged | Amber sparks at the rack between the front wheels |
| Wheel damaged, critical | The wheel runs out of true by a pixel (faster when critical), rubber scraps, puffs |
| Wheel disabled | The wheel is gone from its hub; sparks trail from that corner |
| Mounted part damaged, critical, disabled | Sparks now and then; sparks and vapour; the sprite goes dark and smoulders |
| Chassis below 70, 40, 12 percent | `scuffed` overlay; `battered` overlay, darker paint, steady smoke; flames |
| Knocked out | Dark, lamps and headlight pool off, burning |
| Hit | The struck component goes white for one frame (two for a heavy hit); bare bodywork only for a heavy hit |
| Weapon fire | The part kicks back along its own facing and eases home; a turret is drawn at its aim; a hammer or sentry turns |
| EMP | Dim, lamps stutter, headlight pool off, bolts between corners |
| Jam | Violet sparks on the mounted parts |
| Frost | Blue tint, `frosted` overlay, ice flecks at the wheels |
| Burning | Flames, embers and smoke where the car was caught |
| Oil | Dark spray and skid streaks from the wheels |
| Foam | Clumps peeling off the wheels |
| Boost or nitro | Blue streaks beside the car, a bark of smoke and sparks at the exhausts |
| Refit | Mint weld sparks |
| Airborne | The car rises on an arc (13 px) and its shadow stays on the road, offset and lighter; dust on landing |
| Shield up | A segmented cyan outline round the car; the struck arc flashes white on a hit |

The overlays are baked per chassis from the body sheets (`vfx_damage`): three blocks of 64
headings. A mark is defined once in the car's own space and traced onto every heading, so a
scratch on the left front wing is on the left front wing whichever way the car points.

## The atlas

`apps/web/public/assets/atlases/vfx_combat/atlas.png` is 1024 x 1610, indexed, 66 kB, with
`manifest.json` (35 kB, 2.7 kB gzipped). The overlays in `vfx_damage` are 46 to 69 kB a
chassis; a race loads the two it needs. Two pixels of padding separate all frames.

A manifest entry (`VfxAnimManifest` in `packages/shared/src/assets.ts`) carries the frame grid,
`fps`, `loop`, the anchor, the `layer`, the `blend` mode, `directions` and a `fallback` strip
(Section 13.8). The bake is deterministic: `pnpm art:check` rebuilds it in memory and fails if
the files differ, and so does a unit test.

Art rules, on top of `docs/ART_GUIDE.md`:

- Pixels are opaque or clear. Only light on the road (`glow`), marks on the road (`decal`) and
  shadows use alpha, in fixed steps.
- Colors come from the ramps in `kit.ts`. The atlas has fewer than 256 colors and must stay
  indexed.
- Shapes are clusters: lobes that drift apart, an edge of coherent noise, hard bands of a ramp,
  erosion in two-pixel cells as they die. No scaled circle stands in for an explosion.
- Timing (Section 13.1): flashes 30 fps for three or four frames; fireballs 12 frames at 16 fps;
  the mortar column 14 at 14; smoke 10 at 10; loops 6 to 8 frames at 12.
- Dark smoke carries a light top and a dark rim so it reads on asphalt; oil carries a lit rim
  and sheen for the same reason.

## Adding an effect

1. Draw the strip in one of the `art/scripts/vfx/*.ts` files with `fx` (or `directional` for a
   sprite that points). Give it a layer; give a large additive flash a `fallback`.
2. `npx tsx art/scripts/bake-vfx.ts`, then look at it:
   `npx tsx art/scripts/vfx/montage.ts out.png 3 <id> ...` or the sheets in `art/preview/vfx`.
3. Add its name to `ANIMS` in `recipes.ts`. A strip the runtime never names fails a test; so
   does a name that is not in the atlas.
4. Use it from a recipe, a weapon's entry in `weaponFx.ts` or an event handler. Take positions
   from `atCar`, `atMuzzle`, `atLocal` or `atWorld`; seed the generator with the event id; use
   `pool.scaled` and `px.scaled` for anything decorative; never call `pin` for decoration.
5. Review it in motion (below), at both tiers and with Reduce Flashes on and off.

## Reviewing

- **Fast, no browser:** `npx tsx tests/visual/stageRender.ts out.png <scenario> <tick|auto>
  [frames] [every] [w] [h] [scale]` draws the real stage for a scenario with a plain software
  compositor (cars in key paint, no terrain). `FOCUS=0` or `1` centres one car. Seconds a run.
- **The real thing:** `npx tsx tests/visual/combat.ts <baseUrl> <outDir> [scenario ...]` plays
  each scenario in the production build at 870 x 390 on a manual clock and writes, for every
  key moment of its timeline, a sheet of eight consecutive frames 33 ms apart and a full-screen
  frame. `--flashes` turns Reduce Flashes off, `--quality=low` forces the low tier, `--video`
  records the major examples in real time, `--stress` runs the stress scenario.
- `?debug=1&manual=1` stops the race clock; `window.__boltRace.run(n)` advances n frames.
  `?debug=1&vfxStress=1` runs the stress scenario over any race. `window.__boltRace.stats()`
  reports live sprites, pixel particles, shapes, rectangles, peaks per layer and frame time.

Questions to ask of a capture: can the weapon be named from the effect alone; does the impact
say what was hit inside a quarter of a second; is the blast layered and uneven; does anything
hide the cars or the road for longer than a flash; is damage on the right corner; is every
pixel on the grid.

## Performance

Measured, and what the measurements are worth:

- The stage (everything except drawing) costs 0.1 to 0.2 ms a frame in the scenarios. In the
  stress scenario, in Node on a two-core machine that was running other test suites: 1.5 ms mean
  and 4.6 ms at the 95th percentile at `high` (455 sprites, 147 pixel particles and 1,072
  rectangles at the peak), 0.9 ms mean at `low` (281 sprites). A unit test holds the mean under
  6 ms and checks that 3,000 stress frames do not grow the heap.
- Draw calls for all combat effects: at most 8 sprite batches (one texture) and 2 Graphics
  objects, plus the cars.
- Stress scenario in headless Chromium at 870 x 390, device scale 2, **software rendering**
  (SwiftShader), on a two-core machine that was running other test suites at the time: about
  32 ms a frame at `high` with 264 sprites and 92 pixel particles live, about 21 ms at `low`.
  This says nothing about a phone's GPU. No frame rate on real hardware has been measured and
  none is claimed.

## What the event stream did not carry

Worked round on the client; none needed a change to the simulation.

| Missing | Used instead |
| :-- | :-- |
| Which weapon a projectile in a snapshot belongs to | The `shot` event's `projectile` id, remembered when the event arrives |
| What a `grip` or `slow` status came from | The hazards under the car, a frost shell beside it, or the attacker's weapons (`classify`) |
| A hit event for the frost shell (it does no damage) | The `grip` status with a frost shell of the attacker within 90 px: the shatter is drawn where the shell was |
| Where a car is burning | The position of its last `burn` hit |
| Where the harpoon caught | The side of the target that faces the thrower when `tether attached` arrives |
| When the boomerang turns | Its velocity turning against its line from the launch point |
| The rival's shield points and cooldowns | `modules[i].up` and the `shield` events (by design, Section 7.5) |

## Known weak spots

See the report of Milestone C part 2 and `docs/ART_GUIDE.md`. In short: the mortar's column is
a thin trunk under a cap and does not yet read as massive; the boomerang is small; the saw's
teeth are four pixels of highlight; charge lights are two-pixel cells; the tesla bolt is short
at the ranges the weapon works at. The wet road scenario is drawn on the clear-night bake:
there is no rain bake, so there are no reflections and no rain.
