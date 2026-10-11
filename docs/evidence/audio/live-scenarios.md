# Scenarios in the real client

Each showcase scenario played in the production build in headless Chromium, read from the audio system's own log (`window.__boltAudio`). The node counts are the audio system's ledger of live Web Audio nodes: before the race, and after leaving it. No person has listened.

The per-frame audio update (engine and tire parameters, no node creation) took 0.146 ms on average over 3088 frames, worst 30.50 ms, on this machine under software rendering; a frame at 60 Hz is 16.7 ms.

| Scenario | Voices started | Most at once (cap 20) | Most music voices (cap 16) | Engine and tire nodes (cap 72) | Nodes before | Nodes after |
| :-- | --: | --: | --: | --: | --: | --: |
| `emp_burst` | 8 | 3 | 9 | 39 | 18 | 18 |
| `flame_frost` | 21 | 5 | 8 | 37 | 18 | 18 |
| `frost_thaw` | 25 | 7 | 11 | 37 | 18 | 18 |
| `kinetic_impact` | 17 | 5 | 8 | 37 | 18 | 18 |
| `mine_sweeper` | 12 | 3 | 10 | 37 | 18 | 18 |
| `missile_defense` | 20 | 4 | 12 | 42 | 18 | 18 |
| `mortar_strike` | 10 | 3 | 8 | 42 | 18 | 18 |
| `oil_fire` | 13 | 5 | 9 | 42 | 18 | 18 |
| `ram` | 6 | 4 | 9 | 43 | 18 | 18 |
| `repair_burst` | 10 | 3 | 9 | 37 | 18 | 18 |
| `rocket_hit` | 9 | 4 | 12 | 37 | 18 | 18 |
| `shield_break` | 40 | 7 | 11 | 42 | 18 | 18 |
| `weapon_air` | 4 | 2 | 9 | 37 | 18 | 18 |
| `weapon_boomerang` | 9 | 3 | 8 | 37 | 18 | 18 |
| `weapon_emp` | 6 | 2 | 8 | 37 | 18 | 18 |
| `weapon_flame` | 14 | 4 | 9 | 37 | 18 | 18 |
| `weapon_foam` | 7 | 2 | 9 | 37 | 18 | 18 |
| `weapon_front_mg` | 12 | 5 | 10 | 37 | 18 | 18 |
| `weapon_frost` | 8 | 3 | 8 | 37 | 18 | 18 |
| `weapon_hammer` | 7 | 5 | 9 | 37 | 18 | 18 |
| `weapon_harpoon` | 10 | 5 | 9 | 37 | 18 | 18 |
| `weapon_homing` | 8 | 3 | 8 | 37 | 18 | 18 |
| `weapon_mine` | 8 | 4 | 9 | 37 | 18 | 18 |
| `weapon_mortar` | 9 | 3 | 9 | 42 | 18 | 18 |
| `weapon_oil` | 7 | 2 | 9 | 37 | 18 | 18 |
| `weapon_railshot` | 7 | 4 | 9 | 37 | 18 | 18 |
| `weapon_rear_mg` | 20 | 5 | 8 | 37 | 18 | 18 |
| `weapon_rocket` | 6 | 4 | 8 | 37 | 18 | 18 |
| `weapon_saw` | 8 | 3 | 9 | 42 | 18 | 18 |
| `weapon_shotgun` | 5 | 3 | 9 | 37 | 18 | 18 |
| `weapon_tesla` | 5 | 4 | 8 | 37 | 18 | 18 |
| `weapon_turret` | 16 | 4 | 9 | 37 | 18 | 18 |
| `wet_road` | 13 | 4 | 12 | 37 | 18 | 18 |
