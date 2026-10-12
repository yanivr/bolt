import { STRINGS } from '@bolt/content';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Glyph } from '../components/Glyph.js';
import type { GlyphName } from '../components/glyphs.js';
import { hudLive, onHudFrame, useCombat } from './hudStore.js';
import type { BrokenPart, HudComponent, HudLoadout, StatusKey, StatusView, Tier } from './model.js';
import { BROKEN_MAX, DIAGRAM_POP_MS, brokenParts } from './model.js';

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));
}

const TIER_CLASS = ['is-ok', 'is-damaged', 'is-critical', 'is-dead'] as const;

/**
 * One damageable part on the diagram. Its condition changes its drawing, not only its color
 * (Section 16): whole is a solid block, damaged is striped, critical is cross-hatched and
 * blinks, destroyed is an empty dashed frame with a cross through it.
 */
const Segment = memo(function Segment({ part }: { part: HudComponent }) {
  const tier: Tier = useCombat((s) => s.tiers[part.index]) ?? 0;
  const focus = useCombat((s) => s.popFocus === part.index);
  const hit = useCombat((s) => s.hitStamp[part.index]) ?? 0;
  const repair = useCombat((s) => s.repairStamp[part.index]) ?? 0;
  const x = part.x - part.w / 2;
  const y = part.y - part.h / 2;
  return (
    <g
      className={`car-seg seg-${part.kind} ${TIER_CLASS[tier]}${focus ? ' is-focus' : ''}`}
      data-component={part.index}
      data-tier={tier}
      data-hits={hit}
      data-repairs={repair}
    >
      <rect className="car-seg-base" x={x} y={y} width={part.w} height={part.h} />
      {tier === 1 && (
        <rect
          className="car-seg-mark"
          x={x}
          y={y}
          width={part.w}
          height={part.h}
          fill="url(#hud-stripe)"
        />
      )}
      {tier === 2 && (
        <rect
          className="car-seg-mark"
          x={x}
          y={y}
          width={part.w}
          height={part.h}
          fill="url(#hud-cross)"
        />
      )}
      {tier === 3 && (
        <path
          className="car-seg-x"
          d={`M${x} ${y}L${x + part.w} ${y + part.h}M${x + part.w} ${y}L${x} ${y + part.h}`}
        />
      )}
      {hit > 0 && (
        <rect
          key={`h${hit}`}
          className="car-seg-flash"
          x={x - 1}
          y={y - 1}
          width={part.w + 2}
          height={part.h + 2}
        />
      )}
      {focus && (
        <rect
          className="car-seg-focus"
          x={x - 1.5}
          y={y - 1.5}
          width={part.w + 3}
          height={part.h + 3}
        />
      )}
      {repair > 0 && (
        <rect
          key={`r${repair}`}
          className="car-seg-repair"
          x={x - 1.5}
          y={y - 1.5}
          width={part.w + 3}
          height={part.h + 3}
        />
      )}
    </g>
  );
});

/** Armor left on one side of the car, as a bar along that side that shortens as it wears. */
function ArmorSide({ arc, body }: { arc: number; body: HudLoadout['body'] }) {
  const quarters = useCombat((s) => s.armor[arc]) ?? -1;
  if (quarters < 0) return null;
  const share = quarters / 4;
  const pad = 3.5;
  const { halfW, halfL } = body;
  const horizontal = arc === 0 || arc === 2;
  const half = (horizontal ? halfW : halfL) * share;
  const d = horizontal
    ? `M${-half} ${arc === 0 ? -halfL - pad : halfL + pad}H${half}`
    : `M${arc === 1 ? halfW + pad : -halfW - pad} ${-half}V${half}`;
  return (
    <g
      className={`car-armor${quarters === 0 ? ' is-gone' : ''}`}
      data-arc={arc}
      data-quarters={quarters}
    >
      {quarters > 0 && <path d={d} />}
    </g>
  );
}

/**
 * The tiny car (Section 8.1's subsystem silhouette): nose up, the engine, the steering rack,
 * every wheel and every mounted part where it really sits, each showing its own condition.
 */
const Diagram = memo(function Diagram({ loadout }: { loadout: HudLoadout }) {
  const hull: Tier = useCombat((s) => s.hullTier);
  const hullStamp = useCombat((s) => s.hullStamp);
  const tiers = useCombat((s) => s.tiers);
  const box = useMemo(() => {
    let left = -loadout.body.halfW - 6;
    let right = loadout.body.halfW + 6;
    let top = -loadout.body.halfL - 6;
    let bottom = loadout.body.halfL + 6;
    for (const c of loadout.components) {
      left = Math.min(left, c.x - c.w / 2 - 2);
      right = Math.max(right, c.x + c.w / 2 + 2);
      top = Math.min(top, c.y - c.h / 2 - 2);
      bottom = Math.max(bottom, c.y + c.h / 2 + 2);
    }
    // Symmetric, so the car sits in the middle of its tile.
    const halfW = Math.max(-left, right);
    return { x: -halfW, y: top, w: halfW * 2, h: bottom - top };
  }, [loadout]);
  const { halfW, halfL } = loadout.body;
  const cut = Math.min(5, halfW * 0.4);
  const outline = `M${-halfW + cut} ${-halfL}H${halfW - cut}L${halfW} ${-halfL + cut}V${halfL - cut}L${halfW - cut} ${halfL}H${-halfW + cut}L${-halfW} ${halfL - cut}V${-halfL + cut}Z`;
  // What the diagram says, in words, for a screen reader: only what is not whole.
  const hurt = loadout.components
    .filter((c) => (tiers[c.index] ?? 0) > 0)
    .map((c) =>
      fill(STRINGS.hud.componentState, {
        part: c.name,
        condition: STRINGS.hud.condition[tiers[c.index] ?? 0],
      }),
    );
  // The body, then the wheels in their arches, then what stands on the car.
  const order = [...loadout.components].sort(
    (a, b) => Number(a.kind !== 'wheel') - Number(b.kind !== 'wheel'),
  );
  return (
    <svg
      className={`car-diagram hull-${hull}`}
      viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
      role="img"
      aria-label={hurt.length > 0 ? `${STRINGS.hud.you}. ${hurt.join('. ')}` : STRINGS.hud.you}
      data-testid="car-diagram"
      shapeRendering="crispEdges"
    >
      <defs>
        <pattern
          id="hud-stripe"
          width="3"
          height="3"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="1.2" height="3" fill="#151c2c" />
        </pattern>
        <pattern id="hud-cross" width="3" height="3" patternUnits="userSpaceOnUse">
          <path d="M0 0H1.2V1.2H0ZM1.5 1.5H2.7V2.7H1.5Z" fill="#151c2c" />
        </pattern>
      </defs>
      <path className="car-body" d={outline} />
      {hullStamp > 0 && <path key={hullStamp} className="car-body-flash" d={outline} />}
      {[0, 1, 2, 3].map((arc) => (
        <ArmorSide key={arc} arc={arc} body={loadout.body} />
      ))}
      {order.map((c) => (
        <Segment key={c.index} part={c} />
      ))}
    </svg>
  );
});

/**
 * Eight by eight pixel marks for the three bars. Each bar has a mark of its own, and a second
 * one for its alarm state, so the state is told by the drawing as well as by the color.
 */
const MINI = {
  hull: [
    '.######.',
    '#......#',
    '#.####.#',
    '#.#..#.#',
    '#.#..#.#',
    '#.####.#',
    '#......#',
    '.######.',
  ],
  heat: [
    '...#....',
    '...##...',
    '..###.#.',
    '.####.##',
    '.######.',
    '##.####.',
    '##..###.',
    '.##.##..',
  ],
  power: [
    '....###.',
    '...###..',
    '..###...',
    '.######.',
    '.######.',
    '...###..',
    '..###...',
    '.###....',
  ],
  alarm: [
    '...##...',
    '..####..',
    '..#..#..',
    '.##..##.',
    '.##..##.',
    '########',
    '###..###',
    '########',
  ],
  lost: [
    '##....##',
    '###..###',
    '.######.',
    '..####..',
    '..####..',
    '.######.',
    '###..###',
    '##....##',
  ],
} as const;

type MiniName = keyof typeof MINI;

const MINI_PATHS = new Map<MiniName, string>();

function miniPath(name: MiniName): string {
  let d = MINI_PATHS.get(name);
  if (d === undefined) {
    d = '';
    MINI[name].forEach((row, y) => {
      for (let x = 0; x < row.length; x++) if (row[x] === '#') d += `M${x} ${y}h1v1h-1z`;
    });
    MINI_PATHS.set(name, d);
  }
  return d;
}

function Mini({ name }: { name: MiniName }) {
  return (
    <svg
      className="mini"
      viewBox="0 0 8 8"
      shapeRendering="crispEdges"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      data-mini={name}
    >
      <path d={miniPath(name)} />
    </svg>
  );
}

/** A gauge whose fill is written every frame from the newest snapshot, never through React. */
function useGauge(read: () => number) {
  const node = useRef<HTMLSpanElement>(null);
  const reader = useRef(read);
  reader.current = read;
  useEffect(() => {
    let last = -1;
    return onHudFrame(() => {
      const value = Math.max(0, Math.min(1, reader.current()));
      if (Math.abs(value - last) < 0.004) return;
      last = value;
      if (node.current) node.current.style.transform = `scaleX(${value.toFixed(3)})`;
    });
  }, []);
  return node;
}

/** The hull: a bar, its number at the end, and a different mark once it is critical. */
function HullBar() {
  const percent = useCombat((s) => s.chassisPercent);
  const tier = useCombat((s) => s.hullTier);
  return (
    <div
      className={`gauge gauge-hull tier-${tier}`}
      role="meter"
      aria-label={STRINGS.hud.hull}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      data-testid="hull"
      data-tier={tier}
    >
      <Mini name={tier >= 3 ? 'lost' : tier === 2 ? 'alarm' : 'hull'} />
      <span className="gauge-track">
        <span className="gauge-fill" style={{ transform: `scaleX(${percent / 100})` }} />
      </span>
    </div>
  );
}

function HullValue() {
  const percent = useCombat((s) => s.chassisPercent);
  const tier = useCombat((s) => s.hullTier);
  return (
    <span className={`gauge-value tier-${tier}`} aria-hidden="true" data-testid="hull-value">
      {percent}
    </span>
  );
}

/**
 * Heat, with a mark where output starts to fall. Hot, the bar is striped; at the limit it is
 * framed, hatched the other way, its mark becomes the alarm triangle and blinks, because that
 * is the moment a driver asks why nothing fires.
 */
function HeatGauge({ loadout }: { loadout: HudLoadout }) {
  const level = useCombat((s) => s.heat);
  const node = useGauge(() => (hudLive.race?.car.motion.coreHeat ?? 0) / loadout.heatMax);
  return (
    <div
      className={`gauge gauge-heat level-${level}`}
      role="img"
      aria-label={`${STRINGS.hud.heat}: ${level === 3 ? STRINGS.hud.heatLocked : STRINGS.hud.heatState[level]}`}
      data-testid="heat"
      data-level={level}
    >
      <Mini name={level === 3 ? 'alarm' : 'heat'} />
      <span className="gauge-track">
        <span className="gauge-fill" ref={node} />
        <span
          className="gauge-tick"
          style={{ left: `${(loadout.heatHot / loadout.heatMax) * 100}%` }}
        />
      </span>
    </div>
  );
}

/** Energy. Low, the bar is framed and banded, and its mark becomes the alarm triangle and blinks. */
function PowerGauge({ loadout }: { loadout: HudLoadout }) {
  const low = useCombat((s) => s.powerLow);
  const node = useGauge(
    () => (hudLive.race?.car.motion.batteryEnergy ?? 0) / loadout.batteryCapacity,
  );
  return (
    <div
      className={`gauge gauge-power${low ? ' is-low' : ''}`}
      role="img"
      aria-label={`${STRINGS.hud.power}${low ? `: ${STRINGS.hud.powerLow}` : ''}`}
      data-testid="power"
      data-low={low ? '1' : '0'}
    >
      <Mini name={low ? 'alarm' : 'power'} />
      <span className="gauge-track">
        <span className="gauge-fill" ref={node} />
      </span>
    </div>
  );
}

const STATUS_GLYPH: Record<StatusKey, GlyphName> = {
  slow: 'slow',
  grip: 'slide',
  burn: 'flame',
  emp: 'emp',
  jam: 'jam',
  boost: 'boost',
  refit: 'wrench',
  airborne: 'up',
  immune: 'immune',
  shield: 'defense',
  tether: 'tether',
};

/** A status with the time it has left as a ring that empties clockwise. */
const StatusIcon = memo(function StatusIcon({ status }: { status: StatusView }) {
  const ring = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (status.totalTicks <= 0) {
      ring.current?.style.setProperty('--left', '1');
      return;
    }
    let last = -1;
    return onHudFrame((tick) => {
      const left = Math.max(0, Math.min(1, (status.untilTick - tick) / status.totalTicks));
      if (Math.abs(left - last) < 0.01) return;
      last = left;
      ring.current?.style.setProperty('--left', left.toFixed(3));
    });
  }, [status.untilTick, status.totalTicks]);
  return (
    <span
      className={`status-icon status-${status.key}${status.harmful ? ' is-harmful' : ' is-helpful'}`}
      role="img"
      aria-label={STRINGS.hud.status[status.key]}
      title={STRINGS.hud.status[status.key]}
      data-status={status.key}
    >
      <span className="status-ring" ref={ring} aria-hidden="true" />
      <Glyph name={STATUS_GLYPH[status.key]} size={12} />
    </span>
  );
});

function brokenGlyph(part: BrokenPart): GlyphName {
  if (part.kind === 'wheel') return 'tires';
  if (part.kind === 'engine') return 'engine';
  if (part.kind === 'steering') return 'rotate';
  if (part.category === 'weapon') return 'weapon';
  if (part.category === 'defense') return 'defense';
  return 'utility';
}

/**
 * One part that is critical or destroyed. Destroyed is a dashed frame with a cross through
 * the part's glyph; critical is a hatched frame with an exclamation corner that blinks.
 */
const BrokenIcon = memo(function BrokenIcon({ part }: { part: BrokenPart }) {
  const label = fill(STRINGS.hud.componentState, {
    part: part.name,
    condition: STRINGS.hud.condition[part.tier],
  });
  return (
    <span
      className={`broken-icon ${part.tier === 3 ? 'is-dead' : 'is-critical'}`}
      role="img"
      aria-label={label}
      title={label}
      data-component={part.component}
      data-tier={part.tier}
      data-kind={part.kind}
    >
      <Glyph name={brokenGlyph(part)} size={12} />
      {part.tier === 3 ? (
        <svg className="broken-x" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
          <path d="M2 2L16 16M16 2L2 16" />
        </svg>
      ) : (
        <span className="broken-bang" aria-hidden="true" />
      )}
    </span>
  );
});

/**
 * One row under the bars, there only while it has something to say: an icon for each part
 * that is critical or destroyed right now, then whatever is acting on the car, each with the
 * time it has left. A healthy car with nothing on it shows no row at all.
 */
function Flags({ loadout }: { loadout: HudLoadout }) {
  const tiers = useCombat((s) => s.tiers);
  const statuses = useCombat((s) => s.statuses);
  const broken = useMemo(() => brokenParts(loadout, tiers), [loadout, tiers]);
  const shown = broken.slice(0, BROKEN_MAX);
  const more = broken.length - shown.length;
  return (
    <div className="hud-flags">
      <div className="broken-row" data-testid="broken" data-count={broken.length}>
        {shown.map((part) => (
          <BrokenIcon key={part.component} part={part} />
        ))}
        {more > 0 && (
          <span className="broken-more" aria-hidden="true">
            +{more}
          </span>
        )}
      </div>
      <div className="status-row" data-testid="statuses" data-count={statuses.length}>
        {statuses.map((status) => (
          <StatusIcon key={status.key} status={status} />
        ))}
      </div>
    </div>
  );
}

/**
 * The car diagram, on show only when it matters: for a moment after a component of the local
 * car is hit, changes condition or is repaired, with that component outlined and blinking. It
 * stays in the page the rest of the time (hidden, and still described to a screen reader), so
 * its state is always the car's.
 */
function DiagramPop({ loadout }: { loadout: HudLoadout }) {
  const stamp = useCombat((s) => s.popStamp);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (stamp === 0) {
      setShown(false);
      return;
    }
    setShown(true);
    const timer = window.setTimeout(() => setShown(false), DIAGRAM_POP_MS);
    return () => window.clearTimeout(timer);
  }, [stamp]);
  return (
    <div
      className={`hud-diagram${shown ? ' is-shown' : ''}`}
      data-testid="diagram-pop"
      data-shown={shown ? '1' : '0'}
    >
      <Diagram loadout={loadout} />
    </div>
  );
}

/**
 * The car at a glance (Sections 5.9 and 8.1), slim: three thin bars for hull, heat and
 * energy with the hull's number at their end; beside them, only when something happens to a
 * part, the car diagram; under them, only while there is something to show, what is broken
 * and what is acting on the car.
 */
export const CarStatus = memo(function CarStatus({ loadout }: { loadout: HudLoadout }) {
  return (
    <div className="hud-cond">
      <div className="hud-car" data-testid="car-status">
        <div className="hud-car-gauges">
          <HullBar />
          <HeatGauge loadout={loadout} />
          <PowerGauge loadout={loadout} />
        </div>
        <HullValue />
      </div>
      <DiagramPop loadout={loadout} />
      <Flags loadout={loadout} />
    </div>
  );
});
