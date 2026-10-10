import type { OverlayArt } from './biome.js';
import { Canvas, F_EMISSIVE, F_WASH, KEY_NONE } from './canvas.js';
import type { Color } from './canvas.js';
import type { CorridorField } from './field.js';
import { shadowVolume } from './lighting.js';
import type { LightPlanes } from './lighting.js';

/**
 * Top-down oblique projection shared with the car sprites. The ground plane is drawn as a plain
 * north-up map; a point `z` above the ground is drawn `TILT * z` pixels further up the screen,
 * so everything with height shows its top and its south face, and leans up the screen.
 *
 * Large masses (buildings, landmarks, stacked cargo) also lean a little to the east as they
 * rise, one pixel for every `LEAN_RUN` pixels of rise, the way classic oblique games draw
 * scenery. That turns their west walls toward the viewer, so a box shows three planes: the
 * roof, the west wall that faces the light, and the south wall in shade. Cars and small street
 * furniture stay upright.
 *
 * Two mechanisms put raised geometry into the picture:
 *
 *  - `Scene.add` takes a standing sprite: art that was drawn upright, anchored to the ground row
 *    it stands on. Sprites are painted north to south, so nearer things cover farther ones.
 *  - `Scene.extrude` raises an arbitrary ground footprint (walls and rails that follow curves),
 *    column by column, with a callback for the top and for the south face.
 *
 * Both record what they cover, so the bake can prove that nothing raised hides drivable ground.
 */

/** Screen pixels a point rises per world pixel of height. Must match the car renderer. */
export const TILT = 0.62;

/** Screen rise of a world height. */
export const riseOf = (z: number): number => Math.round(z * TILT);

/** Rows of screen rise per pixel of eastward lean on a solid mass. */
export const LEAN_RUN = 3;
/** Eastward shift of a point `rise` screen pixels above the ground. */
export const leanOf = (rise: number): number => Math.floor(rise / LEAN_RUN);

/** Rows north of raised mass that must stay free of drivable ground, and columns east of it. */
export const CLEAR_NORTH = 24;
export const CLEAR_EAST = 14;
/** Half units of rise a cast shadow loses per pixel it travels to the south-east. */
export const SHADOW_DROP = 5;

export type OverlayTag = { id: string; kind: string; fade: boolean };

export type Standing = {
  art: Canvas;
  /** World position of the sprite's top-left corner. */
  x: number;
  y: number;
  /** Ground row of the southern edge of the footprint: the painter's sort key. */
  baseY: number;
  /**
   * Sprite rows from this index down are upright faces standing on `baseY`; they pick up the
   * street light that falls on the ground at their foot.
   */
  faceFrom?: number;
  /** Set to send the sprite to a foreground overlay instead of the ground layer. */
  overlay?: OverlayTag;
};

/** A sprite with the pixel that stands on the ground. */
export type Sprite = { art: Canvas; ax: number; ay: number };

export type Extrusion = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Screen rise of the solid standing on this ground pixel; 0 where there is none. */
  rise: (x: number, y: number) => number;
  top: (x: number, y: number) => Color;
  /** Face color `v` pixels above the ground at footprint pixel (x, y); null leaves a gap. */
  side: (x: number, y: number, v: number) => Color | null;
  /** Length of the cast shadow, in pixels. */
  shadow: number;
};

const NO_LIMIT = 255;
/** Rows of an upright face, counted from its foot, that take light from the ground. */
const FACE_WASH = 8;

export class Scene {
  readonly w: number;
  readonly h: number;
  /** 1 where the ground is drivable (pavement or shoulder). */
  readonly drive: Uint8Array;
  /** Rows of non-drivable ground directly north of each pixel, capped at 255 (no road). */
  readonly clearN: Uint8Array;
  /** Screen pixels written by raised geometry in the ground layer. */
  readonly raised: Uint8Array;
  /** Ground-space plane of shadow lengths, read by the shadow caster. */
  readonly shadowH: Uint8Array;
  /** Ground pixels shadowed by something that is not in `shadowH` (canopies, overlays). */
  readonly forced: Uint8Array;
  /** Screen rise of the solid mass standing on each ground pixel. */
  readonly height: Uint8Array;
  /**
   * Rise below which a point above each ground pixel lies in the shadow of some solid mass.
   * Available once `resolve` has run.
   */
  shade: Uint8Array;
  private readonly sat: Int32Array;
  private readonly items: Standing[] = [];
  private readonly extrusions: Extrusion[] = [];
  private readonly deferred: Array<() => void> = [];

  /**
   * `solids` are round obstacles standing on the roadway. Their own collision footprint is not
   * drivable, so the art that marks them may be drawn there.
   */
  constructor(
    field: CorridorField,
    solids: ReadonlyArray<{ x: number; y: number; radius: number }> = [],
  ) {
    const { w, h } = field;
    this.w = w;
    this.h = h;
    this.drive = new Uint8Array(w * h);
    this.clearN = new Uint8Array(w * h);
    this.raised = new Uint8Array(w * h);
    this.shadowH = new Uint8Array(w * h);
    this.forced = new Uint8Array(w * h);
    this.height = new Uint8Array(w * h);
    this.shade = new Uint8Array(0);
    this.sat = new Int32Array((w + 1) * (h + 1));
    for (let i = 0; i < w * h; i++) this.drive[i] = field.edge[i]! <= 0 ? 1 : 0;
    for (const o of solids) {
      const r = o.radius + 1.5;
      for (let y = Math.floor(o.y - r); y <= Math.ceil(o.y + r); y++) {
        for (let x = Math.floor(o.x - r); x <= Math.ceil(o.x + r); x++) {
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          if ((x + 0.5 - o.x) ** 2 + (y + 0.5 - o.y) ** 2 <= r * r) this.drive[y * w + x] = 0;
        }
      }
    }
    for (let y = 0; y < h; y++) {
      let run = 0;
      for (let x = 0; x < w; x++) {
        run += this.drive[y * w + x]!;
        this.sat[(y + 1) * (w + 1) + x + 1] = this.sat[y * (w + 1) + x + 1]! + run;
      }
    }
    for (let x = 0; x < w; x++) {
      let c = NO_LIMIT;
      for (let y = 0; y < h; y++) {
        const p = y * w + x;
        if (this.drive[p]) {
          c = 0;
          continue;
        }
        this.clearN[p] = c;
        if (c < NO_LIMIT) c++;
      }
    }
  }

  /** Number of drivable pixels inside a rectangle. */
  driveCount(x: number, y: number, w: number, h: number): number {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(this.w, x + w);
    const y1 = Math.min(this.h, y + h);
    if (x1 <= x0 || y1 <= y0) return 0;
    const W = this.w + 1;
    return (
      this.sat[y1 * W + x1]! -
      this.sat[y0 * W + x1]! -
      this.sat[y1 * W + x0]! +
      this.sat[y0 * W + x0]!
    );
  }

  /** True when no opaque pixel of the art would land on drivable ground or leave the world. */
  artFits(art: Canvas, x: number, y: number): boolean {
    if (x < 0 || y < 0 || x + art.w > this.w || y + art.h > this.h) return false;
    if (this.driveCount(x, y, art.w, art.h) === 0) return true;
    for (let yy = 0; yy < art.h; yy++) {
      for (let xx = 0; xx < art.w; xx++) {
        if (art.data[(yy * art.w + xx) * 4 + 3] === 0) continue;
        if (this.drive[(y + yy) * this.w + x + xx]) return false;
      }
    }
    return true;
  }

  spriteFits(sp: Sprite, gx: number, gy: number): boolean {
    return this.artFits(sp.art, gx - sp.ax, gy - sp.ay);
  }

  add(item: Standing): void {
    this.items.push(item);
  }

  /** Stands a sprite on the ground point (gx, gy). */
  place(sp: Sprite, gx: number, gy: number, overlay?: OverlayTag, faces = false): void {
    this.items.push({
      art: sp.art,
      x: gx - sp.ax,
      y: gy - sp.ay,
      baseY: gy,
      faceFrom: faces ? 0 : undefined,
      overlay,
    });
  }

  /**
   * Adds a standing sprite whose upper part may reach over drivable ground. Every row down to
   * the lowest one that touches the road moves to the given overlay; the rest stays on the
   * ground. Returns true when a part went to the overlay.
   */
  addSplit(item: Standing, overlay: OverlayTag): boolean {
    const { art } = item;
    let cut = -1;
    for (let yy = art.h - 1; yy >= 0 && cut < 0; yy--) {
      const wy = item.y + yy;
      if (wy < 0 || wy >= this.h) continue;
      for (let xx = 0; xx < art.w; xx++) {
        const wx = item.x + xx;
        if (wx < 0 || wx >= this.w) continue;
        if (art.data[(yy * art.w + xx) * 4 + 3] !== 0 && this.drive[wy * this.w + wx]) {
          cut = yy;
          break;
        }
      }
    }
    if (cut < 0) {
      this.items.push(item);
      return false;
    }
    const upper = Canvas.sprite(art.w, cut + 1);
    upper.buf.copyFrom(art.buf, 0, 0, art.w, cut + 1, 0, 0);
    this.items.push({ art: upper, x: item.x, y: item.y, baseY: item.baseY, overlay });
    if (cut + 1 < art.h) {
      const lower = Canvas.sprite(art.w, art.h - cut - 1);
      lower.buf.copyFrom(art.buf, 0, cut + 1, art.w, art.h - cut - 1, 0, 0);
      if (art.flags && lower.flags)
        lower.flags.set(art.flags.subarray((cut + 1) * art.w, art.h * art.w));
      const faceFrom =
        item.faceFrom === undefined ? undefined : Math.max(0, item.faceFrom - cut - 1);
      this.items.push({ art: lower, x: item.x, y: item.y + cut + 1, baseY: item.baseY, faceFrom });
    }
    return true;
  }

  /** Registers a solid mass `rise` pixels tall on a rectangular footprint. */
  solid(x: number, y: number, w: number, d: number, rise: number): void {
    const r = Math.min(255, rise);
    const x1 = Math.min(this.w, x + w);
    const y1 = Math.min(this.h, y + d);
    for (let yy = Math.max(0, y); yy < y1; yy++) {
      for (let xx = Math.max(0, x); xx < x1; xx++) {
        const p = yy * this.w + xx;
        if (this.height[p]! < r) this.height[p] = r;
      }
    }
  }

  /**
   * Tallest a mass on this footprint may be without its leaning body reaching over drivable
   * ground, or into the strip a car beside the road is drawn across.
   */
  maxRise(x: number, y: number, w: number, d: number, limit: number): number {
    for (let v = 0; v <= limit; v++) {
      const lean = leanOf(v);
      if (this.driveCount(x + lean, y - v - CLEAR_NORTH, w + CLEAR_EAST, d + CLEAR_NORTH) > 0)
        return v - 1;
    }
    return limit;
  }

  /** Queues work that needs the shadow volume: it runs inside `resolve`, in order. */
  later(fn: () => void): void {
    this.deferred.push(fn);
  }

  /** Casts the shadow volume of every registered mass, then runs the queued painters. */
  resolve(): void {
    this.shade = shadowVolume(this.w, this.h, this.height, SHADOW_DROP);
    for (const fn of this.deferred) fn();
    this.deferred.length = 0;
  }

  /** True when the point `rise` above ground pixel (x, y) is in the shadow of a solid mass. */
  shaded(x: number, y: number, rise: number): boolean {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    return this.shade[y * this.w + x]! > rise;
  }

  /** Registers a ground footprint that casts a shadow `len` pixels long. */
  footprint(x: number, y: number, w: number, h: number, len: number): void {
    const x1 = Math.min(this.w, x + w);
    const y1 = Math.min(this.h, y + h);
    for (let yy = Math.max(0, y); yy < y1; yy++) {
      for (let xx = Math.max(0, x); xx < x1; xx++) {
        const p = yy * this.w + xx;
        if (this.shadowH[p]! < len) this.shadowH[p] = len;
      }
    }
  }

  /** Marks a round patch of ground as shadowed (tree canopies, hanging loads). */
  shadeDisc(cx: number, cy: number, r: number, squash = 1): void {
    const r2 = (r + 0.35) * (r + 0.35);
    for (let yy = Math.floor(cy - r / squash); yy <= Math.ceil(cy + r / squash); yy++) {
      for (let xx = Math.floor(cx - r); xx <= Math.ceil(cx + r); xx++) {
        if (xx < 0 || yy < 0 || xx >= this.w || yy >= this.h) continue;
        const dy = (yy - cy) * squash;
        if ((xx - cx) * (xx - cx) + dy * dy <= r2) this.forced[yy * this.w + xx] = 1;
      }
    }
  }

  shadeRect(x: number, y: number, w: number, h: number): void {
    const x1 = Math.min(this.w, x + w);
    const y1 = Math.min(this.h, y + h);
    for (let yy = Math.max(0, y); yy < y1; yy++)
      for (let xx = Math.max(0, x); xx < x1; xx++) this.forced[yy * this.w + xx] = 1;
  }

  /**
   * Raises a ground footprint into the picture. Every footprint pixel is a column `rise` pixels
   * tall; the column is never allowed to reach over drivable ground, so a wall on the near side
   * of a road is automatically stepped back until its top meets the road edge. Extrusions are
   * painted before the sprites, in the order they were added.
   */
  extrude(ex: Extrusion): void {
    this.extrusions.push(ex);
  }

  private raise(world: Canvas, ex: Extrusion, zkey: Int16Array): void {
    const { w } = this;
    const x0 = Math.max(0, ex.x0);
    const x1 = Math.min(this.w, ex.x1);
    const y0 = Math.max(0, ex.y0);
    const y1 = Math.min(this.h, ex.y1);
    for (let x = x0; x < x1; x++) {
      let r = Math.min(ex.rise(x, y0), this.clearN[y0 * w + x]!);
      for (let y = y0; y < y1; y++) {
        const next = y + 1 < y1 ? Math.min(ex.rise(x, y + 1), this.clearN[(y + 1) * w + x]!) : 0;
        if (r > 0) {
          const p = y * w + x;
          if (ex.shadow > this.shadowH[p]!) this.shadowH[p] = ex.shadow;
          world.set(x, y - r, ex.top(x, y));
          this.raised[(y - r) * w + x] = 1;
          zkey[(y - r) * w + x] = y;
          for (let v = r - 1; v >= next; v--) {
            const c = ex.side(x, y, v);
            if (c === null) continue;
            world.set(x, y - v, c);
            this.raised[(y - v) * w + x] = 1;
            zkey[(y - v) * w + x] = y;
          }
        }
        r = next;
      }
    }
  }

  /**
   * Paints every ground-layer sprite, north to south, through a depth plane. A flat sprite
   * stands on its base row; a solid carries a key per pixel, so a mass that leans over its
   * eastern neighbor or rises behind a lower one is cut exactly where it should be.
   */
  paint(
    world: Canvas,
    light: LightPlanes | null,
    lit: (c: Color, s: number, t: number) => Color,
  ): void {
    world.curFlags = 0;
    const { w, h } = this;
    const zkey = new Int16Array(w * h).fill(KEY_NONE);
    for (const ex of this.extrusions) this.raise(world, ex, zkey);
    const order = this.items
      .map((item, k) => ({ item, k }))
      .filter((e) => !e.item.overlay)
      .sort((a, b) => a.item.baseY - b.item.baseY || a.item.x - b.item.x || a.k - b.k);
    const data = world.data;
    const flags = world.flags;
    for (const { item } of order) {
      const { art } = item;
      const keys = art.keys;
      const faceFrom = item.faceFrom ?? art.h;
      const footY = Math.min(h - 1, item.baseY + 1);
      for (let yy = 0; yy < art.h; yy++) {
        const wy = item.y + yy;
        if (wy < 0 || wy >= h) continue;
        // Street light washes only the foot of a wall, and a step weaker than on the ground.
        const above = art.h - 1 - yy;
        const face = light !== null && yy >= faceFrom && above < FACE_WASH;
        for (let xx = 0; xx < art.w; xx++) {
          const q = yy * art.w + xx;
          const i = q * 4;
          const a = art.data[i + 3]!;
          if (a === 0) continue;
          const wx = item.x + xx;
          if (wx < 0 || wx >= w) continue;
          const p = wy * w + wx;
          let key = item.baseY;
          if (keys && keys[q] !== KEY_NONE) key = keys[q]!;
          if (key < zkey[p]!) continue;
          const o = p * 4;
          const fl = art.flags ? art.flags[q]! : 0;
          const emissive = (fl & F_EMISSIVE) !== 0;
          if (a === 255) {
            let c = (art.data[i]! << 16) | (art.data[i + 1]! << 8) | art.data[i + 2]!;
            if (light !== null && !emissive) {
              if (face) {
                const g = footY * w + wx;
                const s = light.step[g]! - 1;
                if (s > 0) c = lit(c, s, light.tint[g]!);
              } else if (fl & F_WASH) {
                // A solid's wall: the light is the one on the ground at the wall's own foot.
                const gy = Math.min(h - 1, key + 1);
                const gx = Math.max(0, wx - leanOf(Math.max(0, key - wy)));
                const g = gy * w + gx;
                const s = light.step[g]! - 1;
                if (s > 0) c = lit(c, s, light.tint[g]!);
              }
            }
            data[o] = (c >> 16) & 255;
            data[o + 1] = (c >> 8) & 255;
            data[o + 2] = c & 255;
            data[o + 3] = 255;
            zkey[p] = key;
          } else {
            // Hard-edged glow: a flat mix, quantized so it adds few colors.
            const t = a / 255;
            data[o] = Math.round((data[o]! + (art.data[i]! - data[o]!) * t) / 4) * 4;
            data[o + 1] =
              Math.round((data[o + 1]! + (art.data[i + 1]! - data[o + 1]!) * t) / 4) * 4;
            data[o + 2] =
              Math.round((data[o + 2]! + (art.data[i + 2]! - data[o + 2]!) * t) / 4) * 4;
          }
          if (flags) flags[p] = emissive ? F_EMISSIVE : 0;
          this.raised[p] = 1;
        }
      }
    }
  }

  /** Composes the overlay sprites into one canvas per overlay id. */
  overlays(): OverlayArt[] {
    const groups = new Map<
      string,
      { tag: OverlayTag; items: Array<{ item: Standing; k: number }> }
    >();
    this.items.forEach((item, k) => {
      if (!item.overlay) return;
      let g = groups.get(item.overlay.id);
      if (!g) {
        g = { tag: item.overlay, items: [] };
        groups.set(item.overlay.id, g);
      }
      g.items.push({ item, k });
    });
    const out: OverlayArt[] = [];
    for (const g of groups.values()) {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const { item } of g.items) {
        x0 = Math.min(x0, item.x);
        y0 = Math.min(y0, item.y);
        x1 = Math.max(x1, item.x + item.art.w);
        y1 = Math.max(y1, item.y + item.art.h);
      }
      x0 = Math.max(0, x0);
      y0 = Math.max(0, y0);
      x1 = Math.min(this.w, x1);
      y1 = Math.min(this.h, y1);
      if (x1 <= x0 || y1 <= y0) continue;
      const cv = new Canvas(x1 - x0, y1 - y0);
      g.items.sort((a, b) => a.item.baseY - b.item.baseY || a.item.x - b.item.x || a.k - b.k);
      for (const { item } of g.items) {
        const { art } = item;
        for (let yy = 0; yy < art.h; yy++) {
          for (let xx = 0; xx < art.w; xx++) {
            const i = (yy * art.w + xx) * 4;
            const a = art.data[i + 3]!;
            if (a === 0) continue;
            const c = (art.data[i]! << 16) | (art.data[i + 1]! << 8) | art.data[i + 2]!;
            const tx = item.x + xx - x0;
            const ty = item.y + yy - y0;
            if (a === 255) cv.setA(tx, ty, c, 255);
            else cv.halo(tx, ty, c, a);
          }
        }
      }
      out.push({
        id: g.tag.id,
        kind: g.tag.kind,
        canvas: cv,
        x: x0,
        y: y0,
        fadeNearPlayer: g.tag.fade,
      });
    }
    return out;
  }

  /** Drivable pixels hidden by raised geometry in the ground layer. Must be zero. */
  violations(): number {
    let n = 0;
    for (let i = 0; i < this.raised.length; i++) if (this.raised[i] && this.drive[i]) n++;
    return n;
  }
}
