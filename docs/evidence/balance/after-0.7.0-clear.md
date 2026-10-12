Weather `city_clear_night`, seeds 1001, 8920, 16839, 24758. Tow table (`TOW` in packages/shared/src/balance.ts): threshold 1 s, engage 1.15 s, whole bonus 8% of top speed from 2.5 s, ramp 0.5 up and 1 down (whole bonuses a second), decided every 0.5 s, none in the first 5 s.

## The four targets, tow off and on

| Target | Measure | Tow off | Tow on | Aim |
| :-- | :-- | --: | --: | :-- |
| 1. Leading still pays | Races won by the car ahead at the end of lap 1 | 97% | 94% | 60 to 75%; under 60 the tow is too strong |
| 2. No build outside 30 to 70% | Builds outside | 6 | 7 | none |
|  | Lowest to highest win rate | 0% to 100% | 0% to 100% | 30 to 70% |
| 3. Combat happens | Seconds a race within 220 px | 12.9 | 15.4 | several times more |
|  | Weapon activations a race (rounds) | 3.7 (14.6) | 4.7 (18.8) | several times more |
|  | Damage dealt a race, both cars | 50.9 | 61.6 | several times more |
|  | Front Machine Gun: activations a race (rounds) | 2.2 (10.8) | 2.8 (14.0) | |
|  | Rear Sentry: activations a race (rounds) | 1.7 (6.7) | 2.3 (9.2) | |
| 4. Building well still pays | Upgraded twin's wins, each pair | 100%, 100%, 100%, 50%, 100%, 75% (lowest 50%) | 100%, 100%, 100%, 50%, 100%, 75% (lowest 50%) | clearly more than half |
| Also | Lead changes a race | 0.20 | 0.16 | |
|  | Of them, by a car with tow in the second before | 0 | 0 | 0 |
|  | Mean time gap s | 6.46 | 4.74 | |
|  | Share of the race a car had tow | 0% | 43% | |

## Time within 220 px and changes of the lead, per race

| Seconds within 220 px in a race | under 1 s | 1 to 5 s | 5 to 15 s | 15 to 30 s | 30 to 60 s | 60 s or more |
| :-- | --: | --: | --: | --: | --: | --: |
| Tow off | 0% | 47% | 36% | 6% | 7% | 4% |
| Tow on | 0% | 45% | 30% | 10% | 7% | 7% |

| Changes of the lead in a race | 0 | 1 | 2 | 3 or more |
| :-- | --: | --: | --: | --: |
| Tow off | 87% | 10% | 1% | 2% |
| Tow on | 86% | 12% | 2% | 0% |

## Upgrade test

Each shipped build against the same build with one upgrade, armed as it ships, both grid slots, every seed.

| Upgrade | Cost, stock to upgraded | Pace apart, unarmed, tow off s | Races | Upgraded twin wins, tow off | Tow on | Mean gap at the line s, off | On |
| :-- | :-- | --: | --: | --: | --: | --: | --: |
| Rookie, Four-Cylinder to V6 | 480 to 515 | 9.43 | 8 | 100% | 100% | 9.43 | 3.81 |
| Sprinter, V6 to V8 | 560 to 605 | 5.09 | 8 | 100% | 100% | 2.60 | 1.50 |
| Packhorse, V6 to V8 | 710 to 755 | 5.78 | 8 | 100% | 100% | 5.76 | 2.16 |
| Sprinter, Street Tires to Slicks | 560 to 590 | 2.50 | 8 | 50% | 50% | -6.99 | -5.18 |
| Tinker, Street Tires to Slicks | 565 to 588 | 1.69 | 8 | 100% | 100% | 1.27 | 1.06 |
| Back-Alley Trap, Street Tires to Slicks | 630 to 660 | 1.70 | 8 | 75% | 75% | 1.59 | 1.49 |

## Matchup matrix, tow off

| Row beats column | Rookie | Sprinter | Packhorse | Longlegs | Tinker | Rocket | Mule | Spider | Runner | Trap | Trouble | Overall |
| :-- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| Rookie |  | 0% | 50% | 63% | 0% | 0% | 100% | 100% | 0% | 0% | 0% | 31% |
| Sprinter | 100% |  | 100% | 100% | 100% | 0% | 100% | 100% | 100% | 100% | 100% | 90% |
| Packhorse | 50% | 0% |  | 100% | 0% | 0% | 100% | 100% | 0% | 0% | 0% | 35% |
| Longlegs | 38% | 0% | 0% |  | 0% | 0% | 100% | 100% | 0% | 0% | 0% | 24% |
| Tinker | 100% | 0% | 100% | 100% |  | 0% | 100% | 100% | 100% | 100% | 0% | 70% |
| Straight-Line Rocket | 100% | 100% | 100% | 100% | 100% |  | 100% | 100% | 100% | 100% | 100% | 100% |
| Iron Mule | 0% | 0% | 0% | 0% | 0% | 0% |  | 0% | 0% | 0% | 0% | 0% |
| Dust Spider | 0% | 0% | 0% | 0% | 0% | 0% | 100% |  | 0% | 0% | 0% | 10% |
| Rain Runner | 100% | 0% | 100% | 100% | 0% | 0% | 100% | 100% |  | 0% | 0% | 50% |
| Back-Alley Trap | 100% | 0% | 100% | 100% | 0% | 0% | 100% | 100% | 100% |  | 0% | 60% |
| Tiny Trouble | 100% | 0% | 100% | 100% | 100% | 0% | 100% | 100% | 100% | 100% |  | 80% |

## Matchup matrix, tow on

| Row beats column | Rookie | Sprinter | Packhorse | Longlegs | Tinker | Rocket | Mule | Spider | Runner | Trap | Trouble | Overall |
| :-- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| Rookie |  | 0% | 0% | 38% | 0% | 0% | 100% | 100% | 0% | 0% | 0% | 24% |
| Sprinter | 100% |  | 100% | 100% | 100% | 0% | 100% | 100% | 100% | 100% | 100% | 90% |
| Packhorse | 100% | 0% |  | 100% | 0% | 0% | 100% | 100% | 0% | 0% | 0% | 40% |
| Longlegs | 63% | 0% | 0% |  | 0% | 0% | 100% | 100% | 0% | 0% | 0% | 26% |
| Tinker | 100% | 0% | 100% | 100% |  | 0% | 100% | 100% | 100% | 100% | 0% | 70% |
| Straight-Line Rocket | 100% | 100% | 100% | 100% | 100% |  | 100% | 100% | 100% | 100% | 100% | 100% |
| Iron Mule | 0% | 0% | 0% | 0% | 0% | 0% |  | 0% | 0% | 0% | 0% | 0% |
| Dust Spider | 0% | 0% | 0% | 0% | 0% | 0% | 100% |  | 0% | 0% | 0% | 10% |
| Rain Runner | 100% | 0% | 100% | 100% | 0% | 0% | 100% | 100% |  | 0% | 0% | 50% |
| Back-Alley Trap | 100% | 0% | 100% | 100% | 0% | 0% | 100% | 100% | 100% |  | 0% | 60% |
| Tiny Trouble | 100% | 0% | 100% | 100% | 100% | 0% | 100% | 100% | 100% | 100% |  | 80% |

## Shipped builds, tow off

Tow off. Weather `city_clear_night`, seeds 1001, 8920, 16839, 24758: 440 matches, mean race 119.9 s. Ended by: finish 440.

| Build | Cost | Matches | Win rate | KO wins | KO losses | Wrecked (chassis 0) | Mean time to wreck s | Damage dealt | Damage taken | Mean finish s | DNF |
| :-- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| Straight-Line Rocket | 725 | 80 | 100% | 0 | 0 | 0 | n/a | 0.1 | 11.6 | 103.4 | 0 |
| Sprinter | 560 | 80 | 90% | 0 | 0 | 0 | n/a | 29.4 | 17.5 | 110.8 | 0 |
| Tiny Trouble | 479 | 80 | 80% | 0 | 0 | 0 | n/a | 3.6 | 23.7 | 107.3 | 0 |
| Tinker | 565 | 80 | 70% | 0 | 0 | 0 | n/a | 40.5 | 13.7 | 115.9 | 16 |
| Back-Alley Trap | 630 | 80 | 60% | 0 | 0 | 0 | n/a | 33.4 | 34.6 | 118.6 | 16 |
| Rain Runner | 715 | 80 | 50% | 0 | 0 | 0 | n/a | 15.7 | 37.5 | 120.6 | 24 |
| Packhorse | 710 | 80 | 35% | 0 | 0 | 0 | n/a | 23.6 | 48.0 | 121.8 | 24 |
| Rookie | 480 | 80 | 31% | 0 | 0 | 0 | n/a | 50.8 | 36.3 | 123.0 | 24 |
| Longlegs | 735 | 80 | 24% | 0 | 0 | 0 | n/a | 59.7 | 33.8 | 123.4 | 24 |
| Dust Spider | 763 | 80 | 10% | 0 | 0 | 0 | n/a | 2.5 | 14.6 | 132.7 | 72 |
| Iron Mule | 920 | 80 | 0% | 0 | 0 | 0 | n/a | 20.6 | 7.1 | 135.9 | 72 |

| Weapon | Price | Car-matches | Mean uses | Mean rounds | Mean damage | Damage per 100 credits | Against median (18.0) | Carrier in thermal protection |
| :-- | --: | --: | --: | --: | --: | --: | --: | --: |
| Front Machine Gun | 70 | 320 | 2.2 | 10.8 | 34.7 | 49.6 | 2.76x | 0% |
| Rear Sentry | 85 | 320 | 1.7 | 6.7 | 22.7 | 26.8 | 1.49x | 0% |
| Road Mine | 65 | 80 | 1.0 | 1.0 | 11.7 | 18.0 | 1.00x | 0% |
| Arc Mortar | 175 | 80 | 2.3 | 2.3 | 20.6 | 11.8 | 0.65x | 0% |
| Road Shotgun | 90 | 160 | 0.4 | 2.9 | 6.2 | 6.9 | 0.38x | 0% |
| Air Cannon | 85 | 80 | 0.9 | 0.9 | 2.5 | 2.9 | control | 0% |
| Oil Slick | 60 | 80 | 0.0 | 0.0 | 0.0 | 0.0 | control | 0% |

How close the racing was: mean time gap 6.46 s; share of the race within 1 s 11%, within 1.5 s 16%, within 220 px 11% (12.9 s a race), beyond 3 s 65%; races that spent under 10% / 10 to 50% / over 50% of their length within 1.5 s: 65% / 23% / 13%; lead changes a race 0.20 (0 of them by a car with tow in the second before); the lap 1 leader won 97% of 440; weapon activations a race 3.7 (14.6 rounds); damage a race 50.9; share of the race a car had tow 0%.

Flags:
- Sprinter wins 90% of its matches
- Longlegs wins only 24% of its matches
- Straight-Line Rocket wins 100% of its matches
- Iron Mule wins only 0% of its matches
- Dust Spider wins only 10% of its matches
- Tiny Trouble wins 80% of its matches
- Front Machine Gun deals 2.8x the median damage per credit
- Road Shotgun deals 0.38x the median damage per credit

## Shipped builds, tow on

Tow on. Weather `city_clear_night`, seeds 1001, 8920, 16839, 24758: 440 matches, mean race 118.9 s. Ended by: finish 440.

| Build | Cost | Matches | Win rate | KO wins | KO losses | Wrecked (chassis 0) | Mean time to wreck s | Damage dealt | Damage taken | Mean finish s | DNF |
| :-- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| Straight-Line Rocket | 725 | 80 | 100% | 0 | 0 | 0 | n/a | 0.1 | 11.6 | 103.4 | 0 |
| Sprinter | 560 | 80 | 90% | 0 | 0 | 0 | n/a | 29.4 | 17.8 | 110.4 | 0 |
| Tiny Trouble | 479 | 80 | 80% | 0 | 0 | 0 | n/a | 3.8 | 23.7 | 107.0 | 0 |
| Tinker | 565 | 80 | 70% | 0 | 0 | 0 | n/a | 40.6 | 14.7 | 114.7 | 0 |
| Back-Alley Trap | 630 | 80 | 60% | 0 | 0 | 0 | n/a | 38.1 | 34.9 | 117.5 | 8 |
| Rain Runner | 715 | 80 | 50% | 0 | 0 | 0 | n/a | 25.0 | 60.8 | 119.7 | 16 |
| Packhorse | 710 | 80 | 40% | 0 | 0 | 0 | n/a | 30.8 | 70.9 | 120.3 | 16 |
| Longlegs | 735 | 80 | 26% | 0 | 0 | 0 | n/a | 76.3 | 37.9 | 121.4 | 16 |
| Rookie | 480 | 80 | 24% | 0 | 0 | 0 | n/a | 68.7 | 45.9 | 121.4 | 18 |
| Dust Spider | 763 | 80 | 10% | 0 | 0 | 0 | n/a | 2.5 | 11.5 | 128.6 | 40 |
| Iron Mule | 920 | 80 | 0% | 0 | 0 | 0 | n/a | 23.6 | 7.1 | 133.9 | 72 |

| Weapon | Price | Car-matches | Mean uses | Mean rounds | Mean damage | Damage per 100 credits | Against median (19.8) | Carrier in thermal protection |
| :-- | --: | --: | --: | --: | --: | --: | --: | --: |
| Front Machine Gun | 70 | 320 | 2.8 | 14.0 | 43.5 | 62.1 | 3.13x | 0% |
| Rear Sentry | 85 | 320 | 2.3 | 9.2 | 27.8 | 32.7 | 1.65x | 0% |
| Road Mine | 65 | 80 | 1.1 | 1.1 | 12.9 | 19.8 | 1.00x | 0% |
| Arc Mortar | 175 | 80 | 2.7 | 2.7 | 23.6 | 13.5 | 0.68x | 0% |
| Road Shotgun | 90 | 160 | 0.4 | 2.9 | 6.3 | 7.0 | 0.35x | 0% |
| Air Cannon | 85 | 80 | 0.9 | 0.9 | 2.5 | 2.9 | control | 0% |
| Oil Slick | 60 | 80 | 0.0 | 0.0 | 0.0 | 0.0 | control | 0% |

How close the racing was: mean time gap 4.74 s; share of the race within 1 s 13%, within 1.5 s 23%, within 220 px 13% (15.4 s a race), beyond 3 s 53%; races that spent under 10% / 10 to 50% / over 50% of their length within 1.5 s: 55% / 23% / 23%; lead changes a race 0.16 (0 of them by a car with tow in the second before); the lap 1 leader won 94% of 440; weapon activations a race 4.7 (18.8 rounds); damage a race 61.6; share of the race a car had tow 43%.

Flags:
- Rookie wins only 24% of its matches
- Sprinter wins 90% of its matches
- Longlegs wins only 26% of its matches
- Straight-Line Rocket wins 100% of its matches
- Iron Mule wins only 0% of its matches
- Dust Spider wins only 10% of its matches
- Tiny Trouble wins 80% of its matches
- Front Machine Gun deals 3.1x the median damage per credit
- Road Shotgun deals 0.35x the median damage per credit

## Weapon bench, tow off

Weapon bench, tow off, weather `city_clear_night`, seeds 1001, 8920, 16839, 24758: one copy on a stock Spider against the same Spider with ballast in place of the weapon, from both grid slots.

| Weapon | Price | Matches | Mean uses | Mean rounds | Mean damage | Damage per 100 credits | Against median (22.9) | Wins against unarmed twin | Mean lead at the finish s | Twin wrecked | Peak heat | Over the heat threshold | In thermal protection |
| :-- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| Front Machine Gun | 70 | 8 | 6.0 | 30.0 | 97.2 | 138.8 | 6.07x | 75% | 1.64 | 0 | 52 | 0% | 0% |
| Swivel Turret | 130 | 8 | 8.0 | 24.0 | 150.5 | 115.7 | 5.06x | 50% | 0.28 | 0 | 55 | 0% | 0% |
| Needle Railgun | 165 | 8 | 2.5 | 5.0 | 108.1 | 65.5 | 2.87x | 63% | 0.58 | 0 | 53 | 0% | 0% |
| Rear Sentry | 85 | 8 | 4.0 | 16.0 | 49.7 | 58.5 | 2.56x | 50% | 0.12 | 0 | 46 | 0% | 0% |
| Straight Rocket | 100 | 8 | 2.5 | 2.5 | 50.0 | 50.0 | 2.19x | 63% | 0.58 | 0 | 50 | 0% | 0% |
| Tesla Arc | 100 | 8 | 2.0 | 4.0 | 33.6 | 33.6 | 1.47x | 50% | 0.05 | 0 | 45 | 0% | 0% |
| Seeker Missile | 170 | 8 | 1.5 | 1.5 | 42.0 | 24.7 | 1.08x | 50% | 0.23 | 0 | 47 | 0% | 0% |
| Road Mine | 65 | 8 | 1.5 | 1.5 | 13.6 | 21.0 | 0.92x | 50% | 0.47 | 0 | 45 | 0% | 0% |
| Side Saw | 90 | 8 | 1.5 | 1.5 | 14.7 | 16.3 | 0.71x | 50% | -0.05 | 0 | 45 | 0% | 0% |
| Crash Hammer | 105 | 8 | 0.5 | 0.5 | 16.8 | 16.0 | 0.70x | 50% | -0.06 | 0 | 45 | 0% | 0% |
| Arc Mortar | 175 | 8 | 3.0 | 3.0 | 27.2 | 15.5 | 0.68x | 50% | -0.03 | 0 | 50 | 0% | 0% |
| Road Shotgun | 90 | 8 | 0.5 | 4.0 | 10.6 | 11.8 | 0.52x | 50% | -0.08 | 0 | 45 | 0% | 0% |
| Steel Boomerang | 110 | 8 | 5.1 | 5.1 | 12.6 | 11.5 | 0.50x | 50% | -0.03 | 0 | 45 | 0% | 0% |
| Flame Spitter | 115 | 8 | 0.5 | 0.5 | 7.3 | 6.4 | 0.28x | 50% | 0.02 | 0 | 45 | 0% | 0% |
| Air Cannon | 85 | 8 | 0.5 | 0.5 | 1.4 | 1.6 | control | 50% | -0.43 | 0 | 45 | 0% | 0% |
| Oil Slick | 60 | 8 | 1.6 | 1.6 | 0.0 | 0.0 | control | 50% | 0.02 | 0 | 45 | 0% | 0% |
| Sticky Foam | 80 | 8 | 0.5 | 0.5 | 0.0 | 0.0 | control | 50% | -0.66 | 0 | 45 | 0% | 0% |
| EMP Pulse | 145 | 8 | 1.6 | 1.6 | 0.0 | 0.0 | control | 50% | 0.07 | 0 | 45 | 0% | 0% |
| Frost Cannon | 110 | 8 | 7.3 | 7.3 | 0.0 | 0.0 | control | 50% | -0.03 | 0 | 45 | 0% | 0% |
| Grapple Harpoon | 130 | 8 | 3.6 | 3.6 | 0.0 | 0.0 | control | 88% | 0.92 | 0 | 46 | 0% | 0% |

How close the racing was: mean time gap 1.15 s; share of the race within 1 s 37%, within 1.5 s 93%, within 220 px 40% (52.1 s a race), beyond 3 s 1%; races that spent under 10% / 10 to 50% / over 50% of their length within 1.5 s: 3% / 5% / 93%; lead changes a race 0.04 (0 of them by a car with tow in the second before); the lap 1 leader won 97% of 160; weapon activations a race 2.7 (5.7 rounds); damage a race 32.9; share of the race a car had tow 0%.

Flags:
- Front Machine Gun deals 6.1x the median damage per credit
- Swivel Turret deals 5.1x the median damage per credit
- Needle Railgun deals 2.9x the median damage per credit
- Rear Sentry deals 2.6x the median damage per credit
- Straight Rocket deals 2.2x the median damage per credit
- Flame Spitter deals 0.28x the median damage per credit

## Weapon bench, tow on

Weapon bench, tow on, weather `city_clear_night`, seeds 1001, 8920, 16839, 24758: one copy on a stock Spider against the same Spider with ballast in place of the weapon, from both grid slots.

| Weapon | Price | Matches | Mean uses | Mean rounds | Mean damage | Damage per 100 credits | Against median (29.2) | Wins against unarmed twin | Mean lead at the finish s | Twin wrecked | Peak heat | Over the heat threshold | In thermal protection |
| :-- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| Front Machine Gun | 70 | 8 | 6.0 | 30.0 | 97.2 | 138.8 | 4.76x | 75% | 1.25 | 0 | 52 | 0% | 0% |
| Swivel Turret | 130 | 8 | 8.0 | 24.0 | 150.5 | 115.7 | 3.97x | 50% | 0.25 | 0 | 55 | 0% | 0% |
| Needle Railgun | 165 | 8 | 2.4 | 4.8 | 104.3 | 63.2 | 2.17x | 75% | 0.61 | 0 | 53 | 0% | 0% |
| Rear Sentry | 85 | 8 | 4.0 | 16.0 | 49.7 | 58.5 | 2.01x | 50% | 0.07 | 0 | 46 | 0% | 0% |
| Straight Rocket | 100 | 8 | 2.5 | 2.5 | 50.0 | 50.0 | 1.72x | 63% | 0.55 | 0 | 50 | 0% | 0% |
| Road Mine | 65 | 8 | 2.0 | 2.0 | 26.2 | 40.3 | 1.38x | 50% | 0.34 | 0 | 45 | 0% | 0% |
| Tesla Arc | 100 | 8 | 2.0 | 4.0 | 33.6 | 33.6 | 1.15x | 50% | 0.02 | 0 | 45 | 0% | 0% |
| Seeker Missile | 170 | 8 | 1.5 | 1.5 | 42.0 | 24.7 | 0.85x | 50% | 0.24 | 0 | 47 | 0% | 0% |
| Side Saw | 90 | 8 | 1.5 | 1.5 | 14.7 | 16.3 | 0.56x | 50% | 0.00 | 0 | 45 | 0% | 0% |
| Crash Hammer | 105 | 8 | 0.5 | 0.5 | 16.8 | 16.0 | 0.55x | 50% | 0.03 | 0 | 45 | 0% | 0% |
| Arc Mortar | 175 | 8 | 3.0 | 3.0 | 27.2 | 15.5 | 0.53x | 50% | -0.02 | 0 | 50 | 0% | 0% |
| Road Shotgun | 90 | 8 | 0.5 | 4.0 | 10.6 | 11.8 | 0.40x | 50% | -0.05 | 0 | 45 | 0% | 0% |
| Steel Boomerang | 110 | 8 | 5.4 | 5.4 | 12.6 | 11.5 | 0.39x | 50% | -0.02 | 0 | 46 | 0% | 0% |
| Flame Spitter | 115 | 8 | 0.5 | 0.5 | 7.3 | 6.4 | 0.22x | 50% | 0.02 | 0 | 45 | 0% | 0% |
| Air Cannon | 85 | 8 | 0.5 | 0.5 | 1.4 | 1.6 | control | 50% | 0.00 | 0 | 45 | 0% | 0% |
| Oil Slick | 60 | 8 | 2.0 | 2.0 | 0.0 | 0.0 | control | 50% | -0.02 | 0 | 45 | 0% | 0% |
| Sticky Foam | 80 | 8 | 0.5 | 0.5 | 0.0 | 0.0 | control | 50% | -0.05 | 0 | 45 | 0% | 0% |
| EMP Pulse | 145 | 8 | 2.0 | 2.0 | 0.0 | 0.0 | control | 50% | 0.02 | 0 | 45 | 0% | 0% |
| Frost Cannon | 110 | 8 | 9.0 | 9.0 | 0.0 | 0.0 | control | 50% | 0.02 | 0 | 45 | 0% | 0% |
| Grapple Harpoon | 130 | 8 | 3.1 | 3.1 | 0.0 | 0.0 | control | 88% | 0.90 | 0 | 46 | 0% | 0% |

How close the racing was: mean time gap 1.06 s; share of the race within 1 s 49%, within 1.5 s 97%, within 220 px 43% (55.7 s a race), beyond 3 s 1%; races that spent under 10% / 10 to 50% / over 50% of their length within 1.5 s: 0% / 0% / 100%; lead changes a race 0.05 (0 of them by a car with tow in the second before); the lap 1 leader won 96% of 160; weapon activations a race 2.8 (5.8 rounds); damage a race 33.0; share of the race a car had tow 8%.

Flags:
- Front Machine Gun deals 4.8x the median damage per credit
- Swivel Turret deals 4.0x the median damage per credit
- Needle Railgun deals 2.2x the median damage per credit
- Rear Sentry deals 2.0x the median damage per credit
- Road Shotgun deals 0.40x the median damage per credit
- Steel Boomerang deals 0.39x the median damage per credit
- Flame Spitter deals 0.22x the median damage per credit

Simulated in 317.9 s.
