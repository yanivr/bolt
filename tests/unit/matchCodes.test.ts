import { getTemplate } from '@bolt/content';
import type { RaceEvent, RaceSession } from '@bolt/shared';
import {
  MATCH_CODE_ALPHABET,
  MATCH_CODE_LENGTH,
  NICKNAMES,
  PUBLIC_RIVAL_CAR_NAME,
  formatMatchCode,
  generateMatchCode,
  hazardVisibleTo,
  isMatchCode,
  MATCH_GRACE_MS,
  latencyQuality,
  matchCodeIssue,
  matchGraceMs,
  mulberry32,
  normalizeMatchCode,
  profileSchema,
  publicBlueprint,
  raceEventVisibleTo,
} from '@bolt/shared';
import { describe, expect, it } from 'vitest';
import { MatchCodeRegistry } from '../../apps/server/src/rooms/matchCodes.js';
import { DEFAULT_MATCH_TIMING } from '../../apps/server/src/rooms/matchMachine.js';

describe('match codes', () => {
  it('use six symbols with none of the look-alikes', () => {
    expect(MATCH_CODE_LENGTH).toBe(6);
    for (const ch of '01OIUL') expect(MATCH_CODE_ALPHABET).not.toContain(ch);
    expect(new Set(MATCH_CODE_ALPHABET).size).toBe(MATCH_CODE_ALPHABET.length);
    const rng = mulberry32(5);
    const random = (n: number) => Math.floor(rng() * n);
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const code = generateMatchCode(random);
      expect(isMatchCode(code)).toBe(true);
      seen.add(code);
    }
    // 30^6 codes: two thousand draws practically never collide.
    expect(seen.size).toBeGreaterThan(1995);
  });

  it('forgive what people type and paste', () => {
    expect(normalizeMatchCode(' k7m-q2x ')).toBe('K7MQ2X');
    expect(normalizeMatchCode('K7M Q2X')).toBe('K7MQ2X');
    expect(normalizeMatchCode('k7m.q2x')).toBe('K7MQ2X');
    expect(normalizeMatchCode('https://bolt.example/join/K7MQ2X')).toBe('K7MQ2X');
    expect(normalizeMatchCode('Race me! https://bolt.example/join/k7m-q2x?x=1')).toBe('K7MQ2X');
    expect(isMatchCode(normalizeMatchCode('k7m-q2x'))).toBe(true);
  });

  it('say why a typed code cannot be one', () => {
    expect(matchCodeIssue('K7M')).toBe('short');
    expect(matchCodeIssue('K7MQ2XZ')).toBe('long');
    expect(matchCodeIssue('K7M0Q2')).toBe('symbol');
    expect(matchCodeIssue('K7MOQ2')).toBe('symbol');
    expect(matchCodeIssue('K7MQ2X')).toBeNull();
    expect(isMatchCode('K7MQ2')).toBe(false);
    expect(isMatchCode('K7MQ2I')).toBe(false);
  });

  it('print with a dash in the middle', () => {
    expect(formatMatchCode('K7MQ2X')).toBe('K7M-Q2X');
    expect(formatMatchCode('K7M')).toBe('K7M');
  });

  it('are unique per open room and freed with it', () => {
    // A source that keeps drawing the same code first, to force a collision.
    let calls = 0;
    const random = (n: number) => (calls++ < 12 ? 0 : (calls * 7) % n);
    const registry = new MatchCodeRegistry(random);
    const a = registry.issue('room-a');
    const b = registry.issue('room-b');
    expect(a).not.toBe(b);
    expect(registry.issue('room-a')).toBe(a);
    expect(registry.lookup(a)).toBe('room-a');
    expect(registry.codeOf('room-b')).toBe(b);
    registry.release('room-a');
    expect(registry.lookup(a)).toBeUndefined();
    expect(registry.size).toBe(1);
  });
});

describe('what one player learns about the other', () => {
  it('names are preset nicknames only; nothing typed crosses', () => {
    expect(profileSchema.safeParse({ nickname: 0, emblem: 0 }).success).toBe(true);
    expect(profileSchema.safeParse({ nickname: NICKNAMES.length, emblem: 0 }).success).toBe(false);
    expect(profileSchema.safeParse({ nickname: 'Sam', emblem: 0 }).success).toBe(false);
    expect(profileSchema.safeParse({ nickname: 0, emblem: 0, name: 'Sam' }).success).toBe(false);
    for (const name of NICKNAMES) expect(name).toMatch(/^[A-Z][a-z]+$/);
  });

  it("the rival's car is published without its name or creation time", () => {
    const own = {
      ...getTemplate('starter_tinker')!.blueprint,
      name: 'Sams Car',
      createdAt: '2026-10-12T08:30:00Z',
    };
    const pub = publicBlueprint(own);
    expect(pub.name).toBe(PUBLIC_RIVAL_CAR_NAME);
    expect(pub.createdAt).not.toBe(own.createdAt);
    expect(pub.parts).toEqual(own.parts);
    expect(pub.chassisId).toBe(own.chassisId);
  });

  it('a trap is hidden from the other driver until it is revealed to them', () => {
    expect(hazardVisibleTo({ owner: 0, revealMask: 0 }, 0)).toBe(true);
    expect(hazardVisibleTo({ owner: 0, revealMask: 0 }, 1)).toBe(false);
    expect(hazardVisibleTo({ owner: 0, revealMask: 0b10 }, 1)).toBe(true);
    expect(hazardVisibleTo({ owner: 0, revealMask: 0b01 }, 1)).toBe(false);
  });

  it('the quiet events of a hidden trap are not sent; what anyone would see is', () => {
    const race = { hazards: [{ id: 7, owner: 0, revealMask: 0 }] } as unknown as RaceSession;
    const event = (state: string): RaceEvent =>
      ({
        id: 1,
        tick: 1,
        type: 'hazard',
        hazard: 7,
        kind: 'mine',
        by: 0,
        state,
        x: 0,
        y: 0,
        car: -1,
      }) as unknown as RaceEvent;
    for (const state of ['placed', 'armed', 'expired']) {
      expect(raceEventVisibleTo(race, event(state), 0)).toBe(true);
      expect(raceEventVisibleTo(race, event(state), 1)).toBe(false);
    }
    for (const state of ['triggered', 'cleared', 'ignited', 'melted'])
      expect(raceEventVisibleTo(race, event(state), 1)).toBe(true);
    (race.hazards[0] as { revealMask: number }).revealMask = 0b10;
    expect(raceEventVisibleTo(race, event('armed'), 1)).toBe(true);
    // Gone already and never revealed: nothing to tell.
    const gone = { hazards: [] } as unknown as RaceSession;
    expect(raceEventVisibleTo(gone, event('expired'), 1)).toBe(false);
    // Another driver's refusals and warnings are theirs alone.
    const refused = {
      id: 2,
      tick: 1,
      type: 'refused',
      car: 0,
      part: 0,
      reason: 'heat',
    } as unknown as RaceEvent;
    expect(raceEventVisibleTo(race, refused, 0)).toBe(true);
    expect(raceEventVisibleTo(race, refused, 1)).toBe(false);
  });

  it('connection quality has three plain levels', () => {
    expect(latencyQuality(60)).toBe('good');
    expect(latencyQuality(180)).toBe('fair');
    expect(latencyQuality(400)).toBe('poor');
    expect(latencyQuality(0)).toBe('unknown');
  });

  it('the seat grace the client counts down is the one the room keeps, by phase', () => {
    expect(DEFAULT_MATCH_TIMING.lobbyGraceMs).toBe(matchGraceMs('WAITING_FOR_OPPONENT'));
    expect(DEFAULT_MATCH_TIMING.lobbyGraceMs).toBe(matchGraceMs('TRACK_REVEAL'));
    expect(DEFAULT_MATCH_TIMING.buildGraceMs).toBe(matchGraceMs('BUILDING'));
    for (const phase of ['VS_REVEAL', 'COUNTDOWN', 'RACING'])
      expect(DEFAULT_MATCH_TIMING.raceGraceMs).toBe(matchGraceMs(phase));
    for (const phase of ['FINISHED', 'RESULTS', 'REMATCH_VOTE'])
      expect(DEFAULT_MATCH_TIMING.resultsGraceMs).toBe(matchGraceMs(phase));
    // Section 3.3: 15 seconds under the autopilot in a race, 20 to rejoin a build.
    expect(MATCH_GRACE_MS.race).toBe(15_000);
    expect(MATCH_GRACE_MS.build).toBe(20_000);
  });
});
