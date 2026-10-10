import Phaser from 'phaser';
import { chooseViewScale } from './rendering/frame.js';
import type { RaceSceneConfig } from './scenes/RaceScene.js';
import { RaceScene } from './scenes/RaceScene.js';

export type RaceGameHandle = {
  restart: () => void;
  destroy: () => void;
  renderer: 'webgl' | 'canvas';
};

export type RaceGameConfig = Omit<RaceSceneConfig, 'view'>;

/**
 * Creates the Phaser instance for one race. The world is drawn north-up at a whole number of
 * canvas pixels per world pixel, chosen so the long side of the view shows about 900 world
 * pixels on every device (Section 12.5, and the camera decision in docs/DECISIONS.md). On most
 * phones the canvas is at device resolution; where that cannot give the wanted view it is
 * sized so the whole-number scale still holds and the browser resamples the finished frame.
 * WebGL is preferred; Phaser falls back to its Canvas renderer when WebGL is unavailable.
 */
export function createRaceGame(parent: HTMLElement, config: RaceGameConfig): RaceGameHandle {
  const view = { scale: 1 };
  const measure = () => {
    const choice = chooseViewScale(
      parent.clientWidth,
      parent.clientHeight,
      window.devicePixelRatio || 1,
    );
    view.scale = choice.scale;
    return {
      width: Math.max(2, Math.round(parent.clientWidth * choice.renderRatio)),
      height: Math.max(2, Math.round(parent.clientHeight * choice.renderRatio)),
      zoom: 1 / choice.renderRatio,
      native: choice.native,
    };
  };
  const initial = measure();
  const scene = new RaceScene();
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: initial.width,
    height: initial.height,
    backgroundColor: '#151C2C',
    banner: false,
    pixelArt: true,
    antialias: false,
    roundPixels: false,
    disableContextMenu: true,
    audio: { noAudio: true },
    input: { keyboard: false, mouse: false, touch: false, gamepad: false },
    scale: { mode: Phaser.Scale.NONE, zoom: initial.zoom, autoRound: false },
    render: { powerPreference: 'high-performance', antialias: false, pixelArt: true },
    // The scene paces itself from frame timestamps. Phaser's own delta smoothing averages the
    // last ten frames, which smears every dropped frame across the following nine.
    fps: { target: 60, smoothStep: false },
  });
  const sceneConfig: RaceSceneConfig = { ...config, view };
  game.scene.add('race', scene, true, sceneConfig);

  const applyCanvasStyle = (native: boolean) => {
    // A resampled canvas must be filtered, or the whole-number art gets uneven pixels back.
    game.canvas.style.imageRendering = native ? 'pixelated' : 'auto';
  };
  applyCanvasStyle(initial.native);

  const resize = () => {
    const next = measure();
    game.scale.setZoom(next.zoom);
    game.scale.resize(next.width, next.height);
    applyCanvasStyle(next.native);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(parent);
  window.addEventListener('orientationchange', resize);

  return {
    restart: () => scene.restart(),
    destroy: () => {
      observer.disconnect();
      window.removeEventListener('orientationchange', resize);
      game.destroy(true);
    },
    renderer: game.config.renderType === Phaser.WEBGL ? 'webgl' : 'canvas',
  };
}
