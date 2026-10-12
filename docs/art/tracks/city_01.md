# city_01 Neon Cut: terrain art notes

World 3584 x 2688 (7 x 6 chunks). Clear night (`city_clear_night`) is the approved bake and
must stay byte-identical (`npx tsx art/scripts/bake-terrain.ts --check`).

## Rainy night (`city_rain_night`): plan

Same city, same buildings, same props: the layout is planned from the track's first weather,
so every weather of a track shares its city plan. Then the wet pass:

- Ground and walls a step darker and more saturated; roofs keep a cold sheen on their lit rims.
- Puddles along the gutters (just inside the edge line, never over the kerb) and in a few low
  spots away from the racing line, shaped by a deterministic noise field; their rim is lit,
  their body mirrors the dark sky.
- Reflections: every lit thing near the road (lamp heads, neon signs, shop windows, the start
  gantry's banner) reflects into the wet road below it as a short stack of broken vertical
  streaks in its own color, stronger in the puddles, never covering a lane marking.
- Lamp pools become tighter and glossier (a wet road reflects instead of scattering).

## Rainy night as built (October 12, 2026)

42 chunks, 1729 KB of ground, 37 overlays (9 KB), 7 loops (3 KB), 1796 KB in all; bake 37 to
137 s on the shared machine (the wet pass adds about 15 s); checks 0 and 0. The clear night
is still byte-identical (`--check`). Previews: `art/preview/terrain/city_01_city_rain_night/`
(`frames/sheet.png`, `game_start_line_car.png`); in game:
`tests/visual/out/urban/city_01_city_rain_night_race_*.png`.

Weak spots: the reflections under rows of shopfronts can read as a barcode of warm blocks;
glints are a uniform speckle; roofs get only the wet tone (no roof puddles); the overlays are
toned by color alone, so a few lit pixels on them dim with the rest.
