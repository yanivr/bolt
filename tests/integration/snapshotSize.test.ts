import { getTemplate } from '@bolt/content';
import { SNAPSHOT_HZ, SIM_HZ, stepRaceWithBrains } from '@bolt/shared';
import { describe, expect, it } from 'vitest';
import {
  DriveState,
  StateEncoder,
  writeDriveState,
  writeRaceState,
} from '../../apps/server/src/rooms/schema.js';
import { createBotMatch } from '../balance/harness.js';

/**
 * What the room's synchronized state costs on the wire (Section 15.4). The room writes this
 * exact schema with these exact functions and Colyseus sends the encoder's output: one full
 * state on join, then one patch per snapshot holding only the fields that changed.
 *
 * The match is the heaviest shipped pairing for traffic: two guns each, traps and a mortar.
 */

const STEPS_PER_SNAPSHOT = SIM_HZ / SNAPSHOT_HZ;

function measure(a: string, b: string, seed: number) {
  const { race, brains } = createBotMatch(getTemplate(a)!, getTemplate(b)!, seed);
  const state = new DriveState();
  const encoder = new StateEncoder(state);
  const write = () => {
    writeDriveState(state, race.cars[0]!.session, race.tick);
    writeRaceState(state, race, 0);
  };
  write();
  const full = encoder.encodeAll().byteLength;
  encoder.discardChanges();

  const patches: number[] = [];
  const busy: number[] = [];
  let entities = 0;
  // A function, so the compiler does not assume the phase is unchanged by a step.
  const over = () => race.phase === 'FINISHED';
  while (!over()) {
    for (let i = 0; i < STEPS_PER_SNAPSHOT && !over(); i++) stepRaceWithBrains(race, [], brains);
    write();
    const bytes = encoder.encode().byteLength;
    encoder.discardChanges();
    if (race.phase !== 'RACING') continue;
    patches.push(bytes);
    const live =
      race.projectiles.filter((p) => p.active).length + race.hazards.filter((h) => h.active).length;
    entities = Math.max(entities, live);
    if (live > 0) busy.push(bytes);
  }
  const sorted = [...patches].sort((x, y) => x - y);
  const mean = patches.reduce((sum, v) => sum + v, 0) / patches.length;
  return {
    full,
    mean,
    p95: sorted[Math.floor(sorted.length * 0.95)]!,
    worst: sorted[sorted.length - 1]!,
    busyMean: busy.length > 0 ? busy.reduce((sum, v) => sum + v, 0) / busy.length : 0,
    snapshots: patches.length,
    entities,
  };
}

describe('snapshot size (Section 15.4)', () => {
  it('sends a two-car fight in a few hundred bytes a snapshot', () => {
    const fight = measure('starter_longlegs', 'starter_packhorse', 41);
    const traps = measure('example_back_alley_trap', 'starter_tinker', 7);
    const quiet = measure('baseline', 'baseline', 5);
    for (const [name, m] of [
      ['Longlegs against Packhorse', fight],
      ['Back-Alley Trap against Tinker', traps],
      ['two unarmed baseline cars', quiet],
    ] as const)
      console.log(
        `snapshot bytes, ${name}: full state ${m.full}; per patch mean ${m.mean.toFixed(0)}, p95 ${m.p95}, worst ${m.worst}; ` +
          `mean with entities live ${m.busyMean.toFixed(0)}; ${((m.mean * SNAPSHOT_HZ * 8) / 1000).toFixed(1)} kbit/s at ${SNAPSHOT_HZ} Hz ` +
          `(${m.snapshots} snapshots, up to ${m.entities} entities)`,
      );
    for (const m of [fight, traps, quiet]) {
      // The join state: both cars, the rival's whole blueprint, every module and status slot.
      expect(m.full).toBeLessThan(4096);
      // A patch: the player's exact motion (float64), the rival's (float32), and what changed.
      expect(m.mean).toBeLessThan(300);
      expect(m.p95).toBeLessThan(400);
      expect(m.worst).toBeLessThan(800);
      // Fifteen a second stays far under what a phone on a poor connection carries.
      expect(m.mean * SNAPSHOT_HZ * 8).toBeLessThan(64_000);
    }
    expect(fight.entities).toBeGreaterThan(0);
    // Combat adds to a quiet race, but does not multiply it.
    expect(fight.mean).toBeLessThan(quiet.mean * 2);
  });
});
