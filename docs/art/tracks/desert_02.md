# desert_02 Canyon Switch: terrain art plan

World 4480 x 3072 (9 x 6 chunks of 512). Open track: off the road is drivable sand inside the
boundary wall. 9108 px lap, asphalt 67 percent, sand 33. Weathers: `desert_dry_heat` and
`desert_sandstorm`. Painter: `art/scripts/terrain/desert/` (`canyonSwitch.ts` dresses this
track; `lands.ts` holds its land).

## Concept and light

A bleached plateau, a sandy descent, and a canyon: the road runs down from the windy top of
the map into S-bends at the foot of a tall banded cliff, then switches back up the east slope
behind a guard rail.

- **Dry heat: high noon.** The sun nearly overhead (short shadows, `drop` 7), the palette
  bleached toward bone and cream (the grade lifts 12 percent toward warm white and takes a
  fifth of the saturation out), pale caliche on the graded road. Big calm flat areas on the
  plateau and the tarmac, which is what the client's heat haze reads best over; three faint
  shimmer strips by the plateau straight.
- **Sandstorm: dim ochre.** The same land through a storm: 30 percent ochre fog, darker and
  lower in contrast, weak brown shadows, broad slow shadows of airborne dust over everything,
  sand fingers creeping over the verges and the outer dozen pixels of the tarmac (never the
  lane), flags and the sock straight out toward the west-south-west, blowing sand ribbons. The
  picture is posterized a little further (channels in steps of six) so every chunk keeps one
  palette.

## What the physics says, and what that allows

Solids: the boundary (`canyon_rim`), five canyon walls (`cliff`), the switchback's guard rail
and 16 rocks. The rule is the same as Dust Devil's: if it looks solid it is solid.

- **North canyon walls** (`north_wall_a`, `north_wall_b`) face south, toward the camera: they
  are tall (120 to 165 world px), banded in strata at fixed heights, fissured, streaked with
  desert varnish from the rim. Their foot is in the ground layer on their own capsule; their
  face above the upland behind them is an overlay, cut into pieces whose fade boxes never
  reach the road, so driving the canyon never fades the cliff.
- **South walls** (`south_wall_a`, `_ledge`, `_b`) are the canyon's near rim: they face away
  from the camera, so they are drawn only as high as their own rock allows (a rugged ridge),
  and never over the road.
- The canyon floor next to the walls is a scree apron in the walls' deep shade; the floor and
  the low south lie a step darker than the bleached upland. That contrast, not raised ground,
  is what makes the canyon read as deep: every reachable pixel is drawn at ground level,
  because the car is.

## Round the lap, from the start

1. **The plateau straight** (asphalt, westbound, the start): checkered start line, painted grid
   boxes, the **start banner**. Plateau rocks on the north side (one carries a coral **wreck**),
   orange and red **flags** along the south edge, the **radio mast** (a guyed lattice mast in
   red and white bands, blinking lamps) to the south. The west half lies under blown sand
   (`plateau_drift`), across the whole road.
2. **The descent** (graded sand, south down the west side): pale caliche with wheel tracks and
   berms, descent rocks, the land falling south (hill light, rills down the slope).
3. **The canyon S-bends** (asphalt, east): the tall north cliff, the rim to the south, curbs,
   chevrons. At the middle S the **canyon arch**: its south leg fell long ago (the ledge's
   fallen rock); its span still leans out from the cliff over the road, high enough to drive
   under, an overlay with its shadow on the tarmac. At the last S the **painted cliff**:
   chevrons painted on the cliff face at the corner.
4. **The switchback** (asphalt with a sand hairpin, north up the east slope): the **guard rail**
   (galvanized beam on posts, red reflectors) on the drop side; beyond it the land falls into a
   darker gully; the **watchtower** (a lookout cabin on stilts) inside the bend; a wind sock on
   the crest's crosswind zone.
5. Back up onto the plateau. The **ore hopper** (rusted, on a timber trestle) stands in the
   infield.

## Shortcut: Ledge Run

A narrow sand shelf along the foot of the canyon's south rim: rock-dust sand with rubble, one
wheel track, the rim beside it, a falling-rock warning at its mouth (the anchor) and a route
board before it, and the two fallen rocks on it. Discoverable (it leaves the canyon at a
chevroned corner, signed) and visibly risky (narrow, rocks, the rim).

## Landmarks (the `landmarks` list)

Plateau radio mast, canyon arch, switchback watchtower, rusted ore hopper, painted cliff; mesas
close the map behind the rim, tallest in the north beyond the plateau.

## Animations (all loops)

Six plateau flags, the mast's two lamps, two blowing-sand ribbons from the plateau, the crest's
wind sock, and (dry heat) three heat shimmer strips.
