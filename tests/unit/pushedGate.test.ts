import {
  BASELINE_BLUEPRINT,
  CATALOG,
  conditionsFor,
  environmentFor,
  getTrack,
  raceEntry,
} from '@bolt/content';
import type { BuildConditions, DriveSession, RaceEnvironment, VehicleParams } from '@bolt/shared';
import {
  GATE_END_SLACK_WALLED,
  buildTrack,
  createDriveSession,
  createRace,
  creditMovedCrossing,
  crossesGate,
  stepDriveSession,
  stepRace,
} from '@bolt/shared';
import { describe, expect, it } from 'vitest';

/**
 * A checkpoint crossed by a push, not by driving (found by the bot tournament on Canyon
 * Switch). The race moves cars after their own step (contact, shoves, the winch); the step's
 * gate test only sees the car's own motion, so a car pushed across a gate used to lose the
 * lap. `creditMovedCrossing` tests the push with the same rule.
 */

const track = buildTrack(getTrack('desert_02')!);
const ENV = environmentFor('desert_dry_heat') as RaceEnvironment;
const CONDITIONS = conditionsFor('desert_02', 'desert_dry_heat') as BuildConditions;
const ENTRY = raceEntry(BASELINE_BLUEPRINT, CONDITIONS)!;
function params(): VehicleParams {
  return ENTRY.params;
}

/** A racing session parked a little short of checkpoint `index`, facing through it. */
function shortOf(index: number, back: number): DriveSession {
  const session = createDriveSession(track, ENV, params());
  while (session.phase !== 'RACING')
    stepDriveSession(session, { steer: 0, brake: 1, coast: false });
  const gate = track.checkpoints[index]!.gates[0]!;
  const cx = (gate.ax + gate.bx) / 2;
  const cy = (gate.ay + gate.by) / 2;
  session.progress.checkpointIndex = index;
  session.progress.lap = 1;
  session.motion.x = cx - gate.tx * back;
  session.motion.y = cy - gate.ty * back;
  session.motion.headingRad = Math.atan2(gate.tx, -gate.ty);
  return session;
}

describe('a gate crossed by a push', () => {
  it('is credited exactly as a driven crossing would be', () => {
    const session = shortOf(3, 0.1);
    const gate = track.checkpoints[3]!.gates[0]!;
    const fromX = session.motion.x;
    const fromY = session.motion.y;
    // A shove of half a pixel along the road, as contact gives.
    session.motion.x += gate.tx * 0.5;
    session.motion.y += gate.ty * 0.5;
    const result = creditMovedCrossing(session, fromX, fromY);
    expect(result.event).toBe('checkpoint');
    expect(session.progress.checkpointIndex).toBe(4);
  });

  it('changes nothing when the push crosses no gate, or crosses one backwards', () => {
    const session = shortOf(3, 30);
    const before = structuredClone(session.progress);
    const gate = track.checkpoints[3]!.gates[0]!;
    const fromX = session.motion.x;
    const fromY = session.motion.y;
    session.motion.x += gate.tx * 5;
    session.motion.y += gate.ty * 5;
    expect(creditMovedCrossing(session, fromX, fromY).event).toBe('none');
    expect(session.progress).toEqual(before);
    // Backwards through the gate it cleared: not a crossing.
    const past = shortOf(3, -1);
    const px = past.motion.x;
    const py = past.motion.y;
    past.motion.x -= gate.tx * 3;
    past.motion.y -= gate.ty * 3;
    expect(creditMovedCrossing(past, px, py).event).toBe('none');
  });

  it('leaves a race where nothing is pushed across a gate bit-identical', () => {
    // One car alone is never pushed: the hook must not change a single number.
    const race = createRace(track, ENV, [ENTRY], {
      seed: 5,
      conditions: CONDITIONS,
      catalog: CATALOG,
      tow: false,
    });
    const input = { steer: 0.05, brake: 0, coast: false };
    for (let i = 0; i < 30 * 12; i++) stepRace(race, [input]);
    const session = createDriveSession(track, ENV, ENTRY.params);
    for (let i = 0; i < 30 * 12; i++) stepDriveSession(session, input);
    expect(race.cars[0]!.session.motion).toEqual(session.motion);
    expect(race.cars[0]!.session.progress).toEqual(session.progress);
  });
});

describe('the ends of a gate on a walled track', () => {
  it('count a crossing a car width past the end, where a fork leaves a gap between two gates', () => {
    // Steel Circuit's checkpoint at Conveyor Gap: the main line's gate and the shortcut's twin
    // left a 43 px gap at the fork, and a car on the inside line went through it uncredited.
    const steel = buildTrack(getTrack('industrial_01')!);
    expect(steel.walled).toBe(true);
    const gate = steel.checkpoints[4]!.gates[0]!;
    const len = Math.hypot(gate.bx - gate.ax, gate.by - gate.ay);
    const ux = (gate.bx - gate.ax) / len;
    const uy = (gate.by - gate.ay) / len;
    const across = (beyond: number) => {
      const px = gate.bx + ux * beyond;
      const py = gate.by + uy * beyond;
      return crossesGate(
        steel,
        gate,
        px - gate.tx * 3,
        py - gate.ty * 3,
        px + gate.tx * 3,
        py + gate.ty * 3,
      );
    };
    expect(across(-10)).toBe(true);
    expect(across(10)).toBe(true);
    expect(across(GATE_END_SLACK_WALLED + 6)).toBe(false);
    // Backwards never counts.
    const px = gate.bx - ux * 10;
    const py = gate.by - uy * 10;
    expect(
      crossesGate(
        steel,
        gate,
        px + gate.tx * 3,
        py + gate.ty * 3,
        px - gate.tx * 3,
        py - gate.ty * 3,
      ),
    ).toBe(false);
    // An open track keeps exact ends.
    const open = buildTrack(getTrack('desert_02')!);
    const g = open.checkpoints[2]!.gates[0]!;
    const l = Math.hypot(g.bx - g.ax, g.by - g.ay);
    const ox = g.bx + ((g.bx - g.ax) / l) * 10;
    const oy = g.by + ((g.by - g.ay) / l) * 10;
    expect(crossesGate(open, g, ox - g.tx * 3, oy - g.ty * 3, ox + g.tx * 3, oy + g.ty * 3)).toBe(
      false,
    );
  });
});
