import { CATALOG, STRINGS } from '@bolt/content';
import type { BlueprintIssue, MountPoint, PlacedPart, VehicleBlueprint } from '@bolt/shared';
import { accessoryMounts, clamp, installedParts, own } from '@bolt/shared';
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CarCanvas } from '../../components/CarCanvas.js';
import { Glyph } from '../../components/Glyph.js';
import type { GlyphName } from '../../components/glyphs.js';
import { PartIcon } from '../../components/PartIcon.js';
import type { LocalPoint } from '../../components/carSprites.js';
import { mountHeight, projectPoints, screenToLocal } from '../../components/carSprites.js';
import type { GameManifests } from '../../game/assets.js';
import type { Selection } from '../buildSession.js';
import { issueText, tryMove } from '../buildSession.js';
import { fill, mountName } from '../text.js';

/**
 * The rotate-view control steps through four of the sixty-four authored headings: nose up,
 * right, down and left. Quarter views keep mounts over the body where they are easy to tap.
 */
const VIEW_STEP = 16;
const VIEW_FRAMES = 64;
/** Sprite pixels a part on a default-height mount is lifted by the camera tilt. */
const LIFT = 8;
/** CSS pixels kept clear at the bottom of the workbench for the status line. */
const STATUS_ROOM = 24;
/** A press that travels less than this many CSS pixels is a tap, not a drag. */
const DRAG_SLOP = 6;

/** Mount glyphs that point somewhere, and so turn with the view. */
const DIRECTIONAL = new Set(['FRONT', 'REAR', 'LEFT', 'RIGHT']);

const MOUNT_GLYPH: Record<string, GlyphName> = {
  FRONT: 'front',
  REAR: 'rear',
  LEFT: 'left',
  RIGHT: 'right',
  ROOF: 'roof',
  UTILITY: 'utility',
  ARMOR: 'armor',
  UNIVERSAL: 'universal',
};

type Drag = {
  instanceId: string;
  pointerId: number;
  startX: number;
  startY: number;
  fromX: number;
  fromY: number;
  offsetX: number;
  offsetY: number;
  moved: boolean;
  issue: BlueprintIssue | null;
};

type Props = {
  manifests: GameManifests;
  blueprint: VehicleBlueprint;
  selection: Selection;
  /** The mount the focused card would be installed on. */
  targetMountId: string | null;
  /** Installed parts the validator or the last refusal points at. */
  flagged: readonly string[];
  locked: boolean;
  onTapMount: (mountId: string) => void;
  onSelectInstance: (instanceId: string) => void;
  onMove: (instanceId: string, offsetX: number, offsetY: number) => void;
  onNudge: (instanceId: string, dx: number, dy: number) => void;
  onRotate: (instanceId: string) => void;
  onRemove: (instanceId: string) => void;
  onClearSelection: () => void;
  onOpenPaint: () => void;
  /** Reports the reason a drag position is refused, or null when the drag is fine or over. */
  onDragIssue: (issue: BlueprintIssue | null) => void;
};

function corners(x: number, y: number, w: number, h: number, z: number, id: string): LocalPoint[] {
  return [
    { id: `${id}:a`, x: x - w / 2, y: y - h / 2, z },
    { id: `${id}:b`, x: x + w / 2, y: y - h / 2, z },
    { id: `${id}:c`, x: x + w / 2, y: y + h / 2, z },
    { id: `${id}:d`, x: x - w / 2, y: y + h / 2, z },
  ];
}

/**
 * The car editor (Section 5.6): the car drawn from the real sprites at a whole-number scale,
 * with every accessory mount of the chassis as a marker in its true position. Markers are
 * placed by running the mount geometry through the shared compositor, so they follow the
 * rotate-view control exactly as the part sprites do. A tap selects; it never buys.
 */
export function Workbench({
  manifests,
  blueprint,
  selection,
  targetMountId,
  flagged,
  locked,
  onTapMount,
  onSelectInstance,
  onMove,
  onNudge,
  onRotate,
  onRemove,
  onClearSelection,
  onOpenPaint,
  onDragIssue,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState({ width: 320, height: 260 });
  const [view, setView] = useState(0);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const measure = () => setRoom({ width: node.clientWidth, height: node.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const chassis = own(CATALOG.chassis, blueprint.chassisId);
  const sprite = manifests.cars.chassis[blueprint.chassisId];
  const frameSize = sprite?.body.frameWidth ?? 96;
  const mounts = useMemo(() => (chassis ? accessoryMounts(chassis) : []), [chassis]);
  const parts = useMemo(() => installedParts(blueprint, CATALOG), [blueprint]);

  // The largest whole-number scale at which the body and every mount fit the workbench at
  // the current view. The tilted sprite stands about eight pixels taller than its footprint.
  const scale = useMemo(() => {
    if (!chassis) return 2;
    let reachX = chassis.bodyHalfWidth + 3;
    let reachY = chassis.bodyHalfLength + 2;
    for (const mount of mounts) {
      reachX = Math.max(reachX, Math.abs(mount.x) + mount.maxFootprint.w / 2 + 1);
      reachY = Math.max(reachY, Math.abs(mount.y) + mount.maxFootprint.h / 2 + 1);
    }
    const angle = (view / VIEW_FRAMES) * Math.PI * 2;
    const c = Math.abs(Math.cos(angle));
    const s = Math.abs(Math.sin(angle));
    const spanX = 2 * (c * reachX + s * reachY) + 6;
    const spanY = 2 * (s * reachX + c * reachY) + LIFT + 2;
    const fit = Math.min(room.width / spanX, (room.height - STATUS_ROOM) / spanY);
    return Math.max(2, Math.min(6, Math.floor(fit)));
  }, [chassis, mounts, room, view]);

  const dragged = drag?.moved ? drag : null;
  const layout = useMemo(() => {
    if (!sprite) return null;
    const points: LocalPoint[] = [];
    for (const mount of mounts) {
      const z = mountHeight(sprite, mount.id);
      points.push({ id: `m:${mount.id}`, x: mount.x, y: mount.y, z });
      points.push(
        ...corners(
          mount.x,
          mount.y,
          mount.maxFootprint.w,
          mount.maxFootprint.h,
          z,
          `s:${mount.id}`,
        ),
      );
    }
    for (const part of parts) {
      const z = mountHeight(sprite, part.mount.id);
      const moving = dragged && dragged.instanceId === part.instance.instanceId;
      const x = moving ? part.mount.x + dragged.offsetX : part.x;
      const y = moving ? part.mount.y + dragged.offsetY : part.y;
      const id = part.instance.instanceId;
      points.push({ id: `p:${id}`, x, y, z });
      points.push(...corners(x, y, part.w, part.h, z, `f:${id}`));
      // Where the part's centre may go: the mount's bounded installation region.
      points.push(
        ...corners(
          part.mount.x,
          part.mount.y,
          part.mount.regionHalfW * 2 + part.w,
          part.mount.regionHalfH * 2 + part.h,
          z,
          `r:${id}`,
        ),
      );
      // The nose of the part, so a weapon shows which way it points.
      const half = part.def.footprint.h / 2;
      const turns = part.instance.rotationQuarterTurns;
      const nx = turns === 1 ? half : turns === 3 ? -half : 0;
      const ny = turns === 0 ? -half : turns === 2 ? half : 0;
      points.push({ id: `n:${id}`, x: x + nx, y: y + ny, z });
    }
    return projectPoints(sprite, view, points);
  }, [sprite, mounts, parts, view, dragged]);

  const px = frameSize * scale;
  const at = (id: string): { x: number; y: number } => {
    const p = layout?.get(id);
    return { x: (frameSize / 2 + (p?.dx ?? 0)) * scale, y: (frameSize / 2 + (p?.dy ?? 0)) * scale };
  };
  const polygon = (id: string) =>
    ['a', 'b', 'c', 'd']
      .map((corner) => {
        const p = at(`${id}:${corner}`);
        return `${p.x},${p.y}`;
      })
      .join(' ');

  // Markers are as large as their neighbours allow, up to a full 48 pixel target.
  const hit = useMemo(() => {
    let nearest = Infinity;
    const centres = [
      ...mounts.map((m) => ({ x: m.x, y: m.y })),
      ...parts.map((p) => ({ x: p.x, y: p.y })),
    ];
    for (let i = 0; i < centres.length; i++)
      for (let j = i + 1; j < centres.length; j++) {
        const d = Math.hypot(centres[i]!.x - centres[j]!.x, centres[i]!.y - centres[j]!.y);
        if (d > 0.5) nearest = Math.min(nearest, d);
      }
    return clamp(Math.floor(nearest * scale) - 2, 30, 48);
  }, [mounts, parts, scale]);

  const selectedId = selection.kind === 'instance' ? selection.instanceId : null;
  // A mount picked for replacing: the part on it is shown as the thing being replaced.
  const pickedMount = selection.kind === 'mount' ? selection.mountId : null;
  const selectedPart = parts.find((p) => p.instance.instanceId === selectedId) ?? null;
  const occupied = new Set(parts.map((p) => p.mount.id));

  const beginDrag = (event: ReactPointerEvent<HTMLButtonElement>, part: PlacedPart) => {
    if (locked || event.button > 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDrag({
      instanceId: part.instance.instanceId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      fromX: part.instance.offsetX,
      fromY: part.instance.offsetY,
      offsetX: part.instance.offsetX,
      offsetY: part.instance.offsetY,
      moved: false,
      issue: null,
    });
  };

  const moveDrag = (event: ReactPointerEvent<HTMLButtonElement>, mount: MountPoint) => {
    const live = dragRef.current;
    if (!live || live.pointerId !== event.pointerId) return;
    const dx = event.clientX - live.startX;
    const dy = event.clientY - live.startY;
    if (!live.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
    const local = screenToLocal(view, dx / scale, dy / scale);
    const offsetX = clamp(Math.round(live.fromX + local.x), -mount.regionHalfW, mount.regionHalfW);
    const offsetY = clamp(Math.round(live.fromY + local.y), -mount.regionHalfH, mount.regionHalfH);
    if (live.moved && offsetX === live.offsetX && offsetY === live.offsetY) return;
    const trial =
      offsetX === live.fromX && offsetY === live.fromY
        ? null
        : tryMove(blueprint, CATALOG, live.instanceId, offsetX, offsetY);
    const issue = trial && !trial.ok ? trial.issue : null;
    setDrag({ ...live, offsetX, offsetY, moved: true, issue });
    onDragIssue(issue);
  };

  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>, cancelled: boolean) => {
    const live = dragRef.current;
    if (!live || live.pointerId !== event.pointerId) return;
    setDrag(null);
    onDragIssue(null);
    if (cancelled) return;
    if (!live.moved) {
      onSelectInstance(live.instanceId);
      return;
    }
    onSelectInstance(live.instanceId);
    // An illegal drop is sent too: the store refuses it, leaves the part where it was and
    // names the reason, so a drag never ends in silence.
    onMove(live.instanceId, live.offsetX, live.offsetY);
  };

  // A build that locks mid-drag puts the part back where it last legally was.
  useEffect(() => {
    if (locked && dragRef.current) {
      setDrag(null);
      onDragIssue(null);
    }
  }, [locked, onDragIssue]);

  const onPartKey = (event: ReactKeyboardEvent, instanceId: string) => {
    const step =
      event.key === 'ArrowUp'
        ? [0, -1]
        : event.key === 'ArrowDown'
          ? [0, 1]
          : event.key === 'ArrowLeft'
            ? [-1, 0]
            : event.key === 'ArrowRight'
              ? [1, 0]
              : null;
    if (step) {
      event.preventDefault();
      onSelectInstance(instanceId);
      onNudge(instanceId, step[0]!, step[1]!);
    } else if (event.key === 'r' || event.key === 'R') {
      event.preventDefault();
      onRotate(instanceId);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      onRemove(instanceId);
    } else if (event.key === 'Escape') {
      onClearSelection();
    }
  };

  const paint = manifests.cars.paints[blueprint.paintId];
  const swatch = paint?.ramp[3] ?? '#cf3440';
  const markerStyle = (p: { x: number; y: number }): CSSProperties => ({
    left: p.x,
    top: p.y,
    width: hit,
    height: hit,
  });

  return (
    <section className="g-bench" aria-label={STRINGS.garage.mounts}>
      <div className="g-bench-floor" ref={host}>
        <div
          className="g-car"
          style={{
            width: px,
            height: px,
            // Centred by hand: a car larger than the floor must still sit in the middle.
            transform: `translate(-50%, -50%) translateY(${scale - Math.round(STATUS_ROOM / 2)}px)`,
          }}
        >
          <CarCanvas manifests={manifests} blueprint={blueprint} scale={scale} frame={view} />
          {layout && (
            <svg className="g-car-lines" width={px} height={px} aria-hidden="true">
              {mounts
                .filter((mount) => !occupied.has(mount.id))
                .map((mount) => (
                  <polygon
                    key={mount.id}
                    className={`socket${
                      selection.kind === 'mount' && selection.mountId === mount.id
                        ? ' is-selected'
                        : ''
                    }${targetMountId === mount.id ? ' is-target' : ''}`}
                    points={polygon(`s:${mount.id}`)}
                  />
                ))}
              {parts.map((part) => {
                const id = part.instance.instanceId;
                const moving = dragged?.instanceId === id;
                const bad = flagged.includes(id) || (moving && dragged.issue !== null);
                const nose = at(`n:${id}`);
                const centre = at(`p:${id}`);
                return (
                  <g key={id}>
                    {selectedId === id && (
                      <polygon className="region" points={polygon(`r:${id}`)} />
                    )}
                    <polygon
                      className={`footprint${
                        selectedId === id || pickedMount === part.mount.id ? ' is-selected' : ''
                      }${
                        bad ? ' is-bad' : ''
                      }${targetMountId === part.mount.id ? ' is-target' : ''}`}
                      points={polygon(`f:${id}`)}
                    />
                    {part.def.rotatable && (
                      <line
                        className={`nose${selectedId === id ? ' is-selected' : ''}`}
                        x1={centre.x}
                        y1={centre.y}
                        x2={nose.x}
                        y2={nose.y}
                      />
                    )}
                  </g>
                );
              })}
            </svg>
          )}
          {layout &&
            mounts
              .filter((mount) => !occupied.has(mount.id))
              .map((mount) => {
                const selected = selection.kind === 'mount' && selection.mountId === mount.id;
                return (
                  <button
                    key={mount.id}
                    type="button"
                    className={`mount is-empty${selected ? ' is-selected' : ''}${
                      targetMountId === mount.id ? ' is-target' : ''
                    }`}
                    style={markerStyle(at(`m:${mount.id}`))}
                    aria-pressed={selected}
                    aria-label={fill(STRINGS.garage.emptyMount, { mount: mountName(mount.id) })}
                    data-mount={mount.id}
                    disabled={locked}
                    onClick={() => onTapMount(mount.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') onClearSelection();
                    }}
                  >
                    <span
                      className="mount-face"
                      style={
                        DIRECTIONAL.has(mount.categories[0] ?? '')
                          ? { transform: `rotate(${(view / VIEW_FRAMES) * 360}deg)` }
                          : undefined
                      }
                    >
                      <Glyph name={MOUNT_GLYPH[mount.categories[0] ?? ''] ?? 'plus'} size={12} />
                    </span>
                  </button>
                );
              })}
          {layout &&
            parts.map((part) => {
              const id = part.instance.instanceId;
              const selected = selectedId === id || pickedMount === part.mount.id;
              const moving = dragged?.instanceId === id;
              const bad = flagged.includes(id) || (moving && dragged.issue !== null);
              const drawn = Object.prototype.hasOwnProperty.call(
                manifests.cars.parts ?? {},
                part.def.id,
              );
              return (
                <button
                  key={id}
                  type="button"
                  className={`mount is-occupied${selected ? ' is-selected' : ''}${
                    bad ? ' is-bad' : ''
                  }${moving ? ' is-dragging' : ''}${drawn ? ' has-art' : ''}${
                    targetMountId === part.mount.id ? ' is-target' : ''
                  }`}
                  style={markerStyle(at(`p:${id}`))}
                  aria-pressed={selected}
                  aria-label={fill(STRINGS.garage.mountWith, {
                    part: part.def.displayName,
                    mount: mountName(part.mount.id),
                  })}
                  data-mount={part.mount.id}
                  data-instance={id}
                  data-part={part.def.id}
                  disabled={locked}
                  onPointerDown={(event) => beginDrag(event, part)}
                  onPointerMove={(event) => moveDrag(event, part.mount)}
                  onPointerUp={(event) => endDrag(event, false)}
                  onPointerCancel={(event) => endDrag(event, true)}
                  onClick={(event) => {
                    // Pointer presses are handled on release; this is keyboard activation.
                    if (event.detail === 0) onSelectInstance(id);
                  }}
                  onKeyDown={(event) => onPartKey(event, id)}
                >
                  <span className="mount-face">
                    {!drawn && (
                      <PartIcon
                        manifests={manifests}
                        partId={part.def.id}
                        category={part.def.category}
                        size={Math.max(18, Math.min(28, hit - 10))}
                      />
                    )}
                    {bad && (
                      <span className="mount-alert">
                        <Glyph name="warn" size={12} />
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          {layout && selectedPart && !dragged && (
            <span
              className="mount-tag"
              style={{
                left: at(`p:${selectedPart.instance.instanceId}`).x,
                top: at(`p:${selectedPart.instance.instanceId}`).y - hit / 2 - 4,
              }}
              aria-hidden="true"
            >
              {selectedPart.def.displayName}
            </span>
          )}
          {layout && dragged?.issue && (
            <span
              className="mount-tag is-bad"
              style={{
                left: at(`p:${dragged.instanceId}`).x,
                top: at(`p:${dragged.instanceId}`).y - hit / 2 - 4,
              }}
              aria-hidden="true"
            >
              {issueText(dragged.issue)}
            </span>
          )}
        </div>
      </div>
      <button
        type="button"
        className="g-name"
        onClick={onOpenPaint}
        disabled={locked}
        aria-label={`${STRINGS.garage.paintAndName}: ${blueprint.name}`}
        title={STRINGS.garage.paintAndName}
      >
        <span className="g-name-swatch" style={{ background: swatch }} aria-hidden="true" />
        <Glyph name="paint" size={12} />
      </button>
      <button
        type="button"
        className="btn btn-small btn-square g-view"
        onClick={() => setView((v) => (v + VIEW_STEP) % VIEW_FRAMES)}
        aria-label={STRINGS.garage.rotateView}
        title={STRINGS.garage.rotateView}
      >
        <Glyph name="rotate" size={24} />
      </button>
    </section>
  );
}
