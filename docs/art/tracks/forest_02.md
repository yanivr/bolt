# forest_02 Timber Dash: terrain art

World 4928 x 2240 (10 x 5 chunks). Open edges, off-road ground is dirt. 9179 px lap: asphalt 47
percent, dirt 45, mud 8. Weathers: `forest_clear` and `forest_heavy_rain`. Module:
`art/scripts/terrain/forest/timberDash.ts`, sharing the forest kit with Moss Run.

## Concept

A logging operation in old-growth redwood. Two long straights, each broken by a chicane round
giant trunks, the north one paved and quick, the south one a dirt haul road with mud in its
ruts. Clear: deep cool greens and cinnamon trunks in long shafts of sun. Heavy rain: dark,
saturated, overcast light with soft shadows, glossy mud, standing water in every track and
run-off streaming across the infield into the brook.

## What is solid

As on Moss Run, only the data's solids stand in the ground layer: 191 tree discs, the four
giant redwoods (radius 34 and 22) and the two log piles on the Logging Spur. Everything above
car height over drivable ground is a fading overlay.

## Landmarks

| Landmark | How it is drawn |
| :-- | :-- |
| Giant redwoods | The four largest obstacles: fluted cinnamon trunks with buttresses to the full collision radius, crowns of flat drooping sprays. They stand on the far side of each chicane from the road, so they may rise tall without hiding it. |
| Sawmill | The anchor stands on open drivable ground with no collider, so the mill is its yard: trodden sawdust and bark chips, soft sawdust heaps, skidder tracks and narrow-gauge cart rails, all flat ground. |
| High-lead spar | The obstacle tree nearest the yard, topped and rigged, its cables running down to the yard above the cars. |
| Fire lookout | A timber cab on four thin trestle legs at its anchor; the legs are thin furniture like a sign's posts (not colliders), the cab is above car height. |
| Timber stacks | The landing at its anchor: a second sawdust and bark yard. The two log piles on the spur (obstacles) are stacked logs within their discs. |
| Log flume | A shallow pebbled brook along the anchor line that a car splashes through; wider in heavy rain, fed by run-off channels. |

## Surfaces and shortcut

Asphalt north, dirt south and on the Logging Spur, mud in the haul road's two rut zones (dark,
glossy, water in the ruts), and the spur's muddy dip (a drag hazard on dirt) drawn as boggy
dirt: darker, churned and wet, but still dirt, because the surface is. Chevron boards at both
chicanes' sign anchors and at every corner sign; the spur's name board at its mouth.

## Trees

Coast redwoods (72 percent) and Douglas firs. Redwoods rise up to 250 units; on the near (south)
side of a road they are grown lower until their crowns reach at most 10 px into the pavement,
so the long straights read as walls of trunks without a crown lying across the racing line.

## Loops

Birds over the woods, falling leaves at both `leaf_fall` anchors (above the cars), water
flowing in the brook, and rain rings in the yards' puddles in heavy rain.
