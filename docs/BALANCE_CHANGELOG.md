# Balance changelog

Catalog and balance data use semantic versions (`CATALOG_VERSION` in
`packages/content/src/catalog.ts`). Every change to a price, mass, coefficient or track is
listed here with the measurement that motivated it.

## 0.4.0 (five chassis, by product-owner decision of October 11, 2026)

The catalog is 105 parts: 5 chassis, 20 engines, 20 wheel kits, 20 weapons, 20 defenses and
20 utilities. Fifteen chassis are gone (Needle, Turtle, Crab, Cobra, Scorpion, Buggy,
Chameleon, Brick, Wagon, Rammer, Drifter, Kangaroo, Horseshoe, Twins, Platform); see
`docs/DECISIONS.md` entry 87. Engines, wheel kits and accessories are untouched. The wire
format did not change, so the protocol is still version 3; a blueprint stamped 0.3.0 is
refused as out of date, and one that names a retired chassis as an unknown part.

The five that remain were reviewed as a set, so that each is clearly best at one thing and
pays for it in a number the garage shows. `tests/unit/catalog.test.ts` ("five chassis, each
with a clear strength and a clear cost") holds every claim in this table to the data.

| Chassis | Price | Mass kg | Load rec / max kg | Mounts | Drag | Yaw | Stability | Integrity | Best at | Cost |
| :-- | --: | --: | :-- | --: | --: | --: | --: | --: | :-- | :-- |
| Beetle | 150 | 250 | 460 / 730 | 5 | 1.00 | 1.00 | 0 | 110 | Cheapest four-wheel frame; the only one with a nose, a roof, a side and a tail mount | Tops no chart |
| Arrow | 180 | 230 | 360 / 600 | 4 | 0.84 | 1.00 | 0 | 95 | Lowest drag by 0.16, so the highest top speed | Fewest mounts, none for a utility pod, smallest four-wheel load limit |
| Pickup | 185 | 390 | 780 / 1200 | 6 | 1.08 | 1.00 | 0 | 122 | Highest load by 150 kg; the largest mount in the game, which takes any part | Heavy and draggy, no nose mount, parts in the bed take 15% more damage |
| Spider | 235 | 420 | 700 / 1050 | 8 | 1.10 | 0.94 | +18 | 115 | Most stable by 18 points; most mounts; the only side mounts | Priciest frame, six wheels cost half again, most drag, slowest steering |
| Trike | 120 | 145 | 280 / 460 | 4 | 1.00 | 1.08 | -16 | 80 | Cheapest and lightest; a wheel kit costs a quarter less | Least stable, weakest, smallest load limit |

Changes from 0.3.0, each kept modest:

| Chassis | Value | 0.3.0 | 0.4.0 | Why |
| :-- | :-- | :-- | :-- | :-- |
| Arrow | Load rec / max | 420 / 680 | 360 / 600 | "Little room for equipment" was a 50 kg difference from the Beetle that nobody would notice. Now 130 kg. |
| Arrow | Integrity | 100 | 95 | A light wedge should not be as tough as the Beetle (110) for the asking. |
| Arrow | `roof_mid` | 12 x 14 at y 2 | 10 x 18 at y 0 | The railgun (8 x 18) lost its only homes with the Needle. The Arrow's spine is the one place it fits lengthwise; 10 wide keeps the box 2 px clear of the front wheel wells. Turrets and other 12 x 12 parts go on `roof_rear`. |
| Pickup | Mass | 365 | 390 | "Heavy hauler": the frame itself now weighs clearly more than the ordinary two. |
| Pickup | Load rec / max | 690 / 1080 | 780 / 1200 | It carried less than the Spider (1150). It now carries the most, by 150 kg. |
| Pickup | Drag | 1.07 | 1.08 | With the mass, the cost of the bed. |
| Pickup | Mounts | 8: hood, two sill pods, two bed racks, two rails, tailgate | 6: cab roof, bed rack, two rails, bed floor, tailgate | Six tiles fit the garage. The hood mount sat on top of the engine, which stands through the hood, and is gone with the two sill pods; a small `roof_cab` mount (14 x 10) replaces them. |
| Pickup | `bed_front` | UTILITY, 18 x 14, holds two | UNIVERSAL, 18 x 12, holds two | The rack behind the cab takes any two small parts, not only utilities. |
| Pickup | `bed_rear` | UTILITY, 18 x 14, holds two | UNIVERSAL, 18 x 16, holds one | The bed floor is the largest mount in the game and takes any one part. It is the only home of the Arc Mortar (16 x 16), which lost all of its mounts with the retired frames. |
| Spider | Load rec / max | 760 / 1150 | 700 / 1050 | So the Pickup, not the Spider, is the hauler. The Spider still carries 320 kg more than the Beetle. |
| Trike | Drag | 0.94 | 1.00 | Low drag is the Arrow's alone. This also answers the open question below: Tiny Trouble no longer matches the Straight-Line Rocket in the dry (106.6 s against 104.5 s, was 105.5 s against 104.5 s) for two thirds of the price. |

Not changed: every price, the Beetle in full (its handling bench and Section 6.5 targets are
untouched: 0 to 60 MPH 3.97 s, 84.6 MPH, Neon Cut 120.7 s dry), the Spider's and the Trike's
stability figures, and all wheel anchors, body bounds and engine bays. With the retired
frames went their one-off rules: the reduced armor allowances of the Needle and the Buggy,
the Horseshoe's any-weapon cavity and the Crab's and Scorpion's aim overrides. The rules
that read them are still in `packages/shared` and are still tested as data; no chassis uses
them. Every accessory still fits at least one mount of at least one frame.

Shipped blueprints. Baseline and Rookie are unchanged. The starters are now one for each
chassis: Rookie (Beetle), Sprinter (Arrow, unchanged), Packhorse (Pickup), Longlegs (Spider)
and Tinker (now a Trike). Of the six example builds, four are as Section 11.9 lists them;
Sticky Turtle is replaced by Iron Mule (Pickup, Four-Cylinder, Armored Tires, Arc Mortar, Oil
Slick, Energy Shield, Repair Kit), and Back-Alley Trap moves from the Scorpion to the Beetle
with the same engine, tires and parts.

Measured on Neon Cut with the centerline driver, three laps, clear night and rainy night
(`npx tsx tests/feel/buildsReport.ts`; `tests/unit/docs.test.ts` fails if this table and the
simulator disagree):

| Build | Cost | Mass kg | Stability | Dry race s | Dry best lap s | Dry top MPH | 0 to 60 s | Rain race s | Rain top MPH | Peak slip dry / rain | Peak heat dry | Low power s dry | Walls dry / rain |
| :-- | --: | --: | --: | --: | --: | --: | --: | --: | --: | :-- | --: | --: | :-- |
| Baseline Beetle | 370 | 393 | 76 | 120.7 | 39.1 | 84.6 | 3.97 | 125.4 | 84.5 | 10.4 / 9.9 | 45 | 0.0 | 0 / 0 |
| Rookie | 480 | 456 | 68 | 122.4 | 39.5 | 84.1 | 4.67 | 127.5 | 84.0 | 10.4 / 9.5 | 45 | 0.0 | 0 / 0 |
| Sprinter | 560 | 459 | 70 | 110.7 | 35.8 | 95.8 | 3.40 | 117.2 | 95.6 | 10.9 / 10.3 | 38 | 0.0 | 0 / 0 |
| Packhorse | 710 | 742 | 80 | 121.5 | 38.8 | 88.1 | 5.93 | 127.6 | 87.8 | 10.3 / 9.4 | 73 | 0.0 | 0 / 0 |
| Longlegs | 735 | 756 | 100 | 122.2 | 39.0 | 87.6 | 6.07 | 128.3 | 87.3 | 10.2 / 9.2 | 73 | 0.0 | 0 / 0 |
| Tinker | 565 | 370 | 48 | 115.9 | 37.8 | 88.9 | 3.13 | 120.6 | 89.0 | 12.5 / 12.0 | 94 | 0.0 | 0 / 0 |
| Straight-Line Rocket | 725 | 549 | 71 | 104.5 | 33.7 | 101.1 | 3.10 | 116.8 | 100.2 | 11.4 / 10.1 | 63 | 0.0 | 0 / 0 |
| Iron Mule | 920 | 812 | 69 | 135.5 | 43.0 | 79.5 | 9.20 | 142.5 | 78.9 | 9.8 / 9.0 | 45 | 0.0 | 0 / 0 |
| Dust Spider | 763 | 761 | 100 | 132.5 | 42.6 | 79.4 | 6.60 | 138.5 | 79.2 | 9.5 / 8.7 | 63 | 0.0 | 0 / 0 |
| Rain Runner | 715 | 517 | 66 | 120.3 | 39.3 | 84.9 | 3.07 | 120.8 | 84.9 | 10.3 / 10.1 | 57 | 99.3 | 0 / 0 |
| Back-Alley Trap | 630 | 526 | 66 | 118.4 | 38.3 | 87.6 | 3.97 | 123.8 | 87.4 | 10.5 / 9.7 | 54 | 0.0 | 0 / 0 |
| Tiny Trouble | 479 | 317 | 49 | 106.6 | 34.6 | 98.4 | 2.67 | 112.9 | 98.3 | 12.9 / 13.2 | 75 | 0.0 | 0 / 0 |

What the table says:

- The six example builds span 104.5 to 135.5 s dry and 112.9 to 142.5 s in rain, top speeds
  79 to 101 MPH, launches 2.67 to 9.20 s and stability 49 to 100.
- The five starters, one a chassis, are spread the way their frames promise: the Sprinter is
  quickest (110.7 s, 95.8 MPH), the Tinker next and the least stable of them (48), Longlegs
  cannot be tipped (100), and the Packhorse carries 742 kg at the pace of the stock Beetle on
  a V6.
- Iron Mule is the slowest and heaviest example, as Sticky Turtle was (135.5 s, 812 kg, 9.20 s
  to 60 MPH). Its armor, shield and mortar are not scored by this bench: combat arrives in
  Milestone C.
- No build touched a wall in either condition.

## 0.3.0 (Milestone B: the full catalog and the engineering model)

All 120 parts now carry data: 20 chassis, 20 engines, 20 wheel kits, 20 weapons, 20 defenses
and 20 utilities. Ids, names, prices and masses are the Section 11 tables. Everything else is
a seed value chosen here; `docs/DECISIONS.md` items 37 to 60 list what was chosen and why.
Protocol version 3.

New in the simulation: per-part mass and position (centre of mass, stability), engine torque
curves and engine runtime state, heat, energy, overload, and tire grip per surface per kit.

The default Beetle (Four-Cylinder, Street Tires, no parts) is unchanged: 0 to 60 MPH 3.97 s,
top speed 84.6 MPH, Neon Cut 120.7 s dry and 125.4 s in rain, the same as 0.2.0, and the
0.2.0 handling bench passes with its limits untouched.

Measured on Neon Cut with the centerline driver, three laps, clear night and rainy night
(`npx tsx tests/feel/buildsReport.ts`; `tests/unit/docs.test.ts` fails if this table and the
simulator disagree). Top speed is the highest reached in the race. Peak heat is on a scale
where performance falls from 90. Low power is seconds spent short of electricity.

| Build | Cost | Mass kg | Stability | Dry race s | Dry best lap s | Dry top MPH | 0 to 60 s | Rain race s | Rain top MPH | Peak slip dry / rain | Peak heat dry | Low power s dry | Walls dry / rain |
| :-- | --: | --: | --: | --: | --: | --: | --: | --: | --: | :-- | --: | --: | :-- |
| Baseline Beetle | 370 | 393 | 76 | 120.7 | 39.1 | 84.6 | 3.97 | 125.4 | 84.5 | 10.4 / 9.9 | 45 | 0.0 | 0 / 0 |
| Rookie | 480 | 456 | 68 | 122.4 | 39.5 | 84.1 | 4.67 | 127.5 | 84.0 | 10.4 / 9.5 | 45 | 0.0 | 0 / 0 |
| Sprinter | 560 | 459 | 70 | 110.7 | 35.8 | 95.8 | 3.40 | 117.2 | 95.6 | 10.9 / 10.3 | 38 | 0.0 | 0 / 0 |
| Bulldog | 695 | 786 | 86 | 123.6 | 39.5 | 87.8 | 6.33 | 130.2 | 87.4 | 9.9 / 8.9 | 72 | 0.0 | 0 / 0 |
| Tinker | 650 | 527 | 71 | 125.4 | 40.4 | 82.7 | 5.53 | 130.5 | 82.5 | 10.3 / 9.3 | 45 | 0.0 | 0 / 0 |
| Straight-Line Rocket | 725 | 549 | 71 | 104.5 | 33.7 | 101.1 | 3.10 | 116.8 | 100.2 | 11.4 / 10.1 | 63 | 0.0 | 0 / 0 |
| Sticky Turtle | 700 | 811 | 72 | 135.7 | 43.1 | 79.5 | 9.20 | 142.5 | 79.0 | 9.6 / 8.7 | 45 | 0.0 | 0 / 0 |
| Dust Spider | 763 | 761 | 100 | 132.5 | 42.6 | 79.4 | 6.60 | 138.5 | 79.2 | 9.5 / 8.7 | 63 | 0.0 | 0 / 0 |
| Rain Runner | 715 | 517 | 66 | 120.3 | 39.3 | 84.9 | 3.07 | 120.8 | 84.9 | 10.3 / 10.1 | 57 | 99.3 | 0 / 0 |
| Back-Alley Trap | 660 | 586 | 64 | 119.8 | 38.7 | 87.1 | 4.47 | 125.2 | 87.0 | 10.4 / 9.6 | 54 | 0.0 | 0 / 0 |
| Tiny Trouble | 479 | 317 | 49 | 105.5 | 34.3 | 100.1 | 2.67 | 112.1 | 99.9 | 13.1 / 13.4 | 75 | 0.0 | 0 / 0 |

What the table says:

- The six example builds span 104.5 to 135.7 s dry and 112.1 to 142.5 s in rain, top speeds
  79 to 101 MPH, launches 2.67 to 9.20 s and stability 49 to 100.
- Straight-Line Rocket loses 12.3 s in rain; Rain Runner loses 0.5 s and spends most of the
  race short of power, as Section 11.9 describes both.
- Sticky Turtle and Dust Spider are slow by design. They carry armor and weapons that this
  bench cannot score, because combat arrives in Milestone C.
- **Open balance question (answered in part in 0.4.0).** Tiny Trouble costs 479 credits and
  is within a second of the 725-credit Rocket in the dry and faster in the rain. Its stated price is fragility and
  instability (49, below its chassis threshold), which a lone car on a clean line never
  pays. It needs looking at again once damage and opponents exist. No value was tuned to
  hide it.
- No build touched a wall in either condition.

Tuning done while building the model, each against a failing test: diesel top-end factor
0.76; hybrid curve flattened; rocket launch factor 0.6; spring engine burst 1.5 and launch
0.25; Ice Spikes rolling resistance on road +6; Drift Tires slip stiffness 0.6; Chameleon and
Buggy mounts resized so the specified parts fit.

## 0.2.0 (handling rework after the Milestone A review)

Motivation: the product owner found the car jumpy and sometimes too sensitive. The handling
bench (`npx tsx tests/feel/report.ts`, output in `docs/evidence/feel`) showed why. Numbers are
for the default Beetle on dry asphalt unless stated.

| Coefficient                    | 0.1.0                         | 0.2.0                                      |
| :----------------------------- | :---------------------------- | :----------------------------------------- |
| `MAX_STEER_CURVATURE`          | 1/46                          | 1/52 requested, about 1/66 driven          |
| High-speed steering limit      | `STEER_HALF_SPEED` 215        | `STEER_GRIP_DEMAND` 1.3 x lateral grip     |
| Grip sensitivity of steering   | full (cap tracked grip)       | `STEER_GRIP_SENSE` 0.6                     |
| `STEER_OVERDRIVE`              | 1.22                          | removed                                    |
| `STEER_RELEASE_TIME`           | 0.18 s                        | 0.16 s                                     |
| `YAW_RESPONSE_TIME`            | 0.055 s                       | 0.06 s                                     |
| `YAW_ALIGN_GAIN`               | none                          | 2.5 per second                             |
| Tire curve                     | full grip, then a step to 82% | smooth knee, fade to `KINETIC` 0.86        |
| Speed lost to cornering        | always, plus 16% when sliding | none below 0.2 rad slip, full by 0.5 rad   |

| Measure                                              | 0.1.0            | 0.2.0            |
| :--------------------------------------------------- | :--------------- | :--------------- |
| Full lock held from top speed: peak slip             | 40.2 degrees     | 12.2 degrees     |
| Full lock held from top speed: speed after 3 s       | 104 of 270 px/s  | 272 of 270 px/s  |
| Full lock step: worst yaw overshoot                  | 25.8%            | 12.2%            |
| Slow sweep at top speed: lateral acceleration step   | 81.7 px/s2/tick  | 3.6 px/s2/tick   |
| Path response to +10% stick (1.0 is proportionate)   | up to 1.86       | 0.30 to 1.00     |
| Thumb twitch (full lock 0.15 s): heading change      | up to 30.9 deg   | up to 25.8 deg   |
| Slalom lag, stick to yaw                             | 167 ms           | 100 ms           |
| Parking-speed turning radius                         | 47.6 px          | 61.6 px          |
| 0 to 60 MPH                                          | 3.97 s           | 3.97 s           |
| Top speed                                            | 84.5 MPH         | 84.5 MPH         |

Neon Cut with the centerline driver, default Beetle, clear night: 120.7 s (was 123.7 s; laps
41.2, 39.1, 39.1; window 105 to 140 s; 0 wall strikes). The car is slightly quicker because
cornering inside the grip limit no longer bleeds speed. Rainy night: 125.4 s. Arrow 116.4 s,
Turtle 128.4 s, Spider 128.4 s. A driver who only points the direction stick at the road 0.6 s
ahead and never brakes on purpose: Beetle 119.2 s, 0 wall strikes.

Section 6.5 targets after the change: 0 to 60 MPH and top speed are untouched, wall strike
loss is untouched, and "steering settle 0.18 s" is read as the wheel filter (decision 32).

## 0.1.0 (Milestone A)

Seed values, taken from Sections 6.3, 6.4, 9.2 and 11.2 to 11.4 wherever the specification
gives them.

- Chassis: Beetle 150 credits / 250 kg, Arrow 180 / 230 (drag -16%), Turtle 215 / 460
  (integrity +35%, yaw -12%), Spider 235 / 420 (six wheels, stability +18).
- Engine: Four-Cylinder 140 / 95 kg, force index 100.
- Tires: Street 80 per four / 48 kg, grip 1.00.
- Default loadout costs 370 credits.

Handling constants tuned against the Section 6.5 targets, measured by `tests/unit/physics.test.ts`:

| Target                 | Specification | Measured                       |
| :--------------------- | :------------ | :----------------------------- |
| 0 to 60 MPH            | about 4 s     | 3.97 s                         |
| Top speed, dry asphalt | 70 to 95 MPH  | 84.5 MPH                       |
| Steering settle        | 0.18 s        | above 80% of lock at 0.18 s    |
| Wall strike speed loss | 8 to 20%      | enforced by constants and test |

Neon Cut, measured with the centerline driver in `tests/unit/track.test.ts`:

| Measure                                | Value                                                |
| :------------------------------------- | :--------------------------------------------------- |
| Lap length                             | 9,756 world pixels                                   |
| Race time, default Beetle, clear night | 123.7 s (target window 105 to 140 s)                 |
| Laps                                   | 42.2 s, 40.1 s, 40.1 s                               |
| Wall strikes by the reference driver   | 0                                                    |
| Rainy night                            | slower by more than 3 s, still under the 180 s limit |

Not yet measured: the time Lantern Alley saves or costs. That needs a driver that takes the
shortcut and is scheduled with the bot harness in Milestone D.
