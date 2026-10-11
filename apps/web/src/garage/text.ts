import { STRINGS } from '@bolt/content';

/** Fills `{name}` placeholders in a string from the shared copy table. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : whole,
  );
}

const MOUNT_WORDS: Record<string, string> = {
  mid: 'middle',
  fore: 'forward',
  aft: 'aft',
};

/** A mount id such as `front_center` as words a player reads: "Front center". */
export function mountName(mountId: string): string {
  const named: Record<string, string> = STRINGS.garage.mountNames;
  if (Object.prototype.hasOwnProperty.call(named, mountId)) return named[mountId]!;
  const words = mountId.split('_').map((word) => MOUNT_WORDS[word] ?? word);
  const text = words.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The few letters a slot tile has room for: "Roof F", "L Rear". */
export function mountShort(mountId: string): string {
  const table: Record<string, string> = STRINGS.garage.mountShort;
  if (Object.prototype.hasOwnProperty.call(table, mountId)) return table[mountId]!;
  const words = mountId.split('_').filter((word) => word !== 'center');
  const text = (words[0] ?? mountId).slice(0, 7);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Whole numbers stay whole; everything else gets one decimal. */
export function compactNumber(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** A signed whole-number delta: "+4", "-2" or an empty string for no change. */
export function signedDelta(value: number, digits = 0): string {
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  if (rounded === 0) return '';
  const body = digits === 0 ? String(Math.abs(rounded)) : Math.abs(rounded).toFixed(digits);
  return `${rounded > 0 ? '+' : '-'}${body}`;
}

/** "Radar, Spare Wheel and Nitro Tank". */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
