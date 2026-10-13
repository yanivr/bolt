import { describe, expect, it } from 'vitest';
import { NETWORKS, runNet } from './netcode.js';
import { pacedAuthority } from './netcodeReport.js';

/**
 * Netcode acceptance under the room's own 30 Hz clock (Milestone E). The room never waits for
 * a driver, so a sample that is not there in time is stood in for by the last control. On any
 * plausible connection that stand-in is what the driver did anyway, and the player's own car
 * is never visibly corrected. A frame hitch long enough to empty the input buffer costs at
 * most a correction of a pixel or two; a frozen page costs a correction per freeze.
 */
describe('prediction against the room input policy', () => {
  const steady = NETWORKS.filter((n) => n.model.hitchMs === 0);
  const hitching = NETWORKS.filter((n) => n.model.hitchMs > 0);

  it.each(steady)('$name: no visible correction in two minutes of racing', ({ model }) => {
    const r = runNet(model, 120, pacedAuthority);
    expect(r.finalLap).toBeGreaterThanOrEqual(3);
    expect(r.corrections).toBe(0);
    expect(r.worstVisibleSpeedError).toBeLessThan(1);
  });

  it.each(hitching)('$name: at most a couple of pixel-sized corrections', ({ model }) => {
    const r = runNet(model, 120, pacedAuthority);
    expect(r.finalLap).toBeGreaterThanOrEqual(3);
    expect(r.corrections).toBeLessThanOrEqual(2);
    expect(r.worstPx).toBeLessThan(4);
  });

  it('stays bounded and recovers when the client freezes for longer than the buffer holds', () => {
    // A 400 ms freeze every 6 s: the page loses that time (the frame pacer treats it as a
    // pause) while the room runs on, so each freeze is followed by a burst of corrections
    // while the client numbers on from the room's clock. They stay about a tick or two of
    // travel and the race carries on.
    const r = runNet(
      { latencyMs: 60, jitterMs: 45, hitchMs: 400, hitchEverySeconds: 6, seed: 21 },
      120,
      pacedAuthority,
    );
    const freezes = 120 / 6;
    expect(r.finalLap).toBeGreaterThanOrEqual(2);
    expect(r.worstPx).toBeLessThan(30);
    expect(r.corrections / freezes).toBeLessThan(10);
  });
});
