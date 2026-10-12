/**
 * Difficulty and style for the AI driver (Sections 3.1 and 15.9). Difficulty changes only
 * three things, as the specification requires: how deep the driver plans (how far ahead it
 * reads the road, how much of the racing line it has worked out, whether it weighs shortcuts
 * and timed hazards properly, how far ahead it leads a moving target), how much line error it
 * accepts (how far it wanders off its line, and so how much margin it must keep to the grip
 * limit to stay on the road), and how late it reacts (to the rival, to a trap, to a lock).
 * Nothing here touches the car: every AI car runs the same physics, coefficients, cooldowns
 * and ammunition as a player's (asserted in tests/unit/ai.test.ts).
 *
 * Styles are independent ways to race at the same difficulty, so two Racers do not drive the
 * same race: an aggressive driver passes early, leans on the other car and spends ammunition
 * on fair chances; a tactical one waits for the clean pass, defends the inside, saves its
 * limited weapons for good shots and lays traps where the follower will drive.
 */

export type AiDifficulty = 'rookie' | 'racer' | 'ace';
export type AiStyle = 'aggressive' | 'tactical';

export const AI_DIFFICULTIES: readonly AiDifficulty[] = ['rookie', 'racer', 'ace'];
export const AI_STYLES: readonly AiStyle[] = ['aggressive', 'tactical'];
export const DEFAULT_DIFFICULTY: AiDifficulty = 'racer';

export type AiSkill = {
  difficulty: AiDifficulty;
  // --- Planning depth ---------------------------------------------------------------------------
  /** Share of the worked-out racing line the driver follows (the rest is the centerline). */
  lineDepth: number;
  /** Speed planning horizon: braking distance times this, plus `horizonExtra` px. */
  horizonFactor: number;
  horizonExtra: number;
  /** 0 never weighs shortcuts, 1 by length only, 2 by its own car's grip and the ground. */
  shortcutDepth: 0 | 1 | 2;
  /** Seconds a timed hazard (crossing, vent) is read ahead. */
  hazardForesight: number;
  /** Seconds of the rival's motion a shot or a trap is led by (share of the true lead). */
  leadShare: number;
  /** Plans passes and defence against the next corner, not just the car beside it. */
  cornerCraft: boolean;
  /** Manages engine heat (lifts before thermal protection) and times repairs. */
  carCraft: boolean;
  // --- Acceptable line error ------------------------------------------------------------------
  /** Wander off the line, px (one standard deviation), and how slowly it changes, s. */
  lineError: number;
  lineErrorSeconds: number;
  /** Share of the grip limit it corners at and plans braking with: the margin its error needs. */
  cornerConfidence: number;
  brakeConfidence: number;
  // --- Reaction delay -------------------------------------------------------------------------
  /** Ticks between something becoming visible and the driver acting on it. */
  reactionTicks: number;
  /** Share of fair weapon chances that go by unnoticed. */
  missChance: number;
};

export type AiStyleTuning = {
  style: AiStyle;
  /** Distance behind at which it commits to a pass, px, and how much closing speed it needs. */
  passReach: number;
  passClosing: number;
  /** Lean into the other car alongside (a ram) when it is lighter or carries blades. */
  leans: boolean;
  /** Moves across to cover the inside when followed closely. */
  defends: number;
  /** Lowest hit chance it fires an unlimited weapon at, and a limited one when ammunition is plentiful. */
  fireThreshold: number;
  limitedThreshold: number;
  /** Shortcut taken when the estimate gains at least this many seconds. */
  shortcutGain: number;
  /** Lowest chance of the follower driving over it that a trap is dropped at. */
  trapThreshold: number;
};

export const AI_SKILLS: Readonly<Record<AiDifficulty, AiSkill>> = {
  rookie: {
    difficulty: 'rookie',
    lineDepth: 0.45,
    horizonFactor: 1.15,
    horizonExtra: 30,
    shortcutDepth: 1,
    hazardForesight: 0.6,
    leadShare: 0,
    cornerCraft: false,
    carCraft: false,
    lineError: 15,
    lineErrorSeconds: 1.6,
    cornerConfidence: 0.8,
    brakeConfidence: 0.62,
    reactionTicks: 10,
    missChance: 0.3,
  },
  racer: {
    difficulty: 'racer',
    lineDepth: 0.85,
    horizonFactor: 1.35,
    horizonExtra: 50,
    shortcutDepth: 2,
    hazardForesight: 1.2,
    leadShare: 0.7,
    cornerCraft: true,
    carCraft: true,
    lineError: 6,
    lineErrorSeconds: 1.2,
    cornerConfidence: 0.88,
    brakeConfidence: 0.68,
    reactionTicks: 7,
    missChance: 0.12,
  },
  ace: {
    difficulty: 'ace',
    lineDepth: 1,
    horizonFactor: 1.6,
    horizonExtra: 70,
    shortcutDepth: 2,
    hazardForesight: 2,
    leadShare: 1,
    cornerCraft: true,
    carCraft: true,
    lineError: 2.5,
    lineErrorSeconds: 1,
    cornerConfidence: 0.93,
    brakeConfidence: 0.72,
    // About 170 ms: quick for a person, not impossible (Section 3.1).
    reactionTicks: 5,
    missChance: 0.04,
  },
};

export const AI_STYLE_TUNING: Readonly<Record<AiStyle, AiStyleTuning>> = {
  aggressive: {
    style: 'aggressive',
    passReach: 120,
    passClosing: -4,
    leans: true,
    defends: 0.5,
    fireThreshold: 0.25,
    limitedThreshold: 0.4,
    shortcutGain: 0.1,
    trapThreshold: 0.3,
  },
  tactical: {
    style: 'tactical',
    passReach: 80,
    passClosing: 6,
    leans: false,
    defends: 1,
    fireThreshold: 0.38,
    limitedThreshold: 0.58,
    shortcutGain: 0.3,
    trapThreshold: 0.45,
  },
};

export type AiPersona = { skill: AiSkill; style: AiStyleTuning };

export function aiPersona(difficulty: AiDifficulty, style: AiStyle): AiPersona {
  return { skill: AI_SKILLS[difficulty], style: AI_STYLE_TUNING[style] };
}

export function isDifficulty(value: unknown): value is AiDifficulty {
  return value === 'rookie' || value === 'racer' || value === 'ace';
}
