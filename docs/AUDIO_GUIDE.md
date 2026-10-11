# Audio guide

How BOLT RIVALS sounds, how the sound is built, and how it is checked. Sections 13.4, 13.6,
14.3, 14.4, 5.13 and 16 of the specification are the requirements; this file is the working
practice.

**There are no audio files.** Every sound is synthesized in the browser with the Web Audio
API, in the manner of an 8-bit or 16-bit sound chip: pulse, triangle and saw channels, white
and shift-register noise, two-operator FM, bit-crush, short envelopes, arpeggios.

**No person has listened to any of it.** The work was done where nothing can be heard, so
every claim below is a measurement or a property of the code, never a judgement by ear. The
measurements are real and repeatable, and they can tell that a sound is clean, present, the
right length and different from its neighbours. They cannot tell whether it is pleasant, whether
a V8 reads as a V8, or whether the mix is tiring after ten races. That needs ears, and
[what a listener should check first](#what-a-listener-should-check-first) says where to start.

## Where things are

Everything is in `apps/web/src/game/audio/`.

| File               | What it holds                                                                       |
| :----------------- | :---------------------------------------------------------------------------------- |
| `recipe.ts`        | The recipe format: layers, envelopes, buses, categories and their loudness windows  |
| `sfxRecipes.ts`    | Every one-shot and loop, as data                                                    |
| `engineRecipes.ts` | The twenty engine voices, as data                                                   |
| `sfxTrim.ts`       | Generated: the gain that puts each recipe and engine on its loudness target         |
| `soundMap.ts`      | Which sound answers which event and which part. Pure tables and functions           |
| `mixMath.ts`       | Distance, pan, ducking, voice stealing, rate limits, the gear model, the caps. Pure |
| `synth.ts`         | Recipe to Web Audio nodes, on any `BaseAudioContext`                                |
| `mixer.ts`         | Buses, the master limiter, the voice pool                                           |
| `engineVoice.ts`   | The running engine and tire graphs                                                  |
| `music.ts`         | The race theme and its sequencer                                                    |
| `AudioSystem.ts`   | The race as sound: listens to snapshots and events, runs everything above           |
| `haptics.ts`       | Vibration patterns behind a switch                                                  |
| `settings.ts`      | The audio preferences the app's settings store does not hold yet                    |
| `index.ts`         | The live singleton: the `AudioContext`, unlock, visibility, the public functions    |
| `EngineAudio.ts`   | What the race scene holds: the same five calls it has had since Milestone A         |
| `debugHarness.ts`  | Offline rendering for the tests. A separate chunk, loaded only with `?debug=1`      |

## How the game reaches it

The audio system gets race data only through `game/raceFeed.ts`: every 15 Hz race snapshot,
every event once, and resets. It subscribes by itself when the audio context is created. The
scene, the HUD and the garage do not know that weapons make noise.

The race scene keeps the calls it already made on `EngineAudio`, unchanged:

- `unlock()` from a pointer or key handler;
- `setVolumes(engine, effects, muted)` every frame;
- `update(forwardSpeed, throttle, slipRatio, topSpeed, active)` every frame, from the
  predicted car. This is what keeps the engine note glued to the throttle ahead of the
  snapshots. Without it the system drives the engine from the snapshots alone;
- `thump(severity)` on a wall strike and `beep(go)` on each countdown light;
- `dispose()` when the race view closes. The context stays alive for the menus.

Everything else other code may call is exported from `game/audio/index.ts`:

| Function                                                              | For                                                                                                                                                                                                                                                                                                                                                                        |
| :-------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uiSound(kind, partId?)`                                              | Interface sounds. Kinds: `tap`, `select`, `confirm`, `back`, `deny`, `illegal`, `toggle_on`, `toggle_off`, `slider`, `open`, `close`, `install`, `remove`, `rotate`, `ready`, `timer_tick`, `timer_urgent`, `timer_end`, `save`, `error`. For `install`, pass the part id: the part answers with its own family's sound, and an engine adds half a second of its own voice |
| `uiHaptic(kind, strength?)`                                           | A vibration, if the player enabled haptics and the device can                                                                                                                                                                                                                                                                                                              |
| `getAudioPrefs()`, `setAudioPrefs(patch)`, `onAudioPrefs(listener)`   | `musicVolume`, `uiVolume`, `musicEnabled`, `haptics`, `reducedIntensity`. Persisted on `bolt.audio.v1`                                                                                                                                                                                                                                                                     |
| `hapticsSupported()`                                                  | Whether to show the haptics switch at all                                                                                                                                                                                                                                                                                                                                  |
| `setAudioRaceContext({ blueprint, trackId, weatherPresetId, track })` | Optional. Says exactly which car and track are raced. Without it the car is the saved blueprint (or the scenario's car) and the track is `city_01`                                                                                                                                                                                                                         |
| `unlockAudio()`, `audioState()`                                       | Normally not needed: the module listens for gestures itself                                                                                                                                                                                                                                                                                                                |

`uiSound` is silent before the first gesture and when muted, and never throws. None of these
are wired into the HUD, the settings panel or the garage yet: those files belong to their own
owners. The call sites are listed in `docs/DECISIONS.md`.

## The mix

```
voice ─┐
voice ─┼─ bus volume ─ bus duck ─┐
engine ┘                          ├─ sum ─ mute ─ compressor ─ soft clip ─ output
music notes ─ bus volume ─ duck ──┘
```

Seven buses: `engine`, `weapons`, `impacts`, `ambience`, `alerts`, `ui`, `music`. The user's
sliders set bus volumes: Engine on `engine`; Effects on `weapons`, `impacts`, `ambience` and
`alerts`; Interface on `ui`; Music on `music` (Section 5.13 asks for those four). Warnings are
on the Effects slider on purpose: a player who turns the interface down should still hear a
missile.

The master is a compressor (threshold -13 dB, ratio 10, 3 ms attack) followed by a soft
clipper whose output cannot exceed 0.824, which is -1.7 dBFS. The compressor rides the level;
the clipper is the guarantee. The render tests assert that nothing peaks above -1 dBFS, in the
worst mix they can build.

**Ducking.** A recipe may carry `duck`, 0 to 1. While it plays, the music drops by up to about
10 dB, the engines by 4 and the ambience by 3, then come back over a fifth of a second. The
explosions duck fully or nearly; the missile warning ducks by half; the win and lose stingers duck so
they are heard clear.

**Space.** The listener is the player's car. The player's own sounds are centred at full
level. Anything else is placed by its world position: full level inside 90 px, silent at
760 px, falling as the square in between, and panned by at most 0.65 for something 360 px to
one side ("modestly", Section 14.3). Sounds that belong to the rival's car are a further 20
percent quieter. A sound too far to hear is not given a voice. Loops that follow something (a
rocket, a burning car, a decoy) are moved at every snapshot, with a glide.

### Caps

<!-- BEGIN AUDIO CAPS -->

| Limit                                                         |      Value |
| :------------------------------------------------------------ | ---------: |
| One-shot and loop voices alive at once, music excluded        |         20 |
| Voices on the `engine` bus                                    |          2 |
| Voices on the `weapons` bus                                   |          8 |
| Voices on the `impacts` bus                                   |          7 |
| Voices on the `ambience` bus                                  |          6 |
| Voices on the `alerts` bus                                    |          2 |
| Voices on the `ui` bus                                        |          4 |
| Voices on the `music` bus                                     |         16 |
| Layers in one voice                                           |          5 |
| Nodes one layer can need                                      |          8 |
| Nodes in the fixed driving graphs (two engines and the tires) |         72 |
| Small impacts let through at once, then per second            | 4, then 12 |

<!-- END AUDIO CAPS -->

A voice is at most five layers, and a layer is at most eight nodes, so the pool can never hold
more than a few hundred nodes however busy the race is. When a new sound finds no room, in
order: a sound over its own copy limit replaces its oldest copy; a full bus gives up its
weakest voice (lowest priority, then oldest); a full pool gives up its weakest voice anywhere
outside the music. A new sound weaker than everything it could replace is dropped. A stolen
voice is faded over 12 ms, never cut. Priority 100 is never stolen: the two warning loops and
the knockout.

**A burst cannot become a wall.** Recipes carry a least interval between starts (a machine-gun
round 60 ms, a bullet hit on a surface 60 ms), separately for the player, the rival and the
world. Small impacts of a burst also draw from one shared allowance: four at once, then twelve
a second. The eight pellets of a shotgun are one shot sound and one fan-of-ticks impact.

**Per frame.** No node is created per frame. Continuous sounds (two engines, the tires) are
fixed graphs built once whose parameters glide; a frame costs about twenty `setTargetAtTime`
calls. Discrete sounds create nodes when they start and free them when they end. Music notes
are scheduled a quarter of a second ahead on the audio clock, twenty to thirty a second.

### Starting, stopping, hiding

- Nothing exists before the first gesture: no context, no nodes. The module listens for
  `pointerdown`, `keydown` and `touchend` on the window and creates or resumes the context
  inside the handler, which is what iOS Safari requires.
- The listeners stay for the life of the page, so a context that iOS has `interrupted` (a
  call, the silent switch, another app) resumes on the next touch.
- While the context is not running, nothing new is started. A voice started on a stopped
  clock would play late and all at once.
- When the page is hidden, every voice is faded in 20 ms and the context is suspended. When it
  comes back the context resumes, and status and warning loops are restarted from the next
  snapshot, because the system reconciles its loops against every snapshot and does not rely
  on having seen the event that began them.
- Every loop has three ways to stop: the event that ends it, the snapshot no longer showing
  its subject for three snapshots, and a time limit. `raceFeed.reset()` stops everything,
  frees the engine graphs and clears the rate limits.
- Every envelope starts at zero and returns to zero on a ramp (3 ms at least in, 12 ms out).
  A voice has one output gain apart from its envelopes; that is what is faded when it is
  stopped early, so stopping can never click either.

## Engines

One voice per engine, chosen by the catalog `soundKey` (every one of the twenty engines has its
own key). The pitch model is road speed over nominal top speed through four gears with
hysteresis, so the note falls at each upshift; motors and turbines have one gear and simply
follow the road. Throttle opens the filter and raises the level. Powertrain state from the
snapshot drives what needs it: `engineSpool` the turbo whistles and the turbine, `engineClock`
the Wildcard's pitch cycle, a rising `engineBurst` the spring release and the rocket's cough.
An EMP on the player's car chops their own engine at 11.5 Hz for as long as it lasts.

The rival's engine is the same code driven from its snapshot at 15 Hz, placed in the world, and
built only when it is near enough to hear.

<!-- BEGIN AUDIO ENGINES -->

| Engine                                 | Voice (`soundKey`)      | Firing frequency | Gears | Extras                                   | Design intent                                                                                        |
| :------------------------------------- | :---------------------- | :--------------- | ----: | :--------------------------------------- | :--------------------------------------------------------------------------------------------------- |
| Mini Electric `engine_mini_electric`   | `engine_electric_small` | 150 to 900 Hz    |     1 | whine by speed                           | Mini Electric: a small pure whine that rises with road speed and is silent at rest.                  |
| Four-Cylinder `engine_four_cylinder`   | `engine_inline4`        | 60 to 215 Hz     |     4 | -                                        | Four-Cylinder: the raspy all-rounder, a saw and a square an octave up over a sub.                    |
| V6 `engine_v6`                         | `engine_v6`             | 64 to 236 Hz     |     4 | lump 0.14                                | V6: smoother and fuller, with a fifth above the fundamental and a light burble.                      |
| V8 `engine_v8`                         | `engine_v8`             | 44 to 168 Hz     |     4 | lump 0.5                                 | V8: roars low. A deep uneven burble at idle that hardens into a bellow.                              |
| V12 `engine_v12`                       | `engine_v12`            | 84 to 340 Hz     |     4 | -                                        | V12: a high, smooth, ripping howl with dense harmonics and no lumpiness at all.                      |
| Small Turbo `engine_small_turbo`       | `engine_turbo_small`    | 64 to 230 Hz     |     4 | whine by spool, blow-off                 | Small Turbo: a busy four with a whistle that climbs as the turbo spools and a blow-off on lift.      |
| Twin Turbo `engine_twin_turbo`         | `engine_turbo_twin`     | 60 to 224 Hz     |     4 | lump 0.12, whine by spool, blow-off      | Twin Turbo: a bigger six with two whistles beating against each other, and a loud blow-off.          |
| Supercharger `engine_supercharger`     | `engine_supercharger`   | 46 to 172 Hz     |     4 | lump 0.32, whine by rpm                  | Supercharger: a V8 underneath and a belt-driven whine that is always there and tracks the revs.      |
| Torque Diesel `engine_diesel`          | `engine_diesel`         | 36 to 122 Hz     |     3 | lump 0.4, lfsr channel                   | Torque Diesel: very low and square, with a hard clatter on every firing stroke.                      |
| Sport Electric `engine_electric_sport` | `engine_electric_sport` | 200 to 1500 Hz   |     1 | whine by load                            | Sport Electric: a hard, fast-rising saw whine with a fifth in it, the loudest of the motors.         |
| Eco Electric `engine_electric_eco`     | `engine_electric_eco`   | 120 to 700 Hz    |     1 | whine by speed                           | Eco Electric: the gentlest voice, a soft hum with a faint whistle, silent at rest.                   |
| Hybrid `engine_hybrid`                 | `engine_hybrid`         | 62 to 208 Hz     |     4 | whine by speed, motor below 40% throttle | Hybrid: hums like a motor on a light throttle, and the petrol engine cuts in when pushed.            |
| Rotary `engine_rotary`                 | `engine_rotary`         | 90 to 420 Hz     |     4 | lump 0.6                                 | Rotary: a high, hollow buzz that "braps" at idle and screams smooth at speed.                        |
| Turbine `engine_turbine`               | `engine_turbine`        | 180 to 520 Hz    |     1 | whine by spool, noise channel            | Turbine: no cylinders at all. A whistle that takes time to spool up over a wash of hiss.             |
| Rocket Engine `engine_rocket`          | `engine_rocket`         | 56 to 90 Hz      |     1 | lump 0.5, noise channel, `rocket_pulse`  | Rocket Engine: a pulsing roar of burning fuel, ten pulses a second, with a deep cough at each burst. |
| Twin Drive `engine_twin`               | `engine_twin`           | 58 to 205 Hz     |     4 | -                                        | Twin Drive: two engines a shade apart, so the note beats and throbs against itself.                  |
| Spring Drive `engine_spring`           | `engine_spring`         | 55 to 165 Hz     |     1 | metal channel, `spring_release`          | Spring Drive: clicks. A ratchet whose ticking speeds up with the car, over a wound-spring twang.     |
| Trail Engine `engine_offroad`          | `engine_offroad`        | 40 to 154 Hz     |     3 | lump 0.7                                 | Trail Engine: a big single thumping away, every stroke separate at low revs.                         |
| Ironheart `engine_resilient`           | `engine_resilient`      | 40 to 146 Hz     |     3 | lump 0.25, metal channel                 | Ironheart: cast iron. Low, dark and steady, with a slow mechanical knock that never goes away.       |
| Wildcard Motor `engine_experimental`   | `engine_experimental`   | 74 to 270 Hz     |     2 | lump 0.3, 4 s pitch cycle                | Wildcard Motor: an inharmonic, glitching tone whose pitch swells and sags on its four-second cycle.  |

<!-- END AUDIO ENGINES -->

**Tires.** One noise source, two bands. The skid follows slip above 0.3 and is coloured by the
surface under the car (a screech on asphalt and metal, a hiss on sand and snow, a low scrub on
mud) and by the tire family. The rumble follows speed on rough surfaces (cobble most). Wet
weather softens the screech. The surface is looked up from the track at 15 Hz.

## Weapons

Section 13.4 gives each weapon a sonic character, and the table below is the answer. The
design intent of each sound is in the recipe table at the end.

<!-- BEGIN AUDIO WEAPONS -->

| Weapon                              | Wind-up or lock | Fire                    | In flight        | On a hit                           | Ending                           |
| :---------------------------------- | :-------------- | :---------------------- | :--------------- | :--------------------------------- | :------------------------------- |
| Front Machine Gun `weapon_front_mg` | -               | `mg_fire` per round     | -                | the surface                        | -                                |
| Rear Sentry `weapon_rear_mg`        | `sentry_pivot`  | `sentry_fire` per round | -                | the surface                        | -                                |
| Swivel Turret `weapon_turret`       | `turret_lock`   | `turret_fire` per round | -                | the surface                        | -                                |
| Road Shotgun `weapon_shotgun`       | -               | `shotgun_fire`          | -                | `hit_pellets` over the surface     | -                                |
| Needle Railgun `weapon_railshot`    | `rail_charge`   | `rail_fire`             | -                | `hit_rail` over the surface        | -                                |
| Straight Rocket `weapon_rocket`     | -               | `rocket_launch`         | `rocket_fly`     | the surface                        | `explode_rocket`                 |
| Seeker Missile `weapon_homing`      | `seeker_lock`   | `seeker_launch`         | `seeker_fly`     | the surface                        | `explode_seeker`                 |
| Road Mine `weapon_mine`             | -               | `mine_drop`             | -                | the surface                        | `explode_mine`                   |
| Oil Slick `weapon_oil`              | -               | `oil_spill`             | -                | the surface                        | -                                |
| Sticky Foam `weapon_foam`           | -               | `foam_launch`           | `foam_fall`      | the surface                        | -                                |
| EMP Pulse `weapon_emp`              | `emp_charge`    | `emp_burst`             | -                | the surface                        | -                                |
| Tesla Arc `weapon_tesla`            | -               | `tesla_arc`             | -                | the surface                        | -                                |
| Flame Spitter `weapon_flame`        | -               | `flame_ignite`          | `flame_stream`   | the surface                        | -                                |
| Frost Cannon `weapon_frost`         | -               | `frost_fire`            | -                | the surface                        | `frost_shatter`, `frost_shatter` |
| Crash Hammer `weapon_hammer`        | `hammer_draw`   | `hammer_swing`          | -                | `hammer_clang` over the surface    | -                                |
| Side Saw `weapon_saw`               | -               | `saw_bite`              | -                | the surface                        | -                                |
| Grapple Harpoon `weapon_harpoon`    | -               | `harpoon_fire`          | -                | the surface                        | -                                |
| Air Cannon `weapon_air`             | -               | `air_blast`             | -                | the surface                        | -                                |
| Steel Boomerang `weapon_boomerang`  | -               | `boomerang_throw`       | `boomerang_spin` | `boomerang_slash` over the surface | `boomerang_catch`                |
| Arc Mortar `weapon_mortar`          | `mortar_lock`   | `mortar_launch`         | `mortar_whistle` | the surface                        | `explode_mortar`                 |

<!-- END AUDIO WEAPONS -->

Wind-ups and the mortar whistle are stretched to the ticks the simulation reports, so a lock
shortened by a Turret Computer sounds shorter. An EMP cancels a charge and its sound. Travel
loops follow the projectile from the snapshots; the boomerang's rises a minor third when it
turns for home, which is read from its velocity because no event marks the turn.

### What was hit (Section 13.6)

A `hit` plays what the struck thing sounds like, so the ear can tell: `hit_shield` (an electric
splash), `hit_armor` (a hard ping), `hit_engine` (an iron knock and a hiss), `hit_steering` (a
clonk and a twang), `hit_wheel` (rubber and a rim bell), `hit_module` (a crunch with a digital
glitch), `hit_body` (a dull thud). Whatever stood in the way and took most of the hit wins.
Bullets play it small and high, under the burst allowance. Heavy hits play it lower with
`impact_heavy`, a sub drop, underneath. Rams play `ram_crunch` scaled by damage. A burn pulse
is a `burn_tick`. The weapon's own mark (the railgun slash, the hammer clang, the boomerang
slash, the pellet fan) goes on top.

### Statuses

| Family     | Sound                                                                   | Stops        |
| :--------- | :---------------------------------------------------------------------- | :----------- |
| `slow`     | `status_slow`, a one-shot squelch                                       | by itself    |
| `grip`     | `oil_slip` or `frost_crackle` loop, by what is on the road at the car   | on `expired` |
| `burn`     | `status_burn` loop                                                      | on `expired` |
| `emp`      | `status_emp` loop, and the player's own engine stutters                 | on `expired` |
| `jam`      | `status_jam` loop                                                       | on `expired` |
| `boost`    | `boost_loop`                                                            | on `expired` |
| `refit`    | `repair_work` loop                                                      | on `expired` |
| `airborne` | `jump_land` when it ends (the launch is the utility's sound)            |              |
| `immune`   | silent, on purpose: it begins in the tick of the disable that grants it |              |

Burning oil on the road is one `fire_area` loop on the nearest patch.

## The race, warnings and the interface

Countdown `race_count` and `race_go` (from the scene's `beep`), `lap_chime`, `final_lap`,
`pos_gain` and `pos_loss`, `finish_line`, and `stinger_win`, `stinger_lose` or `stinger_draw`
on the result. A rival weapon's lock is the `warn_lock` loop, an inbound guided missile the
`warn_missile` loop, three times as fast and a fourth higher, ending on impact or on
`warn_clear`. `warn_trap` for the Mine Detector. Heat and battery have no events, so
`warn_heat` (core heat crossing 90), `warn_overheat` (thermal protection cutting in) and
`warn_low_power` (the battery falling under 12) come from the snapshot's gauges.

Silent play is complete: every warning here doubles something the snapshot also carries for
the HUD (`lockWarning`, `warning` events, heat, battery), as Section 16 requires.

## Music

Section 14.3 asks for original chiptune themes at 100 to 145 BPM with adaptive layers. There is
one theme, "Neon Cut", for the one track that ships: A minor, eight bars, a 25 percent pulse
lead, a 12.5 percent pulse arpeggio, a triangle bass and a noise kit, at 128 BPM. It starts at
GO. On the final lap or once the finishing window opens it changes to the final arrangement:
140 BPM, four kicks to the bar, sixteenth hats, the arpeggio throughout. It stops for the
result stinger. The arpeggio joins every other time round so the loop is not the same eight
bars forever. It is mixed low: `docs/evidence/audio/music.md` has the measured level beside the
engines', and its slider defaults to half.

Not done: the "last 30 seconds" layer. The client is never told the race's time limit, so the
final lap and the finishing window stand in for it.

## Haptics

`haptics.ts`, Section 14.4. Off by default, a no-op where `navigator.vibrate` does not exist
(iOS Safari), never called before a touch. Patterns are short: a hit 14 ms, a heavy hit 32, an
explosion 40-30-22, a knockout 70-40-110. At most one vibration every 70 ms, so a burst is one
pulse. Only the player's own events vibrate, and explosions within 140 px. Reduced intensity
halves every pulse. Nothing depends on it.

## Loudness

Every recipe belongs to a category with a target. The measure is the loudest 100 ms RMS of the
sound alone, at the player's own car, every slider at full, after the master chain.

<!-- BEGIN AUDIO LOUDNESS -->

| Category       | Aim (dBFS) | Accepted window | Sounds | What is in it                                         |
| :------------- | ---------: | :-------------- | -----: | :---------------------------------------------------- |
| `ui`           |        -24 | -30 to -18      |     17 | Buttons, sliders, checkpoint tick                     |
| `race`         |        -19 | -25 to -13      |      7 | Countdown, lap, position, build clock                 |
| `stinger`      |        -17 | -23 to -11      |      6 | GO, final lap, win, lose, Ready                       |
| `alert`        |        -16 | -22 to -10      |      8 | Lock and missile warnings, heat, power, critical part |
| `fire_small`   |        -19 | -25 to -13      |     14 | Bullets, arcs, sprays                                 |
| `fire_big`     |        -15 | -21 to -9       |      7 | Shotgun, railgun, launches, EMP, air cannon           |
| `mech`         |        -23 | -29 to -17      |     21 | Wind-ups, locks, hatches, clicks, whistles            |
| `travel`       |        -25 | -31 to -19      |      5 | Loops that follow a projectile or a stream            |
| `impact_small` |        -22 | -28 to -16      |      6 | Ricochets, burn ticks, splashes                       |
| `impact`       |        -17 | -23 to -11      |     28 | What a hit struck, crunches, shield and part events   |
| `explosion`    |        -12 | -18 to -7       |      6 | The four explosions, the hammer clang, the knockout   |
| `status`       |        -26 | -32 to -20      |     10 | Status loops and fire on the road                     |
| `utility`      |        -19 | -25 to -13      |     13 | Repairs, boosts, jump, winch, shield up               |
| `install`      |        -21 | -27 to -15      |     19 | Fitting a part in the garage                          |

<!-- END AUDIO LOUDNESS -->

Engines aim at -20 dBFS RMS at full throttle (window -25 to -15) and are 7 to 16 dB quieter
at idle. The music lands between -34 and -20.

Recipes do not carry their own gain. `tests/audio/calibrate.ts` renders each one through the
master chain and moves its gain until it sits on the aim, and writes `sfxTrim.ts`. So levels
are consistent by construction, and the render test fails if a recipe is edited without
calibrating again.

**Small speakers.** A phone speaker gives almost nothing under 300 Hz. The render test
requires that at least a fifth of every sound's energy (-7 dB) lies between 300 Hz and 8 kHz,
and the same of every engine at speed. The first pass failed this for 30 recipes and 11
engines: the engines sat an octave too low and every thud was a sine. They were re-pitched and
given harmonics until they passed. `impact_heavy`, a pure sub layer that only ever plays under
another sound, is the one exception.

## Evidence, and how to listen

`docs/evidence/audio/` holds what the tests measured and rendered:

| File                                          | What                                                                                                |
| :-------------------------------------------- | :-------------------------------------------------------------------------------------------------- |
| `recipes/<id>.wav`, `.png`                    | Every recipe alone, and its spectrogram                                                             |
| `engines/<soundKey>.wav`, `.png`              | Every engine over the same seven seconds: idle, a pull through the gears, a second at speed, a lift |
| `weapons/weapon_<id>.wav`, `.png`             | Each weapon's showcase scenario, three seconds from its first sound, engines and music silent       |
| `mixes/rocket_hit.wav`, `mixes/emp_burst.wav` | Two whole scenarios in stereo; the second with music                                                |
| `mixes/busy_all_weapons.wav`                  | The stress mix: a continuous machine gun on the player while every weapon fires                     |
| `mixes/music_neon_cut.wav`                    | Sixteen seconds of the theme, the second half in the final arrangement                              |
| `loudness.md`, `engines.md`, `music.md`       | The measured tables                                                                                 |
| `weapon-distances.md`                         | The fingerprint of each weapon and the distance between every pair                                  |
| `scenarios.md`, `live-scenarios.md`           | Voices, polyphony, peaks and node counts per scenario, offline and in the real client               |

Spectrograms have time left to right, frequency bottom to top on a log scale from 40 Hz to
16 kHz with ticks at 100 Hz, 1 kHz and 10 kHz, level as heat over 70 dB, and the waveform
under them.

To make them again:

```
pnpm build
PORT=2671 node apps/server/dist/main.js &
BOLT_AUDIO_EVIDENCE=1 BOLT_E2E_PORT=2671 npx playwright test tests/e2e/audio.spec.ts
```

To hear the game itself, play it: `?debug=1&scenario=<id>` plays one scenario (the ids are in
`docs/COMBAT_API.md`), and `window.__boltAudio` at the console gives `stats()`, the voice
`log()`, and `ui('ready')` or `ui('install', 'engine_v8')` to audition interface sounds.

### What the tests prove

`tests/e2e/audio.spec.ts`, rendered offline in headless Chromium through the game's own code:

- every recipe: peak under -1 dBFS, no DC offset, no click at note on or off, loudness inside
  its category's window, audible for at least a third of its designed length and not beyond
  it, silent afterwards, enough energy above 300 Hz, every node released;
- every engine: the same, plus quieter at idle than at speed, brighter with revs, silent after
  being switched off, and no two engines closer than a floor in any of three phases;
- the twenty weapons: no two fingerprints closer than 0.9, where 1 means plainly different on
  one axis alone (brightness, width, length, envelope, pitch contour, noisiness, attack,
  roughness);
- all 33 scenarios: the expected sounds in order (written by hand in
  `tests/audio/expectations.ts` from Section 13.4, not derived from the audio code), polyphony
  inside the cap, no clipping, silence and no live nodes after the reset;
- the stress mix: inside the caps, under the ceiling, the missile warning never stolen, the
  number of machine-gun rounds and bullet hits that actually start bounded by the limits;
- the music: level, tempo of both arrangements, its own voice cap, a clean stop.

And in the real client: no context before the first gesture and a running one after; mute, the
four volumes and the music switch reaching the mixer; a hidden tab silencing and suspending;
and every scenario played live, with the same expected sounds, the caps, and the node count
back to its pre-race value after leaving.

`tests/unit/audio.test.ts` in Node: every part id and every event type resolves to recipes
that exist; the mixer arithmetic; voice stealing; the rate limiters; the gear model; haptics.

### What a listener should check first

In rough order of how little the measurements can say about them:

1. **The engines as engines.** They are additive pulse and saw stacks with an amplitude
   wobble for lumpiness. Whether a V8 reads as a V8 and not as a low buzz is entirely a
   matter for ears. They were also raised about a third of an octave so that phones can
   reproduce them, which makes them less "heavy" than Section 14.3's "roars low".
2. **Fatigue.** Engine, tire and status loops run for minutes. Their levels are measured;
   whether they grate is not.
3. **The mix under a real fight**, especially how hard the compressor pumps when explosions
   land over engines. The stress mix is deliberately brutal and its waveform is flat-topped.
4. **The music.** It is in key and in time by construction. Whether it is any good is not
   something a test can know.
5. **The shotgun against the air cannon, and the tesla arc against the saw.** They are the
   closest pairs by fingerprint.
6. **Short clicks and ticks.** Their loudness is set from a 100 ms window, so the very short
   ones (`sentry_fire`, `empty_click`, `ui_timer_tick`) carry large gains and may be sharper
   than their numbers suggest.
7. **iOS Safari and real phone speakers.** Everything was run in desktop headless Chromium.
   The unlock and interruption handling follows the documented behaviour and has never met
   an iPhone.

## Adding a sound

1. Add a recipe to `sfxRecipes.ts`: an id, a bus, a category (this decides its loudness), a
   priority, a one-line design note, one to five layers. Give repeated sounds a `limitMs`.
2. Point something at it in `soundMap.ts`: a weapon phase, a status, a utility, an event
   handler, or `UI_SOUNDS` in `AudioSystem.ts`.
3. Build, start a server, and run `BOLT_E2E_PORT=<port> npx tsx tests/audio/calibrate.ts`,
   then build again. This writes its level into `sfxTrim.ts`.
4. Run `BOLT_AUDIO_EVIDENCE=1 npx playwright test tests/e2e/audio.spec.ts -g "every recipe"`
   and look at `docs/evidence/audio/recipes/<id>.png`: is the attack, the sweep and the noise
   band what you meant?
5. `npx tsx tests/tools/syncAudioDoc.ts` to refresh the tables below, then `npx vitest run
tests/unit/audio`.

An engine is the same in `engineRecipes.ts`, keyed by the catalog `soundKey`.

## What the event stream does not carry

Things the audio had to infer, and would do better if told:

- **The source of a status.** `status` has a family and a causing car, not a weapon. Oil and
  frost both apply `grip`; which one is read off the hazards near the car.
- **The surface under the car, the track and the laps.** Not in the snapshot. The audio builds
  the track itself from the id and looks the surface up.
- **The player's own blueprint.** The snapshot carries the rival's, not the viewer's. The audio
  takes it from the store, or from the scenario named in the query string.
- **The rival's throttle and engine state.** Section 7.5 hides them, rightly. The rival's
  engine is driven from speed and the brake flag.
- **The boomerang's turn, a saw spinning between bites, a mine's own blink.** No events; the
  first is read from velocity, the others are only heard when something happens.
- **The race time limit.** So there is no "last 30 seconds" music layer.
- **Heat and battery warnings.** No events; read from the gauges, and the battery's capacity
  is unknown, so the low-power line is an absolute 12 units.
- **Burst Capacitor discharge.** No event. `capacitor_zap` plays when the player's own
  `reserve` falls by more than five in one snapshot; the rival's cannot be known.

## Parts

Every part id of the catalog, with the sound of fitting it and what it does in a race.

<!-- BEGIN AUDIO PARTS -->

| Part                                       | Install sound           | In a race                                                                 |
| :----------------------------------------- | :---------------------- | :------------------------------------------------------------------------ |
| Beetle `chassis_beetle`                    | `install_chassis_light` | `wall_thump`                                                              |
| Arrow `chassis_arrow`                      | `install_chassis_light` | `wall_thump`                                                              |
| Pickup `chassis_pickup`                    | `install_chassis_heavy` | `wall_thump_heavy`                                                        |
| Spider `chassis_spider`                    | `install_chassis_heavy` | `wall_thump_heavy`                                                        |
| Trike `chassis_trike`                      | `install_chassis_light` | `wall_thump`                                                              |
| Mini Electric `engine_mini_electric`       | `install_engine`        | engine voice `engine_electric_small`                                      |
| Four-Cylinder `engine_four_cylinder`       | `install_engine`        | engine voice `engine_inline4`                                             |
| V6 `engine_v6`                             | `install_engine`        | engine voice `engine_v6`                                                  |
| V8 `engine_v8`                             | `install_engine`        | engine voice `engine_v8`                                                  |
| V12 `engine_v12`                           | `install_engine`        | engine voice `engine_v12`                                                 |
| Small Turbo `engine_small_turbo`           | `install_engine`        | engine voice `engine_turbo_small`                                         |
| Twin Turbo `engine_twin_turbo`             | `install_engine`        | engine voice `engine_turbo_twin`                                          |
| Supercharger `engine_supercharger`         | `install_engine`        | engine voice `engine_supercharger`                                        |
| Torque Diesel `engine_diesel`              | `install_engine`        | engine voice `engine_diesel`                                              |
| Sport Electric `engine_electric_sport`     | `install_engine`        | engine voice `engine_electric_sport`                                      |
| Eco Electric `engine_electric_eco`         | `install_engine`        | engine voice `engine_electric_eco`                                        |
| Hybrid `engine_hybrid`                     | `install_engine`        | engine voice `engine_hybrid`                                              |
| Rotary `engine_rotary`                     | `install_engine`        | engine voice `engine_rotary`                                              |
| Turbine `engine_turbine`                   | `install_engine`        | engine voice `engine_turbine`                                             |
| Rocket Engine `engine_rocket`              | `install_engine`        | engine voice `engine_rocket`                                              |
| Twin Drive `engine_twin`                   | `install_engine`        | engine voice `engine_twin`                                                |
| Spring Drive `engine_spring`               | `install_engine`        | engine voice `engine_spring`                                              |
| Trail Engine `engine_offroad`              | `install_engine`        | engine voice `engine_offroad`                                             |
| Ironheart `engine_resilient`               | `install_engine`        | engine voice `engine_resilient`                                           |
| Wildcard Motor `engine_experimental`       | `install_engine`        | engine voice `engine_experimental`                                        |
| Slicks `tires_slick`                       | `install_tires_road`    | skid and rumble as `tires_road`                                           |
| Street Tires `tires_street`                | `install_tires_road`    | skid and rumble as `tires_road`                                           |
| Rain Runners `tires_rain`                  | `install_tires_road`    | skid and rumble as `tires_road`                                           |
| Sand Paddles `tires_sand`                  | `install_tires_offroad` | skid and rumble as `tires_offroad`                                        |
| Mud Claws `tires_mud`                      | `install_tires_offroad` | skid and rumble as `tires_offroad`                                        |
| Snow Treads `tires_snow`                   | `install_tires_offroad` | skid and rumble as `tires_offroad`                                        |
| Ice Spikes `tires_ice`                     | `install_tires_studded` | skid and rumble as `tires_studded`                                        |
| Soft Compound `tires_soft`                 | `install_tires_road`    | skid and rumble as `tires_road`                                           |
| Hard Compound `tires_hard`                 | `install_tires_road`    | skid and rumble as `tires_road`                                           |
| Drift Rings `tires_drift`                  | `install_tires_road`    | skid and rumble as `tires_road`                                           |
| Armored Tires `tires_armored`              | `install_tires_heavy`   | skid and rumble as `tires_heavy`                                          |
| Solid Core `tires_solid`                   | `install_tires_heavy`   | skid and rumble as `tires_heavy`                                          |
| Balloon Tires `tires_balloon`              | `install_tires_offroad` | skid and rumble as `tires_offroad`                                        |
| Monster Wheels `tires_monster`             | `install_tires_heavy`   | skid and rumble as `tires_heavy`                                          |
| Micro Wheels `tires_micro`                 | `install_tires_road`    | skid and rumble as `tires_road`                                           |
| Half Tracks `tires_halftrack`              | `install_tires_track`   | skid and rumble as `tires_track`                                          |
| Full Tracks `tires_track`                  | `install_tires_track`   | skid and rumble as `tires_track`                                          |
| Magnetic Rollers `tires_magnetic`          | `install_tires_heavy`   | skid and rumble as `tires_heavy`                                          |
| Adaptive Tires `tires_adaptive`            | `install_tires_road`    | skid and rumble as `tires_road`                                           |
| Razor Wheels `tires_blades`                | `install_tires_heavy`   | skid and rumble as `tires_heavy`                                          |
| Front Machine Gun `weapon_front_mg`        | `install_weapon`        | `mg_fire`                                                                 |
| Rear Sentry `weapon_rear_mg`               | `install_weapon`        | `sentry_fire`, `sentry_pivot`                                             |
| Swivel Turret `weapon_turret`              | `install_weapon`        | `turret_fire`, `turret_lock`                                              |
| Road Shotgun `weapon_shotgun`              | `install_weapon`        | `shotgun_fire`, `hit_pellets`                                             |
| Needle Railgun `weapon_railshot`           | `install_weapon`        | `rail_fire`, `rail_charge`, `hit_rail`                                    |
| Straight Rocket `weapon_rocket`            | `install_weapon`        | `rocket_launch`, `rocket_fly`, `explode_rocket`                           |
| Seeker Missile `weapon_homing`             | `install_weapon`        | `seeker_launch`, `seeker_fly`, `seeker_lock`, `explode_seeker`            |
| Road Mine `weapon_mine`                    | `install_weapon`        | `mine_drop`, `explode_mine`                                               |
| Oil Slick `weapon_oil`                     | `install_weapon`        | `oil_spill`                                                               |
| Sticky Foam `weapon_foam`                  | `install_weapon`        | `foam_launch`, `foam_fall`                                                |
| EMP Pulse `weapon_emp`                     | `install_weapon`        | `emp_burst`, `emp_charge`                                                 |
| Tesla Arc `weapon_tesla`                   | `install_weapon`        | `tesla_arc`                                                               |
| Flame Spitter `weapon_flame`               | `install_weapon`        | `flame_ignite`, `flame_stream`                                            |
| Frost Cannon `weapon_frost`                | `install_weapon`        | `frost_fire`, `frost_shatter`, `frost_shatter`                            |
| Crash Hammer `weapon_hammer`               | `install_weapon`        | `hammer_swing`, `hammer_draw`, `hammer_clang`                             |
| Side Saw `weapon_saw`                      | `install_weapon`        | `saw_bite`                                                                |
| Grapple Harpoon `weapon_harpoon`           | `install_weapon`        | `harpoon_fire`                                                            |
| Air Cannon `weapon_air`                    | `install_weapon`        | `air_blast`                                                               |
| Steel Boomerang `weapon_boomerang`         | `install_weapon`        | `boomerang_throw`, `boomerang_spin`, `boomerang_slash`, `boomerang_catch` |
| Arc Mortar `weapon_mortar`                 | `install_weapon`        | `mortar_launch`, `mortar_lock`, `mortar_whistle`, `explode_mortar`        |
| Light Plates `defense_light_plate`         | `install_plate`         | passive: no sound of its own                                              |
| Heavy Plating `defense_heavy_plate`        | `install_plate`         | passive: no sound of its own                                              |
| Crash Bumper `defense_front_bumper`        | `install_plate`         | passive: no sound of its own                                              |
| Rear Guard `defense_rear_bumper`           | `install_plate`         | passive: no sound of its own                                              |
| Side Shields `defense_side_panels`         | `install_plate`         | passive: no sound of its own                                              |
| Wheel Cage `defense_wheel_cage`            | `install_plate`         | passive: no sound of its own                                              |
| Engine Shell `defense_engine_case`         | `install_plate`         | passive: no sound of its own                                              |
| Ceramic Panels `defense_ceramic`           | `install_plate`         | passive: no sound of its own                                              |
| Breakaway Armor `defense_breakaway`        | `install_plate`         | `armor_break`                                                             |
| Composite Shell `defense_composite`        | `install_plate`         | passive: no sound of its own                                              |
| Energy Shield `defense_energy_shield`      | `install_shield`        | `shield_up`, `shield_down`                                                |
| Faraday Cage `defense_faraday`             | `install_system`        | passive: no sound of its own                                              |
| Heat Guard `defense_heatguard`             | `install_system`        | passive: no sound of its own                                              |
| Missile Interceptor `defense_antimissile`  | `install_interceptor`   | `interceptor_fire`, `intercept_pop`                                       |
| Mine Sweeper `defense_minesweeper`         | `install_system`        | `sweeper_zap`, `trap_cleared`                                             |
| Fireproof Lining `defense_fireproof`       | `install_system`        | passive: no sound of its own                                              |
| Grip Coating `defense_oilproof`            | `install_system`        | passive: no sound of its own                                              |
| Shock Dampers `defense_damper`             | `install_system`        | passive: no sound of its own                                              |
| Steering Stabilizer `defense_steer_assist` | `install_system`        | passive: no sound of its own                                              |
| Reactive Foam `defense_reactive`           | `install_plate`         | `reactive_puff`                                                           |
| Spare Wheel `utility_spare`                | `install_repair`        | `spare_start`, `spare_done`, `repair_work`, `part_repaired`               |
| Repair Kit `utility_repair`                | `install_repair`        | `repair_start`, `repair_done`, `repair_work`, `part_repaired`             |
| Cooling Fan `utility_fan`                  | `install_fan`           | passive: no sound of its own                                              |
| Racing Radiator `utility_radiator`         | `install_fan`           | passive: no sound of its own                                              |
| Extra Battery `utility_battery`            | `install_power`         | passive: no sound of its own                                              |
| Auxiliary Generator `utility_generator`    | `install_power`         | passive: no sound of its own                                              |
| Burst Capacitor `utility_capacitor`        | `install_power`         | `capacitor_zap`                                                           |
| Nitro Tank `utility_nitro`                 | `install_nitro`         | `nitro_kick`, `boost_loop`                                                |
| Emergency Booster `utility_overdrive`      | `install_nitro`         | `booster_kick`, `boost_loop`                                              |
| Traction Computer `utility_traction`       | `install_computer`      | passive: no sound of its own                                              |
| Gyro Stabilizer `utility_gyro`             | `install_computer`      | passive: no sound of its own                                              |
| Radar `utility_radar`                      | `install_computer`      | `warn_missile`                                                            |
| Mine Detector `utility_minesensor`         | `install_computer`      | `warn_trap`                                                               |
| Decoy Drone `utility_decoy`                | `install_computer`      | `decoy_launch`, `decoy_hum`                                               |
| Jump Pad `utility_jump`                    | `install_servo`         | `jump_launch`, `jump_land`                                                |
| Recovery Winch `utility_winch`             | `install_servo`         | `winch_pull`                                                              |
| Sliding Ballast `utility_ballast`          | `install_servo`         | passive: no sound of its own                                              |
| Active Wing `utility_spoiler`              | `install_servo`         | passive: no sound of its own                                              |
| Turret Computer `utility_targeting`        | `install_computer`      | passive: no sound of its own                                              |
| Solar Panel `utility_solar`                | `install_power`         | passive: no sound of its own                                              |

<!-- END AUDIO PARTS -->

## Every recipe

<!-- BEGIN AUDIO RECIPES -->

| Sound                   | Bus      | Category     | Priority | Length | Limits                   | Design intent                                                                                |
| :---------------------- | :------- | :----------- | -------: | :----- | :----------------------- | :------------------------------------------------------------------------------------------- |
| `ui_tap`                | ui       | ui           |       30 | 0.06 s | 40 ms apart              | Button press: one soft high pulse blip.                                                      |
| `ui_select`             | ui       | ui           |       30 | 0.10 s | 40 ms apart              | Choosing an item in a list: a blip that steps up a fifth.                                    |
| `ui_confirm`            | ui       | ui           |       40 | 0.21 s | -                        | Confirm: a bright major third going up, two notes.                                           |
| `ui_back`               | ui       | ui           |       30 | 0.14 s | -                        | Back or cancel: the confirm in reverse, falling, softer.                                     |
| `ui_deny`               | ui       | ui           |       45 | 0.17 s | 150 ms apart             | Not allowed: a low double buzz, clearly different from a tap.                                |
| `ui_illegal`            | ui       | ui           |       45 | 0.17 s | 150 ms apart             | Illegal placement in the garage: a rubbery downward bonk.                                    |
| `ui_toggle_on`          | ui       | ui           |       30 | 0.11 s | -                        | Switch on: a short step up.                                                                  |
| `ui_toggle_off`         | ui       | ui           |       30 | 0.11 s | -                        | Switch off: a short step down.                                                               |
| `ui_slider`             | ui       | ui           |       20 | 0.04 s | 70 ms apart              | Slider tick: the quietest click in the game.                                                 |
| `ui_open`               | ui       | ui           |       30 | 0.14 s | -                        | Overlay opens: a quick rising sweep.                                                         |
| `ui_close`              | ui       | ui           |       30 | 0.14 s | -                        | Overlay closes: a quick falling sweep.                                                       |
| `ui_remove`             | ui       | ui           |       35 | 0.12 s | -                        | Part removed: a hollow unscrewing pop, pitch dropping.                                       |
| `ui_rotate`             | ui       | ui           |       30 | 0.08 s | 60 ms apart              | Part turned a quarter: two dry ratchet clicks.                                               |
| `ui_ready`              | ui       | stinger      |       60 | 0.61 s | -                        | Ready: a four-note rising fanfare with a held top note.                                      |
| `ui_timer_tick`         | ui       | ui           |       50 | 0.06 s | -                        | Build clock, last ten seconds: one woodblock tick a second.                                  |
| `ui_timer_urgent`       | ui       | race         |       55 | 0.14 s | -                        | Build clock, last three seconds: a higher, doubled tick.                                     |
| `ui_timer_end`          | ui       | race         |       60 | 0.51 s | -                        | Build clock ran out: a long flat buzzer.                                                     |
| `ui_save`               | ui       | ui           |       40 | 0.35 s | -                        | Blueprint saved: two glassy bell notes.                                                      |
| `ui_error`              | ui       | ui           |       50 | 0.37 s | -                        | Something failed (connection, load): three falling minor notes.                              |
| `install_chassis_light` | ui       | install      |       40 | 0.17 s | -                        | Light chassis set down: a thin panel clap and a short ring.                                  |
| `install_chassis_heavy` | ui       | install      |       40 | 0.29 s | -                        | Heavy chassis set down: a low slam with a slow settle.                                       |
| `install_tires_road`    | ui       | install      |       40 | 0.23 s | -                        | Road tires on: a rubber squeak then a wheel-nut zip.                                         |
| `install_tires_offroad` | ui       | install      |       40 | 0.23 s | -                        | Knobbly tires on: a lower, grittier zip with a thud.                                         |
| `install_tires_studded` | ui       | install      |       40 | 0.23 s | -                        | Studded tires on: a zip with small metal ticks in it.                                        |
| `install_tires_heavy`   | ui       | install      |       40 | 0.33 s | -                        | Heavy tires on: a deep double thump and a slow zip.                                          |
| `install_tires_track`   | ui       | install      |       40 | 0.24 s | -                        | Tracks on: a rolling clatter of links.                                                       |
| `install_engine`        | ui       | install      |       40 | 0.12 s | -                        | Engine dropped in: a block clunk, then the engine itself barks once.                         |
| `install_weapon`        | ui       | install      |       40 | 0.16 s | -                        | Weapon mounted: a bolt slide and a latch, like racking a slide.                              |
| `install_plate`         | ui       | install      |       40 | 0.23 s | -                        | Armor plate bolted on: a plate clank with an anvil ring.                                     |
| `install_shield`        | ui       | install      |       40 | 0.31 s | -                        | Shield emitter fitted: a soft rising shimmer.                                                |
| `install_system`        | ui       | install      |       40 | 0.21 s | -                        | Passive defense system fitted: a relay click and a confirm tone.                             |
| `install_interceptor`   | ui       | install      |       40 | 0.33 s | -                        | Interceptor fitted: a servo chirp and a radar ping.                                          |
| `install_repair`        | ui       | install      |       40 | 0.21 s | -                        | Repair gear stowed: a toolbox rattle and a ratchet.                                          |
| `install_nitro`         | ui       | install      |       40 | 0.25 s | -                        | Boost tank fitted: a valve hiss that rises in pitch.                                         |
| `install_fan`           | ui       | install      |       40 | 0.33 s | -                        | Cooling part fitted: a small fan spinning up.                                                |
| `install_power`         | ui       | install      |       40 | 0.26 s | -                        | Electrical part fitted: a capacitor charging hum that clicks in.                             |
| `install_computer`      | ui       | install      |       40 | 0.21 s | -                        | Computer or sensor fitted: a burst of data blips.                                            |
| `install_servo`         | ui       | install      |       40 | 0.23 s | -                        | Moving part fitted: a servo travelling and stopping.                                         |
| `race_count`            | ui       | race         |       80 | 0.17 s | -                        | Countdown light: a short square beep at A4.                                                  |
| `race_go`               | ui       | stinger      |       90 | 0.56 s | -                        | GO: the same beep an octave up, held, with a rising tail.                                    |
| `checkpoint_tick`       | ui       | ui           |       15 | 0.05 s | 200 ms apart             | Checkpoint crossed: a faint high tick, barely there.                                         |
| `lap_chime`             | ui       | race         |       70 | 0.37 s | -                        | Lap completed: a three-note major arpeggio.                                                  |
| `final_lap`             | ui       | stinger      |       85 | 0.76 s | -                        | Final lap: an urgent repeated fanfare figure.                                                |
| `pos_gain`              | ui       | race         |       65 | 0.27 s | 500 ms apart             | Took the lead: a fast run up an octave.                                                      |
| `pos_loss`              | ui       | race         |       65 | 0.29 s | 500 ms apart             | Lost the lead: the same run falling, into a minor third.                                     |
| `finish_line`           | ui       | race         |       80 | 0.41 s | -                        | Crossed the line: a flag flourish, quick up-and-over.                                        |
| `stinger_win`           | ui       | stinger      |       95 | 1.71 s | ducks 0.8                | You won: a triumphant rising phrase resolving on a long major chord.                         |
| `stinger_lose`          | ui       | stinger      |       95 | 1.41 s | ducks 0.8                | You lost: a slow falling minor phrase that sags at the end.                                  |
| `stinger_draw`          | ui       | stinger      |       95 | 1.01 s | ducks 0.8                | A draw: a level, unresolved phrase that neither rises nor falls.                             |
| `warn_lock`             | alerts   | alert        |      100 | loop   | 1 at once                | A rival weapon has a lock: a steady two-tone beep, about three a second.                     |
| `warn_missile`          | alerts   | alert        |      100 | loop   | 1 at once, ducks 0.5     | Guided missile inbound: the lock tone a fourth up and three times as fast.                   |
| `warn_clear`            | alerts   | alert        |       60 | 0.19 s | -                        | Lock lost or missile gone: one soft falling note of relief.                                  |
| `warn_trap`             | alerts   | alert        |       90 | 0.47 s | 400 ms apart             | Mine Detector: a sonar ping with a long tail.                                                |
| `warn_heat`             | alerts   | alert        |       85 | 0.27 s | 2500 ms apart            | Running hot: two rising steam-whistle notes.                                                 |
| `warn_overheat`         | alerts   | alert        |       95 | 0.44 s | 2500 ms apart, ducks 0.4 | Thermal protection cut in: a klaxon, three harsh pulses.                                     |
| `warn_low_power`        | alerts   | alert        |       85 | 0.49 s | 2500 ms apart            | Battery nearly flat: a drooping three-note run-down.                                         |
| `part_critical`         | alerts   | alert        |       90 | 0.24 s | 600 ms apart             | A component of your car is critical: a low double alarm.                                     |
| `mg_fire`               | weapons  | fire_small   |       50 | 0.07 s | 60 ms apart, 3 at once   | Front Machine Gun round: a rapid dry staccato crack, low and boxy.                           |
| `sentry_pivot`          | weapons  | mech         |       40 | 0.26 s | 300 ms apart             | Rear Sentry turning to its target: a stepped servo climb.                                    |
| `sentry_fire`           | weapons  | fire_small   |       50 | 0.05 s | 60 ms apart, 3 at once   | Rear Sentry round: thinner and higher than the front gun, a tinny snap.                      |
| `turret_lock`           | weapons  | mech         |       45 | 0.13 s | 300 ms apart             | Swivel Turret aim tick: one hard red tick after a short traverse whirr.                      |
| `turret_fire`           | weapons  | fire_small   |       55 | 0.11 s | 70 ms apart, 3 at once   | Swivel Turret round: a heavier, slower thock with a barrel kick under it.                    |
| `shotgun_fire`          | weapons  | fire_big     |       70 | 0.35 s | 200 ms apart, ducks 0.5  | Road Shotgun: one huge wide boom with a hard crack on top and a rattling pellet tail.        |
| `rail_charge`           | weapons  | mech         |       60 | 0.81 s | -                        | Needle Railgun charging: six rising stages, each brighter, over 0.8 s.                       |
| `rail_fire`             | weapons  | fire_big     |       80 | 0.31 s | ducks 0.5                | Needle Railgun shot: a razor-thin cyan zap falling four octaves in an instant.               |
| `rocket_launch`         | weapons  | fire_big     |       70 | 0.41 s | -                        | Straight Rocket leaving the rail: a breathy whoosh that opens upward.                        |
| `rocket_fly`            | ambience | travel       |       45 | loop   | 3 at once                | Straight Rocket in flight: a flickering flame roar, low and unsteady.                        |
| `seeker_lock`           | weapons  | mech         |       55 | 0.25 s | 300 ms apart             | Seeker Missile lock: the two-beep cue, second beep higher.                                   |
| `seeker_launch`         | weapons  | fire_big     |       70 | 0.31 s | -                        | Seeker Missile launch: a thinner hiss with a rising electronic chirp on top.                 |
| `seeker_fly`            | ambience | travel       |       50 | loop   | 3 at once                | Seeker Missile hunting: a warbling whine that wavers as it swerves.                          |
| `mine_drop`             | weapons  | mech         |       50 | 0.17 s | -                        | Road Mine hatch: a spring pop and the mine clattering onto the road.                         |
| `mine_blink`            | weapons  | mech         |       40 | 0.50 s | 100 ms apart, 2 at once  | Mine arming: three amber blips speeding up while it arms.                                    |
| `mine_armed`            | weapons  | mech         |       45 | 0.14 s | 100 ms apart             | Mine live: one higher, longer confirming tone.                                               |
| `oil_spill`             | weapons  | fire_small   |       50 | 0.51 s | -                        | Oil Slick: a thick slosh and glug, dark and wobbling, with no crack in it.                   |
| `foam_launch`           | weapons  | fire_small   |       50 | 0.21 s | -                        | Sticky Foam: a wet, pressurised pfft with bubbles in it.                                     |
| `foam_fall`             | weapons  | mech         |       30 | 0.51 s | -                        | Foam pellets in the air: a soft falling whistle, half a second.                              |
| `foam_splat`            | impacts  | impact       |       55 | 0.29 s | -                        | Foam landing: an elastic splat that boings and peels.                                        |
| `emp_charge`            | weapons  | mech         |       60 | 0.61 s | -                        | EMP Pulse charging: a low synthesized whine climbing in four steps.                          |
| `emp_burst`             | weapons  | fire_big     |       85 | 0.51 s | ducks 0.7                | EMP ring: a wide downward electronic sweep with a bit-crushed crackle and no bang.           |
| `tesla_arc`             | weapons  | fire_small   |       65 | 0.27 s | 150 ms apart             | Tesla Arc: a snapping, buzzing crackle, irregular like real arcing.                          |
| `flame_ignite`          | weapons  | fire_small   |       55 | 0.26 s | 200 ms apart             | Flame Spitter lighting: a gas whoomp.                                                        |
| `flame_stream`          | ambience | travel       |       55 | loop   | 2 at once                | Flame Spitter jets: a staccato roar, the flame chopped about twelve times a second.          |
| `frost_fire`            | weapons  | fire_small   |       55 | 0.25 s | -                        | Frost Cannon: a glassy bell thump with an icy breath after it.                               |
| `frost_shatter`         | impacts  | impact       |       60 | 0.33 s | 80 ms apart              | Frost shell bursting: a crystalline shatter, falling glass bells.                            |
| `hammer_draw`           | weapons  | mech         |       55 | 0.28 s | -                        | Crash Hammer drawing back: a spring ratchet tightening, clicks closing up.                   |
| `hammer_swing`          | weapons  | fire_small   |       60 | 0.13 s | -                        | Crash Hammer swinging: a short heavy whoosh.                                                 |
| `hammer_clang`          | impacts  | explosion    |       85 | 0.61 s | ducks 0.7                | Crash Hammer landing: an oversized anvil clang that rings for half a second.                 |
| `saw_bite`              | weapons  | fire_small   |       55 | 0.31 s | 150 ms apart             | Side Saw biting: a rasping, grinding buzz with metal scraping in it.                         |
| `harpoon_fire`          | weapons  | fire_small   |       60 | 0.21 s | -                        | Grapple Harpoon: a pneumatic thwip with the cable spool zipping out.                         |
| `harpoon_hook`          | impacts  | impact       |       65 | 0.31 s | -                        | Harpoon catching: a clank, then the line creaking taut.                                      |
| `tether_tension`        | ambience | travel       |       50 | loop   | 1 at once                | Harpoon line under load: a low bowed-cable drone that wavers.                                |
| `harpoon_release`       | weapons  | mech         |       50 | 0.27 s | -                        | Harpoon line letting go: a slack twang falling away.                                         |
| `air_blast`             | weapons  | fire_big     |       70 | 0.61 s | ducks 0.4                | Air Cannon: a hollow whump of pressure that swells and blows past, all air and no crack.     |
| `boomerang_throw`       | weapons  | fire_small   |       55 | 0.17 s | -                        | Steel Boomerang thrown: a sharp metal sling and a swish.                                     |
| `boomerang_spin`        | ambience | travel       |       50 | loop   | 2 at once                | Steel Boomerang spinning: a whup-whup-whup, nine beats a second, with a steel edge.          |
| `boomerang_slash`       | impacts  | impact       |       60 | 0.17 s | 80 ms apart              | Boomerang glancing off: a bright steel slash and a ricochet tick.                            |
| `boomerang_catch`       | weapons  | mech         |       50 | 0.13 s | -                        | Boomerang caught: a snap into the cradle and two settling ticks.                             |
| `mortar_lock`           | weapons  | mech         |       55 | 0.38 s | 300 ms apart             | Arc Mortar ranging: the barrel grinding up, then a low tick.                                 |
| `mortar_launch`         | weapons  | fire_big     |       75 | 0.31 s | ducks 0.4                | Arc Mortar firing: a deep hollow tube thoomp.                                                |
| `mortar_whistle`        | weapons  | mech         |       70 | 1.41 s | 2 at once                | Mortar shell coming down: a whistle falling for the whole 1.4 s, louder as it nears.         |
| `lock_lost`             | weapons  | mech         |       25 | 0.07 s | 300 ms apart             | One of your weapons lost its target: a tiny falling blip.                                    |
| `misfire`               | weapons  | mech         |       50 | 0.17 s | 200 ms apart             | A damaged weapon failing: a dud click and a sputter.                                         |
| `empty_click`           | weapons  | mech         |       40 | 0.03 s | 200 ms apart             | Out of ammunition: a dry hammer click on nothing.                                            |
| `refuse_tick`           | weapons  | mech         |       20 | 0.04 s | 250 ms apart             | Still cooling down or no target: the softest possible tick.                                  |
| `explode_rocket`        | impacts  | explosion    |       90 | 0.61 s | 2 at once, ducks 1       | Rocket blast: four layers, a crack, a fireball roar, a falling boom and shrapnel.            |
| `explode_seeker`        | impacts  | explosion    |       90 | 0.33 s | 2 at once, ducks 0.9     | Seeker bloom: tighter and brighter than the rocket, a snap and a short ringing burst.        |
| `explode_mine`          | impacts  | explosion    |       90 | 0.46 s | 2 at once, ducks 0.9     | Mine going off: a low dull thump from under the car, more dirt than fire.                    |
| `explode_mortar`        | impacts  | explosion    |       95 | 1.11 s | 1 at once, ducks 1       | Mortar burst: the biggest sound in the game, a tall crack, a long rumble and falling debris. |
| `ko_blast`              | impacts  | explosion    |      100 | 1.21 s | ducks 1                  | Knockout: an explosion that sags into a long power-down.                                     |
| `hit_shield`            | impacts  | impact       |       70 | 0.25 s | 70 ms apart              | Hit on an energy shield: a bright electric splash that rings up, never metallic.             |
| `hit_armor`             | impacts  | impact       |       65 | 0.17 s | 60 ms apart              | Hit on armor plate: a hard, high ping, the bullet bouncing off.                              |
| `hit_body`              | impacts  | impact       |       60 | 0.10 s | 60 ms apart              | Hit on bare bodywork: a dull, boxy thud with no ring.                                        |
| `hit_wheel`             | impacts  | impact       |       70 | 0.33 s | 70 ms apart              | Hit on a wheel: a rubber thunk and the rim ringing like a small bell.                        |
| `hit_engine`            | impacts  | impact       |       75 | 0.37 s | 70 ms apart              | Hit on the engine: an iron knock, then a hiss of escaping pressure.                          |
| `hit_steering`          | impacts  | impact       |       70 | 0.31 s | 70 ms apart              | Hit on the steering: a hollow clonk and a bent-rod twang.                                    |
| `hit_module`            | impacts  | impact       |       70 | 0.11 s | 70 ms apart              | Hit on a mounted part: a crunch with a digital glitch, electronics taking damage.            |
| `hit_pellets`           | impacts  | impact       |       60 | 0.15 s | 120 ms apart             | Shotgun pellets landing: a fan of five quick separate ticks, not one hit.                    |
| `hit_rail`              | impacts  | impact       |       80 | 0.24 s | -                        | Railgun slug going through: a needle-thin slash and a square pulse behind it.                |
| `impact_heavy`          | impacts  | impact       |       80 | 0.27 s | 90 ms apart, ducks 0.6   | Under any heavy hit: a sub drop that gives it weight.                                        |
| `ram_crunch`            | impacts  | impact       |       75 | 0.21 s | 120 ms apart, ducks 0.4  | Car against car: a crunch of bodywork with a low shove.                                      |
| `wall_thump`            | impacts  | impact       |       60 | 0.15 s | 120 ms apart             | Light chassis against a wall: a filtered thud and a panel rattle.                            |
| `wall_thump_heavy`      | impacts  | impact       |       60 | 0.21 s | 120 ms apart             | Heavy chassis against a wall: lower and longer, more mass in it.                             |
| `ricochet`              | impacts  | impact_small |       25 | 0.14 s | 90 ms apart, 2 at once   | A bullet hitting a wall: a small whining ricochet.                                           |
| `burn_tick`             | impacts  | impact_small |       30 | 0.10 s | 150 ms apart, 2 at once  | A burn pulse: a small sizzle spit.                                                           |
| `shove`                 | impacts  | impact       |       55 | 0.21 s | 200 ms apart             | The car being thrown sideways: a suspension whump and a tire chirp.                          |
| `splash`                | impacts  | impact_small |       35 | 0.15 s | 200 ms apart             | Tires through oil or foam: a wet slap.                                                       |
| `proj_fizzle`           | impacts  | impact_small |       20 | 0.12 s | 100 ms apart, 2 at once  | A projectile running out of range: a short fading fizz.                                      |
| `proj_thud`             | impacts  | impact_small |       30 | 0.08 s | 80 ms apart, 2 at once   | A projectile burying itself in the ground or a wall: a small dirt thud.                      |
| `shield_up`             | weapons  | utility      |       60 | 0.41 s | -                        | Energy Shield back up: a rising shimmer that locks on a clear note.                          |
| `shield_down`           | impacts  | impact       |       75 | 0.35 s | -                        | Energy Shield collapsing: the shimmer falling apart downward with a crackle.                 |
| `armor_break`           | impacts  | impact       |       80 | 0.47 s | -                        | Breakaway Armor going: a plate cracking off and clattering down the road.                    |
| `reactive_puff`         | impacts  | impact       |       60 | 0.21 s | -                        | Reactive Foam firing: a muffled airbag pop that swallows the hit.                            |
| `interceptor_fire`      | weapons  | fire_small   |       75 | 0.10 s | -                        | Missile Interceptor: a very fast upward laser chirp.                                         |
| `intercept_pop`         | impacts  | impact       |       70 | 0.11 s | -                        | A missile shot down: a small bright airburst.                                                |
| `sweeper_zap`           | weapons  | fire_small   |       70 | 0.12 s | -                        | Mine Sweeper: a low electric zot aimed at the ground.                                        |
| `trap_cleared`          | impacts  | impact       |       60 | 0.25 s | -                        | A trap cleared: a fizzing pop and a small safe-now chirp.                                    |
| `status_blocked`        | impacts  | impact_small |       35 | 0.06 s | 200 ms apart             | A disable refused by immunity: a short deflecting tick.                                      |
| `status_slow`           | ambience | status       |       50 | 0.31 s | 250 ms apart             | Caught in foam or shaken by a mine: a gluey, sucking squelch.                                |
| `oil_slip`              | ambience | status       |       50 | loop   | 2 at once                | Sliding on oil: a greasy, wavering tire squeal with a wet hiss under it.                     |
| `frost_crackle`         | ambience | status       |       50 | loop   | 2 at once                | Frozen: thin ice crackling and tinkling over the wheels.                                     |
| `status_burn`           | ambience | status       |       55 | loop   | 2 at once                | On fire: a crackling, spitting burn on the bodywork.                                         |
| `status_emp`            | ambience | status       |       60 | loop   | 2 at once                | Electronics down: a dead buzz that stutters in and out.                                      |
| `status_jam`            | ambience | status       |       55 | loop   | 2 at once                | Weapons jammed by the arc: a quick ticking static.                                           |
| `boost_loop`            | ambience | status       |       60 | loop   | 2 at once                | Nitro or booster burning: a hard jet hiss with a rising edge.                                |
| `repair_work`           | ambience | status       |       55 | loop   | 2 at once                | A repair under way: an impact wrench rattling in bursts.                                     |
| `fire_area`             | ambience | status       |       40 | loop   | 1 at once                | Burning oil on the road: a broad, low fire with slow licks.                                  |
| `fire_ignite`           | impacts  | impact       |       65 | 0.51 s | -                        | Oil catching fire: a rolling whoomp along the strip.                                         |
| `frost_melt`            | impacts  | impact       |       50 | 0.61 s | -                        | Frost melted by flame: a long steam sizzle.                                                  |
| `decoy_hum`             | ambience | status       |       40 | loop   | 1 at once                | Decoy Drone hovering: a small rotor buzz that chirps.                                        |
| `part_damaged`          | impacts  | impact       |       55 | 0.16 s | 200 ms apart             | A component dropping to damaged: a crack and a loose rattle.                                 |
| `part_destroyed`        | impacts  | impact       |       85 | 0.41 s | 200 ms apart, ducks 0.5  | A component destroyed: a crunch, then a falling power-down arpeggio.                         |
| `part_repaired`         | weapons  | utility      |       65 | 0.36 s | 200 ms apart             | A component back in service: a bright rising arpeggio with a sparkle.                        |
| `spare_start`           | weapons  | utility      |       60 | 0.29 s | -                        | Spare Wheel going on: a jack clunk and the first wrench zip.                                 |
| `spare_done`            | weapons  | utility      |       65 | 0.29 s | -                        | Spare Wheel fitted: the wheel dropping and a nut pinging tight.                              |
| `repair_start`          | weapons  | utility      |       60 | 0.35 s | -                        | Repair Kit opened: a ratchet run and a welding fizz.                                         |
| `repair_done`           | weapons  | utility      |       65 | 0.25 s | -                        | Repair finished: a toolbox snap and two confirming notes.                                    |
| `nitro_kick`            | weapons  | utility      |       70 | 0.41 s | ducks 0.3                | Nitro Tank opening: a valve crack and a hiss that screams upward.                            |
| `booster_kick`          | weapons  | utility      |       70 | 0.46 s | ducks 0.3                | Emergency Booster: an angry mechanical growl winding up, rougher than nitro.                 |
| `decoy_launch`          | weapons  | utility      |       60 | 0.33 s | -                        | Decoy Drone away: a spring launch and a cheeky warble.                                       |
| `jump_launch`           | weapons  | utility      |       65 | 0.21 s | -                        | Jump Pad firing: a spring boing sweeping up fast.                                            |
| `jump_land`             | impacts  | impact       |       60 | 0.17 s | -                        | Landing from a jump: a suspension slam and a tire slap.                                      |
| `winch_pull`            | weapons  | utility      |       60 | 0.59 s | -                        | Recovery Winch hauling: a motor whirr with a cable ratchet over it.                          |
| `capacitor_zap`         | weapons  | utility      |       60 | 0.13 s | 200 ms apart             | Burst Capacitor dumping: a short fat discharge snap.                                         |
| `utility_interrupted`   | weapons  | utility      |       55 | 0.31 s | -                        | A repair or utility cut short: two falling, deflating notes.                                 |
| `turbo_blowoff`         | engine   | mech         |       40 | 0.25 s | 700 ms apart, 1 at once  | Turbo blow-off on lifting the throttle: a quick fluttering pshh.                             |
| `spring_release`        | engine   | mech         |       45 | 0.31 s | 1500 ms apart, 1 at once | Spring Drive letting its stored launch go: a big sproing.                                    |
| `rocket_pulse`          | engine   | mech         |       45 | 0.31 s | 500 ms apart, 1 at once  | Rocket Engine lighting a fuel pulse: a deep cough of flame.                                  |

<!-- END AUDIO RECIPES -->
