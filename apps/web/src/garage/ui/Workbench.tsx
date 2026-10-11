import { CATALOG, STRINGS } from '@bolt/content';
import type { BlueprintIssue, MountPoint, PlacedPart, VehicleBlueprint } from '@bolt/shared';
import { accessoryMounts, clamp, installedParts, own, resolveBlueprint } from '@bolt/shared';
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import type { BenchLayout } from '../benchLayout.js';
import { layoutBench, layoutFocus } from '../benchLayout.js';
import type { Slot } from '../buildSession.js';
import { issueText, tryMove } from '../buildSession.js';
import { VIEW_FRAMES, carBounds, focusTarget, projectMounts } from '../carGeometry.js';
import type { CoverageFit } from '../coverage.js';
import { buildCoverage, coverageOrigin, coveragePaths, fitCoverage } from '../coverage.js';
import { fill, mountName, mountShort } from '../text.js';
import type { StepMark } from './SlotTile.js';
import { SlotTile } from './SlotTile.js';

const HEADINGS = 64;
/** A press that travels less than this many CSS pixels is a tap, not a drag. */
const DRAG_SLOP = 6;
/** How long the view takes to move between the overview and a slot, in milliseconds. */
const CAMERA_MS = 150;
/** Chassis-local unit vectors for the four orientations: forward, right, back, left. */
const FACING: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

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
  /** Portrait: the mount tiles run in a row under the car, without leader lines. */
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
 * tilted view. With nothing selected it is shown whole, at the largest whole-number scale
 * that fits, and every accessory mount of the chassis is a tile beside it, joined to the
 * mount's true position by a leader line; the chassis, engine and wheels are three tiles
 * under it. Selecting a mount or the engine moves the view in on it (focus): the car is drawn
 * one or two whole steps larger and panned so that slot is in the middle of the floor, the
 * other tiles stay at the edges for switching, and `Whole Car`, Escape or a tap on the bare
 * floor goes back. The selected part is picked out by an outline traced around its own sprite,
 * with a chevron for the way it faces and a thin box for the room it has to move in.
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

  // What the view moves in on: the selected mount, or the engine. Anything else is the
  // overview of the whole car.
  const focusId = slot?.kind === 'mount' ? slot.mountId : slot?.kind === 'engine' ? 'engine' : null;
  const layout = useMemo((): BenchLayout => {
    const bounds =
      chassis && sprite
        ? carBounds(chassis, sprite, frame, ready ? measuredBounds(chassisId, frame) : undefined)
        : { left: -36, top: -36, right: 36, bottom: 36 };
    const input = {
      width: room.width,
      height: room.height,
      mounts: chassis && sprite ? projectMounts(chassis, sprite, frame) : [],
      bounds,
      columns: !row,
    };
    const target =
      chassis && sprite && focusId ? focusTarget(chassis, sprite, frame, focusId) : null;
    return target ? layoutFocus({ ...input, target }) : layoutBench(input);
  }, [chassis, sprite, chassisId, frame, ready, room, row, focusId]);
  const { scale } = layout;
  const focused = layout.focus !== null;

  // The move between the overview and a slot: the scale switches at once, in whole steps, and
  // the pan eases over a moment from where the slot was to where it now is. Nothing is ever
  // drawn at a scale in between, and nothing moves under Reduced Motion.
  const carNode = useRef<HTMLDivElement>(null);
  const coverNode = useRef<SVGGElement>(null);
  const ghostNode = useRef<SVGGElement>(null);
  const leaderNode = useRef<SVGSVGElement>(null);
  const camera = useRef<{
    key: string;
    x: number;
    y: number;
    scale: number;
    pivot: { dx: number; dy: number } | null;
  } | null>(null);
  useLayoutEffect(() => {
    const key = `${chassisId}:${frame}:${room.width}x${room.height}:${row}:${ready}`;
    const pivot = layout.focus
      ? {
          dx: (layout.focus.anchor.x - layout.car.x) / scale,
          dy: (layout.focus.anchor.y - layout.car.y) / scale,
        }
      : null;
    const before = camera.current;
    camera.current = { key, x: layout.car.x, y: layout.car.y, scale, pivot };
    if (!before || before.key !== key || !ready || prefersReducedMotion()) return;
    // The point that holds still at the moment the scale switches: the slot being moved in
    // on, or the one being left.
    const hold = pivot ?? before.pivot;
    if (!hold) return;
    const fromX = before.x + hold.dx * before.scale - (layout.car.x + hold.dx * scale);
    const fromY = before.y + hold.dy * before.scale - (layout.car.y + hold.dy * scale);
    if (fromX === 0 && fromY === 0) return;
    const timing = { duration: CAMERA_MS, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' };
    const pan = [
      { transform: `translate(${fromX}px, ${fromY}px)` },
      { transform: 'translate(0, 0)' },
    ];
    carNode.current?.animate?.(pan, timing);
    // The floor's drawing of what the weapon covers moves with the car it is under.
    coverNode.current?.animate?.(pan, timing);
    ghostNode.current?.animate?.(pan, timing);
    leaderNode.current?.animate?.([{ opacity: 0 }, { opacity: 0 }, { opacity: 1 }], timing);
  }, [layout, scale, chassisId, frame, room, row, ready]);
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
    const wanted: Array<{
      id: string;
      mount: MountPoint;
      tone: 'select' | 'target' | 'bad' | 'room';
    }> = [];
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
    // The room a selected part has: its mount's box, drawn thin, so a nudge reads against it.
    if (selectedPart && !wanted.some((w) => w.mount.id === selectedPart.mount.id))
      wanted.push({ id: `room:${selectedPart.mount.id}`, mount: selectedPart.mount, tone: 'room' });
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
  }, [sprite, mounts, parts, slotMount, target, flagged, frame, frameSize, scale, selectedPart]);

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

  // Which way the selected part faces: a short arrow on the line from its middle along its
  // facing, starting just past the far end of the drawing so it never covers the part, and
  // lying on the bodywork under it. It is projected like the part, so it turns with the view
  // and always agrees with the direction picker.
  const facing = useMemo(() => {
    if (!sprite || !selectedPart) return null;
    const { def, instance, mount } = selectedPart;
    if (def.facing === 'none') return null;
    const live = dragged?.instanceId === instance.instanceId ? dragged : null;
    const cx = live ? mount.x + live.offsetX : selectedPart.x;
    const cy = live ? mount.y + live.offsetY : selectedPart.y;
    const [fx, fy] = FACING[instance.rotationQuarterTurns] ?? FACING[0]!;
    // How far the drawing reaches forward: to its muzzle where it has one.
    const muzzles = manifests.cars.parts?.[def.id]?.muzzles ?? [];
    const reach = Math.max(def.footprint.h * 0.58, ...muzzles.map((m) => -m.y));
    const tail = reach + 3;
    const tip = tail + 8;
    const z = mountHeight(sprite, mount.id);
    const at = projectPoints(sprite, frame, [
      { id: 'tail', x: cx + fx * tail, y: cy + fy * tail, z },
      { id: 'tip', x: cx + fx * tip, y: cy + fy * tip, z },
      { id: 'l', x: cx + fx * (tip - 4) - fy * 3.5, y: cy + fy * (tip - 4) + fx * 3.5, z },
      { id: 'r', x: cx + fx * (tip - 4) + fy * 3.5, y: cy + fy * (tip - 4) - fx * 3.5, z },
    ]);
    const xy = (id: string) => {
      const p = at.get(id);
      return `${(frameSize / 2 + (p?.dx ?? 0)) * scale},${(frameSize / 2 + (p?.dy ?? 0)) * scale}`;
    };
    return { shaft: `${xy('tail')} ${xy('tip')}`, head: `${xy('l')} ${xy('tip')} ${xy('r')}` };
  }, [sprite, selectedPart, dragged, frame, frameSize, scale, manifests]);

  // What the selected weapon covers, drawn on the floor under the car: its arc and its range
  // from the numbers the race itself uses, turned with the part and with the view. It follows
  // a nudge, a drag and a change of facing as they happen.
  const coverage = useMemo(() => {
    if (!sprite || !selectedPart || selectedPart.def.category !== 'weapon') return null;
    const build = resolveBlueprint(shown, CATALOG);
    const index =
      build?.parts.findIndex((p) => p.instance.instanceId === selectedPart.instance.instanceId) ??
      -1;
    if (!build || index < 0) return null;
    let found;
    try {
      found = buildCoverage(build)[index] ?? null;
    } catch {
      return null;
    }
    if (!found) return null;
    // The room the floor has for it, from the weapon along its line of fire and between the
    // columns of tiles: a cone that would leave the floor is shortened until its end shows.
    // It is drawn at the height of the weapon's own mount, not at the wheels: the camera is
    // tilted, so a shape on the ground would start below the muzzle it comes from. On the
    // ground or at the muzzle the shape is the same; only where it starts differs.
    const z = mountHeight(sprite, selectedPart.mount.id);
    const fit: CoverageFit = {};
    const origin = coverageOrigin(found);
    if (origin) {
      const probe = projectPoints(sprite, frame, [
        { id: 'o', x: origin.x, y: origin.y, z },
        {
          id: 'a',
          x: origin.x + Math.sin(origin.heading) * 20,
          y: origin.y - Math.cos(origin.heading) * 20,
          z,
        },
      ]);
      const o = probe.get('o');
      const a = probe.get('a');
      const ox = layout.car.x + (o?.dx ?? 0) * scale;
      const oy = layout.car.y + (o?.dy ?? 0) * scale;
      const left = layout.reserved.left + 6;
      const right = room.width - layout.reserved.right - 6;
      const top = 6;
      const bottom = room.height - 6;
      let reach = Infinity;
      if (origin.round) reach = Math.min(ox - left, right - ox, oy - top, bottom - oy);
      else {
        const dx = (a?.dx ?? 0) - (o?.dx ?? 0);
        const dy = (a?.dy ?? 0) - (o?.dy ?? 0);
        const length = Math.hypot(dx, dy) || 1;
        const ux = dx / length;
        const uy = dy / length;
        if (ux > 1e-6) reach = Math.min(reach, (right - ox) / ux);
        else if (ux < -1e-6) reach = Math.min(reach, (left - ox) / ux);
        if (uy > 1e-6) reach = Math.min(reach, (bottom - oy) / uy);
        else if (uy < -1e-6) reach = Math.min(reach, (top - oy) / uy);
      }
      if (Number.isFinite(reach)) fit.limit = Math.max(0, reach) / scale;
    }
    const paths = coveragePaths(fitCoverage(found, fit), fit);
    const points: LocalPoint[] = [];
    paths.forEach((path, i) => {
      path.points.forEach((p, j) => points.push({ id: `${i}:${j}`, x: p.x, y: p.y, z }));
      path.hole?.forEach((p, j) => points.push({ id: `${i}h${j}`, x: p.x, y: p.y, z }));
    });
    const at = projectPoints(sprite, frame, points);
    const xy = (id: string) => {
      const p = at.get(id);
      return `${layout.car.x + (p?.dx ?? 0) * scale} ${layout.car.y + (p?.dy ?? 0) * scale}`;
    };
    return {
      kind: found.kind,
      turn: found.turn,
      range: found.range,
      paths: paths.map((path, i) => {
        let d = `M${path.points.map((_, j) => xy(`${i}:${j}`)).join('L')}${path.closed ? 'Z' : ''}`;
        if (path.hole) d += `M${path.hole.map((_, j) => xy(`${i}h${j}`)).join('L')}Z`;
        return { d, role: path.role };
      }),
    };
  }, [sprite, selectedPart, shown, frame, scale, room, layout]);

  // The engine has no outline of its own to trace: in focus it is boxed like an empty socket.
  const engineBox =
    layout.focus?.id === 'engine'
      ? {
          x: layout.focus.part.left - (layout.car.x - px / 2),
          y: layout.focus.part.top - (layout.car.y - px / 2),
          w: layout.focus.part.right - layout.focus.part.left,
          h: layout.focus.part.bottom - layout.focus.part.top,
        }
      : null;

  // In focus the rest of the car steps back: everything but the selected thing is drawn a
  // little darker. The engine keeps the engine bright; an empty mount dims the whole car
  // under its dashed socket. A red or green outline is a question about another part, and
  // nothing is dimmed while one is up.
  const dim =
    !focused || (highlight && highlight.tone !== 'select')
      ? null
      : layout.focus?.id === 'engine'
        ? ({ engine: true } as const)
        : highlight
          ? { part: highlight.instanceId }
          : ('all' as const);

  // A tap on the bare floor, beside the car, goes back to the whole car.
  const onFloor = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || !slot) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const box = layout.carBox;
    if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return;
    onClearSelection();
  };

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
        style={style ? { ...style, width: layout.tileW, height: layout.tileH } : undefined}
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
  // Car order for the portrait row: nose to tail, left before right.
  const inCarOrder = [...mounts].sort((a, b) => a.y - b.y || a.x - b.x);
  // Portrait: every mount in one row while each tile keeps 44 pixels, otherwise two rows.
  const rowColumns =
    mounts.length > 0 && (room.width + 52 - (mounts.length - 1) * 4) / mounts.length < 44
      ? Math.ceil(mounts.length / 2)
      : Math.max(1, mounts.length);

  return (
    <section
      className={`g-bench${row ? ' is-row' : ''}${focused ? ' is-focus' : ''}`}
      aria-label={g.slots}
      data-view={frame}
      data-scale={scale}
      data-focus={layout.focus?.id}
    >
      <div
        className="g-floor"
        ref={host}
        onClick={onFloor}
        data-car-box={[
          layout.carBox.left,
          layout.carBox.top,
          layout.carBox.right,
          layout.carBox.bottom,
        ]
          .map((v) => Math.round(v))
          .join(',')}
        data-anchor={
          layout.focus
            ? `${Math.round(layout.focus.anchor.x)},${Math.round(layout.focus.anchor.y)}`
            : undefined
        }
        style={
          {
            '--col-left': `${layout.reserved.left}px`,
            '--col-right': `${layout.reserved.right}px`,
          } as CSSProperties
        }
      >
        {coverage && ready && (
          <svg
            className={`g-coverage is-${coverage.kind}`}
            width={room.width}
            height={room.height}
            aria-hidden="true"
            data-testid="part-coverage"
            data-kind={coverage.kind}
            data-facing={coverage.turn}
            data-range={coverage.range}
          >
            <defs>
              <pattern
                id="g-drop-hatch"
                width="8"
                height="8"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <rect width="4" height="8" fill="rgba(255, 180, 84, 0.34)" />
              </pattern>
            </defs>
            <g ref={coverNode}>
              {coverage.paths.map((path, index) => (
                <g key={index} className={`coverage-${path.role}`}>
                  <path className="coverage-edge" d={path.d} />
                  <path className="coverage-fill" d={path.d} />
                </g>
              ))}
            </g>
          </svg>
        )}
        <div
          className="g-car"
          ref={carNode}
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
            dim={dim}
          />
          {(sockets.length > 0 || facing || engineBox) && (
            <svg className="g-car-lines" width={px} height={px} aria-hidden="true">
              {sockets.map((socket) => (
                <polygon
                  key={socket.id}
                  className={`socket is-${socket.tone}`}
                  points={socket.points}
                />
              ))}
              {engineBox && (
                <rect
                  className="socket is-select"
                  data-testid="engine-socket"
                  x={engineBox.x}
                  y={engineBox.y}
                  width={engineBox.w}
                  height={engineBox.h}
                />
              )}
              {facing && (
                <g
                  className={`facing${coverage ? ' is-minor' : ''}`}
                  data-testid="part-facing-mark"
                  data-facing={selectedPart?.instance.rotationQuarterTurns}
                >
                  <polyline className="facing-edge" points={facing.shaft} />
                  <polyline className="facing-edge" points={facing.head} />
                  <polyline className="facing-line facing-shaft" points={facing.shaft} />
                  <polyline className="facing-line facing-head" points={facing.head} />
                </g>
              )}
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
        {coverage && ready && focused && (
          // In focus the car fills the floor and hides most of what is drawn under it, so the
          // same outline is laid faintly over the dimmed bodywork as well.
          <svg
            className={`g-coverage is-ghost is-${coverage.kind}`}
            width={room.width}
            height={room.height}
            aria-hidden="true"
          >
            <g ref={ghostNode}>
              {coverage.paths.map((path, index) => (
                <g key={index} className={`coverage-${path.role}`}>
                  <path className="coverage-fill" d={path.d} />
                </g>
              ))}
            </g>
          </svg>
        )}
        {!row && ready && (
          <svg
            className="g-leaders"
            ref={leaderNode}
            width={room.width}
            height={room.height}
            aria-hidden="true"
            shapeRendering="crispEdges"
          >
            {layout.tiles
              .filter((tile) => tile.leader.length > 0)
              .map((tile) => {
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
          mounts.map((mount) => {
            const tile = tileById.get(mount.id);
            return tile ? mountTile(mount, { left: tile.x, top: tile.y }) : null;
          })}
      </div>
      {row && mounts.length > 0 && (
        <div
          className="g-mount-row"
          style={{ gridTemplateColumns: `repeat(${rowColumns}, minmax(0, 1fr))` }}
        >
          {inCarOrder.map((mount) => mountTile(mount))}
        </div>
      )}
      <div className="g-slot-row">{ESSENTIALS.map(essentialTile)}</div>
      <div className="g-bench-tools">
        <button
          type="button"
          className={`slot-tile is-tool${idle ? ' is-selected' : ' is-back'}`}
          aria-pressed={idle}
          aria-label={idle ? g.carStats : g.wholeCar}
          title={idle ? g.carStats : g.wholeCar}
          data-testid="car-stats"
          onClick={onShowCar}
        >
          <span className="slot-art">
            <Glyph name={idle ? 'stats' : 'chassis'} size={24} />
          </span>
          <span className="slot-text">
            <span className="slot-label">{idle ? g.stats : g.wholeCar}</span>
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
