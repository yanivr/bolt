import type { DriveSession } from '@bolt/shared';
import { MAX_QUEUED_INPUTS, stepDriveSession } from '@bolt/shared';
import { InputPacer } from '../../apps/server/src/rooms/inputPacer.js';
import type { Authority } from './netcode.js';
import { NETWORKS, NET_HEADER, formatNet, runNet } from './netcode.js';

/**
 * Prints how often the shipped server input policy makes the client correct its own car.
 *
 *   npx tsx tests/feel/netcodeReport.ts
 */

/** The drive room's handling of one car, without the room around it. */
export function pacedAuthority(session: DriveSession): Authority {
  const pacer = new InputPacer(MAX_QUEUED_INPUTS);
  return {
    session,
    receive: (samples) => void pacer.accept(samples),
    tick: () => void pacer.tick(true, (control) => stepDriveSession(session, control)),
    ackSequence: () => pacer.ackSequence,
  };
}

if (process.argv[1]?.endsWith('netcodeReport.ts')) {
  console.log('SHIPPED SERVER INPUT POLICY (each sample simulated exactly once), reference driver, 120 s\n');
  console.log(NET_HEADER);
  for (const n of NETWORKS) console.log(formatNet(n.name, runNet(n.model, 120, pacedAuthority)));
}
