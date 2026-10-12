# The tow study

How the tow table (`TOW` in `packages/shared/src/balance.ts`) was chosen. Every row is one
setting of the table, measured on the same races: Neon Cut, clear night, seeds 1001, 8920,
16839 and 24758, sparring brain against sparring brain. For each setting:

- **Armed**: the eleven shipped builds, every pairing, both grid slots, every seed (440 races).
- **Upgrade test** (target 4, `tests/balance/upgrade.ts`): six shipped builds against the same
  build with one upgrade (Rookie Four-Cylinder to V6, Sprinter V6 to V8, Packhorse V6 to V8,
  Sprinter, Tinker and Back-Alley Trap Street Tires to Slicks), armed, both slots, every seed
  (48 races). The column lists the upgraded twin's share of wins in that order.
- **Unarmed**: the same 440 pairings with weapons taken off and their weight left in, to see
  what the tow does to pace alone: whether the winner with the tow off still wins with it on,
  the gap at the line, and changes of the lead by a car that had any tow in the second before.

Measure: `npx tsx tests/balance/towStudy.ts <label> '<json of TOW fields to change>' out.json 4`;
table: `npx tsx tests/balance/towReport.ts off.json a.json b.json ...`. Rows are deterministic: the
chosen row is reproduced to the decimal by the report in `tow-0.6.0-clear.md`.

Settings marked "reference" are outside the brief (a threshold inside weapon reach, a bonus over
8 percent). They were measured only to show what more would cost.

| Setting | threshold / engage / full s | bonus | ramp up / down per s | 1. Lap 1 leader wins | 2. Builds outside 30 to 70% | 3. s within 220 px a race | 3. Activations a race | 3. Damage a race | 4. Upgraded twin wins, each pair | Within 1.5 s | Beyond 3 s | Lead changes a race | Passes with tow, armed | Unarmed: off winner still wins | Unarmed: gap at finish s, off to on | Unarmed: passes with tow |
| :-- | :-- | --: | :-- | --: | :-- | --: | --: | --: | :-- | --: | --: | --: | --: | --: | :-- | --: |
| Tow off (reference) | n/a | off | n/a | 96% | 6: Rookie 25%, Sprinter 90%, Straight-Line Rocket 100%, Iron Mule 0%, Dust Spider 10%, Tiny Trouble 80% | 12.6 | 4.5 | 57 | 100% 63% 100% 50% 100% 50% | 16% | 67% | 0.21 | 0 | 440 of 440 | 12.68 to 12.68 | 0 of 68 |
| C, chosen and shipped: 1.0/1.15/2.5, 8% | 1 / 1.15 / 2.5 | 8% | 0.5 / 1 | 93% | 6: Rookie 23%, Sprinter 90%, Straight-Line Rocket 100%, Iron Mule 0%, Dust Spider 10%, Tiny Trouble 80% | 15.1 | 6.1 | 73 | 100% 50% 100% 50% 100% 63% | 23% | 55% | 0.18 | 0 | 436 of 440 | 12.68 to 8.60 | 0 of 64 |
| First table: 1.0/1.15/2.0, 8% | 1 / 1.15 / 2 | 8% | 0.5 / 1 | 94% | 6: Sprinter 90%, Packhorse 25%, Straight-Line Rocket 100%, Iron Mule 0%, Dust Spider 10%, Tiny Trouble 80% | 15.9 | 6.0 | 70 | 100% 38% 100% 50% 100% 63% | 25% | 54% | 0.16 | 0 | 428 of 440 | 12.68 to 8.50 | 0 of 48 |
| A: 1.0/1.15/3.0, 7% | 1 / 1.15 / 3 | 7% | 0.5 / 1 | 93% | 6: Rookie 23%, Sprinter 90%, Straight-Line Rocket 100%, Iron Mule 0%, Dust Spider 10%, Tiny Trouble 80% | 14.0 | 5.6 | 69 | 100% 50% 100% 50% 100% 63% | 21% | 57% | 0.21 | 0 | 428 of 440 | 12.68 to 9.12 | 0 of 56 |
| B: 1.0/1.15/3.0, 8% | 1 / 1.15 / 3 | 8% | 0.5 / 1 | 94% | 6: Rookie 20%, Sprinter 90%, Straight-Line Rocket 100%, Iron Mule 0%, Dust Spider 10%, Tiny Trouble 80% | 14.2 | 5.9 | 71 | 100% 50% 100% 50% 100% 50% | 21% | 56% | 0.21 | 0 | 428 of 440 | 12.68 to 8.72 | 0 of 56 |
| C2: C with the rise twice as fast | 1 / 1.15 / 2.5 | 8% | 1 / 1 | 94% | 6: Sprinter 90%, Packhorse 25%, Straight-Line Rocket 100%, Iron Mule 0%, Dust Spider 10%, Tiny Trouble 80% | 15.7 | 5.7 | 67 | 100% 50% 100% 50% 100% 63% | 23% | 55% | 0.20 | 0 | 436 of 440 | 12.68 to 8.57 | 0 of 56 |
| C3: C, engaging at 1.25 s | 1 / 1.25 / 2.5 | 8% | 0.5 / 1 | 95% | 6: Rookie 23%, Sprinter 90%, Straight-Line Rocket 100%, Iron Mule 0%, Dust Spider 10%, Tiny Trouble 80% | 15.1 | 6.3 | 74 | 100% 50% 100% 50% 100% 63% | 23% | 55% | 0.20 | 0 | 428 of 440 | 12.68 to 8.61 | 0 of 72 |
| D: 1.0/1.15/2.0, 6% | 1 / 1.15 / 2 | 6% | 0.5 / 1 | 93% | 6: Rookie 20%, Sprinter 90%, Straight-Line Rocket 100%, Iron Mule 0%, Dust Spider 10%, Tiny Trouble 80% | 15.6 | 5.8 | 70 | 100% 50% 100% 50% 100% 50% | 23% | 56% | 0.17 | 0 | 428 of 440 | 12.68 to 9.35 | 0 of 88 |
| E: 1.2/1.35/3.0, 8% | 1.2 / 1.35 / 3 | 8% | 0.5 / 1 | 96% | 6: Sprinter 90%, Packhorse 25%, Straight-Line Rocket 100%, Iron Mule 0%, Dust Spider 10%, Tiny Trouble 80% | 13.9 | 5.2 | 63 | 100% 63% 100% 50% 100% 50% | 20% | 56% | 0.19 | 0 | 436 of 440 | 12.68 to 8.74 | 0 of 40 |
| F: 1.2/1.35/2.5, 8% | 1.2 / 1.35 / 2.5 | 8% | 0.5 / 1 | 95% | 6: Rookie 25%, Sprinter 90%, Straight-Line Rocket 100%, Iron Mule 0%, Dust Spider 10%, Tiny Trouble 80% | 14.6 | 5.6 | 67 | 100% 63% 100% 50% 100% 63% | 21% | 55% | 0.20 | 0 | 424 of 440 | 12.68 to 8.64 | 0 of 60 |
| G: 0.9/1.05/3.0, 8% | 0.9 / 1.05 / 3 | 8% | 0.5 / 1 | 92% | 7: Rookie 23%, Sprinter 90%, Packhorse 29%, Straight-Line Rocket 100%, Iron Mule 0%, Dust Spider 10%, Tiny Trouble 80% | 14.8 | 6.0 | 73 | 100% 50% 100% 50% 100% 63% | 22% | 56% | 0.22 | 0 | 428 of 440 | 12.68 to 8.70 | 0 of 56 |
| H: 1.0/1.15/3.0, 6% | 1 / 1.15 / 3 | 6% | 0.5 / 1 | 94% | 6: Rookie 20%, Sprinter 90%, Straight-Line Rocket 100%, Iron Mule 0%, Dust Spider 10%, Tiny Trouble 80% | 13.9 | 5.7 | 69 | 100% 50% 100% 50% 100% 50% | 20% | 58% | 0.16 | 0 | 436 of 440 | 12.68 to 9.56 | 0 of 48 |
| R1 (reference, outside the brief): bonus doubled, 16% from 3.0 s | 1 / 1.15 / 3 | 16% | 0.5 / 1 | 93% | 6: Rookie 21%, Sprinter 90%, Straight-Line Rocket 100%, Iron Mule 0%, Dust Spider 10%, Tiny Trouble 80% | 16.4 | 6.4 | 77 | 100% 38% 100% 50% 100% 50% | 26% | 46% | 0.21 | 0 | 428 of 440 | 12.68 to 6.12 | 0 of 72 |
| R2 (reference, outside the brief): threshold inside weapon reach, 0.5/0.65/2.0, 8% | 0.5 / 0.65 / 2 | 8% | 0.5 / 1 | 92% | 6: Sprinter 90%, Packhorse 29%, Straight-Line Rocket 100%, Iron Mule 0%, Dust Spider 10%, Tiny Trouble 80% | 18.0 | 6.8 | 84 | 100% 0% 100% 13% 88% 38% | 26% | 54% | 0.29 | 0 | 428 of 440 | 12.68 to 8.40 | 0 of 88 |

## What the table says

- **Inside the brief's envelope the settings are a race or two apart.** Threshold 0.9 to 1.2 s,
  whole bonus 6 to 8 percent reached between 2.0 and 3.0 s, ramps as shipped or twice as fast:
  the lap 1 leader wins 92 to 96 percent, there are 13.9 to 15.9 s a race within 220 px (12.6
  with the tow off), 5.2 to 6.3 activations (4.5) and 63 to 74 damage (57).
- **Chosen: C.** C and its two variants (C2 rises twice as fast, C3 engages at 1.25 s) give
  the most combat of the settings that reach the whole bonus at 2.5 s or more (15.1 to 15.7 s
  within reach, 5.7 to 6.3 activations, 67 to 74 damage) and are equal on the other targets.
  C keeps the gentler rise, which is the smoother of the two to drive, and it changes as few
  unarmed results as any row (4 of 440: one pairing, Rookie against Packhorse from one grid
  slot, decided by 0.42 s with the tow off; no pass on tow). The first table (whole at 2.0 s)
  gave a little more time within reach and cost the Sprinter V8 twin one more race; whole at
  3.0 s gave less of everything.
- **No setting brings a build inside 30 to 70 percent.** 32 of the 55 pairings are more than 12
  s apart on pace alone; an 8 percent top-speed bonus closes about a third of that, and doubling
  it (R1) still leaves all six outside.
- **More combat costs the build reward, through the bullet guns.** A threshold inside weapon
  reach (R2) gives the most combat in the table (18.0 s within reach, 84 damage) and destroys the
  upgrade test: the Sprinter V8 twin wins none of its 8 races and the Slicks twin 1. The car
  behind with a Front Machine Gun shoots the better car to pieces (the same thing happens with
  the tow off in 3 of the Sprinter V8 twin's 8 races: up to 297 damage, chassis left at 10
  percent). See the proposal in `docs/BALANCE_CHANGELOG.md`.
- **The tow never makes a pass.** Every row: 0 changes of the lead by a car with any tow in the
  second before, armed or unarmed.

## The chosen setting against the tow off, in detail

Seeds 1001, 8920, 16839, 24758. Table: `{"thresholdGap":1,"engageGap":1.15,"fullGap":2.5,"maxBonus":0.08,"rampUpPerSecond":0.5,"rampDownPerSecond":1,"startDelaySeconds":5,"updateSeconds":0.5,"speedAverageSeconds":3,"speedFloor":120,"fadeStartSpeed":140,"fadeFullSpeed":200,"eventMinSeconds":3}`

Shipped builds, tow off: mean time gap 6.62 s; share of the race within 1 s 11%, within 1.5 s 16%, within 220 px 11% (12.6 s a race), beyond 3 s 67%; races that spent under 10% / 10 to 50% / over 50% of their length within 1.5 s: 65% / 25% / 11%; lead changes a race 0.21 (0 of them by a car with tow in the second before); the lap 1 leader won 96% of 440; weapon activations a race 4.5 (18.3 rounds); damage a race 56.6; share of the race a car had tow 0%.

Shipped builds, tow on: mean time gap 4.89 s; share of the race within 1 s 13%, within 1.5 s 23%, within 220 px 13% (15.1 s a race), beyond 3 s 55%; races that spent under 10% / 10 to 50% / over 50% of their length within 1.5 s: 55% / 26% / 20%; lead changes a race 0.18 (0 of them by a car with tow in the second before); the lap 1 leader won 93% of 440; weapon activations a race 6.1 (25.5 rounds); damage a race 73.1; share of the race a car had tow 42%.

| Build | Win rate, tow off | Win rate, tow on |
| :-- | --: | --: |
| Straight-Line Rocket | 100% | 100% |
| Sprinter | 90% | 90% |
| Tiny Trouble | 80% | 80% |
| Tinker | 70% | 70% |
| Back-Alley Trap | 60% | 60% |
| Rain Runner | 50% | 40% |
| Longlegs | 35% | 46% |
| Packhorse | 30% | 31% |
| Rookie | 25% | 23% |
| Dust Spider | 10% | 10% |
| Iron Mule | 0% | 0% |

| Weapon on a shipped build | Uses a race, off | Uses a race, on | Factor | Damage a race, off | Damage a race, on |
| :-- | --: | --: | --: | --: | --: |
| Front Machine Gun | 2.9 | 4.2 | 1.5x | 38.7 | 54.1 |
| Rear Sentry | 2.1 | 3.0 | 1.4x | 26.6 | 33.1 |
| Road Mine | 1.0 | 1.1 | 1.1x | 11.7 | 12.7 |
| Arc Mortar | 2.3 | 2.7 | 1.1x | 20.6 | 23.6 |
| Road Shotgun | 0.4 | 0.4 | 1.0x | 6.0 | 6.0 |
| Air Cannon | 0.9 | 0.9 | 1.0x | 2.5 | 2.5 |
| Oil Slick | 0.0 | 0.0 | n/ax | 0.0 | 0.0 |

| Pace apart (gap at the line, unarmed, tow off) | Pairings | Uses a race, off to on | Factor | Damage a race, off to on | Within 1.5 s, off to on | Within 220 px, off to on | Beyond 3 s, off to on |
| :-- | --: | :-- | --: | :-- | :-- | :-- | :-- |
| under 2 s | 4 | 22.4 to 28.3 | 1.3x | 282 to 356 | 66% to 74% | 46% to 54% | 11% to 16% |
| 2 to 5 s | 12 | 7.2 to 12.1 | 1.7x | 97 to 143 | 28% to 55% | 18% to 25% | 24% to 5% |
| 5 to 12 s | 7 | 2.5 to 3.1 | 1.2x | 37 to 37 | 15% to 19% | 8% to 8% | 68% to 21% |
| over 12 s | 32 | 1.7 to 1.8 | 1.1x | 17 to 19 | 5% to 5% | 4% to 4% | 89% to 86% |

Unarmed pairs, tow off: mean time gap 6.26 s; share of the race within 1 s 12%, within 1.5 s 17%, within 220 px 11% (13.4 s a race), beyond 3 s 63%; races that spent under 10% / 10 to 50% / over 50% of their length within 1.5 s: 64% / 26% / 10%; lead changes a race 0.15 (0 of them by a car with tow in the second before); the lap 1 leader won 96% of 440; weapon activations a race 0.0 (0.0 rounds); damage a race 0.5; share of the race a car had tow 0%.

Unarmed pairs, tow on: mean time gap 4.56 s; share of the race within 1 s 14%, within 1.5 s 26%, within 220 px 14% (15.8 s a race), beyond 3 s 51%; races that spent under 10% / 10 to 50% / over 50% of their length within 1.5 s: 53% / 25% / 22%; lead changes a race 0.15 (0 of them by a car with tow in the second before); the lap 1 leader won 97% of 440; weapon activations a race 0.0 (0.0 rounds); damage a race 0.3; share of the race a car had tow 42%.

Unarmed: the car that won with the tow off won with it on in 436 of 440 races. Mean gap when the winner crossed the line: 12.68 s off, 8.60 s on. Changes of the lead after the first five seconds: 64, of which 0 by a car with tow in the second before.
- flipped: starter_rookie>starter_packhorse#1001, won by 0.42 s off, by 1.27 s the other way on
- flipped: starter_rookie>starter_packhorse#8920, won by 0.42 s off, by 1.27 s the other way on
- flipped: starter_rookie>starter_packhorse#16839, won by 0.42 s off, by 1.27 s the other way on
- flipped: starter_rookie>starter_packhorse#24758, won by 0.42 s off, by 1.27 s the other way on
