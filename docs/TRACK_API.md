# Track API (Milestone D, phase 0)

What the track system provides, for whoever builds on it: the art engineers (terrain, ambient
animation, weather art), the AI engineer (route planning, shortcuts, hazards), the HUD and the
sound. A track is authored data; the simulation, the validator, the client's layout view and
the terrain baker all read the same data through the same functions, so the picture, the
physics and the AI can never disagree about where the road is.

Units: world pixels (one world pixel is one logical pixel, `WORLD_PIXELS_PER_METER` is 8), y
down the screen, headings in radians with 0 up the screen and clockwise. Time is the race clock:
ticks of `SIM_DT` (1/30 s) counted from GO, zero on the grid. Arc lengths are measured along a
branch's sampled centerline (`TRACK_SAMPLE_SPACING`, 10 px between samples).

## Where things are

| File | What it holds |
| :-- | :-- |
| `packages/shared/src/types.ts` | The authored format: `TrackDefinition` and every type it uses, `TRACK_FORMAT_VERSION` (2) |
| `packages/shared/src/track.ts` | `buildTrack` (the runtime), `locate`, `groundAt`, `surfaceAt`, `lapPosition`, `updateProgress`, `wallDepth`, `obstacleDepth`, `crossingClosed`, `routeBranches` |
| `packages/shared/src/hazards.ts` | Hazard timetables (`scheduleState`, `hazardActive`, `gustFactor`), `exposureAt`, the `Ground` record |
| `packages/shared/src/trackShapes.ts` | Shapes: polygons, circles, bands along a branch; outlines for drawing |
| `packages/shared/src/trackSigns.ts` | The reference speed profile (`referenceSpeeds`), sharp bends (`sharpBends`), corner signs |
| `packages/shared/src/trackcheck.ts` | The validator, `checkTrack`, and its limits `TRACK_LIMITS` |
| `packages/shared/src/layout.ts`, `layoutRaster.ts` | The layout view as drawing primitives, and a software rasterizer for them |
| `packages/shared/src/balance.ts` | `WIND`, `TRACK_HAZARD`, `CORNER_SIGNS`, `SHORTCUT_MIN_GATES`, `OPEN_GATE_REACH`, the grip and cooling tables |
| `packages/content/src/trackKit.ts` | The authoring kit: `defineTrack`, rounded corners, road-relative placement |
| `packages/content/src/tracks.ts`, `tracks/*.ts` | The eight launch tracks |
| `packages/content/src/weather.ts` | The weather presets |
| `tests/tools/trackcheck.ts` | `npx tsx tests/tools/trackcheck.ts <id\|all> [--drive]`: every rule, and with `--drive` the simulator's rules |
| `tests/tools/trackview.ts` | `npx tsx tests/tools/trackview.ts <id\|all> [scale] [outDir]`: the layout view as a PNG, with the default car's driven line and race time |
| `art/scripts/terrain/` | The terrain baker: generic steps, `biome.ts` (the contract), one module per biome (`city/`, `desert/`, `forest/`, `snow/`, `industrial/`) |

## The format

A `TrackDefinition` (format 2):

| Field | Meaning |
| :-- | :-- |
| `formatVersion` | `2`. |
| `id`, `name`, `biome`, `character` | As in Section 9.1's table. `biome` picks the terrain module. |
| `lengthClass` | `short` (about 105 s for the default car over a race) or `long` (about 130 s), Section 9.3. Measured, not declared: a test holds the default car to the class within 10 percent. |
| `laps` | 3 on every track (the spec gives no other number). |
| `worldWidth`, `worldHeight` | The world, and the extent of the baked terrain. |
| `edges` | `walled`: beyond each corridor's shoulder is solid (city streets between buildings, factory halls). `open`: beyond the shoulder is off-road ground, and only the listed walls and obstacles are solid. A track is one or the other; a walled corridor beside open ground would pull a car through its wall. |
| `offroadSurface` | The ground off the road on an open track (sand, dirt, snow). |
| `main` | The closed centerline: control points `{ x, y, width, surface?, shoulder? }`. `width` is the paved width; `shoulder` the drivable strip each side; `surface` applies from that point to the next. Centripetal Catmull-Rom through the points, resampled every 10 px. |
| `shortcuts` | Open branches with `leaveNear` and `rejoinNear` (snapped onto the main line), `signName`, `risk` (what makes it risky) and `gates` (checkpoint gates it must carry, default 2 on an open track, 1 on a walled one). |
| `checkpointCount` | Evenly spaced ordered checkpoints, gate 0 on the start line. The builder adds more inside a shortcut's span when the shortcut would otherwise carry fewer than `gates`. |
| `startNear` | Near the start line, snapped onto the main line. The two grid slots are 46 px behind it, level, either side of the centre. |
| `surfaceZones` | `{ id, surface, shape }` laid over road and ground alike; later zones win. |
| `walls` | `{ id, kind, points, closed?, thickness, telegraph? }`: a capsule of `thickness` along the polyline. Barriers, barricades, cliffs, tree lines, snow banks, rails, the boundary of an open map. |
| `obstacles` | `{ id, kind, x, y, radius, telegraph? }`: solid circles. Kinds used: bollard, crate, pillar, barrel, tree, rock, log. |
| `hazards` | Environment hazards, below. |
| `windExposure` | Share of the weather's wind that reaches a car or a projectile outside crosswind zones: 0 in the city (the streets are sheltered), 0.15 in the forests, up to 0.55 in the desert. |
| `anchors` | `{ id, kind, points, tag? }`: named points and polylines for the art and the sound. |
| `cameraBounds` | What the camera may show and the art must cover. Today it is always the whole world: the client clamps the camera to the world. |
| `props`, `landmarks` | Neon Cut's landmark props (read by the city module by name), and the names of four or more landmarks (Section 12.10). |
| `weatherPresetIds` | Exactly the two of Section 9.1's table, in its order. The first is the one the length class is measured on. |
| `surfaceMix` | Section 9.1's dominant surfaces. The validator measures the main line against it. |

**Shapes** (`TrackShape`): `polygon` (world points), `circle` (centre and radius), or `band`:
`{ branch, from, to, lateral: [a, b] }` follows a branch from the arc length nearest `from` to
the one nearest `to` (in the direction of travel, wrapping a loop), between two signed offsets
from the centerline, positive to the right of travel. A band of `[-90, 90]` on a 140 px road
covers the road and its shoulders; `[10, 90]` is the inside half of a right-hand bend.

**Surfaces**: asphalt, cobble, sand, dirt, mud, snow, ice, metal. Grip per weather is Section
9.2's table exactly (`SURFACE_GRIP`), rolling resistance is `SURFACE_ROLLING_DECEL`. A car on
the shoulder or off the road gets the shoulder penalty (`SHOULDER_GRIP_FACTOR`, at least
`SHOULDER_ROLLING_DECEL`). What the default car does flat out on each, measured on the proving
ground: asphalt 270 px/s, cobble 257, sand 153, dirt 234, mud 84, snow 212, ice 272, metal 270.

### What the simulation reads, and how cheaply

`buildTrack(def)` builds the runtime once per definition object (cached; never mutate a
shipped definition). It samples every branch, buckets segments, walls and obstacles on a 96 px
grid, and bakes surface zones and area hazards into an 8 px zone grid (`zoneSurface`,
`zoneHazard`: one byte a cell). On an open track every grid cell lists the segments that can be
nearest to any point in it, so `locate` never falls back to a scan off-road.

Each tick, for each car, the integrator calls `locate` once and `groundAt` once: the surface
(zone, road, shoulder or off-road), whether the shoulder penalty applies, and the area hazard's
effect, from one grid read. Measured in `tests/unit/trackFormat.test.ts` on Dust Devil:
`groundAt` alone 0.3 us a call; `locate` plus `groundAt` 7 us at random points over the whole
map (most of them far off the road, where buckets are longest); two cars with drivers 60 to 80
us a tick. The surface is sampled under the car's centre, not under each wheel (Section 7.3
allows either; per wheel would change Neon Cut's driving).

On a walled track the corridor edge pushes a car back as before (decision 10). On every track
walls and obstacles push (capsules and circles), and a rail crossing's barrier pushes while it
is down. Format-1 tracks, and Neon Cut, take exactly the old code path: Neon Cut's runtime, its
default-car race and a whole armed race are bit-identical to format 1 (fingerprints in
`tests/helpers/fingerprint.ts`, asserted in `tests/unit/trackFormat.test.ts`).

### Checkpoints and shortcuts

Ordered gates, credited only for a forward crossing of the expected gate (Section 3.4). A
checkpoint inside a shortcut's span has a gate on the shortcut too, at the same share of its
length (progress equivalence), so driving the shortcut is credited like the road it bypasses
and course progress stays comparable between the two cars. A shortcut carries at least
`gates` gates of its own; the builder adds checkpoints until it does. On an open track a gate
reaches `OPEN_GATE_REACH` (200 px) past the shoulder on each side, so a car that runs wide is
counted, and stops short of a wall or of another piece of road. A car that cuts across open
ground away from both the road and the shortcut crosses no expected gate and is not credited;
it can drive back and take the gate it missed (tested on Dust Devil).

`checkpoint.low` and `high` are the lap positions course progress runs between after it; they
are uniform (the old formula) when no checkpoint was added.

### Off-road and return paths

An open track's off-road is ground: slower (the shoulder penalty on the off-road surface), never
an instant failure, never an invisible wall. What is solid is listed (walls, obstacles) and
drawn. The world is closed by a boundary wall (`kit.boundary`). The validator floods the
ground from the road: it must not reach the world's edge, and pockets behind gaps narrower
than a car are reported (no car can get into them, so they cannot strand one).

### Environment hazards

Every hazard acts on every car alike, is drawn, and is a pure function of the race clock, so the
server, the predicting client and a replay agree without anything being sent. A timetable
(`HazardSchedule`) is `{ periodSeconds, offsetSeconds, warnSeconds, activeSeconds }`: each
period is quiet, then `warnSeconds` of warning, then `activeSeconds` active. Before GO the clock
reads 0. `scheduleState(schedule, seconds)` gives the phase and the seconds left in it;
`hazardActive(hazard, ticks)` what the physics uses.

| Kind | Shape | Effect | Where |
| :-- | :-- | :-- | :-- |
| `crossing` | barrier `a` to `b`, `thickness` | While active the barrier is solid for cars (not for shots: a boom at bumper height). `lights` blink through warning and active; `railPath` is where the tram runs. | Backstreet Blitz, Signal Street: 14 s period, 1.6 s warning, 2.6 s down, offset 4 s (the race starts in a warning; first down at 1.4 s) |
| `oil` | any | Grip times `grip` (0.55) while the car's centre is in it, after the tire cap | Steel Circuit, Smelter Hall: a band on the left of the hall and a pool at its exit |
| `steam_vent` | any | While active: `drag` px/s2 of extra rolling resistance (140) and `heatPerSecond` engine heat (18) | Steel Circuit, Smelter Hall: two vents, 6 s period, 1.2 s hiss, 1.5 s blast, offsets 0 and 3 s |
| `magnetic_strip` | any | Magnetic tires (`VehicleParams.magneticTires`) grip `1 + gripBonus x supply` harder (0.25), before the tire cap; nothing for other tires | Steel Circuit, Press Hall's two corners |
| `crosswind` | any | The weather's wind at `exposure` instead of the track's, times `gust` (a smooth cycle between `low` and `high`) | Dust Devil's southern arc and northern rise; Canyon Switch's plateau and switchback crest; Whiteout Pass's frozen pond |
| `deep_mud` | any | `drag` px/s2 of extra rolling resistance (soft sand, deep mud, soft snow) | Dust Devil's Dry Wash (22), Moss Run's Marsh Track (20), Timber Dash's Logging Spur dip (24), Whiteout Pass's Snowmobile Trail (18) |

Area hazards may not overlap (each zone cell holds one). Every timed hazard has at least a
second of warning. `track.routeHazards` lists where each hazard sits on the route (branch, arc
length, length of centerline inside) for planners.

### Wind

Section 9.2: "Wind mainly affects exposed bodies and airborne projectiles". On a car the
weather's wind times `WIND.bodyGain` (0.5) times the local exposure is an acceleration, in full
across the car and a quarter of it along the car (`alongShare`), scaled by the square root of
the reference mass over the car's mass (0.7 to 1.35). The crosswind preset's 70 px/s across a
reference car in a fully exposed zone is 35 px/s2, about a seventh of what Street Tires hold on
sand. A projectile carries `WIND.projectileGain` (0.35) of the wind at its launch point as drift
for its whole flight (a bullet drifts about 10 px over its 220 px of reach in that crosswind); a
lobbed shell's landing point moves with it, and its telegraph shows where it will land. A
sheltered track (exposure 0, every city track) is bit-identical with or without wind.

### Weather presets

`packages/content/src/weather.ts`. Every preset points at a row of the grip table and of the
cooling table and adds `ambientTempC`, `rainIntensity` (how hard it falls, for the art and the
sound), `wetness` (the road), `windX`, `windY` (px/s), `visibility` (1 clear) and `cooling` (the
table's, published). Tire specialization multiplies on top of the table and is capped at
`MAX_COMBINED_GRIP` (1.45).

| Preset | Row | Time | Temp | Rain | Wet | Wind | Vis | Track |
| :-- | :-- | :-- | --: | --: | --: | :-- | --: | :-- |
| `city_clear_night` | clear | night | 17 | 0 | 0 | 0, 0 | 1 | Neon Cut |
| `city_rain_night` | rain | night | 12 | 0.6 | 0.8 | -18, 6 | 0.9 | Neon Cut |
| `city_clear_day` | clear | day | 22 | 0 | 0 | 8, -4 | 1 | Backstreet Blitz |
| `city_rain_day` | rain | day | 14 | 0.55 | 0.75 | -14, 8 | 0.88 | Backstreet Blitz |
| `desert_clear` | clear | day | 31 | 0 | 0 | 10, 0 | 1 | Dust Devil |
| `desert_crosswind` | clear | day | 27 | 0 | 0 | 12, 70 | 0.94 | Dust Devil |
| `desert_dry_heat` | dry_heat | day | 43 | 0 | 0 | 6, 0 | 0.92 | Canyon Switch |
| `desert_sandstorm` | sandstorm | day | 34 | 0 | 0 | -62, 24 | 0.6 | Canyon Switch |
| `forest_clear` | clear | day | 18 | 0 | 0.1 | 4, 2 | 1 | Moss Run, Timber Dash |
| `forest_rain` | rain | day | 13 | 0.65 | 0.85 | -10, 12 | 0.85 | Moss Run |
| `forest_heavy_rain` | heavy_rain | day | 11 | 1 | 1 | -16, 14 | 0.7 | Timber Dash |
| `snow_clear_frost` | clear_frost | day | -9 | 0 | 0 | 12, 0 | 1 | Whiteout Pass |
| `snow_snowfall` | snowfall | day | -4 | 0.7 | 0.4 | -22, 10 | 0.72 | Whiteout Pass |
| `industrial_dry_night` | clear | night | 15 | 0 | 0 | 0, 0 | 1 | Steel Circuit |
| `industrial_factory_rain` | rain | night | 11 | 0.6 | 0.8 | 8, 14 | 0.86 | Steel Circuit |

Crosswind, the night variants and factory rain are not rows of the table: crosswind is the
clear row with a strong wind, dry night the clear row at night, factory rain the rain row at
night. The preset is fixed before the build timer; nothing changes mid-race.

### Corner signs

Section 9.3: signs "0.8 to 1.2 seconds before arrival at normal speed". Normal speed is a
reference profile of the default car along each centerline (`referenceSpeeds`): cornering at
0.86 of the clear-weather limit, braking at 0.7, accelerating toward each surface's own top
speed, and bogging down gradually on a slower surface. A bend is a run of curvature tighter than
260 px radius turning 30 degrees or more where the profile slows below 80 percent of top speed;
each gets a sign 1.0 s before it at reference speed, on the outside edge. A bend that follows
the previous one within a second is part of its sequence and announced by that sign (`chain`
counts the bends: a "double bend" board). A bend at a shortcut's mouth is announced by the
shortcut's own named sign. `track.cornerSigns` gives position, side, `turn`, `severity` (1 lift,
2 brake, 3 hairpin), `turnDegrees`, `minRadius`, `bendSpeed`, `leadSeconds`. The validator
checks every sharp bend is covered and every lead is 0.8 to 1.2 s at reference speed; with
`--drive` (and in the tests) it checks the same with the real default car, first weather.

Neon Cut's baked art places its own chevron boards; its runtime signs are data for a rebake.
The other seven bakes place their chevron boards from the runtime signs (`track.cornerSigns`).

### Anchors

Named points and polylines, `kind` free-form, `tag` free text. Kinds used so far: `sign`,
`warning` (what telegraphs an obstacle or a barricade), `landmark`, `lamp`, `neon`,
`billboard`, `traffic_light`, `awning`, `laundry_line`, `tram_line`, `chimney`, `snow_gun`,
`conveyor`, `piston`, `sparks`, `glow`, `warning_light`, `magnet_marks`, `birds`, `water`,
`waterfall`, `mist`, `canopy`, `leaves`, `bridge`, `dust_devil`, `dust`, `flag`, `wind_sock`,
`tumbleweed`, `heat_haze`, `ice_cracks`, `snow_drift`. Hazards carry their own anchors
(`lights`, `railPath`), and corner signs and checkpoint gates are in the runtime.

## Rules (the validator)

`checkTrack(buildTrack(def))`, run on all eight tracks by `tests/unit/trackFormat.test.ts` and
by `npx tsx tests/tools/trackcheck.ts all --drive`:

| Rule | Checked |
| :-- | :-- |
| `closed_loop` | The main line is closed, has four points or more, closes on itself, and the start line is where it was authored. |
| `no_self_intersection` | No centerline crosses itself; no two parts of any branch, or of two branches, come within their widths plus 24 px (walled) or 16 px (open), except near a shortcut's two ends. |
| `width_bounds` | Main line 100 to 240 px paved, shortcuts 60 to 170 px. |
| `world_margin` | Every centerline 300 px from the world's edge. |
| `checkpoints` | Four or more, gate 0 on the start line, in order, every gate crossing its branch, and walking the main line finishes the race. With `--drive`: the default car finishes, within 10 percent of its class on the first weather. |
| `shortcuts` | At least one; each rejoins less than half a lap after it leaves, starts and ends near the main line, carries its gates, is credited gate for gate when driven, and a lap through it counts; each says what makes it risky. |
| `spawn_grid` | Both slots on the main line's pavement, level within 2 px, facing down the road, 40 px clear of walls and obstacles, clear of area hazards and 240 px from a crossing. |
| `surface_mix` | Each surface's share of the main centerline (zones included) within 5 points of `surfaceMix`, which adds up to 1. |
| `corner_signs` | Every bend tighter than 160 px through 45 degrees that the reference car slows for is covered by a sign; every lead 0.8 to 1.2 s at reference speed; signs inside the camera bounds. With `--drive`: leads with the real default car, measured on the second lap when it passes the sign at three quarters of reference speed or more. |
| `offroad_return` | Open tracks: the ground does not reach the world's edge, and there is ground. |
| `racing_line_clear` | No obstacle or wall reaches into a branch's racing lane (the pavement less 22 px each side) without a `telegraph` anchor within 400 px. |
| `hazards` | Timetables fit their period, at least a second of warning; crossings have lights both sides and span the road; oil, crosswind and magnet numbers in range; every area hazard covers ground. |
| `camera_bounds` | Inside the world; every centerline 200 px inside; every wall, obstacle, anchor and hazard inside. |
| `weather` | Exactly two presets (the tool also checks they exist). |
| `anchors` | Unique ids, every anchor has a point, four landmarks. |

## The eight tracks

Measured with the default car (Baseline Beetle, Four-Cylinder, Street Tires) and the
centerline driver over the main route, three laps, first weather (the second in brackets).
Surface shares are of the main centerline, measured by the validator.

| Track | Shape | Class | Race s | Lap px | Main surfaces | Shortcut | Hazards and obstacles |
| :-- | :-- | :-- | --: | --: | :-- | :-- | :-- |
| Neon Cut | Fast outer ring folding into two cobbled hairpins | long | 120.7 (125.4) | 9756 | asphalt 78, cobble 22 | Lantern Alley | bollards at the alley mouths |
| Backstreet Blitz | A downtown grid: square corners, a long east boulevard, a jinking cobbled old town | short | 107.4 (122.5) | 5913 | asphalt 59, cobble 41 | Laundry Lane (skips the crossing), Bakers Row (straight through the market jink) | Signal Street tram crossing; three barricades on Bakers Row; crates; old-town gate bollards |
| Dust Devil | A bean of big sweepers on open desert, a dip into the infield, Devil's Elbow | long | 137.9 (137.8) | 8642 | sand 57, asphalt 43 | Dry Wash across the top of the dip | soft sand in the wash; crosswind on the southern arc and northern rise; drifted sand on the inside of the asphalt sweepers; rocks off the road; mesa cliffs |
| Canyon Switch | A wind-blown plateau straight, a sandy descent, cliffside S-bends between rock walls, a switchback climb | long | 128.1 (126.7) | 9108 | asphalt 67, sand 33 | Ledge Run along the cliff foot | crosswind on the plateau and the crest; canyon walls; guard rail; fallen rock on the ledge |
| Moss Run | A loop through woodland round a mill pond: paved north over a wooden bridge, muddy shaded bends, a dirt south | short | 101.1 (106.4) | 7138 | asphalt 49, dirt 31, mud 20 | Marsh Track, the muddy detour | the creek and the pond (water), bridge rails, deep marsh mud, trees, stumps, reeds |
| Timber Dash | Two long straights, each broken by a tight chicane round giant redwoods, hairpins at the ends | long | 126.2 (138.2) | 9179 | asphalt 47, dirt 45, mud 8 | Logging Spur through the eastern woods | the redwoods; mud in the haul road's ruts; the spur's muddy dip; log piles; tree lines |
| Whiteout Pass | A plowed sprint lane between snow banks, slippery switchbacks, the crossing of a frozen pond | short | 102.0 (108.1) | 6353 | snow 57, ice 25, asphalt 18 | Snowmobile Trail past the switchbacks | snow banks; crosswind across the pond; soft snow on the trail; pines |
| Steel Circuit | A factory at night: a tight three-corner wriggle in Press Hall, the yard road, the cobbled dock, Smelter Hall | short | 110.2 (118.5) | 6498 | metal 47, asphalt 40, cobble 13 | Conveyor Gap under the conveyor bridge | magnetic strips in Press Hall's corners; oil and two steam vents in Smelter Hall; pillars (telegraphed at the gap), crates, a barrel |

All eight pass every rule. The camera is fixed, north up and wider than tall, so the long
fast straights run east and west (Neon Cut's harbor and billboard rows, Backstreet Blitz's
boulevard, Canyon Switch's plateau, Timber Dash's two straights, Whiteout Pass's sprint lane,
Dust Devil's southern arc); north-south runs are short or end in a signed bend.

**Resolved: heavy builds stalled on sand.** Rolling resistance on sand is a fixed 42 px/s² for
every car, and three shipped builds had less drive than that to spare at low speed (the numbers
are in `docs/BALANCE_CHANGELOG.md` 0.7.0). Since the crawl floor (`LOOSE_CREEP`, BALANCE_CHANGELOG
"the loose-ground crawl floor") loose ground and shoulders never take more than 70 percent of a
car's own drive below 30 px/s, fading out by 70 px/s, so any car creeps forward; and the two
starters among the three, Packhorse and Longlegs, race on the Trail Engine. Every course finishes
all 110 harness races (`docs/evidence/balance/tracks-0.7.0-crawl.md`); `tests/balance/tracks.test.ts`
holds a minimum sand speed for every shipped build.

## For the AI engineer

What a planner can read, all of it from the runtime and identical on the server and the client:

- **The route graph.** `track.branches[0]` is the main line, `track.branches[1..]` the
  shortcuts, each with `leaveS` and `rejoinS` on the main line, its `length`, `halfWidth`,
  `shoulder`, `curvature`, `surface` (zones included) and `hazard` per sample. The shortcut's
  `risk` text and `gates` are in `def.shortcuts`. A bot may use a shortcut only by driving it:
  the checkpoints make anything else worthless (Section 9.3).
- **Speeds.** `referenceSpeeds(branch, track)` is a cornering, braking and surface profile of
  the default car; scale it for the bot's own car (its `VehicleParams`). `planSpeed` in
  `driver.ts` is the plan the sparring brain and the centerline driver use (cornering, braking,
  oil, rail crossings); `sharpBends` and `track.cornerSigns` give bends with their tightest
  radius and slowest reference speed.
- **Hazards.** `track.routeHazards` places each hazard on the route. `scheduleState` and
  `hazardActive` answer "will the barrier be down when I get there?" for any future tick: the
  clock is `hazardClock(session)` (race ticks since GO) plus the ticks to arrival. `planSpeed`
  already stops for a crossing that will be down during the car's pass, with 0.6 s of margin.
- **The ground.** `groundAt(track, loc, x, y, clock, out)` for any point: surface, shoulder or
  off-road, oil, drag, heat, magnet bonus, wind exposure. `exposureAt` for wind alone.
- **Solids.** `wallDepth` and `obstacleDepth` for a circle at a point; `pointSolid` and
  `lineClear` (combat geometry) for line of sight. Closed crossings do not block shots.
- **What the AI built on these.** `packages/shared/src/ai/route.ts` turns the branches into
  composite routes (the main line with a set of shortcuts spliced in), scans each for ground and
  clearance, and works out a racing line and speed limits per car; `aiLoadouts.ts` in content
  holds per-course surface profiles and the kits worth trying. The AI drives shortcuts when its
  own estimate says they pay, reading `scheduleState` for the crossings. See `docs/AI_GUIDE.md`.
  The sparring brain still never takes a shortcut.

## The terrain baker

`art/scripts/terrain/` (see also `docs/ART_GUIDE.md`). The generic steps (`index.ts`) build
the track runtime and the corridor field, call the biome module, then chunk the ground into
512 px indexed PNGs, package overlays and animated loops, draw the minimap, write the manifest
and the previews. `biome.ts` is the contract:

- **In** (`BakeContext`): the format-2 `def` (zones, walls, obstacles, hazards, anchors, camera
  bounds, props), its runtime `track` (centerlines, checkpoints, corner signs, zone grids,
  `groundAt`), the corridor `field` (per world pixel: distance past the solid edge, lateral
  offset, arc length, branch, sample, pavement or shoulder, pavement surface, smoothed
  curvature), the `preset` (time of day, wetness, rain, wind, visibility), a world-sized
  `Canvas` to paint the ground on, and a `seed`.
- **Out** (`BiomeOutput`): `overlays` (art drawn over cars, faded near the player), `animated`
  loops (strips of frames, above or below cars, normal or additive), `lights` (baked lamp
  positions, for tinting cars as they pass), preview spots, and `checks` (both must be zero:
  drivable pixels hidden by raised geometry, frame-0 mismatches of ground loops).
- **A module** (`BiomeModule`): `{ biome, paint, presets }`, registered in `BIOMES` in
  `index.ts`. A module refuses a preset it does not paint rather than painting it wrongly. All
  five biomes have one, and every launch course is baked: `city/` (Neon Cut; Backstreet Blitz
  under its own style in `city/blitz/`), `industrial/` (Steel Circuit, on the city's oblique
  machinery), `desert/` (Dust Devil, Canyon Switch), `forest/` (Moss Run, Timber Dash) and
  `snow/` (Whiteout Pass, on the forest kit). `docs/ART_GUIDE.md` ("Terrain") has the practice of
  each, `docs/art/tracks/<id>.md` the plan of each track.

The corridor field is sampled at every pixel near the road; on an open track cells whose
nearest corridor edge is surely more than `OPEN_FIELD_REACH` (480 px) away are left `FAR`, so a
large open map bakes in reasonable time. A painter that needs the surface or a hazard at a pixel
calls `groundAt` on the runtime, the same lookup the physics makes.

Commands: `npx tsx art/scripts/bake-terrain.ts [--track id] [--preset id] [--out dir]
[--no-preview] [--check]` bakes one course (positionally too: `bake-terrain.ts <track>
<preset>`), into the game's maps folder by default, which also refreshes `assets/maps/index.json`,
the art-side manifest copy and `art/manifests/<track>_<preset>.checks.json` (the self-checks with
the sha256 of the shipped folder they were made on). `--check` bakes into a temporary folder and
fails unless the result is byte-identical to the shipped bake: every one of the sixteen is
reproducible this way. `pnpm art` bakes everything. The city module was refactored, not
rewritten: Neon Cut's bake is byte-identical to the committed one (sha256 of names and bytes
`92dba1e3bd9432cb13f64de9a62d4fdc385103211da60dda2e95598bf2b93813`).

### Download sizes

Section 2: first-play mandatory assets under 8 MB transferred, extra biomes lazy-loaded. A race
downloads one course's terrain (only that course's folder), so each course is held to 2.5 MB
and a first race's images (that course, every car sheet and the four effect atlases, about 1.7
MB) to 4.5 MB (`tests/unit/terrain_courses.test.ts`). Measured sizes per course are in
`docs/evidence/tracks/README.md`; the largest is Timber Dash at about 2.3 MB (its canopy tiles).

### What the art must provide, per track and weather preset

Into `apps/web/public/assets/maps/<trackId>/<presetId>/`:

- `manifest.json` (`TerrainManifest`): world size, chunk size, the chunk list, overlays,
  animated loops, lights, and the minimap's file, size and world scale.
- Ground chunks: 512 px indexed PNGs covering the camera bounds (the whole world today).
- Overlays: foreground art drawn above the cars (gantries, bridges, canopies, ledges); mark
  `fadeNearPlayer` for anything a car can pass under (Section 9.1: foreground occlusion fades).
  The client fades one while a car's body box touches its pixels (not its bounding box), so a
  piece fades as a whole only when the car is really at it (`weather/overlayFade.ts`).
- Animated loops: at least three ambient loops a track (Section 12.10), never over a warning
  telegraph (Section 13.5). The hazards need theirs: crossing lights and the tram, steam
  hiss and blast frames on the vents' timetable, magnetic lane marks, oil sheen. A loop whose
  `kind` is `timetable:<hazardId>` is one period long and the client sets its frame from the race
  clock (`timetableFrame`, `apps/web/src/game/weather/terrainArt.ts`); every other loop plays.
- `minimap.png`: the course map, transparent, as `art/scripts/terrain/minimap.ts` draws it.
- One bake per preset: the weather art is per preset (wet roads, snow cover, dust). Until a
  preset is baked, a development build draws another preset's bake of the same track and says
  "Weather art in progress"; a production build does not offer it.

What the art must respect: the road, its shoulders, walls, obstacles and hazards are where the
data says (the field is drawn from the same `locate`); nothing raised may hide drivable ground
(`checks.coveredDrivable` must be zero); signs at `track.cornerSigns`; telegraph anchors drawn
as warnings; Section 12.10's thirty props, four landmarks (the `landmark` anchors), three
loops and two surface or obstacle behaviours a track.

## How the client uses it

- `assets/maps/index.json` lists the baked courses. A production build offers only those (all
  sixteen courses since Milestone D); a development build or `?debug=1` offers all eight tracks
  and both of their weathers (`apps/web/src/app/course.ts`).
- The Track Preview steps through the tracks at the top of the map and turns the weather badge
  into a choice of the track's two weathers when more than one course is offered; the map is
  the bake's or drawn from the layout, with a "Track art in progress" note on an unbaked one.
  The choice is stored and read by the garage's scores and by the race.
- A course without baked art races in the layout view (`apps/web/src/game/layout/`): flat
  ground colors per surface, road edges, curbs, checkpoints, walls, obstacles, hazards and
  corner signs as simple shapes, the crossing and the vents animated from the race clock, the
  words stencilled on the ground and a "Track art in progress" badge.
- The join carries `trackId` and `weatherPresetId`; the server refuses a track it does not know
  (`UNKNOWN_TRACK`) and a weather the track does not publish (`BAD_REQUEST`); the offline
  drive refuses the same pairs.

## How to add a track

1. Write `packages/content/src/tracks/<id>.ts` with `defineTrack` (see the seven new tracks):
   corners `c(x, y, radius, width, surface?, shoulder?)` in design units, `scale`, `margin`,
   shortcuts with `leave`, `rejoin` and corners, then `features(kit)` placing zones, walls,
   obstacles, hazards and anchors against the road (`kit.at`, `kit.band`, `kit.edge`,
   `kit.wallAlong`, `kit.rowAlong`, `kit.crossing`, `kit.boundary`).
2. Add it to `TRACKS` and give it two presets in `weather.ts`.
3. `npx tsx tests/tools/trackview.ts <id>` and look at `art/preview/tracks/<id>_layout.png`.
4. `npx tsx tests/tools/trackcheck.ts <id> --drive` until every rule passes. Tune the race time
   with `scale` (the shape stays, every length and radius moves together), the surface mix with
   bands, and corner signs come by themselves.
5. Run the harness on it: `npx tsx tests/balance/tracksReport.ts`.
6. Bake its terrain once a biome module paints it (`npx tsx art/scripts/bake-terrain.ts <id>
   <preset>` for each of its weathers), review it (`art/scripts/preview-terrain-frames.ts`, then
   `tests/visual/courses.ts` in the client), and add it to nothing else: the index, the
   checks file and the tests pick it up.
