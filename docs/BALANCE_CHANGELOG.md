# Balance changelog

Catalog and balance data use semantic versions (`CATALOG_VERSION` in
`packages/content/src/loadout.ts`). Every change to a price, mass, coefficient or track is
listed here with the measurement that motivated it.

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
