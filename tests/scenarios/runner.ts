import type { ScenarioRace } from '@bolt/content';
import { CITY_01, SCENARIOS, createScenarioRace, getScenario, getTrack } from '@bolt/content';
import type { RaceEvent, ScenarioDefinition, TrackRuntime } from '@bolt/shared';
import { SIM_DT, buildTrack, stepRaceWithBrains } from '@bolt/shared';

/**
 * Runs showcase scenarios headless. The same definitions run in the client
 * (`?debug=1&scenario=<id>`) and in a real server room; this is the reference timeline.
 */

const tracks = new Map<string, TrackRuntime>();

export function scenarioTrack(def: ScenarioDefinition): TrackRuntime {
  let track = tracks.get(def.trackId);
  if (!track) {
    track = buildTrack(getTrack(def.trackId) ?? CITY_01);
    tracks.set(def.trackId, track);
  }
  return track;
}

export type ScenarioRun = {
  def: ScenarioDefinition;
  setup: ScenarioRace;
  /** Every event the scenario produced, in order. */
  events: RaceEvent[];
  /** Expectations of the definition that no event satisfied. */
  missing: ScenarioDefinition['expect'];
  /** Tick GO fell on, so event ticks can be read as race ticks. */
  goTick: number;
};

function satisfies(event: RaceEvent, want: ScenarioDefinition['expect'][number]): boolean {
  if (event.type !== want.type) return false;
  const fields = event as unknown as { weapon?: string; car?: number };
  if (want.weapon !== undefined && fields.weapon !== want.weapon) return false;
  if (want.car !== undefined && fields.car !== want.car) return false;
  return true;
}

export function runScenario(def: ScenarioDefinition): ScenarioRun {
  const setup = createScenarioRace(def, scenarioTrack(def));
  if (!setup) throw new Error(`scenario ${def.id} does not resolve`);
  const { race, brains } = setup;
  const events: RaceEvent[] = [];
  let goTick = 0;
  const limit = def.countdownTicks + def.durationTicks + 5;
  for (let i = 0; i < limit && race.raceTicks < def.durationTicks; i++) {
    stepRaceWithBrains(race, [], brains);
    if (goTick === 0 && race.phase === 'RACING') goTick = race.tick;
    for (const event of race.events) events.push(event);
  }
  const missing = def.expect.filter((want) => !events.some((event) => satisfies(event, want)));
  return { def, setup, events, missing, goTick };
}

export function runScenarioById(id: string): ScenarioRun {
  const def = getScenario(id);
  if (!def) throw new Error(`no scenario named ${id}`);
  return runScenario(def);
}

/** One line per event: race time, type and the fields that matter. */
export function formatEvent(event: RaceEvent, goTick: number): string {
  const { id, tick, type, ...rest } = event as RaceEvent & Record<string, unknown>;
  const t = ((tick - goTick) * SIM_DT).toFixed(2).padStart(6);
  const fields = Object.entries(rest)
    .map(([key, value]) =>
      typeof value === 'number' && !Number.isInteger(value)
        ? `${key}=${value.toFixed(1)}`
        : `${key}=${String(value)}`,
    )
    .join(' ');
  return `${t}s  #${String(id).padStart(3)} t${tick - goTick} ${type.padEnd(10)} ${fields}`;
}

export { SCENARIOS };
