import type { EngineDefinition, PartModifier, TorqueCurve } from '@bolt/shared';
import { NEUTRAL_CURVE } from '@bolt/shared';

/**
 * The twenty engines of Section 11.3. Cost, mass, force index and heat per second are the
 * seed values from the table. The "Character" column is expressed as a torque curve plus,
 * where the character needs memory (wind-up, fuel pulses, a stored launch, an output cycle),
 * runtime state that lives in the synchronized motion state and is advanced by
 * `stepPowertrain`. The curve numbers themselves are tuning and may change with the catalog
 * version; the table values may not.
 */

type EngineRow = {
  id: string;
  displayName: string;
  price: number;
  massKg: number;
  forceIndex: number;
  heatPerSecond: number;
  /** Electrical draw at full throttle, power units per second. */
  powerDraw?: number;
  footprint: [number, number];
  soundKey: string;
  description: string;
  drawback: string;
  curve: Partial<TorqueCurve>;
  /** Share of full-throttle heat made at idle. Electric motors make none. */
  idleHeat?: number;
  extra?: PartModifier[];
  params?: Record<string, number | string | boolean>;
};

function engine(row: EngineRow): EngineDefinition {
  const curve: TorqueCurve = { ...NEUTRAL_CURVE, forceIndex: row.forceIndex, ...row.curve };
  const heat: Extract<PartModifier, { type: 'ModifyHeatGeneration' }> = {
    type: 'ModifyHeatGeneration',
    add: row.heatPerSecond,
  };
  if (row.idleHeat !== undefined) heat.idleFraction = row.idleHeat;
  const modifiers: PartModifier[] = [
    { type: 'AddMass', kg: row.massKg },
    { type: 'ModifyTorqueCurve', set: curve },
    heat,
  ];
  if (row.powerDraw)
    modifiers.push({
      type: 'ModifyPowerPriority',
      draw: row.powerDraw,
      priority: 0,
      drivetrain: true,
    });
  modifiers.push(...(row.extra ?? []));
  return {
    id: row.id,
    displayName: row.displayName,
    category: 'engine',
    price: row.price,
    massKg: row.massKg,
    footprint: { w: row.footprint[0], h: row.footprint[1] },
    compatibleMounts: ['ENGINE'],
    spriteKey: row.id,
    soundKey: row.soundKey,
    description: row.description,
    drawback: row.drawback,
    modifiers,
    triggerMode: 'passive',
    params: {
      forceIndex: row.forceIndex,
      heatPerSecond: row.heatPerSecond,
      powerDraw: row.powerDraw ?? 0,
      ...row.params,
    },
    forceIndex: row.forceIndex,
    heatPerSecond: row.heatPerSecond,
    powerDraw: row.powerDraw ?? 0,
    curve,
  };
}

export const ENGINE_LIST: EngineDefinition[] = [
  engine({
    id: 'engine_mini_electric',
    displayName: 'Mini Electric',
    price: 75,
    massKg: 45,
    forceIndex: 62,
    heatPerSecond: 4,
    powerDraw: 5,
    footprint: [12, 10],
    soundKey: 'engine_electric_small',
    description: 'Quiet, cool and nearly weightless, with instant pull off the line.',
    drawback: 'The weakest engine, and it draws 5 power a second.',
    curve: { launchBoost: 0.9, launchFadeSpeed: 45, topEndFactor: 0.9 },
    idleHeat: 0,
  }),
  engine({
    id: 'engine_four_cylinder',
    displayName: 'Four-Cylinder',
    price: 140,
    massKg: 95,
    forceIndex: 100,
    heatPerSecond: 8,
    footprint: [18, 14],
    soundKey: 'engine_inline4',
    description: 'Reliable pull at any speed.',
    drawback: 'Nothing special at the top end.',
    curve: { launchBoost: 0.5 },
  }),
  engine({
    id: 'engine_v6',
    displayName: 'V6',
    price: 175,
    massKg: 120,
    forceIndex: 128,
    heatPerSecond: 11,
    footprint: [18, 14],
    soundKey: 'engine_v6',
    description: 'Stronger acceleration through every gear.',
    drawback: 'Runs warmer than stock cooling likes.',
    curve: { launchBoost: 0.5, topEndFactor: 1.03 },
  }),
  engine({
    id: 'engine_v8',
    displayName: 'V8',
    price: 220,
    massKg: 155,
    forceIndex: 158,
    heatPerSecond: 15,
    footprint: [20, 16],
    soundKey: 'engine_v8',
    description: 'Big torque that shoves a heavy car out of corners.',
    drawback: 'Heavy and hot.',
    curve: { launchBoost: 0.65, topEndFactor: 1.04 },
  }),
  engine({
    id: 'engine_v12',
    displayName: 'V12',
    price: 290,
    massKg: 180,
    forceIndex: 183,
    heatPerSecond: 19,
    footprint: [20, 18],
    soundKey: 'engine_v12',
    description: 'Keeps pulling long after other engines run out of revs.',
    drawback: 'The most expensive engine, and it needs real cooling.',
    curve: { launchBoost: 0.3, topEndFactor: 1.14 },
  }),
  engine({
    id: 'engine_small_turbo',
    displayName: 'Small Turbo',
    price: 145,
    massKg: 88,
    forceIndex: 118,
    heatPerSecond: 14,
    footprint: [16, 14],
    soundKey: 'engine_turbo_small',
    description: 'Boost arrives in half a second for a quick burst of speed.',
    drawback: 'Hot for its size, and soft until the boost builds.',
    curve: { launchBoost: 0.45, spoolUpSeconds: 0.6, spoolDownSeconds: 0.8, spoolFloor: 0.8 },
  }),
  engine({
    id: 'engine_twin_turbo',
    displayName: 'Twin Turbo',
    price: 255,
    massKg: 148,
    forceIndex: 168,
    heatPerSecond: 21,
    footprint: [20, 16],
    soundKey: 'engine_turbo_twin',
    description: 'Huge sustained power once both turbos are spinning.',
    drawback: 'Very hot, with a second of lag after every lift.',
    curve: {
      launchBoost: 0.35,
      topEndFactor: 1.08,
      spoolUpSeconds: 1.1,
      spoolDownSeconds: 1,
      spoolFloor: 0.7,
    },
  }),
  engine({
    id: 'engine_supercharger',
    displayName: 'Supercharger',
    price: 225,
    massKg: 155,
    forceIndex: 157,
    heatPerSecond: 17,
    footprint: [20, 16],
    soundKey: 'engine_supercharger',
    description: 'The same strong pull from a standstill to high speed, with no lag.',
    drawback: 'The blower costs 6% extra drag all the time.',
    curve: { launchBoost: 0.2, taperStartFactor: 1.25 },
    extra: [{ type: 'ModifyDrag', factor: 1.06 }],
  }),
  engine({
    id: 'engine_diesel',
    displayName: 'Torque Diesel',
    price: 175,
    massKg: 175,
    forceIndex: 142,
    heatPerSecond: 11,
    footprint: [20, 16],
    soundKey: 'engine_diesel',
    description: 'Drags a loaded car back up to speed after a hit or a hairpin.',
    drawback: 'Runs out of revs early, and it is heavy.',
    curve: { launchBoost: 0.95, launchFadeSpeed: 110, topEndFactor: 0.76 },
  }),
  engine({
    id: 'engine_electric_sport',
    displayName: 'Sport Electric',
    price: 225,
    massKg: 112,
    forceIndex: 152,
    heatPerSecond: 13,
    powerDraw: 14,
    footprint: [18, 12],
    soundKey: 'engine_electric_sport',
    description: 'Full torque the instant you touch the throttle.',
    drawback: 'Draws 14 power a second and fades when the battery is flat.',
    curve: { launchBoost: 0.85, launchFadeSpeed: 60, topEndFactor: 0.98 },
    idleHeat: 0,
  }),
  engine({
    id: 'engine_electric_eco',
    displayName: 'Eco Electric',
    price: 115,
    massKg: 85,
    forceIndex: 91,
    heatPerSecond: 5,
    powerDraw: 6,
    footprint: [16, 12],
    soundKey: 'engine_electric_eco',
    description: 'Runs cool and asks only 6 power a second, which any chassis can supply.',
    drawback: 'Modest pull and a low top speed.',
    curve: { launchBoost: 0.7, launchFadeSpeed: 55, topEndFactor: 0.95 },
    idleHeat: 0,
  }),
  engine({
    id: 'engine_hybrid',
    displayName: 'Hybrid',
    price: 195,
    massKg: 138,
    forceIndex: 129,
    heatPerSecond: 9,
    footprint: [18, 16],
    soundKey: 'engine_hybrid',
    description: 'Runs cool at part throttle and recharges the battery when you lift.',
    drawback: 'Heavier than a V6 for the same pull, and it runs out of revs sooner.',
    curve: { launchBoost: 0.8, launchFadeSpeed: 50, topEndFactor: 0.95 },
    extra: [
      { type: 'ModifyHeatGeneration', partialLoadFactor: 0.55 },
      { type: 'ModifyEnergyGeneration', add: 2 },
      { type: 'ModifyEnergyGeneration', add: 6, condition: 'off_throttle' },
    ],
    params: { partialLoadHeatFactor: 0.55, generation: 2, regenOffThrottle: 6 },
  }),
  engine({
    id: 'engine_rotary',
    displayName: 'Rotary',
    price: 165,
    massKg: 73,
    forceIndex: 122,
    heatPerSecond: 17,
    footprint: [14, 12],
    soundKey: 'engine_rotary',
    description: 'Light and happy to rev: strong power for 73 kg.',
    drawback: 'Starts losing power to heat 15 points sooner than other engines.',
    curve: { launchBoost: 0.2, topEndFactor: 1.12 },
    extra: [{ type: 'ModifyHeatGeneration', toleranceOffset: -15 }],
    params: { heatToleranceOffset: -15 },
  }),
  engine({
    id: 'engine_turbine',
    displayName: 'Turbine',
    price: 250,
    massKg: 135,
    forceIndex: 146,
    heatPerSecond: 19,
    footprint: [16, 18],
    soundKey: 'engine_turbine',
    description: 'Once wound up, it pulls to a higher top speed than its power suggests.',
    drawback: 'Half power from cold, and 3.5 seconds to wind up.',
    curve: {
      launchBoost: 0,
      topEndFactor: 1.02,
      spoolUpSeconds: 3.5,
      spoolDownSeconds: 2.5,
      spoolFloor: 0.5,
      spoolTopEndFactor: 1.16,
    },
  }),
  engine({
    id: 'engine_rocket',
    displayName: 'Rocket Engine',
    price: 280,
    massKg: 130,
    forceIndex: 192,
    heatPerSecond: 26,
    footprint: [16, 18],
    soundKey: 'engine_rocket',
    description: 'The strongest thrust in the catalog, in 2.6-second burns.',
    drawback: 'Between burns it idles at 30% while the tank refills. Extremely hot.',
    curve: {
      launchBoost: 0.6,
      topEndFactor: 1.1,
      pulseBurnSeconds: 2.6,
      pulseRefillSeconds: 3.4,
      pulseRestFactor: 0.3,
    },
  }),
  engine({
    id: 'engine_twin',
    displayName: 'Twin Drive',
    price: 270,
    massKg: 190,
    forceIndex: 166,
    heatPerSecond: 20,
    footprint: [22, 16],
    soundKey: 'engine_twin',
    description: 'Two motors put power down 30% better on wet and loose ground.',
    drawback: 'The heaviest engine in the catalog.',
    curve: { launchBoost: 0.5, tractionFactor: 1.3 },
  }),
  engine({
    id: 'engine_spring',
    displayName: 'Spring Drive',
    price: 130,
    massKg: 85,
    forceIndex: 110,
    heatPerSecond: 7,
    footprint: [16, 14],
    soundKey: 'engine_spring',
    description: 'Winds up a launch burst every 12 seconds and lets it go on full throttle.',
    drawback: 'Ordinary pull between bursts, and it runs out of revs a little early.',
    curve: {
      launchBoost: 0.25,
      topEndFactor: 0.98,
      burstRechargeSeconds: 12,
      burstSeconds: 1.4,
      burstFactor: 1.5,
    },
  }),
  engine({
    id: 'engine_offroad',
    displayName: 'Trail Engine',
    price: 175,
    massKg: 125,
    forceIndex: 123,
    heatPerSecond: 10,
    footprint: [18, 16],
    soundKey: 'engine_offroad',
    description: 'Geared for dirt, sand, mud and snow: it keeps its pull where others bog down.',
    drawback: 'Short gearing costs 7% of top speed on paved roads.',
    curve: {
      launchBoost: 0.6,
      roadSpeedFactor: 0.93,
      looseRollingFactor: 0.55,
      looseTractionFactor: 1.2,
    },
  }),
  engine({
    id: 'engine_resilient',
    displayName: 'Ironheart',
    price: 185,
    massKg: 155,
    forceIndex: 110,
    heatPerSecond: 9,
    footprint: [18, 16],
    soundKey: 'engine_resilient',
    description: 'Loses half as much output as other engines when it is damaged.',
    drawback: 'Heavy for the power it makes.',
    curve: { launchBoost: 0.5 },
    extra: [
      { type: 'ModifyDamageByTag', tag: 'engine_output_loss', factor: 0.5 },
      { type: 'ModifyIntegrity', target: 'engine', factor: 1.25 },
    ],
    params: { damageOutputLossFactor: 0.5, engineIntegrityFactor: 1.25 },
  }),
  engine({
    id: 'engine_experimental',
    displayName: 'Wildcard Motor',
    price: 235,
    massKg: 98,
    forceIndex: 162,
    heatPerSecond: 23,
    footprint: [16, 14],
    soundKey: 'engine_experimental',
    description: 'V8 power from a 98 kg motor at the peak of its cycle.',
    drawback: 'Output swings down to 55% and back every 4 seconds. Time your exits.',
    curve: {
      launchBoost: 0.4,
      topEndFactor: 1.05,
      cyclePeriodSeconds: 4,
      cycleLowFactor: 0.55,
    },
  }),
];

export const ENGINES: Record<string, EngineDefinition> = Object.fromEntries(
  ENGINE_LIST.map((e) => [e.id, e]),
);

export const ENGINE_FOUR_CYLINDER = ENGINES.engine_four_cylinder!;
