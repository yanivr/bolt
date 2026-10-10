# BOLT RIVALS
## Final Product, Game Design, Visual Direction, and Engineering Specification

**Document status:** Implementation contract, revision 1.0, October 10, 2026  
**Delivery:** Browser-first multiplayer game with mobile-first interaction  
**Language:** All player-facing copy, code comments, documentation, error messages, and default accessibility text in natural US English  
**Primary audience:** Players ages 10 and up who enjoy clever experiments and short competitive games  
**Primary mode:** Two-player tactical racing with independent vehicle construction  
**Secondary mode:** Race against a computer driver  
**Business model at launch:** Completely free, no advertisements, payments, unlocks, energy gates, or pay-to-win mechanics  
**Project name:** BOLT RIVALS is the working product name. Use it consistently throughout implementation until a legal trademark check is completed.

## 0. Instructions for Claude Code

This document is the complete source of truth. The developer must not need a product owner to answer basic design questions. Implement the specified behavior, interfaces, content, and acceptance tests. Resolve minor technical gaps by choosing the simplest robust implementation consistent with the rules below. Record such decisions in `docs/DECISIONS.md`; never silently remove a feature or replace it with a static mockup.

**Definition of finished:** A new player can open a public HTTPS URL on an ordinary phone, understand the game without instructions from another person, build a valid original car, race an AI opponent or a friend invited by a link, see believable impacts and excellent pixel art action, repair damage, finish a match, save a blueprint, load it on another device, and immediately rematch. Both clients see the same fair result. All 120 named parts exist with tested behavior or clearly specified shared mechanic primitives. No buttons, menus, part cards, or scenes may be decorative dead ends.

Build in vertical slices, but keep the end-state in scope. Do not stop at a demo containing only a moving rectangle, placeholder particles, or a hard-coded victory screen. A fully usable, visually refined release is the required output. If external art creation is the limiting factor, build the complete asset pipeline and high-quality handcrafted procedural pixel art as described in Sections 13 and 14, mark outstanding art replacements precisely, and never misrepresent temporary art as final. No ripped assets, copyrighted vehicle designs, copyrighted music, stock watermarks, or unlicensed sprites.

**Priority if implementation choices conflict:** Gameplay readability > fair server authority > responsive controls > clear building decisions > visual spectacle > nonessential effects. Visual quality is a launch gate, not an excuse to compromise latency, fairness, or legibility.

**Reference-image interpretation:** The user supplied overhead racing screenshots as directional reference for a moving camera over winding roads with both cars visible when close. Recreate the spatial clarity, not the advertisement, its interface, copyrighted character portraits, or its specific road art. This game must have original pixel art cars and environments.

### 0.1 Product invariants

1. Both racers always have the same starting budget of exactly 1,000 credits. Credits are match-specific, not persistent currency.
2. Every catalog part is accessible to everyone from the first session. No progression gates.
3. The map, weather, surface conditions, and match rules are visible before construction starts.
4. Multiplayer construction lasts at most 60 seconds. A saved blueprint can be loaded instantly.
5. Two devices receive independent cameras centered on their own vehicle, not a shared video feed.
6. Race duration never exceeds 180 seconds of active race time. Target median race time is 110 to 140 seconds.
7. Vehicle damage changes driving, visuals, and strategy but seldom makes the rest of a race pointless.
8. Physical placement, attachment orientation, weight, energy, heat, and traction have actual gameplay consequences.
9. Weapons include manually activated, automatically triggered, and hybrid systems.
10. The driving finger can begin anywhere on the unobstructed play surface. The other finger fires and repairs. Left-handed layout is supported.
11. Every vehicle part has a deterministic cost and server-validated definition. The server validates every blueprint.
12. Blueprints are reusable and shareable across devices using short codes. Match invitations use different codes.
13. All visible text reads like polished arcade game copy written by a human editor. Avoid generic assistant-style prose, excessive exclamation marks, double hyphens, and em dashes.
14. Players are never required to create an account, disclose their age, enter an email address, or agree to advertising tracking to play.
15. The launch experience is browser-based and installable as a progressive web app where supported. No native app is required.

## 1. Experience Overview

### 1.1 Elevator pitch

Build an absurdly clever battle car on the same budget as your rival. Tune it for the road and the weather, then race in a lush, explosive, top-down pixel world. Win by driving well, outbuilding your opponent, disrupting their car, or finding an unexpected interaction between parts. Save your best design as a shareable code and dare a friend to beat it.

### 1.2 Emotional targets

**Before the race:** Curiosity, anticipation, fast decisions, and the satisfaction of fitting one last useful component on a crowded chassis.  
**At the VS screen:** Pride in your creation, concern about the rival's silhouette, and a sense that the matchup matters.  
**During the race:** Immediate steering confidence, speed, expressive impacts, surprise, recovery, and fair competitive tension.  
**After the finish:** A clear explanation of why the car won or lost, followed by one obvious change worth testing.

The desired repeat loop is not driven by artificial scarcity. It is driven by meaningful experimentation, narrow finishes, funny mechanical failures, and shareable machine designs.

### 1.3 Session cadence

| Segment | Target duration |
|:--|:--|
| Choose friend or AI | 5 to 10 seconds |
| Review map and weather | 5 to 8 seconds |
| Build or load a car | 10 to 60 seconds |
| VS reveal and countdown | 4 seconds |
| Active race | 60 to 180 seconds |
| Results, inspection, rematch | 8 to 25 seconds |

A returning player using a saved car must be able to start an AI race in three deliberate taps after loading the home screen. A friend rematch using the same cars should avoid reopening the full garage unless either player chooses to edit.

## 2. Supported Platforms and Device Design

**Primary:** iPhone Safari, Android Chrome, and other current mobile browsers supporting WebGL and secure WebSockets.  
**Secondary:** desktop Chrome, Firefox, Edge, and Safari. Keyboard is supported; mouse can operate the garage.

**Orientation:** Landscape is the primary play orientation on phones, because independent steering and action fingers need horizontal space. Try a fullscreen and orientation-lock request only after a user gesture; support varies by browser. On unsupported portrait devices, show a polished animated rotation overlay with a tappable `Continue in Portrait` option for the menus and garage; racing in portrait uses the same aspect-ratio game area with letterboxing and larger UI controls, never a broken layout. Do not claim the browser can force orientation. Phones that can rotate show `Turn your phone sideways to race` as the preferred path.

**Rendering:** Gameplay logical framebuffer 640 x 360. Use integer scaling where possible, nearest-neighbor sampling, and letterbox or crop only noncritical environmental edges. Never crop the vehicle, action controls, or critical race HUD. DOM-based menus and overlays use a responsive pixel-inspired design with crisp type at native device resolution; rasterize pixel UI ornaments but not body text at unreadable resolutions. Use safe-area insets for notches and home indicators.

**Touch targets:** At least 48 CSS pixels for major interactive controls; action buttons 60 to 76 CSS pixels on most phones. HUD cannot cover important road visibility. Provide compact layout on small landscape phones and generous margins on tablets.

**Performance:** Aim for 60 visible FPS on mid-range modern phones; permit a stable 30 FPS visual fallback on weak devices without slowing physics. Server simulation remains at a fixed 30 Hz. Target initial interactive load under 6 seconds on a typical 4G connection after compression, and keep first-play mandatory assets under 8 MB transferred. Lazy-load extra biomes and alternate vehicle skins. Provide loading percentages and a retry state.

## 3. Game Modes, Rooms, and Match Flow

### 3.1 Play vs Computer

Tap `Race AI`, choose difficulty if desired, review the selected track and its weather, then enter a 60-second optional garage. The player can press `Ready` at any time. The AI constructs from the same catalog, same budget, and same weather information. No AI-only speed, damage resistance, or credit bonus. AI processes the same physics and cooldowns as a person. The game is server-authoritative even in AI mode so blueprint behavior and race rules cannot diverge by platform.

Difficulty levels:

- `Rookie`: Recognizable viable builds, gentle driving, occasional missed weapon opportunities. Preferred for a first session.
- `Racer`: Track-aware loadouts, efficient braking, consistent use of useful weapons.
- `Ace`: Strong but fair line choice, more thoughtful equipment synergies, countermeasures and repairs. Do not give impossible reaction times or perfect future knowledge.

### 3.2 Race a Friend

Tap `Challenge a Friend`. Create a private server room, return both a URL and a six-character match code, and show `Share Link` plus `Copy Code`. The friend joins through the URL or the `Join with Code` control. No signup required. Assign the host and guest abstract player identifiers. Names are optional preset nicknames only in the initial release; no free-text usernames or chat.

The lobby shows connected status, latency quality, both profile emblems, and the track/weather card. Host may choose from available tracks or `Random Track` before locking the lobby. Both players receive the same conditions. A player may propose `Rematch` after the race; both must accept. Initial connection timeout is 90 seconds, room code expires after 15 minutes of inactivity, rejoin token remains valid for the current match plus a short results window. Match codes are not blueprint codes.

### 3.3 Finalized match states

`CREATED > WAITING_FOR_OPPONENT > TRACK_REVEAL > BUILDING > VS_REVEAL > COUNTDOWN > RACING > FINISHED > RESULTS > REMATCH_VOTE > BUILDING or CLOSED`

The server owns the state transitions and deadlines. Clients render only legal actions for the current state. Both players see the same countdown timestamps. If a friend leaves before `BUILDING`, return the host to the waiting lobby; if they leave while building, allow a 20-second rejoin grace period, then cancel without recording a winner. If they leave while racing, continue their last safe neutral steering state under an emergency AI autopilot for up to 15 seconds; if they reconnect, hand control back; otherwise record a disconnect forfeit, clearly distinguished from a normal finish. A reconnect must not reset ammo, heat, health, position, or cooldowns.

### 3.4 Race rules

- Two cars compete on the same point-to-point or looped course. The server assigns simultaneous starting positions balanced for distance to the first checkpoint. Swap side assignment on rematch.
- The primary objective is to reach the finish first after passing required checkpoints in order. In a lapped track, complete the specified lap count and required gates.
- Target race length is 110 to 140 seconds for evenly skilled default cars, with procedural route selection keeping reasonable variants between 60 and 180 seconds.
- The race timer starts on `GO`, ends when a winner is decided or 180 seconds elapse. At 180 seconds, the car with the greatest valid course progress wins. Exact progress ties use the earlier last checkpoint time, then greater remaining chassis integrity, and finally an explicit draw if equal.
- Once the first racer finishes, the other racer receives a short finishing window of 8 seconds. The displayed winner is already determined by finish time unless an authoritative correction is necessary.
- Checkpoints prevent cutting across terrain, reversing around a gate, or driving off-map to win. Legitimate signed shortcuts have their own ordered checkpoint branch and progress equivalence.
- Physical collisions between cars are enabled. At spawn, apply 1.5 seconds of reduced ram collision impulse to avoid unavoidable starting harassment.
- KO is rare: a KO occurs only when chassis integrity reaches zero **and** at least two core systems (engine, steering, locomotion) are disabled continuously for 3 seconds. A temporary limp-home mode with reduced speed replaces permanent loss for ordinary subsystem damage. Set balance objective for KO incidence below 3 percent of completed races.
- No sudden, arbitrary rubber-banding or hidden AI stat adjustments. Competition stays close because tracks offer tactical recovery, repairs, and different build strengths, not because the leader is secretly slowed.

## 4. First-Time Experience and Teaching

Avoid a large tutorial or wall of instructions. On first launch, show an animated split-second car build and a single primary button, `Start Racing`. The first match is against Rookie AI on a clear-weather city circuit. Preselect a legal starter vehicle; show three highlighted decisions: `Pick a chassis`, `Pick your tires`, `Add a weapon`. Offer `Use Starter Car` for immediate action. The tutorial uses in-context tips, never blocking modal pages while driving.

During the first race, show one transient steering instruction, `Drag to steer. Pull down to brake.` and one weapons instruction, `Tap to fire.` Fade each after the relevant gesture. The first damage event introduces `Tap the wrench to repair` only if a repair item is installed. On the first result, show one concrete statistic and `Swap a Part`, with `Race Again` as the primary button. A user may skip every teaching prompt.

Persist tutorial milestones locally. A returning player should never be forced to repeat onboarding after an interrupted session. If local data is lost, onboarding can be skipped immediately.

## 5. All Screens and Interaction Specifications

### 5.1 Visual UI rules shared by all screens

Backgrounds are living pixel scenes with slow parallax and readable contrast, not static gradients. A fixed visual language uses dark navy metal, off-white text, cyan for player one, warm coral for player two, gold for credits, green for valid, amber for warnings, and red only for immediate danger. A one-pixel outer border, two-pixel bevel, chunky pixel icon, and restrained inset shade distinguish interactive panels. Use a hand-designed pixel display face for short headlines and a highly readable sans-serif for body text and settings. Never fake readability with tiny all-caps text.

Persistent controls across screens: top left Back if navigation is legal, top right Settings and audio toggle where relevant, lower region for the primary action. Show visible focus states, confirmation for destructive actions, unobtrusive error messages, and pressed, loading, disabled, and success states. Every modal is dismissible with an explicit close action unless the game state cannot safely return.

### 5.2 Boot and loading

Display the BOLT RIVALS emblem constructed from metal pixel tiles, with one car tearing across a black track and sparks flying off the logo. A progress bar has `Loading garage`, `Loading track`, and `Connecting` stages. Detect graphics capabilities and select quality defaults. Audio stays muted until a valid user gesture. If WebGL fails, attempt a tested Canvas fallback with reduced effects; if no supported renderer exists, show a precise compatibility error and retry button rather than a blank canvas.

### 5.3 Home

A highly polished animated garage scene fills the screen. A featured car on a rotating turntable idles, emits tiny exhaust pulses, and reflects warm and cool light. The background contains mechanics, shelves, blinking diagnostic lights, and slow pixel parallax. The main buttons in priority order are `Race AI`, `Challenge a Friend`, `Join with Code`, `My Blueprints`. A small `How to Play` and `Settings` control is present. Returning users see their last selected car and `Use Last Build` near the primary action. Include an optional `Quick Build` path that offers three complete legal starter templates tuned to the published weather and lets the player start in seconds. No fake online player counts, manipulative notification badges, or external ads.

### 5.4 Create and join lobby

`Challenge a Friend` opens a compact lobby with a bold match code, `Copy Link`, `Copy Code`, and `Waiting for your rival`. A small animated two-slot player podium shows who is present. Once both are in, the host selects a track and a weather preset from a fixed list or selects `Random`. The guest sees the selection update instantly. The host can lock selection with `Start Build`; the guest sees `Ready to build` with clear status. If code invalid or expired, state `This invite has expired. Ask your friend for a new link.` plus `Back Home` and `Try Another Code`.

### 5.5 Track preview

Use a full-bleed animated 8-bit diorama of the chosen biome, with a small overhead course map and prominent weather badge. Show track length category, dominant surface mix, number of major corners, and two clear build tips derived from actual traction and cooling modifiers. Example: `RAINY NIGHT`, `Wet asphalt: 65%`, `Cobblestone: 35%`, `Good grip matters more than raw power.` Show exact modifiers behind a `Track Details` foldout for players who want to optimize. Both players see precisely the same information. `Build Your Car` transitions to the timed garage.

### 5.6 Garage / builder

The most important interface outside racing. Landscape composition:

- Left 48%: oversized rotating top-down vehicle canvas on a checkered workbench. Tap a slot or a part, drag to move if allowed, rotate with an explicit control, zoom with two fingers only while not dragging a part. No accidental purchases on canvas taps.
- Right 52%: horizontally scrollable six-category rail and a vertically scrollable list of available parts. Every card shows a pixel sprite, exact price, weight, energy draw or output, heat effect, an understandable one-line benefit, and one-line downside. Selecting a card shows a comparison against the installed counterpart. `Install` or `Replace` is the deliberate transaction. A clear `Remove` returns its cost to budget.
- Top: 60-second synchronized timer, credits remaining, track/weather mini badge. A simple car performance strip shows Speed, Control, Defense, Firepower, and Utility as predicted output scores, not purchasable resources.
- Below the car: five engineering indicators, Budget, Load, Energy, Heat, and Stability. Hover or tap opens plain-English calculation details and an explicit warning about overload.
- Bottom: `Load Code`, `Save Draft`, `Reset`, and large `Ready` button. `Ready` remains available only with a legal operational car.

The garage starts with a complete baseline car. Swapping a chassis automatically attempts to transfer installed parts to corresponding sockets; incompatible parts move to the tray and immediately refund their price. Swapping wheel kits automatically adapts to the chassis wheel count. A preview predicts changed performance rather than merely showing raw stats. In-game left and right steering preferences do not affect garage drag behavior.

At 10 seconds remaining the timer gains urgency. At zero the server locks the last valid construction snapshot. Uncommitted drag positions revert to their last valid sockets; there is never a silent overspend. A player can save a draft while editing, even if it is not a legal racing build, but only legal completed blueprints can enter a race.

### 5.7 Load Code overlay

Input accepts `CAR-XXXXXX-XX` format, automatically removes spaces and normalizes uppercase. Validate the checksum before querying the server. Show an image of the imported car, its name, budget, and compatibility badge. `Use This Build` either installs it or shows a precise incompatibility message and a `Repair Build` option. Do not overwrite an existing build without confirmation. The player may save an imported copy as their own blueprint. A blueprint code is portable; it does not summon another player.

### 5.8 VS introduction

Four-second fight-card reveal inspired by combat sports, with two **accurate rendered cars** dominating either side. The camera slides along the bodywork to reveal visible upgrades, then cuts to both complete top-down silhouettes. Each car receives a believable computed descriptor, such as `LIGHTNING QUICK`, `HEAVY DEFENSE`, `DIRTY TRICKS`, or `ALL-ROUND MACHINE`. Show track and weather, but do not expose hidden exact budgets, internal stats, invisible utilities, or ammo. A heavy bass hit or chiptune stinger accompanies `VS`; red and cyan pixel lighting glows along the cars. A sharp countdown carries the visual energy into the live race. No pre-rendered car unrelated to the actual blueprint.

### 5.9 Live race

Landscape viewport with the local car placed near center and slightly below vertical midpoint to give road look-ahead. Camera follows vehicle movement and rotates gradually toward vehicle heading, with sensible smoothing to prevent dizziness. Preserve a stable steering interpretation. The rival remains visible naturally when in range; when outside camera bounds, show a clamped edge arrow, distance, and relative progress. Never zoom so far out just to include the rival that both cars become tiny. Render a small readable route ribbon and next bend warning.

HUD: top left player position and simple car status, top center remaining time and lap or progress, top right rival distance and simple status. A large primary weapon control and secondary weapon control sit on the action hand side; a repair or utility button appears beside them when equipped. Touching any unobstructed portion of the driving area creates the floating joystick. A top priority damage warning is short and never obscures the car for longer than a second. An optional pause/settings button opens the multiplayer-safe overlay described below. Keep HUD occupancy below approximately 18 percent of the safe screen area.

### 5.10 Live pause and interruption

In a multiplayer race, `Pause` opens a translucent overlay for audio, left-handed mode, reduced effects, help, and `Leave Race`; the server race continues and a safe neutral steering state is sent. Make this explicit: `The race keeps going while this menu is open.` In AI mode, pause the authoritative room while the human is in the menu, with a 120-second safety timeout; resume cleanly. A browser tab becoming hidden sends an input-neutral event. Rejoining shows `Reconnecting` and time remaining, not a reset or another car.

### 5.11 Results

The winning car drives onto a short podium animation; the losing car rolls up visibly damaged but not humiliated. Display `VICTORY` or `DEFEAT`, elapsed time, margin, and one or two high-signal facts: time lost to wheel damage, effective weapon hits, time above safe temperature, repair timing, or cornering advantage. Use a two-vehicle side-by-side performance comparison, with easily readable labels and no fake precision. Actions in priority order: `Race Again`, `Change My Build`, `Save This Car`, `Share Blueprint`, `Back Home`. In friend mode both players vote on rematch; do not enter a new race without consent.

### 5.12 My Blueprints

Grid of saved car cards, each with a genuinely composited thumbnail, editable name from a controlled safe character set with validation, total cost, track suitability hints, and `Use`, `Copy Code`, `Duplicate`, `Delete`. First version supports 30 locally cached blueprints per guest with persistent server records identified by anonymous guest token. If a guest clears browser storage and has no saved code, restoration cannot be guaranteed; make the share code easy to copy. Store an immutable blueprint version at creation so updates can explain incompatibility. Confirmation required for deletion. Provide a special `Starter Cars` tab with three curated templates and a `My Builds` tab.

### 5.13 Settings and accessibility

Driving hand: `Left Thumb Steers` or `Right Thumb Steers`. Default to left thumb steering and right thumb weapons; users may switch any time. Separate Music, Engine, Effects, and UI volume sliders; Mute; Reduced Motion; Reduced Flashes; Camera Shake amount; Particle Quality; High Contrast; Color-independent team markers; Larger Buttons; Show Touch Guide; Privacy Info. Default Reduced Flashes on for first launch. Settings persist locally without account setup.

### 5.14 Errors, offline states, and support screens

Dedicated branded states for lost server connection, game version mismatch, expired invitation, invalid car code, incompatible old blueprint, server full, renderer unsupported, and asset download failure. Every state has a meaningful retry or back action, and messages explain what happened without internal stack traces. Do not promise offline multiplayer. Previously saved local blueprints can be inspected offline; starting a race requires the server in the first release. Provide privacy, terms, feedback link, and credits in the footer.


### 5.15 Pixel UI layout coordinates and responsive wireframes

All percentages are measured inside the safe landscape viewport after device insets. They are implementation starting points to be refined with screenshot tests, not invitations to hide controls on smaller screens.

| Screen | Region | Suggested safe-view allocation |
|:---|:---|:---|
| Home | Animated featured car and title | Left 55% of width, full height |
| Home | Primary menu and secondary controls | Right 42%, vertically centered |
| Track Preview | Animated biome and map | Left 60% |
| Track Preview | Weather, track facts, tips, ready | Right 40% |
| Garage | Vehicle editor and engineering indicators | Left 48%, full height minus header |
| Garage | Category rail, part list and inspect card | Right 52%, scroll independently |
| Garage | Timer and credits | Top 12% across full width |
| VS | Local vehicle | Left 42%, full-height dramatic silhouette |
| VS | Opponent vehicle | Right 42%, mirrored composition |
| VS | Match title, VS, countdown | Central 16%, overlays allowed |
| Race | Local car | Camera anchor x 52%, y 62% |
| Race | Progress, timer, racer indicators | Top 12% |
| Race | Action buttons | Trailing action-hand side, lower 42% |
| Race | Floating steering touch | Any remaining play canvas |
| Results | Accurate car composition | Upper and central 60% |
| Results | Stats and action row | Lower 40% |

Recommended landscape garage composition:

```text
[ Back ] [ Track and weather ]  [ 00:38 ]  [ Credits 420 ]
[                                                            ]
[  ROTATING CAR BUILD               ] [ CHASSIS  ENGINE  ... ]
[  Tap a mount to inspect           ] [ Part card             ]
[  Move, rotate, or remove parts    ] [ Price / stats         ]
[                                    ] [ Install / Replace     ]
[  Load  Energy  Heat  Stability    ] [ More parts below      ]
[                                                            ]
[ Load Code ] [ Reset ] [ Save ]           [ READY TO RACE ]
```

Recommended landscape live race composition:

```text
[ YOU + STATUS ]       [ 01:42  LAP 1/2 ]       [ RIVAL + GAP ]
[                                                             ]
[                  Track ahead and hazards                    ]
[                                                             ]
[                    Rival when nearby                        ]
[                                                             ]
[                      YOUR CAR                               ]
[                                                             ]
[       Floating steering                       ( Weapon 1 ) ]
[       where finger begins                    ( Weapon 2 )  ]
[                                               ( Repair )    ]
```

The player may choose the opposite hand; only the action stack and associated HUD details mirror. On a short-height phone, collapse secondary garage descriptions into a tap-to-expand detail pane while keeping all mandatory part stats one tap away. In portrait fallback, show a taller track viewport, vertically stacked weapon buttons, and hide purely decorative HUD; the physical car and controls remain visible. UI never covers the local vehicle at its default camera anchor.

### 5.16 Back navigation and button semantics

Home Back exits an open overlay rather than navigating outside the browser unexpectedly. Track Preview Back returns to lobby or home before the build is locked. Garage Back prompts the player to confirm leaving the competitive match if building has started. VS and Countdown do not permit reversing the match phase. Results Back goes to home or friend lobby. Every button triggers the named action and exposes a disabled/loading state when unavailable. No information-only control should look like an actionable button.

## 6. Vehicle Construction and Engineering Rules

### 6.1 Valid vehicle requirements

Each car must have exactly one chassis, one engine module, and one compatible full wheel kit. A chassis supplies a small baseline electrical system, brake mechanism, steering linkage, and protected cabin as part of its purchase. The cabin is stylized and never contains a visibly injured person. Extra equipment is optional. The purchase price is deducted from exactly 1,000 credits; selling any installed part before the race restores its full price. No loans, discounts, persistent currencies, randomized shop prices, or unlisted costs.

`totalCost = chassisCost + engineCost + wheelKitCostAdjustedForWheelCount + sum(extraPartsCost)`. Values use integer credits. Require `totalCost <= 1000` at every committed snapshot. Empty part slots cost nothing. Every part is either in an installed legal socket or in the inventory preview tray; uninstalled parts do not count toward the vehicle and are automatically refunded before Ready. No duplicate unique effects if a part definition says `unique`.

### 6.2 Five engineering indicators

The garage shows five main operational indicators. Expose precise raw numbers on inspection and colorful normalized gauges at a glance.

1. **Budget:** 1,000 minus committed credits. Hard limit. Every comparison shows new spend and refund separately.
2. **Load:** Installed mass compared with the chassis' recommended load and maximum safe load. Going above recommended load but below maximum is allowed with reduced acceleration, poor braking, and slightly higher heat. Over maximum is illegal. The indicator is not a simple damage number.
3. **Energy:** Peak sustained draw divided by the chassis base generator plus installed generators. The battery smooths bursts. Energy shortage can cause low-priority equipment to throttle but the drivetrain must retain a protected minimum supply.
4. **Heat:** Estimated sustained heat production divided by cooling capacity under the published weather conditions. Crossing 100 percent is allowed with understandable overheating risk and predictable duty-cycle loss.
5. **Stability:** Derived from lateral center of mass, longitudinal balance, wheelbase, track width, tire grip, steering geometry, and tall attachments. Values below a chassis-specific threshold are allowed but produce clear handling penalties. Extremely unstable configurations receive a warning and must still be drivable.

The player also sees predicted performance scores: Speed, Control, Defense, Firepower, Utility. These scores are diagnostics, not additional resources or independent purchasable stats. Recalculate using the selected track/weather and show changed deltas before installing a part. Avoid fake decimal precision; show whole-number bars 0 to 100 and precise expandable details.

### 6.3 Chassis coordinate system and physical installation

Treat the front as local negative Y and right as local positive X in the garage. Every chassis is an immutable layout consisting of physical bounds, mount points, mount type, capacity, allowable angle range, allowed sizes, and predefined wheel anchors. Chassis mount categories: `ENGINE`, `WHEEL`, `ROOF`, `FRONT`, `REAR`, `LEFT`, `RIGHT`, `UTILITY`, `ARMOR`, and `UNIVERSAL`. Slots may support more than one category. Mounts form named hardpoints such as `front_center`, `roof_mid`, `left_outer`, and `rear_utility`.

For speed and touch accessibility use a flexible socket system, not a completely free rigid-body construction editor. After selecting a compatible hardpoint, the user can position a component within a small bounded installation region, choose 0, 90, 180, or 270 degrees of local orientation when applicable, and flip a left/right paired item. Part centers and masses move with this placement. Weapon muzzle direction follows orientation; armor protects a specific arc. For example, a right-mounted turret can be turned rearward, but cannot overlap the wheels, obstruct the driver, or protrude beyond legal allowed bounds without a compatible outrigger mount. Collision overlaps are validated using simplified part polygons with at least 2 pixels of visual clearance, and hardpoints have attachment limits.

Chassis offer different number and type of hardpoints, allowable sizes, mass capacity, base electrical supply, and structural integrity. This makes a tiny fast three-wheel chassis and a large six-wheel chassis both plausible. Three-, four-, and six-wheel bodies exist. The same wheel kit SKU installs as a **complete compatible set** and is priced by `round(baseFourWheelPrice * wheelCount / 4)`. Damage affects individual wheels. A spare wheel is a one-use item suitable for any wheel on the car.

Default loadout: `chassis_beetle` (150 credits), `engine_four_cylinder` (140 credits), and `tires_street` (80 credits for four wheels), total 370. The vehicle is roadworthy without extras. Rookie tutorial adds `weapon_front_mg` (70) and `utility_spare` (40), for a 480-credit starter car with meaningful spare budget. A first-time default should be intentionally suboptimal, not secretly stronger than player builds.

### 6.4 Chassis archetypes and mount layout table

Common baseline is 4 wheels, 7 physical mounts, recommended load 500 kg, and max safe load 800 kg. Entries below override the baseline. Mount shorthand: F front, B rear, L left, R right, T roof, U utility. Engine and wheel anchor mounts are included but do not count against accessory mounts. Armor can attach to allowed perimeter mounts when no incompatible overlapping module occupies that location.

| Chassis family | Wheel count | Accessory mount bias | Recommended / max load | Handling character |
|:---|:---:|:---|:---|:---|
| Beetle | 4 | F B T U, 5 mounts | 460 / 730 kg | Forgiving and compact |
| Needle | 4 | F T, 4 mounts | 350 / 560 kg | High top-speed modifier |
| Turtle | 4 | F B L R T, 7 mounts | 720 / 1050 kg | Durable and slow |
| Spider | 6 | L R T U, 8 mounts | 760 / 1150 kg | Very stable and wide |
| Crab | 4 | L R L R T, 8 mounts | 630 / 950 kg | Side-mounted tricks |
| Cobra | 4 | F F T B, 6 mounts | 550 / 850 kg | Straight-line front attack |
| Scorpion | 4 | B B T U, 6 mounts | 550 / 850 kg | Rear weapon emphasis |
| Buggy | 4 | F T B U, 6 mounts | 460 / 780 kg | Off-road suspension |
| Chameleon | 4 | Universal x8 | 520 / 790 kg | Flexible and fragile |
| Brick | 4 | F B L R T U, 9 mounts | 850 / 1250 kg | Large and heavy |
| Trike | 3 | F B T, 4 mounts | 280 / 460 kg | Agile but unstable |
| Arrow | 4 | F B T, 4 mounts | 420 / 680 kg | Excellent drag coefficient |
| Wagon | 4 | B B U U T, 8 mounts | 720 / 1090 kg | Support and slow turning |
| Rammer | 4 | F F L R, 7 mounts | 710 / 1090 kg | Heavy frontal collision |
| Drifter | 4 | B L R T, 6 mounts | 490 / 770 kg | Controlled slip |
| Kangaroo | 4 | F B U, 5 mounts | 530 / 860 kg | Bumps and jump support |
| Horseshoe | 4 | F F L R, 6 mounts | 610 / 940 kg | Large front cavity |
| Pickup | 4 | B B U U, 8 mounts | 690 / 1080 kg | Rear modular cargo |
| Twins | 4 | L R T T, 8 mounts | 790 / 1180 kg | Very wide and unusual |
| Platform | 4 | Universal x10 | 680 / 1020 kg | Maximum freedom, exposed parts |

All accessory counts and load figures are balance starting values. They are authoritative seed data, not invented placeholders to be ignored; any balancing changes must be versioned and measured. Each chassis must provide named mounts sufficient to express its listed bias. No graphics or gameplay code may assume every car has four wheels or a symmetrical body.

### 6.5 Budget, mass, energy, and heat calculations

Use SI-inspired internal units but label the garage in friendly terms. Speed HUD displays MPH by default in US English, with a selectable KM/H setting. Actual physical distance units may be abstract game meters as long as the model remains consistent. Suggested base parameters:

- Simulation step `dt = 1/30 second`; fixed-step accumulator on server.
- Car mass in kg; base chassis + engine + adjusted wheel kit + all modules.
- Force in abstract consistent Newton-like units. Drive acceleration `a = availableWheelForce / mass`, limited by surface traction.
- Power fraction when engine is thermally limited depends on excess heat, capped at a 35 percent sustained engine power penalty.
- Protected drivetrain power ensures at least 55 percent of rated engine output after auxiliary electrical overload; power shortages disable or slow optional modules first.
- Weather multiplies grip, cooling, and selected effect durations. Same weather for both racers.
- Chassis base electrical generation is 10 power units per second; battery stores 40 energy units; additional generators and batteries change these. Weapon power is drawn on firing, while scanners and shields can have continuous draw.
- Heat generation and cooling use heat units per second. Base cooling rate 8 at clear-weather speed, scaled by ambient temperature and airflow. Heat warning threshold 70, performance threshold 90, thermal protection threshold 110, recovery below 75. Heat is local to subsystems for damage and shared for simplified gameplay summaries.
- Stability score derived from `100 - lateralWeightPenalty - highCenterPenalty - wheelbasePenalty - damagePenalty + stabilizationBonus`; clamp score to 10 to 100, never mathematically divide by zero.
- Engine power demand, generated current, temperature, per-weapon cooldown, and individual wheel condition are actual server state, not purely cosmetic meters.

Recommended feel tuning for default Beetle: road speed 70 to 95 display MPH, cornering without spin on a moderate bend, 0 to 60 MPH in approximately 4 seconds of game time, steering settle time 0.18 second, wall scrape speed loss 8 to 20 percent, single medium weapon hit speed loss no more than 25 percent for 1.5 seconds. These are starting test targets, not claims of real vehicle physics.

### 6.6 Installation conflict rules

For every attempted change, validate ownership within the current room build, sufficient credits, compatible mount class, physical clearance, wheel count, mass cap, unique-per-car restrictions, ammo capacity, mandatory components, and specific dependencies. A small weapon may share a compatible roof rack with a radar if mount size and clearance permit; a large mortar occupies the full roof hardpoint. Large armor panels may cover a protected arc but can block some mount points. Paired wheel anchor replacement is always atomic.

If a build is illegal, the interface highlights the exact offending item and the reason: `Not enough credits`, `No compatible mount`, `This part blocks your turret`, `Too much weight`, or `One per car`. Do not silently ignore the user's purchase. Undo and redo: last 20 garage transactions, local to the current build session. Changing a chassis creates one atomic undo step.

## 7. Steering, Camera, and Responsive Touch Controls

### 7.1 Floating Pull Joystick

The driver may place the steering finger **anywhere on the unobstructed game canvas**. On pointer down, save the touch origin and pointer ID. Show a translucent 42-pixel-radius control disc at that exact location. Capture the pointer so sliding beyond the visual disc keeps control. Normalize displacement by the control radius, apply a soft dead zone of 0.12, then a response curve `response = sign(u) * abs(u)^1.25` with a clamp to [-1,1]. Use horizontal displacement to control left/right steering **relative to the camera-aligned forward direction**. Upward displacement maintains automatic throttle; downward displacement increasingly lifts throttle and applies brake. Diagonal down-left and down-right combine braking with steering.

Explicit mapping in the car-facing-up camera frame:

- `dx > 0`: turn right, strength proportional to horizontal displacement.
- `dx < 0`: turn left.
- `dy > 0.18` downward: progressively release throttle and brake.
- `dy <= 0.18`: automatic acceleration at available engine capacity.
- No touch: maintain gentle automatic throttle and a steering target of zero. Vehicle heading does not snap to road orientation.

The controls should feel like pulling the car into a turn. Add a faint directional pull arrow from disc center to thumb position. The disc is an input affordance, not a permanently mounted controller. Only the first active pointer designated for steering owns this joystick. Other pointers interact with weapon, repair, and menu buttons. A pointer beginning on a button is never captured as steering; a finger crossing a button while steering never fires accidentally. The driver can change fingers after release without teleporting the steering state. Support `pointercancel`, multitouch, prevent unwanted page scroll on the game surface with `touch-action: none`, and allow the browser to scroll in menus.

Use hysteresis and filtering: steering response approaches commanded target over 80 to 140 ms, release recenter over 180 ms; dynamic steering gain decreases slightly at high speed but never makes correct turns impossible. Camera heading follows a smoothed angular target with at most 60 degrees per second rotation by default, and a limited forward look-ahead offset. Offer `Reduced Camera Motion` to keep north-up map orientation if requested, with screen-relative steering remapped consistently.

**Handedness:** The car can be steered from any non-button region, but the action cluster sits on the opposite side of the chosen driving hand. Default left-steering, right-actions. Mirror action buttons, warnings, small HUD details, and repair affordances for right-steering users. Do not mirror the game world or reverse steering.

### 7.2 Desktop controls

Arrow keys or WASD steer and brake, spacebar fires weapon 1, `E` fires weapon 2, `R` uses repair, `Escape` opens settings. Mouse operates all menus and can optionally steer by dragging on the gameplay canvas. Desktop and touch commands converge into the same normalized input schema. No competitive advantage from a mouse-only aim mechanism unavailable to touch users.

### 7.3 Car handling model

Use a custom arcade vehicle integrator shared between the server and client. Horizontal dynamics:

1. Look up engine torque curve, transmission ratio and effective wheel force.
2. Calculate speed-specific traction from installed tire set, current surface, wetness, wheel condition, suspension, downforce, and stability.
3. Integrate forward velocity with engine force and drag.
4. Integrate yaw rate from steering input and wheelbase, with a limited high-speed steering response.
5. Allow manageable lateral slip; grip recovers gradually, creating satisfying drifts.
6. Resolve collisions against solid walls, obstacles, and other cars, preserving tangential motion with speed loss rather than full stops.
7. Apply damage, overheat, and equipment effects after impacts.

Use continuous or swept collision tests for fast moving projectiles and cars. A visual effect must not alter the physical collision shape. Damage state, performance, physics, and displayed car animation derive from one authoritative vehicle model.

### 7.4 Fair assisted driving

At lower speeds, the car has strong steering assist and grip recovery. On moderate corners, speed-aware throttle assist can reduce oversteer. Very sharp corners still reward deliberate braking and proper tires. Rebound walls are forgiving, not teleporters. Light cars feel nimble and can be knocked aside; heavy cars feel grounded and harder to turn. Six-wheel machines do not magically fit through narrow gaps. Off-road shortcuts are possible only where map collision and checkpoints explicitly permit them. No auto-navigation or hidden lane magnet turns a bad build into a perfect car.

### 7.5 Camera and offscreen rival

Local camera anchor is approximately 52 percent screen width and 62 percent screen height. Zoom range equivalent 1.0 to 1.25 based on near obstacles and speed, with smooth interpolation only. Do not make the road pitch like a 3D racing camera; retain a top-down ortho perspective. Keep static map geometry pixel-sharp. Never rotate the HUD or minimap with the world camera.

Remote car positions use buffered interpolation. Offscreen rival indicator uses edge-clamped direction and `Ahead 85m` or `Behind 32m` labels. Never display exact opponent fuel, internal heat, spare count, or hidden installed electronics. Show only visible status and actual course position.

## 8. Damage, Repair, and Combat

### 8.1 Component damage

Each damageable installed part has integrity `0..100`, an armor/penetration factor, heat resistance, and tagged hitbox arc. Chassis integrity is separate from component integrity. Hits allocate damage between outer armor, local component, chassis, and nearby modules based on entry angle and penetration. The component physically visible at the hit position is the one most likely to be affected. Example: rear-left hit can damage the rear-left wheel instead of the front-right wheel. Projectiles should not randomly target unseen systems.

States: `healthy` above 65; `damaged` between 20 and 65; `critical` between 1 and 20; `disabled` at 0. Individual effects are continuous with integrity and capped:

- Damaged wheel: reduced local grip, steering bias up to a moderate 12 percent equivalent, smoke/rubber flecks; disabled wheel still rolls at 35 percent wheel efficiency in limp mode.
- Damaged engine: lower torque, rising heat and more exhaust smoke; disabled engine invokes limp-home power at 50 percent normal default output unless KO criteria are met.
- Damaged steering: reduced response and slight steering delay; never uncontrollable permanent spin.
- Damaged weapon: greater reload delay, occasional harmless misfire spark; fully disabled until repaired.
- Damaged armor: visible holes and flakes, increased incoming penetration.
- Damaged electrical utility: device throttles or shuts off while core drivetrain protected.

Critical visual feedback is readable on the vehicle and a tiny subsystem silhouette icon, not a full-screen obstructive smoke curtain. Damage cannot chain-stun a car: 2-second crowd-control immunity after any major forced steering or hard disable effect. Total combined temporary speed suppression from debuffs capped at 45 percent in ordinary play. A racer must always have meaningful steering or a short assist recovery.

### 8.2 Repairs

`Spare Wheel`: manually replaces the most damaged wheel after a 1.0-second activation sequence; activation reduces acceleration by 20 percent for 1 second. Prefer wheel manually selected on the small car silhouette if more than one is damaged; otherwise auto-select worst wheel. It is consumed once. `Repair Kit`: manually restores 40 integrity to a selected damaged part, or automatically to the worst critical core part if none chosen. Takes 1.3 seconds and cannot be repeatedly spammed. `Winch`: if trapped against obstacle for over 1.5 seconds, allows a short physically plausible pull forward, with a cooldown; no teleport across checkpoints. Recovery items can be disrupted but not permanently robbed.

Persistent component damage remains until a consumable repairs it or a part-specific recovery rule fires. Electrical stun and heat state recover naturally. No permanent damage carries into the next race. Garage blueprints always load with fully working parts.

### 8.3 Weapon input and lifecycle

Two player-controlled slots: primary and secondary, each bound to an installed manual or hybrid weapon. Automatic weapons evaluate their own server-side target conditions. Additional installed manual weapons beyond two may be assigned to an alternate deck via `Loadout` in the garage, but initial release permits at most two manually activatable weapon systems to prevent overcrowded mobile controls. Other weapons must be configured auto or passive, or remain inactive; the garage warns explicitly before Ready.

Weapon lifecycle: `IDLE > TARGETING (if applicable) > ACTIVE > COOLDOWN > IDLE`. Every weapon has price, mass, mount, orientation, aim cone, range, power per shot or per second, heat, cooldown, charges or ammo, and a declared effect. All states are server-owned. Visual muzzle flash and input response may predict locally, but the server alone determines hits, damage, and ammo consumption. Auto systems have a published targeting rule, such as nearest visible enemy within a rear 90-degree arc. Require line-of-sight when appropriate.

Weapons are not hitscan through walls unless explicitly designed as an electrical near-range effect. Projectiles collide with cover, barriers, countermeasures, destructible props, and cars. Friendly fire is irrelevant in 1v1. Mine placement is capped at six live mines per racer and projectiles have a 5-second maximum life unless their catalog definition says otherwise. Any capped entity replaces its oldest owned entity cleanly.

### 8.4 Weapon identity, status stacking, and fairness

Use effect families instead of unrelated special-case code: direct physical damage, splash, thermal, grip loss, electrical disruption, impulse, tether, persistent road hazard, aim interference, and area denial. Similar debuffs use strongest effect plus capped duration extension, not unlimited arithmetic stacking. Countermeasure opportunities need clear visual telegraphs. Guided missiles warn for 0.5 second before impact if a target lock is established. EMP shows charge pixels; mortars paint an impact reticle. A driver should understand why something happened in 1 second, without reading a combat log.

Recommended combat pacing: meaningful weapon opportunity every 8 to 15 seconds per aggressive build, but no permanently continuous screen explosions. Typical direct hit damage 8 to 18 component points and 2 to 8 chassis points. Heavy rare hits 20 to 30 component points and 8 to 12 chassis points. Impact effects may look enormous, but game damage remains controlled. Establish a global per-weapon cooldown floor of 1.2 seconds for active fire commands, except sustained automatic bullet weapons with per-bullet simulation and heat limitation.

### 8.5 Damage readability during a hectic finish

Prioritize visual layers: vehicle silhouettes and position > road edge > interactive hazards > attack telegraphs > hit sparks > decorative particles. Tone down visual size automatically when multiple effects overlap near the local player. Smoke opacity over the local driving lane should not exceed about 30 percent, and must clear rapidly. Persistent fire trails must clearly show the hazard area independent of color, via animated pixel pattern and outline. Full-screen flash amplitude is low; offer a no-flash option.

## 9. Track System, Biomes, and Weather

### 9.1 Track content contract

Ship eight polished tracks across five biomes for full v1: two City circuits, two Desert routes, two Forest routes, one Snow circuit, and one Industrial route. The snow and metal tracks make specialized wheel kits meaningful from launch. Technical scope allows Harbor and Volcano expansions later but does not require their art at initial launch. Full game includes 120 catalog parts and eight launch tracks; content expansion slots remain data-driven. Each track is a real authored level with centerline spline, width profile, collision mesh or tile colliders, checkpoint chain, alternate shortcut branches, spawn coordinates, surface zones, environment hazard tags, VFX anchors, camera bounds, and weather options.

Launch tracks:

| ID | Name | Biome | Character | Dominant surfaces | Weather choices |
|:---|:---|:---|:---|:---|:---|
| city_01 | Neon Cut | City | Fast outer ring with tight downtown hairpins | Asphalt 80%, cobble 20% | Clear night, rainy night |
| city_02 | Backstreet Blitz | City | Narrow shortcut alleys, barricades, tram crossing | Asphalt 60%, cobble 40% | Clear, rain |
| desert_01 | Dust Devil | Desert | Sweeping bends and risky sandy inside lines | Asphalt 45%, sand 55% | Clear, crosswind |
| desert_02 | Canyon Switch | Desert | Cliffside S-bends and wind-blown plateaus | Asphalt 65%, sand 35% | Dry heat, sandstorm |
| forest_01 | Moss Run | Forest | Wet shaded bends, a bridge, muddy detour | Asphalt 50%, dirt 30%, mud 20% | Clear, rain |
| forest_02 | Timber Dash | Forest | Long straights broken by tight tree chicanes | Asphalt 45%, dirt 45%, mud 10% | Clear, heavy rain |
| snow_01 | Whiteout Pass | Snow | Slippery turns, frozen pond and plowed sprint lanes | Snow 55%, ice 25%, asphalt 20% | Clear frost, snowfall |
| industrial_01 | Steel Circuit | Industrial | Magnetic floor strips, oil hazards and tight factory turns | Metal 45%, asphalt 40%, cobble 15% | Dry night, factory rain |

Full map art must have intentional silhouettes and foreground frames: building corners, signs, trees, canyon ledges, bridges, rail lights. Foreground occlusion around the player fades or becomes translucent to preserve visibility. No impossible blind corners caused by decorations. Shortcuts are discoverable and risky rather than mandatory for victory. Make the safe path immediately readable with lane markings, curb color, and track lighting.

### 9.2 Weather math

Use deterministic track presets chosen before building. The preset sets ambient temperature, rain intensity, wetness, wind vector, visibility modifier, and cooling multiplier. Example multipliers for **road surface grip before tire specialization**:

| Condition | Asphalt | Cobble | Sand | Dirt | Mud | Snow | Ice | Metal | Cooling |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Clear | 1.00 | 0.87 | 0.61 | 0.82 | 0.52 | 0.48 | 0.29 | 0.97 | 1.00 |
| Rain | 0.73 | 0.61 | 0.58 | 0.65 | 0.40 | 0.43 | 0.25 | 0.72 | 1.18 |
| Heavy rain | 0.63 | 0.52 | 0.54 | 0.56 | 0.34 | 0.40 | 0.23 | 0.65 | 1.25 |
| Sandstorm | 0.91 | 0.85 | 0.55 | 0.71 | 0.47 | 0.46 | 0.28 | 0.89 | 0.94 |
| Dry heat | 1.00 | 0.88 | 0.57 | 0.80 | 0.50 | 0.50 | 0.31 | 0.98 | 0.78 |
| Snowfall | 0.66 | 0.55 | 0.58 | 0.61 | 0.37 | 0.42 | 0.24 | 0.65 | 1.15 |
| Clear frost | 0.75 | 0.65 | 0.60 | 0.69 | 0.40 | 0.52 | 0.28 | 0.77 | 1.08 |

Tire specialization multiplies local grip on top of this table and is capped to avoid impossible sideways acceleration. Wind mainly affects exposed bodies and airborne projectiles. Weather changes are pre-authored visual effects inside the same published preset; never add a surprise storm after the build timer. Consistent weather simulation runs on the server, cosmetic raindrop positions run locally with deterministic or cosmetic seeded randomness.

### 9.3 Race progression and route lengths

Choose route length from a verified default-car completion time: approximately 105 seconds on the short course and 130 seconds on the longer course. Track designers measure laps and speed in the simulator instead of guessing distance. Visible arrow signs and sharp-bend road chevrons communicate upcoming corners 0.8 to 1.2 seconds before arrival at normal speed. Maintain a valid return path after leaving the road; off-road traction slows most vehicles but does not trigger instant failure.

No random power-up boxes on the road in v1. Every weapon and repair resource comes from the build, which preserves strategic fairness. Environmental obstacles affect both racers and are telegraphed. Allow AI to use shortcuts only if it actually drives and passes shortcut checkpoints.

## 10. Match Data, Balance, and Competitive Integrity

### 10.1 Core damage and performance defaults

`chassisIntegrity = baseChassisHP + armorHPContribution`, with a balance target around 100 to 150 points for a starter car. Armored chassis can have more, but pay in mass and speed. Component integrity starts at 100 and may be modified for armor or special engines. No instant destruction from a single ordinary weapon. Physical impact damage uses relative speed, combined mass, angle, and armor. Apply a collision forgiveness band for casual wall grazing. Weapon hits follow declared armor penetration and shield interactions. Track hazard damage scales lower than weapon damage unless clearly signaled.

### 10.2 Required balancing framework

Maintain a bot tournament harness that evaluates candidate builds against each other on all launch maps and weather presets. Store win rate, median time, KO rate, collision count, effective damage, heat exposure, energy starvation, damage-related loss of control, and average cost used. Every part must have at least one meaningful use case and one real tradeoff. No single preset blueprint should exceed a 65 percent win rate against the broad balanced reference build set across all eight launch tracks unless its opponents are deliberately poor. This is a warning threshold for balancing review, not a magical global win-rate guarantee.

Create human-readable balance changelogs with semantic catalog versions. At each release, perform 1,000 automated matches across representative build archetypes, varying maps, weather, and bot decision noise, then run human playtesting to verify the feel. Automated win rates are only evidence; they do not replace human testing for fun and readability.

### 10.3 Blueprints fairness and validation

Server converts blueprint IDs and transforms into canonical structured data. Refuse unknown part IDs, duplicated unique parts, negative costs, nonexistent sockets, invalid offsets, invalid rotations, unpaired wheel kits, insufficient budget, and incompatible catalog versions. Never trust client-computed totals, physics, damage, ammo, position, timers, or victory. Prevent replaying a previously accepted fire command with duplicated sequence IDs. Rate-limit room joins, blueprint code lookups, and RPC calls. Preserve reproducible match logs for dispute and debugging without publishing private invites.

## 11. Complete Part Catalog and Data Standards

### 11.1 Data format

All 120 parts below must be represented as rows in `packages/content/src/parts.ts` or generated from validated JSON, with individual IDs, costs, mass, sprite reference, compatible mounts, gameplay modifiers, and required visual/audio event hooks. Each part must have at least one test validating its distinct mechanic. The tables below provide the **seed balance**. The exact physics curves may be tuned via config, but prices and part identity are the specified initial values.

Use fields such as:

```ts
type PartCategory = 'chassis' | 'engine' | 'tires' | 'weapon' | 'defense' | 'utility';
type TriggerMode = 'manual' | 'automatic' | 'hybrid' | 'passive';
type PartDefinition = {
  id: string;
  displayName: string;
  category: PartCategory;
  price: number;
  massKg: number;
  footprint: { w: number; h: number };
  compatibleMounts: string[];
  spriteKey: string;
  soundKey: string;
  description: string;
  drawback: string;
  modifiers: Record<string, number>;
  behaviorId?: string;
  triggerMode?: TriggerMode;
  params?: Record<string, number | string | boolean>;
  maxPerCar?: number;
};
```

Chassis include the extra mount layout described in Section 6.4; tire prices refer to a set of **four** with automatic wheel-count adjustment. `massKg` for a tire kit likewise assumes four wheels. Weapon and defense entries state a distinct combat behavior rather than simply a cosmetic name. For numeric effect balancing, implement the shared primitives described in Section 11.8 and use the values in the part's `params` field.

### 11.2 Chassis: 20 entries

| ID | Display name | Cost | Mass kg | Defining modifier or restriction |
|:---|:---|---:|---:|:---|
| chassis_beetle | Beetle | 150 | 250 | Balanced starter, five accessory mounts |
| chassis_needle | Needle | 135 | 180 | Top speed +8%, reduced armor capacity |
| chassis_turtle | Turtle | 215 | 460 | Chassis HP +35%, yaw response -12% |
| chassis_spider | Spider | 235 | 420 | Six wheel anchors, stability +18 |
| chassis_crab | Crab | 195 | 330 | Side weapon rotation freedom +45 degrees |
| chassis_cobra | Cobra | 170 | 295 | Forward hardpoints x2, yaw response -8% |
| chassis_scorpion | Scorpion | 180 | 310 | Rear hardpoints x2, rear weapon range +8% |
| chassis_buggy | Buggy | 165 | 240 | Dirt and sand grip +12%, armor limit -15% |
| chassis_chameleon | Chameleon | 195 | 275 | Eight universal mounts, HP -18% |
| chassis_brick | Brick | 245 | 560 | Nine accessory mounts, drag +20% |
| chassis_trike | Trike | 120 | 145 | Three wheel anchors, stability -16 |
| chassis_arrow | Arrow | 180 | 230 | Drag -16%, only four accessory mounts |
| chassis_wagon | Wagon | 190 | 390 | Utility capacity +2, turning radius +12% |
| chassis_rammer | Rammer | 220 | 455 | Frontal ram impulse +20%, mass penalty |
| chassis_drifter | Drifter | 155 | 260 | Lateral slip recovery +15%, peak grip -6% |
| chassis_kangaroo | Kangaroo | 190 | 325 | Obstacle impulse reduction +22% |
| chassis_horseshoe | Horseshoe | 195 | 350 | Fits oversized front weapon, weak rear arc |
| chassis_pickup | Pickup | 185 | 365 | Two cargo utilities, rear parts exposed |
| chassis_twins | Twins | 230 | 490 | Side stability +20, width +25% |
| chassis_platform | Platform | 210 | 390 | Ten universal mounts, base HP -22% |

### 11.3 Engines: 20 entries

All engines attach to `ENGINE` mounts. The baseline Four-Cylinder yields engine force index 100; other values are relative. Cooling and electrical effects are additive in the shared simulation. `heat/s` is heat produced at sustained full throttle before cooling.

| ID | Display name | Cost | Mass kg | Force index | Heat/s | Character |
|:---|:---|---:|---:|---:|---:|:---|
| engine_mini_electric | Mini Electric | 75 | 45 | 62 | 4 | Quiet, low weight, electrical draw 5/s |
| engine_four_cylinder | Four-Cylinder | 140 | 95 | 100 | 8 | Reliable all-rounder |
| engine_v6 | V6 | 175 | 120 | 128 | 11 | Stronger acceleration |
| engine_v8 | V8 | 220 | 155 | 158 | 15 | Heavy high torque |
| engine_v12 | V12 | 290 | 180 | 183 | 19 | High top speed, expensive |
| engine_small_turbo | Small Turbo | 145 | 88 | 118 | 14 | Faster burst acceleration |
| engine_twin_turbo | Twin Turbo | 255 | 148 | 168 | 21 | Very hot sustained power |
| engine_supercharger | Supercharger | 225 | 155 | 157 | 17 | Consistent torque and drag |
| engine_diesel | Torque Diesel | 175 | 175 | 142 | 11 | Hill and collision recovery, lower max RPM |
| engine_electric_sport | Sport Electric | 225 | 112 | 152 | 13 | Fast launch, power draw 14/s |
| engine_electric_eco | Eco Electric | 115 | 85 | 91 | 5 | Efficient, draw 6/s |
| engine_hybrid | Hybrid | 195 | 138 | 129 | 9 | Efficient at partial load, bonus regen |
| engine_rotary | Rotary | 165 | 73 | 122 | 17 | Lightweight, vulnerable to heat |
| engine_turbine | Turbine | 250 | 135 | 146 | 19 | High speed after wind-up, low initial pull |
| engine_rocket | Rocket Engine | 280 | 130 | 192 | 26 | Huge controlled bursts, fuel pulse limits |
| engine_twin | Twin Drive | 270 | 190 | 166 | 20 | Better traction delivery, high mass |
| engine_spring | Spring Drive | 130 | 85 | 110 | 7 | Stores one launch burst per 12 seconds |
| engine_offroad | Trail Engine | 175 | 125 | 123 | 10 | Maintains torque on dirt, lower road top speed |
| engine_resilient | Ironheart | 185 | 155 | 110 | 9 | Loses less output from damage |
| engine_experimental | Wildcard Motor | 235 | 98 | 162 | 23 | Output pulses in a repeatable 4-second cycle |

### 11.4 Wheel kits: 20 entries

`Grip` is the asphalt clear-weather multiplier; the conditions column describes additional surface specialization. All values adjusted for wheel count. Standard kit mass is 48 kg, cost 80 credits.

| ID | Display name | Cost / 4 | Mass kg / 4 | Grip | Defining interaction |
|:---|:---|---:|---:|---:|:---|
| tires_slick | Slicks | 110 | 48 | 1.22 | Rain penalty 25% |
| tires_street | Street Tires | 80 | 48 | 1.00 | Consistent baseline |
| tires_rain | Rain Runners | 110 | 54 | 0.96 | Rain grip +35% |
| tires_sand | Sand Paddles | 125 | 75 | 0.86 | Sand grip +55% |
| tires_mud | Mud Claws | 120 | 76 | 0.86 | Mud grip +55% |
| tires_snow | Snow Treads | 110 | 59 | 0.92 | Snow grip +48% |
| tires_ice | Ice Spikes | 125 | 63 | 0.87 | Ice grip +58%, asphalt friction penalty |
| tires_soft | Soft Compound | 115 | 50 | 1.15 | Wear after 90 seconds |
| tires_hard | Hard Compound | 90 | 55 | 0.94 | Damage resistance +22% |
| tires_drift | Drift Rings | 100 | 52 | 0.92 | Easier controlled slip and recovery |
| tires_armored | Armored Tires | 150 | 102 | 0.90 | Wheel integrity +55% |
| tires_solid | Solid Core | 140 | 88 | 0.88 | Puncture effects -85% |
| tires_balloon | Balloon Tires | 105 | 72 | 0.85 | Obstacle impulse -25% |
| tires_monster | Monster Wheels | 145 | 120 | 0.91 | Off-road obstacles, increased ride height |
| tires_micro | Micro Wheels | 65 | 32 | 1.03 | Road speed +3%, obstacle penalty |
| tires_halftrack | Half Tracks | 155 | 150 | 0.83 | Dirt and mud traction +35% |
| tires_track | Full Tracks | 190 | 210 | 0.78 | Mud grip +55%, road max speed -20% |
| tires_magnetic | Magnetic Rollers | 165 | 108 | 0.91 | Metal surface grip +45%, draw 5/s |
| tires_adaptive | Adaptive Tires | 190 | 95 | 1.02 | Adapts 20% toward best terrain grip, draw 6/s |
| tires_blades | Razor Wheels | 145 | 85 | 0.93 | Contact-side damage, less wheel HP |

### 11.5 Weapons: 20 entries

Common conventions: `CD` is seconds between activations for manual weapons or between trigger opportunities for automatic weapons. `DMG` is nominal primary component damage before defenses. Persistent effects specify duration in seconds. Price and mass are per weapon module. `A` means automatic, `M` means manual, `H` means hybrid with an automatic target lock but manual confirmation. In the first release, no car may exceed six active offensive modules total, regardless of available mounts.

| ID | Display name | Cost | Mass kg | Mode | CD | Defining effect |
|:---|:---|---:|---:|:---:|---:|:---|
| weapon_front_mg | Front Machine Gun | 70 | 26 | M | 1.4 | Five-bullet burst, 3 DMG per bullet, 85-degree forward cone |
| weapon_rear_mg | Rear Sentry | 85 | 33 | A | 3.2 | Rear target detection, four-bullet burst, 3 DMG per bullet |
| weapon_turret | Swivel Turret | 130 | 68 | H | 3.0 | 18 DMG targeted burst, rotates at limited speed |
| weapon_shotgun | Road Shotgun | 90 | 40 | M | 4.0 | Eight short-range pellets, 3 DMG each, falloff |
| weapon_railshot | Needle Railgun | 165 | 78 | H | 7.0 | 27 DMG direct precision hit after visible charge |
| weapon_rocket | Straight Rocket | 100 | 55 | M | 5.0 | Straight projectile, 22 DMG plus modest splash |
| weapon_homing | Seeker Missile | 170 | 66 | H | 9.0 | Guided 20 DMG with visible lock warning |
| weapon_mine | Road Mine | 65 | 30 | M | 6.5 | Drops mine, 13 DMG and 1.2-second slow; six active cap |
| weapon_oil | Oil Slick | 60 | 31 | M | 7.0 | Rear strip creates 2.5-second grip loss |
| weapon_foam | Sticky Foam | 80 | 45 | M | 7.5 | Forward puddle reduces speed 20% for 2 seconds |
| weapon_emp | EMP Pulse | 145 | 75 | M | 13.0 | Nearby electronics disabled up to 1.5 seconds |
| weapon_tesla | Tesla Arc | 100 | 46 | A | 6.0 | Short-range electric arc, 12 DMG and brief module delay |
| weapon_flame | Flame Spitter | 115 | 58 | M | 5.0 | 2-second cone applies heat and 14 damage over time |
| weapon_frost | Frost Cannon | 110 | 55 | M | 6.0 | Cold projectile reduces grip 20% for 2.5 seconds |
| weapon_hammer | Crash Hammer | 105 | 90 | M | 5.0 | Very short-range 24 DMG and lateral impulse |
| weapon_saw | Side Saw | 90 | 60 | A | 3.0 | Close-contact side damage, 7 DMG per active burst |
| weapon_harpoon | Grapple Harpoon | 130 | 66 | M | 8.0 | Visible tether pulls lateral separation, no hard stun |
| weapon_air | Air Cannon | 85 | 46 | M | 6.0 | Cone knockback, little direct damage |
| weapon_boomerang | Steel Boomerang | 110 | 51 | M | 7.0 | Outbound and return projectile, 12 DMG per hit, one target hit each phase |
| weapon_mortar | Arc Mortar | 175 | 98 | H | 11.0 | Delayed reticle and area burst, up to 25 DMG center |

**Ammunition:** Default arcade rules use cooldown and energy/heat, not limited ammo, for machine guns and short-range tools. Missiles and mortar have limited charges to make loadout budget meaningful: straight rocket 5, seeker missile 3, railgun 5 charged shots, mortar 3; mine 6 deploys. These quantities reset every match and are not restored by a repair kit. The part card displays charges. Rechargeable weapons cannot fire if their power supply is exhausted and show a `LOW POWER` state. Define ammo and cooldown as server state per installed instance, not per SKU globally.

**Firing and targeting:** Directed guns fire relative to their physical mounted orientation; turrets and guided weapons may acquire within their own declared arcs. Unlocked weapons fire along the installed muzzle vector. Guided target acquisition requires the rival inside range and unobstructed visibility. Railgun range 350 world pixels; most guns 220; shotgun and hammer 110; EMP radius 135; mortar range 320. Normalize these values against camera scale during tuning. All damaging weapons have visible origin, traveling projectile or clearly defined energy arc, and an identifiable hit VFX.

### 11.6 Defenses: 20 entries

Passive unless otherwise noted. Defenses occupy attachment or armor sockets and may protect an angle; they do not magically shield the whole car unless their mechanic says global. `HP` is additional armor hit points at that arc. All values are seed balance values.

| ID | Display name | Cost | Mass kg | Defining behavior |
|:---|:---|---:|---:|:---|
| defense_light_plate | Light Plates | 45 | 45 | Adds 25 local armor HP, small mass cost |
| defense_heavy_plate | Heavy Plating | 110 | 145 | Adds 75 local armor HP, large mass cost |
| defense_front_bumper | Crash Bumper | 65 | 90 | Frontal ram damage taken -35% |
| defense_rear_bumper | Rear Guard | 55 | 75 | Rear collisions damage taken -30% |
| defense_side_panels | Side Shields | 70 | 95 | Side arcs gain 40 local armor HP |
| defense_wheel_cage | Wheel Cage | 90 | 83 | Wheel damage taken -45% |
| defense_engine_case | Engine Shell | 95 | 88 | Engine damage taken -40% |
| defense_ceramic | Ceramic Panels | 85 | 65 | Bullet damage taken -45%, ram damage +10% |
| defense_breakaway | Breakaway Armor | 70 | 61 | Cancels up to 35 damage once, then visibly fractures |
| defense_composite | Composite Shell | 130 | 115 | All ordinary direct hit damage -18% |
| defense_energy_shield | Energy Shield | 145 | 68 | One 25-point hit shield per 12 seconds, draws energy |
| defense_faraday | Faraday Cage | 95 | 73 | EMP duration -70%, electrical mass penalty |
| defense_heatguard | Heat Guard | 65 | 54 | Incoming heat status -55% |
| defense_antimissile | Missile Interceptor | 160 | 82 | Auto destroys one incoming guided missile every 14 seconds |
| defense_minesweeper | Mine Sweeper | 105 | 91 | Clears one close frontal trap every 8 seconds |
| defense_fireproof | Fireproof Lining | 75 | 64 | Burn damage over time -60% |
| defense_oilproof | Grip Coating | 65 | 48 | Oil slick grip penalty -70% |
| defense_damper | Shock Dampers | 90 | 92 | Impulse displacement -35%, ram damage -15% |
| defense_steer_assist | Steering Stabilizer | 80 | 49 | Steering damage penalty -60% |
| defense_reactive | Reactive Foam | 115 | 79 | First heavy hit every 16 seconds gets 40% reduction |

### 11.7 Utility systems: 20 entries

Utilities may be `manual`, `automatic`, or `passive`. A car may install one spare wheel and two repair kits, but cannot exceed a total of three consumable repair units. Utilities that modify physics have explicit costs and counterweights.

| ID | Display name | Cost | Mass kg | Trigger | Defining behavior |
|:---|:---|---:|---:|:---|:---|
| utility_spare | Spare Wheel | 40 | 37 | Manual | One wheel replacement, 1-second action |
| utility_repair | Repair Kit | 65 | 28 | Manual | Restores 40 integrity to a damaged module |
| utility_fan | Cooling Fan | 55 | 35 | Passive | Cooling +4 heat/s, draws 2 power/s |
| utility_radiator | Racing Radiator | 90 | 79 | Passive | Cooling +9 heat/s, drag +3% |
| utility_battery | Extra Battery | 65 | 48 | Passive | Battery capacity +65 energy |
| utility_generator | Auxiliary Generator | 80 | 82 | Passive | Power generation +12/s, heat +3/s |
| utility_capacitor | Burst Capacitor | 80 | 45 | Automatic | Stores 30 energy for powerful burst equipment |
| utility_nitro | Nitro Tank | 90 | 55 | Manual | Two 1.5-second acceleration bursts |
| utility_overdrive | Emergency Booster | 115 | 73 | Manual | 2-second torque boost, adds 28 heat |
| utility_traction | Traction Computer | 95 | 36 | Passive | Stabilizes slip, draws 4 power/s |
| utility_gyro | Gyro Stabilizer | 80 | 57 | Passive | Stability +16, draws 3 power/s |
| utility_radar | Radar | 45 | 28 | Passive | Longer rival tracking and early missile warning |
| utility_minesensor | Mine Detector | 55 | 27 | Automatic | Mine warning at +120 world pixels |
| utility_decoy | Decoy Drone | 85 | 44 | Manual | Two guided missile decoys per match |
| utility_jump | Jump Pad | 120 | 100 | Manual | One short hop over low obstacle, 9-second cooldown |
| utility_winch | Recovery Winch | 55 | 54 | Manual | Escape physical snag, 20-second cooldown |
| utility_ballast | Sliding Ballast | 95 | 90 | Automatic | Shifts center of mass toward safe cornering line |
| utility_spoiler | Active Wing | 100 | 68 | Automatic | More downforce at speed, draws 3 power/s |
| utility_targeting | Turret Computer | 75 | 30 | Passive | Turret aim acquisition speed +25%, draws 4 power/s |
| utility_solar | Solar Panel | 65 | 45 | Passive | +4 power/s in clear daylight, weak at night and in storms |

### 11.8 Shared mechanic primitives, parameters, and interaction order

Do not write 120 unrelated ad hoc algorithms. Implement standardized effect primitives with validated per-part parameters:

- `AddMass`, `ModifyTorqueCurve`, `ModifyDrag`, `ModifyGripBySurface`, `ModifySlipRecovery`, `ModifyHeatGeneration`, `ModifyCooling`, `ModifyEnergyGeneration`, `ModifyEnergyCapacity`, `ModifyPowerPriority`, `AddArmorArc`, `ModifyIntegrity`, `ModifyDamageByTag`, `ModifyImpulse`, `ModifySteeringResponse`, `ModifyVisualWear`, `AddHardpoint`, `OverrideAimingArc`.
- Active: `SpawnProjectile`, `SpawnMine`, `SpawnAreaHazard`, `ApplyDirectDamage`, `ApplyDamageOverTime`, `ApplyHeat`, `ApplyGripDebuff`, `ApplyEMP`, `ApplyImpulse`, `ApplyTether`, `GrantTemporaryShield`, `RepairComponent`, `ReplaceWheel`, `PulseTorque`, `ConsumeCharge`, `StartCooldown`, `AcquireTarget`, `InterceptProjectile`, `ShowTelegraph`.

Effect calculation order for every fixed simulation step:

1. Resolve accepted player and AI input and ability activation requests.
2. Update power generation, battery discharge, and consumer priorities.
3. Update heat production/cooling and throttle limiting.
4. Compute all current vehicle physical coefficients from chassis, tires, mass, damage, effects and environment.
5. Integrate vehicle velocities, steering, and positions.
6. Resolve wall and vehicle collisions, then damage and rebound impulses.
7. Integrate projectiles and active hazards with swept hit tests.
8. Resolve weapon hits, armor, subsystem effects, repairs, and expiring statuses.
9. Update checkpoint progress, finishes, KO conditions, and match timer.
10. Emit time-stamped authoritative events and state patches to clients.

Status effects from the same family apply strongest magnitude and maximum remaining duration. Different families have a combined impairment cap as defined in Section 8.1. Invulnerability after major control impairment does not block ordinary damage, only another disabling input disruption. Set exact low-level constants in `packages/shared/src/balance.ts`, documented and covered by tests.

### 11.9 Example legal builds for tests and onboarding

These are loadout patterns, not required purchases of every listed part. Automated tests should construct valid variants under the 1,000-credit limit and adjust accessory mounts according to chassis definitions.

- **Straight-Line Rocket:** Arrow, V8, Slicks, Nitro, Cooling Fan, Front Machine Gun. Goal: fast on dry asphalt, weak in rain and close turns.
- **Sticky Turtle:** Turtle, Four-Cylinder, Armored Tires, Oil Slick, Side Shields, Repair Kit. Goal: high survival, low acceleration.
- **Dust Spider:** Spider, Trail Engine, Sand Paddles, Air Cannon, Gyro. Goal: stable desert cornering and push attacks.
- **Rain Runner:** Beetle, Sport Electric, Rain Runners, Rear Sentry, Energy Shield. Goal: wet-city sprint, electrical supply tradeoff.
- **Back-Alley Trap:** Scorpion, Hybrid, Street Tires, Mine, Rear Sentry, Mine Detector. Goal: control behind the car and counters to other traps.
- **Tiny Trouble:** Trike, Rotary, Micro Wheels, Shotgun, Cooling Fan. Goal: outrageous acceleration and fragile turning.

All named templates must have server-valid instantiations in the shipped content and visually distinctive thumbnails.


## 12. Art Direction: Spectacular 8-Bit Racing

**This section is a production requirement, not aesthetic inspiration.** The final game must look like an expertly art-directed modern pixel game inspired by the best expressive arcade pixel art, not a flat mockup, colored rectangles, randomly scattered blocks, or a generic retro filter. It must read beautifully at speed on a phone. Visual identity is a core product feature equal in importance to the builder.

### 12.1 Visual pillars

1. **Readable at 140 MPH:** Vehicle silhouette, front/back orientation, track edge, weapon hazards, and rival position remain obvious at a glance.
2. **Miniature mechanical craftsmanship:** Cars look like lovingly detailed physical toys with real modules mounted to a chassis, not a single repeated body sprite with different colored rectangles.
3. **Dense worlds with disciplined contrast:** The city looks lived in, the desert feels hot and vast, and the forest feels wet and deep, but the road remains the visual stage.
4. **Every event has an expressive animation:** Steering produces body lean and tire behavior, weapons have anticipation and recoil, explosions throw layered pixel fragments, rain hits the road, and disabled parts visibly misbehave.
5. **Crisp pixels, modern motion:** Deliberate pixel shapes and limited palette discipline coexist with buttery camera motion, layered particles, lighting, distortion, and dynamic shadows.
6. **Spectacle without blindness:** Dramatic animations are a reward for a hit, not a full-screen obstruction that makes the player lose control.

### 12.2 Specific reference principles and prohibited looks

Use a true top-down orthographic camera, with a slightly stylized raised silhouette only within car sprite artwork. Do not use a fake perspective horizon, isometric world, 3D low-poly cars, photorealistic textures, soft-edged vector blobs, ubiquitous gradients, or photographs with pixelation applied afterward. Background architecture should have intentional pixel clusters, corner lighting, masonry details, painted markings, and coherent depth hierarchy. Pure 8-bit historical color limits are **not** mandatory: adopt a sophisticated modern pixel-art palette. The desired look is convincingly 8-bit in spirit but far richer than old hardware could render.

No unlicensed imitation of Mario Kart, famous race cars, existing character franchises, or commercial game UI. The shared genre elements are arcade racing, pick-up-free combat equipment, and modular construction. Create an original silhouette language, brands, landmarks, sound motifs, and typography.

### 12.3 Color system

Core interface palette, suggested hex values:

| Role | Color | Hex |
|:---|:---|:---|
| Night navy | Deep UI backgrounds | `#151C2C` |
| Steel navy | Structural panels | `#28344A` |
| Warm ivory | Primary text | `#F5EED9` |
| Electric cyan | Local driver accent | `#46D5E6` |
| Turbo coral | Rival and danger emphasis | `#F46B58` |
| Racing gold | Credits and speed highlights | `#F6C35B` |
| Mint green | Valid installation and repair | `#67DEA7` |
| Warning amber | Heat and system alert | `#FFB454` |
| Deep red | Critical damage only | `#D83F49` |
| Night purple | Neon ambient shadow | `#6D59A2` |

Each biome receives an authored palette of approximately 24 to 40 core hues, including atmosphere and VFX accents. A car can use customizable accent colors, but weapon telegraphs and danger indicators preserve their functional semantics. Do not map left/right team identity by color alone; also show icons, outline style, and clear labels. Color-blind modes must preserve legibility.

### 12.4 Rendering and layering specification

Render the world at 640 x 360 logical pixels, enlarge with nearest-neighbor filtering, and prefer integer-scale crispness. Use 16 x 16 micro-tiles grouped into 32 x 32 road and terrain motifs. Pixel outlines generally one to two logical pixels. The finest wheel tread and armor scratches should still be distinct at native logical resolution. Cars use authored 64 x 96 spritesheet cells including transparent margins. Visible physical Beetle body is roughly 34 x 58 world pixels; larger bodies reach roughly 55 x 78 world pixels. Weapons range 8 to 24 logical pixels in body footprint. Camera zoom may reduce a car slightly but should preserve recognizable silhouettes.

Depth layers in strict order:

1. Farground terrain and static base tiles.
2. Under-road details: drainage, cracks, skid marks, painted arrows.
3. Road surface and curb variants.
4. World decals and accumulated tire marks.
5. Low obstacles, roadside props and item trails.
6. Dynamic wheel shadows, body shadows and ambient ground glow.
7. Cars, chassis, wheel assemblies, attached modules, projectiles.
8. Foreground impacts, sparks, dust and localized flame.
9. Foreground trees, canopies, bridges and signs with player-safe occlusion logic.
10. Optional low-intensity screen-space color grade and UI-independent weather overlays.
11. Native-resolution UI, touch affordances, and urgent warnings.

Pixel textures use nearest filtering and no mipmap blur at normal scale. If a shader effect is used, quantize its output to pixel blocks or apply it below the crisp car/UI layers. Glow may bloom outside sprite pixels, but not smear internal sprite details. Avoid excessive global bloom. No full-frame artificial scanline layer that reduces readability.

### 12.5 Pixel density and camera motion

Car and world translation may be subpixel in physics but positions snap only at final pixel-art render where beneficial; interpolate authoritative state before render. Turn interpolation for vehicles must not introduce shimmering or shape deformation. Generate discrete 16-direction pixel artwork for each chassis and for visibly oriented mounted parts, with authored transition rules. Camera may rotate smoothly, but if rotated terrain creates unacceptable shimmer, quantize camera heading to small smooth steps or prefer a stable north-up alternative. Verify visually on real devices. Minimize rapid zooming, rotations, and frame-wide shaking.

### 12.6 Car design language and silhouette families

A car is a composited character, not a static texture. The base chassis layer includes: perimeter body, bonnet/hood, cockpit roof, side panels, fenders, exhaust points, suspension hints, and mount shadows. Additional render layers: individual tires, brake lights, headlights, armor modules, engine air intakes, rear pipes, roof modules, turret barrels, special utilities, damaged overlays, reflections, and local emissions. At least eight distinct visual cues must separate a heavily modified car from its bare chassis.

Silhouette descriptions for all 20 chassis:

| Car | Shape notes |
|:---|:---|
| Beetle | Rounded hood, twin fenders, compact cabin, playful roofline |
| Needle | Long tapered nose, narrow body, tiny side pods |
| Turtle | Squat hexagonal armored shell, compact buried wheels |
| Spider | Six visible wheels, segmented suspension arms, angular central cab |
| Crab | Wide side outriggers, claw-like perimeter mounts |
| Cobra | Long nose, hood spine, aggressive forward vents |
| Scorpion | Tapered front, dramatic lifted rear equipment boom |
| Buggy | Open roll cage, high suspension, exposed thick tires |
| Chameleon | Modular asymmetrical panels and universal attachment rails |
| Brick | Heavy rectilinear slab with riveted metal doors |
| Trike | Tiny triangular three-wheel arrangement, exposed central frame |
| Arrow | Narrow aerodynamic wedge, rear fins, hidden suspension |
| Wagon | Elongated cab with stacked rear racks and roof rails |
| Rammer | Battering-ram front bumper, broad shoulders, reinforced seams |
| Drifter | Low roof, flared rear wheel arches, offset exhaust |
| Kangaroo | Tall sprung wheel mounts, skid plate, lifted cab |
| Horseshoe | U-shaped front structure, open central weapon cavity |
| Pickup | Open rear utility bed with visible installed cargo |
| Twins | Two side pods connected by a narrow central bridge |
| Platform | Exposed square truss with visibly mounted parts and wires |

Cars should look great both untouched and mechanically ridiculous. The absurdity comes from believable assembly, overhangs, off-center turrets, huge wheels, a tiny car with a massive front gun, and animated mechanical details. Never make modules float disconnected from attachment points. Create appropriate connector sprites, supports, screws, cables, and directional sockets at no gameplay cost. Their visual presence helps players understand the physical engineering system.

### 12.7 Sprite production requirements

For each of 20 chassis, produce:

- 16 coherent directional body frames, with consistent top-down lighting and outlines.
- Four build-state layers: bare, scratched, damaged, and critical. Damage may be a composited mask rather than 64 separate base frames, but must align to each angle.
- Independent wheel anchor transforms supporting 3, 4, and 6 wheels as applicable.
- Headlight, brake-light, exhaust, shadow, and animation anchor coordinates.
- Preview pose for garage, VS portrait view, and card thumbnail generated from the same canonical parts, not separate inconsistent illustrations.

For each engine, tire set, weapon, defense, and utility, produce an attachment icon and in-car visual representation. A modular engine may not be fully exposed on every closed chassis, but its intake, exhaust, rear module, or cover must visibly differ. Distinct tire tread styles need readable side shapes on all chassis. Larger mounted modules require 16-direction transformation sprites if their asymmetric shape makes rotation artifacts obvious. Each item requires high contrast icon silhouettes at 24 x 24, 32 x 32, and a composite vehicle-view sprite. Design front and back correctly; players must be able to recognize car heading even during an explosion.

**Pixel production process:** First produce a silhouette atlas, then internal shading and surface detailing, then damage variants and attachment anchors. Save authored source PNGs and machine-readable anchor manifests. If graphics are algorithmically drawn, define palettes, polygon pixels, outlined clusters, motif templates, modular decals, and seeded variation rather than relying on per-frame random noise. Seeded drawing must produce identical sprites across sessions and browsers. No CSS filters that make the body fuzzy. A procedural car generator can be the base artwork, but every generated chassis needs human review at game size and at 4x zoom.

### 12.8 Car animation state machine

Every vehicle has these states and events, independent of its engine or weapon loadout:

| State | Animation | Timing / trigger |
|:---|:---|:---|
| Idle | Subtle 1 to 2-pixel engine vibration, occasional exhaust puff | Continuous while near stationary |
| Launch | Rear suspension compression, front lift by 1 pixel, wheel blur | 0 to 60 MPH transition |
| Cruise | Rotating tires and very subtle shadow drift | Continuous above 10 MPH |
| Hard steer | Body roll 1 to 2 pixels, front tires yaw, slight headlight sweep | Steer magnitude above 0.55 |
| Drift | Opposite rear wheel slip, skid trail, dust or vapor | Lateral slip above threshold |
| Brake | Red taillight burst, short tire streak, suspension squat | Brake input above 0.45 |
| Nitro | Bright exhaust flames and short blue speed streaks | Utility activated |
| Weapon fire | Mounted part recoil, muzzle flash, casing ejection | Exact accepted fire event |
| Light hit | Impact spark, local one-frame recoil, scratch decal | On collision or light projectile hit |
| Heavy hit | Layered shake, armor flecks, wheel bounce | On heavy hit event |
| Overheat | Flickering hot exhaust, pixel heat distortion, steam | Heat above threshold |
| Wheel damaged | Unsteady wheel rotation, occasional rubber scraps | Damaged wheel present |
| Engine damaged | Dark smoke trail that remains low opacity | Engine integrity below 65 |
| Shield active | Segmented translucent outline that follows car | Defense active |
| Repair | Quick mechanical clank, green pixel weld sparks, replaced part snaps in | Repair success |
| KO | Controlled stop, small final sparks, falling parts, no gore | Rare true KO |
| Finish | Banner sparkle, brake flare, small victory hop | Results transition |

All animations must function for arbitrary vehicle assemblies. A weapon mounted on the left fires and recoils left; one mounted backward recoils backward. Wheel damage affects the correct anchor and skid trajectory. This is a critical QA gate.

### 12.9 Vehicle lighting and depth

Use a consistent warm upper-left key light and a cool ground bounce, varied by biome time of day. Every car casts a soft but still pixel-edged ground shadow; shadows stretch slightly with tall chassis and elevated parts. Underbody ambient occlusion darkens contact points. Headlights create short quantized cones at night, brake lights reflect on wet roads, and bright muzzle flashes illuminate nearby armor for 60 to 120 milliseconds. Armor panels have highlighted rivets and edge chips. The goal is tactile richness, not 3D realism.

### 12.10 Environment production details

**City:** Painted traffic arrows, flickering shop signs, distinct apartment rooftop silhouettes, storm drains, utility boxes, corner cafe awnings, wet reflective zebra crossings, glowing traffic lights, parked pixel cars outside collision lanes, wall graffiti, tram tracks and manhole covers. Vehicles pass animated billboards and signs without the road becoming unreadable.

**Desert:** Warm terracotta mesas, pale sand dunes, parallax rock ledges, cracked tarmac, dry shrubs, dust funnels, distant heat haze, bleached road signs, tumbleweed, creaking industrial towers, and sunlit rock debris. Trails change from light gray tire smoke to tan dust as the car leaves the pavement.

**Forest:** Multiple green depth planes, layered canopies with gentle motion, hanging branches, ferns, glowing mushrooms in shady corners, wet stones, wooden bridges, animated insects, shallow puddles, muddy shoulder ruts, and leaf bursts. Canopies between the camera and local car fade rather than hide it.

**Snow:** Blue-violet snow banks, pale frozen lakes, drifting granular snowfall, breath-like tailpipe steam, broken roadside ice, high-contrast dark tarmac plow lanes and shimmering pixel ice. Tire grooves persist briefly in packed snow. No excessive all-white glare.

**Industrial:** Riveted plate floors, hazard-stripe paint, conveyor machinery, animated pistons, distant smelter flames, wet metal glints, steel rails, dangling hooks and warning lamps. Magnetic surfaces are visually marked, and moving props telegraph collision zones.

Every track needs at least 30 authored environmental props or tile variants, four distinguishing landmarks, three ambient looping animations, two unique obstacle or surface behaviors, and at least one shortcut. Reuse the underlying biome kit efficiently without making both tracks identical.

## 13. VFX and Animation Bible

**This is a mandatory high-priority subsystem.** The game must feel unusually alive for a top-down 8-bit racer. Every action must communicate anticipation, contact, and aftermath. Effects should be authored frame sequences or pixel-perfect procedural elements, not translucent colored circles in place of explosions.

### 13.1 Temporal animation rules

- Gameplay simulation fixed at 30 Hz, visible animation target 60 FPS; interpolation ensures smooth movement.
- Authored pixel sprite loops typically use 8 to 16 animation frames at 10 to 20 art frames per second, independent from camera update frequency.
- Important impact anticipation 80 to 160 ms, contact peak 60 to 120 ms, recoil and debris 150 to 350 ms, smoke or environmental aftermath 0.5 to 1.5 seconds.
- Every large attack needs an identifiable warning or wind-up, a distinct emission, a visible moving object or active beam, a visually striking contact, and a fading aftermath.
- Randomized particle placement uses seeded cosmetic randomness, never random gameplay damage. Rotation and scaling should stay quantized to readable pixel increments when possible.
- Avoid identical explosions repeated at identical positions. Maintain a small library of authored variants selected by deterministic event seed.

### 13.2 Core particle types

Create pooled pixel particles with authored animations and specific blend rules:

1. Hot sparks: 1 to 3-pixel yellow-white streaks, 80 to 250 ms, gravitational fall and bounce.
2. Metal shards: 2 to 6-pixel rigid shapes, 220 to 600 ms, tumble in stepped rotations.
3. Black smoke: layered 4 to 12-pixel clusters, rise and dissolve, max 1.5 seconds.
4. White steam: cool semiopaque pixel wisps, 0.4 to 1.0 second.
5. Orange ember: small slow particles, 0.3 to 1.1 seconds.
6. Dust puffs: large textured tan clusters, 0.2 to 0.7 seconds, ground hugging.
7. Tire debris: dark rubber flecks, 0.2 to 0.5 seconds.
8. Electrical arcs: zigzag animated pixel segments, 2 to 5 frames, 0.08 to 0.35 seconds.
9. Pixel snow and rain: atmospheric effects behind and in front of cars with low opacity and independent layer speed.
10. Water spray: cyan-gray fans that disperse with wheel velocity, 0.1 to 0.5 seconds.
11. Oil spatter: opaque patterned drops that remain as track hazard decals.
12. Bubble shield fragments: 3 to 8-cell translucent angular segments, 0.1 to 0.4 seconds.
13. Ice fragments: sharp cyan-white diamonds, 0.2 to 0.6 seconds.
14. Grass and leaves: surface-dependent flicks, 0.3 to 0.8 seconds.
15. Road grit: curb pebbles and abrasion pixels, 0.1 to 0.45 seconds.
16. Energy glyphs: short geometric rings and tiny circuit blocks, 0.15 to 0.5 seconds.

Particle emitters are object pooled, capped, culled outside the viewport, and scaled by device quality. Avoid per-particle allocations during active racing. Explosions should combine four to seven contrasting particle families, not only enlarge one emitter.

### 13.3 Explosion animation construction

**Small kinetic impact**, 0.35 second: a two-frame white/yellow impact star; bright orange core; eight directional sparks; two to four bouncing metal pixels; tight smoke that clears within 0.5 second. Camera impulse 1 pixel max.

**Rocket explosion**, 0.8 second: 80-ms approach smoke, 50-ms yellow-white central flash, asymmetric orange pixel fireball with expanding jagged edge, 12 to 18 dark shrapnel sprites, outer segmented shockwave, gray-black smoke blossoms, fragments rolling off the road. Affected car receives localized recoil, not a scene-wide freeze. Allow only a subtle 2-pixel camera impulse. Brighter on wet night asphalt with quantized short reflection.

**Heavy mortar explosion**, 1.1 seconds: 0.6-second visible warning reticle beforehand, central column of hot white pixels, nested red-orange shock rings with broken sectors, broad ground dust disc, multiple debris arcs, then two-stage smoke columns. Keep center of the road and rival silhouettes visible by briefly outlining vehicles through the effect. In reduced-effects mode replace the flash with a colored outline and half the particles.

**EMP burst**, 0.5 second: staggered concentric cyan and violet pixel outlines, square circuit fragments, jump arcs to affected mounts, short distortion pulse limited to a local radius. No fake big fireball for an electric attack.

**Repair burst**, 0.5 second: a tiny mechanical clamp animation or replacement sprite snap, mint welding sparks, a single readable green subsystem icon pulse. Does not resemble a healing spell.

### 13.4 Weapon-by-weapon VFX and audio identity

All twenty entries must have unique muzzle, projectile, hit, and audio signatures. A shared effect system is fine, but the combinations must be distinguishable at racing speed.

| Weapon | Anticipation and emission | Impact and aftermath |
|:---|:---|:---|
| Front Machine Gun | Five alternating orange muzzle pixels, hot cartridge flecks, rapid dry staccato | Tiny steel sparks, brief bullet chips on armor |
| Rear Sentry | Mechanical pivot, rear amber tracking pixel, shorter repeated burst | Crisp backward hit flecks, trailing casing shower |
| Swivel Turret | Visible gun rotation with short red aim tick, two-pixel barrel kick | Compact orange blast and circular metal chips |
| Road Shotgun | Huge 2-frame muzzle flash, wide pellet spread with short trails | Several separate small impacts in a fan |
| Needle Railgun | Bright linear barrel charge climbing through six stages, sharp cyan shot | Needle-thin impact slash and concentric square pulse |
| Straight Rocket | Flame tail flickers independently of rocket movement, intermittent smoke | Four-layer fiery burst, shrapnel, dark smoke |
| Seeker Missile | Two-beep lock cue, small red target brackets, swerving pixel exhaust | Focused rocket bloom with tracking warning ending on impact |
| Road Mine | Rear hatch pop, mine drops and blinks amber, clear hazard outline | Low explosive thump, pavement dust and bright axle-height flash |
| Oil Slick | Sloshing black-blue rear spill, glossy angular puddle grows along road | Tire splash, gray sideways skid streaks, no fireball |
| Sticky Foam | Thick pale pellets spray in an arc and stick in clumps | Rapid foam spread, elastic splatter, peeling fragments |
| EMP Pulse | Battery charges four diagonal segments, low synthesized whine | Violet-cyan ring and local short electrical flicker |
| Tesla Arc | Snaking pixel lightning snaps between physical contact points | Bright irregular fork, tiny violet sparks on affected component |
| Flame Spitter | Nozzle glows red, spits staccato orange jets and dark flecks | Surface flame licking along a car panel, heat shimmer, embers |
| Frost Cannon | Barrel frosts over, launches faceted icy ball | Cyan crystalline shatter, brief pixel frost over wheel arcs |
| Crash Hammer | Arm draws back visibly, mechanical spring compression | Oversized metal clang spark, direct side knock and shock stripe |
| Side Saw | Teeth loop in visible stepped frames, shower of sparks on contact | Metallic scraping flecks and scratch decals with no blood |
| Grapple Harpoon | Cable spool spins, triangular dart fires along a pixel rope | Hook catches a legal point, tension line bows and retracts |
| Air Cannon | Aperture opens with strong directional fan of pale pixels | Distorted dust pressure wave and affected suspension bounce |
| Steel Boomerang | Three-frame spinning hooked silhouette and bright outer edge | Glancing steel slash, returning ring with staggered ricochet ticks |
| Arc Mortar | Barrel elevates, segmented ground target reticle counts down | Tall blast core, shockwave, broad low dust cloud and debris |

### 13.5 Weather and environmental animation

**Rain:** Three depth planes of short slanted pixel rain, gentle raindrops bouncing on asphalt, visible tire spray on standing water, traffic light reflections broken into short blocky streaks. The wet surface uses low-resolution reflection sprites from nearby signs, not a blurred screen mirror. Show water droplets on roads without spraying over HUD.

**Sandstorm:** Foreground tan dust ribbons that move with wind, occasional rock-chip skitters, flags that lean consistently, softer horizon tone, drifting sand gradients quantized into discrete clusters. Player/rival outlines remain readable.

**Forest rain:** Dark wet road, leaf shake, puddle splashes, pale mist along the roadside, light shafts through trees, animated bridge runoff. Ambient particles are sparse where the steering line matters.

**Snow and ice:** Stepped crystalline snowflakes at layered depths, tire grooves in snow, hard-edged icy sheen on frozen segments, small blue-white chips from wheel contact, and controlled drifting snow from wind. Ice remains identifiable under all UI palettes.

**Industrial metal:** Moving pistons, conveyor lights, welding spark flickers, marked magnetic lanes with segmented blue geometry, and occasional steam vent silhouettes. Environmental animations must not conceal warning telegraphs.

**Heat:** Localized two-pixel column oscillation above turbo exhaust and hot pavement, distant atmospheric flicker only. No full-scene blur or nauseating warping.

**Night city:** Pulsing neon windows, animated billboards with original logos, passing spotlight bands, reflective wet curbs, road lamps whose yellow light falls on the car as it moves through. The scene should feel cinematic while retaining readable racing edges.

### 13.6 Satisfying hit feedback sequence

A confirmed heavy hit follows this event choreography:

- Frame 0: contact location emits one bright pixel star and a distinctive sound transient.
- Within 50 ms: impacted armor or module flashes along its edges, projectile disappears or deforms.
- Within 100 ms: target car receives small believable recoil, associated wheel/body animation reacts, 6 to 20 particles emit.
- Within 200 ms: damage marks and status icon update; if important, show `WHEEL HIT` or `ENGINE HIT` in a compact callout.
- Within 500 ms: particles clear, smoke tail or damaged module state persists, gameplay remains fully controllable.

Network correction must not replay the same effect twice. Events have unique IDs; clients deduplicate them. Predicted muzzle flashes may be reconciled silently if fired correctly, but major explosions display only on confirmed collision event.

### 13.7 Camera juice with restraint

Camera follows with eased spring, slight forward lead, extra anticipation before sharp bends, and tiny impact impulses. Standard heavy hit shake max 2 world pixels for 90 ms, exceptional explosion max 3 pixels for 120 ms. Never exceed 5 pixels, never shake HUD, and suppress overlapping camera impulses using a budget. Disable shake fully with a setting. A close finish can use a 0.3-second finish-line slow-motion **presentation only** after the server has confirmed the result. Do not slow the live authoritative match simulation for both players because one screen triggered a cinematic.

### 13.8 Animation deliverables and quality gates

Required clips: body idle, launch, brake, drift, wheels rolling, 20 weapon fire clips, 20 weapon impact clips, four explosion scales or styles, six armor/shield reactions, six damage subsystem states, repair, rain spray, sand dust, forest splash, finish line, victory, defeat, and VS introduction. Provide animation keys in a manifest with frame sequence, playback FPS, anchor location, layer priority, looping flag, and fallback sprites. Sprite atlas names must be stable, validated at build time, and free from case sensitivity errors.

Art QA gates:

- At device scale, a tester can distinguish all 20 chassis by silhouette without reading names.
- Installing or removing a turret, side plate, big tire kit, roof radar, or rear oil dispenser visibly changes the actual vehicle silhouette.
- Both player cars remain distinguishable in rain and during simultaneous rocket impacts.
- A heavy rocket explosion has at least four clearly distinct layers: flash, expanding fire, fragments, smoke.
- Every weapon in the catalog has a distinct recognizable effect or pattern.
- Rain, dust, skid marks, sparks, and smoke are visible but do not overwhelm the track.
- No ugly stretching, sprite-sheet bleed, high-frequency flicker, unreadable outline, or blurry antialiasing.
- Camera motion remains comfortable during a three-minute session.
- Performance stays within target budgets in stress tests with two highly armed six-wheel cars and maximum weather effects.

## 14. Asset Production, Animation Pipeline, and Sound

### 14.1 Source assets and packaging

Store original editable sources under `art/source` and exported sprite atlases under `apps/web/public/assets/atlases`. Use consistent atlas categories `cars`, `parts`, `weapons`, `environment_city`, `environment_desert`, `environment_forest`, `vfx_core`, and `ui`. Generate a JSON manifest containing frame positions, pivots, hitbox hints, mount anchors, animations, and palette family. Use texture packing with 2-pixel padding to prevent tile bleeding. Reuse atlases rather than uploading dozens of images independently during a race.

A single compositing function must construct the visual representation of any valid blueprint from chassis, wheel anchors, equipment transforms, cosmetic palette, and damage overlays. Use it in garage preview, VS sequence, live race, results podium, saved-card thumbnail, and optional sharing image. Render a deterministic cached thumbnail on the client or server only from valid canonical blueprint data. Do not create separate inconsistent mock sprites for the same car.

### 14.2 Minimum animation source quality

- Car artwork silhouette cell 64 x 96; body proportions consistent per chassis.
- Vehicle direction atlas 16 headings as default for display, authored or deterministically generated.
- Wheel sprites 8 x 12 up to 18 x 28 depending on kit; 3 to 6 rotation states when readable.
- Weapon animations 6 to 14 relevant frames and separate projectile sprites with directional variants.
- Explosion atlases typically 12 to 20 frames with multiple authored shape variants.
- Tire trail decals generated from at least six track material textures and two slip severities.
- UI component icons at least 24 x 24 and 32 x 32 in a consistent graphic vocabulary.
- Environmental loop animations for neon, lighting, flags, water, smoke, leaves, machinery, and shifting shadows.

Art must be manually curated or produced via a high-quality deterministic pixel-drawing pipeline. Code generation can accelerate production, but a repeated oval body with randomly recolored squares is not acceptable final vehicle art. Create at least three polished benchmark cars before mass-producing the rest. Validate the entire visual pipeline using an assembled, heavily modified Spider, Arrow, and Turtle on both wet city and dusty desert maps.

### 14.3 Sound direction

The music blends energetic original chiptune melodies, crunchy digital percussion, and modern punchy low end without sounding like stock loop spam. Track-specific themes have 100 to 145 BPM and short adaptive layers for normal race, last 30 seconds, and finishing moments. UI sounds are memorable but not shrill. Every engine family needs a recognizable pitch and timbre envelope tied to normalized RPM; heavy V8 roars low, electric motors whine, turbines spool, spring drives click, rocket engines pulse. Spatialize enemy weapon sound modestly from the left or right without obscuring gameplay cues.

A sound event priority system ducks music briefly around huge impacts, highlights incoming guided missile warnings, and prevents a burst of machine-gun hits from stacking into a painful wall of noise. Limiting and compression protect volume. Separate user volume channels for music, engine, effects, and interface. Audio is initialized or resumed on a user gesture to comply with browser policies. Provide silent play with equivalent visual warning cues.

### 14.4 Haptic and future native bridge

Use `navigator.vibrate` only when supported and explicitly enabled; never assume availability on iOS Safari. A native app wrapper may later map hit and firing events to platform haptics. The game must not rely on vibration for conveying necessary gameplay information.


## 15. Technical Stack and Architecture

### 15.1 Chosen stack

This is the default implementation stack. Do not swap frameworks merely because a package is newer or more fashionable. If an incompatibility is discovered, document it and choose the narrowest stable fix.

| Layer | Required choice | Reason |
|:---|:---|:---|
| Language | TypeScript with strict type checking | Shared data contracts and safer content authoring |
| Web game renderer | Phaser 3.90, WebGL first, Canvas fallback if functional | Mature 2D scenes, cameras, atlases, particles, pixel-art rendering |
| Menu and builder UI | React with TypeScript | Accessible responsive layout and data-rich garage |
| Bundler | Vite with pinned lockfile | Fast local iteration and static production output |
| State management | Lightweight app store such as Zustand | Clear separation of interface, room state, and game simulation |
| Real-time rooms | Colyseus 0.16 family, pinned compatible packages | Rooms, state synchronization, lobby and reconnect transport |
| HTTP API | Express hosted alongside the game backend | Blueprint, health, settings-independent endpoints |
| Backend runtime | Current supported Node.js LTS | Self-hostable authoritative simulation |
| Persistence | PostgreSQL | Durable blueprint codes and sanitized analytics |
| Schema validation | Zod at HTTP and socket boundaries | Prevent invalid or forged inputs |
| Testing | Vitest, Playwright, Colyseus testing tools | Unit, protocol, UI, mobile viewport and integration tests |
| Deployment | Docker Compose, Caddy reverse proxy, HTTPS/WSS | Reproducible self-hosted launch |
| CI | GitHub Actions or equivalent | Build, lint, typecheck and tests |

Phaser's documented pixel-art mode disables interpolation and uses integer-pixel rendering; enable it, then separately test camera following because camera methods can alter rounding settings. The server physics must **not** depend on Phaser or a browser canvas. Colyseus' synchronized schema holds match snapshots, while reliable room events convey hit, weapon, countdown and lifecycle events. Pin the compatible Colyseus 0.16 release family in package files and use version-specific docs, avoiding examples from incompatible later releases. If the implementation is intentionally upgraded to a future stable major release, upgrade the complete family together and run the multiplayer test suite.

### 15.2 Monorepo layout

```text
bolt-rivals/
  CLAUDE.md
  README.md
  package.json
  pnpm-workspace.yaml
  pnpm-lock.yaml
  docker-compose.yml
  .env.example
  docs/
    MASTER_SPEC.md
    DECISIONS.md
    ART_GUIDE.md
    BALANCE_CHANGELOG.md
    TEST_PLAN.md
    RELEASE_CHECKLIST.md
  apps/
    web/
      src/
        main.tsx
        app/
        pages/
        components/
        garage/
        hud/
        input/
        game/
          scenes/
          rendering/
          cameras/
          composition/
          particles/
          audio/
        network/
        accessibility/
      public/
        assets/
          atlases/
          maps/
          audio/
          fonts/
    server/
      src/
        main.ts
        rooms/
        simulation/
        ai/
        matchmaking/
        blueprints/
        routes/
        telemetry/
        persistence/
        security/
  packages/
    shared/
      src/
        protocol.ts
        physics.ts
        balance.ts
        damage.ts
        math.ts
        types.ts
    content/
      src/
        parts.ts
        chassis.ts
        tracks.ts
        weather.ts
        templates.ts
        animations.ts
        strings.ts
  art/
    source/
    scripts/
    manifests/
  tests/
    unit/
    integration/
    e2e/
    load/
    visual/
```

`CLAUDE.md` should tell any subsequent coding agent: read `docs/MASTER_SPEC.md`, respect original design invariants, use strict TypeScript, run all quality checks, do not invent missing features silently, and never call a static prototype a completed game. `docs/MASTER_SPEC.md` is a verbatim copy of this file, not an independent drifting design document.

### 15.3 Core architecture boundaries

`packages/content` defines catalog, tracks and animation metadata. `packages/shared` defines pure deterministic math, immutable or serializable physics state, command types, and validators. `apps/server` owns time, authoritative physics, damage, checkpoint progress, AI, inventory validation and match results. `apps/web` owns user input, low-latency local prediction, interpolation, display, compositing, and audiovisual feedback. A UI cannot directly alter authoritative ammo, credits, or chassis integrity.

A room is an isolated match process or logical actor. Only one server loop changes its authoritative state. The server uses fixed time steps, a monotonic clock, bounded delta accumulation, and stable deterministic event ordering. For collisions of two cars in the same tick, sort by entity ID before resolution to prevent nondeterministic tie outcomes. Seed environmental and AI gameplay randomness with the saved match seed. Cosmetic randomness may vary by client.

### 15.4 Network tick rates and reconciliation

- Server physics: fixed 30 Hz.
- Client display: request 60 FPS and interpolate between simulation samples.
- Human input packets: 20 Hz while active, plus immediate state-change events for firing and repair, with sequence number, client tick and clamped normalized control values.
- State delivery: approximately 15 Hz differential snapshots, with reliable key events when needed.
- Remote car interpolation: use a 100 to 150 ms render buffer with bounded extrapolation for brief packet loss.
- Local car: run the same pure physics function in prediction mode and reconcile smoothly to server state. Camera should not violently jump for small corrections. Teleport correction only after extreme desync, with a clear reconnect state.
- Input validation: sequence monotonicity, bounded time deltas, valid phase, legal abilities, timing and rate limits. Never accept client-reported position, collision, hit success, health, or finish.

Target under 120 ms round-trip network latency for strong experience and remain playable around 200 ms. If latency is consistently excessive, show a connection quality indicator rather than pretending the game is perfectly synchronous. Heavy collisions and missile hits are particularly sensitive, so display confirmed effects rather than double-predicting them. Test high packet jitter and 5 percent loss before public release.

### 15.5 Authoritative entity structure

```ts
type VehicleState = {
  id: string;
  blueprintHash: string;
  x: number;
  y: number;
  headingRad: number;
  velocityX: number;
  velocityY: number;
  yawRate: number;
  massKg: number;
  chassisIntegrity: number;
  coreHeat: number;
  batteryEnergy: number;
  steeringInput: number;
  brakeInput: number;
  throttleFraction: number;
  wheelIntegrity: number[];
  componentStates: ComponentRuntimeState[];
  statusEffects: ActiveStatus[];
  weaponInstances: WeaponRuntimeState[];
  checkpointIndex: number;
  lap: number;
  courseProgress: number;
  finishedAtMs?: number;
};

type PlayerInput = {
  sequence: number;
  clientTick: number;
  steer: number;       // inclusive range -1 to 1
  brake: number;       // inclusive range 0 to 1
  fireSlot?: 0 | 1;
  activateUtility?: string;
  selectRepairTarget?: string;
};
```

Do not store every particle, environmental sparkle, or music beat in network state. Network only needs gameplay entities, timed events, and authoritative match facts. Clients create their own particle sprites using shared event IDs and seeds. State schema may quantize x/y/heading and speed to reduce bandwidth, as long as the displayed result remains smooth. All state schemas must have automated serialization compatibility tests.

### 15.6 Blueprint representation and short codes

Canonical blueprint fields:

```ts
type VehicleBlueprint = {
  formatVersion: 1;
  catalogVersion: string;
  name: string;
  chassisId: string;
  engineId: string;
  tireKitId: string;
  paintId: string;
  parts: Array<{
    instanceId: string;
    partId: string;
    mountId: string;
    offsetX: number;
    offsetY: number;
    rotationQuarterTurns: 0 | 1 | 2 | 3;
    assignedActionSlot?: 0 | 1;
    autoMode?: boolean;
  }>;
  createdAt: string;
};
```

Normalize numeric offsets to allowed integer grid steps, sort installed parts by mount and ID, then hash canonical JSON with a cryptographic hash. The same mechanical car should yield the same `buildHash` independent of the order of purchases. Cosmetic paint and the user-defined name are not part of the mechanical hash. Server-issued car codes are formatted `CAR-XXXXXX-XX` with six cryptographically random Crockford Base32 characters and two checksum characters. A six-character random portion gives over one billion possible sequences; database uniqueness is mandatory and collisions are retried. Reject ambiguous letters or normalize them per Crockford rules. Checksum catches mistypes; it is not a security feature. Example only: `CAR-7K92QZ-R4`. A blueprint code is not a secret, not an invitation, and not proof of authorship. Do not expose private guest identifiers when sharing.

If a saved build exceeds the revised 1,000-credit limit after a later balance patch, importing shows exact overage and highlights replaceable parts. Offer an explicit auto-repair algorithm that removes optional items in descending price order until legal, protecting required engine, chassis and wheels, then allow manual edits. Preserve original immutable blueprint record; save a new revision when repaired.

### 15.7 API and real-time contract

HTTP API, all paths versioned:

| Method | Route | Purpose |
|:---|:---|:---|
| GET | `/api/v1/health` | Readiness and dependency health |
| GET | `/api/v1/catalog` | Current content manifest and balance version |
| GET | `/api/v1/tracks` | Available track presets and weather metadata |
| POST | `/api/v1/blueprints` | Validate, save, and issue short code |
| GET | `/api/v1/blueprints/:code` | Fetch canonical validated blueprint by public code |
| GET | `/api/v1/me/blueprints` | List anonymous guest's saved cars |
| DELETE | `/api/v1/me/blueprints/:id` | Delete owner's private record |
| POST | `/api/v1/guest` | Issue limited signed anonymous guest session |
| GET | `/api/v1/daily` | Optional daily engineering challenge metadata |

Colyseus room messages: `JOIN`, `ROOM_READY`, `SELECT_TRACK`, `LOCK_TRACK`, `BUILD_PATCH`, `SUBMIT_BUILD`, `READY`, `PLAYER_INPUT`, `USE_ABILITY`, `REPAIR`, `REMATCH_VOTE`, `LEAVE`, plus server-directed `MATCH_PHASE`, `COUNTDOWN`, `RACE_EVENT`, `RESULTS`, `ERROR`. Implement exact type-checked payload schemas and server permissions for each phase. While building, the client may preview moves locally; it submits a validated full snapshot at sensible intervals and one final committed build on Ready or deadline. Avoid spamming a patch every drag pixel.

API responses include stable machine-readable error codes and natural error copy. Build requests are idempotent with client request IDs. Guests may own blueprint records through short-lived rotating signed tokens backed by database session IDs. Only the explicitly public code allows third parties to load a blueprint.

### 15.8 Database model

PostgreSQL tables:

- `guest_sessions`: opaque ID, token hash, created time, last seen, expiration.
- `blueprints`: UUID, public short code, owner guest ID, canonical JSON, mechanical hash, catalog version, name, created/updated time, soft-deleted flag.
- `matches`: match ID, track and weather IDs, seed, player opaque IDs, blueprint hashes, final result, start/end times, disconnect reason and summary metrics.
- `match_events`: compact sampling of notable validated authoritative events for debugging and replay analysis, with retention limit.
- `daily_challenges`: date, seed, track, weather, reference bot and nonpersonal aggregate stats.

Indexes on public code, guest ownership, match ID, and daily date. Apply a data retention policy: raw input streams do not persist in production unless a short-lived debug flag is enabled, summarized match events expire after 30 days, and aggregate counts may be kept longer without persistent personal identifiers. Provide a privacy page explaining what guest identifiers and gameplay metrics exist. Give guest a local reset and saved-build deletion function.

### 15.9 AI implementation

Run the bot on the authoritative server. Use a track spline-following controller to calculate steering and safe target speed with curvature look-ahead and local obstacle avoidance. Bot does not read inaccessible opponent internals. Select builds from viable strategy templates parameterized by weather and track; introduce variability through a seeded choice among near-optimal alternatives. Weapon decisions use currently visible target range, arc, cooldown, cover and expected value. Repair decisions prefer severe wheel/engine impairment near remaining high-speed sections. Difficulty modifies planning depth, acceptable line error, and reaction delay, not hidden car stats. Simulate at least two independent styles per difficulty so races do not feel cloned.

### 15.10 Hosting and operations

One production VPS or cloud VM is adequate for initial small-scale launch if performance tests confirm room capacity. Use Docker Compose for `web` (static files), `server` (HTTP and WebSocket), `postgres`, and `caddy` (TLS termination, reverse proxy). All gameplay endpoints use HTTPS and WSS, with secure headers and explicit WebSocket upgrade rules. Put passwords, signing keys and connection strings in environment variables, never the repository. Supply `.env.example` with safe dummy values and a documented start script.

Deploy behind a real HTTPS domain with health checks, restarts, persistent database volume, database backups, log rotation, structured server logs, and a way to run migrations safely. If infrastructure credentials are unavailable to Claude Code, complete and verify local Docker deployment, document exact DNS, HTTPS and environment steps, and clearly state that public deployment is pending credentials. Do not fabricate a live URL. Dev mode uses localhost with sensible fallbacks. Provide automatic frontend cache busting on content version and coordinated server/client protocol version checks. Never serve a new catalog that is incompatible with a match already running; rooms keep their start-of-match catalog snapshot until finish.

### 15.11 Performance and scaling

Measure CPU per simulated room, bandwidth per racer, memory per room, asset download sizes and mobile GPU frame time. Stress test 100 concurrent two-player rooms on a representative server before claiming a capacity number. Add horizontal room distribution and Redis presence only when measurements justify it; do not introduce distributed-state complexity at the expense of finishing a fun game. Start with a single authoritative node and a migration-ready room manager abstraction. Minimize backend persistent writes during a 30 Hz physics loop.

## 16. Accessibility, Privacy, and Age-Appropriate Design

This product is intended to be enjoyable by a smart 10-year-old, including children who may not be able to read dense instructions. Use plain English, strong visual cues, controllable flash/shake, comfortable touch sizes, and no violent depictions of people. Vehicle combat is cartoon mechanical damage: sparks, parts, smoke, and slapstick impacts, never blood, injury, or distressed drivers.

The release contains no chat, direct messages, profile photos, imported contacts, public user search, account creation, behavioral advertising, or payment hooks. Friend invitations are user-initiated sharing of a room link; never automatically send invitations or request contact book permission. No marketing notification permission is requested. Do not collect birthdates merely to gate content. Before public launch, obtain appropriate legal review of child privacy, regional rules, analytics and any future monetization; this document is not legal advice. Provide transparent privacy notice and functional delete controls.

Access provisions include:

- Full game playable with audio muted; warnings have visual equivalents.
- Left-handed mode; UI mirrors correctly while driving stays consistent.
- Reduced Motion and Reduced Flashes preferences, default flashes modest.
- High-contrast HUD and non-color-coded hazard patterns.
- Larger action buttons without blocking the road.
- Keyboard support on desktop for steering and menu navigation.
- Prevent accidental purchases with an explicit Install action.
- Avoid dependence on sub-250-ms reaction times; weapon warning windows accommodate human play.
- Stable camera option for players who experience motion discomfort.

The social loop respects players. No forced shares, invite spam, artificial timers beyond a real competitive build deadline, false scarcity, hidden odds, or player-hostile dark patterns.

## 17. Growth, Retention, and Sharing Loops

### 17.1 Core replay loop

A racer chooses a map, builds a machine, experiences a consequential race, sees a specific reason for success or failure, changes a part, and races again. Every results screen proposes **one relevant experiment**, such as `Try rain tires` after measurable grip loss or `Your turret spent 31 seconds out of arc. Move it to the rear.` Suggestions must be generated from actual telemetry and never shame the player.

### 17.2 Social challenge loop

After a friend match, show `Rematch`, `Swap Cars`, and `New Build`. `Swap Cars` is a consensual special rematch mode that gives each player the other's **publicly shared or currently submitted** car configuration while preserving the same budget and map. A fun outcome is to learn whether the loss was driver skill or build design. Do not reveal private saved blueprints unless the owner explicitly agrees to share them.

A results share card features a true composited car thumbnail, the track, the finishing margin or named feat, and a short car code. Provide native Web Share API when available, clipboard fallback otherwise. Include a deep link back to a new challenge lobby, not a link that joins a completed expired room.

### 17.3 Short replay clip

Define a ring buffer of 10 to 15 seconds of local render states and authoritative event metadata at low sampling rate. After a close finish, offer `Watch Highlight` and `Share Highlight`. Reconstruct a deterministic local 8 to 12-second highlight using the stored car poses and relevant particle seeds. Export video only if the device and browser offer a tested MediaRecorder flow; otherwise export a polished still card with replay link or local screenshot. Do not promise universal mobile video recording or force large memory buffers. No server video rendering is required at launch.

### 17.4 Daily engineering test

Add a small `Today's Build Challenge` card after the main home actions. It uses the same complete open catalog and a preset track/weather, with an AI rival of documented difficulty and a suggested constraint such as `Win with a trike` or `Spend no more than 650 credits`. The challenge is optional, replayable, and never locks gameplay rewards. Rotate at 00:00 UTC with deterministic server seed. Show personal best locally and count completed challenges. Do not require a global public ranking or login at launch. The point is a fresh engineering question, not chores.

### 17.5 Success measurements and ethical limits

Instrument anonymous aggregated events: onboarding completion, garage open, first legal car, install and undo frequency, match start, finish, average race time, quit, weapon use, part diversity, code copy, code import, friend link join, rematch rate, crash, frame rate bucket, and reconnect success. Do not include freeform identifiers, private links, or full IPs in analytics payloads.

Initial product evaluation targets to test, not promises:

| Metric | Initial decision target |
|:---|:---|
| First tutorial race finished | At least 80% of new players who start it |
| Players who understand basic steering | At least 90% within 15 seconds |
| Valid first build within deadline | At least 90%, including starter fallback |
| Any second match in same session | At least 45% of those who finish a match |
| Players who modify at least one part on rematch | At least 40% of rematchers |
| Median full race time | 110 to 140 seconds |
| Match completion absent network failure | At least 95% |
| Critical frame drops on standard test phones | Under defined QA threshold |
| Close finish experiences | Tracked by time gap, not artificially created |
| Shared blueprint import success | At least 98% for compatible valid codes |

Track day-one return and day-seven return only after launch with privacy-compliant aggregate measurement, using cohort definitions rather than unverified external averages. Improve first-run fun and build clarity before adding notification or monetization systems. No false claim that the game is proven viral or addictive.


## 18. User-Facing English Copy and Voice

Use economical, human arcade English. Product voice is confident, mischievous, mechanical, and friendly. It must not sound like a marketing bot, tutorial essay, or randomly generated hype. Never show generic lines such as `Unleash your ultimate potential`, `Epic thrilling adventure`, or `Experience next-level gameplay`. Prefer short accurate verbs: Build, Race, Fire, Repair, Share, Rematch. Use proper punctuation, clear contractions where natural, and sentence case in instructions. The UI may use uppercase display words for `READY`, `GO`, `VICTORY`, and `DEFEAT`, sparingly.

### 18.1 Approved interface copy

| Context | Exact English text |
|:---|:---|
| Main tagline | `Build smart. Drive hard.` |
| Home primary | `Race AI` |
| Friend mode | `Challenge a Friend` |
| Code entry | `Join with Code` |
| Garage library | `My Blueprints` |
| Invite waiting | `Waiting for your rival...` |
| Invite copy action | `Copy Invite Link` |
| Track reveal header | `Know the road. Build for it.` |
| Garage title | `Build Your Car` |
| Credits | `Credits Left` |
| Safe build status | `Ready to Race` |
| Missing essential part | `Your car needs an engine and a complete set of wheels.` |
| Overweight | `Too heavy for this chassis. Remove weight or swap frames.` |
| Heat risk | `This build runs hot. Add cooling or manage your throttle.` |
| Energy warning | `Not enough power for every system at once.` |
| Blocked mount | `This part blocks another attachment.` |
| Ten-second warning | `10 seconds. Finish your build.` |
| Locked garage | `Build locked. Time to race.` |
| VS line | `Your build. Their problem.` |
| Go call | `GO!` |
| Wheel hit | `WHEEL HIT` |
| Engine overheating | `ENGINE HOT` |
| Low energy | `LOW POWER` |
| Repair confirmation | `WHEEL REPLACED` |
| Missile warning | `MISSILE LOCK` |
| Results win | `VICTORY` |
| Results lose | `DEFEAT` |
| First result insight | `Your tires lost grip in the rain.` |
| Race repeat | `Race Again` |
| Alter loadout | `Change My Build` |
| Save car | `Save This Car` |
| Car share | `Share Blueprint` |
| Outdated blueprint | `This build uses older part values. Review it before racing.` |
| Invalid code | `We couldn't find that car. Check the code and try again.` |
| Disconnect | `Connection lost. Trying to bring you back...` |
| Friend forfeits | `Your rival disconnected. You win by forfeit.` |
| AI difficulty Rookie | `Rookie: a forgiving first opponent.` |
| AI difficulty Racer | `Racer: quick and consistent.` |
| AI difficulty Ace | `Ace: smart builds, sharp driving.` |
| Daily card | `Today's Build Challenge` |
| Settings handedness | `Driving Hand` |
| Reduce flashes | `Reduce Flashing Effects` |
| Quit confirmation | `Leave this race? You won't be able to finish it.` |

All additional player-facing strings must follow this voice. English grammar, capitalization, hyphenation, and punctuation require review by a native-level editor before release. No double-hyphen punctuation or long em-dash interruptions in final in-game copy. Use direct sentences and colons instead.

### 18.2 Dynamic commentary library

In the results view, choose only statements supported by actual server telemetry. Examples:

- `Your rear tires took three hits. A wheel cage might help.`
- `You spent 24 seconds above safe engine temperature.`
- `Your mine caught the rival just before the final corner.`
- `That heavy armor cost you time on the long straights.`
- `You took the risky shortcut and saved 2.1 seconds.`
- `The match was decided by 0.4 seconds.`
- `Your rear turret never had a clear shot. Try another mount.`

The game may use deterministic rules or carefully authored templates to generate these observations. Do not call an external language model for live match commentary. Never fabricate performance numbers or claim a cause that the telemetry cannot establish.

## 19. Quality Assurance, Automated Tests, and Launch Acceptance

### 19.1 Unit tests

Required tests for:

- Calculation and refund of all 120 part prices.
- Wheel-count price adjustment for three-, four-, and six-wheel chassis.
- Server validation of every hardpoint, allowed rotation, bounded offset, slot overlap, and weight cap.
- Two identical blueprints with different purchase order producing the same mechanical hash.
- No client request allowing a car over 1,000 credits.
- Safe loading of old, duplicate, malformed and nonexistent blueprint codes.
- Battery discharge priority preserving minimum drivetrain power.
- Overheat threshold and cooling effects under each weather preset.
- Dry and wet grip behavior for each tire kit, including its specialized surface.
- One-to-one correspondence between actual chassis wheel count and wheel integrity entries.
- Correct left/right/rear/front localization of damage.
- Armor arc protection, EMP resistance, mine removal, missile interception, and shield refresh.
- Correct maximum charges and no duplicate firing through repeated input sequences.
- Temporary debuff stacking cap and post-stun immunity.
- Repair wheel selection, repair kit amount, consumable depletion, and cooldown.
- Track checkpoint ordering, safe shortcut legality, wrong-way progress, finish ranking, KO conditions, and timeout tie resolution.
- AI car obeying equipment cooldown, budget, road boundaries, and identical physics.

### 19.2 Integration tests

Run a full simulated match for two scripted clients, verifying:

1. Host creates room and receives valid invitation code.
2. Guest joins by link or code without account creation.
3. Host locks track and both see identical weather.
4. Each submits distinct legal car within timer.
5. Both clients see accurate composited cars and computed VS descriptions.
6. Server performs simultaneous start and 30 Hz simulation.
7. Both can steer, brake, fire, take damage, and repair; one player's repair never mutates the other player's inventory.
8. Accepted hits appear on both devices with one authoritative event ID.
9. One client disconnects, reconnects, and resumes the correct car state.
10. Checkpoint progress determines one authoritative winner.
11. Result statistics and victory state match on both devices.
12. Saved car code can be imported in a fresh browser guest session.
13. Both players approve rematch, with optionally swapped builds.
14. The second match starts without broken scene state or leaked event listeners.

### 19.3 Mobile end-to-end tests

Use Playwright device profiles plus **real hardware testing** for touch, audio, WebGL and multi-finger interactions. Automate screens where possible; run manual checks on at least one small iPhone, one large iPhone, one midrange Android, and one desktop laptop. Mandatory cases: orientation prompts, in-browser portrait fallback, notched safe areas, page visibility, touchscreen gestures with two simultaneous pointers, left-handed weapon placement, browser back, refresh during lobby, sound unlock on tap, tab switching, phone incoming-call simulation, low battery, reduced-motion settings, and low-memory rendering.

Test 200-ms network latency, 80-ms jitter, 5 percent packet loss, and short 2-second outages. Record desync magnitude, disconnect recovery, repeated effects, apparent teleport frequency and multiplayer fairness. A silent audio context on mobile must not throw or block game start.

### 19.4 Automated visual capture and review

Build a visual QA route, available only in development, that composes **every chassis** with different loadouts at all 16 headings, under clear city, rainy city, dusty desert, forest, snowy, and industrial lighting. Save screenshots at logical 640 x 360 and physical common mobile sizes. Generate sprite contact sheets and an atlas validation report with checks for missing texture keys, misaligned pivots, part clipping, disconnected modules, incorrect front/back, and unreadable pixel scale.

Maintain Playwright screenshot baselines for Home, Garage with assembled Spider, Garage with overloaded Needle, Rain City Race, Rocket Impact, EMP Impact, VS Screen, Damage Overlay, Results, Blueprints, Settings, and all error states. Review visual changes rather than blindly accepting new baselines. Test 10-second scripted gameplay videos for rain, rockets, close racing, and heavily customized cars. Screenshots alone do not prove animation quality.

### 19.5 GPU and effect stress test

Spawn two heavily modified six-wheel vehicles with the maximum legal set of offensive modules. Fire missiles, machine guns and EMP during heavy rain, with both cars drifting through puddles and hitting a destructible obstacle. Monitor render frame time, live particle count, draw calls, texture switching and memory. Use particle pools, offscreen culling, atlas batching and limited dynamic lighting. If the frame rate drops, selectively reduce decorative sparks and distant rain first. Never drop gameplay projectiles, suppress valid damage, or hide crucial warning telegraphs to gain FPS.

### 19.6 Security and abuse tests

- Forged client credit total, negative part values and duplicate accessory instance IDs rejected.
- Malformed input message, invalid enum, NaN/Infinity coordinates and excessive payload size rejected.
- Old room invitation cannot access another room.
- Anonymous guest cannot delete someone else's private car.
- Shared code reveals only public blueprint information.
- Rate limiting handles repeated code guesses and room spam.
- Guest token stored and transmitted safely; HTTPS and WSS only in production.
- Script injection in car names or query parameters safely encoded and escaped.
- Catalog version mismatch cannot create mismatched authoritative vehicle stats.
- Untrusted WebSocket input cannot overrun simulation loop.

### 19.7 Explicit launch acceptance checklist

Release requires **all** of the following, not a subset:

- [ ] Public HTTPS browser build opens on target mobile devices and does not need native installation.
- [ ] First-time onboarding and starter car work from a blank browser session.
- [ ] All seven principal screen families plus connection/error states are fully interactive.
- [ ] 20 chassis, 20 engines, 20 tire kits, 20 weapons, 20 defenses and 20 utilities appear with correct names, costs, distinct mechanics and polished art icons.
- [ ] All 120 catalog parts are covered by behavior or effect-primitives tests.
- [ ] Arbitrary legal assemblies are visually composited correctly and physically validated.
- [ ] Multiplayer garage locks after 60 seconds and never spends more than 1,000 credits.
- [ ] Every car has meaningful heat, energy, mass, and stability behavior.
- [ ] Top-down float steering, braking and left-handed actions work with two fingers.
- [ ] Two friends can enter by code/link and finish a synchronized three-minute-or-shorter match.
- [ ] AI uses same physics, funds and weapon rules as human player.
- [ ] Sixteen directional chassis frames and coherent component attachment visuals render without flicker.
- [ ] Each of 20 weapons has a unique visual and audible action signature.
- [ ] Rocket and mortar explosions have layered flashes, fire, debris and smoke.
- [ ] Wet road reflections, rain spray, sand dust and forest ambience work on real phones.
- [ ] Damage appears on the correct car component and wheel spare visibly repairs it.
- [ ] All launch tracks, weather, checkpoints and shortcuts are operational.
- [ ] One authoritative result is shown consistently to both players.
- [ ] Short car codes create, persist, import and validate across browsers.
- [ ] Rematch, edit build, swap cars and share flows work without an account.
- [ ] No placeholder buttons, stock-watermark images, generic square cars or empty scenes remain.
- [ ] Low-effects settings preserve readability and touch responsiveness.
- [ ] Device tests and network stress tests meet documented budgets.
- [ ] Privacy disclosure, deletion controls, error handling, backups and HTTPS are in place.
- [ ] Automated tests and clean install/build commands pass on the committed revision.

## 20. Implementation Order and Milestone Gates

These milestones are the **execution sequence**, not permission to stop before the final state. Do not ask the product owner questions already answered by this specification. Choose reasonable implementation details, leave a documented note, and continue.

### Milestone A: Foundation and vertical car demo

Create monorepo, types, CI, Phaser canvas, basic server, guest session and one authored city track. Build the baseline Beetle visually with separate wheel and engine layers and directional steering. Deliver a working single car whose motion and camera already feel excellent. **Gate:** It runs on a real phone, is controllable with a floating joystick, and shows crisp high-quality pixel art at 60 FPS on a standard test device.

### Milestone B: Garage, physics, and complete content schemas

Build all hardpoint structures, canonical blueprint serializer, garage editor, budget validator, five engineering indicators, complete 120-item catalog, predictive deltas, templates, and stable modular car renderer. Model heat, traction, mass and energy. **Gate:** Automatically validate every SKU, build unusual cars, and verify meaningful speed/stability differences. Every displayed item must be real game data.

### Milestone C: Combat and spectacular effects

Implement 20 weapon behaviors from shared primitives, all defenses and utilities, damage localization, repairs, particle libraries, screen feedback, visual state machine, and sound. **Gate:** A scripted two-car match produces all four major VFX examples with readable effects and stable frame rate. Each weapon has a distinct impact identity.

### Milestone D: Eight tracks and AI

Ship launch tracks and weather presets, finish/checkpoints, obstacles, alternate shortcuts, bot control and AI loadouts. Develop full biome art and ambient animation. **Gate:** Bot tournament harness runs reliable server-only matches across every track/weather condition, and humans can recognize how surface choice affects car construction.

### Milestone E: Multiplayer and persistence

Finish Colyseus rooms, reconnect, friend code links, host/guest lobby, builder deadlines, server validation, snapshot prediction, authoritative results, PostgreSQL blueprints and code sharing. **Gate:** Two physical phones on separate networks can invite, build, race, damage, repair, finish and rematch without desynchronization or state leaks.

### Milestone F: Production polish and retention tools

Complete VS sequence, garage ambience, all screens, results diagnostics, highlight replay fallback, daily build challenge, comprehensive settings, browser compat, and audio mixes. Replace art that does not meet the stated visual gates. **Gate:** Real players can finish their first game without instruction and voluntarily start a second experiment. Do not substitute a subjective developer impression for basic playtesting.

### Milestone G: Testing, load, security, and public deploy

Run CI, content integrity tests, integration tests, mobile QA, network simulation, 100-room load exercise, privacy review, secure deployment, backup/restore exercise, and complete launch acceptance checklist. **Gate:** Public HTTPS URL is stable, feature-complete and visually consistent with the art bible.

## 21. Risks and Decisions Already Resolved

**Risk: 120 parts create a shallow, unreadable shop.** Mitigation: six categories, recommended loadouts, consistent card metadata, limited two-button manual weapons, meaningful automatic systems, 60-second build cap, instant code load, and a fast default car.

**Risk: full freedom makes touch building clumsy.** Mitigation: configurable hardpoints with bounded placement, snapping and rotation, not unrestricted vertex editing. Keep room for silly asymmetry and genuine mass distribution.

**Risk: a missile causes an unrecoverable two-minute defeat.** Mitigation: subsystem impairment caps, temporary grace, limp-home state, repair items, narrow permanent damage effects, and strong driving agency.

**Risk: truly rich pixel art is beyond a code-only asset generator.** Mitigation: build compositing and atlas tools from the start, author a professional silhouette system, create curated pixel sprites rather than accept generic placeholders, and budget explicit manual art review as a launch gate. Code cannot guarantee excellent aesthetic taste, so do not claim finished visuals without external screenshots/video review.

**Risk: network latency makes collisions unfair.** Mitigation: authoritative server, local input prediction, remote interpolation, tested hit confirmation, exact event IDs, reconnection and jitter tests.

**Risk: every player picks only the fastest car.** Mitigation: track and weather information before building, matchup-dependent physics, tightly limited budget, tire specialization, armor counters, and telemetry-driven tournaments.

**Risk: daily challenges or social features feel manipulative to children.** Mitigation: optional fixed engineering puzzles, user-initiated links only, no account, no personal profiling, no advertising or scarcity incentives.

**Risk: rendering 20 different chassis and many modules explodes asset memory.** Mitigation: standard frame sizes, consistent anchors, atlases, shared VFX systems, lazy biome loading, cached compositions, pooled particles and renderer quality tiers.

## 22. Final Product Acceptance Statement

The product is complete only when its originality is obvious in the first minute. The car on the screen must visibly be the machine the player built. Its mass and engineering compromises must matter in corners and collisions. Its weapons must have timing, personality, anticipation and extraordinary pixel effects. The road, rain and debris must feel alive. A player must be able to lose by a small margin, identify a meaningful design mistake, replace one part, and immediately demand another race.

Do not optimize for the appearance of feature completeness while leaving the core race dull. Do not optimize solely for spectacular effects while the garage decisions are fake. Do not ship with 120 catalog cards that all trigger the same generic animation. The final experience must deliver both: deep, approachable engineering and polished, explosive arcade racing.

## 23. Source Notes for Implementation Verification

The following are official technical references used to support architectural choices. These are not runtime dependencies and do not authorize third-party asset reuse.

1. Phaser pixel-art render configuration: https://docs.phaser.io/api-documentation/3.90.0/typedef/types-core
2. Phaser camera and pixel-rounding behavior: https://docs.phaser.io/phaser/concepts/cameras
3. Phaser particle system: https://docs.phaser.io/phaser/concepts/gameobjects/particles
4. Phaser rendering effects and WebGL limitations: https://docs.phaser.io/phaser/concepts/fx
5. Colyseus room state synchronization: https://0-16-x.docs.colyseus.io/state
6. Colyseus 0.16 schema: https://0-16-x.docs.colyseus.io/state/schema
7. Mobile pointer and touch-action behavior: https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events
8. Web Audio autoplay constraints: https://developer.mozilla.org/en-US/docs/Games/Techniques/Audio_for_Web_Games
9. Browser orientation-lock compatibility: https://developer.mozilla.org/en-US/docs/Web/API/ScreenOrientation/lock

**Final developer directive:** Treat this document as the complete implementation brief. Deliver the game in the repository, with generated art and source manifests, deployment instructions, reproducible tests, and a playable HTTPS version. Make every screen functional and every component meaningful. When the game is declared finished, provide the actual URL, the test results, the visual QA recordings, and a concise account of any remaining known limitations. Do not claim deployment or complete visual polish unless it has actually been verified.
