# Track terrain: the sixteen launch courses (Milestone D finish)

Every course a production build offers (eight tracks, two weathers each), captured in the real
client: the production build, offline drive with the autopilot and the AI rival, on a manual
clock, 870 x 370 CSS pixels at two device pixels a CSS pixel (the `Close` step then shows 870
world pixels across, as on the owner's phone), weather layer on, effects tier high.

Each sheet, at one CSS pixel per pixel and folded to 256 colors: three `Close` frames spread
over the first lap (3 s, about a third and about two thirds in), the `Far` step (1,740 world
pixels across, shown at half size), and the HUD with its minimap 3 s after GO. The frames the
sheets were picked from (six `Close` frames a course, `Far`, the HUD and the minimap alone)
were all reviewed; they are not committed (about 2 MB a course).

Made with `npx tsx tests/visual/courses.ts http://localhost:2676 <outDir> --sheets=docs/evidence/tracks`
against `npx vite build --outDir <dir>` served by `PORT=2676 WEB_DIST=<dir> node apps/server/dist/main.js`.
Composed bake frames (no weather, any bake, the client's fade):
`npx tsx art/scripts/preview-terrain-frames.ts <track> <preset>`. Practice: `docs/ART_GUIDE.md`
("Terrain"); plans per track: `docs/art/tracks/`; decisions: `docs/DECISIONS.md` (the terrain
finish of October 12).

## The courses

| Course | Sheet | State | What was found and done |
| :-- | :-- | :-- | :-- |
| Neon Cut, clear night | [city_01_city_clear_night.png](city_01_city_clear_night.png) | Complete (the approved reference) | Byte-identical to the approved bake (`92dba1e3...`); it had no self-check record, now it has one. |
| Neon Cut, rainy night | [city_01_city_rain_night.png](city_01_city_rain_night.png) | Complete | Reproducible. Wet pass, puddles, mirrored neon; the client's rain, spray on standing water and live reflections on top. |
| Backstreet Blitz, golden hour | [city_02_city_clear_day.png](city_02_city_clear_day.png) | Fixed | The tram crossing's loop played free-running from scene start, so the boom showed at a random phase (launch blocker, DECISIONS 227): it is now set from the race clock, and the boom is drawn down exactly when the barrier is solid. |
| Backstreet Blitz, rain | [city_02_city_rain_day.png](city_02_city_rain_day.png) | Fixed | As the golden hour. |
| Dust Devil, clear | [desert_01_desert_clear.png](desert_01_desert_clear.png) | Fixed, still the emptiest ground | The shipped bake did not match the code (painted before later edits): rebaked. Open sand given structure: dry washes with gravel beds and lit and shaded banks, creosote stands, dune slip faces a full step darker. Overlays cut to the client's fade reach. |
| Dust Devil, crosswind | [desert_01_desert_crosswind.png](desert_01_desert_crosswind.png) | Fixed | As the clear; the wind of the day is in the ripples, sand fingers, rock tails, socks and the client's sand streaks. |
| Canyon Switch, dry heat | [desert_02_desert_dry_heat.png](desert_02_desert_dry_heat.png) | Fixed, weakest of the sixteen | Failing test (below); not reproducible: rebaked. Washes, a power line on the plateau, a bank with gullies and scree beyond the guard rail (it read as a gray smear), canyon walls taper where they would fade from the lane, the overhang named an arch. The plateau is still a big plain. |
| Canyon Switch, sandstorm | [desert_02_desert_sandstorm.png](desert_02_desert_sandstorm.png) | Fixed | As the dry heat; the storm's haze stays out of the protected zone round both cars and the road ahead. |
| Moss Run, clear | [forest_01_forest_clear.png](forest_01_forest_clear.png) | Complete | Reproducible. Crowns beside the road no longer blink when the car passes their empty corners (the fade now reads the overlay's pixels). |
| Moss Run, rain | [forest_01_forest_rain.png](forest_01_forest_rain.png) | Complete | Reproducible. Mud, dirt and wet asphalt read apart; spray brown on dirt. |
| Timber Dash, clear | [forest_02_forest_clear.png](forest_02_forest_clear.png) | Complete | Reproducible. The largest course (canopy tiles). |
| Timber Dash, heavy rain | [forest_02_forest_heavy_rain.png](forest_02_forest_heavy_rain.png) | Complete | Reproducible. Lightning checked off under Reduce Flashes and Reduced Motion. |
| Whiteout Pass, clear frost | [snow_01_snow_clear_frost.png](snow_01_snow_clear_frost.png) | Fixed | The racing line over the pond is dark glassy ice again; the undrawable "ice cave" landmark replaced by the drawn chairlift (data and anchor). |
| Whiteout Pass, snowfall | [snow_01_snow_snowfall.png](snow_01_snow_snowfall.png) | Fixed | Not reproducible: rebaked, and the rebake failed the surface test (ice and packed snow 28 apart, under the 38 the test holds): fixed in the painter, now 61. |
| Steel Circuit, dry night | [industrial_01_industrial_dry_night.png](industrial_01_industrial_dry_night.png) | Fixed | The vents' loops are set from the race clock (the same blocker as the crossing). The ship's load, flat colored rectangles, is now stacked containers with lit rims, corrugation and south faces. |
| Steel Circuit, factory rain | [industrial_01_industrial_factory_rain.png](industrial_01_industrial_factory_rain.png) | Fixed | As the dry night. |

**The desert test failure.** `terrain_desert` "fades an overlay from the road only where it
stands over the road or its verge" failed on Canyon Switch (both weathers): two pavement points
were within the fade box of a 13 x 22 px sliver of the north canyon wall's end. The cutter split
pieces near the road only while they were three 16 px cells or more, and judged "near" with the
client's old fade (the car's centre within 26 px). Underneath, the client had since moved to
fading by the car's body plus 18 px, so in the shipped client 46 pieces faded from the road,
not 2. Fixed in the client (fade by the overlay's pixels), in the art (the cutter uses the
client's reach and splits to 32 px; the walls taper where they would lean out within that reach
of the lane) and in the test (it calls the client's own function: no wall, mesa or rock piece
off the road fades for a car in the lane, and any a car at the very edge fades is at most 32 px).

## Sizes

What a race downloads for its course (the course's folder), and with every car sheet and the
four effect atlases (1.60 MB). MB is 1,048,576 bytes. Budget (Section 2, per course): 2.5 MB a
course and 4.5 MB of images for a first race (`tests/unit/terrain_courses.test.ts`); the client's
script adds about 0.74 MB compressed, well inside the 8 MB first-play line.

| Course | Chunks | Ground | Overlays | Loops | Course total | First race images |
| :-- | --: | --: | --: | --: | --: | --: |
| Neon Cut, clear night | 42 | 1660 KB | 37, 9 KB | 7, 3 KB | 1.69 MB | 3.29 MB |
| Neon Cut, rainy night | 42 | 1729 KB | 37, 9 KB | 7, 3 KB | 1.75 MB | 3.35 MB |
| Backstreet Blitz, golden hour | 20 | 897 KB | 12, 4 KB | 7, 24 KB | 0.93 MB | 2.53 MB |
| Backstreet Blitz, rain | 20 | 922 KB | 12, 4 KB | 7, 26 KB | 0.96 MB | 2.56 MB |
| Dust Devil, clear | 54 | 1100 KB | 155, 28 KB | 10, 15 KB | 1.15 MB | 2.75 MB |
| Dust Devil, crosswind | 54 | 1075 KB | 155, 28 KB | 10, 15 KB | 1.13 MB | 2.73 MB |
| Canyon Switch, dry heat | 54 | 1383 KB | 289, 122 KB | 14, 7 KB | 1.53 MB | 3.14 MB |
| Canyon Switch, sandstorm | 54 | 1378 KB | 289, 117 KB | 11, 9 KB | 1.53 MB | 3.13 MB |
| Moss Run, clear | 42 | 1717 KB | 100, 306 KB | 17, 32 KB | 2.03 MB | 3.63 MB |
| Moss Run, rain | 42 | 1706 KB | 100, 306 KB | 17, 31 KB | 2.02 MB | 3.62 MB |
| Timber Dash, clear | 50 | 1910 KB | 126, 342 KB | 4, 7 KB | 2.23 MB | 3.84 MB |
| Timber Dash, heavy rain | 50 | 1877 KB | 126, 342 KB | 6, 14 KB | 2.21 MB | 3.81 MB |
| Whiteout Pass, clear frost | 35 | 658 KB | 85, 144 KB | 11, 9 KB | 0.81 MB | 2.41 MB |
| Whiteout Pass, snowfall | 35 | 693 KB | 85, 157 KB | 11, 11 KB | 0.86 MB | 2.46 MB |
| Steel Circuit, dry night | 20 | 430 KB | 57, 12 KB | 17, 70 KB | 0.52 MB | 2.12 MB |
| Steel Circuit, factory rain | 20 | 456 KB | 57, 12 KB | 17, 70 KB | 0.55 MB | 2.15 MB |

The totals include the manifest (21 to 58 KB) and the minimap (under 1 KB).

## Health of every course

All sixteen: baked by a module of their biome; byte-identical to a fresh bake
(`npx tsx art/scripts/bake-terrain.ts <track> <preset> --check`, run on all sixteen after the
last change); both self-checks zero (no raised art over drivable ground, every ground loop's
first frame equal to the art under it) and recorded with the sha256 of the shipped folder
(`art/manifests/<track>_<preset>.checks.json`); listed in `assets/maps/index.json`, which lists
exactly these sixteen, so a production build offers every course.

## The weather layer on the sixteen

Layers per course as the client reported them in these captures (`wxLayers`), matching
`docs/VFX_GUIDE.md` ("Layers per course"); no page errors on any course. The readability guard
(nothing laid over the picture within the protected zone round the car, a capsule of road ahead
and the rival; the layers over the cars under 8 percent of the car and the road ahead) now runs
on all thirteen courses with weather, not five (`tests/unit/weather.test.ts`). Reduced Motion
and Reduce Flashes, captured on the three heaviest courses: weather sprites 699 to 410 (heavy
rain), 506 to 311 (sandstorm), 779 to 452 (snowfall); the storm's flash count 1 to 0.

## Weak points, frankly

- **Canyon Switch, Dust Devil, Whiteout Pass are the weakest three.** The desert plains are open
  drivable sand where only listed solids may stand up, so between the set pieces they are flat
  ground carried by washes, brush and light, and the weather layer's dust and tumbleweeds in
  motion; Canyon Switch's plateau is the emptiest stretch of the sixteen. Whiteout Pass is large
  white fields with a few dozen trees between the sprint lane, the switchbacks and the pond.
- Canyon walls beside the road still fade in 32 px pieces when a car drives at the very edge (a
  tall face that close to the road is drawn above the car; without depth sorting fading is the
  honest answer). Canyon Switch ships 289 overlays, mostly such pieces.
- Steel Circuit's halls read as streets between buildings; the harbor water is plain.
- Captured on software GL in a desktop browser, not on a phone; reviewed by the developer only.
