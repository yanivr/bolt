# Balance changelog

Catalog and balance data use semantic versions (`CATALOG_VERSION` in
`packages/content/src/catalog.ts`). Every change to a price, mass, coefficient or track is
listed here with the measurement that motivated it.

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
- **Open balance question.** Tiny Trouble costs 479 credits and is within a second of the
  725-credit Rocket in the dry and faster in the rain. Its stated price is fragility and
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
