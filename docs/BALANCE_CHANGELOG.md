# Balance changelog

Catalog and balance data use semantic versions (`CATALOG_VERSION` in
`packages/content/src/loadout.ts`). Every change to a price, mass, coefficient or track is
listed here with the measurement that motivated it.

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
