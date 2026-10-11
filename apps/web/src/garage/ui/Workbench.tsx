import { CATALOG, STRINGS } from '@bolt/content';
import type { BlueprintIssue, MountPoint, PlacedPart, VehicleBlueprint } from '@bolt/shared';
import { accessoryMounts, clamp, installedParts, own } from '@bolt/shared';
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CarCanvas } from '../../components/CarCanvas.js';
import { Glyph } from '../../components/Glyph.js';
import type { GlyphName } from '../../components/glyphs.js';
import type { LocalPoint } from '../../components/carSprites.js';
import {
  measureChassis,
  measuredBounds,
  mountHeight,
  projectPoints,
  screenToLocal,
} from '../../components/carSprites.js';
import type { GameManifests } from '../../game/assets.js';
import { layoutBench } from '../benchLayout.js';
import type { Slot } from '../buildSession.js';
import { issueText, tryMove } from '../buildSession.js';
import { VIEW_FRAMES, carBounds, projectMounts } from '../carGeometry.js';
import { fill, mountName, mountShort } from '../text.js';
import type { StepMark } from './SlotTile.js';
import { SlotTile } from './SlotTile.js';

const HEADINGS = 64;
/** A press that travels less than this many CSS pixels is a tap, not a drag. */
const DRAG_SLOP = 6;

const KIND_GLYPH: Record<string, GlyphName> = {
  ROOF: 'roof',
  UTILITY: 'utility',
  ARMOR: 'armor',
  UNIVERSAL: 'universal',
};
/** Degrees clockwise from the nose for the mounts that sit on one side of the car. */
const SIDE_ANGLE: Record<string, number> = { FRONT: 0, RIGHT: 90, REAR: 180, LEFT: 270 };
const ARROWS: GlyphName[] = ['up', 'right', 'down', 'left'];

/** An empty mount's glyph: what it takes, or an arrow toward its side of the car on screen. */
function mountGlyph(mount: MountPoint, frame: number): GlyphName {
  const kind = mount.categories[0] ?? '';
  const side = SIDE_ANGLE[kind];
  if (side === undefined) return KIND_GLYPH[kind] ?? 'plus';
  const turn = Math.round((side + (frame / HEADINGS) * 360) / 90) % 4;
  return ARROWS[turn] ?? 'up';
}

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

export type CoachMarks = {
  chassis?: StepMark;
  tires?: StepMark;
  /** The weapon step, shown on the mount it suggests. */
  weapon?: StepMark & { mountId: string | null };
};

type Essential = 'chassis' | 'engine' | 'tires';
const ESSENTIALS: readonly Essential[] = ['chassis', 'engine', 'tires'];

type Props = {
  manifests: GameManifests;
  blueprint: VehicleBlueprint;
  /** Portrait: the mount tiles run in one row under the car, without leader lines. */
  row: boolean;
  /** The slot the side panel is showing. */
  slot: Slot | null;
  selectedInstanceId: string | null;
  /** Where the focused card would go, and the part that would come off for it. */
  target: { mountId: string | null; replacedId: string | null } | null;
  /** Installed parts the validator or the last refusal points at. */
  flagged: readonly string[];
  flaggedEssentials: ReadonlySet<string>;
  marks: CoachMarks;
  /** The idle view of the whole car is showing. */
  idle: boolean;
  locked: boolean;
  onSlot: (slot: Slot) => void;
  onShowCar: () => void;
  onSelectInstance: (instanceId: string) => void;
  onMove: (instanceId: string, offsetX: number, offsetY: number) => void;
  onNudge: (instanceId: string, dx: number, dy: number) => void;
  onRotate: (instanceId: string) => void;
  onRemove: (instanceId: string) => void;
  onClearSelection: () => void;
  /** Reports the reason a drag position is refused, or null when the drag is fine or over. */
  onDragIssue: (issue: BlueprintIssue | null) => void;
  /** The status line, laid over the clear floor between the tile columns. */
  children?: ReactNode;
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
 * The car editor (Section 5.6). The car is drawn clean, from the real sprites, in the race's
 * tilted view and at the largest whole-number scale that fits. Every accessory mount of the
 * chassis is a tile beside the car, joined to the mount's true position by a leader line; the
 * chassis, engine and wheels are three tiles under it. The selected part is picked out on the
 * car by an outline traced around its own sprite, never by a box over it.
 */
export function Workbench({
  manifests,
  blueprint,
  row,
  slot,
  selectedInstanceId,
  target,
  flagged,
  flaggedEssentials,
  marks,
  idle,
  locked,
  onSlot,
  onShowCar,
  onSelectInstance,
  onMove,
  onNudge,
  onRotate,
  onRemove,
  onClearSelection,
  onDragIssue,
  children,
}: Props) {
  const g = STRINGS.garage;
  const host = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState({ width: 320, height: 200 });
  const [viewIndex, setViewIndex] = useState(0);
  const [measured, setMeasured] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const frame = VIEW_FRAMES[viewIndex % VIEW_FRAMES.length] ?? 0;

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const measure = () => setRoom({ width: node.clientWidth, height: node.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // The real extent of the chassis art, so the car is as large as the drawing allows.
  const chassisId = blueprint.chassisId;
  useEffect(() => {
    let stale = false;
    const done = () => {
      if (!stale) setMeasured(chassisId);
    };
    measureChassis(manifests, chassisId, VIEW_FRAMES).then(done, done);
    return () => {
      stale = true;
    };
  }, [manifests, chassisId]);

  const chassis = own(CATALOG.chassis, chassisId);
  const sprite = manifests.cars.chassis[chassisId];
  const frameSize = sprite?.body.frameWidth ?? 96;
  const mounts = useMemo(() => (chassis ? accessoryMounts(chassis) : []), [chassis]);
  const parts = useMemo(() => installedParts(blueprint, CATALOG), [blueprint]);
  const ready = measured === chassisId;

  const layout = useMemo(() => {
    const bounds =
      chassis && sprite
        ? carBounds(chassis, sprite, frame, ready ? measuredBounds(chassisId, frame) : undefined)
        : { left: -36, top: -36, right: 36, bottom: 36 };
    return layoutBench({
      width: room.width,
      height: room.height,
      mounts: chassis && sprite ? projectMounts(chassis, sprite, frame) : [],
      bounds,
      columns: !row,
    });
  }, [chassis, sprite, chassisId, frame, ready, room, row]);
  const { scale } = layout;
  const px = frameSize * scale;

  // The dragged part is drawn where the finger has it, legal or not.
  const dragged = drag?.moved ? drag : null;
  const shown = useMemo(
    () =>
      dragged
        ? {
            ...blueprint,
            parts: blueprint.parts.map((p) =>
              p.instanceId === dragged.instanceId
                ? { ...p, offsetX: dragged.offsetX, offsetY: dragged.offsetY }
                : p,
            ),
          }
        : blueprint,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [blueprint, dragged?.instanceId, dragged?.offsetX, dragged?.offsetY],
  );

  const selectedPart = parts.find((p) => p.instance.instanceId === selectedInstanceId) ?? null;
  const occupants = (mountId: string) => parts.filter((p) => p.mount.id === mountId);
  const slotMount = slot?.kind === 'mount' ? slot.mountId : null;
  // A mount picked for replacing: the part on it is the thing being replaced.
  const replacing = slotMount && !selectedPart ? (occupants(slotMount)[0] ?? null) : null;
  const drawn = (partId: string) =>
    Object.prototype.hasOwnProperty.call(manifests.cars.parts ?? {}, partId);

  const badDrag = dragged?.issue ? dragged.instanceId : null;
  const outlined =
    badDrag ??
    (selectedPart && flagged.includes(selectedPart.instance.instanceId)
      ? selectedPart.instance.instanceId
      : null);
  const highlight = outlined
    ? ({ instanceId: outlined, tone: 'bad' } as const)
    : target?.replacedId
      ? ({ instanceId: target.replacedId, tone: 'target' } as const)
      : selectedPart
        ? ({ instanceId: selectedPart.instance.instanceId, tone: 'select' } as const)
        : replacing
          ? ({ instanceId: replacing.instance.instanceId, tone: 'select' } as const)
          : null;

  // Sockets: a dashed outline at a mount, only where there is no sprite to trace instead.
  const sockets = useMemo(() => {
    if (!sprite) return [];
    const wanted: Array<{ id: string; mount: MountPoint; tone: 'select' | 'target' | 'bad' }> = [];
    const mountOf = (id: string | null) => mounts.find((m) => m.id === id) ?? null;
    const picked = mountOf(slotMount);
    if (picked) {
      const holding = parts.filter((p) => p.mount.id === picked.id);
      if (holding.length === 0 || holding.some((p) => !drawn(p.def.id)))
        wanted.push({ id: picked.id, mount: picked, tone: 'select' });
    }
    const aimed = mountOf(target?.mountId ?? null);
    if (aimed && !target?.replacedId && aimed.id !== picked?.id)
      wanted.push({ id: aimed.id, mount: aimed, tone: 'target' });
    for (const part of parts)
      if (flagged.includes(part.instance.instanceId) && !drawn(part.def.id))
        wanted.push({ id: `bad:${part.instance.instanceId}`, mount: part.mount, tone: 'bad' });
    const points = wanted.flatMap(({ id, mount }) =>
      corners(
        mount.x,
        mount.y,
        mount.maxFootprint.w,
        mount.maxFootprint.h,
        mountHeight(sprite, mount.id),
        id,
      ),
    );
    const at = projectPoints(sprite, frame, points);
    return wanted.map(({ id, tone }) => ({
      id,
      tone,
      points: ['a', 'b', 'c', 'd']
        .map((corner) => {
          const p = at.get(`${id}:${corner}`);
          return `${(frameSize / 2 + (p?.dx ?? 0)) * scale},${(frameSize / 2 + (p?.dy ?? 0)) * scale}`;
        })
        .join(' '),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sprite, mounts, parts, slotMount, target, flagged, frame, frameSize, scale]);

  // Where the selected part is drawn, for the drag handle laid over it.
  const grab = useMemo(() => {
    if (!sprite || !selectedPart) return null;
    const live = dragged?.instanceId === selectedPart.instance.instanceId ? dragged : null;
    const x = live ? selectedPart.mount.x + live.offsetX : selectedPart.x;
    const y = live ? selectedPart.mount.y + live.offsetY : selectedPart.y;
    const p = projectPoints(sprite, frame, [
      { id: 'grab', x, y, z: mountHeight(sprite, selectedPart.mount.id) },
    ]).get('grab');
    const size = Math.max(44, Math.max(selectedPart.w, selectedPart.h) * scale + 8);
    return {
      left: (frameSize / 2 + (p?.dx ?? 0)) * scale,
      top: (frameSize / 2 + (p?.dy ?? 0)) * scale,
      size,
    };
  }, [sprite, selectedPart, dragged, frame, frameSize, scale]);

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>, part: PlacedPart) => {
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

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>, mount: MountPoint) => {
    const live = dragRef.current;
    if (!live || live.pointerId !== event.pointerId) return;
    const dx = event.clientX - live.startX;
    const dy = event.clientY - live.startY;
    if (!live.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
    const local = screenToLocal(frame, dx / scale, dy / scale);
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

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const live = dragRef.current;
    if (!live || live.pointerId !== event.pointerId) return;
    setDrag(null);
    onDragIssue(null);
    // An illegal drop is sent too: the store refuses it, leaves the part where it was and
    // names the reason, so a drag never ends in silence.
    if (!cancelled && live.moved) onMove(live.instanceId, live.offsetX, live.offsetY);
  };

  // A build that locks mid-drag puts the part back where it last legally was.
  useEffect(() => {
    if (locked && dragRef.current) {
      setDrag(null);
      onDragIssue(null);
    }
  }, [locked, onDragIssue]);

  const onPartKey = (event: ReactKeyboardEvent, instanceId: string | null) => {
    if (event.key === 'Escape') {
      onClearSelection();
      return;
    }
    if (!instanceId || locked) return;
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
      if (selectedInstanceId !== instanceId) onSelectInstance(instanceId);
      onNudge(instanceId, step[0]!, step[1]!);
    } else if (event.key === 'r' || event.key === 'R') {
      event.preventDefault();
      onRotate(instanceId);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      onRemove(instanceId);
    }
  };

  const mountTile = (mount: MountPoint, style?: { left: number; top: number }) => {
    const holding = occupants(mount.id);
    const face = holding.find((p) => p.instance.instanceId === selectedInstanceId) ?? holding[0];
    const bad = holding.some((p) => flagged.includes(p.instance.instanceId));
    const moving = holding.some((p) => p.instance.instanceId === badDrag);
    const step = marks.weapon?.mountId === mount.id ? marks.weapon : undefined;
    return (
      <SlotTile
        key={mount.id}
        manifests={manifests}
        slotKey={`mount:${mount.id}`}
        label={mountShort(mount.id)}
        ariaLabel={
          face
            ? fill(g.mountWith, { part: face.def.displayName, mount: mountName(mount.id) })
            : fill(g.emptyMount, { mount: mountName(mount.id) })
        }
        part={face ? { id: face.def.id, category: face.def.category } : null}
        glyph={mountGlyph(mount, frame)}
        count={holding.length}
        instanceId={face?.instance.instanceId ?? null}
        mountId={mount.id}
        selected={slotMount === mount.id}
        bad={bad || moving}
        target={target?.mountId === mount.id}
        step={step}
        disabled={locked}
        style={
          style
            ? { ...style, width: layout.tileW, height: layout.tileH }
            : { width: 54, height: 48 }
        }
        onPress={() => onSlot({ kind: 'mount', mountId: mount.id })}
        onKeyDown={(event) => onPartKey(event, face?.instance.instanceId ?? null)}
      />
    );
  };

  const essentialTile = (kind: Essential) => {
    const id =
      kind === 'chassis'
        ? blueprint.chassisId
        : kind === 'engine'
          ? blueprint.engineId
          : blueprint.tireKitId;
    const def =
      kind === 'chassis'
        ? own(CATALOG.chassis, id)
        : kind === 'engine'
          ? own(CATALOG.engines, id)
          : own(CATALOG.tires, id);
    const name = def?.displayName ?? '';
    return (
      <SlotTile
        key={kind}
        manifests={manifests}
        slotKey={kind}
        label={g.categories[kind]}
        name={name}
        ariaLabel={fill(g.slotOf, { slot: g.categories[kind], part: name })}
        part={{ id, category: kind }}
        glyph={kind}
        selected={slot?.kind === kind}
        bad={flaggedEssentials.has(kind)}
        step={kind === 'chassis' ? marks.chassis : kind === 'tires' ? marks.tires : undefined}
        disabled={locked}
        onPress={() => onSlot({ kind })}
        onKeyDown={(event) => onPartKey(event, null)}
      />
    );
  };

  const tileById = new Map(layout.tiles.map((tile) => [tile.id, tile]));
  const mountById = new Map(mounts.map((mount) => [mount.id, mount]));
  // Car order for the portrait row: nose to tail, left before right.
  const inCarOrder = [...mounts].sort((a, b) => a.y - b.y || a.x - b.x);
  const column = (side: 'left' | 'right') =>
    layout.tiles
      .filter((tile) => tile.side === side)
      .map((tile) => mountById.get(tile.id))
      .filter((mount): mount is MountPoint => mount !== undefined);

  return (
    <section
      className={`g-bench${row ? ' is-row' : ''}`}
      aria-label={g.slots}
      data-view={frame}
      data-scale={scale}
    >
      <div
        className="g-floor"
        ref={host}
        data-scroll={layout.scroll ? 'true' : undefined}
        style={
          {
            '--col-left': `${layout.reserved.left}px`,
            '--col-right': `${layout.reserved.right}px`,
          } as CSSProperties
        }
      >
        <div
          className="g-car"
          style={{
            left: layout.car.x - px / 2,
            top: layout.car.y - px / 2,
            width: px,
            height: px,
            visibility: ready ? 'visible' : 'hidden',
          }}
        >
          <CarCanvas
            manifests={manifests}
            blueprint={shown}
            scale={scale}
            frame={frame}
            highlight={highlight}
          />
          {sockets.length > 0 && (
            <svg className="g-car-lines" width={px} height={px} aria-hidden="true">
              {sockets.map((socket) => (
                <polygon
                  key={socket.id}
                  className={`socket is-${socket.tone}`}
                  points={socket.points}
                />
              ))}
            </svg>
          )}
          {grab && selectedPart && !locked && (
            <div
              className={`g-grab${dragged ? ' is-dragging' : ''}`}
              style={{ left: grab.left, top: grab.top, width: grab.size, height: grab.size }}
              aria-hidden="true"
              data-testid="part-grab"
              onPointerDown={(event) => beginDrag(event, selectedPart)}
              onPointerMove={(event) => moveDrag(event, selectedPart.mount)}
              onPointerUp={(event) => endDrag(event, false)}
              onPointerCancel={(event) => endDrag(event, true)}
            />
          )}
          {grab && dragged?.issue && (
            <span
              className="g-drag-tag"
              style={{ left: grab.left, top: grab.top - grab.size / 2 - 2 }}
              aria-hidden="true"
            >
              {issueText(dragged.issue)}
            </span>
          )}
        </div>
        {!row && !layout.scroll && ready && (
          <svg
            className="g-leaders"
            width={room.width}
            height={room.height}
            aria-hidden="true"
            shapeRendering="crispEdges"
          >
            {layout.tiles.map((tile) => {
              const end = tile.leader[tile.leader.length - 1];
              const holding = occupants(tile.id);
              const tone =
                slotMount === tile.id
                  ? ' is-selected'
                  : holding.some((p) => flagged.includes(p.instance.instanceId))
                    ? ' is-bad'
                    : target?.mountId === tile.id
                      ? ' is-target'
                      : '';
              return (
                <g key={tile.id} className={`leader${tone}`} data-mount={tile.id}>
                  <polyline points={tile.leader.map((p) => `${p.x},${p.y}`).join(' ')} />
                  {end && <rect x={end.x - 2} y={end.y - 2} width={4} height={4} />}
                </g>
              );
            })}
          </svg>
        )}
        {!row &&
          !layout.scroll &&
          mounts.map((mount) => {
            const tile = tileById.get(mount.id);
            return tile ? mountTile(mount, { left: tile.x, top: tile.y }) : null;
          })}
        {!row &&
          layout.scroll &&
          (['left', 'right'] as const).map((side) => (
            <div key={side} className={`g-column is-${side}`} style={{ width: layout.tileW }}>
              {column(side).map((mount) => mountTile(mount, { left: 0, top: 0 }))}
            </div>
          ))}
        {children}
      </div>
      <div className="g-slot-row">
        {row && inCarOrder.map((mount) => mountTile(mount))}
        {ESSENTIALS.map(essentialTile)}
      </div>
      <div className="g-bench-tools">
        <button
          type="button"
          className={`slot-tile is-tool${idle ? ' is-selected' : ''}`}
          aria-pressed={idle}
          aria-label={g.carStats}
          title={g.carStats}
          data-testid="car-stats"
          onClick={onShowCar}
        >
          <span className="slot-art">
            <Glyph name="stats" size={24} />
          </span>
          <span className="slot-text">
            <span className="slot-label">{g.stats}</span>
          </span>
        </button>
        <button
          type="button"
          className="slot-tile is-tool"
          onClick={() => setViewIndex((v) => (v + 1) % VIEW_FRAMES.length)}
          aria-label={g.rotateView}
          title={g.rotateView}
        >
          <span className="slot-art">
            <Glyph name="rotate" size={24} />
          </span>
          <span className="slot-text">
            <span className="slot-label">{g.view}</span>
          </span>
        </button>
      </div>
    </section>
  );
}
