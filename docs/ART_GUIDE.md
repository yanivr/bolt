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
