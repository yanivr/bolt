import type { PartModifier, PartParams, TireDefinition } from '@bolt/shared';

/**
 * The twenty wheel kits of Section 11.4. Price and mass are for a set of four and scale with
 * the chassis wheel count. `grip` is the clear-weather asphalt multiplier from the table and
 * the "defining interaction" column is expressed as primitives. Wet weather means the rain,
 * heavy rain and snowfall presets (`WET_WEATHER`).
 */

type TireRow = {
  id: string;
  displayName: string;
  price: number;
  massKg: number;
  grip: number;
  powerDraw?: number;
  soundKey?: string;
  description: string;
  drawback: string;
  extra?: PartModifier[];
  params?: PartParams;
};

function tires(row: TireRow): TireDefinition {
  return {
    id: row.id,
    displayName: row.displayName,
    category: 'tires',
    price: row.price,
    massKg: row.massKg,
    // Sprite size of one wheel. The keep-out box on the chassis is the standard wheel well.
    footprint: { w: 8, h: 14 },
    compatibleMounts: ['WHEEL'],
    spriteKey: row.id,
    soundKey: row.soundKey ?? 'tires_road',
    description: row.description,
    drawback: row.drawback,
    modifiers: [
      { type: 'AddMass', kg: row.massKg },
      { type: 'ModifyGripBySurface', factor: row.grip },
      ...(row.extra ?? []),
    ],
    triggerMode: 'passive',
    params: { grip: row.grip, powerDraw: row.powerDraw ?? 0, ...row.params },
    grip: row.grip,
    powerDraw: row.powerDraw ?? 0,
  };
}

/** Share of a specialist's bonus that Adaptive Tires reproduce. */
export const ADAPT_SHARE = 0.2;

export const TIRE_LIST: TireDefinition[] = [
  tires({
    id: 'tires_slick',
    displayName: 'Slicks',
    price: 110,
    massKg: 48,
    grip: 1.22,
    description: 'The most grip you can buy on dry pavement.',
    drawback: 'Loses a quarter of its grip in wet weather.',
    extra: [{ type: 'ModifyGripBySurface', factor: 0.75, when: 'wet' }],
    params: { wetGripFactor: 0.75 },
  }),
  tires({
    id: 'tires_street',
    displayName: 'Street Tires',
    price: 80,
    massKg: 48,
    grip: 1,
    description: 'Predictable grip on every paved road.',
    drawback: 'No specialty surface.',
  }),
  tires({
    id: 'tires_rain',
    displayName: 'Rain Runners',
    price: 110,
    massKg: 54,
    grip: 0.96,
    description: 'Deep channels give 35% more grip in wet weather.',
    drawback: 'A touch less grip than street tires in the dry.',
    extra: [{ type: 'ModifyGripBySurface', factor: 1.35, when: 'wet' }],
    params: { wetGripFactor: 1.35 },
  }),
  tires({
    id: 'tires_sand',
    displayName: 'Sand Paddles',
    price: 125,
    massKg: 75,
    grip: 0.86,
    soundKey: 'tires_offroad',
    description: 'Paddle treads give 55% more grip on sand and float over it.',
    drawback: 'Heavy, and loose on pavement.',
    extra: [
      { type: 'ModifyGripBySurface', surfaces: ['sand'], factor: 1.55 },
      { type: 'ModifySteeringResponse', rollingSurfaces: ['sand'], rollingFactor: 0.6 },
    ],
    params: { sandGripFactor: 1.55, sandRollingFactor: 0.6 },
  }),
  tires({
    id: 'tires_mud',
    displayName: 'Mud Claws',
    price: 120,
    massKg: 76,
    grip: 0.86,
    soundKey: 'tires_offroad',
    description: 'Open lugs give 55% more grip in mud and clear themselves.',
    drawback: 'Heavy, and loose on pavement.',
    extra: [
      { type: 'ModifyGripBySurface', surfaces: ['mud'], factor: 1.55 },
      { type: 'ModifySteeringResponse', rollingSurfaces: ['mud'], rollingFactor: 0.6 },
    ],
    params: { mudGripFactor: 1.55, mudRollingFactor: 0.6 },
  }),
  tires({
    id: 'tires_snow',
    displayName: 'Snow Treads',
    price: 110,
    massKg: 59,
    grip: 0.92,
    soundKey: 'tires_offroad',
    description: 'Soft siped blocks give 48% more grip on snow.',
    drawback: 'Squirmy on dry pavement.',
    extra: [
      { type: 'ModifyGripBySurface', surfaces: ['snow'], factor: 1.48 },
      { type: 'ModifySteeringResponse', rollingSurfaces: ['snow'], rollingFactor: 0.7 },
    ],
    params: { snowGripFactor: 1.48, snowRollingFactor: 0.7 },
  }),
  tires({
    id: 'tires_ice',
    displayName: 'Ice Spikes',
    price: 125,
    massKg: 63,
    grip: 0.87,
    soundKey: 'tires_studded',
    description: 'Steel studs give 58% more grip on ice.',
    drawback: 'The studs drag on pavement and cost speed there.',
    extra: [
      { type: 'ModifyGripBySurface', surfaces: ['ice'], factor: 1.58 },
      {
        type: 'ModifySteeringResponse',
        rollingSurfaces: ['asphalt', 'cobble', 'metal'],
        rollingAdd: 6,
      },
    ],
    params: { iceGripFactor: 1.58, pavedRollingAdd: 6 },
  }),
  tires({
    id: 'tires_soft',
    displayName: 'Soft Compound',
    price: 115,
    massKg: 50,
    grip: 1.15,
    description: 'Sticky rubber: 15% more grip, wet or dry.',
    drawback: 'Wears after 90 seconds and ends up 15% down on grip.',
    extra: [
      { type: 'ModifySteeringResponse', wearStartSeconds: 90, wearRampSeconds: 30, wornGrip: 0.85 },
    ],
    params: { wearStartSeconds: 90, wearRampSeconds: 30, wornGripFactor: 0.85 },
  }),
  tires({
    id: 'tires_hard',
    displayName: 'Hard Compound',
    price: 90,
    massKg: 55,
    grip: 0.94,
    description: 'Tough rubber: wheels take 22% less damage.',
    drawback: 'A little less grip than street tires.',
    extra: [{ type: 'ModifyDamageByTag', tag: 'wheel', factor: 0.78 }],
    params: { wheelDamageFactor: 0.78 },
  }),
  tires({
    id: 'tires_drift',
    displayName: 'Drift Rings',
    price: 100,
    massKg: 52,
    grip: 0.92,
    description: 'Lets go early and smoothly, then keeps most of its grip in a slide.',
    drawback: 'Less outright grip, so slower through a clean corner.',
    extra: [{ type: 'ModifySlipRecovery', factor: 1.14, stiffness: 0.6, align: 1.15 }],
    params: { slideGripFactor: 1.14, breakawayStiffness: 0.6, selfAlignFactor: 1.15 },
  }),
  tires({
    id: 'tires_armored',
    displayName: 'Armored Tires',
    price: 150,
    massKg: 102,
    grip: 0.9,
    soundKey: 'tires_heavy',
    description: 'Steel-belted: wheel integrity up 55%.',
    drawback: 'More than twice the weight of street tires.',
    extra: [{ type: 'ModifyIntegrity', target: 'wheels', factor: 1.55 }],
    params: { wheelIntegrityFactor: 1.55 },
  }),
  tires({
    id: 'tires_solid',
    displayName: 'Solid Core',
    price: 140,
    massKg: 88,
    grip: 0.88,
    soundKey: 'tires_heavy',
    description: 'No air to lose: puncture effects cut by 85%.',
    drawback: 'Heavy, with a hard ride and less grip.',
    extra: [{ type: 'ModifyDamageByTag', tag: 'puncture', factor: 0.15 }],
    params: { punctureEffectFactor: 0.15 },
  }),
  tires({
    id: 'tires_balloon',
    displayName: 'Balloon Tires',
    price: 105,
    massKg: 72,
    grip: 0.85,
    soundKey: 'tires_offroad',
    description: 'Fat and soft: walls and obstacles hit 25% less hard.',
    drawback: 'Vague steering and the least grip of the road kits.',
    extra: [{ type: 'ModifyImpulse', kind: 'obstacle', factor: 0.75 }],
    params: { obstacleImpulseFactor: 0.75, rideHeight: 1 },
  }),
  tires({
    id: 'tires_monster',
    displayName: 'Monster Wheels',
    price: 145,
    massKg: 120,
    grip: 0.91,
    soundKey: 'tires_heavy',
    description: 'Rolls over rough ground: no grip lost off the road and softer strikes.',
    drawback: 'Very heavy, and the ride height costs stability.',
    extra: [
      { type: 'ModifyImpulse', kind: 'obstacle', factor: 0.8 },
      {
        type: 'ModifySteeringResponse',
        shoulderPenalty: 0,
        rollingSurfaces: ['sand', 'dirt', 'mud', 'snow'],
        rollingFactor: 0.8,
      },
    ],
    params: {
      obstacleImpulseFactor: 0.8,
      shoulderGripPenaltyFactor: 0,
      looseRollingFactor: 0.8,
      rideHeight: 6,
    },
  }),
  tires({
    id: 'tires_micro',
    displayName: 'Micro Wheels',
    price: 65,
    massKg: 32,
    grip: 1.03,
    description: 'Tiny and light: 3% more top speed on paved roads.',
    drawback: 'Walls and obstacles hit 30% harder, and the shoulder costs more grip.',
    extra: [
      { type: 'ModifySteeringResponse', roadSpeed: 1.03, shoulderPenalty: 1.8 },
      { type: 'ModifyImpulse', kind: 'obstacle', factor: 1.3 },
    ],
    params: {
      roadSpeedFactor: 1.03,
      obstacleImpulseFactor: 1.3,
      shoulderGripPenaltyFactor: 1.8,
      rideHeight: -2,
    },
  }),
  tires({
    id: 'tires_halftrack',
    displayName: 'Half Tracks',
    price: 155,
    massKg: 150,
    grip: 0.83,
    soundKey: 'tires_track',
    description: 'Tracked rear drive: 35% more grip on dirt and mud.',
    drawback: 'Three times the weight of street tires.',
    extra: [
      { type: 'ModifyGripBySurface', surfaces: ['dirt', 'mud'], factor: 1.35 },
      { type: 'ModifySteeringResponse', stability: 4 },
    ],
    params: { dirtMudGripFactor: 1.35, stabilityBonus: 4 },
  }),
  tires({
    id: 'tires_track',
    displayName: 'Full Tracks',
    price: 190,
    massKg: 210,
    grip: 0.78,
    soundKey: 'tires_track',
    description: 'Full tracks: 55% more grip in mud and a very planted car.',
    drawback: 'Top speed on paved roads drops 20%. The heaviest kit there is.',
    extra: [
      { type: 'ModifyGripBySurface', surfaces: ['mud'], factor: 1.55 },
      { type: 'ModifySteeringResponse', roadSpeed: 0.8, stability: 8 },
    ],
    params: { mudGripFactor: 1.55, roadSpeedFactor: 0.8, stabilityBonus: 8 },
  }),
  tires({
    id: 'tires_magnetic',
    displayName: 'Magnetic Rollers',
    price: 165,
    massKg: 108,
    grip: 0.91,
    powerDraw: 5,
    soundKey: 'tires_heavy',
    description: 'Electromagnets give 45% more grip on metal surfaces.',
    drawback: 'Draws 5 power a second, and the bonus fades without it.',
    extra: [
      {
        type: 'ModifyPowerPriority',
        draw: 5,
        priority: 1,
        effect: { surfaceGrip: { metal: 0.45 } },
      },
    ],
    params: { metalGripFactor: 1.45 },
  }),
  tires({
    id: 'tires_adaptive',
    displayName: 'Adaptive Tires',
    price: 190,
    massKg: 95,
    grip: 1.02,
    powerDraw: 6,
    description: "Reshapes its tread to give a fifth of every specialist kit's bonus.",
    drawback: 'Expensive, and draws 6 power a second to do it.',
    extra: [
      {
        type: 'ModifyPowerPriority',
        draw: 6,
        priority: 1,
        // "Adapts 20% toward best terrain grip": one fifth of the best specialist bonus the
        // catalog offers for each terrain and for wet weather. A test derives these from
        // the specialist kits, so they cannot drift apart.
        effect: {
          surfaceGrip: {
            sand: ADAPT_SHARE * 0.55,
            mud: ADAPT_SHARE * 0.55,
            snow: ADAPT_SHARE * 0.48,
            ice: ADAPT_SHARE * 0.58,
            metal: ADAPT_SHARE * 0.45,
            dirt: ADAPT_SHARE * 0.35,
          },
          wetGrip: ADAPT_SHARE * 0.35,
        },
      },
    ],
    params: { adaptShare: ADAPT_SHARE },
  }),
  tires({
    id: 'tires_blades',
    displayName: 'Razor Wheels',
    price: 145,
    massKg: 85,
    grip: 0.93,
    soundKey: 'tires_heavy',
    description: 'Bladed hubs cut 6 damage into a rival that rubs your side.',
    drawback: 'The hubs are fragile: 20% less wheel integrity.',
    extra: [{ type: 'ModifyIntegrity', target: 'wheels', factor: 0.8 }],
    params: {
      wheelIntegrityFactor: 0.8,
      contactDamage: 6,
      contactCooldownSeconds: 1.2,
      contactMinClosingSpeed: 20,
    },
  }),
];

export const TIRES: Record<string, TireDefinition> = Object.fromEntries(
  TIRE_LIST.map((t) => [t.id, t]),
);

export const TIRES_STREET = TIRES.tires_street!;
