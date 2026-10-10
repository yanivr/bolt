import { CHASSIS_LIST, allParts, partCard } from '@bolt/content';
import { accessoryMounts, engineMount } from '@bolt/shared';

/**
 * Prints the reference tables of docs/GARAGE_API.md from the catalog: every part id with its
 * footprint and compatible mounts, and every chassis with its wheel anchors and mounts.
 * `tests/unit/docs.test.ts` fails when the document and the catalog disagree.
 *
 *   npx tsx tests/tools/catalogTables.ts
 */

const n = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

export function partTable(): string {
  const lines = [
    '| Part id | Name | Footprint w x h | Compatible mounts | Hardpoint | Turns | Height | Trigger | Max per car |',
    '| :-- | :-- | :-- | :-- | :-- | :-- | --: | :-- | --: |',
  ];
  for (const part of allParts()) {
    const card = partCard(part);
    const accessory =
      part.category === 'weapon' || part.category === 'defense' || part.category === 'utility';
    lines.push(
      `| \`${part.id}\` | ${part.displayName} | ${part.footprint.w} x ${part.footprint.h} | ${
        part.category === 'chassis' ? 'body' : part.compatibleMounts.join(', ')
      } | ${accessory ? part.hardpointUse : 'n/a'} | ${accessory ? (part.rotatable ? 'yes' : 'no') : 'n/a'} | ${
        accessory ? part.heightLevel : 'n/a'
      } | ${card.triggerMode} | ${card.maxPerCar ?? 'n/a'} |`,
    );
  }
  return lines.join('\n');
}

export function chassisTables(): string {
  const out: string[] = [];
  for (const chassis of CHASSIS_LIST) {
    const bay = engineMount(chassis)!;
    out.push(`#### ${chassis.displayName} (\`${chassis.id}\`)`);
    out.push('');
    out.push(
      `Body ${chassis.bodyHalfWidth * 2} x ${chassis.bodyHalfLength * 2}. Engine bay at (${n(bay.x)}, ${n(bay.y)}). Wheels: ${chassis.wheelAnchors
        .map(
          (w) =>
            `\`${w.id}\` (${n(w.x)}, ${n(w.y)})${w.steers ? ' steers' : ''}${w.driven ? ' driven' : ''}`,
        )
        .join('; ')}.`,
    );
    out.push('');
    out.push(
      '| Mount id | Categories | Centre x, y | Max footprint w x h | Region +/- x, y | Turns allowed | Capacity |',
    );
    out.push('| :-- | :-- | :-- | :-- | :-- | :-- | --: |');
    for (const mount of accessoryMounts(chassis))
      out.push(
        `| \`${mount.id}\` | ${mount.categories.join(', ')}${mount.acceptsAnyWeapon ? ' (any weapon)' : ''} | ${n(mount.x)}, ${n(mount.y)} | ${mount.maxFootprint.w} x ${mount.maxFootprint.h} | ${mount.regionHalfW}, ${mount.regionHalfH} | ${mount.allowedQuarterTurns.join(' ')} | ${mount.capacity} |`,
      );
    out.push('');
  }
  return out.join('\n');
}

// Printed only when run directly, so the test can import the functions.
if (process.argv[1]?.endsWith('catalogTables.ts')) {
  console.log(partTable());
  console.log('');
  console.log(chassisTables());
}
