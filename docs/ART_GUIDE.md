# Art guide

How BOLT RIVALS art is made, what the rules are, and what still needs a human eye. Section 12
to 14 of the specification are the requirements; this file is the working practice.

## Principles

- True top-down orthographic. Height is shown with bevels, cast shadow and light, never with
  drawn building sides or a horizon.
- Upper-left key light everywhere. Shadows shift toward blue-violet, highlights toward warm.
  No pure gray, no pure black.
- Pixels are either fully opaque or fully clear in bodies, wheels and engines. Soft effects
  (glows, shadows, the headlight pool) use a few fixed alpha steps, never a gradient.
- The road is the stage. Environment detail stays lower in contrast than road edges, kerbs and
  painted markings.
- Nothing is copied. The reference images in `references/` informed camera height, road width
  on screen and overall density only.

## Pipeline

`pnpm art` runs `art/scripts/build-art.ts`. Everything is deterministic: seeded hashes only,
no clock, no `Math.random`. A second bake produces byte-identical files, and `pnpm art:check`
fails if committed car atlases differ from the pipeline's output.

| Stage                       | Code                        | Output                                         |
| :-------------------------- | :-------------------------- | :--------------------------------------------- |
| Pixel toolkit and PNG codec | `art/scripts/lib/pixels.ts` | indexed PNG when 256 colors or fewer           |
| Sprite modeller             | `art/scripts/lib/model.ts`  | any model at any heading                       |
| Cars, wheels, engines       | `art/scripts/cars/*`        | `apps/web/public/assets/atlases/cars`          |
| Core effects                | `art/scripts/vfx/core.ts`   | `apps/web/public/assets/atlases/vfx_core`      |
| Combat effects              | `art/scripts/vfx/*`, `art/scripts/bake-vfx.ts` | `apps/web/public/assets/atlases/vfx_combat` |
| Damage and frost overlays   | `art/scripts/vfx/damage.ts` | `apps/web/public/assets/atlases/vfx_damage`    |
| Terrain                     | `art/scripts/terrain/*`     | `apps/web/public/assets/maps/<track>/<preset>` |
| Review sheets               | written by the build        | `art/preview/` (not committed)                 |

Manifests are written next to the assets and copied to `art/manifests/` for diffing. Their
types live in `packages/shared/src/assets.ts`, so the baker and the renderer cannot drift.

### The sprite modeller

A part is described once as a stack of top-down solids. Each solid has an outline (a signed
distance shape), a height profile (flat, rounded or linear bevel) and a material ramp of five
steps. Decals recolor or shade parts of a solid: stripes, panel gaps, glints, rivets.

For each heading the modeller supersamples every pixel, finds the tallest solid, shades it
from its surface normal against the fixed light, quantizes to the ramp, marches toward the
light for a cast shadow, and finally draws a selective outline that takes the color family of
the part it borders (lighter on the lit side). Because rotation happens in the model and not
on a bitmap, all sixteen frames agree with each other and nothing shimmers or stretches.

### Mounted parts

The 60 weapons, defenses and utilities are built with the small kit in
`art/scripts/cars/parts/kit.ts` and drawn through `renderPartFrame`
(`art/scripts/cars/parts/frame.ts`), which the baker and the review tool share. What makes a
part read on a car at 3x on a phone (DECISIONS 102):

- **Larger than its base.** Write the model at the catalog footprint, front toward negative
  Y, and finish it with `k.done(id, cell, { scale })`: weapons about 1.15, the rest about
  1.1. Then push the one shape that names the part past that by hand: the barrel, the lance,
  the rails, the blade. A part with a free facing stands on a square base (the smaller side
  of its footprint) in the rules, so the overhang is legal.
- **One signature shape a weapon.** The comment above each function in `weapons.ts` names it.
  If two weapons could be confused in silhouette, one of them is wrong.
- **Direction.** The business end is toward negative Y and carries the warmest, brightest
  accent. A part with a fixed facing (mine, oil, rear guard, saw, side shields) is modelled
  the same way and turned by the rules.
- **Separation from the body.** Part frames get a near-black cool outline all the way round
  and an opaque one-pixel contact shadow down and to the right; do not add either by hand.
  Weapon metal (`gunmetal`, `iron`) is lighter and cooler than every paint midtone. Check a
  new part on all four paints: an amber drum disappears on Sunflare, a blue box on Cobalt.
- **Height.** Nothing stands more than 16 authored units above its mount once finished (a
  Tesla Arc is 15.8, a radar dish 16.1 at its rim). The garage overview has exactly that much
  room over the Spider's roof on a 370 pixel phone before the floor cuts the part.
- **Anchors.** Call `k.muzzle(x, y, z)` once per barrel at the middle of its mouth, and
  `k.pivot` for a head that turns. They are scaled with the model and written to the manifest.
- **Tags.** Keep the Section 13.4 tags on the solids the combat milestone animates.
- **Cell.** Even, with at least two clear pixels at every heading:
  `npx tsx art/scripts/preview-parts.ts --check` prints the margin of every part, checks that
  every anchor lies on its drawing, and fails otherwise.

Review with `npx tsx art/scripts/preview-parts.ts` (or with part ids for one sheet). It
renders on the five real chassis with their mounts and mount heights: `_review_*.png` (each
part alone at 5x, its icons, on a car at 3x on all four paints, at true size, and at 5x),
`_mounted_*_3x.png`, `_icons_*_4x.png` and `_loaded_<chassis>_4x.png` (every mount filled).
Ask of each: can I name it from the 3x picture, can I tell which way it points, does it stand
off the body on every paint, does the loaded car still look like a car.

Icons (32 and 24 px) are rendered from the same models by `art/scripts/lib/icon.ts`, which
frames each one from its true on-screen box so the longer side fills the tile.

### Vehicle layers and the compositor

Every car is built at runtime from separate sheets: shadow, one wheel sprite per anchor, body,
engine, headlights, brake lights. `layoutCar` in `packages/shared/src/compose.ts` is the single
function that decides which frame of which sheet goes where for a pose. The race, the home
turntable and the pipeline's review sheets all call it.

- Body sheets: 16 headings, 96 x 96 cells, baked in a paint key ramp.
- Wheel sheets: 32 directions by 3 roll phases, 20 x 20 cells, so front wheels can show steering
  between body headings.
- Engine sheets: 16 headings, 40 x 40 cells, drawn at the chassis engine anchor.
- Anchors (wheels, engine, exhausts, lights) are chassis-local points in the manifest.

Paint is an exact palette swap from the key ramp at load time. No other material may contain a
key color; the build throws if one does.

### Combat effects

The 101 strips of the combat atlas are drawn by the kit in `art/scripts/vfx/kit.ts` and packed
into one indexed sheet with two pixels of padding (`pack.ts`); `docs/VFX_GUIDE.md` is the full
reference. What matters when drawing one:

- **Clusters, not circles.** `cloud` draws the union of a few lobes with a coherent noisy edge,
  quantized into the hard bands of a ramp and eroded in two-pixel cells as it dies. A fireball,
  a smoke blossom, a puddle and a splat are the same routine with different lobes and ramps.
- **Direction is baked.** `directional` draws a sprite once per heading from a shape written in
  its own space (`u` forward, `v` right), sampled at pixel centres. Nothing is rotated as a
  bitmap, in the baker or in the game. Solid colors get a one-pixel outline; colors passed
  through `glow()` (flames, trails) do not.
- **Alpha.** Opaque or clear, except light on the road, marks on the road and shadows, which
  use fixed steps. A test enforces it per strip.
- **Read on asphalt.** The road is a dark blue-gray. Dark things need a light edge (smoke has a
  pale top and a dark rim, oil a lit rim and sheen); bright things need a dark or saturated
  edge (fire ends in maroon, not in yellow).
- **Overlays come from the body sheets.** `damage.ts` traces each opaque body pixel back to the
  car's own space and asks a pattern defined there, so marks stay put on the car at every
  heading. Rebake them after any change to a chassis body.

Review a strip with `npx tsx art/scripts/vfx/montage.ts out.png 3 <id> ...`, the bake's sheets
in `art/preview/vfx`, and then in motion with the tools in `docs/VFX_GUIDE.md`.

### Terrain

The baker computes the corridor field once from the same `buildTrack` runtime the physics
uses, so the visible solid edge is exactly where collision is. A biome painter (`city/`)
draws surfaces, kerbs, sidewalks, rooftops, landmarks and props, then lighting is applied in
hard posterized steps and the result is cut into chunks. Foreground overlays and looping
ambient strips are separate files with world positions in the manifest.

#### City styles (Backstreet Blitz)

The city painters read the shared palette (`PAL`), the six roof families (`ROOFS`,
`BUILDINGS`) and the build weights (`ROOF_WEIGHTS`) when they draw. A track other than Neon Cut
recolors them for the length of one bake with `withCityStyle` (`city/palette.ts`); Neon Cut
never applies one, so its clear night stays byte-identical (`npx tsx
art/scripts/bake-terrain.ts --check`). Layout density (`LayoutOptions`), roof dressing and fire
escapes (`BuildingStyle`), and street furniture (`StreetOptions`) are optional parameters whose
defaults are Neon Cut's. Every weather of a track shares one city plan: the painter seeds the
plan from the track's first weather (`citySeed`), so rain only changes the look.

Backstreet Blitz (`city/blitz/`) is golden hour in the clear: the low sun stands where the
baker's key light does (upper left), roofs and west walls are warm, shadows long and blue
(`Scene.resolve(3)`), lamps a faint warm lift. Its plan, landmarks, road, hazards and dressing
are placed from the track's anchors, hazards and corner signs, never from arc lengths written
in the painter.

#### The industrial biome

`terrain/industrial/` paints Steel Circuit with the city's oblique machinery under an
industrial style: the layout cuts works lots out of the ground (bigger lots, wider service
roads), and each lot becomes a sawtooth shed, a ridged hall with a lit monitor, a plant house
with pipes and a stack, a tank farm or a container yard. The two halls are found from the
stretches of plate that hold their hazards; the road runs between tall bays under roof trusses
(small fading overlays, each with a mercury lamp). Light: sodium on the yard roads, cold
mercury in the halls, molten orange from the furnace.

Hazards are painted on exactly the shapes the physics stamps into its 8 px zone grid
(`shapeTest`, `hazardCell`), in colors nothing else on the floor uses, and flagged self-lit so
no lamp, shadow or wet pass shifts them: segmented cyan bars on magnetic strips, a glossy spill
with a wandering edge and a lit rim for oil (the edge wanders at most 9 px either side of the
shape), round grates in a yellow and black ring for steam vents. A test checks every zone cell
of every hazard is marked.

#### Wet variants

`city/wet.ts` turns a finished bake wet; every rain preset uses it (`WET_NIGHT`, `WET_DAY`,
`WET_FACTORY`). Nothing moves, so the art still matches the physics:

- every pixel that is not self-lit takes the wet tone (darker, cooler, more saturated on cool
  colors only, so warm stone goes glossy rather than brown); bright paint and lamps keep their
  value, so lane markings stay the most readable thing on the road;
- puddles from a deterministic noise field in the gutters (between the edge line and the kerb)
  and a few low spots, drivable ground only, never over paint; a dark near lip, a lit far edge,
  the sky in the middle with a ripple;
- reflections: each self-lit thing standing north of a stretch of wet road is mirrored below
  the edge it stands on, stretched two to one, in its own hue at three fixed strengths, broken
  into blocky vertical streaks (one column in three dark, dashes phased per three columns);
  street lamps add a glare streak down the road;
- a `dry` mask keeps covered floors dry (Smelter and Press Hall).

Loops drawn fresh go through the same tone (`wetLoops`, using the world's own self-lit flags,
so frame 0 still matches) and so do overlays (`wetOverlays`). The client's rain, splashes and
moving reflections go on top; the lamp list (`lights`) doubles as their reflection anchors.

#### Timetable loops

A loop whose `kind` is `timetable:<hazardId>` follows that hazard's timetable
(`city/timetable.ts`): it is exactly one period long (`frameCount / fps` is `periodSeconds`)
and frame `k` shows race time `[k / fps, (k + 1) / fps)` from GO, modulo the period. The client
must pick its frame from the race clock, `floor((raceSeconds mod period) * fps)`, and show
frame 0 before GO (the clock reads 0 there). Frames are opaque over their whole box (the ground
is copied in), the boom is down in every frame that touches the active phase, and the settled
quiet frames equal the baked ground (checked by the bake). Long loops are packed in a grid
(`AnimatedArt.columns`) so no sheet is wider than 4096 px; the client slices a sheet row by
row, so the manifest entry does not change.

#### Reviewing a bake

`npx tsx art/scripts/bake-terrain.ts <track> <preset>` writes crops to
`art/preview/terrain/<track>_<preset>/`, and `npx tsx art/scripts/preview-terrain-frames.ts
<track> <preset> [count]` composes game-camera frames (870 x 390 world pixels, the `Close` step
on the owner's phone) round the lap and on every shortcut from the shipped files, with a car on
the road and overlays faded the way the client fades them (`frames/sheet.png`).

#### The forest and snow biomes

`terrain/forest/` paints Moss Run and Timber Dash, `terrain/snow/` Whiteout Pass; snow imports
the forest kit, so the two biomes share one way of standing things up and one light.

- **Drivable means reachable.** On an open track a car may leave the road anywhere, so the
  painters do not use the corridor as "drivable": `forest/reach.ts` rasterizes the physics'
  wall capsules and obstacle discs, floods the free car centres from the road and grows them
  by a car's radius. The scene is built on that mask, so the guard (`coveredDrivable`) holds
  for the whole map, not just the road.
- **Only what is solid stands.** Trunks, stumps, log piles, banks and rails stand on their own
  collision shapes; buildings stand only on ground no car can reach (the mill in the pond) or on
  a wall (the warming hut in the snow bank). Where a landmark's anchor is open ground with no
  collider, the landmark is drawn as flat ground (a sawdust yard), moved onto the nearest solid
  (the ranger's treehouse), or as thin furniture on legs no wider than a sign's posts (the fire
  lookout, the relay mast, lift pylons), and the track doc says which.
- **Everything above drivable ground is a fading overlay**, cut in tiles of 176 px near the
  road and 640 px far from it, so the client fades only the trees round the car.
- **Voxels for volume.** `forest/voxel.ts` builds trees, buildings and props in one-pixel voxels
  around their ground anchor and draws them in the baker's own oblique view (rise `TILT`, lean
  one pixel east per three of rise), splatting surface voxels front to back, shading each from
  its normal against the upper-left sun with a hard self shadow, in fixed ramps. Crowns are
  lobes covered in leaf clumps whose normals lean toward their lobe's, plus a crown-scale form
  term, so every clump catches light and the crown still reads as one mass.
- **No copies.** Every obstacle tree is built from its own seed (size, lean, lobes, hue ramp).
  Only the background woods in the unreachable margin share sixteen recipes per species.
- **The racing surface stays visible.** A tree on the near side of a road is regrown shorter
  until its picture reaches at most 10 px into the pavement (26 px for the four giant
  redwoods across the chicanes from the road).
- **Weather is light.** Rain, heavy rain, frost and snowfall are a grade on the finished colors
  (ground, overlays and loop frames together) plus shadow length and strength; the wet ground
  (puddles, glossy ruts, run-off) and fresh snow are painted from the preset's `wetness`.
- **Surfaces read apart.** Each physics surface has one look (slate asphalt with white edge
  lines, tan dirt with soft wheel tracks, near-black glossy mud with water in its ruts, gray-blue
  packed snow with tire grooves, cyan glassy ice with glare streaks); `tests/unit/terrain_nature.test.ts`
  measures the median color of each along the route and holds every pair apart.
- **Review**: `npx tsx art/scripts/terrain/forest/review.ts <track> <preset> [frames]` writes
  870 x 390 game-camera frames round the lap and on the shortcut, from the shipped files, with
  a car and the client's overlay fade, to `art/preview/terrain/<track>_<preset>/route_*.png`.

## The chassis list

The game ships five chassis by product-owner decision (`docs/DECISIONS.md` entry 87): Beetle,
Arrow, Pickup, Spider and Trike. They are registered in `art/scripts/cars/registry-chassis.ts`
and are the only ones baked. The models of the fifteen retired frames are kept, unbaked, in
`art/scripts/cars/chassis/retired` (see the README there). Each chassis states the height of
the bodywork under every one of its mounts (`mountHeights`); `npx tsx
art/scripts/preview-chassis.ts <name>` prints any that are missing and draws the mount boxes
on the car in `art/preview/chassis/<name>_mounts_4x.png`.

## Adding a chassis

1. Add its definition (price, mass, wheel anchors, mounts, limits) to `packages/content`.
2. Model it in `art/scripts/cars/` as solids and decals, in chassis-local pixels with the
   front at negative Y. Give it one unmistakable identity mark that reads at any heading.
3. Register it in `registry-chassis.ts`, give it `mountHeights`, run `pnpm art -- --cars`, and review `art/preview/cars`:
   `lineup_3x.png` for the whole car, `silhouettes_3x.png` for shape alone.
4. `pnpm test` checks frames, cell margins, anchors and the paint key.

## Review status (Milestone A)

Reviewed at game size and enlarged by the developer only. Section 21 is explicit that code
cannot vouch for its own taste, so these are open until a person signs them off:

| Asset                                                        | State                         | Notes                                                                         |
| :----------------------------------------------------------- | :---------------------------- | :---------------------------------------------------------------------------- |
| Beetle, Arrow, Pickup, Spider, Trike bodies                  | Awaiting product-owner review | The five chassis the game keeps (DECISIONS 87). Fifteen retired models are in `art/scripts/cars/chassis/retired`, unbaked |
| Street wheel kit                                             | Awaiting review               | Tread reads at 4x; subtle at game size                                        |
| Four-Cylinder engine layer                                   | Awaiting review               | Same sprite on all four frames for now                                        |
| Neon Cut clear night                                         | Awaiting review               | See known weak spots below                                                    |
| Core effects (smoke, sparks, skids, headlight pool)          | Awaiting review on hardware   | Only stills reviewed; motion needs a real device                              |
| 60 mounted parts, hero pass (DECISIONS 102)                  | Awaiting product-owner review | Reviewed by the developer in `art/preview/parts`. Weakest: Heat Guard, Traction Computer, Turret Computer, Composite Shell, Decoy Drone |
| Combat effects atlas, 20 weapon identities, damage and frost overlays | Awaiting product-owner review, and review on hardware | Reviewed by the developer only, in scenario captures (`tests/visual/out/combat`) and the software review renderer. Weakest: the mortar's column, the boomerang, the saw's teeth, charge lights, the tesla bolt at short range |
| Rain variant, other biomes                                   | Not started                   | Milestone D. The wet road scenario is drawn on the clear-night bake            |
| Moss Run, Timber Dash, Whiteout Pass, both weathers each     | Awaiting product-owner review | Forest and snow biomes; reviewed by the developer in route frames and in the client. See the track docs in `docs/art/tracks/` for what has no collider and is therefore not drawn solid |
| Neon Cut rainy night, Backstreet Blitz (both), Steel Circuit (both) | Awaiting product-owner review | Reviewed by the developer in game-camera frames only; weak spots in `docs/art/tracks/` |

Known weak spots in Neon Cut, from the terrain bake's own review:

- Cobblestone reads as cobble but leans toward brickwork.
- Lamp pools overlap busily where the two switchbacks run close together.
- Lamp posts read as a light and a pool more than as an object.
- Rooftop clutter repeats one air-conditioner motif too often.
- Sky-bridge windows can read as road paint from above.
- Harbor water is plain.
- Zebra crossings, billboard positions and preview crops are placed by arc lengths written in
  the city painter; a second city track needs them moved into track data.
