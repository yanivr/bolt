# forest_01 Moss Run: terrain art

World 3584 x 2752 (7 x 6 chunks). Open edges, off-road ground is dirt. 7138 px lap: asphalt 49
percent, dirt 31, mud 20. Weathers: `forest_clear` and `forest_rain`. Module:
`art/scripts/terrain/forest/` (`index.ts` shared steps, `mossRun.ts` this track).

## Concept

Old broadleaf woodland round a mill pond on a bright, still day; in the rain the same wood is
darker, more saturated and wet, with water standing in every rut. The road is the stage: a
slate country road with white edge lines and yellow dashes across the north, pale compacted
dirt down the south, near-black glossy mud in the shaded east bends, on the marsh edge and all
along the Marsh Track.

## What is solid, and therefore what may stand

On an open track a car may drive anywhere inside the boundary that is not a wall or an
obstacle, so every pixel within a car's radius of a reachable centre counts as drivable
(`forest/reach.ts`, the same capsules and discs the physics pushes against). Only what the data
makes solid stands up in the ground layer: the 122 trees on their collision discs, the five
marsh stumps, the four reed tussocks, the bridge rails, the creek and pond banks, and the
water inside them (no car can reach it). Everything raised over drivable ground (crowns, the
upper trunks, the bridge portals, the reeds on the banks) is a foreground overlay the client
fades when the car is near it.

## Landmarks

| Landmark | How it is drawn |
| :-- | :-- |
| Mill bridge | The asphalt deck continues the road (the physics surface is asphalt); boarded verges, timber rails extruded on the two rail walls, a timber portal at each end whose beam crosses over the road (overlays: the car passes under them). |
| Mill and water wheel | A stone and whitewashed timber mill house standing in the pond at the `water_wheel` anchor (inside the pond wall, unreachable), mossy slate roof, chimney, boardwalk to the west shore, a moored rowboat, its reflection; the undershot wheel turns (8-frame loop, foam at the paddles). |
| Hollow oak | The tree obstacle nearest the anchor, grown to a 1.3x crown, with a dark hollow in the trunk facing the camera. |
| Ranger hut | No collider stands at the hut's anchor, so the hut is built where one does: a treehouse lookout with a ladder in the crown of the nearest obstacle tree (141 px from the anchor). |
| Mushroom ring | Flat glowing caps in a ring of richer grass at the shady corner (a car may cross it), with a glow loop and butterflies. |

## Surfaces, water, shortcut

- Asphalt: cool slate with clustered texture, wheel polish, white edge lines inset 6 px, yellow
  dashes; the verge is gravel with muddy run-wide ruts.
- Dirt: warm tan, broad soft wheel tracks, pebbles; puddles in the tracks when wet.
- Mud (zones and the Marsh Track): dark smooth base, deep wandering ruts half full of water
  with a glossy lip on the lit side, pools between them; deeper and wetter on the marsh's deep
  mud hazard. Zone borders are drawn where the physics' 8 px cells are, roughened by at most 4 px.
- Water: found from the data (unreachable ground enclosed by `water_edge` walls), painted by
  depth from the shore, an organic shore band of moss, mud flat and rushes inside the water,
  reflections of the woods below north shores, ripples along the creek's flow, lily pads.
- Marsh Track: wetland floor either side (sodden moss, sedge, shallow pools), stumps and reed
  tussocks on their obstacles, a name board at its mouth.
- Shaded bends: canopy shadows across the road, roadside mist (static, two hard steps).

## Trees

Oaks (three hue ramps), birch clumps of two to four white stems, alders near the water, every
one built from its own seed (`forest/trees.ts`): a voxel trunk whose root flare covers exactly
the collision disc, limbs, and a crown of lobes covered in leaf clumps lit from the upper left
with a hard self shadow; dappled ground shadows down-sun. A crown that would lie across the
pavement on the near side of a road is grown lower until it reaches no more than 10 px in. The
margin outside the boundary wall is dense woods from sixteen shared recipes per species.

## Loops

Water wheel, creek sparkle above and below the bridge, pond sparkle, ducks, bridge runoff
foam, mushroom glow (ground loops cut from the finished picture, frame 0 equal to it); birds
over the pond and butterflies at the ring (above the cars).
