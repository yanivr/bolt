import { STRINGS } from '@bolt/content';
import { KMH_PER_MPH } from '@bolt/shared';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useApp, useHud } from '../app/store.js';
import { Glyph } from '../components/Glyph.js';
import type { GlyphName } from '../components/glyphs.js';
import { PixelText } from '../components/PixelText.js';
import type { GameManifests } from '../game/assets.js';
import type { DriveInput } from '../input/driveInput.js';
import { CarStatus } from './CarStatus.js';
import { EdgeMarkers, threatAngle } from './EdgeMarkers.js';
import { AutoPip, FireButton } from './FireButton.js';
import { HudButton } from './HudButton.js';
import { Minimap } from './Minimap.js';
import type { Rect } from './hudCamera.js';
import type { WarningKind } from './hudStore.js';
import { hudLive, onHudFrame, useCombat } from './hudStore.js';
import type { HudLoadout } from './model.js';
import { formatGap, formatRaceTime } from './model.js';

export { formatRaceTime } from './model.js';

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));
}

function BendWarning() {
  const direction = useHud((s) => s.bendDirection);
  const severity = useHud((s) => s.bendSeverity);
  if (direction === 0 || severity === 0) return <div className="bend" aria-hidden="true" />;
  const label = direction > 0 ? 'Right bend ahead' : 'Left bend ahead';
  return (
    <div
      className={`bend bend-${direction > 0 ? 'right' : 'left'} bend-${severity}`}
      role="img"
      aria-label={label}
    >
      {Array.from({ length: severity }, (_, i) => (
        <span key={i} className="bend-chevron" />
      ))}
    </div>
  );
}

/** The start countdown and GO, at the top of the screen, clear of the car on the grid. */
function Countdown() {
  const phase = useHud((s) => s.phase);
  const countdown = useHud((s) => s.countdown);
  const goStamp = useHud((s) => s.goStamp);
  const [showGo, setShowGo] = useState(false);

  useEffect(() => {
    if (goStamp === 0) return;
    setShowGo(true);
    const timer = window.setTimeout(() => setShowGo(false), 900);
    return () => window.clearTimeout(timer);
  }, [goStamp]);

  if (phase === 'COUNTDOWN' && countdown > 0) {
    return (
      <div
        className="banner countdown"
        key={countdown}
        aria-live="assertive"
        data-testid="countdown"
      >
        <PixelText text={String(countdown)} scale={8} color="#F5EED9" shadow="#151C2C" />
      </div>
    );
  }
  if (showGo) {
    return (
      <div className="banner countdown go" aria-live="assertive" data-testid="go">
        <PixelText text={STRINGS.race.go} scale={8} color="#67DEA7" shadow="#151C2C" />
      </div>
    );
  }
  return null;
}

/** The moment the local car crosses the line, before the result is in. */
function FinishBanner() {
  const youFinished = useCombat((s) => s.youFinished);
  const result = useCombat((s) => s.result);
  if (!youFinished || result) return null;
  return (
    <div className="banner finish-banner" role="status" data-testid="finish-banner">
      <PixelText text={STRINGS.hud.finished} scale={6} color="#F6C35B" shadow="#6e3212" />
    </div>
  );
}

const DEBUG = new URLSearchParams(window.location.search).get('debug') === '1';

/**
 * Development readout, shown only with `?debug=1`: one line for the link and prediction, one
 * for the combat state. The end-to-end tests read both.
 */
function DebugReadout() {
  const fps = useHud((s) => s.fps);
  const latency = useHud((s) => s.latencyMs);
  const pending = useHud((s) => s.pendingInputs);
  const corrections = useHud((s) => s.corrections);
  const maxCorrection = useHud((s) => s.maxCorrection);
  const mode = useHud((s) => s.linkMode);
  const renderer = useHud((s) => s.renderer);
  const heading = useHud((s) => s.headingDeg);
  const reversing = useHud((s) => s.reversing);
  const heat = useHud((s) => s.coreHeat);
  const battery = useHud((s) => s.batteryEnergy);
  const position = useHud((s) => s.position);
  const gap = useHud((s) => s.gapMeters);
  const chassis = useHud((s) => s.chassis);
  const rival = useHud((s) => s.rivalChassis);
  const projectiles = useHud((s) => s.projectiles);
  const hazards = useHud((s) => s.hazards);
  const events = useHud((s) => s.raceEvents);
  const last = useHud((s) => s.lastEvent);
  const statuses = useHud((s) => s.statuses);
  const result = useHud((s) => s.result);
  return (
    <div className="debug-block">
      <div className="debug" data-testid="debug">
        {fps} fps · {renderer} · {mode} · {Math.round(latency)} ms · pending {pending} · corrections{' '}
        {corrections} · max {maxCorrection.toFixed(2)} px · heading {heading} deg · heat {heat} ·
        power {battery}
        {reversing ? ' · reversing' : ''}
      </div>
      <div className="debug debug-combat" data-testid="debug-combat">
        pos {position} · gap {gap.toFixed(1)} m · hull {chassis} · rival {rival} · shots{' '}
        {projectiles} · traps {hazards} · events {events}
        {last ? ` · last ${last}` : ''}
        {statuses ? ` · ${statuses}` : ''}
        {result ? ` · result ${result}` : ''}
      </div>
    </div>
  );
}

/** Position, gap, lap and clock: the race itself, on the steering side at the top. */
const RacePanel = memo(function RacePanel() {
  const lap = useHud((s) => s.lap);
  const laps = useHud((s) => s.laps);
  const phase = useHud((s) => s.phase);
  const bestLapMs = useHud((s) => s.bestLapMs);
  const lastLapMs = useHud((s) => s.lastLapMs);
  const linkMode = useHud((s) => s.linkMode);
  const position = useCombat((s) => s.position);
  const gap = useCombat((s) => s.gap);
  const hasRival = useCombat((s) => s.rival.present);
  const finalLap = lap === laps && phase === 'RACING';
  const h = STRINGS.hud;
  return (
    <div className="panel hud-race">
      {hasRival && (
        <div className="hud-pos" data-testid="position" data-position={position}>
          <span className={`hud-place${position === 1 ? ' is-first' : ''}`}>
            {position === 1 && <Glyph name="flag" size={12} />}
            <PixelText
              text={position === 1 ? h.first : h.second}
              scale={3}
              color={position === 1 ? '#F6C35B' : '#F5EED9'}
            />
          </span>
          <span
            className="hud-gap"
            data-testid="gap"
            role="img"
            aria-label={fill(gap >= 0 ? h.gapAhead : h.gapBehind, {
              seconds: Math.abs(gap).toFixed(1),
            })}
          >
            {formatGap(gap)}
            <span className="hud-gap-unit"> s</span>
          </span>
        </div>
      )}
      <div className="hud-lap-row">
        <span className="hud-lap">
          <PixelText
            text={finalLap ? STRINGS.race.finalLap : STRINGS.race.lap}
            scale={2}
            color={finalLap ? '#F6C35B' : '#46D5E6'}
          />
          <PixelText text={`${lap}/${laps}`} scale={2} />
        </span>
        <RaceClock />
      </div>
      <dl className="hud-times">
        <div className="hud-times-best">
          <dt>{STRINGS.race.best}</dt>
          <dd>{bestLapMs > 0 ? formatRaceTime(bestLapMs) : '-:--.--'}</dd>
        </div>
        <div className="hud-times-last">
          <dt>{STRINGS.race.last}</dt>
          <dd>{lastLapMs > 0 ? formatRaceTime(lastLapMs) : '-:--.--'}</dd>
        </div>
      </dl>
      {linkMode === 'offline' && <span className="badge">{STRINGS.race.offlineBadge}</span>}
    </div>
  );
});

function RaceClock() {
  const raceTimeMs = useHud((s) => s.raceTimeMs);
  return (
    <span className="hud-clock">
      <PixelText text={formatRaceTime(raceTimeMs)} scale={2} />
    </span>
  );
}

function Speed() {
  const unit = useApp((s) => s.settings.speedUnit);
  const speedMph = useHud((s) => s.speed);
  const speed = Math.round(unit === 'mph' ? speedMph : speedMph * KMH_PER_MPH);
  return (
    <div className="hud-speed">
      <PixelText text={String(speed).padStart(3, ' ')} scale={2} color="#F6C35B" />
      <span className="hud-unit">{unit === 'mph' ? 'MPH' : 'KM/H'}</span>
    </div>
  );
}

/** The rival's hull as a small bar (Section 7.5: only what could be seen from outside). */
function RivalBar() {
  const rival = useCombat((s) => s.rival);
  if (!rival.present) return null;
  const h = STRINGS.hud;
  return (
    <div
      className={`panel hud-rival tier-${rival.tier}${rival.ko ? ' is-out' : ''}`}
      role="img"
      aria-label={fill(h.rivalHull, { percent: rival.chassisPercent })}
      data-testid="rival"
      data-percent={rival.chassisPercent}
    >
      <span className="hud-rival-name">{h.rival}</span>
      <span className="gauge-track">
        <span
          className="gauge-fill"
          style={{ transform: `scaleX(${rival.chassisPercent / 100})` }}
        />
      </span>
      {(rival.ko || rival.finished) && (
        <span className="hud-rival-note">{rival.ko ? h.rivalOut : h.rivalDone}</span>
      )}
    </div>
  );
}

const WARNING_GLYPH: Record<WarningKind | 'wrong_way', GlyphName> = {
  missile: 'missile',
  lock: 'weapon',
  trap: 'mine',
  rival_finished: 'flag',
  waiting: 'clock',
  wrong_way: 'warn',
};

/**
 * The one warning that matters most right now: a missile, a lock, a trap, the wrong way, or
 * the clock that starts when the first car finishes. It has a place of its own above the
 * callouts, a glyph of its own, and where it is about something in the world, an arrow that
 * points at it.
 */
function WarningChip() {
  const combat = useCombat((s) => s.warning);
  const wrongWay = useHud((s) => s.wrongWay);
  const kind: WarningKind | 'wrong_way' | null =
    combat === 'missile' || combat === 'lock' ? combat : wrongWay ? 'wrong_way' : combat;
  const arrow = useRef<HTMLSpanElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const detail = useRef<HTMLSpanElement>(null);
  const directed = kind === 'missile' || kind === 'lock' || kind === 'trap';
  const timed = kind === 'rival_finished' || kind === 'waiting';

  useEffect(() => {
    if (!kind || kind === 'wrong_way') return;
    let text = '';
    return onHudFrame((tick) => {
      if (directed && arrow.current) {
        const angle = threatAngle(kind, tick);
        arrow.current.style.visibility = angle === null ? 'hidden' : 'visible';
        if (angle !== null) arrow.current.style.transform = `rotate(${angle.toFixed(2)}rad)`;
      }
      if (kind === 'missile' && bar.current) {
        const window = hudLive.loadout?.hasRadar ? 30 : 15;
        const left = hudLive.impactTick > 0 ? (hudLive.impactTick - tick) / window : 0;
        bar.current.style.transform = `scaleX(${Math.max(0, Math.min(1, left)).toFixed(3)})`;
      }
      if (timed && detail.current) {
        const end = hudLive.race?.finishWindowEndTick ?? 0;
        const seconds = Math.max(0, Math.ceil((end - tick) / 30));
        const next = fill(
          kind === 'waiting' ? STRINGS.hud.warn.waiting : STRINGS.hud.warn.finishIn,
          { seconds },
        );
        if (next !== text) {
          text = next;
          detail.current.textContent = next;
        }
      }
    });
  }, [kind, directed, timed]);

  if (!kind) return null;
  const w = STRINGS.hud.warn;
  const text =
    kind === 'missile'
      ? w.incoming
      : kind === 'lock'
        ? w.missileLock
        : kind === 'trap'
          ? w.trap
          : kind === 'wrong_way'
            ? STRINGS.race.wrongWay
            : kind === 'waiting'
              ? STRINGS.hud.finished
              : w.rivalFinished;
  return (
    <div className={`hud-warning warn-${kind}`} role="alert" data-testid="warning" data-kind={kind}>
      <span className="hud-warning-icon" aria-hidden="true">
        <Glyph name={WARNING_GLYPH[kind]} size={24} />
      </span>
      <span className="hud-warning-text">
        <span className="hud-warning-head">{text}</span>
        {timed && <span className="hud-warning-detail" ref={detail} />}
        {kind === 'missile' && (
          <span className="hud-warning-bar" aria-hidden="true">
            <span ref={bar} />
          </span>
        )}
      </span>
      {directed && (
        <span className="hud-warning-arrow" ref={arrow} aria-hidden="true">
          <Glyph name="up" size={24} />
        </span>
      )}
    </div>
  );
}

const TONE_GLYPH = { good: 'check', bad: 'warn', info: 'flag' } as const;

/** At most two short callouts, and the same words read out politely for a screen reader. */
function Callouts() {
  const callouts = useCombat((s) => s.callouts);
  const newest = callouts[callouts.length - 1];
  return (
    <>
      <div className="hud-callouts" data-testid="callouts" data-count={callouts.length}>
        {callouts.map((callout) => (
          <div
            key={callout.id}
            className={`hud-callout tone-${callout.tone}`}
            data-key={callout.key}
          >
            <Glyph name={TONE_GLYPH[callout.tone]} size={12} />
            <span className="hud-callout-text">
              <span className="hud-callout-head">{callout.text}</span>
              {callout.detail && <span className="hud-callout-detail">{callout.detail}</span>}
            </span>
          </div>
        ))}
      </div>
      <div className="visually-hidden" aria-live="polite" data-testid="callouts-live">
        {newest ? `${newest.text}${newest.detail ? `. ${newest.detail}` : ''}` : ''}
      </div>
    </>
  );
}

/** Fire buttons, equipment buttons and the pips of parts that work by themselves. */
const ActionCluster = memo(function ActionCluster({
  manifests,
  loadout,
  input,
}: {
  manifests: GameManifests;
  loadout: HudLoadout;
  input: DriveInput;
}) {
  const [primary, secondary] = loadout.fire;
  const holdPrimary = useCallback((held: boolean) => input.setFire(0, held), [input]);
  const holdSecondary = useCallback((held: boolean) => input.setFire(1, held), [input]);
  if (!primary && !secondary && loadout.utilities.length === 0 && loadout.autos.length === 0)
    return null;
  // Two columns of equipment at most, nearest the fire buttons first.
  const near = loadout.utilities.slice(0, 3);
  const far = loadout.utilities.slice(3, 6);
  return (
    <div className="hud-actions" role="group" aria-label={STRINGS.hud.actions}>
      {loadout.autos.length > 0 && (
        <div className="hud-autos" data-testid="autos">
          {loadout.autos.map((action) => (
            <AutoPip key={action.part} manifests={manifests} action={action} />
          ))}
        </div>
      )}
      <div className="hud-buttons">
        {far.length > 0 && (
          <div className="hud-utils">
            {far.map((action) => (
              <UtilityButton
                key={action.part}
                manifests={manifests}
                action={action}
                input={input}
              />
            ))}
          </div>
        )}
        {near.length > 0 && (
          <div className="hud-utils">
            {near.map((action) => (
              <UtilityButton
                key={action.part}
                manifests={manifests}
                action={action}
                input={input}
              />
            ))}
          </div>
        )}
        {(primary || secondary) && (
          <div className="hud-fire">
            {secondary && (
              <FireButton
                manifests={manifests}
                action={secondary}
                role="secondary"
                onHold={holdSecondary}
              />
            )}
            {primary && (
              <FireButton
                manifests={manifests}
                action={primary}
                role="primary"
                onHold={holdPrimary}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
});

function UtilityButton({
  manifests,
  action,
  input,
}: {
  manifests: GameManifests;
  action: HudLoadout['utilities'][number];
  input: DriveInput;
}) {
  const hold = useCallback(
    (held: boolean) => input.setUse(action.useBit, held),
    [input, action.useBit],
  );
  return <FireButton manifests={manifests} action={action} role="utility" onHold={hold} />;
}

type Props = {
  manifests: GameManifests;
  loadout: HudLoadout;
  input: DriveInput;
  onPause: () => void;
};

/**
 * The race HUD (Sections 5.9, 5.15, 7.5, 8.3, 16).
 *
 * Everything lives in two columns that hug the sides of the screen. The local car is drawn
 * around the middle of the screen and the camera lets it wander: up to 12 percent of the width
 * and 27 percent of the height from the centre, toward wherever it has come from. The columns
 * are narrow enough that a box of 220 by 150 pixels around the car cannot reach them from
 * anywhere it can be, so nothing is ever over the car or the road just ahead of it.
 *
 * - Steering side (left by default): the race panel (place, gap, lap, clock), the car's
 *   condition, then the warning and callout lane. Nothing here takes a press, so the steering
 *   thumb can land on any of it.
 * - Action side: the route ribbon with the menu button and speed, the rival's hull, the next
 *   bend, and at the bottom, under the thumb, the fire and equipment buttons.
 *
 * `Driving Hand` swaps the two columns whole. The world and the steering are not mirrored.
 */
export function Hud({ manifests, loadout, input, onPause }: Props) {
  const showGuide = useApp((s) => s.settings.showTouchGuide);
  const steering = useApp((s) => s.settings.steering);
  const hudScale = useApp((s) => s.settings.hudScale);
  const steered = useApp((s) => s.milestones.steered);
  const completeMilestone = useApp((s) => s.completeMilestone);
  const phase = useHud((s) => s.phase);
  const hasSteered = useHud((s) => s.hasSteered);
  const hasBraked = useHud((s) => s.hasBraked);
  const root = useRef<HTMLDivElement>(null);
  const infoCol = useRef<HTMLDivElement>(null);
  const actionCol = useRef<HTMLDivElement>(null);
  const play = useRef<Rect>({ left: 0, top: 0, right: 0, bottom: 0 });

  useEffect(() => {
    if (hasSteered && hasBraked) completeMilestone('steered');
  }, [hasSteered, hasBraked, completeMilestone]);

  // The HUD's own camera needs the size of the view, and the edge markers the part of it
  // between the two columns.
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const measure = () => {
      const box = node.getBoundingClientRect();
      hudLive.camera.configure(
        node.clientWidth,
        node.clientHeight,
        window.devicePixelRatio || 1,
        loadout.world.width,
        loadout.world.height,
      );
      const edges = [infoCol.current, actionCol.current].map((col) =>
        col ? col.getBoundingClientRect() : null,
      );
      let left = 16;
      let right = box.width - 16;
      for (const edge of edges) {
        if (!edge) continue;
        if (edge.left - box.left < box.width / 2) left = Math.max(left, edge.right - box.left + 18);
        else right = Math.min(right, edge.left - box.left - 18);
      }
      play.current = { left, top: 18, right, bottom: box.height - 18 };
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    if (infoCol.current) observer.observe(infoCol.current);
    if (actionCol.current) observer.observe(actionCol.current);
    return () => observer.disconnect();
  }, [loadout]);
  const frame = useCallback(() => play.current, []);

  const hint = showGuide && !steered && phase === 'RACING' && !(hasSteered && hasBraked);

  return (
    <div className={`hud hud-scale-${hudScale}`} ref={root}>
      <div className="hud-col hud-col-info" ref={infoCol}>
        <RacePanel />
        <CarStatus loadout={loadout} />
        <div className="hud-lane">
          <WarningChip />
          <Callouts />
          {hint && (
            <div className="hint">
              {steering === 'wheel' ? STRINGS.race.steerHintWheel : STRINGS.race.steerHint}
            </div>
          )}
        </div>
      </div>

      <div className="hud-col hud-col-action" ref={actionCol}>
        <div className="hud-topbar">
          <div className="panel hud-map">
            <Minimap manifests={manifests} />
          </div>
          <div className="hud-topbar-side">
            <HudButton
              className="btn btn-icon hud-menu"
              onPress={onPause}
              label={STRINGS.home.settings}
            >
              <span className="icon-menu" aria-hidden="true" />
            </HudButton>
            <Speed />
          </div>
        </div>
        <RivalBar />
        <BendWarning />
        <ActionCluster manifests={manifests} loadout={loadout} input={input} />
      </div>

      <EdgeMarkers frame={frame} />
      <Countdown />
      <FinishBanner />
      {DEBUG && <DebugReadout />}
    </div>
  );
}
