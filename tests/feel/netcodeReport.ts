import type { ControlInput, DriveSession } from '@bolt/shared';
import { TickInputBuffer, stepDriveSession } from '@bolt/shared';
import type { Authority } from './netcode.js';
import { NETWORKS, NET_HEADER, formatNet, runNet } from './netcode.js';

/**
 * Prints how often the shipped server input policy makes the client correct its own car.
 *
 *   npx tsx tests/feel/netcodeReport.ts
 */

/**
 * One car under the room's input policy (Milestone E, `TickInputBuffer`), without the room
 * around it: the car waits on the grid for its driver's first samples, as the drive room does,
 * and from then on advances once per room tick whatever arrives.
 */
export function pacedAuthority(session: DriveSession): Authority {
  const buffer = new TickInputBuffer();
  const control: ControlInput = { steer: 0, brake: 0, coast: true };
  let started = false;
  return {
    session,
    receive: (samples) => buffer.accept(samples),
    tick: () => {
      if (!started && buffer.queued < buffer.policy.initialDelay) return;
      started = true;
      buffer.step(control);
      stepDriveSession(session, control);
    },
    ackSequence: () => buffer.ackSequence,
  };
}

if (process.argv[1]?.endsWith('netcodeReport.ts')) {
  console.log('SHIPPED SERVER INPUT POLICY (one control per room tick), reference driver, 120 s\n');
  console.log(NET_HEADER);
  for (const n of NETWORKS) console.log(formatNet(n.name, runNet(n.model, 120, pacedAuthority)));
}
