import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BASELINE_BLUEPRINT, CATALOG, CATALOG_VERSION, ROOKIE_BLUEPRINT } from '@bolt/content';
import type { RaceEvent, VehicleBlueprint } from '@bolt/shared';
import { buildHash, generateCarCode, isCanonicalCarCode } from '@bolt/shared';
import type { BlueprintServiceOptions } from '../../apps/server/src/db/blueprintService.js';
import { createBlueprintService } from '../../apps/server/src/db/blueprintService.js';
import type { RecordedMatch } from '../../apps/server/src/db/matchRecorder.js';
import { createMatchRecorder } from '../../apps/server/src/db/matchRecorder.js';
import { RETENTION, runRetention } from '../../apps/server/src/db/retention.js';
import type { Persistence } from '../../apps/server/src/db/types.js';
import { generateGuestId } from '../../apps/server/src/security/guestTokens.js';
import { silentLogger } from '../../apps/server/src/telemetry/log.js';

/**
 * One behavioral contract for every persistence implementation: the in-memory one runs it in
 * `tests/unit/dbMemory.test.ts`, PostgreSQL in `tests/integration/persistence.test.ts`. Both
 * must give the same answers, because the server cannot tell them apart.
 */

const DAY = 24 * 60 * 60 * 1000;
export const HOUR = 60 * 60 * 1000;

/** A blueprint with a fresh name, so each test owns its own car. */
export function namedCar(
  name: string,
  base: VehicleBlueprint = BASELINE_BLUEPRINT,
): VehicleBlueprint {
  return { ...base, name };
}

/** Registers a guest session so foreign keys hold, and returns its id. */
export async function newGuest(persistence: Persistence, at = new Date()): Promise<string> {
  const id = generateGuestId();
  await persistence.guests.create({
    id,
    tokenHash: randomBytes(32).toString('hex'),
    createdAt: at,
    lastSeenAt: at,
    expiresAt: new Date(at.getTime() + 14 * DAY),
  });
  return id;
}

/** A code source that replays the given codes, then falls back to random ones. */
export function scriptedCodes(codes: string[]): () => string {
  const queue = [...codes];
  return () => queue.shift() ?? generateCarCode((n) => randomBytes(n));
}

/** A finished two-player match as the room hook reports it, with optional events. */
export function summary(
  id: string,
  guestId: string,
  events: RaceEvent[] = [],
  rivalGuestId: string = generateGuestId(),
): RecordedMatch {
  const car = (finishTimeMs: number) => ({
    finished: true,
    finishTimeMs,
    courseProgress: 1,
    lastCheckpointMs: finishTimeMs,
    bestLapMs: 31_000,
    chassis: 80,
    ko: false,
    damageDealt: 40,
    damageTaken: 12,
    shotsFired: 9,
    hitsLanded: 5,
  });
  return {
    matchId: id,
    roomId: 'room1',
    round: 1,
    trackId: 'city_01',
    weatherPresetId: 'city_clear_night',
    seed: 12345,
    catalogVersion: CATALOG_VERSION,
    protocolVersion: 9,
    swapped: false,
    players: [
      {
        guestId: rivalGuestId,
        seat: 1,
        car: 1,
        buildHash: buildHash(ROOKIE_BLUEPRINT),
        nickname: 3,
      },
      { guestId, seat: 0, car: 0, buildHash: buildHash(BASELINE_BLUEPRINT), nickname: 7 },
    ],
    result: { winner: 0, reason: 'finish', raceTimeMs: 97_500, cars: [car(95_000), car(97_500)] },
    disconnect: null,
    startedAt: new Date(Date.now() - 120_000).toISOString(),
    endedAt: new Date().toISOString(),
    events,
  };
}

export function hitEvent(id: number, tick: number, damage: number): RaceEvent {
  return {
    id,
    tick,
    type: 'hit',
    car: 1,
    by: 0,
    weapon: 'weapon_front_mg',
    cls: 'bullet',
    x: 100.123456,
    y: 200,
    component: -1,
    damage,
    chassis: 0,
    shield: 0,
    armor: 0,
    absorbed: 0,
    projectile: id,
  };
}

export function repositoryContract(
  label: string,
  open: () => Promise<{ persistence: Persistence; cleanup: () => Promise<void> }>,
): void {
  describe(`${label}: persistence contract`, () => {
    let persistence: Persistence;
    let cleanup: () => Promise<void>;

    beforeAll(async () => {
      ({ persistence, cleanup } = await open());
    });
    afterAll(async () => {
      await cleanup();
    });

    const service = (extra: Partial<BlueprintServiceOptions> = {}) =>
      createBlueprintService({
        repo: persistence.blueprints,
        catalog: CATALOG,
        catalogVersion: CATALOG_VERSION,
        ...extra,
      });

    it('stores a legal car under a fresh code and finds it again by that code', async () => {
      const owner = await newGuest(persistence);
      const car = namedCar('Contract One');
      const created = await service().create(owner, 'req-contract-1', car);
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.reused).toBe(false);
      expect(isCanonicalCarCode(created.record.code)).toBe(true);
      expect(created.record.buildHash).toBe(buildHash(car));
      expect(created.record.catalogVersion).toBe(CATALOG_VERSION);
      const found = await service().lookup(created.record.code.toLowerCase().replace(/-/g, ' '));
      expect(found.ok).toBe(true);
      if (!found.ok) return;
      expect(found.stale).toBe(false);
      expect(found.blueprint).toEqual({ ...car, parts: [] });
      expect(buildHash(found.blueprint)).toBe(buildHash(car));
    });

    it('is idempotent by request id and deduplicates the same car per owner', async () => {
      const owner = await newGuest(persistence);
      const car = namedCar('Contract Twice');
      const first = await service().create(owner, 'req-twice-1', car);
      const replay = await service().create(owner, 'req-twice-1', car);
      const sameCar = await service().create(owner, 'req-twice-2', {
        ...car,
        createdAt: '2026-01-01',
      });
      expect(first.ok && replay.ok && sameCar.ok).toBe(true);
      if (!first.ok || !replay.ok || !sameCar.ok) return;
      expect(replay.record.code).toBe(first.record.code);
      expect(replay.reused).toBe(true);
      expect(sameCar.record.code).toBe(first.record.code);
      // A new name or paint is a new card in My Blueprints, so it gets its own code.
      const renamed = await service().create(owner, 'req-twice-3', namedCar('Contract Twice 2'));
      expect(renamed.ok && renamed.record.code !== first.record.code).toBe(true);
      // The same request id for a different car is a client bug, refused.
      const conflict = await service().create(owner, 'req-twice-1', namedCar('Other Car'));
      expect(conflict).toMatchObject({ ok: false, reason: 'request_conflict' });
      // Another guest sharing the same car gets a code of their own.
      const other = await newGuest(persistence);
      const theirs = await service().create(other, 'req-twice-1', car);
      expect(theirs.ok && theirs.record.code !== first.record.code).toBe(true);
    });

    it('retries a colliding code with a fresh one, and gives up after the attempt limit', async () => {
      const owner = await newGuest(persistence);
      const taken = await service().create(owner, 'req-collide-0', namedCar('Collide Base'));
      if (!taken.ok) throw new Error('setup failed');
      const fresh = generateCarCode((n) => randomBytes(n));
      const retried = await service({
        generateCode: scriptedCodes([taken.record.code, taken.record.code, fresh]),
      }).create(owner, 'req-collide-1', namedCar('Collide Next'));
      expect(retried).toMatchObject({ ok: true, record: { code: fresh } });
      const exhausted = await service({
        generateCode: () => taken.record.code,
        limits: { maxCodeAttempts: 3 },
      }).create(owner, 'req-collide-2', namedCar('Collide Never'));
      expect(exhausted).toMatchObject({ ok: false, reason: 'codes_exhausted' });
    });

    it('a deleted code keeps its row until purged, so it is never reissued meanwhile', async () => {
      const owner = await newGuest(persistence);
      const made = await service().create(owner, 'req-reissue-0', namedCar('Reissue Me'));
      if (!made.ok) throw new Error('setup failed');
      expect(await service().deleteMine(owner, made.record.id)).toBe(true);
      const again = await service({
        generateCode: scriptedCodes([made.record.code]),
      }).create(owner, 'req-reissue-1', namedCar('Reissue Other'));
      expect(again.ok && again.record.code !== made.record.code).toBe(true);
    });

    it('refuses illegal, outdated, unknown and malformed cars before storing anything', async () => {
      const owner = await newGuest(persistence);
      const before = await persistence.blueprints.countCreatedSince(owner, new Date(0));
      const s = service();
      expect(
        await s.create(owner, 'req-bad-1', { ...BASELINE_BLUEPRINT, totalCost: 1 }),
      ).toMatchObject({
        ok: false,
        reason: 'malformed',
      });
      expect(
        await s.create(owner, 'req-bad-2', { ...BASELINE_BLUEPRINT, catalogVersion: '0.1.0' }),
      ).toMatchObject({ ok: false, reason: 'catalog' });
      expect(
        await s.create(owner, 'req-bad-3', {
          ...BASELINE_BLUEPRINT,
          engineId: 'engine_warp_drive',
        }),
      ).toMatchObject({ ok: false, reason: 'unknown_part' });
      const overBudget = {
        ...BASELINE_BLUEPRINT,
        parts: Array.from({ length: 6 }, (_, i) => ({
          instanceId: `p${i + 1}`,
          partId: 'weapon_rocket',
          mountId: 'roof',
          offsetX: 0,
          offsetY: 0,
          rotationQuarterTurns: 0 as const,
        })),
      };
      expect(await s.create(owner, 'req-bad-4', overBudget)).toMatchObject({ ok: false });
      expect(await s.create(owner, 'req-bad-5', 'x'.repeat(20_000))).toMatchObject({
        ok: false,
        reason: 'malformed',
      });
      expect(
        await s.create(owner, 'req-bad-6', { ...BASELINE_BLUEPRINT, name: '<script>' }),
      ).toMatchObject({
        ok: false,
        reason: 'malformed',
      });
      expect(await persistence.blueprints.countCreatedSince(owner, new Date(0))).toBe(before);
    });

    it('holds a guest to its live and daily limits', async () => {
      const owner = await newGuest(persistence);
      const s = service({ limits: { maxLivePerGuest: 2, maxCreatesPerDay: 3 } });
      expect((await s.create(owner, 'req-lim-1', namedCar('Limit A'))).ok).toBe(true);
      const second = await s.create(owner, 'req-lim-2', namedCar('Limit B'));
      expect(second.ok).toBe(true);
      expect(await s.create(owner, 'req-lim-3', namedCar('Limit C'))).toMatchObject({
        ok: false,
        reason: 'quota',
      });
      if (second.ok) await s.deleteMine(owner, second.record.id);
      const fourth = await s.create(owner, 'req-lim-4', namedCar('Limit D'));
      expect(fourth.ok).toBe(true);
      // Three created today (one deleted): the daily limit counts deleted ones too.
      if (fourth.ok) await s.deleteMine(owner, fourth.record.id);
      expect(await s.create(owner, 'req-lim-5', namedCar('Limit E'))).toMatchObject({
        ok: false,
        reason: 'daily_limit',
      });
      // Reusing an existing code costs nothing against either limit.
      expect(await s.create(owner, 'req-lim-1', namedCar('Limit A'))).toMatchObject({
        ok: true,
        reused: true,
      });
    });

    it('lists only the owner live codes, newest first, and soft-deletes only their own', async () => {
      const owner = await newGuest(persistence);
      const stranger = await newGuest(persistence);
      let t = Date.now();
      const s = service({ now: () => new Date((t += 1000)) });
      const a = await s.create(owner, 'req-list-a', namedCar('List A'));
      const b = await s.create(owner, 'req-list-b', namedCar('List B'));
      if (!a.ok || !b.ok) throw new Error('setup failed');
      expect((await s.listMine(owner)).map((r) => r.code)).toEqual([b.record.code, a.record.code]);
      expect(await s.listMine(stranger)).toEqual([]);
      expect(await s.deleteMine(stranger, a.record.id)).toBe(false);
      expect((await s.lookup(a.record.code)).ok).toBe(true);
      expect(await s.deleteMine(owner, a.record.id)).toBe(true);
      expect(await s.deleteMine(owner, a.record.id)).toBe(false);
      expect(await s.lookup(a.record.code)).toEqual({ ok: false, reason: 'not_found' });
      expect((await s.listMine(owner)).map((r) => r.code)).toEqual([b.record.code]);
    });

    it('flags a code shared under an older catalog as stale', async () => {
      const owner = await newGuest(persistence);
      const made = await service().create(owner, 'req-stale-1', namedCar('Stale Soon'));
      if (!made.ok) throw new Error('setup failed');
      const later = createBlueprintService({
        repo: persistence.blueprints,
        catalog: CATALOG,
        catalogVersion: '9.9.9',
      });
      const found = await later.lookup(made.record.code);
      expect(found).toMatchObject({ ok: true, stale: true });
    });

    it('rejects a code with a typo without asking the repository', async () => {
      let asked = 0;
      const counting = createBlueprintService({
        repo: {
          ...persistence.blueprints,
          findByCode: async (code: string) => {
            asked++;
            return persistence.blueprints.findByCode(code);
          },
        } as Persistence['blueprints'],
        catalog: CATALOG,
        catalogVersion: CATALOG_VERSION,
      });
      const code = generateCarCode((n) => randomBytes(n));
      const typo = code.slice(0, 5) + (code[5] === 'Z' ? 'Y' : 'Z') + code.slice(6);
      expect(await counting.lookup(typo)).toEqual({ ok: false, reason: 'invalid' });
      expect(await counting.lookup('hello')).toEqual({ ok: false, reason: 'invalid' });
      expect(asked).toBe(0);
      expect(await counting.lookup(code)).toEqual({ ok: false, reason: 'not_found' });
      expect(asked).toBe(1);
    });

    it('deletes a guest and everything that is theirs, and nothing of anyone else', async () => {
      const owner = await newGuest(persistence);
      const other = await newGuest(persistence);
      const s = service();
      const mine = await s.create(owner, 'req-del-1', namedCar('Delete Me'));
      await s.create(owner, 'req-del-2', namedCar('Delete Me Too'));
      const theirs = await s.create(other, 'req-del-3', namedCar('Keep Mine'));
      if (!mine.ok || !theirs.ok) throw new Error('setup failed');
      await s.deleteMine(owner, mine.record.id);
      expect(await persistence.deleteGuest(owner)).toBe(2);
      expect(await persistence.guests.get(owner, new Date())).toBeUndefined();
      expect(await s.listMine(owner)).toEqual([]);
      expect(await persistence.blueprints.countCreatedSince(owner, new Date(0))).toBe(0);
      expect((await s.lookup(theirs.record.code)).ok).toBe(true);
      expect(await persistence.guests.get(other, new Date())).toBeDefined();
    });

    it('keeps guest sessions with only a token hash, and slides and expires them', async () => {
      const at = new Date();
      const id = await newGuest(persistence, at);
      const stored = await persistence.guests.get(id, at);
      expect(stored?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      const later = new Date(at.getTime() + 60_000);
      const rotated = { tokenHash: 'a'.repeat(64), expiresAt: new Date(at.getTime() + 20 * DAY) };
      expect(await persistence.guests.touch(id, later, rotated)).toBe(true);
      const touched = await persistence.guests.get(id, later);
      expect(touched?.lastSeenAt.getTime()).toBe(later.getTime());
      expect(touched?.tokenHash).toBe('a'.repeat(64));
      expect(touched?.expiresAt.getTime()).toBe(rotated.expiresAt.getTime());
      const afterExpiry = new Date(at.getTime() + 21 * DAY);
      expect(await persistence.guests.get(id, afterExpiry)).toBeUndefined();
      expect(await persistence.guests.touch(id, afterExpiry)).toBe(false);
      const gone = await newGuest(persistence, at);
      expect(await persistence.guests.delete(gone)).toBe(true);
      expect(await persistence.guests.delete(gone)).toBe(false);
      expect(await persistence.guests.get(gone, at)).toBeUndefined();
    });

    it('records a finished match with pseudonymous players and a capped sample of events', async () => {
      const guestId = generateGuestId();
      const events: RaceEvent[] = [
        ...Array.from({ length: 400 }, (_, i) => hitEvent(i + 1, 10 + i, 2 + (i % 30))),
        { id: 900, tick: 600, type: 'ko', car: 1, by: 0 },
        { id: 901, tick: 601, type: 'result', winner: 0, reason: 'ko' },
        {
          id: 902,
          tick: 5,
          type: 'shot',
          car: 0,
          part: 0,
          weapon: 'weapon_front_mg',
          projectile: 1,
          x: 0,
          y: 0,
          vx: 1,
          vy: 0,
        } as unknown as RaceEvent,
      ];
      const recorder = createMatchRecorder({
        repo: persistence.matches,
        pseudonymKey: 'contract-key-0123456789',
        logger: silentLogger,
      }).record;
      const matchId = `m-${randomBytes(6).toString('hex')}`;
      await recorder(summary(matchId, guestId, events));
      await recorder(summary(matchId, guestId, events)); // a repeat is ignored
      const stored = await persistence.matches.get(matchId);
      expect(stored).toBeDefined();
      const { match, events: kept } = stored!;
      expect(match.trackId).toBe('city_01');
      expect(match.seed).toBe(12345);
      expect(match.mode).toBe('friend');
      expect(match.playerKinds).toEqual(['human', 'human']);
      // Players in seat order, each a 32-hex pseudonym; no guest id, nickname or room id kept.
      for (const ref of match.playerRefs) expect(ref).toMatch(/^[0-9a-f]{32}$/);
      expect(match.playerRefs[0]).not.toBe(match.playerRefs[1]);
      expect(JSON.stringify(stored)).not.toContain(guestId);
      expect(JSON.stringify(stored)).not.toContain('room1');
      expect(match.blueprintHashes).toEqual([
        buildHash(BASELINE_BLUEPRINT),
        buildHash(ROOKIE_BLUEPRINT),
      ]);
      expect(match.result).toMatchObject({ winner: 0, reason: 'finish', seats: [0, 1] });
      expect(match.disconnectReason).toBeNull();
      expect(match.metrics).toEqual({
        round: 1,
        protocolVersion: 9,
        swapped: 0,
        raceTimeMs: 97_500,
      });
      expect(kept.length).toBe(240);
      expect(kept.map((e) => e.type)).toContain('ko');
      expect(kept.map((e) => e.type)).toContain('result');
      expect(kept.map((e) => e.type)).not.toContain('shot');
      // Small hits are not notable; kept events are in time order with compact data.
      expect(kept.every((e) => e.type !== 'hit' || Number(e.data.damage) >= 4)).toBe(true);
      expect(kept.map((e) => e.tick)).toEqual([...kept.map((e) => e.tick)].sort((a, b) => a - b));
      expect(kept.find((e) => e.type === 'hit')!.data.x).toBe(100.12);
      // The same guest in another match is another pseudonym.
      const other = `m-${randomBytes(6).toString('hex')}`;
      await recorder(summary(other, guestId));
      expect((await persistence.matches.get(other))!.match.playerRefs[0]).not.toBe(
        match.playerRefs[0],
      );
    });

    it('applies the retention policy: events at 30 days, matches at 90, deleted cars at 30', async () => {
      const recorder = createMatchRecorder({
        repo: persistence.matches,
        pseudonymKey: 'contract-key-0123456789',
        logger: silentLogger,
      }).record;
      const matchId = `m-${randomBytes(6).toString('hex')}`;
      await recorder(summary(matchId, generateGuestId(), [hitEvent(1, 1, 20)]));
      const owner = await newGuest(persistence);
      const s = service();
      const made = await s.create(owner, 'req-ret-1', namedCar('Retire Me'));
      const live = await s.create(owner, 'req-ret-2', namedCar('Keep Me Live'));
      if (!made.ok || !live.ok) throw new Error('setup failed');
      await s.deleteMine(owner, made.record.id);

      const now = new Date();
      const soon = await runRetention(persistence, new Date(now.getTime() + HOUR));
      expect(soon.matchEvents + soon.matches + soon.deletedBlueprints).toBe(0);
      expect((await persistence.matches.get(matchId))!.events).toHaveLength(1);

      const month = new Date(now.getTime() + (RETENTION.matchEventDays + 1) * DAY);
      const r30 = await runRetention(persistence, month);
      expect(r30.matchEvents).toBeGreaterThanOrEqual(1);
      expect(r30.deletedBlueprints).toBeGreaterThanOrEqual(1);
      expect((await persistence.matches.get(matchId))!.events).toHaveLength(0);
      // Sessions last 14 days from their last rotation, so the owner's has expired by now.
      expect(r30.guestSessions).toBeGreaterThanOrEqual(1);
      expect((await s.lookup(live.record.code)).ok).toBe(true);

      const quarter = new Date(now.getTime() + (RETENTION.matchDays + 1) * DAY);
      const r90 = await runRetention(persistence, quarter);
      expect(r90.matches).toBeGreaterThanOrEqual(1);
      expect(await persistence.matches.get(matchId)).toBeUndefined();
      // Live shared codes never expire, even once their owner's session has.
      expect((await s.lookup(live.record.code)).ok).toBe(true);
    });

    it('stores a daily challenge row for Milestone F', async () => {
      await persistence.daily.upsert({
        day: '2026-10-12',
        seed: 77,
        trackId: 'city_01',
        weatherPresetId: 'city_clear_night',
        referenceBot: 'racer',
        aggregate: { attempts: 0 },
      });
      expect(await persistence.daily.get('2026-10-12')).toEqual({
        day: '2026-10-12',
        seed: 77,
        trackId: 'city_01',
        weatherPresetId: 'city_clear_night',
        referenceBot: 'racer',
        aggregate: { attempts: 0 },
      });
      expect(await persistence.daily.get('2026-10-13')).toBeUndefined();
    });
  });
}
