import type {
  ControlInput,
  InputSample,
  MatchPhase,
  RaceBrain,
  RaceEvent,
  RaceResult,
  RaceSession,
  TickOutcome,
  TickInputPolicy,
} from '@bolt/shared';
import { TickInputBuffer, concedeRace, raceEventVisibleTo, stepRaceWithBrains } from '@bolt/shared';
import type { DriveState } from './schema.js';
import { writeDriveState, writeRaceState } from './schema.js';

/**
 * One race inside a room, for any mix of people and brains: the drive room's single driver
 * against the AI, and the match room's two drivers (Milestone E, docs/MULTIPLAYER.md).
 *
 * The race advances once per room tick, never once per sample. Each person's samples go through
 * their own `TickInputBuffer`, which supplies exactly one control per tick and the sequence
 * number that tick stands for, so each driver is acknowledged separately and predicts its own
 * car against its own acknowledgements. A brain drives a car the same way it always has.
 *
 * Nothing a client sends reaches the simulation except the control numbers of its own car.
 * Each driver's view (`DriveState`) is written from the authoritative race with that driver as
 * the viewer: its own car in full, the other only as it can be seen from outside, and only the
 * traps it has been shown (`hazardVisibleTo`).
 */

export type HostDriver = {
  carIndex: number;
  /** This driver's synchronized view. */
  view: DriveState;
  /** Called with every event this driver may see, in order. */
  deliver: (event: RaceEvent) => void;
  /**
   * What drives the car while its driver is gone (disconnected, or silent past the buffer's
   * stale limit). Null: neutral input. Its fire and utility buttons are never pressed.
   */
  autopilot?: RaceBrain | null;
};

export class HostSeat {
  readonly input: TickInputBuffer;
  connected = true;
  /** Ticks in a row this car has been driven by the room rather than its driver. */
  absentTicks = 0;
  lastOutcome: TickOutcome = 'idle';
  readonly control: ControlInput = { steer: 0, brake: 0, coast: true, fire: 0, use: 0, target: 0 };

  constructor(
    readonly carIndex: number,
    readonly view: DriveState,
    readonly deliver: (event: RaceEvent) => void,
    readonly autopilot: RaceBrain | null,
    policy: Partial<TickInputPolicy>,
  ) {
    this.input = new TickInputBuffer(policy);
  }

  /** True while the room, not the driver, is choosing this car's controls. */
  get absent(): boolean {
    return !this.connected || this.lastOutcome === 'absent';
  }
}

export type RaceHostOptions = {
  race: RaceSession;
  raceId: number;
  /** One per car: the AI for a car no person drives, otherwise null. */
  brains: ReadonlyArray<RaceBrain | null>;
  drivers: readonly HostDriver[];
  policy?: Partial<TickInputPolicy>;
  /**
   * The blueprint JSON each driver is shown for the other car. The match room passes the
   * public form (no typed name); by default the race's canonical JSON.
   */
  publicBlueprints?: readonly string[];
  /** Rewrites a driver's control before the step (the scripted scenario rooms). */
  transform?: (carIndex: number, control: ControlInput) => ControlInput;
};

export class RaceHost {
  readonly race: RaceSession;
  readonly raceId: number;
  /**
   * True while nothing moves: the race waits on the grid and the clients are told to hold
   * their prediction clocks (the match room while both players load).
   */
  held = false;
  /** True until every driver has sent samples: the race waits, clients keep predicting. */
  awaitingDrivers = false;
  private readonly brains: Array<RaceBrain | null>;
  private readonly seatByCar: Array<HostSeat | null>;
  readonly seats: HostSeat[];
  private readonly controls: Array<ControlInput | undefined>;
  private readonly publicBlueprints: readonly string[] | undefined;
  private readonly transform: RaceHostOptions['transform'];
  private lastPhase: MatchPhase;

  constructor(options: RaceHostOptions) {
    this.race = options.race;
    this.raceId = options.raceId;
    this.brains = options.race.cars.map((_, i) => options.brains[i] ?? null);
    this.seatByCar = options.race.cars.map(() => null);
    this.seats = options.drivers.map((driver) => {
      const seat = new HostSeat(
        driver.carIndex,
        driver.view,
        driver.deliver,
        driver.autopilot ?? null,
        options.policy ?? {},
      );
      this.seatByCar[driver.carIndex] = seat;
      // A person drives this car, whatever brain the race came with.
      this.brains[driver.carIndex] = null;
      return seat;
    });
    this.controls = options.race.cars.map(() => undefined);
    this.publicBlueprints = options.publicBlueprints;
    this.transform = options.transform;
    this.lastPhase = options.race.phase;
  }

  seat(carIndex: number): HostSeat | null {
    return this.seatByCar[carIndex] ?? null;
  }

  /**
   * Queues a driver's samples. Packets for another race are dropped, as are samples sent while
   * the race is held (a client does not run its clock then, so these predate the hold).
   */
  accept(carIndex: number, race: number | undefined, samples: readonly InputSample[]): boolean {
    const seat = this.seat(carIndex);
    if (!seat || (race !== undefined && race !== this.raceId) || this.held) return false;
    seat.input.accept(samples);
    return true;
  }

  /** The driver's page went away (Section 5.10): neutral until its samples come back. */
  markAway(carIndex: number): void {
    this.seat(carIndex)?.input.markAway();
  }

  /** One room tick. Returns the race phase after it, and whether it changed. */
  step(): { phase: MatchPhase; changed: boolean } {
    if (this.held || this.awaitingDrivers) {
      if (
        this.awaitingDrivers &&
        this.seats.every((s) => s.input.queued >= s.input.policy.initialDelay)
      )
        this.awaitingDrivers = false;
      else {
        this.writeViews();
        return { phase: this.race.phase, changed: false };
      }
    }
    const race = this.race;
    const racing = race.phase === 'RACING';
    for (const seat of this.seats) {
      const outcome = seat.input.step(seat.control);
      seat.lastOutcome = outcome === 'idle' && racing ? 'absent' : outcome;
      let control: ControlInput = seat.control;
      if (seat.absent) {
        seat.absentTicks += 1;
        if (seat.autopilot) {
          const driven = seat.autopilot.control(race, seat.carIndex);
          seat.control.steer = driven.steer;
          seat.control.brake = driven.brake;
          seat.control.coast = driven.coast;
          seat.control.fire = 0;
          seat.control.use = 0;
          seat.control.target = 0;
        } else neutralInto(seat.control);
        control = seat.control;
      } else seat.absentTicks = 0;
      if (this.transform) control = this.transform(seat.carIndex, control);
      this.controls[seat.carIndex] = control;
    }
    stepRaceWithBrains(race, this.controls, this.brains);
    this.dispatch(0);
    this.writeViews();
    const changed = race.phase !== this.lastPhase;
    this.lastPhase = race.phase;
    return { phase: race.phase, changed };
  }

  /**
   * Ends the race as a forfeit by `carIndex` (Section 3.3). Its events go out like any tick's.
   * Returns the result, or null when the race had already ended.
   */
  concede(carIndex: number, cause: 'left' | 'disconnected'): RaceResult | null {
    const from = this.race.events.length;
    const result = concedeRace(this.race, carIndex, cause);
    if (!result) return null;
    this.dispatch(from);
    this.writeViews();
    this.lastPhase = this.race.phase;
    return result;
  }

  private dispatch(from: number): void {
    const events = this.race.events;
    for (const seat of this.seats)
      for (let i = from; i < events.length; i++) {
        const event = events[i]!;
        if (raceEventVisibleTo(this.race, event, seat.carIndex)) seat.deliver(event);
      }
  }

  /** Writes every driver's view from the authoritative race. */
  writeViews(): void {
    for (const seat of this.seats) {
      const view = seat.view;
      const car = this.race.cars[seat.carIndex]!;
      writeDriveState(view, car.session, seat.input.ackSequence);
      const other = this.race.cars.length > 1 ? (seat.carIndex === 0 ? 1 : 0) : seat.carIndex;
      writeRaceState(view, this.race, seat.carIndex, this.publicBlueprints?.[other]);
      view.you = seat.carIndex;
      view.raceId = this.raceId;
      view.held = this.held;
      const net = view.net;
      const input = seat.input;
      net.delay = Math.min(255, input.delayTicks);
      net.depth = Math.min(255, input.depth);
      net.missing = Math.min(0xffff, input.stats.missing);
      net.late = Math.min(0xffff, input.stats.late);
      net.grown = Math.min(255, input.stats.grown);
      net.shrunk = Math.min(255, input.stats.shrunk);
      net.reanchors = Math.min(255, input.stats.reanchors);
      net.absent = seat.absent && this.race.phase === 'RACING';
    }
  }
}

function neutralInto(out: ControlInput): void {
  out.steer = 0;
  out.brake = 0;
  out.coast = true;
  out.fire = 0;
  out.use = 0;
  out.target = 0;
}
