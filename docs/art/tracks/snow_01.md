# snow_01 Whiteout Pass: terrain art

World 3520 x 2496 (7 x 5 chunks). Open edges, off-road ground is snow. 6353 px lap: snow 57
percent, ice 25, asphalt 18. Weathers: `snow_clear_frost` and `snow_snowfall`. Module:
`art/scripts/terrain/snow/`, built on the forest kit (`../forest/`: reach, voxels, trees,
placement, road painter, finish).

## Concept

A mountain pass on a crisp blue morning: pale warm-white powder, clear blue-violet shade, long
shadows from low sun; in falling snow the same pass is softer and lower in contrast, fresh snow
on the verges and the edges of the plowed lane (never its middle), heavier snow on every bough.

## Surfaces

| Surface | Look |
| :-- | :-- |
| Asphalt (the plowed sprint lane) | Dark tarmac with salt and slush, white edge lines, yellow dashes; the most contrasting thing on the map. |
| Packed snow (the switchbacks and the climb) | Gray-blue, cooler and darker than the powder off the road, with pairs of blue tire grooves and a white plow berm on the verge. |
| Ice (the frozen pond, road and ground alike) | Cyan, glassy broad tones, patches of hard white glare streaks at one angle; scraped darker and clear on the racing line with a chipped-ice edge, frosted and streaked with snow-snakes off it; crack networks at the `pond_cracks` anchors, skate marks. |
| Soft snow (the Snowmobile Trail's drag hazard) | Lumpy, brighter, with deep sink marks. |

## What is solid

The snow banks along the sprint lane are walls in the data and stand as mounds of real height:
the north bank rises 30 px (its upper part a fading overlay, cut in 110 px pieces so only the
piece by the car fades), the south bank no taller than its own width so its crest meets the
road edge on screen and never hides the road. The 62 pines and firs stand on their discs.

## Landmarks

| Landmark | How it is drawn |
| :-- | :-- |
| Snow gun row | A gun on a tripod post on the north bank's crest at each `snow_guns` anchor station, lamps blinking. |
| Warming hut | The ski lodge's anchor is open drivable ground with no collider, so the pass's warm-windowed log hut stands where the data is solid: set into the north bank, with a smoking chimney. |
| Frozen pond | The ice zone, with cracks, skate marks, glare and blowing snow. |
| Radio relay | A red and white lattice mast with dishes and a light at its anchor (thin furniture). |
| Chairlift | Four pylons (thin furniture) evenly along the `chairlift` anchor's line, and the haul rope with chairs over the infield, above the cars. |

The data once named an ice cave at an anchor on open ground with no collider; a cave cannot be
thin furniture, so it was never drawn. Since Milestone D's finish the fifth landmark is the
chairlift, which is drawn (`landmarks` and the `chairlift` anchor in `tracks/snow01.ts`).

## Loops

Hut chimney smoke, snow-gun lamps, ice glints on the pond (ground loop), blowing snow streaks
across the pond along the wind (the crosswind's visible cue, above the cars), snow sliding off
boughs, birds.
