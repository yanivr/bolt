import type { Material } from '../../lib/model.js';
import { ramp } from '../../lib/model.js';
import { CAR_MATERIALS, PAINT_KEY, PAINT_OUTLINE_KEY } from '../materials.js';

/**
 * Materials for mounted parts, on top of the shared vehicle ramps. Three families so a
 * category reads at a glance: weapons are pale gunmetal with warm tips, defenses are pale
 * armor steel with hazard or ivory edging, utilities are blue housings with mint, cyan and
 * gold working parts. Mounted parts never use `paint`: their sheets are not repainted, and
 * no color here may equal a paint key color.
 *
 * Weapon metal is lighter and cooler than the midtone of every paint (the brightest are Mint
 * `#3cc79a` and Sunflare `#e89b2a`), so a gun stands off red, cobalt, mint and sunflare
 * bodywork alike; `mount`, the dark base a part bolts down with, stays dark so the part has
 * its own contrast inside its near-black outline.
 */
const EXTRA: Record<string, Material> = {
  // Weapons.
  gunmetal: ramp('#4f5b79', '#7482a2', '#a2afc9', '#cdd7ea', '#f4f8fd', '#141926'),
  iron: ramp('#7584a3', '#a0aec8', '#cbd6e8', '#edf2fa', '#ffffff', '#1c2435'),
  mount: ramp('#1b2233', '#293248', '#3b4761', '#56647f', '#7c8ba8', '#0a0d17'),
  amber: ramp('#a65814', '#d47a1c', '#f69e2c', '#ffca60', '#fff2b8', '#4a240a'),
  coral: ramp('#8a1b20', '#ba2b28', '#e44434', '#ff7858', '#ffbda5', '#3c0c12'),
  brass: ramp('#7a5c18', '#a07e22', '#c49e34', '#e8ca62', '#fff4b2', '#2e1f0a'),
  hot: ramp('#ff8a1c', '#ff8a1c', '#ffb53e', '#ffe38a', '#fffbe0', '#c24a0e', { flat: true }),
  violet: ramp('#4a26a0', '#6836c4', '#8a4de6', '#b98dff', '#eedcff', '#1c0d40'),
  violetGlow: ramp('#b98dff', '#b98dff', '#c9a4ff', '#eedcff', '#ffffff', '#5a2cb8', {
    flat: true,
  }),
  frost: ramp('#5f9fc6', '#84c4e2', '#a9e0f3', '#d9f6ff', '#ffffff', '#1f4062'),
  foam: ramp('#7a9c7e', '#a2c49c', '#cde6bf', '#eefbe1', '#ffffff', '#2e453a'),
  oil: ramp('#141c36', '#1e2a4c', '#2a3a66', '#405690', '#6e88c4', '#080b17'),
  rope: ramp('#6e5830', '#917642', '#b08f56', '#d9bd82', '#f5e6b4', '#2c2213'),
  blade: ramp('#7887a2', '#9aa8bf', '#bcc8da', '#e6edf6', '#ffffff', '#1d2536'),
  // Defenses.
  armor: ramp('#606a80', '#808ba1', '#a5b0c3', '#cdd5e2', '#f3f6fa', '#1b1f2c'),
  armorDark: ramp('#2a3040', '#394154', '#4c566b', '#6a7589', '#96a0b3', '#0e1119'),
  hazard: ramp('#a8780c', '#cf9c12', '#f1c11a', '#ffe05c', '#fff7ba', '#3c2a06'),
  pad: ramp('#4d6338', '#637b47', '#7f9859', '#aac680', '#e1f1b9', '#182113'),
  foil: ramp('#9a781c', '#bc962a', '#dcb23a', '#ffe078', '#fffad0', '#35280a'),
  // Utilities.
  tire: ramp('#2a3247', '#3a4560', '#525e7c', '#727f9f', '#9ca9c6', '#0a0d17'),
  housing: ramp('#343f6b', '#4c5c90', '#6f80b8', '#99a9d8', '#cdd7f3', '#0a0d1b'),
  mint: ramp('#158e78', '#20b792', '#2edfae', '#8bffd9', '#e1fff5', '#073032'),
  mintGlow: ramp('#2edfae', '#2edfae', '#5cf0c2', '#b4ffe6', '#ffffff', '#158e78', {
    flat: true,
  }),
  cyan: ramp('#156fa8', '#1e93cc', '#28b7ef', '#7de4ff', '#e1faff', '#07243f'),
  cyanGlow: ramp('#28b7ef', '#28b7ef', '#58d2ff', '#b0f0ff', '#ffffff', '#156fa8', {
    flat: true,
  }),
  gold: ramp('#a06c12', '#c2881a', '#e3a322', '#ffd052', '#fff4b0', '#36230a'),
  nitro: ramp('#1c38a8', '#244cc8', '#2d61e7', '#5d99ff', '#b9d9ff', '#0a113c'),
  solar: ramp('#0f2676', '#153696', '#1b46b4', '#3877df', '#89c1ff', '#050c2a'),
  mintBox: ramp('#146757', '#1a8169', '#219b7b', '#49cba0', '#a1f0d1', '#072422'),
  ledRed: ramp('#ff4638', '#ff4638', '#ff6a54', '#ffb0a0', '#ffffff', '#a81c1c', { flat: true }),
  ledAmber: ramp('#ffb020', '#ffb020', '#ffc84e', '#ffe9a6', '#ffffff', '#b06a0c', {
    flat: true,
  }),
};

export const PART_MATERIALS: Record<string, Material> = { ...CAR_MATERIALS, ...EXTRA };

// The runtime paint swap matches exact colors, so nothing here may reuse a paint key color.
{
  const key = new Set([PAINT_OUTLINE_KEY, ...PAINT_KEY].map((c) => c.toLowerCase()));
  for (const [name, mat] of Object.entries(EXTRA)) {
    for (const c of [...mat.ramp, mat.outline]) {
      const h = `#${[c[0], c[1], c[2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
      if (key.has(h)) throw new Error(`Part material ${name} reuses paint key color ${h}`);
    }
  }
}
