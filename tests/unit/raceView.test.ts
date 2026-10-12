import { describe, expect, it } from 'vitest';
import type { CameraDistance, CameraView } from '../../apps/web/src/game/rendering/frame.js';
import {
  CAMERA_DISTANCES,
  LEAD_FRACTION_X,
  LEAD_FRACTION_Y,
  FAR_FALLBACK_SPAN,
  FAR_LONG_MAX,
  FAR_MIN_SPAN,
  MEDIUM_SPAN,
  VIEW_LONG_MAX,
  VIEW_LONG_MIN,
  chooseRaceView,
  chooseViewScale,
  chunksInView,
  parseCameraDistance,
  steadyLookAhead,
} from '../../apps/web/src/game/rendering/frame.js';
import { HudCamera, carRoam } from '../../apps/web/src/hud/hudCamera.js';

/**
 * The `Camera` setting: how much of the world each of its three choices shows on the phones
 * the game has to work on, what that costs, and that everything that follows the view (the
 * look-ahead, the HUD's own camera) follows it.
 */

/** The five phone sizes of the HUD's layout tests, with the pixel ratio each one has. */
const PHONES: Array<[name: string, w: number, h: number, dpr: number]> = [
  ["the owner's phone in its host page", 870, 370, 3],
  ['the same with a taller host bar', 870, 340, 3],
  ['iPhone 14 landscape', 844, 390, 3],
  ['iPhone SE', 667, 375, 2],
  ['iPhone 15 Pro Max', 932, 430, 3],
];

const WORLD = { width: 3584, height: 2816 };

function cameraView(view: ReturnType<typeof chooseRaceView>): CameraView {
  return {
    widthPx: view.widthPx,
    heightPx: view.heightPx,
    scale: view.scale,
    worldWidth: WORLD.width,
    worldHeight: WORLD.height,
  };
}

describe('the Camera setting', () => {
  it('has three choices and Close is the view the game always had', () => {
    expect(CAMERA_DISTANCES).toEqual(['close', 'medium', 'far']);
    for (const [, w, h, dpr] of PHONES) {
      const close = chooseRaceView(w, h, dpr, 'close');
      const before = chooseViewScale(w, h, dpr);
      expect(close.scale).toBe(before.scale);
      expect(close.renderRatio).toBe(before.renderRatio);
      expect(close.native).toBe(before.native);
      expect(close.filter).toBe(before.native ? 'pixelated' : 'smooth');
    }
  });

  it.each(PHONES)('%s: every choice draws the world at a whole-number scale', (_n, w, h, dpr) => {
    for (const distance of CAMERA_DISTANCES) {
      const view = chooseRaceView(w, h, dpr, distance);
      expect(Number.isInteger(view.scale), distance).toBe(true);
      expect(view.scale).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(view.widthPx) && Number.isInteger(view.heightPx)).toBe(true);
      // The world it shows is the canvas over the scale, and fills the screen exactly.
      expect(view.worldWidth).toBeCloseTo(view.widthPx / view.scale, 9);
      expect(view.cssPerWorld * view.worldWidth).toBeCloseTo(w, 0);
      expect(view.cssPerWorld * view.worldHeight).toBeCloseTo(h, 0);
    }
  });

  it.each(PHONES)('%s: Close shows 760 to 1040 world pixels', (_n, w, h, dpr) => {
    const view = chooseRaceView(w, h, dpr, 'close');
    expect(view.worldWidth).toBeGreaterThanOrEqual(VIEW_LONG_MIN - 0.5);
    expect(view.worldWidth).toBeLessThanOrEqual(VIEW_LONG_MAX + 0.5);
  });

  it.each(PHONES)('%s: Medium shows a quarter more than Close, each way', (_n, w, h, dpr) => {
    const close = chooseRaceView(w, h, dpr, 'close');
    const medium = chooseRaceView(w, h, dpr, 'medium');
    expect(medium.worldWidth / close.worldWidth).toBeCloseTo(MEDIUM_SPAN, 2);
    expect(medium.worldHeight / close.worldHeight).toBeCloseTo(MEDIUM_SPAN, 2);
    // The same whole-number scale as Close, on a canvas a quarter larger each way, scaled
    // down as a whole by the browser with filtering: five canvas pixels on four of Close's.
    expect(medium.scale).toBe(close.scale);
    expect(medium.renderRatio / close.renderRatio).toBeCloseTo(5 / 4, 12);
    expect(medium.native).toBe(false);
    expect(medium.filter).toBe('smooth');
    // 56 percent more pixels to fill than Close, and never beyond what a phone's GPU takes.
    const cost = (medium.widthPx * medium.heightPx) / (close.widthPx * close.heightPx);
    expect(cost).toBeGreaterThan(1.55);
    expect(cost).toBeLessThan(1.57);
    expect(Math.max(medium.widthPx, medium.heightPx)).toBeLessThanOrEqual(4096);
  });

  it.each(PHONES)('%s: Far is the next whole-number scale out', (_n, w, h, dpr) => {
    const close = chooseRaceView(w, h, dpr, 'close');
    const far = chooseRaceView(w, h, dpr, 'far');
    // A whole step (or two, where one would be less than FAR_MIN_SPAN) at Close's own canvas
    // resolution: nothing more is resampled than Close already is.
    expect(far.scale).toBeLessThan(close.scale);
    expect(far.renderRatio).toBe(close.renderRatio);
    expect(far.native).toBe(close.native);
    expect(far.worldWidth / close.worldWidth).toBeCloseTo(close.scale / far.scale, 6);
    expect(far.worldWidth / close.worldWidth).toBeGreaterThanOrEqual(FAR_MIN_SPAN - 1e-9);
    expect(far.worldWidth).toBeLessThanOrEqual(FAR_LONG_MAX + 0.5);
    expect(far.worldWidth).toBeGreaterThan(chooseRaceView(w, h, dpr, 'medium').worldWidth);
  });

  it("on the owner's phone: 870, 1088 and 1305 world pixels across, at 3, 3 and 2", () => {
    const [close, medium, far] = CAMERA_DISTANCES.map((d) => chooseRaceView(870, 370, 3, d));
    expect([close!.worldWidth, close!.worldHeight, close!.scale]).toEqual([870, 370, 3]);
    expect(close!.native).toBe(true);
    expect(medium!.scale).toBe(3);
    expect(medium!.worldWidth).toBeCloseTo(1087.5, 0);
    expect(medium!.worldHeight).toBeCloseTo(462.5, 0);
    expect(medium!.cssPerWorld).toBeCloseTo(0.8, 6);
    expect([far!.worldWidth, far!.worldHeight, far!.scale]).toEqual([1305, 555, 2]);
    // Far is drawn at device resolution: two device pixels to a world pixel, nothing resampled.
    expect(far!.native).toBe(true);
    expect(far!.filter).toBe('pixelated');
  });

  it('the phones with three device pixels draw Close and Far with nothing resampled', () => {
    for (const [, w, h, dpr] of PHONES.filter(([, , , ratio]) => ratio === 3))
      for (const distance of ['close', 'far'] as const)
        expect(chooseRaceView(w, h, dpr, distance).native, `${w}x${h} ${distance}`).toBe(true);
  });

  it("counts the terrain chunks a view can touch: 6, 8 and 12 of 512 pixels on the owner's phone", () => {
    const counts = CAMERA_DISTANCES.map((d) => chunksInView(chooseRaceView(870, 370, 3, d), 512));
    expect(counts).toEqual([6, 8, 12]);
    // A view exactly one chunk wide can still straddle two.
    expect(chunksInView({ worldWidth: 512, worldHeight: 100 }, 512)).toBe(4);
  });

  it('reads a stored setting, and the name Far had in an earlier build', () => {
    expect(parseCameraDistance('close', 'medium')).toBe('close');
    expect(parseCameraDistance('medium', 'close')).toBe('medium');
    expect(parseCameraDistance('far', 'close')).toBe('far');
    expect(parseCameraDistance('wide', 'close')).toBe('far');
    for (const junk of [undefined, null, '', 'zoom', 3, {}])
      expect(parseCameraDistance(junk, 'close')).toBe('close');
  });
});

/**
 * The three steps on a grid of screens and pixel ratios, as `frame.ts` must hold them for any
 * device: phones in and out of a host page, tablets and desktop windows, at one, two and three
 * device pixels to a CSS pixel.
 */
describe('the three camera steps at every pixel ratio', () => {
  const SCREENS: Array<[w: number, h: number]> = [
    [870, 370],
    [870, 340],
    [844, 390],
    [667, 375],
    [736, 414],
    [800, 360],
    [932, 430],
    [1024, 768],
    [1366, 768],
    [1440, 900],
    [1920, 1080],
  ];
  const CASES = [1, 2, 3].flatMap((dpr) => SCREENS.map(([w, h]) => [w, h, dpr] as const));

  it.each(CASES)('%i x %i at %i', (w, h, dpr) => {
    const close = chooseRaceView(w, h, dpr, 'close');
    const medium = chooseRaceView(w, h, dpr, 'medium');
    const far = chooseRaceView(w, h, dpr, 'far');
    for (const view of [close, medium, far]) {
      // Whole canvas pixels per world pixel, a canvas that fills the screen exactly.
      expect(Number.isInteger(view.scale) && view.scale >= 1).toBe(true);
      expect(view.cssPerWorld * view.worldWidth).toBeCloseTo(w, 0);
      expect(view.cssPerWorld * view.worldHeight).toBeCloseTo(h, 0);
      // Never resampled without filtering, never filtered at device resolution.
      expect(view.filter).toBe(view.native ? 'pixelated' : 'smooth');
      if (view.native) expect(view.renderRatio).toBe(Math.min(dpr, 3));
      // On a phone, never more canvas than its GPU takes. (A large desktop screen at two or
      // three device pixels is past it in Close already, and its GPU allows more.)
      if (w <= 932) expect(Math.max(view.widthPx, view.heightPx)).toBeLessThanOrEqual(4096);
    }
    // Close: the band it has always had.
    expect(close.worldWidth).toBeGreaterThanOrEqual(VIEW_LONG_MIN - 0.5);
    expect(close.worldWidth).toBeLessThanOrEqual(VIEW_LONG_MAX + 0.5);
    // Medium: a quarter more each way, at Close's scale, on a canvas a quarter larger.
    expect(medium.scale).toBe(close.scale);
    expect(medium.worldWidth / close.worldWidth).toBeCloseTo(MEDIUM_SPAN, 2);
    expect(medium.worldWidth).toBeGreaterThanOrEqual(VIEW_LONG_MIN * MEDIUM_SPAN - 1);
    expect(medium.worldWidth).toBeLessThanOrEqual(VIEW_LONG_MAX * MEDIUM_SPAN + 1);
    // Far: further than Medium, never further than its band allows.
    expect(far.worldWidth / close.worldWidth).toBeGreaterThanOrEqual(FAR_MIN_SPAN - 1e-6);
    expect(far.worldWidth).toBeLessThanOrEqual(FAR_LONG_MAX + 0.5);
    if (close.scale > 1) {
      // A whole step out at the same canvas resolution: as crisp as Close.
      expect(far.scale).toBeLessThan(close.scale);
      expect(far.renderRatio).toBe(close.renderRatio);
      expect(far.native).toBe(close.native);
      // The nearest step that is far enough, not two steps where one would do.
      if (far.scale + 1 < close.scale)
        expect(close.scale / (far.scale + 1)).toBeLessThan(FAR_MIN_SPAN);
    } else {
      // Close is already one canvas pixel per world pixel: Far is drawn as Medium is.
      expect(far.scale).toBe(1);
      expect(far.native).toBe(false);
      expect(far.worldWidth / close.worldWidth).toBeCloseTo(FAR_FALLBACK_SPAN, 2);
    }
  });

  it('steps out as the brief describes on the phones that matter', () => {
    const far = (w: number, h: number, dpr: number) => {
      const v = chooseRaceView(w, h, dpr, 'far');
      return [v.scale, Math.round(v.worldWidth), v.native];
    };
    // Three device pixels: three to two, half as much again, at device resolution.
    expect(far(870, 370, 3)).toEqual([2, 1305, true]);
    expect(far(844, 390, 3)).toEqual([2, 1266, true]);
    // Two device pixels: two to one, twice as much, at device resolution.
    expect(far(870, 370, 2)).toEqual([1, 1740, true]);
    expect(far(844, 390, 2)).toEqual([1, 1688, true]);
    // iPhone SE: Close is resampled there already (760 of 667 points) and Far keeps its canvas.
    expect(far(667, 375, 2)).toEqual([1, 1520, false]);
    // A 1x desktop window: Close at two, Far at one.
    expect(far(1440, 900, 1)).toEqual([1, 1520, false]);
    // A large 3x screen: six to four, because six to five would be less than Medium.
    expect(far(1920, 1080, 3)).toEqual([4, 1440, true]);
  });
});

describe('the look-ahead follows the view', () => {
  const speed = 260;

  it.each(PHONES)(
    '%s: the lead is the same share of the screen in every setting',
    (_n, w, h, dpr) => {
      const ahead: Partial<Record<CameraDistance, number>> = {};
      for (const distance of CAMERA_DISTANCES) {
        const view = chooseRaceView(w, h, dpr, distance);
        const cam = cameraView(view);
        // Road ahead of the car when driving up the screen, the hard direction.
        const up = steadyLookAhead(cam, 0, -1, speed);
        ahead[distance] = up;
        // In CSS pixels the car sits in the same place whatever the setting.
        expect((up * view.cssPerWorld) / h).toBeGreaterThan(0.5 + LEAD_FRACTION_Y * 0.6);
        expect((up * view.cssPerWorld) / h).toBeLessThanOrEqual(0.5 + LEAD_FRACTION_Y + 1e-6);
        const left = steadyLookAhead(cam, -1, 0, speed);
        expect((left * view.cssPerWorld) / w).toBeLessThanOrEqual(0.5 + LEAD_FRACTION_X + 1e-6);
        // At least 0.9 seconds of road in every direction, as Close has always had.
        for (let deg = 0; deg < 360; deg += 15) {
          const a = (deg * Math.PI) / 180;
          expect(steadyLookAhead(cam, Math.sin(a), -Math.cos(a), speed) / speed).toBeGreaterThan(
            0.9,
          );
        }
      }
      // So in world pixels, and in seconds of road, a wider view sees further ahead.
      expect(ahead.medium! / ahead.close!).toBeCloseTo(MEDIUM_SPAN, 1);
      expect(ahead.far!).toBeGreaterThan(ahead.medium!);
    },
  );

  it("the HUD's own camera uses the same view: the car at the same place, the world smaller", () => {
    const at = { x: 0, y: 0 };
    const edge = { x: 0, y: 0 };
    for (const [, w, h, dpr] of PHONES) {
      for (const distance of CAMERA_DISTANCES) {
        const view = chooseRaceView(w, h, dpr, distance);
        const camera = new HudCamera();
        camera.configure(w, h, dpr, WORLD.width, WORLD.height, distance);
        expect(camera.cssPerWorld).toBeCloseTo(view.cssPerWorld, 9);
        // Flat out to the left until the lead settles.
        for (let ms = 0; ms < 4000; ms += 16) camera.update(ms, 1800, 1400, -speed, 0);
        camera.car(at);
        const roam = carRoam(w, h);
        expect(at.x).toBeGreaterThan(w / 2 + roam.rx * 0.5);
        expect(at.x).toBeLessThanOrEqual(w / 2 + roam.rx + 1.5);
        expect(Math.abs(at.y - h / 2)).toBeLessThan(1.5);
        // The HUD maps a world offset to the screen at the view's own scale.
        camera.toScreen(1800 + 400, 1400, edge);
        expect(edge.x - at.x).toBeCloseTo(400 * view.cssPerWorld, 1);
      }
      const close = new HudCamera();
      close.configure(w, h, dpr, WORLD.width, WORLD.height, 'close');
      const far = new HudCamera();
      far.configure(w, h, dpr, WORLD.width, WORLD.height, 'far');
      expect(far.cssPerWorld).toBeLessThan(close.cssPerWorld);
    }
  });

  it('changing the setting reconfigures the HUD camera, and nothing else does needlessly', () => {
    const camera = new HudCamera();
    camera.configure(870, 370, 3, WORLD.width, WORLD.height, 'close');
    camera.update(0, 1800, 1400, 0, 0);
    expect(camera.ready).toBe(true);
    expect(camera.cssPerWorld).toBeCloseTo(1, 9);
    camera.configure(870, 370, 3, WORLD.width, WORLD.height, 'far');
    expect(camera.cssPerWorld).toBeCloseTo(2 / 3, 9);
    camera.configure(870, 370, 3, WORLD.width, WORLD.height, 'medium');
    expect(camera.cssPerWorld).toBeCloseTo(0.8, 5);
  });
});
