# desert_01 Dust Devil: terrain art plan

World 4352 x 2944 (9 x 6 chunks of 512). Open track: off the road is drivable sand everywhere
inside the boundary wall. 8642 px lap, sand 57 percent, asphalt 43 (the validator's measure).
Weathers: `desert_clear` and `desert_crosswind`. Painter: `art/scripts/terrain/desert/`
(`dustDevil.ts` dresses this track; `lands.ts` holds its land).

## Concept and light

A bean of big sweepers laid across open desert: half graded sand road, half bleached two-lane
tarmac, with the desert blowing back over the tarmac on the inside of its bends.

- **Clear: golden afternoon.** A low warm sun from the west-north-west, the baker's upper-left
  key light, so long violet shadows run south-east off every rock, cactus, tower and mast
  (`drop` 3). Warm, saturated orange dune sand; terracotta rock. This is deliberately the
  opposite of Canyon Switch's bleached noon: from the first frame the two desert tracks read as
  different places, and the long shadows give a flat, open map most of its sense of height.
- **Crosswind: the same afternoon through blown dust.** The same light (the grade adds six
  percent of dust haze), but the wind of the preset (12, 70 px/s: toward the south-south-east)
  is written into the sand: ripples lie across it, fingers of sand stream off the road's verges
  and over the tarmac's edges inside the crosswind zones, sand tails run downwind from every
  rock, the socks stand straight out to the south-south-east and flutter fast, tumbleweeds roll
  south, the dust devils lean.

## What the physics says, and what that allows

The only solids are the boundary wall (`mesa_cliff`) and 26 rocks. Everything else is drivable
sand, so the art follows one rule: **if it looks solid it is solid.** Rock, cacti, the wreck,
tire stacks and the arch's feet stand only on obstacle discs; a mesa only on the unreachable
land behind the boundary. Everything that stands on open sand stands on open legs a car can
pass between (the windmill, the water tank, the billboard, sign posts, socks), and is drawn in
an overlay above the cars that fades near the player. Landforms (dunes, the dip, the rise) are
light and texture on the flat ground, never raised art. Drivable ground is never hidden by
raised art in the ground layer: the bake proves it from the picture (`coveredDrivable` 0).

## Round the lap, from the start

1. **The southern arc** (graded sand road, westbound, the start): pale packed sand with two
   pairs of wheel tracks, washboard ripples across the straights, a windrow berm and white
   painted stones along each edge. The start: a checkered mat on the sand, grid boxes in stone
   white, and the **start banner** (checkered deck with the name on two lattice legs over the
   road). The **bleached billboard** (Dusty's Diner, 12 miles) on the inside; arc boulders, two
   of them dressed as **rusted wrecks** against a rock; the arc's wind sock.
2. **The west climb** (asphalt, north): dark bleached tarmac, white edge lines with reflector
   studs, yellow center line (dashed, doubled through bends), red and white curbs on the tight
   corners, thermal cracks and tar snakes. **Drifted sand** (`west_drift`) lies over the inside
   half of the sweeper: the dunes' own sand, rippled across the wind, its edge in wind-blown
   fingers that keep within a few pixels of the zone's shape. Saguaros and **Joshua trees**
   stand on the climb's cactus discs.
3. **The dip** (sand road, the V into the infield): the land falls into a basin, shown by its
   light and by dry rills running down its slopes. **Dry Wash** leaves to the east across the
   top of the dip (below).
4. **The northern rise** (asphalt, east): the **windmill** and its **water tank** on the north
   side, the rise's wind sock, the second drift (`rise_drift`) on the inside.
5. **Devil's Elbow** (asphalt, the tight left-right): rubble ground, a named board, chevron
   boards at its corner signs, **tire stacks** (white-topped) on two of the elbow's rocks, and
   the sand blown right across the road out of the elbow (`elbow_sand`), back onto the arc.

## Shortcut: Dry Wash

A dry riverbed: pale silt with braided flow lines, cut banks and cobbles at its edges, a route
board at the mouth. The soft-sand hazard is churned, lumpy, deep-rutted and a step darker,
drawn from the hazard's own shape. Rocks line both banks, and the **rock arch** springs from two
of them (`wash_rocks_n_2`, `wash_rocks_s_2`, beside the `rock_arch` anchor) and spans the wash:
its legs stand inside those rocks' discs, its span is high enough to drive under and is an
overlay that fades near the player. It is discoverable (a bright bed and a board off the dip)
and visibly risky (soft sand, rocks, narrow).

## Landmarks (the `landmarks` list)

Twin mesas (tall buttes closing the two northern corners, on the unreachable land behind the
boundary), wind pump (windmill and tank), bleached billboard, rock arch, dust devil flats (a
pale silt playa in the infield with two dust devils turning on it).

## Open ground

Dry washes from the track's seed (eight) wander down the fall of the land with gravelly beds and
lit and shaded banks, stopping short of the road's verge (never pale and smooth, so they cannot
be read as the graded road); creosote and sage grow in stands of up to five clumps, thicker along
the washes; dune slip faces lie a full step darker than their crest lines. The infield and the
flats remain open plain by design: only listed solids may stand up there.

## Wind and hazards

Crosswind zones: the southern arc and the northern rise carry the two wind socks (anchors),
the verges' wind fingers, and, in the crosswind preset, sand over the tarmac's edges inside the
zones. Sock reach and flutter rate come from the preset's wind speed; their direction from its
wind vector.

## Animations (all loops)

Two wind socks, the windmill's wheel (its rate from the wind), two dust devils on the flats,
two tumbleweeds rolling downwind across the tumbleweed path, three heat shimmer strips beside
the arc (fainter in crosswind).

## Height

Boulders are faceted solids inside their discs; cacti and Joshua trees rise into overlays; the
arch is a slab of the height field (solid from its underside to its top), with light under it
and an arch-shaped shadow; mesas behind the boundary rise to 135 world px in the corners.
