import { describe, expect, it } from 'vitest';
import { NETWORKS, runNet } from './netcode.js';
import { pacedAuthority } from './netcodeReport.js';

/**
 * Netcode acceptance: on any plausible connection, with a phone that drops frames now and
 * then, the server never has to correct the player's own car. A correction is a lurch.
 */
describe('prediction against the drive room input policy', () => {
  it.each(NETWORKS)('$name: no visible correction in two minutes of racing', ({ model }) => {
    const r = runNet(model, 120, pacedAuthority);
    expect(r.finalLap).toBeGreaterThanOrEqual(3);
    expect(r.corrections).toBe(0);
    expect(r.worstVisibleSpeedError).toBeLessThan(1);
  });

  it('stays bounded and recovers when the client freezes for longer than the server will wait', () => {
    // 400 ms freezes are past the quarter second the client and server will absorb, so
    // corrections happen. They must stay small (about a tick of travel) and rare (about one
    // per freeze), and the race must carry on.
    const r = runNet(
      { latencyMs: 60, jitterMs: 45, hitchMs: 400, hitchEverySeconds: 6, seed: 21 },
      120,
      pacedAuthority,
    );
    expect(r.finalLap).toBeGreaterThanOrEqual(2);
    expect(r.worstPx).toBeLessThan(30);
    expect(r.correctionsPerMinute).toBeLessThan(20);
  });
});
