import type {
  QuarterTurn,
  RaceBrain,
  RaceEntry,
  RaceSession,
  ScenarioCar,
  ScenarioDefinition,
  ScenarioStep,
  TrackRuntime,
  VehicleBlueprint,
} from '@bolt/shared';
import { ScenarioBrain, applyScenario, createRace } from '@bolt/shared';
import { CATALOG } from './catalog.js';
import { conditionsFor, environmentFor } from './loadout.js';
import { raceEntry } from './rivals.js';
import type { PartSpec } from './templates.js';
import { build, getTemplate } from './templates.js';

/**
 * Showcase scenarios for Milestone C (Sections 13.3, 13.4 and 19.4): the four major effect
 * examples, a repair, the weather and element interactions, the countermeasures, and one
 * scenario for each of the twenty weapons. Every car in every scenario is a legal blueprint
 * under 1,000 credits. docs/COMBAT_API.md lists them with what each one shows.
 *
 * Run one from the command line with `npx tsx tests/scenarios/run.ts <id>`, or in the client
 * with `?debug=1&scenario=<id>`.
 */

const TRACK = 'city_01';
const CLEAR = 'city_clear_night';
const RAIN = 'city_rain_night';
/** Ticks on the grid before GO: one second, enough to see who is where. */
const COUNTDOWN = 30;
/** Speed both cars hold along the Harbor Straight, world px/s: slow enough to watch. */
const CRUISE = 110;

/** A Beetle on stock essentials with the parts given: the scenario bench. */
function beetle(name: string, parts: PartSpec[]): VehicleBlueprint {
  return build(
    name,
    'chassis_beetle',
    'engine_four_cylinder',
    'tires_street',
    'paint_cobalt',
    parts,
  );
}

/** The car being shot at: a plain Beetle in another paint, optionally with equipment. */
function dummy(parts: PartSpec[] = [], name = 'Target'): VehicleBlueprint {
  return build(
    name,
    'chassis_beetle',
    'engine_four_cylinder',
    'tires_street',
    'paint_sunflare',
    parts,
  );
}

function car(
  blueprint: VehicleBlueprint,
  s: number,
  lane: number,
  steps: ScenarioStep[] = [],
  extra: Partial<ScenarioCar> = {},
): ScenarioCar {
  return { blueprint, s, lane, speed: CRUISE, steps, ...extra };
}

/** Holds a fire button from one tick to another. */
function hold(from: number, to: number, fire = 1): ScenarioStep {
  return { from, to, fire };
}

type WeaponCase = {
  weapon: string;
  title: string;
  description: string;
  shows: string;
  /** The attacker's weapon mount and facing. */
  mount: string;
  turn?: QuarterTurn;
  chassis?: 'beetle' | 'spider' | 'pickup';
  /** Where the target starts relative to the attacker: ahead along the road, and to its right. */
  ahead: number;
  aside?: number;
  /** When the fire button is held, in race ticks. Omitted for automatic weapons. */
  fire?: [number, number];
  duration: number;
  weather?: string;
  expect: ScenarioDefinition['expect'];
};

const WEAPON_CASES: WeaponCase[] = [
  {
    weapon: 'weapon_front_mg',
    title: 'Front Machine Gun',
    description: 'The attacker closes on a car ahead and fires one five-round burst into its tail.',
    shows:
      'Five alternating muzzle flashes over 0.4 s, five tracers, five small kinetic impacts on the rear.',
    mount: 'front_center',
    ahead: 110,
    fire: [45, 46],
    duration: 120,
    expect: [
      { type: 'shot', weapon: 'weapon_front_mg' },
      { type: 'hit', weapon: 'weapon_front_mg', car: 1 },
    ],
  },
  {
    weapon: 'weapon_rear_mg',
    title: 'Rear Sentry',
    description:
      "A car follows the attacker inside the sentry's rear arc. The sentry pivots, then fires a four-round burst by itself.",
    shows:
      "Acquisition wind-up (the pivot), four rear-facing shots, impacts on the follower's nose.",
    mount: 'rear_center',
    turn: 2,
    ahead: -110,
    duration: 150,
    expect: [
      { type: 'windup', weapon: 'weapon_rear_mg' },
      { type: 'shot', weapon: 'weapon_rear_mg' },
      { type: 'hit', weapon: 'weapon_rear_mg', car: 1 },
    ],
  },
  {
    weapon: 'weapon_turret',
    title: 'Swivel Turret',
    description:
      'The target runs ahead and to the right. The turret traverses onto it, locks, and fires a three-round burst.',
    shows:
      "Visible traverse at 120 degrees a second, the lock tick, three shots along the turret's own aim.",
    mount: 'roof_mid',
    ahead: 70,
    aside: 46,
    fire: [20, 110],
    duration: 150,
    expect: [
      { type: 'lock', weapon: 'weapon_turret' },
      { type: 'shot', weapon: 'weapon_turret' },
      { type: 'hit', weapon: 'weapon_turret', car: 1 },
    ],
  },
  {
    weapon: 'weapon_shotgun',
    title: 'Road Shotgun',
    description:
      'At close range the attacker fires eight pellets in a 40-degree fan into the car ahead.',
    shows: 'One large muzzle flash, eight pellets with short trails, several separate impacts.',
    mount: 'front_center',
    ahead: 62,
    fire: [45, 46],
    duration: 120,
    expect: [
      { type: 'shot', weapon: 'weapon_shotgun' },
      { type: 'hit', weapon: 'weapon_shotgun', car: 1 },
    ],
  },
  {
    weapon: 'weapon_railshot',
    title: 'Needle Railgun',
    description:
      'The attacker starts a 0.8-second charge with the target far ahead, then the slug crosses the gap in one tick.',
    shows:
      'Six-stage barrel charge, a thin instant beam, a slash on the struck panel; the hit carries into a second module.',
    mount: 'front_center',
    ahead: 220,
    fire: [40, 41],
    duration: 130,
    expect: [
      { type: 'windup', weapon: 'weapon_railshot' },
      { type: 'beam', weapon: 'weapon_railshot' },
      { type: 'hit', weapon: 'weapon_railshot', car: 1 },
    ],
  },
  {
    weapon: 'weapon_rocket',
    title: 'Straight Rocket',
    description: 'A rocket leaves the nose, flies dead straight and bursts on the car ahead.',
    shows:
      'Launch, a rocket in flight for about a third of a second, the direct hit and its explosion.',
    mount: 'front_center',
    ahead: 140,
    fire: [45, 46],
    duration: 130,
    expect: [
      { type: 'shot', weapon: 'weapon_rocket' },
      { type: 'hit', weapon: 'weapon_rocket', car: 1 },
      { type: 'explosion', weapon: 'weapon_rocket' },
    ],
  },
  {
    weapon: 'weapon_homing',
    title: 'Seeker Missile',
    description:
      'The seeker holds the target in view for 0.6 s to lock, fires, and the missile curves onto a car in the next lane.',
    shows:
      "Lock brackets on the target, the target's lock warning, a swerving missile, the incoming warning half a second out, the bloom.",
    mount: 'roof_mid',
    ahead: 150,
    aside: 44,
    fire: [30, 120],
    duration: 170,
    expect: [
      { type: 'lock', weapon: 'weapon_homing' },
      { type: 'warning', car: 1 },
      { type: 'shot', weapon: 'weapon_homing' },
      { type: 'hit', weapon: 'weapon_homing', car: 1 },
    ],
  },
  {
    weapon: 'weapon_mine',
    title: 'Road Mine',
    description:
      'The attacker drops a mine in front of a car following in the same lane. It arms, and the follower drives onto it.',
    shows:
      'Hatch pop, the mine blinking as it arms after 0.6 s, the thump under the follower and its 1.2-second slow.',
    mount: 'rear_center',
    turn: 2,
    ahead: -150,
    fire: [30, 31],
    duration: 150,
    expect: [
      { type: 'hazard', car: -1 },
      { type: 'hit', weapon: 'weapon_mine', car: 1 },
      { type: 'status', car: 1 },
    ],
  },
  {
    weapon: 'weapon_oil',
    title: 'Oil Slick',
    description: 'The attacker lays a 90-pixel strip of oil and the follower drives over it.',
    shows:
      'The spill, a glossy strip on the road, the follower sliding for 2.5 seconds with no fireball.',
    mount: 'rear_center',
    turn: 2,
    ahead: -140,
    fire: [30, 31],
    duration: 170,
    expect: [
      { type: 'hazard', car: -1 },
      { type: 'status', car: 1 },
    ],
  },
  {
    weapon: 'weapon_foam',
    title: 'Sticky Foam',
    description:
      'A glob is lobbed 120 pixels ahead and lands on the car in front, which is slowed by 20 percent while it is in the puddle and for 2 seconds after.',
    shows:
      'The lob with its landing marker, the puddle spreading, the target held to four fifths of its speed.',
    mount: 'front_center',
    ahead: 82,
    fire: [45, 46],
    duration: 170,
    expect: [
      { type: 'telegraph', weapon: 'weapon_foam' },
      { type: 'hazard', car: -1 },
      { type: 'status', car: 1 },
    ],
  },
  {
    weapon: 'weapon_emp',
    title: 'EMP Pulse',
    description:
      'With a car alongside, the attacker charges for 0.6 s and releases a pulse 135 pixels wide.',
    shows:
      'Charge segments on the emitter, the ring, electronics down on the other car for 1.5 seconds.',
    mount: 'roof_mid',
    ahead: 10,
    aside: 50,
    fire: [40, 41],
    duration: 150,
    expect: [
      { type: 'windup', weapon: 'weapon_emp' },
      { type: 'area', weapon: 'weapon_emp' },
      { type: 'status', car: 1 },
    ],
  },
  {
    weapon: 'weapon_tesla',
    title: 'Tesla Arc',
    description:
      'A car comes within 70 pixels. The coil strikes it by itself and holds its systems for 0.6 s.',
    shows:
      'A forked arc from the coil to the nearest point of the other car, sparks on the struck component.',
    mount: 'roof_mid',
    ahead: 8,
    aside: 48,
    duration: 120,
    expect: [
      { type: 'beam', weapon: 'weapon_tesla' },
      { type: 'hit', weapon: 'weapon_tesla', car: 1 },
      { type: 'status', car: 1 },
    ],
  },
  {
    weapon: 'weapon_flame',
    title: 'Flame Spitter',
    description:
      'Two seconds of flame over the car just ahead: it burns, in pulses, and its core heats up.',
    shows:
      "The cone for 2 seconds, fire on the struck panel, burn pulses every third of a second, the target's heat rising.",
    mount: 'front_center',
    ahead: 62,
    fire: [40, 41],
    duration: 170,
    expect: [
      { type: 'area', weapon: 'weapon_flame' },
      { type: 'status', car: 1 },
      { type: 'hit', weapon: 'weapon_flame', car: 1 },
    ],
  },
  {
    weapon: 'weapon_frost',
    title: 'Frost Cannon',
    description:
      'A cold shell strikes the car ahead: 20 percent less grip for 2.5 seconds and a patch of frost left on the road.',
    shows:
      'The faceted shell, the shatter, frost over the wheel arches, an icy patch on the asphalt.',
    mount: 'front_center',
    ahead: 120,
    fire: [45, 46],
    duration: 150,
    expect: [
      { type: 'shot', weapon: 'weapon_frost' },
      { type: 'status', car: 1 },
      { type: 'hazard', car: -1 },
    ],
  },
  {
    weapon: 'weapon_hammer',
    title: 'Crash Hammer',
    description:
      'The arm draws back for a quarter of a second and strikes the car ahead and to one side, knocking it across the road.',
    shows:
      'Wind-up, the clang, 24 damage on the struck corner and a sideways knock; the target is then immune to another for 2 seconds.',
    mount: 'front_center',
    ahead: 64,
    aside: 14,
    fire: [45, 46],
    duration: 140,
    expect: [
      { type: 'windup', weapon: 'weapon_hammer' },
      { type: 'hit', weapon: 'weapon_hammer', car: 1 },
      { type: 'impulse', car: 1 },
    ],
  },
  {
    weapon: 'weapon_saw',
    title: 'Side Saw',
    description:
      "A car runs along the attacker's right flank inside the saw's reach. It bites every 3 seconds by itself.",
    shows: 'Teeth running, sparks at the contact point on each bite, scratches with no explosion.',
    mount: 'right_front',
    turn: 1,
    chassis: 'spider',
    ahead: -6,
    aside: 54,
    duration: 240,
    expect: [
      { type: 'shot', weapon: 'weapon_saw' },
      { type: 'hit', weapon: 'weapon_saw', car: 1 },
    ],
  },
  {
    weapon: 'weapon_harpoon',
    title: 'Grapple Harpoon',
    description:
      'The dart hooks a car ahead in the next lane and the line drags the two together for 2 seconds, then lets go.',
    shows:
      'The dart on its rope, the hook, a line under tension between two moving cars, the release.',
    mount: 'front_center',
    ahead: 120,
    aside: 24,
    fire: [45, 46],
    duration: 170,
    expect: [
      { type: 'shot', weapon: 'weapon_harpoon' },
      { type: 'tether', car: 0 },
    ],
  },
  {
    weapon: 'weapon_air',
    title: 'Air Cannon',
    description:
      'A blast of air from the nose shoves the car ahead off its line with almost no damage.',
    shows: 'The pale cone, the pressure wave, the target thrown forward and aside.',
    mount: 'front_center',
    ahead: 62,
    aside: 12,
    fire: [45, 46],
    duration: 130,
    expect: [
      { type: 'area', weapon: 'weapon_air' },
      { type: 'impulse', car: 1 },
    ],
  },
  {
    weapon: 'weapon_boomerang',
    title: 'Steel Boomerang',
    description:
      'The blade flies out through the car ahead, turns at 200 pixels and comes home through it again.',
    shows:
      'The spinning blade outbound, a slash, the turn, a second slash on the way back and the catch.',
    mount: 'front_center',
    ahead: 110,
    fire: [45, 46],
    duration: 190,
    expect: [
      { type: 'shot', weapon: 'weapon_boomerang' },
      { type: 'hit', weapon: 'weapon_boomerang', car: 1 },
    ],
  },
  {
    weapon: 'weapon_mortar',
    title: 'Arc Mortar',
    description:
      'The mortar locks a car 220 pixels ahead, paints the reticle where it will be and drops a shell 1.4 seconds later.',
    shows:
      'Lock, the reticle counting down for 1.4 s, the heavy burst and its falloff from 25 at the centre to 8 at the edge.',
    mount: 'bed_rear',
    chassis: 'pickup',
    ahead: 220,
    fire: [20, 100],
    duration: 190,
    expect: [
      { type: 'lock', weapon: 'weapon_mortar' },
      { type: 'telegraph', weapon: 'weapon_mortar' },
      { type: 'explosion', weapon: 'weapon_mortar' },
    ],
  },
];

function attacker(test: WeaponCase): VehicleBlueprint {
  const part: PartSpec = { part: test.weapon, mount: test.mount };
  if (test.turn !== undefined) part.turn = test.turn;
  if (test.fire) part.fire = 0;
  const name = test.title;
  if (test.chassis === 'spider')
    return build(name, 'chassis_spider', 'engine_v6', 'tires_street', 'paint_cobalt', [part]);
  if (test.chassis === 'pickup')
    return build(name, 'chassis_pickup', 'engine_v6', 'tires_street', 'paint_cobalt', [part]);
  return beetle(name, [part]);
}

function weaponScenario(test: WeaponCase): ScenarioDefinition {
  // The car further back starts 90 pixels past the line; the other is placed relative to it.
  const base = 90 + Math.max(0, -test.ahead);
  const steps = test.fire ? [hold(test.fire[0], test.fire[1])] : [];
  return {
    id: test.weapon,
    title: test.title,
    description: test.description,
    shows: test.shows,
    trackId: TRACK,
    weatherPresetId: test.weather ?? CLEAR,
    seed: 1,
    countdownTicks: COUNTDOWN,
    durationTicks: test.duration,
    cars: [
      car(attacker(test), base, -(test.aside ?? 0) / 2, steps),
      car(dummy(), base + test.ahead, (test.aside ?? 0) / 2),
    ],
    expect: test.expect,
  };
}

const rainRunner = getTemplate('example_rain_runner')!.blueprint;

const FEATURE_SCENARIOS: ScenarioDefinition[] = [
  {
    id: 'kinetic_impact',
    title: 'Small kinetic impacts',
    description:
      'A machine-gun burst and then a shotgun blast into the tail of a car carrying a rear plate: the plate takes most of it.',
    shows:
      'Section 13.3 small kinetic impact, twice: tight bullet impacts, then a fan of pellet impacts. Armor absorbs before the bodywork.',
    trackId: TRACK,
    weatherPresetId: CLEAR,
    seed: 2,
    countdownTicks: COUNTDOWN,
    durationTicks: 170,
    cars: [
      car(
        build('Gunner', 'chassis_beetle', 'engine_four_cylinder', 'tires_street', 'paint_cobalt', [
          { part: 'weapon_front_mg', mount: 'roof_mid', fire: 0 },
          { part: 'weapon_shotgun', mount: 'front_center', fire: 1 },
        ]),
        90,
        0,
        [hold(40, 41), { from: 60, speed: 150 }, hold(95, 96, 2)],
      ),
      car(dummy([{ part: 'defense_light_plate', mount: 'rear_center', turn: 2 }]), 190, 0),
    ],
    expect: [
      { type: 'hit', weapon: 'weapon_front_mg', car: 1 },
      { type: 'hit', weapon: 'weapon_shotgun', car: 1 },
    ],
  },
  {
    id: 'rocket_hit',
    title: 'Rocket hit',
    description:
      'Two rockets five seconds apart: the first strikes the car ahead squarely, the second is fired after it has moved aside and bursts on the road beside it.',
    shows:
      'Section 13.3 rocket explosion: approach, flash, fireball, shrapnel and smoke; then the splash of a near miss.',
    trackId: TRACK,
    weatherPresetId: CLEAR,
    seed: 3,
    countdownTicks: COUNTDOWN,
    durationTicks: 260,
    cars: [
      car(beetle('Rocketeer', [{ part: 'weapon_rocket', mount: 'front_center', fire: 0 }]), 90, 0, [
        hold(40, 41),
        hold(200, 201),
      ]),
      car(dummy(), 230, 0, [{ from: 70, lane: 30 }]),
    ],
    expect: [
      { type: 'shot', weapon: 'weapon_rocket' },
      { type: 'hit', weapon: 'weapon_rocket', car: 1 },
      { type: 'explosion', weapon: 'weapon_rocket' },
    ],
  },
  {
    id: 'mortar_strike',
    title: 'Mortar strike',
    description:
      'A Pickup with a mortar in its bed shells a parked car 230 pixels up the road: reticle, 1.4 seconds of flight, burst.',
    shows:
      'Section 13.3 heavy mortar explosion with its warning reticle. The target sits still so the whole sequence can be studied.',
    trackId: TRACK,
    weatherPresetId: CLEAR,
    seed: 4,
    countdownTicks: COUNTDOWN,
    durationTicks: 150,
    cars: [
      car(
        build('Mortar Mule', 'chassis_pickup', 'engine_v6', 'tires_street', 'paint_cobalt', [
          { part: 'weapon_mortar', mount: 'bed_rear', fire: 0 },
        ]),
        90,
        0,
        [hold(10, 90)],
        { speed: 0 },
      ),
      car(dummy(), 320, 10, [], { speed: 0 }),
    ],
    expect: [
      { type: 'telegraph', weapon: 'weapon_mortar' },
      { type: 'explosion', weapon: 'weapon_mortar' },
      { type: 'hit', weapon: 'weapon_mortar', car: 1 },
    ],
  },
  {
    id: 'emp_burst',
    title: 'EMP burst',
    description:
      'An EMP goes off beside the Rain Runner: its energy shield drops, its sentry stops, and its electric motor falls to the protected minimum for 1.5 seconds.',
    shows:
      'Section 13.3 EMP burst: charge, cyan and violet rings, arcs to the affected mounts. No fireball. The shielded electric car is the worst case.',
    trackId: TRACK,
    weatherPresetId: CLEAR,
    seed: 5,
    countdownTicks: COUNTDOWN,
    durationTicks: 170,
    cars: [
      car(beetle('Pulse', [{ part: 'weapon_emp', mount: 'roof_mid', fire: 0 }]), 100, -26, [
        hold(60, 61),
      ]),
      car(rainRunner, 96, 26),
    ],
    expect: [
      { type: 'area', weapon: 'weapon_emp' },
      { type: 'status', car: 1 },
      { type: 'shield', car: 1 },
    ],
  },
  {
    id: 'repair_burst',
    title: 'Repairs',
    description:
      'A car with a ruined front-left wheel and a critical engine fits its spare wheel (1 second), then uses a repair kit on the engine (1.3 seconds).',
    shows:
      'Section 13.3 repair burst, twice. The car pulls left on its broken wheel and is down on power until each repair lands.',
    trackId: TRACK,
    weatherPresetId: CLEAR,
    seed: 6,
    countdownTicks: COUNTDOWN,
    durationTicks: 240,
    cars: [
      car(
        build('Patched', 'chassis_beetle', 'engine_four_cylinder', 'tires_street', 'paint_cobalt', [
          { part: 'utility_spare', mount: 'left_utility' },
          { part: 'utility_repair', mount: 'right_utility' },
        ]),
        90,
        0,
        [
          { from: 50, to: 52, use: 1 },
          { from: 150, to: 152, use: 2 },
        ],
        {
          integrity: [
            { component: 0, value: 12 },
            { component: 2, value: 0 },
          ],
        },
      ),
      car(dummy(), 220, 40),
    ],
    expect: [
      { type: 'utility', car: 0 },
      { type: 'component', car: 0 },
    ],
  },
  {
    id: 'wet_road',
    title: 'Wet road',
    description:
      "Rainy night. A rocket hits the car ahead; a frost shell follows and leaves a patch a third wider than in the dry that lasts longer; the follower's oil is already washing away.",
    shows:
      'Section 13.5 rain with combat on wet asphalt: a rocket bloom over standing water, frost spreading on a wet road, a short-lived oil strip.',
    trackId: TRACK,
    weatherPresetId: RAIN,
    seed: 7,
    countdownTicks: COUNTDOWN,
    durationTicks: 260,
    cars: [
      car(
        build(
          'Storm Chaser',
          'chassis_beetle',
          'engine_four_cylinder',
          'tires_rain',
          'paint_cobalt',
          [
            { part: 'weapon_rocket', mount: 'front_center', fire: 0 },
            { part: 'weapon_frost', mount: 'roof_mid', fire: 1 },
          ],
        ),
        90,
        0,
        [hold(45, 46), hold(110, 111, 2)],
      ),
      car(
        build('Slick', 'chassis_beetle', 'engine_four_cylinder', 'tires_rain', 'paint_sunflare', [
          { part: 'weapon_oil', mount: 'rear_center', turn: 2, fire: 0 },
        ]),
        220,
        0,
        [hold(150, 151)],
      ),
    ],
    expect: [
      { type: 'explosion', weapon: 'weapon_rocket' },
      { type: 'status', car: 1 },
      { type: 'hazard', car: -1 },
    ],
  },
  {
    id: 'oil_fire',
    title: 'Burning oil',
    description:
      'A Pickup lays oil behind it and lights the strip with a rear-facing flame spitter. The car following drives into the fire and burns.',
    shows:
      "Oil igniting into a fire hazard that keeps the strip's shape and remaining life, and a car catching fire by driving through it. Persistent fire reads as an area, not a flash.",
    trackId: TRACK,
    weatherPresetId: CLEAR,
    seed: 8,
    countdownTicks: COUNTDOWN,
    durationTicks: 200,
    cars: [
      car(
        build('Firestarter', 'chassis_pickup', 'engine_v6', 'tires_street', 'paint_cobalt', [
          { part: 'weapon_oil', mount: 'rear_center', turn: 2, fire: 0 },
          { part: 'weapon_flame', mount: 'left_bed', turn: 2, fire: 1 },
        ]),
        330,
        0,
        [hold(20, 21), hold(26, 27, 2)],
      ),
      car(dummy(), 90, 0),
    ],
    expect: [
      { type: 'hazard', car: 0 },
      { type: 'status', car: 1 },
      { type: 'hit', weapon: 'weapon_flame', car: 1 },
    ],
  },
  {
    id: 'flame_frost',
    title: 'Frost puts out fire',
    description:
      'Two seconds of flame set the car ahead burning. As the flame ends a frost shell strikes it: the fire goes out at once, its grip drops by a fifth for 2.5 seconds, and a patch of frost is left on the road.',
    shows:
      'A burning car put out by frost: the burn status ends early and the frost status begins on the same tick. The shell leaves an icy patch where it struck.',
    trackId: TRACK,
    weatherPresetId: CLEAR,
    seed: 13,
    countdownTicks: COUNTDOWN,
    durationTicks: 220,
    cars: [
      car(
        build(
          'Fire and Ice',
          'chassis_beetle',
          'engine_four_cylinder',
          'tires_street',
          'paint_cobalt',
          [
            { part: 'weapon_flame', mount: 'front_center', fire: 0 },
            { part: 'weapon_frost', mount: 'roof_mid', fire: 1 },
          ],
        ),
        90,
        0,
        [hold(40, 41), hold(99, 100, 2)],
      ),
      car(dummy(), 152, 0),
    ],
    expect: [
      { type: 'hit', weapon: 'weapon_flame', car: 1 },
      { type: 'status', car: 1 },
      { type: 'hazard', car: -1 },
    ],
  },
  {
    id: 'frost_thaw',
    title: 'Fire thaws frost',
    description:
      'A frost shell takes the grip of the car ahead and leaves a patch on the road. A second later the flame spitter thaws the car (its frost ends at once) and melts the patch it passes over.',
    shows:
      'The other direction of the same pair: a frosted car thawed by fire, and a frost patch melted off the road.',
    trackId: TRACK,
    weatherPresetId: CLEAR,
    seed: 14,
    countdownTicks: COUNTDOWN,
    durationTicks: 200,
    cars: [
      car(
        build(
          'Fire and Ice',
          'chassis_beetle',
          'engine_four_cylinder',
          'tires_street',
          'paint_cobalt',
          [
            { part: 'weapon_flame', mount: 'front_center', fire: 0 },
            { part: 'weapon_frost', mount: 'roof_mid', fire: 1 },
          ],
        ),
        90,
        0,
        [hold(40, 41, 2), hold(48, 49)],
      ),
      car(dummy(), 152, 0),
    ],
    expect: [
      { type: 'status', car: 1 },
      { type: 'hazard', car: 0 },
    ],
  },
  {
    id: 'missile_defense',
    title: 'Missile countermeasures',
    description:
      'Three seekers at a car that carries a Missile Interceptor, a Decoy Drone and a Radar: the first is shot down, the second chases the decoy, the third gets through.',
    shows:
      'Lock warning, the early Radar warning, an interception, a missile swerving onto a decoy, and an unanswered hit for comparison.',
    trackId: TRACK,
    weatherPresetId: CLEAR,
    seed: 9,
    countdownTicks: COUNTDOWN,
    durationTicks: 760,
    cars: [
      car(beetle('Seeker', [{ part: 'weapon_homing', mount: 'roof_mid', fire: 0 }]), 90, -20, [
        hold(20, 80),
        hold(300, 360),
        hold(580, 640),
      ]),
      car(
        build('Countermeasures', 'chassis_spider', 'engine_v6', 'tires_street', 'paint_sunflare', [
          { part: 'defense_antimissile', mount: 'roof_front' },
          { part: 'utility_radar', mount: 'roof_mid' },
          { part: 'utility_decoy', mount: 'rear_utility' },
        ]),
        250,
        20,
        [{ from: 345, to: 347, use: 1 }],
      ),
    ],
    expect: [{ type: 'impact' }, { type: 'warning', car: 1 }, { type: 'hazard', car: -1 }],
  },
  {
    id: 'mine_sweeper',
    title: 'Trap detection and clearing',
    description:
      "The leader drops two mines. The follower's Mine Detector reveals each one 120 pixels sooner, and its Mine Sweeper clears the first; it steers round the second.",
    shows:
      "The trap warning, a mine being cleared just ahead of the bumper, and the sweeper's 8-second cooldown leaving the second mine live.",
    trackId: TRACK,
    weatherPresetId: CLEAR,
    seed: 10,
    countdownTicks: COUNTDOWN,
    durationTicks: 330,
    cars: [
      car(
        build('Sweeper', 'chassis_beetle', 'engine_four_cylinder', 'tires_street', 'paint_cobalt', [
          { part: 'defense_minesweeper', mount: 'front_center' },
          { part: 'utility_minesensor', mount: 'roof_mid' },
        ]),
        90,
        0,
        [{ from: 215, lane: 44 }],
      ),
      car(
        build(
          'Minelayer',
          'chassis_beetle',
          'engine_four_cylinder',
          'tires_street',
          'paint_sunflare',
          [{ part: 'weapon_mine', mount: 'rear_center', turn: 2, fire: 0 }],
        ),
        330,
        0,
        [hold(20, 21), { from: 30, to: 215, fire: 1 }],
      ),
    ],
    expect: [
      { type: 'warning', car: 0 },
      { type: 'hazard', car: 0 },
    ],
  },
  {
    id: 'ram',
    title: 'Ramming',
    description:
      'A heavy Pickup with a Crash Bumper runs into the back of a slow Trike at speed. The light car is thrown forward and takes most of the damage.',
    shows:
      'Mass-aware collision: who moves, who is hurt, and the rear-left or rear-right wheel taking the hit where it lands.',
    trackId: TRACK,
    weatherPresetId: CLEAR,
    seed: 11,
    countdownTicks: COUNTDOWN,
    durationTicks: 200,
    cars: [
      car(
        build('Battering Ram', 'chassis_pickup', 'engine_v8', 'tires_street', 'paint_cobalt', [
          { part: 'defense_heavy_plate', mount: 'rear_center', turn: 2 },
        ]),
        90,
        0,
        [],
        { speed: 260 },
      ),
      car(
        build(
          'Featherweight',
          'chassis_trike',
          'engine_mini_electric',
          'tires_street',
          'paint_sunflare',
          [],
        ),
        330,
        4,
        [],
        { speed: 60 },
      ),
    ],
    expect: [{ type: 'hit', weapon: 'ram', car: 1 }],
  },
  {
    id: 'shield_break',
    title: 'Shields and absorbers',
    description:
      'Machine-gun bursts and a rocket into a car with an Energy Shield, Breakaway Armor and Reactive Foam: each one answers in its turn.',
    shows:
      'Section 13.8 armor and shield reactions: the shield taking one hit and dropping, the breakaway plate soaking 35 and falling off, the foam cutting the heavy hit.',
    trackId: TRACK,
    weatherPresetId: CLEAR,
    seed: 12,
    countdownTicks: COUNTDOWN,
    durationTicks: 330,
    cars: [
      car(
        build('Breaker', 'chassis_beetle', 'engine_four_cylinder', 'tires_street', 'paint_cobalt', [
          { part: 'weapon_front_mg', mount: 'roof_mid', fire: 0 },
          { part: 'weapon_rocket', mount: 'front_center', fire: 1 },
        ]),
        90,
        0,
        [hold(40, 41), hold(100, 101), hold(160, 161), hold(220, 221, 2)],
      ),
      car(
        build('Layered', 'chassis_spider', 'engine_v6', 'tires_street', 'paint_sunflare', [
          { part: 'defense_energy_shield', mount: 'roof_front' },
          { part: 'defense_breakaway', mount: 'roof_mid' },
          { part: 'defense_reactive', mount: 'rear_utility' },
        ]),
        215,
        0,
      ),
    ],
    expect: [{ type: 'shield', car: 1 }],
  },
];

export const SCENARIOS: ScenarioDefinition[] = [
  ...FEATURE_SCENARIOS,
  ...WEAPON_CASES.map(weaponScenario),
];

export function getScenario(id: string): ScenarioDefinition | undefined {
  return SCENARIOS.find((s) => s.id === id);
}

export type ScenarioRace = {
  def: ScenarioDefinition;
  race: RaceSession;
  /** One scripted brain per car. A client driving car 0 itself passes its own control instead. */
  brains: RaceBrain[];
  entries: RaceEntry[];
};

/** Builds the race a scenario describes, with every car on its mark and its script loaded. */
export function createScenarioRace(
  def: ScenarioDefinition,
  track: TrackRuntime,
): ScenarioRace | null {
  const env = environmentFor(def.weatherPresetId);
  const conditions = conditionsFor(def.trackId, def.weatherPresetId);
  if (!env || !conditions) return null;
  const entries: RaceEntry[] = [];
  for (const setup of def.cars) {
    const entry = raceEntry(setup.blueprint, conditions);
    if (!entry) return null;
    entries.push(entry);
  }
  const race = createRace(track, env, entries, { seed: def.seed, conditions, catalog: CATALOG });
  applyScenario(race, def);
  return { def, race, brains: def.cars.map((setup) => new ScenarioBrain(setup)), entries };
}
