# AI guide

The AI rival of BOLT RIVALS (Milestone D; MASTER_SPEC Sections 3.1, 7.5, 9, 11.9, 15.9). It is
one `RaceBrain` (`packages/shared/src/ai/`), used the same way by the server room and by the
offline link in the page, so an AI race is the same race in both places (asserted by
`tests/integration/aiRoom.test.ts`). Builds are data (`packages/content/src/aiLoadouts.ts`).
The tournament that measures it is `tests/tournament/`.

## The rule it never breaks

The AI car is an ordinary car. It runs the same physics, part coefficients, cooldowns, heat,
ammunition and validator as a player's (asserted for every difficulty in
`tests/unit/ai.test.ts`, "AI params equal the validator's"). It acts only through the control
sample a human sends (`steer`, `brake`, `coast`, `fire`, `use`, `target`). It sees the rival
only through `observe()`, which copies what a player could see on screen: pose, velocity,
steering, braking, lap, progress, chassis, armor, component integrity, status effects and, per
part, `state`, `aim` and whether a shield is up. Never the rival's heat, battery, ammunition,
cooldowns, reserve, inputs or tow. It sees only hazards that are revealed to it or its own.
The test "uses no hidden internals" replaces every one of those numbers with nonsense on every
tick and requires 1,500 ticks of identical controls. The catch-up tow is not observed at all, so
the AI cannot hang back to collect it; its own tow is scrambled in the same test.

## Architecture

```
observe.ts    Observation: own car (full), RivalView (public), hazards (revealed), projectiles
route.ts      Composite routes: one racing line per set of shortcuts, speed limits, lap estimates
pilot.ts      Pilot: where it is on its route, speed plan, line wander, steering, recovery
tactics.ts    Tactics: delayed perception, passing, defending, avoidance, shortcut decisions
combat.ts     Combat: weapon chances against thresholds, ammunition, traps, utilities
racer.ts      AiBrain: observe, decide, plan speed, drive, act; one per car
profile.ts    Difficulty (AI_SKILLS) and style (AI_STYLE_TUNING)
```

A tick of `AiBrain.control(race, index)`:

1. `observe` fills the observation (no allocation after the first tick).
2. `Tactics.decide` pushes the rival's view into a ring buffer and reads it back
   `reactionTicks` late, extrapolated forward by `leadShare` of that delay. It picks a lateral
   target (racing line, pass side, cover, alongside spacing, hazard avoidance) and decides any
   shortcut fork ahead.
3. `Pilot.planSpeed` reads the route ahead and sets the allowed speed (see Speed).
4. `Pilot.drive` steers toward the target and applies throttle, lift or brake, or runs a
   recovery.
5. `Combat.act` decides fire and use for every slot.

### Routes and the racing line (`route.ts`)

A shortcut leaves its street at an angle (Lantern Alley leaves at a right angle), so a line per
branch has kinks. Instead the route is composite: for every set of shortcuts (a mask, 2^n of
them) the main line with those shortcuts spliced in is one closed path, and the line is worked
out on that path. `routePlan(track, params, env)` builds all of them for one car and caches
them by its parameters.

- **The road, as the car sees it.** For each sample, a lateral scan in 8 px cells records
  surface, hazard, wall or obstacle clearance and, on a walled track, the room inside the
  union of corridors (the convex corner where a shortcut leaves the street, which the corridor
  widths alone do not show). Clearance and room are the minimum over two samples either side
  along the road, because the car is a capsule, not a point. A cell is drivable when its room
  exceeds the collider radius plus 4 px and its clearance from a post, a wall or a barricade
  the collider radius plus 14 px (a car at race pace is 8 to 15 px off its line now and then);
  where no cell has that, the widest gap less 6 px, and failing that less 2 px. Margins from
  the pavement's edge: the collider radius plus 6 px, plus 5 more on walled tracks.
- **Good ground.** Of the drivable cells, the band whose grip is at least 85 percent of the
  best and rolling resistance within 20 of the best, for this car's tires. A Sand Paddle car's
  band on Dust Devil is different from a Slicks car's (tested).
- **The line.** K1999 curvature averaging (Remi Coulom's relaxation) inside the band, so the
  line takes the outside-inside-outside path. A Laplacian smoothing was tried first and shrank
  loops to the inside of corners.
- **Limits.** Cornering speed sqrt(lateralAccel x grip / curvature) for this car's own
  coefficients on the ground under the line; no top speed cap, so it carries speed into mud.
  Where the gap between solids leaves less than 14 px of slack, speed is capped at
  130 + 8 x slack px/s (barricades, pillars, the bollards of Backstreet Blitz).
- `estimateLapSeconds` drives the centerline profile in time with the engine's heat model, so a
  twin turbo that would hit thermal protection on a hot course is estimated as such. It is what
  the build picker sorts by.

### Speed (`Pilot.planSpeed`)

Over a horizon of the braking distance at the current speed times `horizonFactor`, plus
`horizonExtra`, in 20 px steps: the cornering limit at each point times `cornerConfidence`,
reached with braking at `brakeConfidence` of the car's deceleration on the ground under it.
Grip is scaled by the car's effects (oil, frost, damaged wheels and steering). Off the line
(a pass, a defence, avoidance) the limits come down by up to 12 percent, and a car still off
its lane (knocked aside, run wide, just switched to a shortcut's line) by up to 25 percent more
in proportion to how far off it is; a narrow passage ahead (its line may wander less than
16 px) is entered at no more than 110 px/s plus 4 per px of room until the car is lined up for
it. A timed hazard on the route
(rail crossing, vent) is read from its timetable (`scheduleState`) at the arrival time with
0.6 s of margin; if it will be closed, the car holds before it. Engine heat (Racer and Ace
only): within 3 of thermal protection it coasts on alternate ticks, on paved ground only,
because lifting on sand, mud or snow loses more than the heat costs.

### Steering and recovery (`Pilot.drive`)

A Stanley-type tracker with yaw feedforward: the lane's heading from three points
6 + 0.12 v px ahead, cross-track gain 2.2, then the same heading gains the human input path uses
(`directionToControl`). The feedforward curvature is the stronger of the lane's there and
0.16 s further on (the wheel filter and the yaw lag), so a right-angle alley mouth is turned
into in time. Pure pursuit was tried first and cut corners into walls. The steering asks for
the turn it wants after its own damage (`effects.steerScale` and `steerBias`, which a driver
feels), or a battered car weaves. The brake follows the plan firmly: full at 14 px/s over the
allowed speed (a 40 px/s band delivered about 60 percent of the braking the plan assumes and
carried cars past the posts of Lantern Alley). Tactics move the lane at 2.6 px a tick, 1.1 in a
bend, where a pass offset unwinding at the apex threw cars wide.

Line error is an Ornstein-Uhlenbeck wander of `lineError` px with a time constant of
`lineErrorSeconds`, scaled down where the road is narrow.

Recovery. Stuck (under 10 px/s for 1.2 s while racing and not holding at a crossing) or turned
round: reverse for 26 to 40 ticks with opposite lock, then rejoin. A second try from about the
same place backs out further (up to 2.4 times), from the third the lock alternates, and the
shortcut is given up if the car is not in it. More than 40 px outside a shortcut's corridor
while on its route (the mouth missed), the shortcut is dropped at once; inside a shortcut its
route does not take (pushed in), it is taken. Far from its lane (36 px) with a wall or an
obstacle in the way back (a snow bank, a tree line), it runs along the road at no more than
160 px/s until the way is clear instead of steering into it. A car knocked off its route
relocates by search.

### Tactics (`tactics.ts`)

- **Passing.** Within `passReach` px behind and closing by at least `passClosing` px/s, it
  commits to a side; with `cornerCraft`, the inside of the next corner. With no room it follows
  the rival's speed instead of running into it.
- **Side by side.** Never steers across a car beside it or just ahead (from 26 px behind to
  60 px ahead plus 0.6 s of closing), whatever the line, the defence or the weapons want. The
  car whose lane crosses the other's gives way: it holds its own side and, level or behind,
  lifts to cross behind it. The other keeps its lane and only moves over from an actual
  overlap. Where holding a side would leave the band of clear ground (a wall, the corner of a
  shortcut's mouth) it drops behind instead. This is the grid above all: the line from one slot
  often runs across the other (Neon Cut; on Backstreet Blitz Laundry Lane forks 56 px past the
  line, across the first slot). An aggressive driver in a heavier car or one with blades may
  lean in alongside (a ram), but not in the first 4 s.
- **Defending.** Pressure builds while followed closely; it moves to cover the inside by
  `defends` of the way. A narrow forward weapon can ask to line up (`alignWish`).
- **Avoidance.** Revealed mines, strips, puddles and fire, and the landing spots of lobbed
  shots, are pushed off the lateral target. Unrevealed traps are not avoided (tested).
- **Shortcuts.** Decided once an approach to the fork (not once a lap: a fork just past the
  start line was decided too late to turn in), 80 + 2.2 v px before it, and only by driving
  them. Not in the first 4 s with the other car beside it.
  Depth 1 (Rookie): takes it when it is shorter by length, on a coin (0.55, or 0.28 when its
  line needs over 80 percent of full lock), unless it is visibly worse ground: a quarter or
  more of it more loose or slippery than the main road it skips (rolling resistance over dirt
  plus 4, or grip under 0.6). That is what a novice sees from the fork: the bog of Marsh Track
  and Logging Spur in heavy rain, not Dry Wash, which is sand like the road. Depth 2 (Racer, Ace):
  the gain in seconds for this car on its own lines (`ShortcutValue.gain`), minus a risk for
  narrow passages (tight squared, scaled by line error), plus the expected wait at a timed
  hazard on either route at the arrival time (`crossingWait`, over the arrival time plus or
  minus 1 s), with a bonus of 0.08 s when the rival is close. It takes it when that beats the
  style's `shortcutGain`.

### Combat (`combat.ts`)

For each slot the chance of a hit if it fires now, from the weapon's own range, cone, speed and
the rival's led position: bursts and spreads by cone and distance, hitscan by line of sight,
rockets, frost and boomerangs by flight time against the rival's lateral freedom, homing and
mortars only with a lock, tethers and flames by range, melee by contact, mines and strips by
`trapChance`. It fires when the chance beats the threshold: the style's `fireThreshold` for
unlimited weapons, `limitedThreshold` for ones with charges, plus 0.35 x scarcity minus 0.2 x
surplus, so the 12 bursts of a Front Machine Gun are spent on good chances and the last few on
better ones. A share `missChance` of fair chances go by. Each slot waits `reactionTicks` after
a chance appears.

- **Traps** go where the follower will drive: for a close follower behind and aligned
  (25 to 280 px), or on the line in a bend when the follower is 150 px or more behind and will
  arrive within min(4 s, 0.6 x the trap's life).
- **Utilities.** Repair and Spare Parts target the worst core component; with `carCraft` and
  nothing critical, they wait for a fast stretch. Nitro on straights when fighting or with
  charges to spare. Decoy after the reaction delay on a lock warning. Jump over a trap under the
  nose. Winch when the car itself is stuck as long as the winch's wind-up.

## Difficulty and style

Difficulty changes only planning depth, acceptable line error and reaction delay
(`AI_SKILLS`), as Section 15.9 says. Planning depth includes the build (Section 3.1: Rookie
"recognizable viable builds", Racer "track-aware loadouts"): a Rookie builds a frame of its
strategy as it stands, on that frame's first engine and Street Tires, with no tuning for the
ground or the weather (`rookieBuildOptions`); Racer and Ace build for the course. Nothing else
differs between levels: not the car's coefficients, grip or ammunition, which are the
validator's for whatever it built.

| | Rookie | Racer (default) | Ace |
| :-- | --: | --: | --: |
| Share of the racing line followed (rest: centerline); into a bend tighter than 1/160 px the real line, fully from 1/90 | 0.45 | 0.85 | 1 |
| Build | a strategy frame as it stands, Street Tires | near-optimal for the course | same |
| Speed horizon: braking distance x, plus px | 1.15, 30 | 1.35, 50 | 1.6, 70 |
| Shortcut weighing | by length, on a coin, not into visibly worse ground | own pace, risk, timetables | same |
| Timed hazard foresight, s | 0.6 | 1.2 | 2 |
| Lead on a moving target (share) | 0 | 0.7 | 1 |
| Corner-aware passing and defence; heat and repair timing | no | yes | yes |
| Line wander, px (time constant s) | 15 (1.6) | 6 (1.2) | 2.5 (1.0) |
| Cornering and braking margin (share of the limit) | 0.80, 0.62 | 0.88, 0.68 | 0.93, 0.72 |
| Reaction, ticks at 30 Hz | 10 (333 ms) | 7 (233 ms) | 5 (167 ms) |
| Fair chances let go | 30% | 12% | 4% |

The cornering and braking margins are listed under line error on purpose: they are the margin
a driver who wanders that far must keep to stay on the road, not a handicap on the car. An Ace
at 0.93 of the cornering limit still wanders 2.5 px.

Styles are two ways to race at the same difficulty (`AI_STYLE_TUNING`): **aggressive** commits
to passes from 120 px even while not closing, leans on the other car, defends half the way,
fires unlimited weapons at a 25 percent chance and limited ones at 40, takes a shortcut for
0.1 s, drops a trap at a 30 percent chance; **tactical** waits until 80 px and closing by
6 px/s, never leans, defends fully, fires at 38 and 58 percent, wants 0.3 s from a shortcut and
45 percent from a trap. When the room does not name a style, the seed picks it.

Determinism: every random choice (wander, coins, the style, the build) comes from the race seed
through seeded generators. The same seed drives the same race (tested); the room and the
offline link give the same events, id for id (tested).

## Builds (`aiLoadouts.ts`)

Six strategies, each a plan and two or three frames (chassis, engines to choose from, paint
and parts): Speedster, Brawler, Trapper, Tank, Sniper, Balanced. Every course has a surface
profile (`COURSE_PROFILE`: dry road, wet road, sand, mud, dirt, frost, snowfall, metal, wet
metal), and each profile lists the three wheel kits worth trying (`PROFILE_TIRES`); on loose
profiles the frame's loose-ground engine (Trail Engine) is added. `aiBuildOptions` assembles
every frame x engine x kit, keeps the ones `resolveBuild` (the player's validator) accepts at
1,000 credits or less, sorts them by `estimateLapSeconds` on the course, and marks the ones
within 2 percent of the fastest as near-optimal. `pickAiBuild(track, preset, seed)` picks the
strategy by seed and then one near-optimal build by seed. Every course and strategy has at
least one legal build (tested, over 1,000 builds). A Rookie's pick is a seeded choice among
`rookieBuildOptions` instead: the same strategy for the same seed, each frame on its first
engine and Street Tires, legal under the same validator (tested on every course).

Fastest build per course and strategy, with the kits among its near-optimal builds and the
estimated lap (seconds; in brackets, how many near-optimal builds there are). Kits are part ids
without `tires_`; Trail is the Trail Engine (`engine_offroad`):

| Course | Profile | Speedster | Brawler | Trapper | Tank | Sniper | Balanced |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| Neon Cut, clear night | dry road | Arrow Supercharger, micro/slick/soft, 33.1 (6) | Arrow V8, micro/slick/soft, 34.3 (4) | Arrow V8, micro/slick/soft, 33.6 (4) | Arrow V8, micro/slick/soft, 34.4 (4) | Arrow Twin Turbo, micro/slick/soft, 32.8 (4) | Arrow V8, micro/slick/soft, 33.8 (4) |
| Neon Cut, rain night | wet road | Arrow Supercharger, rain/soft, 34.3 (4) | Arrow V8, rain/soft, 35.0 (4) | Arrow V8, rain/soft, 34.3 (4) | Arrow V8, rain/soft, 35.1 (4) | Arrow Twin Turbo, rain/soft, 33.8 (2) | Arrow V8, rain/soft, 34.5 (4) |
| Backstreet Blitz, clear day | dry road | Arrow V8, slick/soft, 29.5 (3) | Arrow V8, slick/soft, 30.0 (3) | Arrow V8, slick, 29.4 (3) | Arrow V8, slick/soft, 30.1 (4) | Arrow Twin Turbo, slick, 29.6 (3) | Arrow V8, slick/soft, 29.5 (4) |
| Backstreet Blitz, rain day | wet road | Arrow V8, rain, 32.4 (2) | Arrow V8, rain, 32.9 (2) | Arrow V8, rain, 32.2 (3) | Arrow V8, rain, 33.0 (3) | Arrow Twin Turbo, rain, 32.7 (3) | Arrow V8, rain, 32.4 (3) |
| Dust Devil, clear | sand | Arrow Supercharger, sand, 32.9 (2) | Arrow Trail, sand, 35.1 (1) | Arrow V8, sand, 33.8 (3) | Arrow Trail, sand, 35.2 (1) | Arrow Twin Turbo, sand, 33.3 (2) | Arrow Trail, sand, 34.3 (3) |
| Dust Devil, crosswind | sand | Arrow Supercharger, sand, 32.9 (2) | Arrow Trail, sand, 35.1 (1) | Arrow V8, sand, 33.8 (3) | Arrow Trail, sand, 35.2 (1) | Arrow Twin Turbo, sand, 33.3 (2) | Arrow Trail, sand, 34.3 (3) |
| Canyon Switch, dry heat | sand | Arrow V8, sand, 33.1 (2) | Arrow Trail, sand/micro, 35.8 (2) | Arrow Trail, sand/micro, 35.0 (4) | Arrow Trail, sand/micro, 36.0 (2) | Arrow V8, sand, 33.4 (1) | Arrow Trail, sand/micro, 35.2 (3) |
| Canyon Switch, sandstorm | sand | Arrow Supercharger, sand/micro, 33.3 (3) | Arrow V8, sand, 35.6 (3) | Arrow V8, sand, 34.2 (2) | Arrow V8, sand, 35.8 (4) | Arrow Twin Turbo, sand, 33.8 (2) | Arrow V8, sand, 34.6 (2) |
| Moss Run, clear | mud | Arrow Supercharger, mud, 26.0 (2) | Arrow V8, mud, 28.3 (3) | Arrow V8, mud, 26.8 (2) | Arrow Trail, mud, 28.5 (3) | Arrow Twin Turbo, mud, 26.3 (2) | Arrow V8, mud, 27.2 (2) |
| Moss Run, rain | mud | Arrow Supercharger, mud/rain, 27.4 (3) | Arrow V8, mud, 28.2 (2) | Arrow Supercharger, mud/rain, 27.3 (4) | Arrow V8, mud, 28.3 (3) | Arrow Twin Turbo, mud/rain, 27.5 (3) | Arrow Supercharger, mud/rain, 27.6 (4) |
| Timber Dash, clear | dirt | Arrow Supercharger, slick/soft, 33.3 (3) | Arrow V8, slick/micro/soft, 35.7 (5) | Arrow V8, slick/soft/micro, 34.3 (4) | Arrow V8, slick/micro/soft, 35.9 (5) | Arrow Twin Turbo, slick/soft, 33.4 (3) | Arrow V8, slick/soft/micro, 34.6 (4) |
| Timber Dash, heavy rain | wet road | Arrow Supercharger, rain, 35.6 (2) | Arrow Supercharger, rain, 36.5 (2) | Arrow Supercharger, rain, 35.4 (2) | Arrow Supercharger, rain, 36.7 (2) | Arrow Twin Turbo, rain, 35.7 (1) | Arrow Supercharger, rain, 35.7 (2) |
| Whiteout Pass, clear frost | frost | Arrow Supercharger, slick/soft, 26.7 (3) | Arrow V8, slick/snow/soft, 27.4 (6) | Arrow Supercharger, slick/soft/snow, 26.6 (4) | Arrow V8, slick/snow/soft, 27.5 (7) | Arrow Twin Turbo, slick/soft/snow, 26.8 (4) | Arrow Supercharger, slick/soft/snow, 26.8 (6) |
| Whiteout Pass, snowfall | snowfall | Arrow Supercharger, rain, 27.7 (2) | Arrow Supercharger, rain, 28.2 (2) | Arrow Supercharger, rain, 27.5 (2) | Arrow Supercharger, rain, 28.3 (2) | Arrow Twin Turbo, rain, 27.8 (2) | Arrow Supercharger, rain, 27.7 (2) |
| Steel Circuit, dry night | metal | Arrow Supercharger, slick/soft, 30.8 (3) | Arrow V8, slick/soft, 31.4 (3) | Arrow V8, slick/soft, 30.7 (4) | Arrow V8, slick/soft, 31.5 (4) | Arrow Twin Turbo, slick/soft, 30.9 (3) | Arrow V8, slick/soft, 30.8 (3) |
| Steel Circuit, factory rain | wet metal | Arrow V8, rain, 33.3 (2) | Arrow V8, rain, 33.9 (2) | Arrow V8, rain, 33.1 (3) | Arrow V8, rain, 34.0 (3) | Arrow Twin Turbo, rain, 33.6 (3) | Arrow V8, rain, 33.3 (2) |

What the table says: the kit follows the ground (Sand Paddles on all four sand courses, Mud
Claws on Moss Run, Rain Runners in the wet and in snowfall, Slicks or Soft Compound on dry,
metal, frost and dirt); and the Arrow is the fastest frame of every strategy on every course.
Of the 283 near-optimal builds over 16 courses and 6 strategies, 267 are Arrows (16 Beetles), so
the rival is almost always an Arrow. That is a chassis balance finding (Balance findings below),
not a picker choice.

## Integration

- **Room.** `DriveJoinOptions.difficulty` (`rookie`, `racer`, `ace`; Racer when absent) is a
  player choice, accepted without debug options; anything else is refused. `DriveRoom` builds
  the race with `createAiRace` (`packages/content/src/rivals.ts`) and steps it with
  `stepRaceWithBrains`. The rival's blueprint goes to the client in `rivalBlueprint` as before.
  `rivalTemplateId` (debug joins only) still races a named shipped template, now driven by the
  AI. The `player_joined` log line records difficulty, style and strategy.
- **Offline.** `startDrive` builds the same `createAiRace` in the page for the same seed.
- **Client.** The only client change is the smallest control: a Rookie, Racer, Ace radio row
  on the track preview screen (`data-testid="rival-difficulty"`), stored in the app store
  under `bolt.difficulty.v1` and sent with the join. No rendering or HUD code changed.
- `PROTOCOL_VERSION` 8 (7 was the crawl floor and the difficulty in the join; 8 the deep-ground
  floor on sand and mud, which a client predicts).
- `createAiRace` passes the difficulty to `pickAiBuild`, so a Rookie rival builds a Rookie's car
  on the server and in the offline link alike.
- The sparring brain (`ai/sparring.ts`, `createSparringRace`) stays as the reference for the
  balance reports and as the "before" of the tournament.

## The tournament

```
npx tsx tests/tournament/run.ts            # the gate run: 4,492 races, about half an hour here
npx tsx tests/tournament/run.ts --quick    # the same shape, about 1,100 races
  [--out <file.md>] [--json <file.json>] [--seed <n>] [--workers <n>] [--phase <phase>]
```

Server-only: every race is the room's own race, headless (`createRace` with the room's options,
`pickAiBuild`, `AiBrain`, `stepRaceWithBrains`, the function `DriveRoom` calls each tick); the
roster races go through `createAiRace` itself, the function the room calls on a join, with an AI
standing in for the player on the first slot. Races run on worker processes (one per core;
child processes, because tsx maps `.js` imports to sources only in a process it starts), each
with a 120 s wall-clock watchdog, and one race in 25 is run a second time on whichever worker
is free and must give the identical record. The run writes the report (by default
`docs/evidence/tournament/tournament.md`; the gate evidence is `README.md` there) and the records
as JSON, and exits non-zero if any race crashed, hung, ran to the time limit with nobody home,
left a car stuck or did not repeat. Stuck is still for 8 s, or under 150 px of course progress
in 15 s, while racing, not waiting at a crossing, not knocked out and not wrecked (a car with
its chassis gone limps by design).

Phases (`plan.ts`), on all 16 courses:

- **strategy**: every pair of the six strategies from both slots, Racer against Racer, one
  aggressive and one tactical driver. Strategy and tire win rates per course come from here.
- **difficulty**: Ace against Rookie, Ace against Racer, Racer against Rookie, on the balanced
  strategy, from both slots and both styles (the driving alone: both build for the course).
- **roster**: every starter and example build, driven by the AI at Racer, against the AI rival
  exactly as the room builds it at Rookie, Racer and Ace, two seeds each. Win rates per build
  and per difficulty.
- **balance**: every starter and example build against every other from both slots, the AI at
  Racer in both: the four balance targets of `docs/BALANCE_CHANGELOG.md` with the real AI.
- **upgrade**: the upgrade pairs of `tests/balance/upgrade.ts`, six races each, on the courses
  where the change is an upgrade.
- **sparring**: the brain alone, before and after: the same pairs of shipped builds on the same
  seeds, once with the sparring brain in both cars and once with the AI.
- **system**: the rival as a player meets it, before and after: the old room's shipped
  template by seed with the sparring brain, against the new course-built AI.
- **tires**: the same Arrow and engine on the profile's first kit against Street, Slicks, Rain,
  Sand and Mud kits, from both slots. Only the tires differ.

Plus solo runs: the shortcut payoff (the balanced build and the Rookie starter, shortcuts never,
always and as planned), every shipped build alone on every course, and the construction matrix
(five frames from light to heavy on six wheel kits) for the surface effect.

`tests/tournament/tournament.test.ts` is the Vitest subset (12 races on 4 courses, a strategy,
a difficulty and a roster race on each: all finish, nobody stuck, deterministic, mean brain cost
under budget). Review tools: `lineview.ts` draws a course's AI lines to a PNG
(`[MASK=<n>] npx tsx tests/tournament/lineview.ts <track> [preset] [template] [scale] [out.png]
[x,y,half]`), `trace.ts` follows one car alone, `traceMatch.ts` replays a planned match with a
line per car (`seed=<n>` picks it), and `replay.ts` re-runs flagged matches by seed.

## Measured, and what it does not do well

From the full tournament (`docs/evidence/tournament/README.md`: 4,492 races on all 16 courses,
180 repeats identical, 752 solo runs, 736 s of wall time on two worker processes):

- **Reliable.** No crash, hang or non-finite state; every shipped build alone finishes every
  course in both weathers (176 of 176). 3 cars of 8,984 were stuck (0.03 percent), listed by
  seed; one race of 4,492 ran to the time limit with nobody home (a wrecked car against an
  overheating one, decided on progress as Section 3.4 says).
- **Difficulty is visible.** Against the shipped builds the room's rival wins 43 percent at
  Rookie, 89 at Racer and 92 at Ace. On the same balanced builds Ace beats Rookie 81 percent of
  the time and Racer beats Rookie 78. Rookie laps 2.7 s slower, runs 19.7 px off its line
  against 11.6 and 9.9, and hits a wall 1.56 times a race against 0.65.
- **Builds follow the ground.** Sand Paddles win 78 to 100 percent of AI races on the sand
  courses, Mud Claws 85 to 88 on Moss Run, Rain Runners 81 to 100 in the wet and in snowfall,
  Slicks 68 to 89 on dry pavement, metal and frost.
- **Shortcuts are taken when they pay.** Driven alone, forcing every shortcut is slower than
  never on 13 of the 16 courses; the plan picks Laundry Lane on Backstreet Blitz in the dry
  (79.5 s against 88.0 never and 83.3 always) and otherwise stays on the road.

Weak points, frankly:

- **Ace is barely better than Racer.** 55 percent head to head, and its laps of the balanced
  builds are 0.27 s slower: it takes Laundry Lane and Bakers Row in about half its laps on
  Backstreet Blitz against Racer's 6 to 26, and its deeper horizon brakes earlier. A player will
  see a clear step from Rookie to Racer and hardly any from Racer to Ace.
- **A Rookie still takes shortcuts that do not pay.** On a coin, by length: Dry Wash about half
  its laps on Dust Devil (3 s a lap worse for its car; the wash is sand like the road, so the bog
  check does not see it), Lantern Alley, Conveyor Gap and Laundry Lane a quarter to a half. That
  is the novice's mistake by design, and part of why Rookie wins 43 percent and not more.
- **Few passes.** 0.32 lead changes a race and the lap 1 leader wins 90 percent. The AI passes
  when it is faster and commits to a side, but it does not out-brake a car of equal pace, and
  the side-by-side rule makes the car whose line crosses give way.
- **Three stuck cars remain**, all from the line meeting a solid at an angle the recovery takes
  more than 15 s to undo: a Rookie at Lantern Alley's mouth in the rain, a Rookie against a
  redwood on Timber Dash in heavy rain, and an Ace that ran wide outside Whiteout Pass's north
  bank at the first corner and passed the start line beyond the gate's clipped end (track data,
  `docs/DECISIONS.md`).
- **Reaction delays and line error are the table's, not a player's.** No human has raced the
  three levels; the numbers are Section 15.9's intent, tuned only against each other and the
  shipped builds.
- **Oil and air do little.** The Oil Slick deals no damage (its slip is not counted as damage
  here) and the Air Cannon 2.2 a shot; the AI fires them when the follower is aligned, but how
  much they cost the follower is not measured.
