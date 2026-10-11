import { CATALOG, build } from '@bolt/content';
import type { PartSpec } from '@bolt/content';
import type {
  CombatCar,
  ControlInput,
  ModuleRuntime,
  ModuleSpec,
  QuarterTurn,
  RaceEnvironment,
  RaceEvent,
  RaceEventType,
  RaceSession,
  SurfaceId,
  VehicleBlueprint,
} from '@bolt/shared';
import type { HitClass, HitInput } from '@bolt/shared';
import {
  COMPONENT_FIRST_WHEEL,
  DEFAULT_CONDITIONS,
  applyHit,
  createHit,
  localToWorld,
  buildHash,
  buildTrack,
  createRace,
  deriveVehicleParams,
  headingFromVector,
  resolveBlueprint,
  stepRace,
} from '@bolt/shared';
import { CLEAR, provingGround } from './rig.js';
import { makeProvingGround } from './tracks.js';

/**
 * A duel on the proving ground: two cars placed by hand on a long, wide, straight piece of
 * road, with nothing else going on. Combat tests set up one situation, step a few ticks and
 * read the events and the state. Builds are resolved, not validated: a test may hang any part
 * on any mount, because it is testing the part, not the garage.
 */

/** A part for a test car: catalog id, and optionally where it goes and how it is fired. */
export type TestPart =
  | string
  | {
      id: string;
      mount?: string;
      turn?: QuarterTurn;
      fire?: 0 | 1 | 'auto';
      offset?: [number, number];
    };

export type TestCar = {
  parts?: TestPart[];
  chassis?: string;
  engine?: string;
  tires?: string;
  blueprint?: VehicleBlueprint;
};

/** Mounts a test car fills in order when a part does not name one (the Spider's eight). */
const SPIDER_MOUNTS = [
  'roof_front',
  'roof_mid',
  'rear_utility',
  'front_utility',
  'left_front',
  'right_front',
  'left_rear',
  'right_rear',
];

export function testBlueprint(car: TestCar, name = 'Test Car'): VehicleBlueprint {
  if (car.blueprint) return car.blueprint;
  const chassis = car.chassis ?? 'chassis_spider';
  const free = [...SPIDER_MOUNTS];
  const parts: PartSpec[] = (car.parts ?? []).map((part) => {
    const spec = typeof part === 'string' ? { id: part } : part;
    const mount = spec.mount ?? free.shift()!;
    const index = free.indexOf(mount);
    if (index >= 0) free.splice(index, 1);
    const out: PartSpec = { part: spec.id, mount };
    if (spec.turn !== undefined) out.turn = spec.turn;
    if (spec.fire !== undefined) out.fire = spec.fire;
    if (spec.offset) out.offset = spec.offset;
    return out;
  });
  return build(
    name,
    chassis,
    car.engine ?? 'engine_four_cylinder',
    car.tires ?? 'tires_street',
    'paint_cobalt',
    parts,
  );
}

/** Brake held just short of reverse: a parked car that stays parked. */
export const PARK: ControlInput = { steer: 0, brake: 0.5, coast: false };
export const GO: ControlInput = { steer: 0, brake: 0, coast: false };

export type DuelOptions = {
  /** How far ahead of car A car B's centre starts, world pixels. Negative puts it behind. */
  ahead?: number;
  /** How far to A's right B starts. */
  aside?: number;
  /** B's heading relative to A's, radians clockwise. */
  turnB?: number;
  env?: RaceEnvironment;
  surface?: SurfaceId;
  seed?: number;
  /** Solid posts on the road, as offsets from car A: ahead, aside and radius. */
  posts?: Array<{ ahead: number; aside?: number; radius: number }>;
  /** Published time of day, for parts that care (Solar Panel). */
  timeOfDay?: 'day' | 'dusk' | 'night';
};

export type Duel = {
  race: RaceSession;
  a: CombatCar;
  b: CombatCar;
  /** Every event since the duel began. */
  events: RaceEvent[];
  /** Steps the race. Cars are parked unless given a control. */
  step: (ticks?: number, inputA?: Partial<ControlInput>, inputB?: Partial<ControlInput>) => void;
  /** Presses a fire button of a car for two ticks and lets go for one, then steps `after` more. */
  fire: (car: 0 | 1, slot?: 0 | 1, after?: number) => void;
  /** Presses and releases a utility button. */
  use: (car: 0 | 1, bit?: number, after?: number, target?: number) => void;
  of: <T extends RaceEventType>(type: T, car?: number) => Array<Extract<RaceEvent, { type: T }>>;
  /** The module and compiled spec of a car's part, by catalog id. */
  module: (
    car: CombatCar,
    partId: string,
  ) => { spec: ModuleSpec; module: ModuleRuntime; component: number };
  /** Moves car B, keeping it parked: for lining up a second shot. */
  placeB: (ahead: number, aside?: number, turn?: number) => void;
};

export function duel(
  carA: TestCar,
  carB: TestCar = { chassis: 'chassis_beetle' },
  options: DuelOptions = {},
): Duel {
  const env = options.env ?? CLEAR;
  const track = options.posts
    ? buildTrack(
        makeProvingGround(
          options.surface ?? 'asphalt',
          options.posts.map((post, index) => ({
            id: `post_${index}`,
            kind: 'bollard',
            x: 11000 - post.ahead,
            y: 5000 - (post.aside ?? 0),
            radius: post.radius,
          })),
        ),
      )
    : provingGround(options.surface ?? 'asphalt');
  const conditions = {
    ...DEFAULT_CONDITIONS,
    weather: env.weather,
    timeOfDay: options.timeOfDay ?? DEFAULT_CONDITIONS.timeOfDay,
  };
  const entries = [carA, carB].map((car, index) => {
    const blueprint = testBlueprint(car, index === 0 ? 'Attacker' : 'Target');
    const built = resolveBlueprint(blueprint, CATALOG);
    if (!built || built.unresolved.length > 0)
      throw new Error(`${blueprint.name} does not resolve: ${JSON.stringify(built?.unresolved)}`);
    return {
      build: built,
      params: deriveVehicleParams(built, conditions),
      buildHash: buildHash(blueprint),
    };
  });
  const race = createRace(track, env, entries, {
    seed: options.seed ?? 1,
    conditions,
    catalog: CATALOG,
  });
  const a = race.cars[0]!;
  const b = race.cars[1]!;
  const heading = headingFromVector(-1, 0);
  const place = (car: CombatCar, ahead: number, aside: number, turn: number) => {
    const m = car.session.motion;
    // Heading west: ahead is -x, and the right-hand side is -y.
    m.x = 11000 - ahead;
    m.y = 5000 - aside;
    m.headingRad = heading + turn;
    m.velocityX = 0;
    m.velocityY = 0;
    m.yawRate = 0;
    car.prevX = m.x;
    car.prevY = m.y;
  };
  place(a, 0, 0, 0);
  place(b, options.ahead ?? 100, options.aside ?? 0, options.turnB ?? 0);
  // Straight to GO: one countdown tick, which also leaves both cars cold and charged.
  for (const car of race.cars) car.session.countdownTicks = 1;
  const events: RaceEvent[] = [];
  const inputs: ControlInput[] = [{ ...PARK }, { ...PARK }];
  const run = (ticks: number, inputA?: Partial<ControlInput>, inputB?: Partial<ControlInput>) => {
    for (let i = 0; i < ticks; i++) {
      inputs[0] = { ...PARK, ...inputA };
      inputs[1] = { ...PARK, ...inputB };
      stepRace(race, inputs);
      for (const event of race.events) events.push(event);
    }
  };
  run(1);
  if (race.phase !== 'RACING') throw new Error('the duel did not start');
  // Nothing that happened on the grid is part of the test.
  events.length = 0;

  const self: Duel = {
    race,
    a,
    b,
    events,
    step: (ticks = 1, inputA, inputB) => run(ticks, inputA, inputB),
    fire: (car, slot = 0, after = 0) => {
      const press = { fire: 1 << slot };
      if (car === 0) run(2, press);
      else run(2, undefined, press);
      run(1 + after);
    },
    use: (car, bit = 0, after = 0, target = 0) => {
      const press = { use: 1 << bit, target };
      if (car === 0) run(2, press);
      else run(2, undefined, press);
      run(1 + after);
    },
    of: (type, car) =>
      events.filter(
        (event) =>
          event.type === type && (car === undefined || (event as { car?: number }).car === car),
      ) as never,
    module: (car, partId) => {
      const index = car.specs.findIndex((spec) => spec.id === partId);
      if (index < 0) throw new Error(`${partId} is not on that car`);
      return {
        spec: car.specs[index]!,
        module: car.modules[index]!,
        component: COMPONENT_FIRST_WHEEL + car.build.chassis.wheelAnchors.length + index,
      };
    },
    placeB: (ahead, aside = 0, turn = 0) => place(b, ahead, aside, turn),
  };
  return self;
}

/** Integrity taken from a car's components and chassis by the hits of one weapon. */
export function damageBy(d: Duel, weapon: string, car = 1): number {
  let total = 0;
  for (const event of d.of('hit', car))
    if (event.weapon === weapon) total += event.damage + event.chassis;
  return total;
}

/** Component damage (the nominal `DMG` of Section 11.5) dealt by one weapon. */
export function componentDamageBy(d: Duel, weapon: string, car = 1): number {
  let total = 0;
  for (const event of d.of('hit', car)) if (event.weapon === weapon) total += event.damage;
  return total;
}

/**
 * Lands a hit of a given size on a chosen spot of a car, in that car's own frame (x to its
 * right, y toward its rear). For testing the damage pipeline apart from any weapon.
 */
export function hitAt(
  d: Duel,
  target: CombatCar,
  lx: number,
  ly: number,
  damage: number,
  cls: HitClass = 'direct',
  extra: Partial<HitInput> = {},
): Extract<RaceEvent, { type: 'hit' }> {
  const point = localToWorld(target.session.motion, lx, ly, { x: 0, y: 0 });
  const hit: HitInput = {
    ...createHit(),
    by: target.index === 0 ? 1 : 0,
    weapon: 'test',
    cls,
    damage,
    x: point.x,
    y: point.y,
    ...extra,
  };
  const before = d.race.events.length;
  applyHit(d.race, target, hit);
  const event = d.race.events.slice(before).find((e) => e.type === 'hit');
  if (!event || event.type !== 'hit') throw new Error('the hit produced no hit event');
  // Events raised outside a step are collected here, since the next step clears them.
  for (const raised of d.race.events.slice(before)) d.events.push(raised);
  return event;
}

/** Integrity of a named mounted part's component on a car. */
export function partIntegrity(d: Duel, car: CombatCar, partId: string): number {
  return car.components[d.module(car, partId).component]!.integrity;
}
