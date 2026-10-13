import { describe, expect, it } from 'vitest';
import { createMemoryPersistence } from '../../apps/server/src/db/memory.js';
import {
  MAX_SAMPLED_EVENTS,
  createMatchRecorder,
  playerRef,
  sampleNotableEvents,
} from '../../apps/server/src/db/matchRecorder.js';
import { recordMatch, setMatchRecorder } from '../../apps/server/src/rooms/matchLog.js';
import { silentLogger } from '../../apps/server/src/telemetry/log.js';
import { hitEvent, repositoryContract, summary } from '../helpers/persistence.js';

/** The in-memory persistence layer the server uses without DATABASE_URL, against the contract. */
repositoryContract('in memory', async () => ({
  persistence: createMemoryPersistence(),
  cleanup: async () => {},
}));

describe('in-memory persistence', () => {
  it('reports no database and bounds what it stores', async () => {
    const persistence = createMemoryPersistence({ maxMatches: 2 });
    expect(persistence.kind).toBe('memory');
    expect(await persistence.health()).toBe('not_configured');
    for (const id of ['a', 'b', 'c'])
      await persistence.matches.insert(
        {
          id,
          mode: 'ai',
          trackId: 't',
          weatherPresetId: 'w',
          seed: 1,
          catalogVersion: '0',
          playerRefs: [],
          playerKinds: [],
          blueprintHashes: [],
          result: {},
          startedAt: new Date(),
          endedAt: new Date(),
          disconnectReason: null,
          metrics: {},
        },
        [],
        new Date(),
      );
    expect((await persistence.matches.count()).matches).toBe(2);
    expect(await persistence.matches.get('a')).toBeUndefined();
  });
});

describe('event sampling', () => {
  it('keeps notable events only, highest priority first when full, in time order', () => {
    const events = [
      ...Array.from({ length: 300 }, (_, i) => hitEvent(i + 1, i, 10 + (i % 7))),
      hitEvent(1000, 5, 1),
    ];
    const kept = sampleNotableEvents(events, 50);
    expect(kept).toHaveLength(50);
    expect(kept.every((e) => Number(e.data.damage) >= 15)).toBe(true);
    expect(kept.map((e) => e.seq)).toEqual([...Array(50).keys()]);
    expect(sampleNotableEvents([hitEvent(1, 1, 1)])).toEqual([]);
    expect(MAX_SAMPLED_EVENTS).toBe(240);
  });

  it('names an AI by its slot and a guest by a keyed per-match pseudonym', () => {
    expect(playerRef('k', 'm1', null, 1)).toBe('ai1');
    const a = playerRef('key-one-0123456789', 'm1', 'guest', 0);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(playerRef('key-one-0123456789', 'm2', 'guest', 0)).not.toBe(a);
    expect(playerRef('key-two-0123456789', 'm1', 'guest', 0)).not.toBe(a);
  });
});

describe('the match log hook', () => {
  it('stores what the room hands to recordMatch, and a failing store never throws into a room', async () => {
    const persistence = createMemoryPersistence();
    const store = createMatchRecorder({
      repo: persistence.matches,
      pseudonymKey: 'hook-key-0123456789',
      logger: silentLogger,
    });
    setMatchRecorder(store.record);
    recordMatch(summary('hook-1', 'g'.repeat(22)));
    await store.flush();
    expect(await persistence.matches.get('hook-1')).toBeDefined();
    // A forfeit names the seat and the cause.
    recordMatch({ ...summary('hook-2', 'h'.repeat(22)), disconnect: { seat: 1, cause: 'left' } });
    await store.flush();
    expect((await persistence.matches.get('hook-2'))!.match.disconnectReason).toBe('seat1:left');
    // Garbage is logged and dropped, never thrown at the room.
    expect(() => recordMatch({ ...summary('bad id with spaces', 'x'.repeat(22)) })).not.toThrow();
    await store.flush();
    expect(await persistence.matches.get('bad id with spaces')).toBeUndefined();
    setMatchRecorder(null);
  });
});
