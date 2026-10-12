# Balance changelog

Catalog and balance data use semantic versions (`CATALOG_VERSION` in
`packages/content/src/catalog.ts`). Every change to a price, mass, coefficient or track is
listed here with the measurement that motivated it.

## The catch-up tow (protocol 5, catalog unchanged at 0.6.0, October 12, 2026)

A rule of the race, not a change to any part: no price, mass or coefficient changed, so the
catalog stays 0.6.0 and no blueprint goes out of date. A car that trails the racing car ahead of
it by more than 1.0 s gets a little more top speed, from nothing at 1.0 s to 8 percent at 2.5 s
and beyond; nothing at all inside 1.0 s, nothing ever for the leader. The rule, the threshold's
derivation and the table are `docs/COMBAT_API.md` "The tow"; the decisions are
`docs/DECISIONS.md` 189 to 198. Reports: `docs/evidence/balance/tow-0.6.0-clear.md` (the
shipped table against the tow off) and `docs/evidence/balance/tow-study.md` (thirteen settings).

**The table** (`TOW`): threshold 1.0 s, engage 1.15 s, whole bonus 8 percent of top speed from
2.5 s, rising at most half the bonus a second and falling at most the whole bonus a second,
decided every half second, none in the countdown or the first 5 s.

**How it was measured.** As for 0.6.0: sparring brain against sparring brain on Neon Cut, clear
night, four seeds, every shipped build against every other from both grid slots (440 races), the
weapon bench (160), and new, the upgrade test (48): a shipped build against the same build with
one upgrade bought from what is left of its budget, armed as it ships. Each with the tow off and
on, over the same races (`npx tsx tests/balance/report.ts`).

**Before and after, against the four targets.**

| Target | Measure | Tow off | Tow on | Aim | Met |
| :-- | :-- | --: | --: | :-- | :-- |
| 1. Leading still pays | Races won by the car ahead after lap 1 | 96% | 93% | 60 to 75%, never under 60 | Above half, as asked; above the aim, see below |
| 2. No build outside 30 to 70% | Builds outside | 6 | 6 | none | No |
|  | Lowest and highest win rate | 0% and 100% | 0% and 100% | | |
| 3. Combat happens | Seconds a race within 220 px | 12.6 | 15.1 | several times more | No: a fifth more |
|  | Weapon activations a race (rounds) | 4.5 (18.3) | 6.1 (25.5) | | A third more |
|  | Damage dealt a race | 56.6 | 73.1 | | 29 percent more |
|  | Front Machine Gun, bursts a race (rounds) | 2.9 (14.3) | 4.2 (20.7) | | |
|  | Rear Sentry, bursts a race (rounds) | 2.1 (8.3) | 3.0 (11.8) | | |
| 4. Building well still pays | Upgraded twin's wins: Rookie V6, Sprinter V8, Packhorse V8, Sprinter Slicks, Tinker Slicks, Trap Slicks | 100, 63, 100, 50, 100, 50% | 100, 50, 100, 50, 100, 63% | clearly over half | For Rookie V6, Packhorse V8 and Tinker Slicks (100 percent); not for Sprinter V8 or the other two Slicks pairs (50 to 63 percent), with or without the tow |
| Guards | Changes of the lead by a car with tow in the second before | 0 of 94 | 0 of 81 | 0 | Yes |
|  | Lead changes a race | 0.21 | 0.18 | | |
|  | Mean time gap | 6.62 s | 4.89 s | | |
|  | Unarmed: races whose winner is the same with the tow on | | 436 of 440 | | The four: one pairing from one slot, decided by 0.42 s |

Distribution of seconds within 220 px in a race (tow off, then on): 1 to 5 s 47 and 45 percent,
5 to 15 s 36 and 30, 15 to 30 s 7 and 11, 30 to 60 s 6 and 5, 60 s or more 4 and 8. Changes of
the lead in a race: none in 86 and 84 percent, one in 11 and 15, two or more in 3 and 2.

**The matrix** (full tables in the report). The order of the builds is their order on pace, with
the tow as without it, but for Longlegs and Rain Runner trading places: Straight-Line Rocket 100 percent, Sprinter 90, Tiny Trouble 80,
Tinker 70, Back-Alley Trap 60, Longlegs 46 (was 35), Rain Runner 40 (50), Packhorse 31 (30),
Rookie 23 (25), Dust Spider 10, Iron Mule 0. Three of the 55 pairings changed, all between builds
within 2.4 s of each other over a race on pace alone: Packhorse against Rookie (from 50 to 75
percent), Longlegs against Packhorse (50 to 63) and Longlegs against Rain Runner (0 to 100).
Without weapons only the first changes (four races, decided by 0.42 s with the tow off), so the
other two are the weapons' work once the tow keeps the cars in reach: Longlegs carries a Front
Machine Gun.

**What the numbers say, plainly.**

- *The tow does what it was allowed to do and no more.* The trailing car is brought from 12.7 s
  behind at the line on average to 8.6 s (unarmed); averaged over both cars, a car has tow for 42
  percent of a race. The leader is never touched, the bonus is zero inside 1.0 s, and in the 440
  armed races of the report and the 440 unarmed races of the study, with the tow on, no change of
  the lead was made by a car that had any tow in the second before.
- *It cannot fix the matrix.* 32 of the 55 pairings are more than 12 s apart on pace alone, up to
  30 percent (Iron Mule against the Rocket). A top-speed bonus capped at 8 percent closes about a
  third of a gap at the line; doubling it to 16 percent (measured as a reference) still left all
  six builds outside. The 0.6.0 finding stands: pace spread needs the tracks, shortcuts and
  repairs of Section 3.4 and an AI that fights for position (Milestone D).
- *It cannot make combat several times more frequent, by design.* The threshold is outside the
  guns' reach (1.0 s is about 250 px at race speed, the guns reach 220), and the sparring driver
  never makes a mistake, so a slower car is held at the edge and does not close the last second
  by itself. Within the brief's envelope every setting gave 13.9 to 15.9 s within reach. Putting the
  threshold inside weapon reach (0.5 s, a reference) gave 18 s and 84 damage and broke target 4:
  next item.
- *Building well is undermined by the bullet guns, and the tow makes that a little worse.* In
  three of eight Sprinter V8 races the V6 twin behind it fires 20 to 22 bursts of its Front
  Machine Gun into it in the first laps, takes it to 9 to 12 percent chassis and wins, with the
  tow off. With the tow on, which keeps the slower twin in reach a little longer, the V8 twin
  wins four of the eight.
  The two Slicks pairs that are 50 percent are 50 percent with the tow off too. With the threshold
  inside reach (reference R2) the V8 twin wins none of its eight races.
- *"Leading pays" is mostly a pace number in this harness.* The sparring driver is the same in
  both cars and drives its fastest line every lap (it never reads the tow: unit tested), so the
  car ahead after a lap is nearly always the faster build. 93 percent is above the 60 to 75 the
  brief aims for, but it falls as the tow gets stronger (90 percent with the bonus doubled), so it
  remains the right guard; it will only be a sharp one with drivers who make mistakes.

**The bullet guns, re-checked with the tow on.** Weapon bench (one gun on a Spider against its
unarmed twin, which stays in its company all race): Swivel Turret 235.2 damage per 100 credits
and Front Machine Gun 222.8, as before, now 8.1x and 7.6x a median that rose from 22.9 to 29.2
(weapons near the median got more chances: the Road Mine went from 21.0 to 40.3); Rear Sentry
3.05x. On the shipped builds the
Front Machine Gun went from 3.07x to 3.96x the median and the sentry from 1.74x to 2.00x. Heat does
not limit them in the simulation. A gun is refused as `Too hot` only in thermal protection, from
a core heat of 110 until it falls back to 75; on the bench the gun carriers peaked at 49 to 59
(performance starts to fall at 90), and in the 440 races of the shipped builds no car spent a single
tick in it (the hottest gun carrier peaked at 97). So the "Too hot" the owner saw on his
phone came from heat these races do not produce (his own build and engine, a damaged engine, a
fire or a heat status, sustained full throttle), not from the guns' own 2 heat a burst.

**Proposed, not applied (weapon balance is the owner's call): a magazine for the three bullet
guns.** The smallest change measured that brings them in, one number each, all other parts
untouched: Front Machine Gun 12 bursts a race, Rear Sentry 8, Swivel Turret 8 (`charges`).
A shipped build's gun fires 4.2 bursts in an average race, so the magazine only binds when two
cars stay together, which is exactly when the gun dominates. Measured with the tow on, four
seeds (`npx tsx tests/tools/weaponFixProbe.ts ammo`), against the tow on as shipped:

| Measure | As shipped | With the magazine | 2 damage a round | 4x heat a burst | Cooldown 1.5x |
| :-- | --: | --: | --: | --: | --: |
| Bench, Front Machine Gun, against median | 7.64x | 4.76x | 6.88x | 7.64x | 6.79x |
| Bench, Swivel Turret | 8.07x | 3.97x | 5.94x | 8.07x | 8.35x |
| Bench, Rear Sentry | 3.05x | 2.01x | 2.83x | 3.05x | 3.38x |
| Bench, Front Machine Gun wins against its twin | 100% | 75% | 100% | 100% | 100% |
| Shipped builds, Front Machine Gun | 3.96x | 3.13x | 3.01x | 3.61x | 3.33x |
| Upgrade test, upgraded twin's wins (six pairs) | 100 50 100 50 100 63 | 100 100 100 50 100 75 | 100 100 100 0 75 62 | 100 50 100 50 75 62 | 100 100 100 0 88 75 |
| Lap 1 leader wins | 93% | 94% | 92% | 94% | 92% |
| Seconds within 220 px a race | 15.1 | 15.4 | 14.8 | 15.1 | 14.9 |
| Weapon activations a race | 6.1 | 4.7 | 6.4 | 5.8 | 5.1 |
| Damage a race | 73 | 62 | 57 | 72 | 63 |
| Builds outside 30 to 70% | 6 | 7 | 6 | 6 | 6 |

The magazine halves the guns' bench lead and is the only change that improves the upgrade test
without breaking a pair; its cost is fewer activations a race (the guns fall silent in a long
duel). Cutting damage a round barely moves the bench (a twin in company loses what it has to
lose either way) and turns the Sprinter Slicks pair to 0 percent. Four times the heat a burst
raises peak heat to 82 to 89 and still never reaches protection at 110: heat as the limit would
need a much larger number or a lower threshold for weapons, a larger change. Not applied.

## 0.6.0 (combat parameters and the first combat balance pass, October 11, 2026)

The first version in which weapons, defenses and utilities do something in a race. No price
and no mass changed. Reports: `docs/evidence/balance/` (before and after, clear and rain),
produced by `npx tsx tests/balance/report.ts`. See `docs/DECISIONS.md` entries 104 to 123.

**Added parameters.** Every active part gained the numbers its behaviour needs that the spec
table does not give: spread, projectile speed and radius, lock and wind-up times, blast and
hazard radii, hazard lives, live caps, drop distances, impulses. They are in `params` in
`packages/content/src/weapons.ts` and `utilities.ts`, and each is asserted by a test in
`tests/unit/combatParts.test.ts`. The spec's own numbers (damage, cooldown, range, charges)
are unchanged.

**How it was measured.** Sparring brain against sparring brain on Neon Cut. (1) Every starter
and example build against every other from both grid slots, four seeds, 440 races. (2) A
weapon bench: one copy of each of the twenty weapons on a stock Spider against the same
Spider carrying ballast instead, from both grid slots, four seeds. Only seven weapons are on
a shipped build, so the bench is the only measure of the other thirteen. Both cars are driven
by the same simple driver, so these compare builds and weapons, not drivers.

**Tuned.**

| Part | 0.5.0 | 0.6.0 | Why |
| :-- | :-- | :-- | :-- |
| Front Machine Gun, Rear Sentry | spread 6 degrees | spread 8 degrees | The cheapest guns dealt the most damage per credit by a wide margin |
| Front Machine Gun, Rear Sentry, Swivel Turret | full damage to 220 px | full damage to 110 px, falling to 60 percent at 220 px | The same. A follower sits at 110 to 220 px for most of a lap |
| Decoy Drone | dropped 14 px behind the centre (inside the hull) | dropped 46 px behind | A missile from behind reached the car before the drone |

**Before and after** (clear night, four seeds).

| Measure | 0.5.0 numbers | 0.6.0 |
| :-- | --: | --: |
| Front Machine Gun, damage per 100 credits, shipped builds | 57.3 (3.85x median) | 55.3 (3.07x) |
| Rear Sentry, shipped builds | 34.4 (2.31x) | 31.3 (1.74x) |
| Front Machine Gun, bench | 232.5 (11.1x) | 222.8 (9.7x) |
| Swivel Turret, bench | 258.2 (12.3x) | 235.2 (10.3x) |
| Rear Sentry, bench | 86.5 (4.1x) | 88.8 (3.9x) |
| Mean race length | 120.2 s | 120.2 s |
| Knockouts in 440 races | 0 | 0 |
| Cars whose chassis reached zero, of 880 | 12 | 17 |

**What the numbers say, plainly.**

- *Races are decided by pace, not by combat.* The win-rate order is the lap-time order of
  the Milestone B table: Straight-Line Rocket 100 percent, Sprinter 90, Tiny Trouble 80,
  Tinker 70, Back-Alley Trap 60, Rain Runner 50, Longlegs 35, Packhorse 30, Rookie 25, Dust
  Spider 10, Iron Mule 0. Six builds are outside 30 to 70 percent and are flagged. Two cars
  of different pace separate within a lap, and a weapon with 220 px of reach then has
  nothing to shoot: the Front Machine Gun fires 2.9 bursts in an average race. Seeds barely
  move the result, because the sparring driver is consistent. This is the main finding. It
  is not something weapon numbers can fix, and it was not tuned: it needs the tracks,
  shortcuts and track-side repairs of Section 3.4's "competition stays close" and an AI that
  fights for position (Milestone D), and then a second pass.
- *Sustained fire from the cheap guns is the strongest thing in the catalog when two cars do
  stay together.* On the bench the turret and the machine gun win every race against an
  unarmed twin; the turret brings its chassis to zero in half of them and the machine gun in
  a quarter. Measured before the falloff, a parked Beetle 150 px ahead lost its engine to a
  Front Machine Gun in 9 s of uninterrupted fire and its chassis in 22 s. Weapons with
  charges cannot exceed charges times damage (Straight Rocket 110, Seeker 60, Arc Mortar 75),
  and weapons on a cooldown scale with time in contact. The falloff above takes 10 to 20
  percent off; the flags remain (turret 10.3x, machine gun 9.7x, sentry 3.9x, railgun 2.9x,
  rocket 2.2x the bench median). Closing this properly is a design choice, not a modest
  retune, and is left for the owner: ammunition for the bullet guns, more heat per burst,
  or a lower chassis share (40 percent of component damage today).
- *Short-range weapons are under-measured.* The Road Shotgun, Flame Spitter, Crash Hammer and
  Air Cannon fired once every other bench race: the sparring driver follows at 110 to 220 px
  and they reach 90 to 110. Flame Spitter is flagged at 0.28x the median and the shotgun sits
  at 0.52x; both numbers say more about the driver than the weapon. Not tuned.
- *Control weapons* (Oil Slick, Sticky Foam, EMP Pulse, Frost Cannon, Grapple Harpoon, Air
  Cannon) are measured but not compared on damage. Only the harpoon changed who won on the
  bench (88 percent). The others cost the victim under a second.
- *In the rain* (220 races, two seeds) the order is the same with Sprinter ahead of the
  Rocket; the Tesla Arc's wet range more than doubles its bench damage; the Road Mine drops
  to 0.43x on shipped builds.

## 0.5.0 (facing is the player's choice, October 11, 2026)

No price, mass or coefficient changed, and the measured table of every shipped build below
is unchanged. What changed is what a part's footprint means, so the version moved: a
blueprint stamped 0.4.0 is flagged as out of date and its `Repair Build` turns parts to a
legal facing and removes none (`refaceBlueprint`). See `docs/DECISIONS.md` entry 99.

**The rule.** A part says how its direction is decided (`facing`: `free`, `fixed` or `none`).
A free part occupies a square base, the smaller side of its footprint, at every quarter
turn; the mount says which ways it may face. A fixed part or one with no facing occupies its
footprint as it lies.

**Mount facings (free parts).**

| Mounts | 0.4.0 | 0.5.0 |
| :-- | :-- | :-- |
| Front (Beetle, Arrow and Trike nose) | front, left, right | front |
| Rear (Beetle and Arrow tail, Pickup tailgate, Trike rear pair) | rear, left, right | rear |
| Pickup bed rails `left_bed`, `right_bed` | rear, left, right | rear, outward |
| Left and right (Spider flanks) | outward, front, rear | unchanged |
| Roof, universal (Pickup bed), utility | all four | unchanged |

**Part data.**

| Part | 0.4.0 | 0.5.0 |
| :-- | :-- | :-- |
| 13 weapons, Light Plates, Heavy Plating | rotatable | `free` |
| Swivel Turret | rotatable | `none`: it tracks all round, so its rest direction means nothing |
| Road Mine, Oil Slick | not rotatable, kept at turn 0 | `fixed`, turn 2 (they drop behind) |
| Rear Guard | not rotatable, turn 0 | `fixed`, turn 2 |
| Crash Bumper, Mine Sweeper | not rotatable, turn 0 | `fixed`, turn 0 |
| Side Saw | not rotatable, turn 0, footprint 6 x 14 | `fixed` outward, footprint 14 x 6 at turn 0 (6 x 14 on a flank, as before) |
| Side Shields | not rotatable, turn 0, footprint 5 x 14 | `fixed` outward, footprint 14 x 5 at turn 0 (5 x 14 on a flank, as before) |
| Everything else | not rotatable | `none` |

**Legality.** Every one of the 884 combinations of chassis, mount and part that could be
installed under 0.4.0 can still be installed (`tests/unit/facing.test.ts` holds the list,
generated before the change). Thirty-two new ones can, all because a long part now stands on
its base and lets its barrel overhang:

| Part (footprint, base) | Newly fits |
| :-- | :-- |
| Needle Railgun (8 x 18, base 8) | Beetle hood and roof; Arrow nose and rear roof; Pickup cab roof; both Spider roofs; Trike nose and roof. Before, only the Arrow spine and the Pickup bed. |
| Straight Rocket, Frost Cannon, Grapple Harpoon (8 x 14, base 8) | Arrow rear roof; Pickup bed rails; Trike rear pair |
| Flame Spitter (8 x 14, base 8) | Pickup bed rails; Trike rear pair |
| Seeker Missile (10 x 14, base 10) | Arrow rear roof |
| Crash Hammer (12 x 16, base 12) | Arrow nose |
| Side Saw, Side Shields | Pickup bed rack (`bed_front`), where they work backward like everything fixed on the bed |

The railgun is the one to watch: it was the Arrow's own weapon (0.4.0 lengthened the spine
for it) and now goes on four frames. Its price (and the Trike's load limit) are what hold it
back; nothing was retuned in this version.

**Facing a part can no longer take.** A free part on a nose mount could face left or right,
and on a tail mount sideways; several only fitted that way (a 12-wide plate on the Trike's
10-wide nose). Those now face forward or backward. A turret could be turned; it no longer
is.

**Templates.** Three shipped builds carried a fixed part at turn 0 and now carry it at turn
2: Packhorse (Rear Guard), Iron Mule (Oil Slick), Back-Alley Trap (Road Mine). Nothing else
in any template moved, and their build hashes changed only by that turn and the catalog
stamp.

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
