import { getTemplate } from '@bolt/content';
import { SIM_HZ, SNAPSHOT_HZ, stepRaceWithBrains } from '@bolt/shared';
import { describe, expect, it } from 'vitest';
import { MatchState, SeatState, StateView } from '../../apps/server/src/rooms/matchSchema.js';
import {
  DriveState,
  StateEncoder,
  writeDriveState,
  writeRaceState,
} from '../../apps/server/src/rooms/schema.js';
import { createBotMatch } from '../balance/harness.js';

/**
 * What a Race a Friend patch costs (Section 15.4). The match room keeps both players' race
 * views in one state and gives each client a `StateView` holding only its own, so a client is
 * sent the shared lobby fields plus one view: the same bytes as the solo room's state, not
 * twice them. Encoded here exactly as Colyseus encodes it for each client.
 */

const STEPS_PER_SNAPSHOT = SIM_HZ / SNAPSHOT_HZ;

describe('match room state on the wire', () => {
  it('each client is sent one view, at about the cost of a solo race', () => {
    const { race, brains } = createBotMatch(
      getTemplate('starter_tinker')!,
      getTemplate('starter_packhorse')!,
      41,
    );
    const solo = new DriveState();
    const soloEncoder = new StateEncoder(solo);
    const root = new MatchState();
    for (const key of ['0', '1']) {
      root.seats.set(key, new SeatState());
      root.views.set(key, new DriveState());
    }
    const encoder = new StateEncoder(root);
    const views = [new StateView(), new StateView()];
    views[0]!.add(root.views.get('0')!);
    views[1]!.add(root.views.get('1')!);
    const write = () => {
      writeDriveState(solo, race.cars[0]!.session, race.tick);
      writeRaceState(solo, race, 0);
      for (const seat of [0, 1]) {
        const view = root.views.get(String(seat))!;
        writeDriveState(view, race.cars[seat]!.session, race.tick);
        writeRaceState(view, race, seat);
      }
    };
    write();
    soloEncoder.encodeAll();
    soloEncoder.discardChanges();
    const buffer = Buffer.alloc(65_536);
    const shared = { offset: 1 };
    encoder.encodeAll(shared, buffer);
    const fullShared = shared.offset;
    const fullView = views.map(
      (v) => encoder.encodeAllView(v, fullShared, { ...shared }, buffer).byteLength,
    );
    encoder.discardChanges();

    let soloBytes = 0;
    const viewBytes = [0, 0];
    let patches = 0;
    const over = () => race.phase === 'FINISHED';
    while (!over() && patches < 900) {
      for (let i = 0; i < STEPS_PER_SNAPSHOT && !over(); i++) {
        stepRaceWithBrains(race, [], brains);
        write();
      }
      soloBytes += soloEncoder.encode().byteLength;
      soloEncoder.discardChanges();
      const it = { offset: 1 };
      encoder.encode(it);
      const sharedEnd = it.offset;
      for (const seat of [0, 1])
        viewBytes[seat]! += encoder.encodeView(views[seat]!, sharedEnd, it).byteLength;
      encoder.discardChanges();
      patches += 1;
    }
    const soloMean = soloBytes / patches;
    const viewMean = viewBytes.map((b) => b / patches);
    console.info(`NETREPORT encoding ${JSON.stringify({ patches, soloMean, viewMean, fullView })}`);
    expect(patches).toBeGreaterThan(300);
    for (const mean of viewMean) {
      // A view patch is the solo patch plus the few bytes of the map path to it.
      expect(mean).toBeLessThan(soloMean + 24);
      expect(mean * SNAPSHOT_HZ).toBeLessThan(6_000);
    }
  });
});
