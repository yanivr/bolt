import type { RaceSession } from './combat/types.js';
import type { RaceEvent } from './protocol.js';
import { eventVisibleTo } from './race.js';

/**
 * What one driver may learn about the race, on top of `eventVisibleTo` (Sections 7.5 and 19.6).
 * A trap the other driver laid is hidden until the simulation reveals it to this driver
 * (`revealMask`): its position is not in this driver's snapshot and its quiet events (placed,
 * armed, worn off) are not sent. What anyone on the road would see happen to it (set off,
 * swept, set alight, melted) is sent. The same rule applies to a human rival and to the AI.
 */

export function hazardVisibleTo(
  hazard: { owner: number; revealMask: number },
  viewer: number,
): boolean {
  return hazard.owner === viewer || ((hazard.revealMask >> viewer) & 1) === 1;
}

const QUIET_HAZARD_STATES = new Set(['placed', 'armed', 'expired']);

export function raceEventVisibleTo(race: RaceSession, event: RaceEvent, viewer: number): boolean {
  if (!eventVisibleTo(event, viewer)) return false;
  if (event.type !== 'hazard' || !QUIET_HAZARD_STATES.has(event.state)) return true;
  if (event.by === viewer) return true;
  const hazard = race.hazards.find((h) => h.id === event.hazard);
  // Gone already (it expired this tick): visible only if it had been revealed, which the
  // snapshot then showed, so the viewer knows it; otherwise there is nothing to tell.
  return hazard ? hazardVisibleTo(hazard, viewer) : false;
}
