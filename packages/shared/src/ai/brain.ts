import type { RaceSession } from '../combat/types.js';
import type { ControlInput } from '../physics.js';
import { stepRace } from '../race.js';

/**
 * What drives a car that no person is driving. A brain sees the race and returns the same
 * control sample a human sends: steering, brake, fire buttons, utility buttons, repair target.
 * It has no other way to act on the world, so a bot cannot do anything a player cannot
 * (Section 3.1: same physics, same cooldowns, no hidden stats).
 *
 * Milestone D replaces the sparring brain with the full AI by implementing this interface.
 */
export interface RaceBrain {
  /** Control for car `index` for the tick about to be simulated. May reuse one record. */
  control(race: RaceSession, index: number): ControlInput;
  /** Called when the race is put back on the grid. */
  reset(): void;
}

/**
 * Steps a race in which some cars are driven by brains. `human[i]` is used for car `i` when it
 * has no brain. The server room and the offline link both call this, so a rival behaves
 * identically in both.
 */
export function stepRaceWithBrains(
  race: RaceSession,
  human: ReadonlyArray<ControlInput | undefined>,
  brains: ReadonlyArray<RaceBrain | null | undefined>,
): void {
  const controls = race.controls;
  for (let i = 0; i < race.cars.length; i++) {
    const brain = brains[i];
    const source = brain ? brain.control(race, i) : human[i];
    const out = controls[i]!;
    if (source) {
      out.steer = source.steer;
      out.brake = source.brake;
      out.coast = source.coast;
      out.fire = source.fire ?? 0;
      out.use = source.use ?? 0;
      out.target = source.target ?? 0;
    } else {
      out.steer = 0;
      out.brake = 0;
      out.coast = true;
      out.fire = 0;
      out.use = 0;
      out.target = 0;
    }
  }
  stepRace(race, controls);
}
