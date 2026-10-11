import type {
  CarSnapshot,
  InputSample,
  RaceBrain,
  RaceEvent,
  RaceSession,
  RaceSnapshot,
  ScenarioDefinition,
} from '@bolt/shared';
import {
  applyScenario,
  carSnapshot,
  eventVisibleTo,
  raceSnapshot,
  resetRace,
  stepRaceWithBrains,
} from '@bolt/shared';
import type { DriveLink, LinkStatus } from './link.js';

/** Index of the local driver's car on the grid, as on the server. */
const PLAYER_CAR = 0;

/**
 * In-page authority for the offline drive. It advances the shared race by one tick per input
 * sample, exactly like the server room, with the same sparring rival from the same seed, and
 * reports the same snapshots and race events. It is a development aid, clearly badged in the
 * HUD; real races always use the server.
 *
 * Given a scenario it starts from the scenario's positions and the other car follows the
 * scenario's script. The local car is still driven by the samples it is sent, which the race
 * view takes from the same script.
 */
export class OfflineLink implements DriveLink {
  readonly mode = 'offline' as const;
  readonly latencyMs = 0;
  onSnapshot: ((snapshot: CarSnapshot) => void) | null = null;
  onRace: ((race: RaceSnapshot) => void) | null = null;
  onEvent: ((event: RaceEvent) => void) | null = null;
  onStatus: ((status: LinkStatus) => void) | null = null;
  private ack = -1;
  private readonly controls: Array<InputSample | undefined> = [];

  constructor(
    private readonly race: RaceSession,
    /** One entry per car; the local car's entry is ignored. */
    private readonly brains: ReadonlyArray<RaceBrain | null>,
    private readonly scenario: ScenarioDefinition | null = null,
  ) {}

  sendInputs(samples: InputSample[]): void {
    const race = this.race;
    for (const sample of samples) {
      if (sample.sequence <= this.ack) continue;
      this.ack = sample.sequence;
      this.controls[PLAYER_CAR] = sample;
      stepRaceWithBrains(race, this.controls, this.playerDriven());
      for (const event of race.events) if (eventVisibleTo(event, PLAYER_CAR)) this.onEvent?.(event);
    }
    this.publish();
  }

  resetCar(): void {
    resetRace(this.race);
    for (const brain of this.brains) brain?.reset();
    if (this.scenario) applyScenario(this.race, this.scenario);
    this.publish();
  }

  leave(): void {
    this.onSnapshot = null;
    this.onRace = null;
    this.onEvent = null;
    this.onStatus = null;
  }

  /** The brains with the local car's slot emptied: its control comes from the samples. */
  private driven: Array<RaceBrain | null> | null = null;
  private playerDriven(): ReadonlyArray<RaceBrain | null> {
    if (!this.driven)
      this.driven = this.brains.map((brain, index) => (index === PLAYER_CAR ? null : brain));
    return this.driven;
  }

  private publish(): void {
    const car = carSnapshot(this.race, PLAYER_CAR, this.ack);
    this.onSnapshot?.(car);
    if (this.onRace) {
      const race = raceSnapshot(this.race, PLAYER_CAR, this.ack);
      race.car = car;
      this.onRace(race);
    }
  }
}
