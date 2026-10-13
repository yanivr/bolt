import type { RaceEvent, RaceResult } from '@bolt/shared';

/**
 * The race as the results screen tells it, added up from the event stream (docs/COMBAT_API.md,
 * "Events"). Every number shown after a race comes from here or from the server's own
 * `RaceResult`; nothing is estimated. The two definitions of damage are the simulation's:
 *
 * - damage taken is what came off a component and the chassis (`damage + chassis`);
 * - damage dealt also counts what the other car's shield, armor and absorbers soaked up
 *   (`+ shield + armor + absorbed`), which is how `RaceResult.damageDealt` is counted.
 */

export type WeaponTally = {
  /** Catalog id of the weapon, a tire kit id for blades, or `ram`. */
  weapon: string;
  /** Everything the hits were worth, including what was blocked. */
  damage: number;
  /** The share of it that shields, armor and absorbers stopped. */
  blocked: number;
  hits: number;
};

export type HitRecord = { weapon: string; damage: number; component: number };

export type ComponentTally = {
  /** Component index on the struck car, or -1 for bare bodywork. */
  component: number;
  damage: number;
  hits: number;
};

export type SideSummary = {
  total: number;
  blocked: number;
  hits: number;
  byWeapon: WeaponTally[];
  byComponent: ComponentTally[];
  biggest: HitRecord | null;
};

export type RepairRecord = { utility: string; component: number };

export type ResultsSummary = {
  /** What the local car did to the other. */
  dealt: SideSummary;
  /** What was done to the local car, by anything: the rival, a wall of fire, its own mine. */
  taken: SideSummary;
  /** Components of the local car that were destroyed, in order, and whether one was repaired since. */
  partsLost: Array<{ component: number; repaired: boolean }>;
  /** Components of the other car that were destroyed. */
  rivalPartsLost: number[];
  repairs: RepairRecord[];
  /** Lap times, in order, per car index. */
  laps: number[][];
  /** Activations of the local car's weapons (a burst or a spread counts once). */
  shots: number;
  /** Shots per mounted part of the local car, by part index. */
  shotsByPart: number[];
  /** Seconds the local car spent at or above the heat that costs it engine output. */
  hotSeconds: number;
  /** What the other car did to the local one: counted as the server counts damage dealt. */
  rivalDealt: number;
  rivalHits: number;
  /** Car that was knocked out, or -1. */
  ko: number;
  events: number;
};

function emptySide(): SideSummary {
  return { total: 0, blocked: 0, hits: 0, byWeapon: [], byComponent: [], biggest: null };
}

class SideTally {
  total = 0;
  blocked = 0;
  hits = 0;
  private readonly weapons = new Map<string, WeaponTally>();
  private readonly components = new Map<number, ComponentTally>();
  biggest: HitRecord | null = null;

  add(weapon: string, landed: number, blocked: number, component: number, counted: number): void {
    this.total += counted;
    this.blocked += blocked;
    this.hits++;
    let w = this.weapons.get(weapon);
    if (!w) this.weapons.set(weapon, (w = { weapon, damage: 0, blocked: 0, hits: 0 }));
    w.damage += counted;
    w.blocked += blocked;
    w.hits++;
    let c = this.components.get(component);
    if (!c) this.components.set(component, (c = { component, damage: 0, hits: 0 }));
    c.damage += landed;
    c.hits++;
    if (!this.biggest || counted > this.biggest.damage)
      this.biggest = { weapon, damage: counted, component };
  }

  summary(): SideSummary {
    if (this.hits === 0) return emptySide();
    return {
      total: this.total,
      blocked: this.blocked,
      hits: this.hits,
      byWeapon: [...this.weapons.values()]
        .map((w) => ({ ...w }))
        .sort((a, b) => b.damage - a.damage || a.weapon.localeCompare(b.weapon)),
      byComponent: [...this.components.values()]
        .map((c) => ({ ...c }))
        .sort((a, b) => b.damage - a.damage || a.component - b.component),
      biggest: this.biggest ? { ...this.biggest } : null,
    };
  }
}

/** Adds up one race for one driver. Feed it every event once, in order. */
export class RaceLog {
  private dealt = new SideTally();
  private taken = new SideTally();
  private partsLost: Array<{ component: number; repaired: boolean }> = [];
  private rivalPartsLost: number[] = [];
  private repairs: RepairRecord[] = [];
  private laps: number[][] = [];
  private shots = 0;
  private shotsByPart: number[] = [];
  private hotSeconds = 0;
  private rivalDealt = 0;
  private rivalHits = 0;
  private ko = -1;
  private count = 0;
  /** The raw events, kept for the debug hook the end-to-end tests read. */
  readonly events: RaceEvent[] = [];

  constructor(private you = 0) {}

  reset(you = this.you): void {
    this.you = you;
    this.dealt = new SideTally();
    this.taken = new SideTally();
    this.partsLost = [];
    this.rivalPartsLost = [];
    this.repairs = [];
    this.laps = [];
    this.shots = 0;
    this.shotsByPart = [];
    this.hotSeconds = 0;
    this.rivalDealt = 0;
    this.rivalHits = 0;
    this.ko = -1;
    this.count = 0;
    this.events.length = 0;
  }

  /** Time at or above the heat that costs output: `seconds` since the last snapshot. */
  addHeat(seconds: number): void {
    if (seconds > 0) this.hotSeconds += seconds;
  }

  add(event: RaceEvent): void {
    const you = this.you;
    this.count++;
    this.events.push(event);
    switch (event.type) {
      case 'hit': {
        const landed = event.damage + event.chassis;
        const blocked = event.shield + event.armor + event.absorbed;
        if (event.car === you) {
          this.taken.add(event.weapon, landed, blocked, event.component, landed);
          if (event.by >= 0 && event.by !== you) {
            this.rivalDealt += landed + blocked;
            this.rivalHits++;
          }
        } else if (event.by === you)
          this.dealt.add(event.weapon, landed, blocked, event.component, landed + blocked);
        break;
      }
      case 'component':
        if (event.condition === 'disabled' && !event.repaired) {
          if (event.car === you)
            this.partsLost.push({ component: event.component, repaired: false });
          else if (!this.rivalPartsLost.includes(event.component))
            this.rivalPartsLost.push(event.component);
        } else if (event.repaired && event.car === you) {
          for (const lost of this.partsLost)
            if (lost.component === event.component) lost.repaired = true;
        }
        break;
      case 'utility':
        if (
          event.car === you &&
          event.state === 'done' &&
          (event.utility === 'utility_repair' || event.utility === 'utility_spare')
        )
          this.repairs.push({ utility: event.utility, component: event.value });
        break;
      case 'lap':
        (this.laps[event.car] ??= []).push(event.lapTimeMs);
        break;
      case 'shot':
        if (event.car === you && event.n === 0) {
          this.shots++;
          this.shotsByPart[event.part] = (this.shotsByPart[event.part] ?? 0) + 1;
        }
        break;
      case 'ko':
        this.ko = event.car;
        break;
      default:
        break;
    }
  }

  summary(): ResultsSummary {
    return {
      dealt: this.dealt.summary(),
      taken: this.taken.summary(),
      partsLost: this.partsLost.map((p) => ({ ...p })),
      rivalPartsLost: [...this.rivalPartsLost],
      repairs: this.repairs.map((r) => ({ ...r })),
      laps: this.laps.map((l) => [...(l ?? [])]),
      shots: this.shots,
      shotsByPart: [...this.shotsByPart],
      hotSeconds: this.hotSeconds,
      rivalDealt: this.rivalDealt,
      rivalHits: this.rivalHits,
      ko: this.ko,
      events: this.count,
    };
  }
}

// --- The verdict -----------------------------------------------------------------------------------

export type Outcome = 'victory' | 'defeat' | 'draw';

/** Which line explains the verdict (Section 3.4 and the Wreck and DNF rules of COMBAT_API). */
export type OutcomeReason =
  | 'margin'
  | 'rival_dnf'
  | 'you_dnf'
  | 'rival_ko'
  | 'you_ko'
  | 'timeout'
  | 'draw'
  /** Race a Friend (Section 3.3): a driver left, or was gone past the reconnect window. */
  | 'rival_forfeit'
  | 'you_forfeit';

export type Verdict = {
  outcome: Outcome;
  reason: OutcomeReason;
  /** Seconds between the two finishing times, when both cars finished. */
  marginSeconds: number | null;
  /** For a forfeit: whether the driver left on purpose or the connection was gone too long. */
  forfeitCause?: 'left' | 'disconnected';
};

/** Reads the server's result for one driver. The winner is never worked out here. */
export function verdictFor(result: RaceResult, you: number): Verdict {
  const mine = result.cars[you];
  const other = result.cars.find((_, index) => index !== you);
  const outcome: Outcome =
    result.winner === -1 ? 'draw' : result.winner === you ? 'victory' : 'defeat';
  let marginSeconds: number | null = null;
  if (mine && other && mine.finishTimeMs !== null && other.finishTimeMs !== null)
    marginSeconds = Math.abs(mine.finishTimeMs - other.finishTimeMs) / 1000;
  let reason: OutcomeReason;
  if (result.reason === 'forfeit')
    return {
      outcome,
      reason: result.forfeit?.car === you ? 'you_forfeit' : 'rival_forfeit',
      marginSeconds: null,
      forfeitCause: result.forfeit?.cause ?? 'disconnected',
    };
  if (result.reason === 'ko') reason = mine?.ko ? 'you_ko' : 'rival_ko';
  else if (outcome === 'draw') reason = 'draw';
  else if (marginSeconds !== null) reason = 'margin';
  else if (result.reason === 'timeout') reason = 'timeout';
  else if (mine && !mine.finished && other?.finished) reason = 'you_dnf';
  else if (mine?.finished && other && !other.finished) reason = 'rival_dnf';
  else reason = 'timeout';
  return { outcome, reason, marginSeconds };
}

// --- High-signal facts (Section 18.2) --------------------------------------------------------------

export type ResultFact =
  | { kind: 'biggestHit'; weapon: string; damage: number }
  | { kind: 'bestWeapon'; weapon: string; damage: number }
  | { kind: 'worstTaken'; weapon: string; damage: number }
  | { kind: 'hot'; seconds: number }
  | { kind: 'tireHits'; where: 'front' | 'rear' | 'middle'; count: number }
  | { kind: 'noShot'; part: number };

export type FactContext = {
  /** For each wheel component index of the local car, which axle it is on. */
  wheelRows: ReadonlyMap<number, 'front' | 'rear' | 'middle'>;
  /** Part indices of the local car's automatic weapons that were still working at the end. */
  workingAutoWeapons: readonly number[];
  /** The race was run to its end, so "never" is a fair word. */
  complete: boolean;
};

/**
 * The few facts worth a line, in order of interest, each supported by the log (Section 18.2:
 * never claim a cause the telemetry cannot establish). The caller shows the first two or three.
 */
export function resultFacts(summary: ResultsSummary, ctx: FactContext): ResultFact[] {
  const facts: ResultFact[] = [];
  const { dealt, taken } = summary;
  if (dealt.biggest && dealt.biggest.damage >= 1)
    facts.push({ kind: 'biggestHit', weapon: dealt.biggest.weapon, damage: dealt.biggest.damage });
  if (dealt.byWeapon.length > 1) {
    const best = dealt.byWeapon[0]!;
    facts.push({ kind: 'bestWeapon', weapon: best.weapon, damage: best.damage });
  }
  const rows = new Map<'front' | 'rear' | 'middle', number>();
  for (const c of taken.byComponent) {
    const row = ctx.wheelRows.get(c.component);
    if (row) rows.set(row, (rows.get(row) ?? 0) + c.hits);
  }
  let worstRow: 'front' | 'rear' | 'middle' | null = null;
  for (const [row, hits] of rows)
    if (hits >= 2 && hits > (worstRow ? rows.get(worstRow)! : 0)) worstRow = row;
  if (worstRow) facts.push({ kind: 'tireHits', where: worstRow, count: rows.get(worstRow)! });
  if (summary.hotSeconds >= 3) facts.push({ kind: 'hot', seconds: Math.round(summary.hotSeconds) });
  if (taken.biggest && taken.biggest.damage >= 1)
    facts.push({ kind: 'worstTaken', weapon: taken.biggest.weapon, damage: taken.biggest.damage });
  if (ctx.complete)
    for (const part of ctx.workingAutoWeapons)
      if ((summary.shotsByPart[part] ?? 0) === 0) facts.push({ kind: 'noShot', part });
  return facts;
}
