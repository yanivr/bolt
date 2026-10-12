# industrial_01 Steel Circuit: terrain art plan

World 2496 x 1984 (5 x 4 chunks). Walled, 6498 px lap, metal 46 percent, asphalt 40, cobble 13.
Weathers: `industrial_dry_night` and `industrial_factory_rain`. Module:
`art/scripts/terrain/industrial/` (new biome).

## Concept

A steelworks at night. Big volumes with real height, built with the same oblique solids as the
city (roof, lit west wall, shaded south wall, cast shadow volume): long halls with sawtooth and
ridged roofs, cylindrical tanks, a water tower, chimney stacks, gantry cranes, pipe racks,
container stacks, a conveyor bridge, a dock with water and a ship's hull edge. Light is the
industrial mix: orange sodium on the yard, cold green-white mercury vapor inside the halls, the
molten orange of the smelter, and hazard paint everywhere it matters.

- **Dry night:** dark blue-steel ground, plate floors with rivet lines, sodium pools, beacons.
- **Factory rain:** darker and wetter: puddles in the yard's low spots and along the hall walls,
  wet plate glints, reflections of lamps and the smelter glow as broken streaks.

## Districts, following the lap

1. **The yard road and the start** (north straight, asphalt): lamp masts, a gatehouse, parked
   trailers, the start gantry.
2. **Press Hall** (the metal wriggle): the road runs inside a hall: hall walls along the solid
   edges, roof trusses spanning the road as fading overlays, presses with animated pistons
   beside the road (the `press_pistons` anchors), the two pillars on the road (painted with
   hazard bands), the two **magnetic strips** across its corners in a distinct cyan-steel
   segmented pattern with chevrons pointing along the road.
3. **The yard** (south of Press Hall, asphalt): container stacks, the **gantry crane** over the
   infield, pipe racks.
4. **Conveyor Gap** (shortcut, metal plate): passes under the **conveyor bridge** (overlay,
   animated belt), between two pillars with hazard stripes and a warning sign at its mouth.
5. **The dock** (cobble, east side): quay setts, bollards, the dock crates, water to the east with
   a ship's hull edge alongside.
6. **Smelter Hall** (south straight, metal): the hot end. The molten glow (anchor) inside the
   hall, the **smelter stacks** south of it, two **steam vents** as round grates with yellow and
   black warning rings, steam on the vents' timetable, warning lamps; **oil**: glossy dark pools
   with a lit rim and a sheen exactly where the oil band and the oil circle are.
7. **The west side** (asphalt): the **water tower**, rail sidings.

## Readability

Plate floors are lighter and cooler than asphalt; edge lines in yellow on plate; chevron boards
at every corner sign; hazard paint follows the data exactly (every hazard zone is drawn on the
pixels the physics uses, from `groundAt`).

## Animations

Steam vents on their timetable (hiss and blast), warning lamps, beacons on the stacks and the
crane, conveyor belt, press pistons, smelter glow flicker, welding sparks, oil sheen.

## As built (October 12, 2026)

Module `art/scripts/terrain/industrial/` (style, road and hazards, structures, landmarks, anim).

| Weather | Ground | Overlays | Loops | Total | Bake |
| :-- | --: | --: | --: | --: | --: |
| `industrial_dry_night` | 20 chunks, 428 KB | 57, 12 KB | 17, 70 KB | 532 KB | 82 s |
| `industrial_factory_rain` | 20 chunks, 454 KB | 57, 12 KB | 17, 70 KB | 558 KB | 85 s |

Checks 0 and 0 on both. Factory rain keeps both halls' floors dry.

- **Hazards.** Magnetic strips: segmented cyan bars over the exact band, a running-light loop.
  Oil: a glossy spill with a wandering edge, lit rim and curling sheen, a sheen loop. Steam
  vents: round grates in a yellow and black ring; per vent three timetable loops on its
  schedule (steam above the cars: wisps through the warning, a column while active; the ring
  flashing hot on the ground; the warning lamp at its anchor sweeping). Pillars in Press Hall
  with hazard bands; the gap's pillars carry the conveyor bridge; crates, the barrel.
- **Landmarks.** Press Hall and Smelter Hall (tall bays either side, trusses with mercury
  lamps over the road), the furnace whose mouth glows into Smelter Hall, two chimney stacks with
  beacons, the gantry crane over a container yard, the conveyor bridge over Conveyor Gap, the
  water tower, the dock with a quay conveyor, lamps and a ship alongside.
- **Loops.** Steam (2), vent rings (2), warning lamps (2), magnet marks (2), oil sheen (2),
  stack beacons (2), furnace flicker, welding sparks, quay conveyor, press rams (2), crane light.

Representative previews: `art/preview/terrain/industrial_01_industrial_dry_night/frames/sheet.png`,
`.../crop_smelter_vents.png`, `.../crop_conveyor_gap.png`, `.../crop_press_hall.png`; rain under
`industrial_01_industrial_factory_rain/`; in game: `tests/visual/out/urban/industrial_01_*`.

Weak spots, frankly: the halls read as roads between tall buildings with trusses more than as
interiors; works buildings are city-layout rectangles and some sheds repeat; the plate floor's
mercury pools are still a little spotty; the chimneys lean as far east as everything tall does,
which on thin stacks looks like a tilt; the water is plain; the gantry crane is small at game
scale; the steam and vent loops only match the hazard once the client drives them from the race
clock (DECISIONS).
