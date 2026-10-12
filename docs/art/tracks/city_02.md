# city_02 Backstreet Blitz: terrain art plan

World 2432 x 2048 (5 x 4 chunks of 512). Walled, 5913 px lap, asphalt 60 percent, cobble 40.
Weathers: `city_clear_day` and `city_rain_day`. Painter: `art/scripts/terrain/city/blitz/`.

## Concept

Neon Cut is a navy and neon night downtown. Backstreet Blitz is the older city next to it: low
and dense brick and plaster tenements, fire escapes, laundry strung over alleys, shop awnings,
cobbles, tram rails under catenary wires and warm sodium lamps.

- **Clear: golden hour, about forty minutes before sunset.** The preset is a day preset (its
  `timeOfDay` is `day`, which the garage uses for solar heat), so the picture stays daylight,
  but late: a low warm sun from the west-north-west, which is exactly the baker's upper-left key
  light, so the long cast shadows of the oblique solids fall the way the sun does. Roofs and
  west walls catch peach and ochre light, south walls and the street canyons sit in cool
  blue-violet shade, the first sodium lamps and shop windows are on. That reads unmistakably
  different from Neon Cut's night at a glance (value: light roofs over darker streets, instead of
  dark roofs over a lit road) while the road stays the stage.
- **Rain: an overcast wet afternoon.** Cooler and grayer, everything wet: dark saturated
  asphalt, glossy cobbles, puddles in the gutters and low spots, reflections of lamps, shop
  windows and signs stretched down the wet road as broken vertical streaks.

## Districts, from the start line round the lap

1. **The boulevard** (south straight, eastbound, asphalt, 132 wide): the widest street. Plane
   trees and the eight `boulevard_lamps` on the north sidewalk side, shopfronts with awnings
   along both banks, a bus shelter, zebra crossings, painted arrows. The start gantry is the
   track's own banner portal over the grid.
2. **Signal Street** (north up the east side): the tram crossing. Rails run east-west across the
   road along the `tram_line` anchor, under catenary wires (an overlay that fades); a yellow
   hatched keep-clear box marks exactly where the boom comes down; stop lines either side;
   two-arm boom gate and the twin red lights from the hazard's `a`, `b` and `lights`; the tram
   stop platform with its shelter at the west end of the rails, by Laundry Lane.
3. **The market jog** (short cobble north at x 1417): the traffic light anchor, market stalls in
   the yard behind.
4. **The east loop** (asphalt): warehouses and the harbor edge. The **harbor silos** stand east
   of the track, the tallest masses on the map, with a quay and water at the east edge.
   The billboard anchor gets a hand-painted hoarding.
5. **Old town** (the cobbled north-west, through the **old town gate**): an arched gatehouse
   spanning the road at the bollards (towers on solid ground, arch as a fading overlay), the cafe
   awning, older buildings with pitched tile roofs, darker brick.
6. **The jink and Bakers Row** (left side): the main road jinks round the **clock market**, a
   cobbled square in the infield with a clock tower and a fountain; Bakers Row runs straight
   down beside it, narrow, three red and white barricades on their hazard stripes.
7. **Laundry Lane** (the shortcut from the boulevard to behind the tram stop): a narrow cobbled
   alley between tall walls, crates at both bends, laundry lines strung across it (overlays that
   fade near the player).

## Readability

Lane dashes and edge lines on asphalt, curb stripes at the corners from the runtime's corners,
chevron boards at every `track.cornerSigns` entry, gold threshold bands at both shortcut mouths
and a named sign board, hazard stripes on the barricades and on the ground under each
`warning` anchor. Shortcuts are cobbled and darker between tall walls (risky), but their mouths
are bright.

## Where height goes

Tenements of three to six storeys along the banks, taller on the north banks (their south walls
face the road), lower on the south banks (they lean over it on screen and are capped by the
baker). The tallest things: the silos (east), the clock tower (infield), the gatehouse towers.

## Animations (all loops)

Tram crossing lights and boom on the crossing's timetable, the tram itself crossing during the
active phase, flickering shop sign, the clock market fountain, laundry swaying, traffic light.

## As built (October 12, 2026)

Painter `art/scripts/terrain/city/blitz/` (style, plan and landmarks, road, hazards, dressing).

| Weather | Ground | Overlays | Loops | Total | Bake |
| :-- | --: | --: | --: | --: | --: |
| `city_clear_day` (golden hour) | 20 chunks, 897 KB | 12, 4 KB | 7, 24 KB | 953 KB | 55 s |
| `city_rain_day` | 20 chunks, 922 KB | 12, 4 KB | 7, 26 KB | 980 KB | 65 s |

Bake times are on the shared machine under load; checks 0 and 0 on both.

- **Hazards.** The crossing: rails along the rail path through the blocks and across Signal
  Street, a gold keep-clear box hatched over the barrier, stop lines, two striped posts at the
  barrier's ends, two light masts with crossbucks at the `lights` anchors; one timetable loop
  (`timetable:tram_crossing`, 5 fps, 70 frames) lowers the two-arm boom through the warning,
  holds it down for every frame touching the active phase, raises it after; the lamps wig-wag
  through warning and active. Barricades: red and white blocks standing exactly on their
  capsules, hatched tapers in front of each on the closed side of Bakers Row, an amber blinker
  on each. Crates and gate bollards inside their collision discs.
- **Shortcuts.** Coursed dark setts with a drain channel, gold thresholds at both mouths, green
  street-name boards at the mouths, laundry strung across Laundry Lane (one line animated).
- **Landmarks.** Clock market square with a brick clock tower (dial at twenty to seven), a
  fountain and a statue, market stalls round it and in the strip between Bakers Row and the
  jink; the old town gatehouse (towers with tiled caps, tiled gatehouse over the street as a
  fading overlay); four harbor grain silos and a headhouse; the tram stop with a waiting tram.
- **Loops.** Crossing (timetable), market neon flicker, traffic light, laundry sway, three
  barricade blinkers.

Representative previews: `art/preview/terrain/city_02_city_clear_day/frames/sheet.png`,
`.../crop_clock_market.png`, `.../crop_tram_stop.png`, `.../crop_old_town_gate.png`, the same
under `city_02_city_rain_day/`; in game: `tests/visual/out/urban/city_02_*_race_*.png`.

Weak spots, frankly: the city is busier than Neon Cut and some rooflines repeat (the city
layout's rectangles); the gatehouse arch opening barely reads at game scale; the laundry over
the lane reads as bunting; the cobbles are a busy texture over 40 percent of the lap; no tram
moves (a moving tram over a 14 s loop does not fit a texture, and the barrier lies along the
rails, so it would overlap a stopped car); the crossing loop only matches the barrier once the
client drives it from the race clock (DECISIONS).
