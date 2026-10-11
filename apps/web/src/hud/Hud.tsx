import { STRINGS } from '@bolt/content';
import { KMH_PER_MPH } from '@bolt/shared';
import { useEffect, useState } from 'react';
import { useApp, useHud } from '../app/store.js';
import { PixelText } from '../components/PixelText.js';
import type { GameManifests } from '../game/assets.js';
import { HudButton } from './HudButton.js';
import { Minimap } from './Minimap.js';

export function formatRaceTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 10));
  const minutes = Math.floor(total / 6000);
  const seconds = Math.floor((total % 6000) / 100);
  const hundredths = total % 100;
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

function BendWarning() {
  const direction = useHud((s) => s.bendDirection);
  const severity = useHud((s) => s.bendSeverity);
  if (direction === 0 || severity === 0) return null;
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
      <div className="callout countdown" key={countdown} aria-live="assertive">
        <PixelText text={String(countdown)} scale={14} color="#F5EED9" shadow="#151C2C" />
      </div>
    );
  }
  if (showGo) {
    return (
      <div className="callout countdown go" aria-live="assertive">
        <PixelText text={STRINGS.race.go} scale={12} color="#67DEA7" shadow="#151C2C" />
      </div>
    );
  }
  return null;
}

const DEBUG = new URLSearchParams(window.location.search).get('debug') === '1';

/** Development readout for hardware testing: frame rate, link quality and prediction health. */
/** Combat diagnostics. The combat HUD itself is Milestone C part 2. */
function CombatReadout() {
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
    <div className="debug debug-combat" data-testid="debug-combat">
      pos {position} · gap {gap.toFixed(1)} m · hull {chassis} · rival {rival} · shots {projectiles}{' '}
      · traps {hazards} · events {events}
      {last ? ` · last ${last}` : ''}
      {statuses ? ` · ${statuses}` : ''}
      {result ? ` · result ${result}` : ''}
    </div>
  );
}

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
  return (
    <div className="debug" data-testid="debug">
      {fps} fps · {renderer} · {mode} · {Math.round(latency)} ms · pending {pending} · corrections{' '}
      {corrections} · max {maxCorrection.toFixed(2)} px · heading {heading} deg · heat {heat} ·
      power {battery}
      {reversing ? ' · reversing' : ''}
    </div>
  );
}

/**
 * The driver's combat buttons, as the blueprint defines them. A stand-in until the combat HUD
 * is designed: it exists so weapons and utilities can be operated by touch.
 */
export type HudActions = {
  fire: Array<{ slot: 0 | 1; label: string }>;
  use: Array<{ bit: number; label: string }>;
  onFire: (slot: 0 | 1) => void;
  onUse: (bit: number) => void;
};

type Props = { manifests: GameManifests; onPause: () => void; actions?: HudActions | null };

/**
 * Race HUD (Section 5.9). Top left: lap and lap times. Top centre: race clock and the next
 * bend. Top right: route ribbon and the menu button. The speed readout sits on the action-hand
 * side, where weapon controls join it in Milestone C. Every element stays outside the area
 * around the local car.
 */
export function Hud({ manifests, onPause, actions }: Props) {
  const unit = useApp((s) => s.settings.speedUnit);
  const showGuide = useApp((s) => s.settings.showTouchGuide);
  const steering = useApp((s) => s.settings.steering);
  const steered = useApp((s) => s.milestones.steered);
  const completeMilestone = useApp((s) => s.completeMilestone);
  const speedMph = useHud((s) => s.speed);
  const lap = useHud((s) => s.lap);
  const laps = useHud((s) => s.laps);
  const raceTimeMs = useHud((s) => s.raceTimeMs);
  const bestLapMs = useHud((s) => s.bestLapMs);
  const lastLapMs = useHud((s) => s.lastLapMs);
  const wrongWay = useHud((s) => s.wrongWay);
  const linkMode = useHud((s) => s.linkMode);
  const phase = useHud((s) => s.phase);
  const hasSteered = useHud((s) => s.hasSteered);
  const hasBraked = useHud((s) => s.hasBraked);

  useEffect(() => {
    if (hasSteered && hasBraked) completeMilestone('steered');
  }, [hasSteered, hasBraked, completeMilestone]);

  const speed = Math.round(unit === 'mph' ? speedMph : speedMph * KMH_PER_MPH);
  const finalLap = lap === laps && phase === 'RACING';
  const hint = showGuide && !steered && phase === 'RACING' && !(hasSteered && hasBraked);

  return (
    <div className="hud">
      <div className="hud-top">
        <div className="panel hud-lap">
          <div className="hud-lap-row">
            <PixelText
              text={finalLap ? STRINGS.race.finalLap : STRINGS.race.lap}
              scale={2}
              color={finalLap ? '#F6C35B' : '#46D5E6'}
            />
            <PixelText text={`${lap}/${laps}`} scale={3} />
          </div>
          <dl className="hud-times">
            <div>
              <dt>{STRINGS.race.best}</dt>
              <dd>{bestLapMs > 0 ? formatRaceTime(bestLapMs) : '-:--.--'}</dd>
            </div>
            <div>
              <dt>{STRINGS.race.last}</dt>
              <dd>{lastLapMs > 0 ? formatRaceTime(lastLapMs) : '-:--.--'}</dd>
            </div>
          </dl>
          {linkMode === 'offline' && <span className="badge">{STRINGS.race.offlineBadge}</span>}
        </div>

        <div className="hud-center">
          <div className="panel hud-clock">
            <PixelText text={formatRaceTime(raceTimeMs)} scale={3} />
          </div>
          <BendWarning />
        </div>

        <div className="hud-right">
          <div className="panel hud-map">
            <Minimap manifests={manifests} />
          </div>
          <HudButton className="btn btn-icon" onPress={onPause} label={STRINGS.home.settings}>
            <span className="icon-menu" aria-hidden="true" />
          </HudButton>
        </div>
      </div>

      {wrongWay && (
        <div className="callout wrong-way" role="alert">
          <PixelText text={STRINGS.race.wrongWay} scale={4} color="#FFB454" shadow="#151C2C" />
        </div>
      )}
      <Countdown />
      {hint && (
        <div className="hint">
          {steering === 'wheel' ? STRINGS.race.steerHintWheel : STRINGS.race.steerHint}
        </div>
      )}
      {DEBUG && <DebugReadout />}
      {DEBUG && <CombatReadout />}

      {/* DEBUG CONTROL: replaced in Milestone C part 2 */}
      {actions && (actions.fire.length > 0 || actions.use.length > 0) && phase === 'RACING' && (
        <div className="hud-actions">
          {actions.use.map((item) => (
            <HudButton
              key={`use-${item.bit}`}
              className="btn"
              onPress={() => actions.onUse(item.bit)}
              label={item.label}
            >
              {item.label}
            </HudButton>
          ))}
          {actions.fire.map((item) => (
            <HudButton
              key={`fire-${item.slot}`}
              className="btn btn-primary"
              onPress={() => actions.onFire(item.slot)}
              label={`Fire ${item.label}`}
            >
              {item.label}
            </HudButton>
          ))}
        </div>
      )}

      <div className="hud-speed panel">
        <PixelText
          text={String(speed).padStart(3, ' ')}
          scale={5}
          color="#F6C35B"
          shadow="#151C2C"
        />
        <span className="hud-unit">{unit === 'mph' ? 'MPH' : 'KM/H'}</span>
      </div>
    </div>
  );
}
