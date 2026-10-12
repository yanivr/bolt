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
  surface, hazard and wall or obstacle clearance. Clearance is the minimum over two samples
  either side along the road, because the car is a capsule, not a point. A cell is drivable
  when its clearance exceeds the collider radius plus 4 px; if none is, the widest gap minus
  2 px is used. Margins: the collider radius plus 6 px, plus 5 more on walled tracks.
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
Grip is scaled by the car's effects (oil, frost, damaged wheels and steering). Off the line,
the limit uses the curvature and ground where the car actually is. A timed hazard on the route
(rail crossing, vent) is read from its timetable (`scheduleState`) at the arrival time with
0.6 s of margin; if it will be closed, the car holds before it. Engine heat (Racer and Ace
only): within 3 of thermal protection it coasts on alternate ticks, on paved ground only,
because lifting on sand, mud or snow loses more than the heat costs.

### Steering and recovery (`Pilot.drive`)

A Stanley-type tracker with yaw feedforward: the lane's heading and curvature from three
points 6 + 0.12 v px ahead, cross-track gain 2.2, then the same heading gains the human input
path uses (`directionToControl`). Pure pursuit was tried first and cut corners into walls.
Line error is an Ornstein-Uhlenbeck wander of `lineError` px with a time constant of
`lineErrorSeconds`, scaled down where the road is narrow. Stuck (under 10 px/s for 1.2 s while
racing and not holding at a crossing) or turned round: reverse for 26 to 40 ticks with
opposite lock, then rejoin. A car knocked off its
route relocates by search.

### Tactics (`tactics.ts`)

- **Passing.** Within `passReach` px behind and closing by at least `passClosing` px/s, it
  commits to a side; with `cornerCraft`, the inside of the next corner. With no room it follows
  the rival's speed instead of running into it.
- **Alongside.** Keeps apart, or, for an aggressive driver in a heavier car or one with
  blades, leans in (a ram).
- **Defending.** Pressure builds while followed closely; it moves to cover the inside by
  `defends` of the way. A narrow forward weapon can ask to line up (`alignWish`).
- **Avoidance.** Revealed mines, strips, puddles and fire, and the landing spots of lobbed
  shots, are pushed off the lateral target. Unrevealed traps are not avoided (tested).
- **Shortcuts.** Decided once a lap, 80 + 1.5 v px before the fork, and only by driving them.
  Depth 1 (Rookie): takes it when it is shorter by length, on a coin. Depth 2 (Racer, Ace):
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
(`AI_SKILLS`). Nothing else differs between levels: not the car, not grip, not ammunition.

| | Rookie | Racer (default) | Ace |
| :-- | --: | --: | --: |
| Share of the racing line followed (rest: centerline) | 0.45 | 0.85 | 1 |
| Speed horizon: braking distance x, plus px | 1.15, 30 | 1.35, 50 | 1.6, 70 |
| Shortcut weighing | by length, on a coin | own pace, risk, timetables | same |
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
least one legal build (tested, over 1,000 builds).

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
- `PROTOCOL_VERSION` 7.
- The sparring brain (`ai/sparring.ts`, `createSparringRace`) stays as the reference for the
  balance reports and as the "before" of the tournament.

## The tournament

```
npx tsx tests/tournament/run.ts            # the full run, about 1,350 races
npx tsx tests/tournament/run.ts --quick    # the same shape, about 240 races, a few minutes
  [--out <file.md>] [--seed <n>] [--phase strategy|difficulty|sparring|system|tires]
```

It writes `docs/evidence/tournament/tournament.md` (or `tournament-quick.md`) and the raw
records next to it as JSON, and exits non-zero if any race crashed, produced a non-finite
state, ran out of time or left a car stuck for 8 s. Phases (`plan.ts`), on all 16 courses:

- **strategy**: every pair of the six strategies from both slots, Racer against Racer, one
  aggressive and one tactical driver. Strategy and tire win rates per course come from here.
- **difficulty**: Ace against Rookie, Ace against Racer, Racer against Rookie, on the balanced
  strategy, from both slots and both styles.
- **sparring**: the brain alone, before and after. The same pairs of shipped builds on the same
  seeds, once with the sparring brain in both cars and once with the AI.
- **system**: the rival as a player meets it, before and after: the old room's shipped
  template by seed with the sparring brain, against the new course-built AI.
- **tires**: the same Arrow and engine on the profile's first kit against Street, Slicks, Rain,
  Sand and Mud kits, from both slots. Only the tires differ.

Plus a solo table of shortcut payoff: the balanced build and the Rookie starter, alone, with
shortcuts never, always and as planned.

`tests/tournament/tournament.test.ts` is the Vitest subset (8 races on 4 courses: all finish,
deterministic, mean brain cost under budget). `tests/tournament/lineview.ts` draws a course's
AI lines to a PNG for review (`[MASK=<n>] npx tsx tests/tournament/lineview.ts <track> [preset]
[template] [scale] [out.png]`).

MEASURED
