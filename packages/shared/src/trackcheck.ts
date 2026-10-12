import { CORNER_SIGNS, SHORTCUT_MIN_GATES, SHORTCUT_MIN_GATES_WALLED, SIM_DT } from './balance.js';
import { headingForwardX, headingForwardY, segmentIntersection } from './math.js';
import type { TrackBranch, TrackRuntime } from './track.js';
import {
  createLocation,
  createProgress,
  lapPosition,
  locate,
  obstacleDepth,
  sampleBranch,
  updateProgress,
  wallDepth,
} from './track.js';
import { segmentDistance, shapeOutline } from './trackShapes.js';
import { referenceSpeeds } from './trackSigns.js';
import type { SurfaceId, TrackDefinition, TrackPoint } from './types.js';
import { SURFACE_IDS } from './types.js';

/**
 * The track validator (docs/TRACK_API.md, "Rules"). Every rule a shipped track must pass, as a
 * pure function of its runtime, so the unit tests, the command line tool and an art bake can
 * all run it. Rules that need the simulator (lap times, the corner signs' lead time with the
 * real default car) are in the tests and `tests/tools/trackcheck.ts --drive`.
 */

export type TrackRule =
  | 'closed_loop'
  | 'no_self_intersection'
  | 'width_bounds'
  | 'world_margin'
  | 'checkpoints'
  | 'shortcuts'
  | 'spawn_grid'
  | 'surface_mix'
  | 'corner_signs'
  | 'offroad_return'
  | 'racing_line_clear'
  | 'hazards'
  | 'camera_bounds'
  | 'weather'
  | 'anchors';

export const TRACK_RULES: readonly TrackRule[] = [
  'closed_loop',
  'no_self_intersection',
  'width_bounds',
  'world_margin',
  'checkpoints',
  'shortcuts',
  'spawn_grid',
  'surface_mix',
  'corner_signs',
  'offroad_return',
  'racing_line_clear',
  'hazards',
  'camera_bounds',
  'weather',
  'anchors',
];

export type TrackIssue = { rule: TrackRule; message: string };

export type TrackCheck = {
  ok: boolean;
  issues: TrackIssue[];
  /** Which rules ran and passed. */
  passed: TrackRule[];
  stats: {
    lapLength: number;
    /** Share of the main centerline on each surface, zones included. */
    surfaceShare: Partial<Record<SurfaceId, number>>;
    checkpoints: number;
    shortcutGates: Record<string, number>;
    /** Shortcut length over the main-line distance it bypasses. */
    shortcutRatio: Record<string, number>;
    cornerSigns: number;
    sharpBends: number;
    /** Open tracks: cells a car fits in that it can reach from the road, and pockets of ground
     * a car fits in but cannot reach (behind gaps narrower than a car). */
    offroadCells: number;
    strandedCells: number;
  };
};

/** Bounds a shipped track is held to. */
export const TRACK_LIMITS = {
  mainWidth: [100, 240] as const,
  shortcutWidth: [60, 170] as const,
  /** Two parts of the road must keep this much solid between their shoulders (walled). */
  walledGap: 24,
  /** And this much ground between them on an open track. */
  openGap: 16,
  /** Distance of every centerline from the world's edge. */
  worldMargin: 300,
  surfaceTolerance: 0.05,
  /** Clearance of spawns from anything solid or hazardous. */
  spawnClear: 40,
  /** A car's body radius, for the return-path flood fill. */
  carRadius: 17,
  /** A sharp bend by curvature alone: tighter than this radius through this much turn. */
  bendRadius: 160,
  bendTurnDeg: 45,
  /** How close before an intruding obstacle its telegraph anchor must be. */
  telegraphReach: 400,
};

function pointRect(p: TrackPoint, r: { x: number; y: number; w: number; h: number }, pad = 0) {
  return p.x >= r.x - pad && p.y >= r.y - pad && p.x <= r.x + r.w + pad && p.y <= r.y + r.h + pad;
}

function arcGap(b: TrackBranch, sa: number, sb: number): number {
  const d = Math.abs(sa - sb);
  return b.closed ? Math.min(d, b.length - d) : d;
}

/** Walks a branch's centerline from `from` to `to` (arc lengths), feeding checkpoint logic. */
function walkBranch(
  track: TrackRuntime,
  progress: ReturnType<typeof createProgress>,
  branch: TrackBranch,
  from: number,
  to: number,
  clock: { ms: number },
  events: string[],
): void {
  const loc = createLocation();
  let prev = sampleBranch(branch, from);
  for (let s = from + 6; s <= to; s += 6) {
    const p = sampleBranch(branch, s);
    locate(track, p.x, p.y, loc);
    clock.ms += 33;
    const e = updateProgress(
      track,
      progress,
      prev.x,
      prev.y,
      p.x,
      p.y,
      Math.atan2(p.tx, -p.ty),
      200,
      loc,
      clock.ms,
      SIM_DT,
    );
    if (e !== 'none') events.push(e);
    prev = p;
  }
}

export function checkTrack(track: TrackRuntime): TrackCheck {
  const def: TrackDefinition = track.def;
  const issues: TrackIssue[] = [];
  const failed = new Set<TrackRule>();
  const fail = (rule: TrackRule, message: string) => {
    failed.add(rule);
    if (issues.filter((i) => i.rule === rule).length < 6) issues.push({ rule, message });
  };
  const main = track.main;
  const W = def.worldWidth;
  const H = def.worldHeight;

  // --- closed loop ---------------------------------------------------------------------------
  if (!def.main.closed) fail('closed_loop', 'the main line is not closed');
  if (def.main.points.length < 4) fail('closed_loop', 'the main line has fewer than four points');
  {
    const first = sampleBranch(main, 0);
    const last = sampleBranch(main, main.length - 1e-6);
    if (Math.hypot(first.x - last.x, first.y - last.y) > 12)
      fail('closed_loop', 'the main line does not close on itself');
    const st = sampleBranch(main, track.startS);
    if (Math.hypot(st.x - def.startNear.x, st.y - def.startNear.y) > 80)
      fail('closed_loop', 'the start line is more than 80 px from where it was authored');
  }

  // --- no self-intersection: centerlines, and corridors that touch -------------------------
  {
    const reach = (b: TrackBranch, i: number) => b.halfWidth[i]! + b.shoulder[i]!;
    const gap = track.walled ? TRACK_LIMITS.walledGap : TRACK_LIMITS.openGap;
    // Bucket every sample of every branch on a coarse grid.
    const cell = 128;
    const cols = Math.ceil(W / cell) + 1;
    const buckets = new Map<number, Array<[number, number]>>();
    for (const b of track.branches)
      for (let i = 0; i < b.count; i++) {
        const key = Math.floor(b.y[i]! / cell) * cols + Math.floor(b.x[i]! / cell);
        let list = buckets.get(key);
        if (!list) buckets.set(key, (list = []));
        list.push([b.index, i]);
      }
    const nearEnd = (b: TrackBranch, i: number) =>
      b.index > 0 && (b.s[i]! < 260 || b.s[i]! > b.length - 260);
    const nearJunction = (b: TrackBranch, i: number) => {
      // A main sample within the reach of a shortcut's ends.
      if (b.index !== 0) return false;
      for (const sc of track.branches.slice(1)) {
        if (arcGap(main, b.s[i]!, sc.leaveS) < 260 || arcGap(main, b.s[i]!, sc.rejoinS) < 260)
          return true;
      }
      return false;
    };
    let reported = 0;
    for (const b of track.branches)
      for (let i = 0; i < b.count && reported < 6; i++) {
        const cx = Math.floor(b.x[i]! / cell);
        const cy = Math.floor(b.y[i]! / cell);
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++) {
            for (const [bi, j] of buckets.get((cy + dy) * cols + cx + dx) ?? []) {
              const o = track.branches[bi]!;
              if (o.index < b.index || (o.index === b.index && j <= i)) continue;
              if (o.index === b.index) {
                const need = (reach(b, i) + reach(o, j)) * 2.2 + 80;
                if (arcGap(b, b.s[i]!, o.s[j]!) < need) continue;
              } else if (
                nearEnd(b, i) ||
                nearEnd(o, j) ||
                nearJunction(b, i) ||
                nearJunction(o, j)
              ) {
                continue;
              }
              const d = Math.hypot(b.x[i]! - o.x[j]!, b.y[i]! - o.y[j]!);
              if (d < reach(b, i) + reach(o, j) + gap) {
                fail(
                  'no_self_intersection',
                  `${b.id} at ${Math.round(b.s[i]!)} px comes within ${Math.round(d)} px of ${o.id} at ${Math.round(o.s[j]!)} px`,
                );
                reported++;
              }
            }
          }
      }
    // Centerlines that cross.
    const links = main.count;
    for (let i = 0; i < links; i++) {
      const i2 = (i + 1) % main.count;
      for (let j = i + 2; j < links; j++) {
        if (i === 0 && j === links - 1) continue;
        const j2 = (j + 1) % main.count;
        if (
          segmentIntersection(
            main.x[i]!,
            main.y[i]!,
            main.x[i2]!,
            main.y[i2]!,
            main.x[j]!,
            main.y[j]!,
            main.x[j2]!,
            main.y[j2]!,
          ) >= 0
        ) {
          fail(
            'no_self_intersection',
            `the main line crosses itself at ${Math.round(main.s[i]!)} px`,
          );
          j = links;
          i = links;
        }
      }
    }
  }

  // --- width bounds and world margin ---------------------------------------------------------
  for (const b of track.branches) {
    const [lo, hi] = b.index === 0 ? TRACK_LIMITS.mainWidth : TRACK_LIMITS.shortcutWidth;
    for (let i = 0; i < b.count; i++) {
      const w = b.halfWidth[i]! * 2;
      if (w < lo - 0.5 || w > hi + 0.5) {
        fail(
          'width_bounds',
          `${b.id} is ${Math.round(w)} px wide at ${Math.round(b.s[i]!)} px (${lo} to ${hi})`,
        );
        break;
      }
    }
    for (let i = 0; i < b.count; i++) {
      const m = TRACK_LIMITS.worldMargin;
      if (b.x[i]! < m || b.y[i]! < m || b.x[i]! > W - m || b.y[i]! > H - m) {
        fail('world_margin', `${b.id} passes within ${m} px of the world's edge`);
        break;
      }
    }
  }

  // --- checkpoints ----------------------------------------------------------------------------
  const cps = track.checkpoints;
  if (cps.length < 4) fail('checkpoints', 'fewer than four checkpoints');
  if (cps[0]?.lapS !== 0) fail('checkpoints', 'checkpoint 0 is not on the start line');
  for (let k = 1; k < cps.length; k++)
    if (!(cps[k]!.lapS > cps[k - 1]!.lapS)) fail('checkpoints', `checkpoint ${k} is out of order`);
  for (const cp of cps)
    for (const g of cp.gates) {
      const b = track.branches[g.branch]!;
      // The gate must cross its own branch's centerline.
      let crosses = false;
      const links = b.closed ? b.count : b.count - 1;
      for (let i = 0; i < links && !crosses; i++) {
        const j = (i + 1) % b.count;
        if (segmentIntersection(g.ax, g.ay, g.bx, g.by, b.x[i]!, b.y[i]!, b.x[j]!, b.y[j]!) >= 0)
          crosses = true;
      }
      if (!crosses) fail('checkpoints', `a gate of checkpoint ${cp.index} does not cross ${b.id}`);
    }
  {
    const progress = createProgress();
    const events: string[] = [];
    walkBranch(
      track,
      progress,
      main,
      track.startS - 40,
      track.startS - 40 + track.lapLength * def.laps + 80,
      { ms: 0 },
      events,
    );
    if (progress.finishedAtMs === null)
      fail(
        'checkpoints',
        `driving the main line does not finish (${progress.lap} laps, checkpoint ${progress.checkpointIndex})`,
      );
  }

  // --- shortcuts ------------------------------------------------------------------------------
  const shortcutGates: Record<string, number> = {};
  const shortcutRatio: Record<string, number> = {};
  if (def.shortcuts.length < 1)
    fail('shortcuts', 'a track needs at least one shortcut (Section 12.10)');
  for (const sc of track.branches.slice(1)) {
    const scDef = def.shortcuts[sc.index - 1]!;
    const span = (((sc.rejoinS - sc.leaveS) % track.lapLength) + track.lapLength) % track.lapLength;
    if (span <= 0 || span > track.lapLength / 2)
      fail('shortcuts', `${sc.id} rejoins ${Math.round(span)} px after it leaves`);
    shortcutRatio[sc.id] = Math.round((sc.length / Math.max(1, span)) * 100) / 100;
    const gates = cps.filter((cp) => cp.gates.some((g) => g.branch === sc.index)).length;
    shortcutGates[sc.id] = gates;
    const need = scDef.gates ?? (track.walled ? SHORTCUT_MIN_GATES_WALLED : SHORTCUT_MIN_GATES);
    if (gates < need) fail('shortcuts', `${sc.id} has ${gates} checkpoint gates, needs ${need}`);
    const first = scDef.points[0];
    const last = scDef.points[scDef.points.length - 1];
    const leave = sampleBranch(main, sc.leaveS);
    const rejoin = sampleBranch(main, sc.rejoinS);
    if (first && Math.hypot(first.x - leave.x, first.y - leave.y) > 360)
      fail(
        'shortcuts',
        `${sc.id} starts ${Math.round(Math.hypot(first.x - leave.x, first.y - leave.y))} px from where it leaves the main line`,
      );
    if (last && Math.hypot(last.x - rejoin.x, last.y - rejoin.y) > 360)
      fail('shortcuts', `${sc.id} ends far from where it rejoins the main line`);
    // Driving it is credited like the road it bypasses.
    const progress = createProgress();
    const events: string[] = [];
    const clock = { ms: 0 };
    walkBranch(
      track,
      progress,
      main,
      track.startS - 40,
      track.startS +
        ((((sc.leaveS - track.startS) % track.lapLength) + track.lapLength) % track.lapLength),
      clock,
      events,
    );
    const before = progress.checkpointIndex;
    walkBranch(track, progress, sc, 0, sc.length, clock, events);
    const credited = (progress.checkpointIndex - before + cps.length) % cps.length;
    if (credited !== gates)
      fail('shortcuts', `driving ${sc.id} credits ${credited} of its ${gates} gates`);
    const from =
      track.startS +
      ((((sc.rejoinS - track.startS) % track.lapLength) + track.lapLength) % track.lapLength);
    walkBranch(track, progress, main, from, track.startS + track.lapLength + 60, clock, events);
    if (progress.lap !== 2) fail('shortcuts', `a lap through ${sc.id} is not counted`);
    if (!scDef.risk) fail('shortcuts', `${sc.id} does not say what makes it risky`);
  }

  // --- spawn grid ----------------------------------------------------------------------------
  {
    const loc = createLocation();
    const positions: number[] = [];
    for (const sp of track.spawns) {
      locate(track, sp.x, sp.y, loc);
      if (loc.branch !== 0 || Math.abs(loc.lateral) > loc.halfWidth - TRACK_LIMITS.carRadius)
        fail('spawn_grid', 'a spawn is not on the pavement of the main line');
      positions.push(lapPosition(track, loc));
      const facing =
        headingForwardX(sp.headingRad) * loc.tx + headingForwardY(sp.headingRad) * loc.ty;
      if (facing < 0.99) fail('spawn_grid', 'a spawn does not face down the road');
      const clear = TRACK_LIMITS.spawnClear;
      if (wallDepth(track, sp.x, sp.y, clear) > 0 || obstacleDepth(track, sp.x, sp.y, clear) > 0)
        fail('spawn_grid', 'a spawn is within 40 px of a wall or an obstacle');
      for (const h of def.hazards) {
        if (h.kind === 'crossing') {
          if (segmentDistance(sp.x, sp.y, h.a.x, h.a.y, h.b.x, h.b.y) < clear + 200)
            fail('spawn_grid', 'a spawn is near a rail crossing');
          continue;
        }
        const pts = shapeOutline(h.shape, track.branches);
        for (const p of pts)
          if (Math.hypot(p.x - sp.x, p.y - sp.y) < clear)
            fail('spawn_grid', `a spawn is inside ${h.id}`);
      }
    }
    if (positions.length < 2) fail('spawn_grid', 'fewer than two spawns');
    else if (Math.abs(positions[0]! - positions[1]!) > 2)
      fail('spawn_grid', 'the two spawns are not level with each other');
  }

  // --- surface mix ---------------------------------------------------------------------------
  const share: Partial<Record<SurfaceId, number>> = {};
  for (let i = 0; i < main.count; i++)
    share[main.surface[i]!] = (share[main.surface[i]!] ?? 0) + 1 / main.count;
  for (const id of SURFACE_IDS) {
    const want = def.surfaceMix[id] ?? 0;
    const got = share[id] ?? 0;
    if (Math.abs(got - want) > TRACK_LIMITS.surfaceTolerance)
      fail(
        'surface_mix',
        `${id} is ${Math.round(got * 100)}% of the main line, published ${Math.round(want * 100)}%`,
      );
  }
  {
    const total = Object.values(def.surfaceMix).reduce((a, b) => a + (b ?? 0), 0);
    if (Math.abs(total - 1) > 1e-6)
      fail('surface_mix', 'the published surface mix does not add up to 1');
  }

  // --- corner signs --------------------------------------------------------------------------
  let sharpBends = 0;
  {
    const k = 1 / TRACK_LIMITS.bendRadius;
    const step = main.length / main.count;
    const ref = referenceSpeeds(main, track);
    // Independent of the sign placer: runs of curvature beyond the limit, turning far enough.
    let i0 = 0;
    while (i0 < main.count && Math.abs(main.curvature[i0]!) >= k) i0++;
    for (let n = 0; n < main.count;) {
      const i = (i0 + n) % main.count;
      if (Math.abs(main.curvature[i]!) < k) {
        n++;
        continue;
      }
      let turn = 0;
      let m = 0;
      let slowest = Infinity;
      while (m < main.count && Math.abs(main.curvature[(i + m) % main.count]!) >= k) {
        turn += main.curvature[(i + m) % main.count]! * step;
        slowest = Math.min(slowest, ref[(i + m) % main.count]!);
        m++;
      }
      n += m;
      if (Math.abs((turn * 180) / Math.PI) < TRACK_LIMITS.bendTurnDeg) continue;
      // A bend the reference car takes without slowing needs no warning.
      if (slowest >= CORNER_SIGNS.topSpeed * CORNER_SIGNS.sharpShare) continue;
      sharpBends++;
      const s = main.s[i]!;
      // Covered by a sign whose sequence runs from before this bend to after its start.
      const sign = track.cornerSigns.find((c) => {
        if (c.branch !== 0 || c.signS === c.bendS) return false;
        const into = (((s - c.bendS) % main.length) + main.length) % main.length;
        const chain = (((c.chainEndS - c.bendS) % main.length) + main.length) % main.length;
        return into <= chain + 160 || arcGap(main, c.bendS, s) < 160;
      });
      if (!sign) fail('corner_signs', `no corner sign before the bend at ${Math.round(s)} px`);
    }
    for (const sign of track.cornerSigns) {
      if (sign.leadSeconds < CORNER_SIGNS.leadMin || sign.leadSeconds > CORNER_SIGNS.leadMax)
        fail(
          'corner_signs',
          `${sign.id} is ${sign.leadSeconds} s before its bend at reference speed`,
        );
      if (!pointRect(sign, def.cameraBounds))
        fail('corner_signs', `${sign.id} is outside the camera bounds`);
    }
  }

  // --- off-road return path -------------------------------------------------------------------
  let offroadCells = 0;
  let strandedCells = 0;
  if (!track.walled) {
    const cell = 8;
    const cols = Math.ceil(W / cell);
    const rows = Math.ceil(H / cell);
    // 0 solid, 1 a car's centre fits, 2 the whole car fits.
    const free = new Uint8Array(cols * rows);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const x = (c + 0.5) * cell;
        const y = (r + 0.5) * cell;
        if (wallDepth(track, x, y, 0) > 0 || obstacleDepth(track, x, y, 0) > 0) continue;
        const fits =
          wallDepth(track, x, y, TRACK_LIMITS.carRadius) <= 0 &&
          obstacleDepth(track, x, y, TRACK_LIMITS.carRadius) <= 0;
        free[r * cols + c] = fits ? 2 : 1;
      }
    const flood = (min: number): Uint8Array => {
      const seen = new Uint8Array(cols * rows);
      const queue: number[] = [];
      for (let i = 0; i < main.count; i += 2) {
        const c = Math.floor(main.x[i]! / cell);
        const r = Math.floor(main.y[i]! / cell);
        const k = r * cols + c;
        if (free[k]! >= min && !seen[k]) {
          seen[k] = 1;
          queue.push(k);
        }
      }
      for (let q = 0; q < queue.length; q++) {
        const k = queue[q]!;
        const c = k % cols;
        const r = (k - c) / cols;
        const next = [
          c > 0 ? k - 1 : -1,
          c < cols - 1 ? k + 1 : -1,
          r > 0 ? k - cols : -1,
          r < rows - 1 ? k + cols : -1,
        ];
        for (const n of next) {
          if (n < 0 || seen[n] || free[n]! < min) continue;
          seen[n] = 1;
          queue.push(n);
        }
      }
      return seen;
    };
    const any = flood(1);
    const car = flood(2);
    let leak = false;
    for (let k = 0; k < cols * rows; k++) {
      if (!any[k]) continue;
      const c = k % cols;
      const r = (k - c) / cols;
      if (c === 0 || r === 0 || c === cols - 1 || r === rows - 1) leak = true;
      if (free[k] === 2) {
        if (car[k]) offroadCells++;
        else strandedCells++;
      }
    }
    // A car that leaves the road can always drive back: every place a car can get to is joined
    // to the road by ground it fits through (the flood is symmetric), so what can break the rule
    // is a gap in the boundary. Pockets behind gaps narrower than a car (`strandedCells`) are
    // places no car can reach; they are reported, not refused.
    if (leak)
      fail('offroad_return', 'open ground reaches the edge of the world: the boundary has a gap');
    if (offroadCells === 0) fail('offroad_return', 'an open track with no open ground');
  }

  // --- racing line clear, or telegraphed --------------------------------------------------------
  {
    const anchors = new Map(def.anchors.map((a) => [a.id, a]));
    const intrudes = (x: number, y: number, radius: number): string | null => {
      for (const b of track.branches)
        for (let i = 0; i < b.count; i++) {
          const lane = Math.max(8, b.halfWidth[i]! - 22);
          if (Math.hypot(b.x[i]! - x, b.y[i]! - y) < lane + radius) return b.id;
        }
      return null;
    };
    const telegraphed = (id: string | undefined, x: number, y: number): boolean => {
      const a = id ? anchors.get(id) : undefined;
      return (
        !!a && a.points.some((p) => Math.hypot(p.x - x, p.y - y) < TRACK_LIMITS.telegraphReach)
      );
    };
    for (const ob of def.obstacles) {
      const on = intrudes(ob.x, ob.y, ob.radius);
      if (on && !telegraphed(ob.telegraph, ob.x, ob.y))
        fail(
          'racing_line_clear',
          `${ob.id} stands in the racing lane of ${on} without a telegraph`,
        );
    }
    for (const wall of def.walls) {
      const n = wall.closed ? wall.points.length : wall.points.length - 1;
      for (let i = 0; i < n; i++) {
        const a = wall.points[i]!;
        const b = wall.points[(i + 1) % wall.points.length]!;
        const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 8));
        let hit: string | null = null;
        for (let k = 0; k <= steps && !hit; k++)
          hit = intrudes(
            a.x + ((b.x - a.x) * k) / steps,
            a.y + ((b.y - a.y) * k) / steps,
            wall.thickness / 2,
          );
        if (hit && !telegraphed(wall.telegraph, a.x, a.y)) {
          fail(
            'racing_line_clear',
            `${wall.id} cuts the racing lane of ${hit} without a telegraph`,
          );
          break;
        }
      }
    }
  }

  // --- hazards -------------------------------------------------------------------------------
  for (const h of def.hazards) {
    if ('schedule' in h) {
      const s = h.schedule;
      if (!(s.periodSeconds > s.warnSeconds + s.activeSeconds) || s.activeSeconds <= 0)
        fail('hazards', `${h.id}: the timetable does not fit its period`);
      if (s.warnSeconds < 1) fail('hazards', `${h.id}: under a second of warning`);
    }
    switch (h.kind) {
      case 'crossing': {
        if (h.lights.length < 2)
          fail('hazards', `${h.id}: a crossing needs warning lights on both sides`);
        const loc = createLocation();
        for (const end of [h.a, h.b]) {
          locate(track, end.x, end.y, loc);
          if (loc.edge < -2) fail('hazards', `${h.id}: the barrier does not span the road`);
        }
        break;
      }
      case 'oil':
        if (!(h.grip > 0 && h.grip <= 1)) fail('hazards', `${h.id}: oil grip must be in (0, 1]`);
        break;
      case 'crosswind':
        if (!(h.exposure >= 0 && h.exposure <= 1.5))
          fail('hazards', `${h.id}: exposure out of range`);
        break;
      case 'magnetic_strip':
        if (!(h.gripBonus > 0 && h.gripBonus <= 0.5))
          fail('hazards', `${h.id}: grip bonus out of range`);
        break;
      default:
        break;
    }
  }
  // Area hazards may not overlap: each cell holds one.
  {
    def.hazards.forEach((h, i) => {
      if (h.kind === 'crossing') return;
      let cells = 0;
      if (track.zoneHazard) for (const v of track.zoneHazard) if (v === i + 1) cells++;
      if (cells === 0) fail('hazards', `${h.id} covers no ground (hidden under a later hazard?)`);
    });
  }

  // --- camera bounds ----------------------------------------------------------------------------
  {
    const cb = def.cameraBounds;
    if (cb.x < 0 || cb.y < 0 || cb.x + cb.w > W || cb.y + cb.h > H)
      fail('camera_bounds', 'the camera bounds leave the world');
    for (const b of track.branches)
      for (let i = 0; i < b.count; i += 4)
        if (
          !pointRect(
            { x: b.x[i]!, y: b.y[i]! },
            { x: cb.x + 200, y: cb.y + 200, w: cb.w - 400, h: cb.h - 400 },
          )
        ) {
          fail('camera_bounds', `${b.id} runs within 200 px of the camera bounds`);
          break;
        }
    const inside = (p: TrackPoint, what: string) => {
      if (!pointRect(p, cb)) fail('camera_bounds', `${what} is outside the camera bounds`);
    };
    for (const w of def.walls) for (const p of w.points) inside(p, w.id);
    for (const o of def.obstacles) inside(o, o.id);
    for (const a of def.anchors) for (const p of a.points) inside(p, a.id);
    for (const h of def.hazards) {
      if (h.kind === 'crossing') {
        inside(h.a, h.id);
        inside(h.b, h.id);
      } else for (const p of shapeOutline(h.shape, track.branches)) inside(p, h.id);
    }
  }

  // --- weather and anchors ----------------------------------------------------------------------
  if (def.weatherPresetIds.length !== 2)
    fail('weather', 'a track publishes exactly two weather presets');
  {
    const ids = new Set<string>();
    for (const a of def.anchors) {
      if (ids.has(a.id)) fail('anchors', `anchor ${a.id} is named twice`);
      ids.add(a.id);
      if (a.points.length === 0) fail('anchors', `anchor ${a.id} has no points`);
    }
    if (def.landmarks.length < 4) fail('anchors', 'a track needs four landmarks (Section 12.10)');
  }

  const passed = TRACK_RULES.filter((r) => !failed.has(r));
  return {
    ok: issues.length === 0,
    issues,
    passed,
    stats: {
      lapLength: Math.round(track.lapLength),
      surfaceShare: share,
      checkpoints: cps.length,
      shortcutGates,
      shortcutRatio,
      cornerSigns: track.cornerSigns.length,
      sharpBends,
      offroadCells,
      strandedCells,
    },
  };
}
