import type { BusId, Category, Curve, Layer, Pt, Recipe, Wave } from './recipe.js';

/**
 * Every one-shot and loop in the game, as data. Read a recipe as a chip tune programmer
 * would: which channels, what pitch movement, what envelope. The `note` is the design intent
 * (Section 13.4 gives each weapon its character) and is printed in docs/AUDIO_GUIDE.md.
 *
 * Levels are not set here. Each recipe is rendered alone and measured, and
 * `sfxTrim.ts` (generated, see the guide) holds the gain that puts it on its category's
 * loudness target.
 */

/** Equal-tempered pitch of a MIDI note number. */
export const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

type Extra = Partial<Pick<Layer, 'glide' | 'g' | 'at' | 'fm' | 'lfo' | 'flt' | 'crush'>>;

const L = (w: Wave, f: Curve, env: readonly Pt[], extra: Extra = {}): Layer => ({
  w,
  f,
  env,
  ...extra,
});

/** Instant attack, then a fall over `d` seconds. */
const pluck = (d: number, a = 0.003): Pt[] => [
  [a, 1],
  [d, 0],
];
/** Attack `a`, hold to `h`, gone by `d`. */
const hold = (a: number, h: number, d: number, level = 1): Pt[] => [
  [a, level],
  [h, level],
  [d, 0],
];
/** A loop envelope: fade in over `a` and stay. */
const sustain = (a: number, level = 1): Pt[] => [[a, level]];
/** Steps through pitches, each `step` seconds long: an arpeggio. */
const arp = (notes: readonly number[], step: number, start = 0): Pt[] =>
  notes.map((n, i) => [start + i * step, n] as const);
/** Repeated blips: `count` pulses of `on` seconds every `every` seconds. */
const blips = (count: number, every: number, on: number, level = 1): Pt[] => {
  const pts: Pt[] = [];
  for (let i = 0; i < count; i++) {
    const t = i * every;
    pts.push([t + 0.003, level], [t + on, level], [t + on + 0.008, 0]);
    if (i < count - 1) pts.push([t + every, 0]);
  }
  return pts;
};

type Options = Partial<Pick<Recipe, 'loop' | 'release' | 'limitMs' | 'poly' | 'duck'>>;

const list: Recipe[] = [];
function add(
  id: string,
  bus: BusId,
  cat: Category,
  pri: number,
  note: string,
  layers: Layer[],
  options: Options = {},
): void {
  list.push({ id, bus, cat, pri, note, layers, ...options });
}

// --- Interface -----------------------------------------------------------------------------

add(
  'ui_tap',
  'ui',
  'ui',
  30,
  'Button press: one soft high pulse blip.',
  [L('p25', hz(81), pluck(0.05))],
  { limitMs: 40 },
);
add(
  'ui_select',
  'ui',
  'ui',
  30,
  'Choosing an item in a list: a blip that steps up a fifth.',
  [L('p25', arp([hz(76), hz(83)], 0.035), pluck(0.09), { glide: 'step' })],
  { limitMs: 40 },
);
add('ui_confirm', 'ui', 'ui', 40, 'Confirm: a bright major third going up, two notes.', [
  L('sq', arp([hz(72), hz(76), hz(79)], 0.05), hold(0.003, 0.12, 0.2), { glide: 'step' }),
  L('tri', arp([hz(60), hz(64), hz(67)], 0.05), hold(0.003, 0.1, 0.18), { glide: 'step', g: 0.7 }),
]);
add('ui_back', 'ui', 'ui', 30, 'Back or cancel: the confirm in reverse, falling, softer.', [
  L('p25', arp([hz(74), hz(69)], 0.05), pluck(0.13), { glide: 'step' }),
]);
add(
  'ui_deny',
  'ui',
  'ui',
  45,
  'Not allowed: a low double buzz, clearly different from a tap.',
  [
    L('sq', hz(52), blips(2, 0.09, 0.055), { crush: 12 }),
    L('sq', hz(52.4), blips(2, 0.09, 0.055), { g: 0.6 }),
  ],
  { limitMs: 150 },
);
add(
  'ui_illegal',
  'ui',
  'ui',
  45,
  'Illegal placement in the garage: a rubbery downward bonk.',
  [
    L(
      'tri',
      [
        [0, hz(72)],
        [0.12, hz(60)],
      ],
      pluck(0.16),
    ),
    L(
      'sq',
      [
        [0, hz(60)],
        [0.12, hz(53)],
      ],
      pluck(0.12),
      { g: 0.35, crush: 10 },
    ),
  ],
  { limitMs: 150 },
);
add('ui_toggle_on', 'ui', 'ui', 30, 'Switch on: a short step up.', [
  L('p12', arp([hz(72), hz(79)], 0.04), pluck(0.1), { glide: 'step' }),
]);
add('ui_toggle_off', 'ui', 'ui', 30, 'Switch off: a short step down.', [
  L('p12', arp([hz(79), hz(72)], 0.04), pluck(0.1), { glide: 'step' }),
]);
add(
  'ui_slider',
  'ui',
  'ui',
  20,
  'Slider tick: the quietest click in the game.',
  [L('tri', hz(88), pluck(0.025))],
  { limitMs: 70 },
);
add('ui_open', 'ui', 'ui', 30, 'Overlay opens: a quick rising sweep.', [
  L(
    'tri',
    [
      [0, hz(60)],
      [0.1, hz(79)],
    ],
    pluck(0.13),
  ),
]);
add('ui_close', 'ui', 'ui', 30, 'Overlay closes: a quick falling sweep.', [
  L(
    'tri',
    [
      [0, hz(79)],
      [0.1, hz(60)],
    ],
    pluck(0.13),
  ),
]);
add('ui_remove', 'ui', 'ui', 35, 'Part removed: a hollow unscrewing pop, pitch dropping.', [
  L(
    'sq',
    [
      [0, hz(67)],
      [0.09, hz(52)],
    ],
    pluck(0.11),
    { flt: { t: 'lp', f: 1800 } },
  ),
  L('lfsr', 0.5, pluck(0.04), { g: 0.4 }),
]);
add(
  'ui_rotate',
  'ui',
  'ui',
  30,
  'Part turned a quarter: two dry ratchet clicks.',
  [L('metal', 1.6, blips(2, 0.045, 0.012)), L('p25', hz(84), blips(2, 0.045, 0.012), { g: 0.5 })],
  { limitMs: 60 },
);
add('ui_ready', 'ui', 'stinger', 60, 'Ready: a four-note rising fanfare with a held top note.', [
  L('sq', arp([hz(67), hz(72), hz(76), hz(84)], 0.07), hold(0.003, 0.38, 0.6), { glide: 'step' }),
  L('p25', arp([hz(55), hz(60), hz(64), hz(72)], 0.07), hold(0.003, 0.36, 0.55), {
    glide: 'step',
    g: 0.6,
  }),
  L('tri', arp([hz(43), hz(48), hz(52), hz(48)], 0.07), hold(0.003, 0.36, 0.55), {
    glide: 'step',
    g: 0.8,
  }),
]);
add(
  'ui_timer_tick',
  'ui',
  'ui',
  50,
  'Build clock, last ten seconds: one woodblock tick a second.',
  [L('sq', hz(79), pluck(0.045), { flt: { t: 'bp', f: 1600, q: 3 } })],
);
add(
  'ui_timer_urgent',
  'ui',
  'race',
  55,
  'Build clock, last three seconds: a higher, doubled tick.',
  [L('sq', hz(86), blips(2, 0.08, 0.04)), L('tri', hz(74), blips(2, 0.08, 0.04), { g: 0.6 })],
);
add('ui_timer_end', 'ui', 'race', 60, 'Build clock ran out: a long flat buzzer.', [
  L('sq', hz(64), hold(0.004, 0.42, 0.5), { crush: 10 }),
  L('saw', hz(52), hold(0.004, 0.42, 0.5), { g: 0.6 }),
]);
add('ui_save', 'ui', 'ui', 40, 'Blueprint saved: two glassy bell notes.', [
  L('sin', arp([hz(84), hz(91)], 0.08), hold(0.003, 0.1, 0.34), {
    glide: 'step',
    fm: { ratio: 3.5, index: 1.2, decay: 0.2 },
  }),
]);
add('ui_error', 'ui', 'ui', 50, 'Something failed (connection, load): three falling minor notes.', [
  L('p25', arp([hz(70), hz(66), hz(61)], 0.09), hold(0.003, 0.24, 0.36), { glide: 'step' }),
  L('tri', arp([hz(46), hz(42), hz(37)], 0.09), hold(0.003, 0.24, 0.36), { glide: 'step', g: 0.8 }),
]);

// --- Installing parts in the garage --------------------------------------------------------

add(
  'install_chassis_light',
  'ui',
  'install',
  40,
  'Light chassis set down: a thin panel clap and a short ring.',
  [
    L('noise', 0.9, pluck(0.05), { flt: { t: 'bp', f: 2400, q: 1.2 } }),
    L(
      'tri',
      [
        [0, hz(69)],
        [0.1, hz(62)],
      ],
      pluck(0.16),
      { g: 0.7 },
    ),
  ],
);
add(
  'install_chassis_heavy',
  'ui',
  'install',
  40,
  'Heavy chassis set down: a low slam with a slow settle.',
  [
    L('noise', 0.4, pluck(0.12), { flt: { t: 'lp', f: 1500 } }),
    L(
      'tri',
      [
        [0, hz(50)],
        [0.2, hz(40)],
      ],
      pluck(0.28),
      { g: 0.3 },
    ),
    L('sq', hz(45), pluck(0.12), { g: 0.5, crush: 8 }),
  ],
);
add(
  'install_tires_road',
  'ui',
  'install',
  40,
  'Road tires on: a rubber squeak then a wheel-nut zip.',
  [
    L(
      'saw',
      [
        [0, hz(74)],
        [0.06, hz(81)],
      ],
      pluck(0.07),
      { flt: { t: 'bp', f: 2000, q: 6 }, g: 0.7 },
    ),
    L(
      'p25',
      [
        [0.08, hz(60)],
        [0.2, hz(72)],
      ],
      [
        [0.083, 1],
        [0.2, 0.8],
        [0.22, 0],
      ],
      { lfo: { w: 'sq', hz: 38, depth: 0.9, to: 'amp' } },
    ),
  ],
);
add(
  'install_tires_offroad',
  'ui',
  'install',
  40,
  'Knobbly tires on: a lower, grittier zip with a thud.',
  [
    L('lfsr', 0.3, pluck(0.08), { flt: { t: 'lp', f: 1200 } }),
    L(
      'p25',
      [
        [0.06, hz(52)],
        [0.2, hz(62)],
      ],
      [
        [0.063, 1],
        [0.2, 0.8],
        [0.22, 0],
      ],
      { lfo: { w: 'sq', hz: 26, depth: 0.9, to: 'amp' } },
    ),
  ],
);
add(
  'install_tires_studded',
  'ui',
  'install',
  40,
  'Studded tires on: a zip with small metal ticks in it.',
  [
    L('metal', 2.4, blips(4, 0.035, 0.01), { g: 0.8 }),
    L(
      'p25',
      [
        [0.05, hz(62)],
        [0.2, hz(74)],
      ],
      [
        [0.053, 1],
        [0.2, 0.8],
        [0.22, 0],
      ],
      { lfo: { w: 'sq', hz: 34, depth: 0.9, to: 'amp' } },
    ),
  ],
);
add(
  'install_tires_heavy',
  'ui',
  'install',
  40,
  'Heavy tires on: a deep double thump and a slow zip.',
  [
    L(
      'tri',
      [
        [0, hz(55)],
        [0.08, hz(45)],
      ],
      blips(2, 0.09, 0.06),
    ),
    L(
      'p25',
      [
        [0.12, hz(57)],
        [0.3, hz(64)],
      ],
      [
        [0.123, 0.8],
        [0.3, 0.7],
        [0.32, 0],
      ],
      { lfo: { w: 'sq', hz: 20, depth: 0.9, to: 'amp' } },
    ),
  ],
);
add('install_tires_track', 'ui', 'install', 40, 'Tracks on: a rolling clatter of links.', [
  L('metal', 0.9, blips(6, 0.04, 0.016)),
  L('sq', hz(40), blips(6, 0.04, 0.016), { g: 0.5 }),
]);
add(
  'install_engine',
  'ui',
  'install',
  40,
  'Engine dropped in: a block clunk, then the engine itself barks once.',
  [
    L('noise', 0.5, pluck(0.07), { flt: { t: 'lp', f: 1700 } }),
    L(
      'sq',
      [
        [0, hz(57)],
        [0.07, hz(50)],
      ],
      pluck(0.11),
      { crush: 10 },
    ),
  ],
);
add(
  'install_weapon',
  'ui',
  'install',
  40,
  'Weapon mounted: a bolt slide and a latch, like racking a slide.',
  [
    L(
      'metal',
      [
        [0, 1.2],
        [0.07, 2.4],
      ],
      hold(0.003, 0.06, 0.08),
      { glide: 'lin' },
    ),
    L('sq', hz(57), pluck(0.05), { at: 0.1, crush: 8 }),
    L('noise', 1, pluck(0.03), { at: 0.1, g: 0.6, flt: { t: 'hp', f: 2500 } }),
  ],
);
add(
  'install_plate',
  'ui',
  'install',
  40,
  'Armor plate bolted on: a plate clank with an anvil ring.',
  [
    L('sin', hz(69), pluck(0.22), { fm: { ratio: 2.76, index: 2.5, decay: 0.12 } }),
    L('noise', 0.7, pluck(0.03), { flt: { t: 'bp', f: 3200, q: 1 }, g: 0.6 }),
  ],
);
add('install_shield', 'ui', 'install', 40, 'Shield emitter fitted: a soft rising shimmer.', [
  L(
    'sin',
    [
      [0, hz(72)],
      [0.25, hz(84)],
    ],
    hold(0.02, 0.18, 0.3),
    { lfo: { w: 'sin', hz: 22, depth: 0.5, to: 'amp' } },
  ),
  L(
    'p12',
    [
      [0, hz(84)],
      [0.25, hz(96)],
    ],
    hold(0.02, 0.18, 0.3),
    { g: 0.25 },
  ),
]);
add(
  'install_system',
  'ui',
  'install',
  40,
  'Passive defense system fitted: a relay click and a confirm tone.',
  [
    L('metal', 2, pluck(0.015)),
    L(
      'p25',
      arp([hz(69), hz(76)], 0.06, 0.03),
      [
        [0.033, 1],
        [0.13, 0.8],
        [0.2, 0],
      ],
      { glide: 'step' },
    ),
  ],
);
add(
  'install_interceptor',
  'ui',
  'install',
  40,
  'Interceptor fitted: a servo chirp and a radar ping.',
  [
    L(
      'saw',
      [
        [0, hz(60)],
        [0.08, hz(72)],
      ],
      pluck(0.09),
      { flt: { t: 'lp', f: 2200 }, g: 0.6 },
    ),
    L('sin', hz(93), pluck(0.22), { at: 0.1 }),
  ],
);
add('install_repair', 'ui', 'install', 40, 'Repair gear stowed: a toolbox rattle and a ratchet.', [
  L('metal', 1.3, blips(3, 0.05, 0.014)),
  L('noise', 0.6, pluck(0.05), { at: 0.15, flt: { t: 'bp', f: 1500, q: 1 } }),
]);
add('install_nitro', 'ui', 'install', 40, 'Boost tank fitted: a valve hiss that rises in pitch.', [
  L('noise', 1, hold(0.01, 0.16, 0.24), {
    flt: {
      t: 'bp',
      f: [
        [0, 1800],
        [0.22, 5200],
      ],
      q: 2.5,
    },
  }),
  L('tri', hz(52), pluck(0.06), { g: 0.6 }),
]);
add('install_fan', 'ui', 'install', 40, 'Cooling part fitted: a small fan spinning up.', [
  L(
    'saw',
    [
      [0, hz(45)],
      [0.26, hz(69)],
    ],
    hold(0.02, 0.22, 0.32),
    { lfo: { w: 'tri', hz: 30, depth: 0.6, to: 'amp' }, flt: { t: 'lp', f: 1600 } },
  ),
  L('noise', 1, hold(0.05, 0.22, 0.32), { g: 0.35, flt: { t: 'hp', f: 3000 } }),
]);
add(
  'install_power',
  'ui',
  'install',
  40,
  'Electrical part fitted: a capacitor charging hum that clicks in.',
  [
    L(
      'saw',
      [
        [0, hz(48)],
        [0.2, hz(60)],
      ],
      hold(0.01, 0.18, 0.22),
      { flt: { t: 'lp', f: 900 }, crush: 12 },
    ),
    L('p12', hz(84), pluck(0.05), { at: 0.2 }),
  ],
);
add('install_computer', 'ui', 'install', 40, 'Computer or sensor fitted: a burst of data blips.', [
  L('p12', arp([hz(84), hz(91), hz(79), hz(96), hz(88)], 0.035), hold(0.003, 0.17, 0.2), {
    glide: 'step',
  }),
]);
add('install_servo', 'ui', 'install', 40, 'Moving part fitted: a servo travelling and stopping.', [
  L(
    'saw',
    [
      [0, hz(50)],
      [0.16, hz(62)],
      [0.2, hz(58)],
    ],
    hold(0.01, 0.18, 0.22),
    { flt: { t: 'bp', f: 1100, q: 3 } },
  ),
  L('metal', 1.5, pluck(0.02), { at: 0.2 }),
]);

// --- The race ------------------------------------------------------------------------------

add('race_count', 'ui', 'race', 80, 'Countdown light: a short square beep at A4.', [
  L('sq', hz(69), hold(0.003, 0.1, 0.16)),
  L('tri', hz(57), hold(0.003, 0.1, 0.16), { g: 0.6 }),
]);
add('race_go', 'ui', 'stinger', 90, 'GO: the same beep an octave up, held, with a rising tail.', [
  L(
    'sq',
    [
      [0, hz(81)],
      [0.3, hz(81)],
      [0.5, hz(84)],
    ],
    hold(0.003, 0.34, 0.55),
    { glide: 'lin' },
  ),
  L('p25', hz(93), hold(0.003, 0.3, 0.5), { g: 0.4 }),
  L('tri', hz(57), hold(0.003, 0.34, 0.5), { g: 0.8 }),
]);
add(
  'checkpoint_tick',
  'ui',
  'ui',
  15,
  'Checkpoint crossed: a faint high tick, barely there.',
  [L('tri', hz(91), pluck(0.035))],
  { limitMs: 200 },
);
add('lap_chime', 'ui', 'race', 70, 'Lap completed: a three-note major arpeggio.', [
  L('sq', arp([hz(72), hz(76), hz(79)], 0.07), hold(0.003, 0.22, 0.36), { glide: 'step' }),
  L('tri', hz(48), hold(0.003, 0.22, 0.34), { g: 0.7 }),
]);
add('final_lap', 'ui', 'stinger', 85, 'Final lap: an urgent repeated fanfare figure.', [
  L(
    'sq',
    arp([hz(79), hz(79), hz(79), hz(84), hz(79), hz(84), hz(88)], 0.075),
    hold(0.003, 0.56, 0.75),
    { glide: 'step' },
  ),
  L(
    'p25',
    arp([hz(67), hz(67), hz(67), hz(72), hz(67), hz(72), hz(76)], 0.075),
    hold(0.003, 0.56, 0.72),
    { glide: 'step', g: 0.6 },
  ),
  L('tri', arp([hz(43), hz(43), hz(48), hz(52)], 0.15), hold(0.003, 0.56, 0.72), {
    glide: 'step',
    g: 0.9,
  }),
]);
add(
  'pos_gain',
  'ui',
  'race',
  65,
  'Took the lead: a fast run up an octave.',
  [
    L('p25', arp([hz(72), hz(76), hz(79), hz(84)], 0.04), hold(0.003, 0.16, 0.26), {
      glide: 'step',
    }),
  ],
  { limitMs: 500 },
);
add(
  'pos_loss',
  'ui',
  'race',
  65,
  'Lost the lead: the same run falling, into a minor third.',
  [
    L('p25', arp([hz(79), hz(75), hz(72), hz(67)], 0.045), hold(0.003, 0.18, 0.28), {
      glide: 'step',
    }),
    L('tri', hz(43), pluck(0.2), { g: 0.6 }),
  ],
  { limitMs: 500 },
);
add('finish_line', 'ui', 'race', 80, 'Crossed the line: a flag flourish, quick up-and-over.', [
  L('sq', arp([hz(76), hz(79), hz(84), hz(79), hz(84)], 0.05), hold(0.003, 0.25, 0.4), {
    glide: 'step',
  }),
  L('noise', 1, hold(0.01, 0.2, 0.4), { g: 0.3, flt: { t: 'hp', f: 5000 } }),
]);
add(
  'stinger_win',
  'ui',
  'stinger',
  95,
  'You won: a triumphant rising phrase resolving on a long major chord.',
  [
    L(
      'sq',
      arp([hz(72), hz(76), hz(79), hz(84), hz(79), hz(84), hz(88)], 0.11),
      hold(0.003, 1.2, 1.7),
      { glide: 'step' },
    ),
    L(
      'p25',
      arp([hz(64), hz(67), hz(72), hz(76), hz(72), hz(76), hz(79)], 0.11),
      hold(0.003, 1.2, 1.65),
      { glide: 'step', g: 0.6 },
    ),
    L(
      'tri',
      arp([hz(48), hz(48), hz(43), hz(48), hz(53), hz(55), hz(48)], 0.11),
      hold(0.003, 1.2, 1.65),
      { glide: 'step' },
    ),
    L('lfsr', 1, blips(7, 0.11, 0.03), { g: 0.25, flt: { t: 'hp', f: 6000 } }),
  ],
  { duck: 0.8 },
);
add(
  'stinger_lose',
  'ui',
  'stinger',
  95,
  'You lost: a slow falling minor phrase that sags at the end.',
  [
    L(
      'p25',
      [
        [0, hz(70)],
        [0.2, hz(70)],
        [0.21, hz(67)],
        [0.42, hz(67)],
        [0.43, hz(63)],
        [0.7, hz(63)],
        [1.3, hz(58)],
      ],
      hold(0.003, 1.0, 1.4),
      { glide: 'lin' },
    ),
    L(
      'tri',
      [
        [0, hz(46)],
        [0.42, hz(46)],
        [0.43, hz(39)],
        [1.3, hz(34)],
      ],
      hold(0.003, 1.0, 1.4),
      { glide: 'lin' },
    ),
  ],
  { duck: 0.8 },
);
add(
  'stinger_draw',
  'ui',
  'stinger',
  95,
  'A draw: a level, unresolved phrase that neither rises nor falls.',
  [
    L('sq', arp([hz(72), hz(74), hz(72), hz(74), hz(72)], 0.13), hold(0.003, 0.7, 1.0), {
      glide: 'step',
    }),
    L('tri', hz(48), hold(0.003, 0.7, 1.0)),
  ],
  { duck: 0.8 },
);

// --- Warnings ------------------------------------------------------------------------------

add(
  'warn_lock',
  'alerts',
  'alert',
  100,
  'A rival weapon has a lock: a steady two-tone beep, about three a second.',
  [
    L('sq', hz(81), sustain(0.004), { lfo: { w: 'sq', hz: 3, depth: 1, to: 'amp' } }),
    L('p25', hz(88), sustain(0.004, 0.4), { lfo: { w: 'sq', hz: 3, depth: 1, to: 'amp' } }),
  ],
  { loop: true, release: 0.05, poly: 1 },
);
add(
  'warn_missile',
  'alerts',
  'alert',
  100,
  'Guided missile inbound: the lock tone a fourth up and three times as fast.',
  [
    L('sq', hz(86), sustain(0.004), { lfo: { w: 'sq', hz: 9, depth: 1, to: 'amp' } }),
    L('saw', hz(98), sustain(0.004, 0.5), {
      lfo: { w: 'sq', hz: 9, depth: 1, to: 'amp' },
      flt: { t: 'lp', f: 5000 },
    }),
  ],
  { loop: true, release: 0.04, poly: 1, duck: 0.5 },
);
add(
  'warn_clear',
  'alerts',
  'alert',
  60,
  'Lock lost or missile gone: one soft falling note of relief.',
  [
    L(
      'tri',
      [
        [0, hz(84)],
        [0.14, hz(72)],
      ],
      pluck(0.18),
    ),
  ],
);
add(
  'warn_trap',
  'alerts',
  'alert',
  90,
  'Mine Detector: a sonar ping with a long tail.',
  [L('sin', hz(88), pluck(0.42)), L('sin', hz(88), pluck(0.3), { at: 0.16, g: 0.35 })],
  { limitMs: 400 },
);
add(
  'warn_heat',
  'alerts',
  'alert',
  85,
  'Running hot: two rising steam-whistle notes.',
  [
    L('p25', arp([hz(77), hz(80)], 0.11), hold(0.003, 0.2, 0.26), { glide: 'step' }),
    L('noise', 1, hold(0.01, 0.2, 0.26), { g: 0.3, flt: { t: 'bp', f: 4200, q: 3 } }),
  ],
  { limitMs: 2500 },
);
add(
  'warn_overheat',
  'alerts',
  'alert',
  95,
  'Thermal protection cut in: a klaxon, three harsh pulses.',
  [
    L(
      'saw',
      [
        [0, hz(62)],
        [0.12, hz(67)],
        [0.15, hz(62)],
        [0.27, hz(67)],
        [0.3, hz(62)],
        [0.42, hz(67)],
      ],
      blips(3, 0.15, 0.12),
      { glide: 'lin', flt: { t: 'lp', f: 2600 } },
    ),
    L('sq', hz(50), blips(3, 0.15, 0.12), { g: 0.5, crush: 8 }),
  ],
  { limitMs: 2500, duck: 0.4 },
);
add(
  'warn_low_power',
  'alerts',
  'alert',
  85,
  'Battery nearly flat: a drooping three-note run-down.',
  [
    L(
      'p12',
      [
        [0, hz(76)],
        [0.09, hz(76)],
        [0.1, hz(71)],
        [0.19, hz(71)],
        [0.2, hz(64)],
        [0.45, hz(57)],
      ],
      hold(0.003, 0.36, 0.48),
      { glide: 'lin' },
    ),
  ],
  { limitMs: 2500 },
);
add(
  'part_critical',
  'alerts',
  'alert',
  90,
  'A component of your car is critical: a low double alarm.',
  [
    L('sq', hz(64), blips(2, 0.13, 0.09)),
    L('saw', hz(52), blips(2, 0.13, 0.09), { g: 0.6, flt: { t: 'lp', f: 1800 } }),
  ],
  { limitMs: 600 },
);
// --- Weapons -------------------------------------------------------------------------------

add(
  'mg_fire',
  'weapons',
  'fire_small',
  50,
  'Front Machine Gun round: a rapid dry staccato crack, low and boxy.',
  [
    L(
      'lfsr',
      [
        [0, 1],
        [0.05, 0.4],
      ],
      pluck(0.055),
      { flt: { t: 'bp', f: 1500, q: 0.8 } },
    ),
    L(
      'sq',
      [
        [0, 300],
        [0.04, 120],
      ],
      pluck(0.045),
      { g: 0.6 },
    ),
  ],
  { limitMs: 60, poly: 3 },
);
add(
  'sentry_pivot',
  'weapons',
  'mech',
  40,
  'Rear Sentry turning to its target: a stepped servo climb.',
  [
    L('p12', arp([hz(64), hz(67), hz(71), hz(74), hz(77)], 0.045), hold(0.003, 0.2, 0.25), {
      glide: 'step',
      flt: { t: 'bp', f: 2600, q: 2 },
    }),
    L('metal', 2.2, blips(5, 0.045, 0.01), { g: 0.4 }),
  ],
  { limitMs: 300 },
);
add(
  'sentry_fire',
  'weapons',
  'fire_small',
  50,
  'Rear Sentry round: thinner and higher than the front gun, a tinny snap.',
  [
    L(
      'metal',
      [
        [0, 3.2],
        [0.03, 1.8],
      ],
      pluck(0.035),
      { flt: { t: 'hp', f: 1800 } },
    ),
    L(
      'p12',
      [
        [0, 620],
        [0.03, 310],
      ],
      pluck(0.03),
      { g: 0.7 },
    ),
  ],
  { limitMs: 60, poly: 3 },
);
add(
  'turret_lock',
  'weapons',
  'mech',
  45,
  'Swivel Turret aim tick: one hard red tick after a short traverse whirr.',
  [
    L(
      'saw',
      [
        [0, hz(55)],
        [0.08, hz(62)],
      ],
      hold(0.005, 0.07, 0.085),
      { flt: { t: 'bp', f: 900, q: 4 }, g: 0.6 },
    ),
    L('sq', hz(96), pluck(0.03), { at: 0.09 }),
  ],
  { limitMs: 300 },
);
add(
  'turret_fire',
  'weapons',
  'fire_small',
  55,
  'Swivel Turret round: a heavier, slower thock with a barrel kick under it.',
  [
    L(
      'noise',
      [
        [0, 0.5],
        [0.09, 0.15],
      ],
      pluck(0.1),
      {
        flt: {
          t: 'lp',
          f: [
            [0, 3400],
            [0.09, 700],
          ],
        },
      },
    ),
    L(
      'tri',
      [
        [0, 170],
        [0.08, 60],
      ],
      pluck(0.1),
      { g: 0.55 },
    ),
    L(
      'sq',
      [
        [0, 420],
        [0.03, 150],
      ],
      pluck(0.04),
      { g: 0.7 },
    ),
  ],
  { limitMs: 70, poly: 3 },
);
add(
  'shotgun_fire',
  'weapons',
  'fire_big',
  70,
  'Road Shotgun: one huge wide boom with a hard crack on top and a rattling pellet tail.',
  [
    L(
      'noise',
      [
        [0, 1],
        [0.3, 0.2],
      ],
      [
        [0.003, 1],
        [0.06, 0.6],
        [0.34, 0],
      ],
      {
        flt: {
          t: 'lp',
          f: [
            [0, 7000],
            [0.3, 500],
          ],
        },
      },
    ),
    L('noise', 1, pluck(0.05), { flt: { t: 'hp', f: 2600 } }),
    L(
      'tri',
      [
        [0, 130],
        [0.22, 45],
      ],
      pluck(0.26),
      { g: 0.55 },
    ),
    L(
      'lfsr',
      0.7,
      [
        [0.003, 0.8],
        [0.03, 0.25],
        [0.3, 0],
      ],
      {
        g: 0.7,
        crush: 6,
        flt: { t: 'hp', f: 1200 },
        lfo: { w: 'sq', hz: 47, depth: 0.8, to: 'amp' },
      },
    ),
  ],
  { limitMs: 200, duck: 0.5 },
);
add(
  'rail_charge',
  'weapons',
  'mech',
  60,
  'Needle Railgun charging: six rising stages, each brighter, over 0.8 s.',
  [
    L(
      'p25',
      arp([hz(57), hz(62), hz(67), hz(72), hz(77), hz(84)], 0.133),
      [
        [0.003, 0.3],
        [0.78, 1],
        [0.8, 0],
      ],
      { glide: 'step' },
    ),
    L(
      'sin',
      [
        [0, hz(69)],
        [0.8, hz(105)],
      ],
      [
        [0.01, 0.1],
        [0.78, 0.8],
        [0.8, 0],
      ],
      { lfo: { w: 'sq', hz: 15, depth: 0.5, to: 'amp' } },
    ),
  ],
);
add(
  'rail_fire',
  'weapons',
  'fire_big',
  80,
  'Needle Railgun shot: a razor-thin cyan zap falling four octaves in an instant.',
  [
    L(
      'saw',
      [
        [0, 7200],
        [0.07, 420],
        [0.22, 180],
      ],
      [
        [0.002, 1],
        [0.05, 0.5],
        [0.24, 0],
      ],
      { flt: { t: 'hp', f: 500 } },
    ),
    L(
      'sin',
      [
        [0, 5200],
        [0.18, 2600],
      ],
      pluck(0.3),
      { g: 0.5, fm: { ratio: 1.41, index: 3, decay: 0.2 } },
    ),
    L('noise', 1, pluck(0.03), { flt: { t: 'hp', f: 6000 }, g: 0.8 }),
  ],
  { duck: 0.5 },
);
add(
  'rocket_launch',
  'weapons',
  'fire_big',
  70,
  'Straight Rocket leaving the rail: a breathy whoosh that opens upward.',
  [
    L(
      'noise',
      1,
      [
        [0.02, 1],
        [0.12, 0.7],
        [0.4, 0],
      ],
      {
        flt: {
          t: 'bp',
          f: [
            [0, 400],
            [0.3, 2600],
          ],
          q: 1.2,
        },
      },
    ),
    L(
      'saw',
      [
        [0, 70],
        [0.3, 140],
      ],
      [
        [0.01, 0.8],
        [0.35, 0],
      ],
      { flt: { t: 'lp', f: 600 } },
    ),
  ],
);
add(
  'rocket_fly',
  'ambience',
  'travel',
  45,
  'Straight Rocket in flight: a flickering flame roar, low and unsteady.',
  [
    L('noise', 0.45, sustain(0.04), {
      flt: { t: 'bp', f: 520, q: 0.9 },
      lfo: { w: 'saw', hz: 23, depth: 0.7, to: 'amp' },
    }),
    L('saw', 62, sustain(0.04, 0.5), {
      flt: { t: 'lp', f: 420 },
      lfo: { w: 'tri', hz: 11, depth: 0.08, to: 'f' },
    }),
  ],
  { loop: true, release: 0.06, poly: 3 },
);
add(
  'seeker_lock',
  'weapons',
  'mech',
  55,
  'Seeker Missile lock: the two-beep cue, second beep higher.',
  [L('sq', arp([hz(86), hz(86), hz(91)], 0.08), blips(2, 0.16, 0.07), { glide: 'step' })],
  { limitMs: 300 },
);
add(
  'seeker_launch',
  'weapons',
  'fire_big',
  70,
  'Seeker Missile launch: a thinner hiss with a rising electronic chirp on top.',
  [
    L(
      'noise',
      1,
      [
        [0.01, 1],
        [0.1, 0.5],
        [0.3, 0],
      ],
      {
        flt: {
          t: 'hp',
          f: [
            [0, 1500],
            [0.25, 4500],
          ],
        },
      },
    ),
    L(
      'p12',
      [
        [0, hz(72)],
        [0.22, hz(96)],
      ],
      [
        [0.01, 0.8],
        [0.26, 0],
      ],
    ),
  ],
);
add(
  'seeker_fly',
  'ambience',
  'travel',
  50,
  'Seeker Missile hunting: a warbling whine that wavers as it swerves.',
  [
    L('saw', 430, sustain(0.03), {
      flt: { t: 'bp', f: 1500, q: 2 },
      lfo: { w: 'sin', hz: 7, depth: 0.12, to: 'f' },
    }),
    L('noise', 1, sustain(0.03, 0.5), {
      flt: { t: 'hp', f: 4200 },
      lfo: { w: 'sq', hz: 31, depth: 0.5, to: 'amp' },
    }),
  ],
  { loop: true, release: 0.05, poly: 3 },
);
add(
  'mine_drop',
  'weapons',
  'mech',
  50,
  'Road Mine hatch: a spring pop and the mine clattering onto the road.',
  [
    L(
      'tri',
      [
        [0, hz(74)],
        [0.04, hz(50)],
      ],
      pluck(0.06),
    ),
    L('metal', 0.8, blips(2, 0.06, 0.02), { at: 0.07, g: 0.8 }),
    L('sq', hz(38), pluck(0.05), { at: 0.07, g: 0.6 }),
  ],
);
add(
  'mine_blink',
  'weapons',
  'mech',
  40,
  'Mine arming: three amber blips speeding up while it arms.',
  [
    L('p12', hz(79), [
      [0.003, 1],
      [0.04, 1],
      [0.05, 0],
      [0.26, 0],
      [0.263, 1],
      [0.3, 1],
      [0.31, 0],
      [0.44, 0],
      [0.443, 1],
      [0.48, 1],
      [0.49, 0],
    ]),
  ],
  { limitMs: 100, poly: 2 },
);
add(
  'mine_armed',
  'weapons',
  'mech',
  45,
  'Mine live: one higher, longer confirming tone.',
  [
    L('p12', hz(91), hold(0.003, 0.09, 0.13)),
    L('sin', hz(103), hold(0.003, 0.09, 0.13), { g: 0.4 }),
  ],
  { limitMs: 100 },
);
add(
  'oil_spill',
  'weapons',
  'fire_small',
  50,
  'Oil Slick: a thick slosh and glug, dark and wobbling, with no crack in it.',
  [
    L(
      'noise',
      0.25,
      [
        [0.03, 1],
        [0.2, 0.6],
        [0.5, 0],
      ],
      { flt: { t: 'lp', f: 850, q: 4 }, lfo: { w: 'sin', hz: 6, depth: 0.55, to: 'cut' } },
    ),
    L(
      'sin',
      [
        [0, 300],
        [0.1, 170],
        [0.2, 260],
        [0.32, 140],
      ],
      [
        [0.01, 0.9],
        [0.36, 0],
      ],
      { glide: 'lin' },
    ),
  ],
);
add(
  'foam_launch',
  'weapons',
  'fire_small',
  50,
  'Sticky Foam: a wet, pressurised pfft with bubbles in it.',
  [
    L(
      'noise',
      0.7,
      [
        [0.004, 1],
        [0.05, 0.5],
        [0.2, 0],
      ],
      {
        flt: {
          t: 'bp',
          f: [
            [0, 2200],
            [0.18, 700],
          ],
          q: 1.5,
        },
      },
    ),
    L(
      'sin',
      arp([330, 520, 410, 640], 0.035),
      [
        [0.003, 0.7],
        [0.14, 0.4],
        [0.16, 0],
      ],
      { glide: 'step' },
    ),
  ],
);
add(
  'foam_fall',
  'weapons',
  'mech',
  30,
  'Foam pellets in the air: a soft falling whistle, half a second.',
  [
    L(
      'sin',
      [
        [0, 1400],
        [0.5, 600],
      ],
      [
        [0.05, 0.6],
        [0.45, 1],
        [0.5, 0],
      ],
      { lfo: { w: 'sin', hz: 13, depth: 0.03, to: 'f' } },
    ),
  ],
);
add(
  'foam_splat',
  'impacts',
  'impact',
  55,
  'Foam landing: an elastic splat that boings and peels.',
  [
    L('noise', 0.5, pluck(0.12), {
      flt: {
        t: 'lp',
        f: [
          [0, 3000],
          [0.1, 600],
        ],
      },
    }),
    L(
      'tri',
      [
        [0, 220],
        [0.07, 540],
        [0.16, 300],
        [0.24, 440],
      ],
      [
        [0.003, 1],
        [0.28, 0],
      ],
      { glide: 'lin' },
    ),
  ],
);
add(
  'emp_charge',
  'weapons',
  'mech',
  60,
  'EMP Pulse charging: a low synthesized whine climbing in four steps.',
  [
    L(
      'saw',
      arp([hz(33), hz(38), hz(43), hz(50)], 0.15),
      [
        [0.01, 0.4],
        [0.58, 1],
        [0.6, 0],
      ],
      {
        glide: 'step',
        flt: {
          t: 'lp',
          f: [
            [0, 400],
            [0.6, 2400],
          ],
        },
      },
    ),
    L(
      'sin',
      [
        [0, 220],
        [0.6, 880],
      ],
      [
        [0.02, 0.2],
        [0.58, 0.7],
        [0.6, 0],
      ],
      { lfo: { w: 'sin', hz: 28, depth: 0.5, to: 'amp' } },
    ),
  ],
);
add(
  'emp_burst',
  'weapons',
  'fire_big',
  85,
  'EMP ring: a wide downward electronic sweep with a bit-crushed crackle and no bang.',
  [
    L(
      'saw',
      [
        [0, 2400],
        [0.4, 60],
      ],
      [
        [0.003, 1],
        [0.15, 0.6],
        [0.5, 0],
      ],
      {
        crush: 8,
        flt: {
          t: 'lp',
          f: [
            [0, 8000],
            [0.45, 500],
          ],
        },
      },
    ),
    L(
      'sq',
      [
        [0, 1300],
        [0.35, 45],
      ],
      [
        [0.003, 0.7],
        [0.45, 0],
      ],
      { lfo: { w: 'sq', hz: 42, depth: 0.8, to: 'amp' } },
    ),
    L(
      'sin',
      [
        [0, 90],
        [0.4, 40],
      ],
      [
        [0.01, 1],
        [0.5, 0],
      ],
    ),
  ],
  { duck: 0.7 },
);
add(
  'tesla_arc',
  'weapons',
  'fire_small',
  65,
  'Tesla Arc: a snapping, buzzing crackle, irregular like real arcing.',
  [
    L(
      'metal',
      [
        [0, 2.6],
        [0.05, 1.1],
        [0.09, 3.1],
        [0.16, 0.9],
        [0.22, 2.2],
      ],
      [
        [0.002, 1],
        [0.04, 0.3],
        [0.06, 0.9],
        [0.12, 0.2],
        [0.15, 0.8],
        [0.26, 0],
      ],
      { glide: 'step' },
    ),
    L(
      'saw',
      118,
      [
        [0.002, 0.8],
        [0.26, 0],
      ],
      { lfo: { w: 'sq', hz: 57, depth: 0.9, to: 'amp' }, flt: { t: 'hp', f: 300 } },
    ),
    L('noise', 1, pluck(0.02), { flt: { t: 'hp', f: 5000 } }),
  ],
  { limitMs: 150 },
);
add(
  'flame_ignite',
  'weapons',
  'fire_small',
  55,
  'Flame Spitter lighting: a gas whoomp.',
  [
    L(
      'noise',
      0.35,
      [
        [0.03, 1],
        [0.25, 0],
      ],
      {
        flt: {
          t: 'lp',
          f: [
            [0, 300],
            [0.08, 1600],
            [0.25, 500],
          ],
        },
      },
    ),
    L(
      'sin',
      [
        [0, 60],
        [0.1, 110],
      ],
      [
        [0.02, 0.8],
        [0.2, 0],
      ],
    ),
  ],
  { limitMs: 200 },
);
add(
  'flame_stream',
  'ambience',
  'travel',
  55,
  'Flame Spitter jets: a staccato roar, the flame chopped about twelve times a second.',
  [
    L('noise', 0.55, sustain(0.03), {
      flt: { t: 'bp', f: 780, q: 0.7 },
      lfo: { w: 'sq', hz: 12, depth: 0.75, to: 'amp' },
    }),
    L('lfsr', 0.12, sustain(0.03, 0.5), { flt: { t: 'lp', f: 900 } }),
  ],
  { loop: true, release: 0.12, poly: 2 },
);
add(
  'frost_fire',
  'weapons',
  'fire_small',
  55,
  'Frost Cannon: a glassy bell thump with an icy breath after it.',
  [
    L(
      'sin',
      [
        [0, hz(86)],
        [0.2, hz(84)],
      ],
      pluck(0.24),
      { fm: { ratio: 3.01, index: 2.2, decay: 0.15 } },
    ),
    L(
      'noise',
      1,
      [
        [0.01, 0.7],
        [0.22, 0],
      ],
      { flt: { t: 'hp', f: 7000 } },
    ),
    L(
      'tri',
      [
        [0, 200],
        [0.06, 90],
      ],
      pluck(0.07),
      { g: 0.7 },
    ),
  ],
);
add(
  'frost_shatter',
  'impacts',
  'impact',
  60,
  'Frost shell bursting: a crystalline shatter, falling glass bells.',
  [
    L(
      'sin',
      arp([hz(103), hz(98), hz(105), hz(96), hz(100), hz(93)], 0.03),
      [
        [0.002, 1],
        [0.2, 0.4],
        [0.32, 0],
      ],
      { glide: 'step', fm: { ratio: 2.4, index: 1.6 } },
    ),
    L('noise', 1, pluck(0.14), { flt: { t: 'hp', f: 6500 } }),
  ],
  { limitMs: 80 },
);
add(
  'hammer_draw',
  'weapons',
  'mech',
  55,
  'Crash Hammer drawing back: a spring ratchet tightening, clicks closing up.',
  [
    L(
      'metal',
      [
        [0, 0.7],
        [0.27, 1.8],
      ],
      [
        [0.003, 1],
        [0.02, 0],
        [0.07, 0],
        [0.073, 1],
        [0.09, 0],
        [0.13, 0],
        [0.133, 1],
        [0.15, 0],
        [0.18, 0],
        [0.183, 1],
        [0.2, 0],
        [0.22, 0],
        [0.223, 1],
        [0.24, 0],
        [0.25, 0],
        [0.253, 1],
        [0.27, 0],
      ],
      { glide: 'lin' },
    ),
    L(
      'tri',
      [
        [0, hz(52)],
        [0.27, hz(64)],
      ],
      [
        [0.01, 0.5],
        [0.26, 0.9],
        [0.27, 0],
      ],
    ),
  ],
);
add('hammer_swing', 'weapons', 'fire_small', 60, 'Crash Hammer swinging: a short heavy whoosh.', [
  L(
    'noise',
    0.6,
    [
      [0.02, 1],
      [0.12, 0],
    ],
    {
      flt: {
        t: 'bp',
        f: [
          [0, 300],
          [0.1, 1400],
        ],
        q: 1.5,
      },
    },
  ),
]);
add(
  'hammer_clang',
  'impacts',
  'explosion',
  85,
  'Crash Hammer landing: an oversized anvil clang that rings for half a second.',
  [
    L(
      'sin',
      hz(50),
      [
        [0.002, 1],
        [0.1, 0.5],
        [0.6, 0],
      ],
      { fm: { ratio: 2.76, index: 4, decay: 0.3 } },
    ),
    L(
      'sin',
      hz(69.4),
      [
        [0.002, 0.7],
        [0.45, 0],
      ],
      { fm: { ratio: 5.4, index: 2, decay: 0.2 } },
    ),
    L('noise', 0.8, pluck(0.05), { flt: { t: 'bp', f: 2800, q: 0.8 } }),
    L(
      'tri',
      [
        [0, 90],
        [0.1, 40],
      ],
      pluck(0.14),
    ),
  ],
  { duck: 0.7 },
);
add(
  'saw_bite',
  'weapons',
  'fire_small',
  55,
  'Side Saw biting: a rasping, grinding buzz with metal scraping in it.',
  [
    L(
      'saw',
      [
        [0, 210],
        [0.05, 260],
        [0.25, 180],
      ],
      [
        [0.01, 1],
        [0.2, 0.8],
        [0.3, 0],
      ],
      { lfo: { w: 'sq', hz: 64, depth: 0.85, to: 'amp' }, flt: { t: 'bp', f: 1900, q: 1.2 } },
    ),
    L(
      'metal',
      [
        [0, 2.8],
        [0.25, 2.1],
      ],
      [
        [0.01, 0.8],
        [0.2, 0.6],
        [0.3, 0],
      ],
      { flt: { t: 'hp', f: 2500 } },
    ),
  ],
  { limitMs: 150 },
);
add(
  'harpoon_fire',
  'weapons',
  'fire_small',
  60,
  'Grapple Harpoon: a pneumatic thwip with the cable spool zipping out.',
  [
    L('noise', 1, pluck(0.04), { flt: { t: 'bp', f: 3400, q: 2 } }),
    L(
      'p12',
      [
        [0, hz(96)],
        [0.18, hz(60)],
      ],
      [
        [0.003, 0.9],
        [0.2, 0],
      ],
      { lfo: { w: 'sq', hz: 85, depth: 1, to: 'amp' } },
    ),
  ],
);
add(
  'harpoon_hook',
  'impacts',
  'impact',
  65,
  'Harpoon catching: a clank, then the line creaking taut.',
  [
    L('sin', hz(74), pluck(0.12), { fm: { ratio: 4.2, index: 2.5, decay: 0.06 } }),
    L(
      'saw',
      [
        [0.05, 90],
        [0.3, 190],
      ],
      [
        [0.06, 0.2],
        [0.26, 0.9],
        [0.3, 0],
      ],
      { flt: { t: 'bp', f: 700, q: 6 }, lfo: { w: 'sq', hz: 33, depth: 0.5, to: 'amp' } },
    ),
  ],
);
add(
  'tether_tension',
  'ambience',
  'travel',
  50,
  'Harpoon line under load: a low bowed-cable drone that wavers.',
  [
    L('saw', 110, sustain(0.06), {
      flt: { t: 'bp', f: 880, q: 5 },
      lfo: { w: 'sin', hz: 4.5, depth: 0.05, to: 'f' },
    }),
    L('tri', 330, sustain(0.06, 0.4), { lfo: { w: 'tri', hz: 17, depth: 0.4, to: 'amp' } }),
  ],
  { loop: true, release: 0.08, poly: 1 },
);
add(
  'harpoon_release',
  'weapons',
  'mech',
  50,
  'Harpoon line letting go: a slack twang falling away.',
  [
    L(
      'tri',
      [
        [0, 660],
        [0.22, 165],
      ],
      pluck(0.26),
      { lfo: { w: 'sin', hz: 19, depth: 0.06, to: 'f' } },
    ),
    L('metal', 1.4, pluck(0.02), { g: 0.8 }),
  ],
);
add(
  'air_blast',
  'weapons',
  'fire_big',
  70,
  'Air Cannon: a hollow whump of pressure that swells and blows past, all air and no crack.',
  [
    L(
      'noise',
      0.8,
      [
        [0.07, 1],
        [0.2, 0.6],
        [0.6, 0],
      ],
      {
        flt: {
          t: 'bp',
          f: [
            [0, 320],
            [0.12, 1000],
            [0.55, 420],
          ],
          q: 0.9,
        },
      },
    ),
    L(
      'sin',
      [
        [0, 96],
        [0.3, 44],
      ],
      [
        [0.05, 1],
        [0.36, 0],
      ],
      { g: 0.45 },
    ),
    L(
      'noise',
      1,
      [
        [0.1, 0.5],
        [0.3, 0.3],
        [0.6, 0],
      ],
      { flt: { t: 'hp', f: 3200 }, g: 0.7 },
    ),
  ],
  { duck: 0.4 },
);
add(
  'boomerang_throw',
  'weapons',
  'fire_small',
  55,
  'Steel Boomerang thrown: a sharp metal sling and a swish.',
  [
    L(
      'metal',
      [
        [0, 1],
        [0.08, 3],
      ],
      pluck(0.09),
      { glide: 'lin', flt: { t: 'hp', f: 1500 } },
    ),
    L(
      'noise',
      1,
      [
        [0.02, 0.8],
        [0.16, 0],
      ],
      {
        flt: {
          t: 'bp',
          f: [
            [0, 900],
            [0.14, 3000],
          ],
          q: 2,
        },
      },
    ),
  ],
);
add(
  'boomerang_spin',
  'ambience',
  'travel',
  50,
  'Steel Boomerang spinning: a whup-whup-whup, nine beats a second, with a steel edge.',
  [
    L('noise', 0.8, sustain(0.02), {
      flt: { t: 'bp', f: 1700, q: 2.5 },
      lfo: { w: 'saw', hz: 9, depth: 0.9, to: 'amp' },
    }),
    L('tri', 392, sustain(0.02, 0.35), { lfo: { w: 'sin', hz: 9, depth: 0.06, to: 'f' } }),
  ],
  { loop: true, release: 0.05, poly: 2 },
);
add(
  'boomerang_slash',
  'impacts',
  'impact',
  60,
  'Boomerang glancing off: a bright steel slash and a ricochet tick.',
  [
    L(
      'metal',
      [
        [0, 4],
        [0.07, 2.2],
      ],
      pluck(0.08),
      { flt: { t: 'hp', f: 3000 } },
    ),
    L(
      'sin',
      [
        [0, hz(98)],
        [0.1, hz(93)],
      ],
      pluck(0.16),
      { fm: { ratio: 3.7, index: 1.5, decay: 0.08 } },
    ),
    L('p12', hz(103), pluck(0.02), { at: 0.09, g: 0.5 }),
  ],
  { limitMs: 80 },
);
add(
  'boomerang_catch',
  'weapons',
  'mech',
  50,
  'Boomerang caught: a snap into the cradle and two settling ticks.',
  [L('sq', hz(62), pluck(0.04), { crush: 8 }), L('metal', 2.5, blips(3, 0.05, 0.012), { g: 0.7 })],
);
add(
  'mortar_lock',
  'weapons',
  'mech',
  55,
  'Arc Mortar ranging: the barrel grinding up, then a low tick.',
  [
    L(
      'saw',
      [
        [0, hz(36)],
        [0.3, hz(45)],
      ],
      hold(0.01, 0.28, 0.32),
      { flt: { t: 'bp', f: 500, q: 3 }, lfo: { w: 'sq', hz: 24, depth: 0.6, to: 'amp' } },
    ),
    L('sq', hz(60), pluck(0.04), { at: 0.33 }),
  ],
  { limitMs: 300 },
);
add(
  'mortar_launch',
  'weapons',
  'fire_big',
  75,
  'Arc Mortar firing: a deep hollow tube thoomp.',
  [
    L(
      'sin',
      [
        [0, 240],
        [0.18, 70],
      ],
      [
        [0.003, 1],
        [0.3, 0],
      ],
      { g: 0.16 },
    ),
    L('noise', 0.35, pluck(0.12), { flt: { t: 'bp', f: 1000, q: 2.5 } }),
    L(
      'sq',
      [
        [0, 440],
        [0.12, 210],
      ],
      pluck(0.13),
      { g: 0.8, crush: 8 },
    ),
  ],
  { duck: 0.4 },
);
add(
  'mortar_whistle',
  'weapons',
  'mech',
  70,
  'Mortar shell coming down: a whistle falling for the whole 1.4 s, louder as it nears.',
  [
    L(
      'sin',
      [
        [0, 2300],
        [1.4, 620],
      ],
      [
        [0.1, 0.15],
        [1.3, 1],
        [1.4, 0],
      ],
      { lfo: { w: 'sin', hz: 6, depth: 0.015, to: 'f' } },
    ),
    L(
      'p12',
      [
        [0, 2300],
        [1.4, 620],
      ],
      [
        [0.6, 0],
        [1.3, 0.3],
        [1.4, 0],
      ],
    ),
  ],
  { poly: 2 },
);
add(
  'lock_lost',
  'weapons',
  'mech',
  25,
  'One of your weapons lost its target: a tiny falling blip.',
  [
    L(
      'p12',
      [
        [0, hz(84)],
        [0.05, hz(76)],
      ],
      pluck(0.06),
    ),
  ],
  { limitMs: 300 },
);
add(
  'misfire',
  'weapons',
  'mech',
  50,
  'A damaged weapon failing: a dud click and a sputter.',
  [
    L('metal', 1.1, pluck(0.02)),
    L(
      'lfsr',
      0.2,
      [
        [0.04, 0],
        [0.05, 0.8],
        [0.08, 0.1],
        [0.1, 0.6],
        [0.16, 0],
      ],
      { flt: { t: 'lp', f: 1400 } },
    ),
  ],
  { limitMs: 200 },
);
add(
  'empty_click',
  'weapons',
  'mech',
  40,
  'Out of ammunition: a dry hammer click on nothing.',
  [L('metal', 2.2, pluck(0.018)), L('sq', hz(72), pluck(0.012), { g: 0.5 })],
  { limitMs: 200 },
);
add(
  'refuse_tick',
  'weapons',
  'mech',
  20,
  'Still cooling down or no target: the softest possible tick.',
  [L('tri', hz(72), pluck(0.03))],
  { limitMs: 250 },
);
// --- Explosions ----------------------------------------------------------------------------

add(
  'explode_rocket',
  'impacts',
  'explosion',
  90,
  'Rocket blast: four layers, a crack, a fireball roar, a falling boom and shrapnel.',
  [
    L('noise', 1, pluck(0.04), { flt: { t: 'hp', f: 2000 } }),
    L(
      'noise',
      [
        [0, 0.7],
        [0.5, 0.15],
      ],
      [
        [0.004, 1],
        [0.1, 0.7],
        [0.6, 0],
      ],
      {
        flt: {
          t: 'lp',
          f: [
            [0, 3600],
            [0.5, 260],
          ],
        },
      },
    ),
    L(
      'tri',
      [
        [0, 120],
        [0.4, 30],
      ],
      [
        [0.004, 1],
        [0.5, 0],
      ],
    ),
    L('lfsr', 0.5, blips(4, 0.07, 0.02, 0.6), { at: 0.1, crush: 6, flt: { t: 'hp', f: 2500 } }),
  ],
  { duck: 1, poly: 2 },
);
add(
  'explode_seeker',
  'impacts',
  'explosion',
  90,
  'Seeker bloom: tighter and brighter than the rocket, a snap and a short ringing burst.',
  [
    L('noise', 1, pluck(0.03), { flt: { t: 'hp', f: 3500 } }),
    L(
      'noise',
      [
        [0, 1],
        [0.25, 0.3],
      ],
      [
        [0.003, 1],
        [0.32, 0],
      ],
      {
        flt: {
          t: 'bp',
          f: [
            [0, 3000],
            [0.28, 700],
          ],
          q: 1,
        },
      },
    ),
    L(
      'sq',
      [
        [0, 240],
        [0.2, 60],
      ],
      [
        [0.003, 0.9],
        [0.28, 0],
      ],
      { crush: 8 },
    ),
  ],
  { duck: 0.9, poly: 2 },
);
add(
  'explode_mine',
  'impacts',
  'explosion',
  90,
  'Mine going off: a low dull thump from under the car, more dirt than fire.',
  [
    L(
      'sin',
      [
        [0, 110],
        [0.3, 34],
      ],
      [
        [0.004, 1],
        [0.4, 0],
      ],
      { g: 0.7 },
    ),
    L(
      'noise',
      0.3,
      [
        [0.004, 1],
        [0.45, 0],
      ],
      {
        flt: {
          t: 'lp',
          f: [
            [0, 1400],
            [0.4, 300],
          ],
        },
      },
    ),
    L(
      'lfsr',
      0.3,
      [
        [0.05, 0.6],
        [0.4, 0],
      ],
      { flt: { t: 'bp', f: 900, q: 0.8 }, g: 0.7 },
    ),
  ],
  { duck: 0.9, poly: 2 },
);
add(
  'explode_mortar',
  'impacts',
  'explosion',
  95,
  'Mortar burst: the biggest sound in the game, a tall crack, a long rumble and falling debris.',
  [
    L('noise', 1, pluck(0.06), { flt: { t: 'hp', f: 1200 } }),
    L(
      'noise',
      [
        [0, 0.6],
        [1, 0.1],
      ],
      [
        [0.005, 1],
        [0.2, 0.7],
        [1.1, 0],
      ],
      {
        flt: {
          t: 'lp',
          f: [
            [0, 3800],
            [1, 260],
          ],
        },
      },
    ),
    L(
      'sin',
      [
        [0, 90],
        [0.7, 28],
      ],
      [
        [0.005, 1],
        [0.9, 0],
      ],
      { g: 0.6 },
    ),
    L(
      'sq',
      [
        [0, 230],
        [0.3, 60],
      ],
      [
        [0.005, 0.8],
        [0.35, 0],
      ],
      { crush: 6 },
    ),
    L('lfsr', 0.3, blips(5, 0.11, 0.025, 0.5), { at: 0.3, flt: { t: 'bp', f: 1800, q: 1 } }),
  ],
  { duck: 1, poly: 1 },
);
add(
  'ko_blast',
  'impacts',
  'explosion',
  100,
  'Knockout: an explosion that sags into a long power-down.',
  [
    L(
      'noise',
      [
        [0, 0.8],
        [0.6, 0.1],
      ],
      [
        [0.004, 1],
        [0.7, 0],
      ],
      {
        flt: {
          t: 'lp',
          f: [
            [0, 3000],
            [0.6, 200],
          ],
        },
      },
    ),
    L(
      'saw',
      [
        [0, 440],
        [1.1, 30],
      ],
      [
        [0.02, 0.8],
        [1.2, 0],
      ],
      { flt: { t: 'lp', f: 1800 }, crush: 10 },
    ),
    L(
      'tri',
      [
        [0, 100],
        [0.5, 28],
      ],
      [
        [0.004, 1],
        [0.6, 0],
      ],
    ),
  ],
  { duck: 1 },
);

// --- What was hit (Section 13.6) -----------------------------------------------------------

add(
  'hit_shield',
  'impacts',
  'impact',
  70,
  'Hit on an energy shield: a bright electric splash that rings up, never metallic.',
  [
    L(
      'sin',
      [
        [0, hz(81)],
        [0.18, hz(93)],
      ],
      pluck(0.24),
      { lfo: { w: 'sin', hz: 46, depth: 0.7, to: 'amp' } },
    ),
    L(
      'p12',
      [
        [0, hz(93)],
        [0.14, hz(105)],
      ],
      pluck(0.16),
      { g: 0.4 },
    ),
  ],
  { limitMs: 70 },
);
add(
  'hit_armor',
  'impacts',
  'impact',
  65,
  'Hit on armor plate: a hard, high ping, the bullet bouncing off.',
  [
    L('sin', hz(91), pluck(0.16), { fm: { ratio: 2.76, index: 2.8, decay: 0.07 } }),
    L('noise', 1, pluck(0.015), { flt: { t: 'hp', f: 4000 } }),
  ],
  { limitMs: 60 },
);
add(
  'hit_body',
  'impacts',
  'impact',
  60,
  'Hit on bare bodywork: a dull, boxy thud with no ring.',
  [
    L('noise', 0.4, pluck(0.07), { flt: { t: 'bp', f: 900, q: 0.7 } }),
    L(
      'tri',
      [
        [0, 280],
        [0.07, 130],
      ],
      pluck(0.09),
      { g: 0.45 },
    ),
  ],
  { limitMs: 60 },
);
add(
  'hit_wheel',
  'impacts',
  'impact',
  70,
  'Hit on a wheel: a rubber thunk and the rim ringing like a small bell.',
  [
    L(
      'tri',
      [
        [0, 130],
        [0.06, 60],
      ],
      pluck(0.08),
    ),
    L('sin', hz(79), pluck(0.3), { at: 0.02, g: 0.7, fm: { ratio: 1.5, index: 1, decay: 0.2 } }),
    L('noise', 0.5, pluck(0.03), { flt: { t: 'bp', f: 1000, q: 1 } }),
  ],
  { limitMs: 70 },
);
add(
  'hit_engine',
  'impacts',
  'impact',
  75,
  'Hit on the engine: an iron knock, then a hiss of escaping pressure.',
  [
    L(
      'sq',
      [
        [0, 170],
        [0.05, 95],
      ],
      pluck(0.08),
      { crush: 8, g: 0.8 },
    ),
    L('sin', hz(62), pluck(0.14), { fm: { ratio: 3.3, index: 3, decay: 0.05 } }),
    L(
      'noise',
      1,
      [
        [0.05, 0],
        [0.07, 0.7],
        [0.36, 0],
      ],
      { flt: { t: 'bp', f: 5200, q: 3 } },
    ),
  ],
  { limitMs: 70 },
);
add(
  'hit_steering',
  'impacts',
  'impact',
  70,
  'Hit on the steering: a hollow clonk and a bent-rod twang.',
  [
    L(
      'sq',
      [
        [0, 300],
        [0.03, 190],
      ],
      pluck(0.05),
      { flt: { t: 'bp', f: 700, q: 4 } },
    ),
    L(
      'tri',
      [
        [0.03, 440],
        [0.1, 350],
        [0.2, 400],
        [0.28, 330],
      ],
      [
        [0.033, 0.8],
        [0.3, 0],
      ],
      { glide: 'lin', lfo: { w: 'sin', hz: 24, depth: 0.04, to: 'f' } },
    ),
  ],
  { limitMs: 70 },
);
add(
  'hit_module',
  'impacts',
  'impact',
  70,
  'Hit on a mounted part: a crunch with a digital glitch, electronics taking damage.',
  [
    L(
      'lfsr',
      [
        [0, 1.4],
        [0.04, 0.5],
        [0.08, 1.1],
      ],
      pluck(0.1),
      { glide: 'step', crush: 5 },
    ),
    L('p12', arp([hz(96), hz(81), hz(100), hz(74)], 0.022), pluck(0.1), { glide: 'step', g: 0.6 }),
  ],
  { limitMs: 70 },
);
add(
  'hit_pellets',
  'impacts',
  'impact',
  60,
  'Shotgun pellets landing: a fan of five quick separate ticks, not one hit.',
  [
    L(
      'noise',
      0.9,
      [
        [0.002, 1],
        [0.012, 0],
        [0.025, 0],
        [0.027, 0.8],
        [0.04, 0],
        [0.05, 0],
        [0.052, 0.9],
        [0.065, 0],
        [0.08, 0],
        [0.082, 0.7],
        [0.095, 0],
        [0.115, 0],
        [0.117, 0.6],
        [0.14, 0],
      ],
      { flt: { t: 'bp', f: 2600, q: 1.5 } },
    ),
    L(
      'tri',
      [
        [0, 210],
        [0.14, 120],
      ],
      [
        [0.002, 0.7],
        [0.14, 0],
      ],
      { lfo: { w: 'sq', hz: 38, depth: 1, to: 'amp' } },
    ),
  ],
  { limitMs: 120 },
);
add(
  'hit_rail',
  'impacts',
  'impact',
  80,
  'Railgun slug going through: a needle-thin slash and a square pulse behind it.',
  [
    L(
      'saw',
      [
        [0, 9000],
        [0.04, 3000],
      ],
      pluck(0.05),
      { flt: { t: 'hp', f: 2500 } },
    ),
    L('sq', hz(57), hold(0.003, 0.05, 0.09), { at: 0.03, crush: 6 }),
    L('sin', hz(100), pluck(0.2), { at: 0.03, g: 0.5 }),
  ],
);
add(
  'impact_heavy',
  'impacts',
  'impact',
  80,
  'Under any heavy hit: a sub drop that gives it weight.',
  [
    L(
      'sin',
      [
        [0, 130],
        [0.2, 32],
      ],
      [
        [0.004, 1],
        [0.26, 0],
      ],
    ),
    L('noise', 0.2, pluck(0.08), { flt: { t: 'lp', f: 500 }, g: 0.6 }),
  ],
  { limitMs: 90, duck: 0.6 },
);
add(
  'ram_crunch',
  'impacts',
  'impact',
  75,
  'Car against car: a crunch of bodywork with a low shove.',
  [
    L(
      'lfsr',
      [
        [0, 0.6],
        [0.12, 0.2],
      ],
      [
        [0.003, 1],
        [0.05, 0.5],
        [0.2, 0],
      ],
      {
        flt: {
          t: 'lp',
          f: [
            [0, 3400],
            [0.18, 600],
          ],
        },
        crush: 6,
      },
    ),
    L(
      'tri',
      [
        [0, 160],
        [0.15, 55],
      ],
      pluck(0.2),
      { g: 0.55 },
    ),
  ],
  { limitMs: 120, duck: 0.4 },
);
add(
  'wall_thump',
  'impacts',
  'impact',
  60,
  'Light chassis against a wall: a filtered thud and a panel rattle.',
  [
    L('noise', 0.7, pluck(0.14), {
      flt: {
        t: 'lp',
        f: [
          [0, 2800],
          [0.13, 320],
        ],
      },
    }),
    L(
      'tri',
      [
        [0, 200],
        [0.1, 80],
      ],
      pluck(0.13),
      { g: 0.5 },
    ),
    L('metal', 1.1, blips(2, 0.04, 0.012, 0.5), { at: 0.03, g: 0.5 }),
  ],
  { limitMs: 120 },
);
add(
  'wall_thump_heavy',
  'impacts',
  'impact',
  60,
  'Heavy chassis against a wall: lower and longer, more mass in it.',
  [
    L('noise', 0.4, pluck(0.2), {
      flt: {
        t: 'lp',
        f: [
          [0, 1900],
          [0.18, 220],
        ],
      },
    }),
    L(
      'tri',
      [
        [0, 130],
        [0.16, 48],
      ],
      pluck(0.2),
      { g: 0.5 },
    ),
    L('sq', hz(43), pluck(0.1), { g: 0.5, crush: 8 }),
  ],
  { limitMs: 120 },
);
add(
  'ricochet',
  'impacts',
  'impact_small',
  25,
  'A bullet hitting a wall: a small whining ricochet.',
  [
    L(
      'sin',
      [
        [0, 2600],
        [0.12, 1300],
      ],
      pluck(0.13),
      { fm: { ratio: 2, index: 0.8 } },
    ),
  ],
  { limitMs: 90, poly: 2 },
);
add(
  'burn_tick',
  'impacts',
  'impact_small',
  30,
  'A burn pulse: a small sizzle spit.',
  [
    L(
      'noise',
      1,
      [
        [0.003, 1],
        [0.02, 0.3],
        [0.09, 0],
      ],
      { flt: { t: 'bp', f: 3800, q: 2 } },
    ),
    L('lfsr', 0.4, pluck(0.03), { g: 0.5, flt: { t: 'hp', f: 2000 } }),
  ],
  { limitMs: 150, poly: 2 },
);
add(
  'shove',
  'impacts',
  'impact',
  55,
  'The car being thrown sideways: a suspension whump and a tire chirp.',
  [
    L(
      'sin',
      [
        [0, 110],
        [0.16, 60],
      ],
      [
        [0.01, 1],
        [0.2, 0],
      ],
      { g: 0.26 },
    ),
    L(
      'saw',
      [
        [0.03, 900],
        [0.12, 1300],
      ],
      [
        [0.035, 0.9],
        [0.13, 0],
      ],
      { flt: { t: 'bp', f: 1500, q: 5 } },
    ),
    L('noise', 0.6, pluck(0.07), { flt: { t: 'bp', f: 900, q: 1 } }),
  ],
  { limitMs: 200 },
);
add(
  'splash',
  'impacts',
  'impact_small',
  35,
  'Tires through oil or foam: a wet slap.',
  [
    L(
      'noise',
      0.6,
      [
        [0.005, 1],
        [0.14, 0],
      ],
      {
        flt: {
          t: 'bp',
          f: [
            [0, 1800],
            [0.12, 500],
          ],
          q: 1.5,
        },
      },
    ),
  ],
  { limitMs: 200 },
);
add(
  'proj_fizzle',
  'impacts',
  'impact_small',
  20,
  'A projectile running out of range: a short fading fizz.',
  [
    L(
      'lfsr',
      [
        [0, 1.5],
        [0.1, 0.4],
      ],
      pluck(0.11),
      { flt: { t: 'hp', f: 1500 } },
    ),
  ],
  { limitMs: 100, poly: 2 },
);
add(
  'proj_thud',
  'impacts',
  'impact_small',
  30,
  'A projectile burying itself in the ground or a wall: a small dirt thud.',
  [
    L('noise', 0.3, pluck(0.07), { flt: { t: 'lp', f: 900 } }),
    L(
      'tri',
      [
        [0, 120],
        [0.05, 70],
      ],
      pluck(0.06),
      { g: 0.6 },
    ),
  ],
  { limitMs: 80, poly: 2 },
);

// --- Defenses ------------------------------------------------------------------------------

add(
  'shield_up',
  'weapons',
  'utility',
  60,
  'Energy Shield back up: a rising shimmer that locks on a clear note.',
  [
    L(
      'sin',
      [
        [0, hz(69)],
        [0.25, hz(88)],
      ],
      hold(0.02, 0.28, 0.4),
      { lfo: { w: 'sin', hz: 26, depth: 0.5, to: 'amp' } },
    ),
    L('p12', arp([hz(76), hz(81), hz(88)], 0.08), hold(0.01, 0.26, 0.36), {
      glide: 'step',
      g: 0.3,
    }),
  ],
);
add(
  'shield_down',
  'impacts',
  'impact',
  75,
  'Energy Shield collapsing: the shimmer falling apart downward with a crackle.',
  [
    L(
      'sin',
      [
        [0, hz(93)],
        [0.3, hz(57)],
      ],
      [
        [0.003, 1],
        [0.34, 0],
      ],
      { lfo: { w: 'sq', hz: 37, depth: 0.8, to: 'amp' } },
    ),
    L(
      'lfsr',
      [
        [0, 2],
        [0.25, 0.5],
      ],
      [
        [0.003, 0.6],
        [0.3, 0],
      ],
      { crush: 5, flt: { t: 'hp', f: 1500 } },
    ),
  ],
);
add(
  'armor_break',
  'impacts',
  'impact',
  80,
  'Breakaway Armor going: a plate cracking off and clattering down the road.',
  [
    L('noise', 0.7, pluck(0.06), { flt: { t: 'bp', f: 1900, q: 1 } }),
    L('sin', hz(62), pluck(0.12), { fm: { ratio: 2.76, index: 3.5, decay: 0.08 } }),
    L(
      'metal',
      [
        [0.1, 1.8],
        [0.45, 0.9],
      ],
      [
        [0.1, 0],
        [0.103, 0.8],
        [0.13, 0],
        [0.2, 0],
        [0.203, 0.6],
        [0.23, 0],
        [0.32, 0],
        [0.323, 0.4],
        [0.35, 0],
        [0.42, 0],
        [0.423, 0.25],
        [0.46, 0],
      ],
      { glide: 'lin' },
    ),
  ],
);
add(
  'reactive_puff',
  'impacts',
  'impact',
  60,
  'Reactive Foam firing: a muffled airbag pop that swallows the hit.',
  [
    L(
      'noise',
      0.45,
      [
        [0.004, 1],
        [0.05, 0.4],
        [0.2, 0],
      ],
      {
        flt: {
          t: 'lp',
          f: [
            [0, 2600],
            [0.16, 400],
          ],
        },
      },
    ),
    L(
      'sin',
      [
        [0, 220],
        [0.06, 95],
      ],
      pluck(0.08),
      { g: 0.5 },
    ),
  ],
);
add(
  'interceptor_fire',
  'weapons',
  'fire_small',
  75,
  'Missile Interceptor: a very fast upward laser chirp.',
  [
    L(
      'sq',
      [
        [0, 700],
        [0.07, 4800],
      ],
      pluck(0.09),
    ),
    L(
      'sin',
      [
        [0, 1400],
        [0.07, 9000],
      ],
      pluck(0.08),
      { g: 0.5 },
    ),
  ],
);
add('intercept_pop', 'impacts', 'impact', 70, 'A missile shot down: a small bright airburst.', [
  L('noise', 1, pluck(0.1), {
    flt: {
      t: 'bp',
      f: [
        [0, 4200],
        [0.09, 1200],
      ],
      q: 1,
    },
  }),
  L(
    'p25',
    [
      [0, 900],
      [0.08, 300],
    ],
    pluck(0.09),
    { g: 0.6 },
  ),
]);
add(
  'sweeper_zap',
  'weapons',
  'fire_small',
  70,
  'Mine Sweeper: a low electric zot aimed at the ground.',
  [
    L(
      'saw',
      [
        [0, 1500],
        [0.09, 190],
      ],
      pluck(0.11),
      { crush: 8 },
    ),
    L('metal', 1.6, pluck(0.05), { g: 0.6 }),
  ],
);
add(
  'trap_cleared',
  'impacts',
  'impact',
  60,
  'A trap cleared: a fizzing pop and a small safe-now chirp.',
  [
    L(
      'lfsr',
      [
        [0, 1.2],
        [0.1, 0.3],
      ],
      pluck(0.12),
      { flt: { t: 'bp', f: 1500, q: 1 } },
    ),
    L(
      'p25',
      arp([hz(79), hz(86)], 0.05, 0.1),
      [
        [0.1, 0],
        [0.103, 0.8],
        [0.2, 0.6],
        [0.24, 0],
      ],
      { glide: 'step' },
    ),
  ],
);
add(
  'status_blocked',
  'impacts',
  'impact_small',
  35,
  'A disable refused by immunity: a short deflecting tick.',
  [
    L(
      'p12',
      [
        [0, hz(96)],
        [0.04, hz(103)],
      ],
      pluck(0.05),
    ),
  ],
  { limitMs: 200 },
);

// --- Statuses and things on the road -------------------------------------------------------

add(
  'status_slow',
  'ambience',
  'status',
  50,
  'Caught in foam or shaken by a mine: a gluey, sucking squelch.',
  [
    L(
      'noise',
      0.3,
      [
        [0.02, 1],
        [0.12, 0.4],
        [0.3, 0],
      ],
      {
        flt: {
          t: 'bp',
          f: [
            [0, 1500],
            [0.15, 520],
            [0.28, 1100],
          ],
          q: 4,
        },
      },
    ),
    L(
      'sin',
      [
        [0, 380],
        [0.14, 220],
        [0.26, 320],
      ],
      [
        [0.01, 0.3],
        [0.3, 0],
      ],
      { glide: 'lin' },
    ),
  ],
  { limitMs: 250 },
);
add(
  'oil_slip',
  'ambience',
  'status',
  50,
  'Sliding on oil: a greasy, wavering tire squeal with a wet hiss under it.',
  [
    L('saw', 610, sustain(0.08), {
      flt: { t: 'bp', f: 1250, q: 7 },
      lfo: { w: 'sin', hz: 5.5, depth: 0.16, to: 'f' },
    }),
    L('noise', 0.5, sustain(0.08, 0.6), { flt: { t: 'lp', f: 700 } }),
  ],
  { loop: true, release: 0.15, poly: 2 },
);
add(
  'frost_crackle',
  'ambience',
  'status',
  50,
  'Frozen: thin ice crackling and tinkling over the wheels.',
  [
    L('metal', 3.4, sustain(0.05), {
      flt: { t: 'hp', f: 5200 },
      lfo: { w: 'saw', hz: 17, depth: 0.95, to: 'amp' },
    }),
    L('sin', hz(100), sustain(0.05, 0.3), {
      lfo: { w: 'sq', hz: 6.5, depth: 0.9, to: 'amp' },
      fm: { ratio: 2.4, index: 1 },
    }),
  ],
  { loop: true, release: 0.15, poly: 2 },
);
add(
  'status_burn',
  'ambience',
  'status',
  55,
  'On fire: a crackling, spitting burn on the bodywork.',
  [
    L('lfsr', 0.22, sustain(0.06), {
      flt: { t: 'bp', f: 1500, q: 0.8 },
      lfo: { w: 'saw', hz: 21, depth: 0.85, to: 'amp' },
    }),
    L('noise', 0.3, sustain(0.06, 0.7), {
      flt: { t: 'lp', f: 600 },
      lfo: { w: 'tri', hz: 3.3, depth: 0.4, to: 'amp' },
    }),
  ],
  { loop: true, release: 0.2, poly: 2 },
);
add(
  'status_emp',
  'ambience',
  'status',
  60,
  'Electronics down: a dead buzz that stutters in and out.',
  [
    L('sq', 55, sustain(0.02), {
      crush: 4,
      lfo: { w: 'sq', hz: 13, depth: 0.95, to: 'amp' },
      flt: { t: 'bp', f: 1200, q: 1 },
    }),
    L('lfsr', 1.6, sustain(0.02, 0.5), {
      flt: { t: 'hp', f: 3500 },
      lfo: { w: 'sq', hz: 7.3, depth: 1, to: 'amp' },
    }),
  ],
  { loop: true, release: 0.08, poly: 2 },
);
add(
  'status_jam',
  'ambience',
  'status',
  55,
  'Weapons jammed by the arc: a quick ticking static.',
  [
    L('metal', 2.1, sustain(0.01), {
      lfo: { w: 'sq', hz: 24, depth: 1, to: 'amp' },
      flt: { t: 'bp', f: 3000, q: 2 },
    }),
  ],
  { loop: true, release: 0.05, poly: 2 },
);
add(
  'boost_loop',
  'ambience',
  'status',
  60,
  'Nitro or booster burning: a hard jet hiss with a rising edge.',
  [
    L('noise', 1, sustain(0.05), {
      flt: { t: 'bp', f: 2900, q: 1.4 },
      lfo: { w: 'saw', hz: 38, depth: 0.35, to: 'amp' },
    }),
    L('saw', 196, sustain(0.05, 0.4), {
      flt: { t: 'lp', f: 1500 },
      lfo: { w: 'sin', hz: 8, depth: 0.03, to: 'f' },
    }),
  ],
  { loop: true, release: 0.25, poly: 2 },
);
add(
  'repair_work',
  'ambience',
  'status',
  55,
  'A repair under way: an impact wrench rattling in bursts.',
  [
    L('metal', 1.2, sustain(0.01), { lfo: { w: 'sq', hz: 5, depth: 1, to: 'amp' } }),
    L('saw', 180, sustain(0.01, 0.6), {
      lfo: { w: 'sq', hz: 44, depth: 0.9, to: 'amp' },
      flt: { t: 'bp', f: 1400, q: 2 },
    }),
  ],
  { loop: true, release: 0.06, poly: 2 },
);
add(
  'fire_area',
  'ambience',
  'status',
  40,
  'Burning oil on the road: a broad, low fire with slow licks.',
  [
    L('noise', 0.3, sustain(0.2), {
      flt: { t: 'lp', f: 900 },
      lfo: { w: 'tri', hz: 2.2, depth: 0.5, to: 'amp' },
    }),
    L('lfsr', 0.1, sustain(0.2, 0.6), {
      flt: { t: 'bp', f: 2200, q: 1 },
      lfo: { w: 'saw', hz: 14, depth: 0.9, to: 'amp' },
    }),
  ],
  { loop: true, release: 0.4, poly: 1 },
);
add(
  'fire_ignite',
  'impacts',
  'impact',
  65,
  'Oil catching fire: a rolling whoomp along the strip.',
  [
    L(
      'noise',
      [
        [0, 0.2],
        [0.3, 0.6],
      ],
      [
        [0.05, 1],
        [0.2, 0.6],
        [0.5, 0],
      ],
      {
        flt: {
          t: 'lp',
          f: [
            [0, 500],
            [0.25, 2800],
            [0.5, 800],
          ],
        },
      },
    ),
    L(
      'sin',
      [
        [0, 65],
        [0.25, 110],
      ],
      [
        [0.04, 0.5],
        [0.4, 0],
      ],
    ),
  ],
);
add('frost_melt', 'impacts', 'impact', 50, 'Frost melted by flame: a long steam sizzle.', [
  L(
    'noise',
    1,
    [
      [0.02, 1],
      [0.15, 0.5],
      [0.6, 0],
    ],
    {
      flt: {
        t: 'bp',
        f: [
          [0, 6000],
          [0.5, 2500],
        ],
        q: 2,
      },
    },
  ),
]);
add(
  'decoy_hum',
  'ambience',
  'status',
  40,
  'Decoy Drone hovering: a small rotor buzz that chirps.',
  [
    L('p12', 340, sustain(0.05), {
      lfo: { w: 'sq', hz: 52, depth: 0.7, to: 'amp' },
      flt: { t: 'bp', f: 2000, q: 2 },
    }),
    L('sin', 1568, sustain(0.05, 0.3), { lfo: { w: 'sq', hz: 2.5, depth: 1, to: 'amp' } }),
  ],
  { loop: true, release: 0.15, poly: 1 },
);

// --- Components ----------------------------------------------------------------------------

add(
  'part_damaged',
  'impacts',
  'impact',
  55,
  'A component dropping to damaged: a crack and a loose rattle.',
  [
    L('noise', 0.8, pluck(0.03), { flt: { t: 'bp', f: 2200, q: 1 } }),
    L('metal', 0.9, blips(3, 0.045, 0.014, 0.7), { at: 0.04 }),
  ],
  { limitMs: 200 },
);
add(
  'part_destroyed',
  'impacts',
  'impact',
  85,
  'A component destroyed: a crunch, then a falling power-down arpeggio.',
  [
    L(
      'lfsr',
      [
        [0, 0.9],
        [0.1, 0.2],
      ],
      pluck(0.14),
      { crush: 5 },
    ),
    L(
      'sq',
      arp([hz(72), hz(67), hz(63), hz(58), hz(51)], 0.06, 0.05),
      [
        [0.05, 0],
        [0.053, 0.8],
        [0.3, 0.6],
        [0.4, 0],
      ],
      { glide: 'step' },
    ),
    L(
      'tri',
      [
        [0, 110],
        [0.3, 40],
      ],
      pluck(0.34),
    ),
  ],
  { limitMs: 200, duck: 0.5 },
);
add(
  'part_repaired',
  'weapons',
  'utility',
  65,
  'A component back in service: a bright rising arpeggio with a sparkle.',
  [
    L('sq', arp([hz(67), hz(72), hz(76), hz(79)], 0.05), hold(0.003, 0.2, 0.32), { glide: 'step' }),
    L('sin', hz(103), pluck(0.2), { at: 0.15, g: 0.4 }),
  ],
  { limitMs: 200 },
);

// --- Utilities -----------------------------------------------------------------------------

add(
  'spare_start',
  'weapons',
  'utility',
  60,
  'Spare Wheel going on: a jack clunk and the first wrench zip.',
  [
    L(
      'tri',
      [
        [0, 130],
        [0.05, 70],
      ],
      pluck(0.07),
    ),
    L(
      'p25',
      [
        [0.08, hz(57)],
        [0.26, hz(69)],
      ],
      [
        [0.083, 0.9],
        [0.26, 0.7],
        [0.28, 0],
      ],
      { lfo: { w: 'sq', hz: 36, depth: 0.9, to: 'amp' } },
    ),
  ],
);
add(
  'spare_done',
  'weapons',
  'utility',
  65,
  'Spare Wheel fitted: the wheel dropping and a nut pinging tight.',
  [
    L(
      'tri',
      [
        [0, 150],
        [0.06, 60],
      ],
      pluck(0.09),
    ),
    L('sin', hz(88), pluck(0.2), { at: 0.08, fm: { ratio: 2.76, index: 1.5, decay: 0.08 } }),
  ],
);
add(
  'repair_start',
  'weapons',
  'utility',
  60,
  'Repair Kit opened: a ratchet run and a welding fizz.',
  [
    L('metal', 1.5, blips(4, 0.04, 0.013)),
    L(
      'noise',
      1,
      [
        [0.16, 0],
        [0.18, 0.8],
        [0.34, 0],
      ],
      { flt: { t: 'bp', f: 5200, q: 3 }, lfo: { w: 'sq', hz: 60, depth: 0.7, to: 'amp' } },
    ),
  ],
);
add(
  'repair_done',
  'weapons',
  'utility',
  65,
  'Repair finished: a toolbox snap and two confirming notes.',
  [
    L('metal', 1.9, pluck(0.02)),
    L(
      'p25',
      arp([hz(74), hz(81)], 0.07, 0.04),
      [
        [0.04, 0],
        [0.043, 0.9],
        [0.16, 0.7],
        [0.24, 0],
      ],
      { glide: 'step' },
    ),
  ],
);
add(
  'nitro_kick',
  'weapons',
  'utility',
  70,
  'Nitro Tank opening: a valve crack and a hiss that screams upward.',
  [
    L(
      'noise',
      1,
      [
        [0.004, 1],
        [0.1, 0.7],
        [0.4, 0],
      ],
      {
        flt: {
          t: 'bp',
          f: [
            [0, 1500],
            [0.35, 6500],
          ],
          q: 2.5,
        },
      },
    ),
    L(
      'saw',
      [
        [0, 180],
        [0.35, 520],
      ],
      [
        [0.01, 0.6],
        [0.38, 0],
      ],
      { flt: { t: 'lp', f: 2400 } },
    ),
    L('sq', hz(57), pluck(0.03), { g: 0.6 }),
  ],
  { duck: 0.3 },
);
add(
  'booster_kick',
  'weapons',
  'utility',
  70,
  'Emergency Booster: an angry mechanical growl winding up, rougher than nitro.',
  [
    L(
      'saw',
      [
        [0, 82],
        [0.4, 260],
      ],
      [
        [0.01, 1],
        [0.3, 0.8],
        [0.45, 0],
      ],
      {
        crush: 8,
        lfo: { w: 'sq', hz: 34, depth: 0.5, to: 'amp' },
        flt: {
          t: 'lp',
          f: [
            [0, 800],
            [0.4, 3200],
          ],
        },
      },
    ),
    L(
      'lfsr',
      0.25,
      [
        [0.01, 0.6],
        [0.4, 0],
      ],
      { flt: { t: 'lp', f: 1100 } },
    ),
  ],
  { duck: 0.3 },
);
add(
  'decoy_launch',
  'weapons',
  'utility',
  60,
  'Decoy Drone away: a spring launch and a cheeky warble.',
  [
    L(
      'tri',
      [
        [0, hz(60)],
        [0.06, hz(79)],
      ],
      pluck(0.08),
    ),
    L(
      'p12',
      arp([hz(91), hz(96), hz(91), hz(98), hz(91), hz(96)], 0.04, 0.07),
      [
        [0.07, 0],
        [0.073, 0.8],
        [0.28, 0.6],
        [0.32, 0],
      ],
      { glide: 'step' },
    ),
  ],
);
add('jump_launch', 'weapons', 'utility', 65, 'Jump Pad firing: a spring boing sweeping up fast.', [
  L(
    'tri',
    [
      [0, 110],
      [0.16, 660],
    ],
    [
      [0.003, 1],
      [0.2, 0],
    ],
    { lfo: { w: 'sin', hz: 28, depth: 0.08, to: 'f' } },
  ),
  L('noise', 0.6, pluck(0.05), { flt: { t: 'bp', f: 1200, q: 1 }, g: 0.6 }),
]);
add(
  'jump_land',
  'impacts',
  'impact',
  60,
  'Landing from a jump: a suspension slam and a tire slap.',
  [
    L(
      'sin',
      [
        [0, 140],
        [0.12, 52],
      ],
      pluck(0.16),
      { g: 0.25 },
    ),
    L('noise', 0.6, pluck(0.07), { flt: { t: 'bp', f: 900, q: 0.8 } }),
    L(
      'saw',
      [
        [0.02, 800],
        [0.08, 1100],
      ],
      [
        [0.023, 0.4],
        [0.09, 0],
      ],
      { flt: { t: 'bp', f: 1300, q: 4 } },
    ),
  ],
);
add(
  'winch_pull',
  'weapons',
  'utility',
  60,
  'Recovery Winch hauling: a motor whirr with a cable ratchet over it.',
  [
    L(
      'saw',
      [
        [0, 140],
        [0.1, 190],
        [0.5, 190],
      ],
      hold(0.02, 0.5, 0.58),
      { flt: { t: 'bp', f: 900, q: 3 } },
    ),
    L('metal', 1.3, hold(0.02, 0.5, 0.58), {
      g: 0.6,
      lfo: { w: 'sq', hz: 18, depth: 1, to: 'amp' },
    }),
  ],
);
add(
  'capacitor_zap',
  'weapons',
  'utility',
  60,
  'Burst Capacitor dumping: a short fat discharge snap.',
  [
    L(
      'saw',
      [
        [0, 900],
        [0.08, 110],
      ],
      pluck(0.1),
      { crush: 6 },
    ),
    L(
      'sin',
      [
        [0, 90],
        [0.1, 55],
      ],
      pluck(0.12),
      { g: 0.45 },
    ),
  ],
  { limitMs: 200 },
);
add(
  'utility_interrupted',
  'weapons',
  'utility',
  55,
  'A repair or utility cut short: two falling, deflating notes.',
  [
    L('p25', arp([hz(69), hz(62)], 0.07), hold(0.003, 0.13, 0.2), { glide: 'step' }),
    L(
      'noise',
      0.5,
      [
        [0.14, 0],
        [0.16, 0.5],
        [0.3, 0],
      ],
      { flt: { t: 'lp', f: 1200 } },
    ),
  ],
);

// --- Engine extras (one-shots that ride on the engine voices) ---------------------------------

add(
  'turbo_blowoff',
  'engine',
  'mech',
  40,
  'Turbo blow-off on lifting the throttle: a quick fluttering pshh.',
  [
    L(
      'noise',
      1,
      [
        [0.004, 1],
        [0.05, 0.6],
        [0.24, 0],
      ],
      {
        flt: {
          t: 'bp',
          f: [
            [0, 5200],
            [0.2, 2200],
          ],
          q: 2,
        },
        lfo: { w: 'saw', hz: 34, depth: 0.6, to: 'amp' },
      },
    ),
  ],
  { limitMs: 700, poly: 1 },
);
add(
  'spring_release',
  'engine',
  'mech',
  45,
  'Spring Drive letting its stored launch go: a big sproing.',
  [
    L(
      'tri',
      [
        [0, 80],
        [0.25, 520],
      ],
      [
        [0.003, 1],
        [0.3, 0],
      ],
      { lfo: { w: 'sin', hz: 22, depth: 0.1, to: 'f' } },
    ),
    L(
      'metal',
      [
        [0, 0.8],
        [0.25, 2.6],
      ],
      [
        [0.003, 0.6],
        [0.28, 0],
      ],
      { glide: 'lin' },
    ),
  ],
  { limitMs: 1500, poly: 1 },
);
add(
  'rocket_pulse',
  'engine',
  'mech',
  45,
  'Rocket Engine lighting a fuel pulse: a deep cough of flame.',
  [
    L(
      'noise',
      0.5,
      [
        [0.01, 1],
        [0.08, 0.5],
        [0.3, 0],
      ],
      {
        flt: {
          t: 'lp',
          f: [
            [0, 3000],
            [0.25, 500],
          ],
        },
      },
    ),
    L(
      'sin',
      [
        [0, 120],
        [0.2, 60],
      ],
      pluck(0.24),
      { g: 0.5 },
    ),
  ],
  { limitMs: 500, poly: 1 },
);
export const SFX_LIST: readonly Recipe[] = list;

export const SFX: Readonly<Record<string, Recipe>> = Object.freeze(
  Object.fromEntries(list.map((recipe) => [recipe.id, recipe])),
);

export type SoundId = string;

export function getRecipe(id: SoundId): Recipe | undefined {
  return SFX[id];
}
