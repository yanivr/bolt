import { BASELINE_BLUEPRINT, CATALOG } from '@bolt/content';
import { describe, expect, it } from 'vitest';
import * as build from '../../apps/web/src/garage/buildSession.js';
import { clockSound, garageSound } from '../../apps/web/src/garage/garageSounds.js';

/**
 * Which interface sound a change in the garage asks for (docs/DECISIONS.md, entry 137). The
 * sound is decided from the session before and after, so a tap, a key, a drag and an undo are
 * all heard the same way.
 */

function start(): build.GarageSession {
  return build.startSession(BASELINE_BLUEPRINT, CATALOG, { now: 0, seconds: 60 });
}

describe('garage sounds', () => {
  it('hears an install by its part, a turn, a removal and a refusal', () => {
    const s0 = start();
    expect(garageSound(null, s0)).toBeNull();
    expect(garageSound(s0, s0)).toBeNull();

    const picked = build.selectSlot(s0, CATALOG, { kind: 'mount', mountId: 'roof_mid' });
    expect(garageSound(s0, picked)).toEqual({ kind: 'select' });
    const focused = build.focusPart(picked, 'weapon_shotgun');
    const s1 = build.install(focused, CATALOG, 'weapon_shotgun');
    expect(build.currentBlueprint(s1).parts.length).toBe(1);
    expect(garageSound(focused, s1)).toEqual({ kind: 'install', partId: 'weapon_shotgun' });

    const id = build.currentBlueprint(s1).parts[0]!.instanceId;
    const s2 = build.rotate(s1, CATALOG, id);
    expect(garageSound(s1, s2)).toEqual({ kind: 'rotate' });
    const s3 = build.nudge(s2, CATALOG, id, 1, 0);
    expect(garageSound(s2, s3)).toEqual({ kind: 'tap' });
    const s4 = build.remove(s3, CATALOG, id);
    expect(garageSound(s3, s4)).toEqual({ kind: 'remove' });
    // Undo puts it back: that is an install, and sounds like one.
    const s5 = build.undoEdit(s4, CATALOG);
    expect(garageSound(s4, s5)).toEqual({ kind: 'install', partId: 'weapon_shotgun' });

    // A nudge that cannot be made is refused, and nothing else is heard for it.
    let stuck = s5;
    let refused: build.GarageSession | null = null;
    for (let i = 0; i < 40 && !refused; i++) {
      const next = build.nudge(stuck, CATALOG, id, 1, 0);
      if (next.notice?.tone === 'error' && next.notice.stamp !== stuck.notice?.stamp)
        refused = next;
      else stuck = next;
    }
    expect(refused).not.toBeNull();
    expect(garageSound(stuck, refused!)).toEqual({ kind: 'illegal' });

    // A new chassis, engine or wheel kit is an install too.
    const chassis = build.install(build.focusPart(s0, 'chassis_arrow'), CATALOG, 'chassis_arrow');
    expect(garageSound(s0, chassis)).toEqual({ kind: 'install', partId: 'chassis_arrow' });
  });

  it('hears Ready and the end of the clock apart', () => {
    const s0 = start();
    const ready = build.ready(s0, CATALOG);
    expect(ready.phase).toBe('locked');
    expect(garageSound(s0, ready)).toEqual({ kind: 'ready' });
    const late = build.tick(s0, 61_000);
    expect(late.phase).toBe('locked');
    expect(garageSound(s0, late)).toEqual({ kind: 'timer_end' });
  });

  it('ticks once a second from ten seconds, urgently from three', () => {
    expect(clockSound(null, 9.8)).toBeNull();
    expect(clockSound(12.1, 11.9)).toBeNull();
    expect(clockSound(10.1, 9.9)).toBe('timer_tick');
    expect(clockSound(9.9, 9.7)).toBeNull();
    expect(clockSound(4.1, 3.9)).toBe('timer_tick');
    expect(clockSound(3.1, 2.9)).toBe('timer_urgent');
    expect(clockSound(1.1, 0.9)).toBe('timer_urgent');
    expect(clockSound(0.1, 0)).toBeNull();
    expect(clockSound(5, null)).toBeNull();
  });
});
