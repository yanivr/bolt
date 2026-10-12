import { STRINGS } from '@bolt/content';
import { memo, useEffect, useRef } from 'react';
import { Glyph } from '../components/Glyph.js';
import type { EdgeMark, Rect, ScreenPoint } from './hudCamera.js';
import { avoidPanels, edgeFrame, edgeMark } from './hudCamera.js';
import type { WarningKind } from './hudStore.js';
import { hudLive, onHudFrame, trapHazard, useCombat } from './hudStore.js';
import { steadyMeters } from './model.js';

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));
}

/** Where on screen the thing a warning is about is, as far as the snapshot says. */
function threatPoint(kind: WarningKind | null, tick: number, out: ScreenPoint): boolean {
  const race = hudLive.race;
  if (!race || !kind) return false;
  const camera = hudLive.camera;
  if (kind === 'missile') {
    // The nearest guided missile that is not the driver's own.
    let best = Infinity;
    let found = false;
    const m = race.car.motion;
    for (const p of race.projectiles) {
      if (p.kind !== 'missile' || p.owner === race.you) continue;
      const age = Math.max(0, tick - p.tick) / 30;
      const x = p.x + p.vx * age;
      const y = p.y + p.vy * age;
      const d = (x - m.x) * (x - m.x) + (y - m.y) * (y - m.y);
      if (d < best) {
        best = d;
        camera.toScreen(x, y, out);
        found = true;
      }
    }
    if (found) return true;
  }
  if (kind === 'missile' || kind === 'lock') {
    if (!race.rivalTracked) return false;
    camera.toScreen(race.rival.x, race.rival.y, out);
    return true;
  }
  if (kind === 'trap') {
    const hazard = trapHazard(race);
    if (!hazard) return false;
    camera.toScreen(hazard.x, hazard.y, out);
    return true;
  }
  return false;
}

/** Direction from the local car to the thing being warned about, radians clockwise from up. */
export function threatAngle(kind: WarningKind | null, tick: number): number | null {
  const point = { x: 0, y: 0 };
  if (!hudLive.camera.ready || !threatPoint(kind, tick, point)) return null;
  const car = hudLive.camera.car({ x: 0, y: 0 });
  return Math.atan2(point.x - car.x, -(point.y - car.y));
}

/** Where edge tags may go: the screen inside its safe area, and the panels to keep off. */
export type EdgeField = { screen: Rect; panels: Rect[] };

type Props = {
  /** Read each time a tag is placed, so it follows the panels as they come and go. */
  field: () => EdgeField;
};

/** Half the size of the rival's tag and of the threat marker, CSS pixels. */
const RIVAL_HALF = { w: 30, h: 11 };
const THREAT_HALF = { w: 12, h: 12 };
/** The panels move rarely: their boxes are read again this often, not every frame. */
const FIELD_EVERY_MS = 200;

function place(node: HTMLElement | null, mark: EdgeMark | null): void {
  if (!node) return;
  if (!mark) {
    if (node.dataset.shown !== '0') {
      node.dataset.shown = '0';
      node.style.visibility = 'hidden';
    }
    return;
  }
  if (node.dataset.shown !== '1') {
    node.dataset.shown = '1';
    node.style.visibility = 'visible';
  }
  node.style.transform = `translate(${Math.round(mark.x)}px, ${Math.round(mark.y)}px)`;
  node.style.setProperty('--turn', `${mark.angle.toFixed(3)}rad`);
}

/**
 * Tags at the edge of the screen for things that are off it: the rival (Section 7.5: an
 * edge-clamped arrow with its distance) and whatever a warning is about. They lie against the
 * real edge of the screen, never out toward the middle where the cars are, and slide along
 * the edge past any panel in their way. The rival's tag is an arrow and a distance; whether
 * that is ahead or behind is in its accessible name, and on the race strip as the place. The
 * HUD computes them itself from its own copy of the camera; see hudCamera.ts. They move every
 * frame, so they are placed by writing to their own nodes.
 */
export const EdgeMarkers = memo(function EdgeMarkers({ field }: Props) {
  const rivalNode = useRef<HTMLDivElement>(null);
  const rivalLabel = useRef<HTMLSpanElement>(null);
  const threatNode = useRef<HTMLDivElement>(null);
  const fieldOf = useRef(field);
  fieldOf.current = field;

  useEffect(() => {
    const car: ScreenPoint = { x: 0, y: 0 };
    const point: ScreenPoint = { x: 0, y: 0 };
    let label = '';
    let area: EdgeField | null = null;
    let areaMs = -Infinity;
    return onHudFrame((tick, nowMs) => {
      const race = hudLive.race;
      const loadout = hudLive.loadout;
      const camera = hudLive.camera;
      if (!race || !loadout || camera.width <= 0) {
        place(rivalNode.current, null);
        place(threatNode.current, null);
        return;
      }
      // The local car, moved on from its last snapshot at its own speed.
      const m = race.car.motion;
      const ahead = Math.max(0, tick - race.tick) / 30;
      camera.update(
        nowMs,
        m.x + m.velocityX * ahead,
        m.y + m.velocityY * ahead,
        m.velocityX,
        m.velocityY,
      );
      camera.car(car);
      const view: Rect = { left: 0, top: 0, right: camera.width, bottom: camera.height };

      const state = useCombat.getState();
      const warning = state.warning;
      const wantRival =
        state.rival.present && state.rival.tracked && race.phase !== 'COUNTDOWN' && !race.result;
      const wantThreat = warning === 'missile' || warning === 'lock' || warning === 'trap';
      if (!wantRival && !wantThreat) {
        place(rivalNode.current, null);
        place(threatNode.current, null);
        return;
      }
      if (!area || nowMs - areaMs > FIELD_EVERY_MS) {
        area = fieldOf.current();
        areaMs = nowMs;
      }

      let rivalMark: EdgeMark | null = null;
      if (wantRival) {
        camera.toScreen(
          race.rival.x + race.rival.velocityX * ahead,
          race.rival.y + race.rival.velocityY * ahead,
          point,
        );
        const frame = edgeFrame(area.screen, RIVAL_HALF.w, RIVAL_HALF.h);
        const raw = edgeMark(point, car, view, frame);
        rivalMark = raw && avoidPanels(raw, frame, area.panels, RIVAL_HALF.w, RIVAL_HALF.h);
      }
      place(rivalNode.current, rivalMark);
      if (rivalMark) {
        // The gap is positive when the driver leads, so the rival is behind.
        const meters = steadyMeters(race.gapMeters);
        const text = fill(race.gapMeters >= 0 ? STRINGS.hud.behind : STRINGS.hud.ahead, {
          meters,
        });
        if (text !== label) {
          label = text;
          if (rivalLabel.current)
            rivalLabel.current.textContent = fill(STRINGS.hud.meters, { meters });
          rivalNode.current?.setAttribute('data-label', text);
          rivalNode.current?.setAttribute('aria-label', `${STRINGS.hud.rival}: ${text}`);
        }
      }

      let threat: EdgeMark | null = null;
      if (wantThreat && threatPoint(warning, tick, point)) {
        const frame = edgeFrame(area.screen, THREAT_HALF.w, THREAT_HALF.h);
        const raw = edgeMark(point, car, view, frame);
        threat = raw && avoidPanels(raw, frame, area.panels, THREAT_HALF.w, THREAT_HALF.h);
      }
      // A threat from where the rival is: one marker, the rival's, drawn as the threat.
      const merged =
        threat !== null &&
        rivalMark !== null &&
        Math.hypot(threat.x - rivalMark.x, threat.y - rivalMark.y) < 56;
      if (merged) threat = null;
      if (rivalNode.current && rivalNode.current.dataset.threat !== (merged ? '1' : '0'))
        rivalNode.current.dataset.threat = merged ? '1' : '0';
      place(threatNode.current, threat);
    });
  }, []);

  return (
    <>
      <div
        className="edge-mark edge-rival"
        ref={rivalNode}
        data-testid="rival-arrow"
        data-shown="0"
        style={{ visibility: 'hidden' }}
        role="img"
        aria-label={STRINGS.hud.rival}
      >
        <span className="edge-tag">
          <span className="edge-arrow" aria-hidden="true">
            <Glyph name="up" size={12} />
          </span>
          <span className="edge-label" ref={rivalLabel} />
        </span>
      </div>
      <div
        className="edge-mark edge-threat"
        ref={threatNode}
        data-testid="threat-arrow"
        data-shown="0"
        style={{ visibility: 'hidden' }}
        aria-hidden="true"
      >
        <span className="edge-tag">
          <span className="edge-arrow">
            <Glyph name="up" size={12} />
          </span>
        </span>
      </div>
    </>
  );
});
