import type { GarageSession } from './buildSession.js';
import { currentBlueprint } from './buildSession.js';

/**
 * Which interface sound a change in the garage deserves (docs/DECISIONS.md, entry 137: the
 * call sites the audio track asked the garage for). Decided from the session before and
 * after, so one place hears every way an edit can happen: a tap, a drag, a key, undo.
 */
export type GarageSound =
  | { kind: 'install'; partId: string }
  | { kind: 'remove' | 'rotate' | 'illegal' | 'select' | 'ready' | 'timer_end' | 'tap' };

export function garageSound(
  before: GarageSession | null,
  after: GarageSession,
): GarageSound | null {
  if (!before || before === after) return null;
  if (after.phase === 'locked' && before.phase !== 'locked')
    return { kind: after.lockReason === 'ready' ? 'ready' : 'timer_end' };
  // A refusal says so before anything else is considered.
  if (after.notice && after.notice.tone === 'error' && after.notice.stamp !== before.notice?.stamp)
    return { kind: 'illegal' };
  const was = currentBlueprint(before);
  const now = currentBlueprint(after);
  if (was !== now) {
    if (now.chassisId !== was.chassisId) return { kind: 'install', partId: now.chassisId };
    if (now.engineId !== was.engineId) return { kind: 'install', partId: now.engineId };
    if (now.tireKitId !== was.tireKitId) return { kind: 'install', partId: now.tireKitId };
    const had = new Map(was.parts.map((p) => [p.instanceId, p]));
    const added = now.parts.find((p) => !had.has(p.instanceId));
    if (added) return { kind: 'install', partId: added.partId };
    if (now.parts.length < was.parts.length) return { kind: 'remove' };
    for (const part of now.parts) {
      const old = had.get(part.instanceId);
      if (old && old.rotationQuarterTurns !== part.rotationQuarterTurns) return { kind: 'rotate' };
    }
    return { kind: 'tap' };
  }
  if (
    before.selection !== after.selection ||
    before.focusPartId !== after.focusPartId ||
    before.view !== after.view
  )
    return { kind: 'select' };
  return null;
}

/** The sound of the build clock at a whole second, or null: a tick from ten, urgent from three. */
export function clockSound(
  secondsBefore: number | null,
  secondsNow: number | null,
): 'timer_tick' | 'timer_urgent' | null {
  if (secondsNow === null || secondsBefore === null) return null;
  const now = Math.ceil(secondsNow);
  if (now === Math.ceil(secondsBefore) || now > 10 || now <= 0) return null;
  return now <= 3 ? 'timer_urgent' : 'timer_tick';
}
