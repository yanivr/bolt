# Combat API (Milestone C part 1)

What the combat simulation provides, for whoever builds on it: the rendering, the HUD and the
sound of Milestone C part 2, and the AI of Milestone D. Everything here is data and timing.
Nothing here is art; the client's present combat drawing (`CombatDebugView`) is a stand-in.

All code is in `packages/shared/src` (rules, no content) and `packages/content/src` (numbers).
Positions are world pixels. Headings are radians, 0 up (negative y), clockwise. A car's own
frame has `x` to its right and `y` toward its rear. Time is ticks: 30 a second, 33.3 ms each.
Snapshots are 15 a second.

## Where things are

| File | What it holds |
| :-- | :-- |
| `race.ts` | `createRace`, `stepRace`, `resetRace`, standings, results, snapshot builders, `eventVisibleTo` |
| `tow.ts` | The tow, the long-range catch-up: the gap measure, the bonus curve, the decision. Its numbers are `TOW` in `balance.ts` |
| `combat/specs.ts` | `compileModules`: a mounted part's catalog `params` to the numbers the simulation runs on |
| `combat/car.ts` | Components, statuses, driving effects, the damage pipeline (`applyHit`), repairs, impulses, energy |
| `combat/weapons.ts` | Fire input, targeting, the weapon lifecycle, one `release` per primitive |
| `combat/entities.ts` | Projectiles, hazards, explosions, interceptors, sweepers, decoys |
| `combat/systems.ts` | Utilities, burn, shields, tether, capacitor, stuck detection, car against car |
| `combat/geometry.ts` | Hull and arc tests, swept hits, line of sight, car contact |
| `ai/brain.ts`, `ai/sparring.ts` | The `RaceBrain` seam and the sparring rival |
| `scenario.ts`, `content/scenarios.ts` | Scripted showcase scenarios |
| `protocol.ts` | Input sample, events, snapshots: the wire contract. `PROTOCOL_VERSION` is 6 (6: the eight tracks and their weathers, Milestone D phase 0) |

## The step

`stepRace(race, inputs)` advances every car, projectile and hazard by one tick and leaves the
tick's events in `race.events`. It is a pure function of the race and the inputs: the same
blueprints, track, weather, seed and input sequence give the same bits, on the server, in the
page and in a test. Order inside a tick (Section 11.8):

0. The tow: every car's gap to the racing car ahead is measured before anything moves, and its
   bonus moved on (see "The tow" below).
1. Input and activation requests: utilities, then weapons. Refusals are decided here.
2. For each car: effects from damage and statuses, then power, heat and motion
   (`stepDriveSession`), then the winch. Checkpoints, laps and finishes are reported.
3. Car against car: separation, mass-aware exchange of speed, ram damage, blades.
4. Interceptors, projectiles (swept against cars and solid edges), sweepers, hazards.
5. Systems: burn pulses, status clocks, shields, repairs in progress, the tether, the capacitor,
   stuck detection, lock warnings.
6. Knockouts, the leader, the finishing window, the time limit, the result.

Randomness is seeded: `race.rng` (misfires of a damaged weapon) and one generator per brain.

## Entities

**Car** (`CombatCar`). A drive session (motion, powertrain, progress) plus:

- `chassis` and `chassisMax`. Zero chassis is limp mode (drive x 0.6), not removal.
- `components`: engine `0`, steering `1`, wheels `2..`, then one per mounted part in canonical
  blueprint order. Integrity 0 to `maxIntegrity` (100 for most). Conditions (Section 8.1):
  healthy above 65, damaged above 20, critical above 0, disabled at 0. A disabled mounted part
  stops working and stays as weight; the car's coefficients are re-derived without it, on the
  server and in the client predictor alike.
- `armor[4]`: points per arc, front, right, rear, left. A pool of its own, not chassis.
- `statuses`: one slot per family (below).
- `modules`: one per mounted part, with the Section 8.3 lifecycle state
  (`0` idle, `1` targeting, `2` active, `3` cooldown, `4` disabled), `charges` (-1 unlimited),
  `cooldown`, `aim`, `locked`, `pool`.
- `reserve`: energy in the Burst Capacitor.

**Projectile.** Kinds `bullet`, `pellet`, `rocket`, `missile`, `frost`, `harpoon`,
`boomerang`, and the lobbed `foam` and `shell`, which fly over cars and walls and land on a
marked spot at a known tick. Everything else is swept every tick against car hulls and the
track's solid edges, so nothing tunnels. A projectile inherits its car's velocity at launch.
At most 64 live.

**Hazard.** Kinds `mine`, `oil`, `foam`, `fire`, `frost`, `decoy`. Round, or a strip
(`halfLength`, `angle`). At most 48 live, and a live cap per racer and kind from the part
(six mines): past it the oldest goes. Rain shortens fire and lengthens nothing; see
`HAZARD_LIFE_WEATHER`. A hazard an enemy laid is `revealed` to a driver only within 90 px,
or 210 px with a Mine Detector; its own are always revealed.

**Tether.** One per car: the harpoon's line to the other car.

## Input

An input sample (`inputSampleSchema`) carries, besides steering, brake and coast:

| Field | Range | Meaning |
| :-- | :-- | :-- |
| `fire` | 0 to 3 | Bit 0 primary fire button, bit 1 secondary. Held state, sampled every tick |
| `use` | 0 to 255 | One bit per manual utility, in blueprint order (`CombatCar.manualUtilities`) |
| `target` | 0 to 63 | Repair target: 0 automatic, otherwise component index + 1 |

All three are optional and default to 0, and the schema is strict: a sample carrying anything
else (ammunition, cooldowns, damage) is malformed and dropped whole. The client sends buttons;
it never sends shots, hits, ammunition or damage.

A press is a rising edge. A weapon bound to a button in the blueprint (`fire: 0` or `1`) is
asked to fire on the press; a tracking or charging weapon keeps its request while the button
is held. A button held through the countdown counts as pressed at GO. Weapons bound `'auto'`
and automatic weapons need no button. Keyboard in the client: Space primary, E secondary, R
repair (the first Repair Kit or Spare Wheel), digits 1 to 8 the manual utilities. On screen:
plain debug buttons in the HUD (`HudActions`) until part 2 replaces them.

A command that does nothing says why, to its own driver only, as a `refused` event:
`no_weapon`, `cooldown`, `no_ammo`, `low_power`, `overheat`, `disabled`, `jammed`,
`no_target`, `not_needed`, `busy`.

## Damage

`applyHit(race, car, hit)`, in order:

1. The hit's class (`bullet`, `direct`, `heavy`, `ram`, `burn`) and the arc it lands on select
   the passive reductions that apply (ceramic against bullets, bumpers against rams, and so on).
2. Reactive Foam takes its share of a heavy hit, once per cooldown.
3. The Energy Shield takes up to its pool. Not against rams or burn, and not while under EMP.
4. Breakaway Armor takes what is left of its pool, once a match.
5. Arc armor absorbs, less what penetrates (the railgun: half). A worn plate lets a share
   through: at 60 percent of its points it stops 80 percent of the hit, never under half.
6. What remains is the damage. It goes to the component nearest the hit point, if one is within
   15 px; with penetration, half as much again to the next module. 40 percent of it also goes
   to the chassis. A hit on bare bodywork puts 70 percent on the chassis and none on a component.

The `hit` event reports every one of those numbers. Localisation is by position: a hit on the
rear left lands on what is at the rear left (Section 8.1).

**What damage does.** Continuous with integrity and capped (`computeEffects`):
a damaged engine loses output down to 50 percent and runs hotter; damaged steering loses
response (to 55 percent) and gains a little lag; a damaged wheel loses local grip and pulls
the car to its side (up to 12 percent steering bias), and a dead one still rolls at 35 percent;
a damaged weapon reloads up to 60 percent slower and below critical may misfire (25 percent,
`misfire` event, a short delay and no shot).

**Knockout.** Chassis at zero and two of the three core systems (engine, steering, half the
wheels) disabled, continuously for three seconds: `ko`, and in a duel the result at once with
reason `ko`. There is no respawn. In 440 bot races it happened in none.

## Statuses

One slot per family. A new application takes the larger magnitude and the later end.

| Family | Magnitude | Effect | Applied by |
| :-- | :-- | :-- | :-- |
| `slow` | 0 to 0.45 (capped) | Top speed held to that share below the speed it was caught at, eased in | Mine, Sticky Foam |
| `grip` | 0 to 0.6 (capped) | Grip lost | Oil Slick, Frost Cannon, frost patch |
| `burn` | damage per second | A `burn` hit every third of a second, heat into the car | Flame Spitter, fire on oil |
| `emp` | 1 | No weapons, no powered equipment, shield down | EMP Pulse |
| `jam` | 1 | No weapons; powered equipment keeps running | Tesla Arc |
| `boost` | 0.5, 0.6 | More engine force | Emergency Booster, Nitro Tank |
| `refit` | 0.2 | Less acceleration while a repair is under way | Spare Wheel, Repair Kit |
| `airborne` | 1 | Off the ground: no grip, no traps, no firing | Jump Pad |
| `immune` | 1 | No new `emp` or `jam`, no new major shove | Granted by the game |

Section 8.1's rule against chain-stuns: a hard disable (`emp`, `jam`) grants `immune` for its
own length plus two seconds, and a major forced shove (the hammer, the air cannon, a mine's
kick over 90 px/s) grants two seconds. A refused application is a `status` event with state
`blocked`. Damage is never blocked, only the control effect.

## Snapshots

`raceSnapshot(race, viewer, ack)` is everything one driver may be shown (`RaceSnapshot`).
The server room writes the same fields through its synchronized schema
(`apps/server/src/rooms/schema.ts`); the offline link builds the object directly.

| Field | Contents |
| :-- | :-- |
| `tick`, `phase`, `raceTimeMs` | The race clock. `phase` is `COUNTDOWN`, `RACING` or `FINISHED` |
| `car` | The viewer's own car: exact motion and powertrain (for prediction), `effects`, `combat` and `tow` |
| `car.tow` | The tow: the share of its whole bonus (`TOW.maxBonus`, 8 percent of top speed) the car has right now, 0 to 1 in steps of 0.01. Exactly 0 when the car is not being towed: the leader, a car within `TOW.thresholdGap` (1.0 s) of the car ahead, the countdown and the first 5 s, a wrecked, finished or knocked-out car. Not `car.effects.tow`, which is the bonus itself as a share of top speed, for prediction |
| `car.combat` | `chassis`, `chassisMax`, `armor[4]`, `components[]`, `statuses[]`, `modules[]`, `reserve`, `lockWarning` (0 none, 1 locked, 2 missile inbound), `ko` |
| `car.combat.modules[i]` | `state`, `charges`, `readyTick`, `cooldownTicks`, `aim`, `locked`, `pool` |
| `rival` | The other car as seen from outside: pose, speed, steering, braking, lap, progress, chassis, armor, component integrity, statuses, and per part only `state`, `aim` and whether a shield is `up`, and its own `tow` (same meaning as `car.tow`). Never its heat, energy, ammunition or cooldowns (Section 7.5) |
| `rivalBlueprint` | Canonical JSON of the rival's blueprint, to draw it |
| `projectiles[]` | `id`, `kind`, `owner`, `x`, `y`, `vx`, `vy` (px/s) at `tick`; `landTick` for lobbed kinds |
| `hazards[]` | `id`, `kind`, `owner`, `x`, `y`, `radius`, `halfLength`, `angle`, `armedTick`, `endTick`, `revealed` |
| `position`, `gapMeters`, `gapSeconds` | 1 for the leader. The gap is positive when the viewer is ahead |
| `rivalTracked` | Whether the rival is within 600 px, or 900 px with Radar: whether a minimap may show it |
| `finishWindowEndTick` | Set once a car has finished: when the eight seconds run out |
| `result` | `RaceResult` once the race is over: winner (-1 a draw), reason, and per car finish time, progress, chassis, KO and damage totals |

Ballistic projectiles are written once and never again: a client moves them from `x`, `y`,
`vx`, `vy` and `tick`. Missiles and boomerangs steer and are rewritten every snapshot.
Hazards are written when placed and when they change.

**Measured size** (`tests/integration/snapshotSize.test.ts`, the room's own schema and
encoder, whole races): the join state is 1.2 to 1.9 kB; a patch is 159 bytes on average in
the heaviest shipped pairing (p95 212, worst 290), 151 in a race with no weapons. At 15 Hz
that is about 19 kbit/s.

## What the HUD can read

Everything a HUD needs is in the snapshot of the viewer's own car and in events; none of it
needs the simulation.

- Fire buttons: for each bound weapon `modules[i].state`, `charges`, and a cooldown dial from
  `readyTick` and `cooldownTicks`. `locked` for a lock light, `aim` for a turret.
- Utilities: the same fields. A repair in progress is `state` 2 and a `refit` status.
- The damage silhouette: `components[]` by index, `armor[4]`, `chassis`. The `component`
  event names each change of condition.
- Statuses: `statuses[]` with `untilTick` for a countdown.
- Shield: `modules[i].pool` and `shield` events. Capacitor: `reserve`.
- Heat and energy: `car.motion.coreHeat` and `batteryEnergy`, as before.
- Warnings: `lockWarning`, and `warning` events with `value` ticks to impact for a missile.
- Position and gap, the finishing window, the result.
- The tow: `car.tow`, 0 to 1, for an indicator; the `catchup` event for the moment it takes
  hold and the moment it lets go. `rival.tow` is the same number for the other car. Both are
  in hundredths on the wire (`tow`, uint8, on the room state and on its `rival`) and divided by
  100 by the online link, so the HUD reads the same 0 to 1 online and offline.
- Why a button did nothing: the `refused` event.

## Predicted and authoritative

The server is the authority for everything. The client predicts exactly one thing: the motion
of its own car, by replaying its unacknowledged input on the last snapshot. Combat reaches
that prediction only through numbers the snapshot carries:

- `car.effects` (`VehicleEffects`): what damage and statuses are doing to drive, top speed,
  grip, steering and power this tick. The predictor uses the snapshot's values for the ticks
  it replays, so a slow or a grip loss is felt one snapshot late and never fought.
- Disabled parts: the predictor re-derives the car's coefficients without them, as the server does.
- The rival's body: the predictor keeps a ghost of the rival, advanced on its last known
  velocity, and resolves contact against it so a ram does not rubber-band.

- The tow is the one effect that is predicted, and exactly. It depends on where the rival is,
  which the client only hears about, so the server decides it on a slow clock (every
  `TOW.updateSeconds`, half a second) and each decision takes effect one period after it is
  made. `car.effects` carries `tow` (the share of top speed the car has now), `towTarget` (what
  it is moving toward) and `towNext` (what it will move toward from the next decision tick), and
  the predictor moves them on with `advanceTow`, the function the race uses. Measured with a
  delay each way on the wire and the tow coming on, building, fading and going off
  (`tests/unit/towPrediction.test.ts`), against the same race with the tow switched off over
  the same ticks (about 1,460 client ticks, the tow taking hold, building, fading and letting
  go): at 100 ms and at 200 ms each way the towed car is corrected exactly as often and by
  exactly as much as the car without the tow, which is never (not one reconciliation moved the
  car by any distance at all). At 400 ms each way, where the client is more than one period
  ahead of its last snapshot, the tow adds 18 corrections, the largest 0.055 px (0 without it).
  A client that ignored the three numbers would be corrected 469 times, by up to 0.15 px.

Not predicted, and so shown when the server says: firing (a shot appears with its `shot`
event; there is no client-side muzzle flash ahead of the server), hits, damage, statuses,
hazards, the rival's motion (interpolated between snapshots), repairs. Impulses on the
viewer's own car arrive as a correction. Part 2 may want a predicted muzzle flash for fixed
guns; the data to do it honestly is `modules[i].state` and `readyTick`.

In this milestone the room advances its race once per input sample of its one human driver,
so the offline link and the server run the same race tick for tick (asserted for all 33
scenarios through a real room). A room with two human drivers must step on its own clock
instead; that is Milestone E, and the seam is `InputPacer`.

## Events

Every event has `id` (increasing, never reused in a room, across resets and reconnects) and
`tick`. Each is sent once, in order. Events that are for one driver only (`refused`,
`warning`, `checkpoint`) are not sent to the other. While a connection is down its events are
held, up to 512, and delivered in order on reconnection. `car` is the car the event belongs
to, `by` the car that caused it, `part` an index into that car's mounted parts, `weapon` a
catalog id (or `ram`, a tire kit id for blades).

| Event | Payload | When, and what follows |
| :-- | :-- | :-- |
| `checkpoint` | `car`, `index` | The car crossed its next gate. Own driver only |
| `lap` | `car`, `lap`, `lapTimeMs` | A lap completed; on the last lap, followed in the same tick by `finish` |
| `finish` | `car`, `raceTimeMs`, `finished` | The car crossed the line, or (`finished: false`) the race ended without it |
| `wall` | `car`, `speed` | A wall or obstacle struck above the forgiven speed. At most every quarter second |
| `position` | `leader`, `gapMeters` | A new leader, once the lead is six pixels |
| `catchup` | `car`, `state` | The tow took hold of a car (`engaged`: its `tow` left zero) or let go of it (`released`: back at zero). The two alternate for a car, and a car sends at most one every `TOW.eventMinSeconds` (3 s), so a later one can be up to that late. Sent to both drivers. A race can end with a car still engaged: the snapshot, not the event, is the state |
| `windup` | `car`, `part`, `weapon`, `ticks` | A weapon began charging or drawing back. Its release follows `ticks` later, unless an EMP cancels it |
| `shot` | `car`, `part`, `weapon`, `x`, `y`, `dir`, `projectile`, `n`, `of` | Something left a weapon, at its muzzle. `projectile` is 0 when nothing flies. One per round of a burst |
| `beam` | `car`, `part`, `weapon`, `x`, `y`, `toX`, `toY`, `hit` | An instant line: railgun, Tesla arc, interceptor, sweeper. The `hit` event, if any, is in the same tick |
| `area` | `car`, `part`, `weapon`, `x`, `y`, `dir`, `half`, `range`, `ticks` | A cone or ring that lasts `ticks`: flame, air blast, hammer swing, EMP ring |
| `telegraph` | `car`, `part`, `weapon`, `x`, `y`, `radius`, `ticks`, `projectile` | A mark on the ground. The landing is exactly `ticks` later |
| `lock` | `car`, `part`, `weapon`, `target`, `locked` | A tracking weapon gained or lost its target |
| `warning` | `car`, `kind`, `by`, `value` | For one driver: `lock`, `lock_lost`, `missile` (`value` ticks to impact: sent at 15 or fewer, 30 or fewer with Radar), `trap` (`value` the hazard id, with a Mine Detector) |
| `hit` | `car`, `by`, `weapon`, `cls`, `x`, `y`, `component`, `damage`, `chassis`, `shield`, `armor`, `absorbed`, `projectile` | Damage landed. Emitted even when shield or armor took all of it |
| `explosion` | `by`, `weapon`, `x`, `y`, `radius`, `projectile` | A blast, after the `hit` events it caused in the same tick |
| `impact` | `weapon`, `x`, `y`, `projectile`, `on` | A projectile ended without striking a car: `wall`, `obstacle`, `ground`, `expired`, `caught`, `intercepted`, `scrambled` |
| `status` | `car`, `by`, `family`, `state`, `magnitude`, `ticks` | `applied` (also when strengthened), `expired`, or `blocked` by immunity |
| `impulse` | `car`, `by`, `weapon`, `dx`, `dy` | The car was shoved: the change of velocity in px/s |
| `component` | `car`, `component`, `condition`, `integrity`, `repaired` | A component changed condition, either way |
| `shield` | `car`, `part`, `state`, `points` | `down` (hit, or EMP), `up` (recharged), `broken` (breakaway armor gone) |
| `hazard` | `hazard`, `kind`, `by`, `state`, `x`, `y`, `car` | `placed`, `armed`, `triggered`, `expired`, `cleared`, `ignited` (oil to fire), `melted` (frost by flame) |
| `tether` | `car`, `part`, `target`, `state` | `attached`, `released` (time, distance, EMP or end of race) |
| `utility` | `car`, `part`, `utility`, `state`, `value` | `started`, `done`, `interrupted`. `value` is the component for a repair, ticks for a timed effect |
| `misfire` | `car`, `part`, `weapon` | A badly damaged weapon failed to fire |
| `refused` | `car`, `part`, `reason` | A command did nothing. Own driver only. `part` is -1 for a button with no weapon |
| `ko` | `car`, `by` | Knocked out |
| `result` | `winner`, `reason` | The race is over. Always the last event |

## The tow

The long-range catch-up, by product-owner decision (`docs/DECISIONS.md` 189 to 198). A car that
trails the racing car ahead of it by more than the edge of fighting range runs with a little
more top speed, more the further back it is. Inside fighting range it has exactly none, so the
final approach and the pass are driving, the build and weapons alone. The car ahead is never
slowed, never told apart from any other car and never changed in any way (asserted to the bit:
a leader that is never caught drives the same race with the tow on and off). The rule is the
same for the player, the sparring rival and any later driver, and it is part of `stepRace`, so
the server, the offline link, the harness and the tests all run it. It reaches the physics only
through `VehicleEffects.tow`, and `stepVehicle` reads it only when it is above zero, so a car
with no tow drives exactly as it did before the tow existed.

**The gap.** For each car, the nearest car ahead of it along the course that is still racing
(not finished, not knocked out). The distance between them is the difference of
`courseProgress`, the same distance along the course as the snapshot's `gapMeters` (in pixels
rather than meters). It only counts checkpoints crossed forward and runs on across laps, so it
neither jumps at the start line nor rewards a car pointed the wrong way. The time gap is that
distance divided by the trailing car's own speed averaged over about three seconds
(`TOW.speedAverageSeconds`), never taken as less than `TOW.speedFloor`. The snapshot's
`gapSeconds` divides by the speed of this very tick instead, and moves with every lift; the
average keeps a lift or a corner from moving the bonus.

**Across laps.** A car a lap or more down is measured by the course like any other and gets the
whole bonus. The leader coming up to lap it gets none: the car it is catching is behind it on the
course, not ahead.

**Where the threshold comes from.** The eleven shipped builds race Neon Cut at 247 px/s on
average (216 to 282: course length over race time, alone, weapons off, tow off), so a gap of
1.0 s is about 250 px of road. Eight of the twenty weapons reach 220 px, among them both bullet
guns, the Swivel Turret, both rockets and the Frost Cannon; the Arc Mortar reaches 320 and the
Needle Railgun 350. At the threshold the trailing car is just outside the reach of the common
guns and inside the reach of the two longest weapons: the edge of the fight.
`tests/unit/tow.test.ts` measures the speed and reads the ranges from the catalog, and fails if
the threshold leaves that band.

**The bonus.** Zero at and below `thresholdGap`; from there a straight line to the whole bonus
at `fullGap`. A tow that is off starts only once the gap reaches `engageGap`, then follows the
line down to exactly zero at the threshold, so it cannot flicker at the edge. The bonus stretches
the speed axis of the engine's force and of the drag by `1 + tow`, which raises top speed by
that share and leaves grip, braking and steering alone; it follows the throttle (a car that has
lifted or is braking slows exactly as it would without it) and fades in between
`fadeStartSpeed` and `fadeFullSpeed`, so a launch and the drive out of a slow corner are
untouched (the launch is bit-identical until the car reaches 140 px/s).

**The clock, and why it cannot oscillate.** Every `updateSeconds` each car's bonus is decided
from its gap, and the decision takes effect one period later. The gap it is decided on is carried
forward a period and a half at the rate it changed since the last decision (at most half a
second either way), so a car closing quickly is let go as it reaches the threshold, not after.
In between, the bonus moves toward the decision in force at no more than `rampUpPerSecond` or
`rampDownPerSecond` of the whole bonus a second: no step a driver could feel as a surge. With
the engage gap above the threshold, a car sitting at the edge is either towed or not; it is
never switched on and off. Measured: a car's `catchup` events never come closer than
`eventMinSeconds` together, and in the balance report's 440 armed races and the tow study's
440 unarmed ones no change of the lead was made by a car that had any tow in the second before.

**Who has none.** Everybody during the countdown and the first `startDelaySeconds` of the race.
The leader, and any car with nobody racing ahead of it. A car inside the threshold. A car that
has finished or been knocked out (taken off at once, not ramped). A wrecked car, its chassis at
zero, limping (nothing more is decided for it, and what it had ramps away at the usual rate;
chassis is never repaired, so it is for the rest of the race). A car that has been driving the
wrong way for 1.2 s. A car in the air keeps its level but nothing acts on it: the integrator
applies no drive and no drag off the ground. A race created with `tow: false` (`RaceOptions`)
has none at all: the 33 combat scenarios, and tests of other things.

**The sparring rival** never reads the tow (asserted: its every control is the same when every
number of the tow is replaced with nonsense), so it cannot hang back to collect it. It drives
its fastest line every lap.

**The table** (`TOW` in `packages/shared/src/balance.ts`; nothing else holds a number of the tow):

| Field | Value | Meaning |
| :-- | --: | :-- |
| `thresholdGap` | 1.0 s | At and below this gap the bonus is exactly zero |
| `engageGap` | 1.15 s | A tow that is off starts here |
| `fullGap` | 2.5 s | The whole bonus from this gap |
| `maxBonus` | 0.08 | The whole bonus: 8 percent of top speed |
| `rampUpPerSecond` | 0.5 | Rise, in whole bonuses a second (zero to all of it in 2 s) |
| `rampDownPerSecond` | 1 | Fall (all of it to zero in 1 s) |
| `startDelaySeconds` | 5 | No decision before this race time; none in the countdown |
| `updateSeconds` | 0.5 | Decided this often, in effect one period later |
| `speedAverageSeconds` | 3 | Time constant of the trailing car's average speed |
| `speedFloor` | 120 px/s | The least that average counts as |
| `fadeStartSpeed`, `fadeFullSpeed` | 140, 200 px/s | No bonus below the first, all of it from the second |
| `eventMinSeconds` | 3 | Least time between two `catchup` events of one car |

So `tow` (the snapshot's share) is 0 up to 1.0 s, 0.33 at 1.5 s, 0.67 at 2.0 s and 1 from
2.5 s, which is 2.7, 5.3 and 8 percent more top speed.

How these were chosen, every setting that was tried and what each measured:
`docs/evidence/balance/tow-study.md`; the shipped table against the tow off, with the four
targets, the matchup matrix and the upgrade test: `docs/evidence/balance/tow-0.6.0-clear.md`.
`npx tsx tests/balance/towStudy.ts` measures a setting; `npx tsx tests/balance/report.ts`
writes the report.

## One activation of each weapon

Measured from the weapon scenarios (`npx tsx tests/tools/combatTimelines.ts` prints this
table). Ticks are after the first event of the activation; the target is a parked or slowly
cruising Beetle at the scenario's range, so flight times are for that range.

| Weapon | Events of one activation, with ticks after the first (30 ticks a second) |
| :-- | :-- |
| Front Machine Gun `weapon_front_mg` | `shot` x2 +0 to +3 (0 to 100 ms), `hit bullet` +3 (100 ms), `shot` +6 (200 ms), `hit bullet` +6 (200 ms), `shot` +9 (300 ms), `hit bullet` +9 (300 ms), `shot` +12 (400 ms), `hit bullet` x2 +12 to +15 (400 to 500 ms) |
| Rear Sentry `weapon_rear_mg` | `windup` +0 (0 ms), `shot` +8 (267 ms), `hit bullet` +10 (333 ms), `shot` +11 (367 ms), `hit bullet` +13 (433 ms), `shot` +14 (467 ms), `hit bullet` +16 (533 ms), `shot` +17 (567 ms), `hit bullet` +19 (633 ms), `windup` +96 (3200 ms) |
| Swivel Turret `weapon_turret` | `lock` +0 (0 ms), `shot` x2 +13 to +16 (433 to 533 ms), `hit bullet` +16 (533 ms), `shot` +19 (633 ms), `hit bullet` x2 +19 to +22 (633 to 733 ms) |
| Road Shotgun `weapon_shotgun` | `shot` x8 +0 (0 ms), `hit bullet` x8 +0 (0 ms) |
| Needle Railgun `weapon_railshot` | `windup` +0 (0 ms), `shot` +24 (800 ms), `beam` +24 (800 ms), `hit heavy` +24 (800 ms) |
| Straight Rocket `weapon_rocket` | `shot` +0 (0 ms), `hit direct` +7 (233 ms), `explosion` +7 (233 ms) |
| Seeker Missile `weapon_homing` | `lock` +0 (0 ms), `warning lock` +0 (0 ms), `shot` +12 (400 ms), `warning missile` +12 (400 ms), `hit direct` +24 (800 ms), `explosion` +24 (800 ms), `warning lock_lost` +25 (833 ms), `lock` +30 (1000 ms), `warning lock` +30 (1000 ms) |
| Road Mine `weapon_mine` | `shot` +0 (0 ms), `hazard mine placed` +0 (0 ms), `hazard mine armed` +17 (567 ms), `hazard mine triggered` +23 (767 ms), `hit direct` +23 (767 ms), `status slow applied` +23 (767 ms), `explosion` +23 (767 ms), `status slow expired` +58 (1933 ms) |
| Oil Slick `weapon_oil` | `shot` +0 (0 ms), `hazard oil placed` +0 (0 ms), `status grip applied` +1 (33 ms), `status grip expired` +107 (3567 ms) |
| Sticky Foam `weapon_foam` | `shot` +0 (0 ms), `telegraph` +0 (0 ms), `impact ground` +15 (500 ms), `hazard foam placed` +15 (500 ms), `status slow applied` x2 +15 to +32 (500 to 1067 ms), `status slow expired` x2 +84 to +109 (2800 to 3633 ms) |
| EMP Pulse `weapon_emp` | `windup` +0 (0 ms), `shot` +18 (600 ms), `area` +18 (600 ms), `status emp applied` +18 (600 ms), `status immune applied` +18 (600 ms), `status emp expired` +62 (2067 ms) |
| Tesla Arc `weapon_tesla` | `shot` +0 (0 ms), `beam` +0 (0 ms), `hit direct` +0 (0 ms), `status jam applied` +0 (0 ms), `status immune applied` +0 (0 ms), `status jam expired` +17 (567 ms), `status immune expired` +77 (2567 ms) |
| Flame Spitter `weapon_flame` | `shot` +0 (0 ms), `area` +0 (0 ms), `status burn applied` +1 (33 ms), `hit burn` x6 +10 to +60 (333 to 2000 ms), `status burn expired` +68 (2267 ms), `hit burn` +69 (2300 ms) |
| Frost Cannon `weapon_frost` | `shot` +0 (0 ms), `status grip applied` +6 (200 ms), `hazard frost placed` +6 (200 ms), `status grip applied` +25 (833 ms), `status grip expired` +80 (2667 ms) |
| Crash Hammer `weapon_hammer` | `windup` +0 (0 ms), `shot` +8 (267 ms), `area` +8 (267 ms), `hit heavy` +8 (267 ms), `status immune applied` +8 (267 ms), `impulse` +8 (267 ms), `status immune expired` +67 (2233 ms) |
| Side Saw `weapon_saw` | `shot` +0 (0 ms), `hit direct` +0 (0 ms) |
| Grapple Harpoon `weapon_harpoon` | `shot` +0 (0 ms), `tether attached` +5 (167 ms), `hit ram` x2 +52 (1733 ms), `tether released` +65 (2167 ms) |
| Air Cannon `weapon_air` | `shot` +0 (0 ms), `area` +0 (0 ms), `hit direct` +0 (0 ms), `status immune applied` +0 (0 ms), `impulse` +0 (0 ms), `status immune expired` +59 (1967 ms) |
| Steel Boomerang `weapon_boomerang` | `shot` +0 (0 ms), `hit direct` x2 +6 to +20 (200 to 667 ms), `impact caught` +29 (967 ms) |
| Arc Mortar `weapon_mortar` | `lock` +0 (0 ms), `shot` +8 (267 ms), `telegraph` +8 (267 ms), `lock` +20 (667 ms), `explosion` +50 (1667 ms), `hit heavy` +50 (1667 ms) |

Fixed timings, whatever the range: railgun charge 24 ticks (800 ms); EMP charge 18 (600 ms);
hammer draw 8 (267 ms); sentry pivot 8 (267 ms); seeker lock 18 (600 ms), mortar lock 12
(400 ms), each 25 percent shorter with a Turret Computer; mine arming 18 (600 ms); foam
flight 15 (500 ms); mortar flight 42 (1400 ms); machine gun rounds 3 ticks apart; flame for
60 ticks (2 s) with a burn pulse every 10; harpoon line 60 ticks (2 s); jump 14 ticks (467 ms).

## Primitives and the parts built on them

Section 11.8 asks for shared primitives with per-part parameters. `compileModules` is the
only place a `behaviorId` is read; every number comes from the part's `params` in the catalog
and a missing one fails at race creation.

| Primitive | Parts | What it is |
| :-- | :-- | :-- |
| `burst` | Front Machine Gun, Rear Sentry, Swivel Turret | Bullets in a timed burst. The three differ in aim: assisted in a cone, automatic in an arc, tracking at a turn rate |
| `spread` | Road Shotgun | Pellets in a fan, damage falling with distance |
| `hitscan` | Needle Railgun | Charge, then an instant line that penetrates |
| `rocket` | Straight Rocket | An unguided projectile with a splash |
| `homing` | Seeker Missile | Lock, then a guided projectile; flies straight if fired unlocked |
| `mine` | Road Mine | A dropped hazard that arms, then triggers on contact |
| `strip` | Oil Slick | A strip hazard that applies a status |
| `puddle` | Sticky Foam | A lobbed projectile that becomes a round hazard |
| `pulse` | EMP Pulse | Charge, then a ring that applies a status |
| `arc` | Tesla Arc | An automatic instant strike on the nearest car in range |
| `flame` | Flame Spitter | A held cone: burn, heat, and it lights oil and melts frost |
| `frost` | Frost Cannon | A projectile that applies a status and leaves a patch |
| `melee` | Crash Hammer | Draw back, then a strike in a short arc with a shove |
| `contact` | Side Saw | Automatic damage to a car touching one side |
| `tether` | Grapple Harpoon | A projectile that attaches a line pulling both cars |
| `blast` | Air Cannon | A cone that shoves cars and projectiles |
| `boomerang` | Steel Boomerang | A projectile that flies out, returns, and can be caught |
| `mortar` | Arc Mortar | Lock, then a lobbed shell onto a marked spot |
| `shield` | Energy Shield | A pool that absorbs one hit and recharges on power |
| `breakaway` | Breakaway Armor | A pool that absorbs until gone, once |
| `reactive` | Reactive Foam | A share off a heavy hit, on a cooldown |
| `intercept` | Missile Interceptor | Shoots down a guided missile, on a cooldown, for energy |
| `sweep` | Mine Sweeper | Clears a trap ahead, on a cooldown |
| `spare`, `repair` | Spare Wheel, Repair Kit | A timed repair of a chosen or the worst component |
| `nitro`, `boost` | Nitro Tank, Emergency Booster | A timed `boost` status for heat |
| `decoy` | Decoy Drone | A hazard that guided missiles prefer |
| `hop` | Jump Pad | A timed `airborne` status |
| `winch` | Recovery Winch | A short pull toward the road for a car that is stuck |
| `capacitor` | Burst Capacitor | A reserve that pays for a large shot |
| `radar`, `minesensor`, `targeting` | Radar, Mine Detector, Turret Computer | Information and acquisition ranges and times |
| `passive` | The other 15 defenses and 9 utilities | Modifier totals only: armor, damage factors, cooling, power, handling. Powered ones stop under EMP |

**Not exactly as the catalog text reads.** Kept short; the tests in
`tests/unit/combatParts.test.ts` state each part's behaviour precisely.

- Seeker Missile: fired without a lock it flies straight (a "dumb fire"), not refused.
- Arc Mortar: cannot fire inside 90 px; its damage fades from 25 at the centre to 8 at the edge.
  A shell on the roof between components is a bare-body hit: 17.5 to the chassis, none to a component.
- Road Mine under the middle of a car is likewise a bare-body hit. A car can trigger its own mine.
- Bullets (machine gun, sentry, turret) lose damage beyond half their range, to 60 percent at
  full range. Added in catalog 0.6.0; the catalog text gives one damage figure.
- Grapple Harpoon: the line pulls the thrower too, at 35 percent, and parts at 260 px.
- Air Cannon and Crash Hammer shoves are capped by the two-second immunity, so a second
  shove inside it does its damage and no push.
- Jump Pad: the car can still be shot in the air; it only clears what is on the ground.
- Recovery Winch: a pull of about 60 px toward the road ahead, only when the car has been
  pinned for 1.5 s. It is not a teleport and not a respawn.
- Decoy Drone: draws only guided missiles, and only those that reach it before they reach the car.
- Solar Panel: generation depends on the published time of day and weather, fixed for the race.
- Radar and Mine Detector change what the server tells the client (`rivalTracked`, missile
  warning lead, `revealed`); they do nothing a client could fake.
- Sliding Ballast and Active Wing are modelled as modifiers that need power, not as moving parts.

## The rival

`RaceBrain.control(race, index)` returns the same control sample a human sends, and that is
the only way a brain acts. `SparringBrain` follows the centerline with the Milestone A speed
planner, moves over to pass or to avoid a trap it has been shown, fires a weapon when the
target is inside its arc and range (after a seeded reaction time of 4 to 10 ticks, and
letting 12 percent of chances go), drops traps for a car close behind, repairs what is
critical, and uses nitro on straights. It has no difficulty levels, no racing line, no plan,
and does not choose a build. `createSparringRace` picks its car from the eleven starter and
example templates by seed. Milestone D replaces it by implementing `RaceBrain`.

## Scenarios

Scripted two-car situations on Neon Cut's first straight, each with legal builds of 1,000
credits or less. They run with the tow off (they place cars at chosen distances to show one
thing), except the one scenario that is about it. A scenario is data (`ScenarioDefinition`): two cars, where they start, a
lane and speed to hold, and timed button presses.

- Command line: `npx tsx tests/scenarios/run.ts` lists them; `npx tsx tests/scenarios/run.ts rocket_hit`
  prints the event timeline of one; `npx tsx tests/scenarios/run.ts all` runs every one and
  reports any expectation that was not met.
- In the client: `?debug=1&scenario=rocket_hit` on the race screen. The scenario runs in the
  page, with the car on its script and the HUD's debug readout showing the combat state. `?debug=1&rival=starter_longlegs&seed=7` picks the rival
  and seed of an ordinary race instead.
- On a server with debug options on (the default outside production): join with `scenarioId`.

| Id | Title | Shows |
| :-- | :-- | :-- |
| `tow` | The tow | The one scenario that runs with the tow on, kept apart from the 33 below (`TOW_SCENARIO`, found by `getScenario('tow')`). The catch-up indicator on the local car: off through the start, engaging at 5.5 s (gap 4.2 s), rising to the whole bonus by 7.5 s, falling as the gap closes and off again at one second, short of the car ahead. The car ahead never has any. |
| `kinetic_impact` | Small kinetic impacts | Section 13.3 small kinetic impact, twice: tight bullet impacts, then a fan of pellet impacts. Armor absorbs before the bodywork. |
| `rocket_hit` | Rocket hit | Section 13.3 rocket explosion: approach, flash, fireball, shrapnel and smoke; then the splash of a near miss. |
| `mortar_strike` | Mortar strike | Section 13.3 heavy mortar explosion with its warning reticle. The target sits still so the whole sequence can be studied. |
| `emp_burst` | EMP burst | Section 13.3 EMP burst: charge, cyan and violet rings, arcs to the affected mounts. No fireball. The shielded electric car is the worst case. |
| `repair_burst` | Repairs | Section 13.3 repair burst, twice. The car pulls left on its broken wheel and is down on power until each repair lands. |
| `wet_road` | Wet road | Section 13.5 rain with combat on wet asphalt: a rocket bloom over standing water, frost spreading on a wet road, a short-lived oil strip. |
| `oil_fire` | Burning oil | Oil igniting into a fire hazard that keeps the strip's shape and remaining life, and a car catching fire by driving through it. Persistent fire reads as an area, not a flash. |
| `flame_frost` | Frost puts out fire | A burning car put out by frost: the burn status ends early and the frost status begins on the same tick. The shell leaves an icy patch where it struck. |
| `frost_thaw` | Fire thaws frost | The other direction of the same pair: a frosted car thawed by fire, and a frost patch melted off the road. |
| `missile_defense` | Missile countermeasures | Lock warning, the early Radar warning, an interception, a missile swerving onto a decoy, and an unanswered hit for comparison. |
| `mine_sweeper` | Trap detection and clearing | The trap warning, a mine being cleared just ahead of the bumper, and the sweeper's 8-second cooldown leaving the second mine live. |
| `ram` | Ramming | Mass-aware collision: who moves, who is hurt, and the rear-left or rear-right wheel taking the hit where it lands. |
| `shield_break` | Shields and absorbers | Section 13.8 armor and shield reactions: the shield taking one hit and dropping, the breakaway plate soaking 35 and falling off, the foam cutting the heavy hit. |
| `weapon_front_mg` | Front Machine Gun | Five alternating muzzle flashes over 0.4 s, five tracers, five small kinetic impacts on the rear. |
| `weapon_rear_mg` | Rear Sentry | Acquisition wind-up (the pivot), four rear-facing shots, impacts on the follower's nose. |
| `weapon_turret` | Swivel Turret | Visible traverse at 120 degrees a second, the lock tick, three shots along the turret's own aim. |
| `weapon_shotgun` | Road Shotgun | One large muzzle flash, eight pellets with short trails, several separate impacts. |
| `weapon_railshot` | Needle Railgun | Six-stage barrel charge, a thin instant beam, a slash on the struck panel; the hit carries into a second module. |
| `weapon_rocket` | Straight Rocket | Launch, a rocket in flight for about a third of a second, the direct hit and its explosion. |
| `weapon_homing` | Seeker Missile | Lock brackets on the target, the target's lock warning, a swerving missile, the incoming warning half a second out, the bloom. |
| `weapon_mine` | Road Mine | Hatch pop, the mine blinking as it arms after 0.6 s, the thump under the follower and its 1.2-second slow. |
| `weapon_oil` | Oil Slick | The spill, a glossy strip on the road, the follower sliding for 2.5 seconds with no fireball. |
| `weapon_foam` | Sticky Foam | The lob with its landing marker, the puddle spreading, the target held to four fifths of its speed. |
| `weapon_emp` | EMP Pulse | Charge segments on the emitter, the ring, electronics down on the other car for 1.5 seconds. |
| `weapon_tesla` | Tesla Arc | A forked arc from the coil to the nearest point of the other car, sparks on the struck component. |
| `weapon_flame` | Flame Spitter | The cone for 2 seconds, fire on the struck panel, burn pulses every third of a second, the target's heat rising. |
| `weapon_frost` | Frost Cannon | The faceted shell, the shatter, frost over the wheel arches, an icy patch on the asphalt. |
| `weapon_hammer` | Crash Hammer | Wind-up, the clang, 24 damage on the struck corner and a sideways knock; the target is then immune to another for 2 seconds. |
| `weapon_saw` | Side Saw | Teeth running, sparks at the contact point on each bite, scratches with no explosion. |
| `weapon_harpoon` | Grapple Harpoon | The dart on its rope, the hook, a line under tension between two moving cars, the release. |
| `weapon_air` | Air Cannon | The pale cone, the pressure wave, the target thrown forward and aside. |
| `weapon_boomerang` | Steel Boomerang | The spinning blade outbound, a slash, the turn, a second slash on the way back and the catch. |
| `weapon_mortar` | Arc Mortar | Lock, the reticle counting down for 1.4 s, the heavy burst and its falloff from 25 at the centre to 8 at the edge. |
