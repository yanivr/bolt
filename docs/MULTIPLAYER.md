# Multiplayer (Milestone E part 1: Race a Friend)

Two people on two phones race each other through the same server-authoritative room code that
runs a race against the AI. This document is the contract for that room: how its clock and
input pipeline work, the lobby state machine, what happens when someone drops or leaves, the
security limits, what was measured, and how to run the network tests. Section numbers refer
to `docs/MASTER_SPEC.md`.

What has **not** been done: no test on two physical phones on separate networks. Everything
below was measured on one machine, through a TCP proxy that imitates a mobile network
(`tests/net/netsim.ts`), and in two Chromium contexts. See "Weak points".

## Where things are

| What | Where |
| :-- | :-- |
| Per-player input buffer and its policy | `packages/shared/src/tickInput.ts` (`TickInputBuffer`, `DEFAULT_TICK_INPUT_POLICY`) |
| Match messages, codes, nicknames, public rival data | `packages/shared/src/match.ts` |
| What one player may learn about the other's traps | `packages/shared/src/publicView.ts` |
| Forfeit (a result without touching `race.ts`) | `packages/shared/src/forfeit.ts` (`concedeRace`) |
| The race inside a room, shared by both room types | `apps/server/src/rooms/raceHost.ts` (`RaceHost`) |
| The solo room (one human against the AI) | `apps/server/src/rooms/DriveRoom.ts` |
| The friend room | `apps/server/src/rooms/MatchRoom.ts`, its state `matchSchema.ts` |
| The lobby state machine, no Colyseus in it | `apps/server/src/rooms/matchMachine.ts` (`MatchMachine`) |
| Friend codes of open lobbies | `apps/server/src/rooms/matchCodes.ts` |
| Match record hook (persistence installs the recorder) | `apps/server/src/rooms/matchLog.ts` |
| Create and join over HTTP, invite links | `apps/server/src/routes/match.ts` |
| Client: match connection and store | `apps/web/src/network/matchClient.ts` |
| Client: invite links | `apps/web/src/network/invite.ts` |
| Client: screens | `apps/web/src/pages/LobbyScreen.tsx`, `JoinScreen.tsx`, `pages/match/*` |

## Architecture

```
 phone A                         server (one Node process)                      phone B
 -------                         -------------------------                      -------
 POST /api/v1/match  ------->  routes/match.ts: guest token, version, build
                     <-------  { reservation, code }        (code: K7M-Q2X)
 WebSocket (seat)    ------->  MatchRoom  <-- MatchMachine (phases, deadlines, graces)
                                   |                                      POST /api/v1/match/join
                                   |       code lookup, rate limit  <---  { code, profile, build }
                                   |                                ---> { reservation }
                                   |                          <-------  WebSocket (seat)
                                   v
                               RaceHost: one RaceSession, two HostSeats
                                   each seat: TickInputBuffer, autopilot brain, its own view
                               MatchState
                                   seats{0,1}: public lobby fields (shared)
                                   views{0,1}: DriveState per seat (StateView: own only)
```

- **One code path for both room types.** `RaceHost` owns the race, the per-seat input buffers,
  the per-seat views and the event delivery. `DriveRoom` (solo) gives it one human seat and an
  AI brain; `MatchRoom` gives it two human seats. Both step it on the server's own clock.
- **Joining goes through HTTP, not the matchmaker.** `POST /api/v1/match` opens a lobby and
  `POST /api/v1/match/join` takes the second seat by code. Each answers a Colyseus seat
  reservation that the client consumes with `consumeSeatReservation`. The matchmaker guard
  only lets `create` and `joinOrCreate` name the solo room (`creatableRooms`), and only
  `reconnect` reaches a match room directly, so a match room can be entered only by its code.
- **Each client is sent its own view and nothing else.** `MatchState.views` is a map of two
  `DriveState`s declared `view: true`. Each client's `StateView` holds exactly its own seat's
  view. The shared part of the state is the lobby: phase, deadline, code, course, round and two
  seat records holding only `present`, `connected`, `host`, `nickname` and `emblem` (preset
  indices), `ready`, `loaded`, `vote`, `car`, `latencyMs` (rounded to 10 ms) and `graceEndsAt`.
  No guest id, token, session id or address is in the state.
- A fresh `DriveState` is made for each race, so nothing of the last race lingers in a view.

## The clock and the input pipeline

### Fixed 30 Hz room tick

The room steps its race on `setSimulationInterval` at half the step length, with an
accumulator: every 33.3 ms of wall time is one tick, at most 5 catch-up ticks after a stall.
It never waits for a player. (Before this milestone the solo room advanced once per input
sample of its one human; that coupling is gone. DECISIONS 283.)

Snapshots stay at 15 Hz (`patchRate`): every second tick.

### One sequence number per tick, per player (`TickInputBuffer`)

The client numbers its 30 Hz input samples and sends them two to a packet (20 packets a
second at most, up to 6 samples each for catch-up). The room keeps one buffer per player and
consumes **exactly one sequence number per room tick** from it.

| Rule | Default | Why |
| :-- | :-- | :-- |
| Start | after 3 samples are buffered (`initialDelay`) | absorbs the first jitter without a stall |
| On time | the sample for this tick is used and acknowledged | |
| **Missing sample** | the player's **last control is repeated** and the number is consumed (`repeat`) | a phone's thumb rarely changes in 33 ms; repeating is nearly always right, and the other player never waits |
| **Late sample** (its number was consumed) | dropped and counted (`late`) | the room never rewinds; the client's predictor is corrected by the next snapshot |
| Silent for 15 ticks (`staleTicks`, 0.5 s) | the car is `absent`: neutral in the solo room, the rookie AI autopilot in a friend race (fire and utilities off) | a frozen thumb is not a plan; a car stopped mid-track is a hazard to the other player |
| Grow | delay +1 tick (up to 12) on a miss, once 2 missed samples have turned up late within 90 ticks | a sample that arrives just after its tick proves the buffer too shallow for the jitter |
| Lost samples do not grow it | | a sample that never comes would not have been saved by a deeper buffer |
| Runs of misses do not grow it (`growOnIsolatedMissesOnly`) | only a lone miss counts: one whose next tick had its own sample | a stall (TCP retransmission, a tab in the background) is not jitter; growing on it would add latency to every following tick for nothing |
| Cost of a change | a grow runs one tick on the repeated control without spending a number; a shrink skips one | either moves the car one tick of travel against the client's prediction (about 9 px at speed), once; so both are rare and at least 30 ticks apart |
| Shrink | skip one number after 150 ticks in which at least 4 spare samples were always waiting; every 15 ticks while 8 or more are | gives back latency the network no longer needs |
| Reanchor | packets wholly behind the room for 10 ticks: jump to the newest | a client that lost time (a hidden tab) |
| Reconnect | `restartStream`: the new connection's numbering continues; anything at or below the last consumed number is refused | |

The buffer reports `delay`, `depth`, `missing`, `late`, `grown`, `shrunk`, `reanchors` and
`absent` to its own player in `DriveState.net`. The client subtracts the buffer delay from
its measured round trip so its own latency display is the network's.

### Prediction and acknowledgement

Each client predicts its own car with the existing `Predictor` (unchanged in principle) and
reconciles against its own view's `ackSequence`, which is per player. One change: if a
snapshot acknowledges a sequence at or past the client's own counter (the client lost time,
for example a tab in the background), the client jumps its counter to
`ack + 3 + ceil(rtt / 33 ms)` so its next samples are in the room's future again (`resyncs`).

### The other human

The other player's car reaches a client exactly like the AI rival's: the `rival` block of its
own view (pose, speed, steering, lap, chassis, armor, components, statuses, per-part state,
aim and shield `up`, tow). The race view draws it interpolated from snapshot history about
one snapshot interval plus half a tick behind the newest snapshot, its render clock capped at
two ticks past the newest snapshot (so it extrapolates at most a fraction of a tick) and
never running backwards after a stall (`game/combat/stage.ts`). Its heat, energy, ammunition
and cooldowns are never sent (Section 7.5). Its car name and creation time are replaced by
`Rival Car` and a fixed date (`publicBlueprint`): nothing a player typed reaches the other.

### Clients cannot inject state

Every message is parsed with a strict zod schema (`packages/shared/src/match.ts`,
`protocol.ts`); an extra field, a value out of range or a wrong type is a strike and the
message is dropped whole. A client sends controls (steer, brake, coast, fire buttons, utility
buttons, repair target) and choices (track, build, ready, vote, nickname). Positions, damage,
timers, results and readiness of the other player are never accepted from anyone.

## The lobby state machine

```
                 create (host)                      join (guest, by code)
   CREATED ---------------------> WAITING_FOR_OPPONENT <--------------------------+
                                      |  ^      host: SELECT_TRACK / Random        |
                    host: Start Build |  |      (only here, only the host)         |
             (both seated, connected) |  |                                         |
                                      v  | someone leaves or times out             |
                                  TRACK_REVEAL --(both Build Your Car, or 12 s)--+  |
                                      |                                          |  |
                                      v                                          |  |
                                  BUILDING  (server deadline 60 s; submissions;  |  |
                                      |      Ready)                              |  |
            both Ready, or deadline:  |   leaves / grace over: build_cancelled --+--+
            lock last legal builds    v
                                  VS_REVEAL (both load, or 20 s)
                                      |
                                      v
                                  COUNTDOWN --> RACING --(result: finish, KO, timeout, forfeit)
                                                                  |
                                                                  v
                                                    FINISHED (2.5 s) --> RESULTS
                                                                  |  ^
                                             a vote: race, swap,  v  | all votes withdrawn
                                             build, none      REMATCH_VOTE
                                                                  |
              both "race" (same cars) or both "swap" (traded): VS_REVEAL (sides alternate)
              either "build" once both voted: BUILDING
              alone after the rival left: Invite Someone New (REOPEN) -> WAITING_FOR_OPPONENT

   any phase, 15 min without a message, or the last player gone: CLOSED (the code expires)
```

- The host picks a track and weather or `Random` (drawn when the build starts); the guest sees
  every change, as the shared state. `Start Build` needs both seated and connected.
- `TRACK_REVEAL` shows both players the same Track Preview. It ends when both press `Build
  Your Car`, or after 12 s.
- **Build phase:** the deadline is the server's (`phaseEndsAt`, with the server time in each
  phase message so the client corrects its clock). The client submits every legal change
  (debounced 400 ms) with `SUBMIT_BUILD` and its committed build with `READY`. The server
  validates each with the shared validator and the server's catalog, answers `BUILD_RESULT`
  (`ok` with the build hash, or the refusal code and the approved copy), and keeps the last
  legal one. Both ready, or the deadline: both last legal builds are locked and sent back as
  `BUILD_LOCKED` with the race id. A player who never pressed Ready races their last legal
  submission (their joining car if they submitted none).
- Each player sees the other's readiness (`Rival building` / `Rival ready`), never their build.
- Sides alternate every race. `swap` trades the builds as well.
- The lobby holds two. There are no spectators: a third join is `LOBBY_FULL`, a join after the
  build has started is `LOBBY_FULL`, a second tab of the same guest is told it is already in.

## Disconnects, reconnects and forfeits (Sections 3.3, 5.10, 5.14)

A dropped connection keeps its seat through Colyseus `allowReconnection` and the client's
reconnection token. The machine decides what the drop means by phase. The shared clock is
never paused.

| Phase when the connection drops | Grace | During the grace | Grace over, or the player pressed Leave |
| :-- | :-- | :-- | :-- |
| Lobby, track reveal | 90 s | the seat shows `Reconnecting` | the other is back in the waiting lobby (`rival_left`, `rival_timed_out`); if the host went, the guest becomes host (`host_left`) |
| Building | 20 s | submissions stop; the deadline still runs; at the deadline the room waits for the grace | the build is cancelled without a winner (`build_cancelled`), back to the waiting lobby |
| Load, countdown, race | 15 s | the car is driven by the rookie autopilot from its last state, fire and utilities off; the other player sees `Your rival lost connection. Autopilot drives their car for N s.` | **disconnect forfeit**: `RaceResult.reason` `forfeit` with `forfeit.cause` `disconnected` (or `left`), clearly different from a finish; the other wins |
| Results, vote | 30 s | | the seat is freed; the other can `Invite Someone New` with the same code |

- Coming back in time restores everything: the room never reset the car, so position, damage,
  ammunition, heat and cooldowns are as the autopilot left them. Events that happened while
  away are replayed to the returning client.
- A connected page that sends nothing for the whole race grace (a tab left behind) is
  forfeited the same way.
- The client retries reconnection for 95 s, shows its own countdown, and on a page reload
  resumes from `sessionStorage` (`bolt.match.v1`) with the stored reconnection token.
- A tab sent to the background sends `NEUTRAL` once; the room marks the car away at once
  instead of waiting for the 0.5 s of silence.
- A freed seat's socket is closed with code 4410 (`seat freed`); the client shows the approved
  copy and goes home.

## Security limits (Section 19.6)

| What | Limit | Where |
| :-- | :-- | :-- |
| Every room message | strict zod schema; malformed counts as a strike; 12 strikes (decaying by one per clean second) close the socket with 4429 | `MatchRoom.strike` |
| Messages per second, per connection | 60 handled (3 x the 20 packets/s input rate); more are ignored; 200 in one second, or 3 seconds in a row over 60, closes the socket (`RATE_LIMITED`, 4429) | `MatchRoom.admit` |
| Input samples per packet | 1 to 6, sequence and ranges checked | `inputSampleSchema` |
| Build submissions | 4 per second; more are answered `RATE_LIMITED` | `MatchRoom.onBuild` |
| WebSocket frame | 8 KB (`maxPayload`); bigger closes the socket with 1009 | `app.ts` |
| HTTP JSON body | 16 KB; matchmaker bodies separately capped | `app.ts` |
| Lobbies opened | 10 per minute per address | `rateLimits.match` |
| **Code guesses** | 20 per minute per address **and** per guest, counted before the code is looked at; then 429 with `Retry-After` | `rateLimits.code`, `routes/match.ts` |
| Seat joins and reconnects through the matchmaker | 30 per minute per address | `rateLimits.join` |
| Code space | 30^6 (about 729 million) from `crypto.randomInt`, against at most 200 rooms per node; codes are freed with their room | `matchCodes.ts` |
| Guest tokens | HMAC-signed by the server, checked on both HTTP routes and again in the room's `onAuth` | `security/guestTokens.ts` |
| Protocol version | `PROTOCOL_VERSION` 9 on create, join and seat options; a mismatch is `VERSION_MISMATCH` (409) with the approved update copy | `routes/match.ts`, `MatchRoom.onAuth` |
| Personal data | none: no free text, no names, preset nickname and emblem indices only | `profileSchema` |

What one player can learn about the other is limited to the `rival` block, public events, and
the hazards the simulation has revealed to them (`hazardVisibleTo`); the quiet events of a
hidden trap (`placed`, `armed`, `expired`) are not sent to the other player
(`raceEventVisibleTo`). The same rule now applies to the AI rival.

## Measured

All numbers below are from runs on this machine (one process, loopback, through `NetSim`).
The headless players use the shipped `Predictor` and the shipped room.

**Networks** (`tests/net/match.test.ts`):

- Fast phone: 40 ms each way (80 ms round trip), 30 ms jitter, no TCP stalls; 2% of input
  packets dropped and 2% reordered at the application level.
- Slow phone: 100 ms each way (200 ms round trip), 30 ms jitter, 2% of TCP chunks stalled for
  a 400 ms retransmission (head-of-line: everything behind waits), plus the same 2% drop and 2%
  reorder of input packets; a 1.5 s blackout 8 s into the race.

**Desync checks** (every run): the two players' records of the same car at the same room tick,
over about 610 shared ticks per car before either finished: position differs by at most
0.00017 px (float32 on the wire), and chassis by 0. Every hit both players received is the same
event, field for field. The two `RaceResult`s are deep-equal. Neither player ever saw its state
go back a tick, or the same tick with different contents.

**Room clock**: 29.95 to 30.02 ticks per second seen by both players over a 45 s race. During
the slow phone's 1.5 s blackout, the fast phone saw 74 to 76 room ticks in about 2.47 s (30 per
second) and no gap between state updates longer than 99 ms: the room did not wait.

**Corrections to the player's own car** (a reconciliation that moved the drawn car by more
than 1 px), four 45 s races each (three measuring runs and the final full test run):

| | corrections | per minute | median | p95 | worst | input delay at the end |
| :-- | --: | --: | --: | --: | --: | --: |
| Fast phone | 3 to 5 | 4 to 7 | 1.5 to 2.7 px | 2.2 to 9.5 px | 9.5 px | 3 to 4 ticks |
| Slow phone | 26 to 40 | 35 to 53 | 2.5 to 5.9 px | 9 to 11 px | 13.6 to 22.4 px | 4 to 9 ticks |
| Slow phone without the TCP stalls (`BOLT_NET_SLOW_LOSS=0`), one race | 16 | 21 | 3.2 px | 15 px | 15 px | 4 ticks |
| Slow phone growing on runs of misses too (`BOLT_NET_POLICY`), one race | 34 | 45 | 6.4 px | 16 px | 18.8 px | 12 ticks |

The fast phone's corrections come from the 2% of input packets it loses: the room repeats the
last control for those ticks, which is almost always right; the 9.5 px one is a tick of travel
from the one time its delay grew. The slow phone's come from the TCP stalls: a 400 ms stall is
longer than the input delay, so the ticks behind it run on the repeated control and their
samples are dropped as late when the burst arrives. Its worst correction follows the 1.5 s
blackout, after which the autopilot had been driving the car for a second. Growing the buffer
on runs of misses as well took the delay to 12 ticks (400 ms) and did not reduce corrections:
not worth the latency on every tick. The test thresholds (fast: under 30 a minute and 15 px;
slow: at most 3 per stall plus 2 per lost packet plus 10, median under 10 px, worst under 45 px)
are set from these runs with room for their spread.

Two harness faults were found and fixed on the way, and are worth knowing about when reading
older numbers: the first version of the proxy could deliver two WebSocket messages out of order
(one timer per chunk), which TCP never does, and that alone made the slow phone's corrections
about three times as many and the worst four to five times as large; and the first version of the input buffer grew
its delay on misses rather than on late arrivals, so lost packets (which a deeper buffer cannot
save) grew the fast phone's delay to 6 or 7 ticks, each step a one-tick correction.

**Bandwidth** per client while racing (all bytes on the socket, both directions, including
TCP-level framing of WebSocket messages but not IP headers): about 2.6 KB/s down and 2.0 to
2.1 KB/s up for both phones. A view patch averages 149 bytes against 146 for the solo room's
whole state (`tests/net/viewEncoding.test.ts`, 900 patches): the second view costs a client
nothing, because it is never sent to it.

**Reconnect mid-race**: the slow phone's connection was cut 5 s into a race and restored 2.5 s
later. The other phone watched the car keep going under the autopilot (more than 100 px), and
the returning phone's first view of its car matched what the other phone saw at the same tick
(same position to 0.01 px, same chassis). The race then finished normally with identical
results on both. Coming back cost the returning phone one large correction (83 px in the final
run): its own prediction had run on for 2.5 s while the autopilot drove the real car.

## How to run the network tests

```
npx vitest run tests/net                    # all network tests (about 3 minutes of real time)
npx vitest run tests/net/match.test.ts -t invites   # just the full flow
BOLT_NET_SLOW_LOSS=0 npx vitest run tests/net/match.test.ts -t invites
BOLT_NET_POLICY='{"growOnIsolatedMissesOnly":false}' npx vitest run tests/net/match.test.ts -t invites
BOLT_E2E_PORT=2678 npx playwright test tests/e2e/multiplayer.spec.ts   # after pnpm build
```

Each run prints `NETREPORT` lines (JSON) with the numbers above. `tests/net/headless.ts` is a
complete headless player (colyseus.js, predictor, 30 Hz real-time sampling, application-level
loss); `tests/net/netsim.ts` is the TCP proxy (latency, jitter in order, head-of-line stalls,
`cut()` and `blackout()`, byte counters).

| File | What it shows |
| :-- | :-- |
| `tests/net/match.test.ts` | the whole flow under the two networks; reconnect mid-build and mid-race; a permanent drop during the build (cancelled, no winner) and during a race (disconnect forfeit) |
| `tests/net/security.test.ts` | protocol version, forged and missing guest tokens, free text in the profile, matchmaker bypass, someone else's reconnection token, a third player, a guest running the lobby, forged input and state fields, the strike limit, floods, an oversized frame, code brute force, and what the other player's state never contains (their view, their hidden mines and its quiet events, their car's name, any seat field outside the public list) |
| `tests/net/viewEncoding.test.ts` | the bytes of a per-client view patch |
| `tests/unit/tickInput.test.ts` | the input buffer: start, miss and repeat, late drop, growth on isolated misses only, shrink, reanchor, stream restart, away |
| `tests/unit/matchMachine.test.ts` | every phase transition and disconnect rule on a fake clock |
| `tests/unit/matchCodes.test.ts` | code generation, normalization, validation, the registry, the public filter |
| `tests/e2e/multiplayer.spec.ts` | two Chromium contexts (870 x 370 and 667 x 375) on the production build: lobby, invite link, track change seen by the guest, build with the server clock, race (part of it by touch), identical results, rematch, the guest's phone closed mid-race and the forfeit; expired invite |

Screenshots of every new screen at 870 x 370 and 667 x 375: `docs/evidence/multiplayer/`.

## Weak points

- **No physical phones, no real mobile networks.** The gate of Milestone E names two phones on
  separate networks; that has not been run. The proxy imitates latency, jitter and TCP
  head-of-line stalls; it does not imitate radio handovers, NAT rebinding or carrier proxies.
- **TCP head-of-line blocking is the dominant source of corrections on a lossy link.** It is
  inherent to WebSockets. With 2% stalls of 400 ms the slow phone was corrected 35 to 53 times
  a minute, with a median of 2.5 to 6 px and a worst of 22 px (smoothed on screen). WebTransport
  or WebRTC data channels (unordered, unreliable) would remove it and are not in the stack.
- The rival is drawn from snapshots only; nothing is predicted for it, so at 200 ms round
  trip a ram or a close pass is resolved where the server says, a little late.
- Rate limits and match codes are per process. One node per region, as the deployment
  section of the spec plans, is fine; more nodes need a shared registry.
- `VS_REVEAL` is only the load wait; the fight card is Milestone F.
- The emergency autopilot is the rookie AI. It keeps the car moving and out of walls; it does
  not race well, which is deliberate (it should not win a race for an absent player).
