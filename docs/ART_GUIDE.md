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

### Terrain

The baker computes the corridor field once from the same `buildTrack` runtime the physics
uses, so the visible solid edge is exactly where collision is. A biome painter (`city/`)
draws surfaces, kerbs, sidewalks, rooftops, landmarks and props, then lighting is applied in
hard posterized steps and the result is cut into chunks. Foreground overlays and looping
ambient strips are separate files with world positions in the manifest.

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
| Damage states, 20 weapon effects, rain variant, other biomes | Not started                   | Milestones C and D                                                            |

Known weak spots in Neon Cut, from the terrain bake's own review:

- Cobblestone reads as cobble but leans toward brickwork.
- Lamp pools overlap busily where the two switchbacks run close together.
- Lamp posts read as a light and a pool more than as an object.
- Rooftop clutter repeats one air-conditioner motif too often.
- Sky-bridge windows can read as road paint from above.
- Harbor water is plain.
- Zebra crossings, billboard positions and preview crops are placed by arc lengths written in
  the city painter; a second city track needs them moved into track data.
