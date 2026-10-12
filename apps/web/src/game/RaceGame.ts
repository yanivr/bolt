import Phaser from 'phaser';
import { debugEnabled } from '../app/flags.js';
import { useApp } from '../app/store.js';
import type { RaceView } from './rendering/frame.js';
import { chooseRaceView } from './rendering/frame.js';
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
 * canvas pixels per world pixel. How much of it is shown is the `Camera` setting: about 900
 * world pixels on the long side for `Close`, a quarter more for `Medium`, and for `Far` the
 * next whole-number scale out, which is half as much again on a phone at three device pixels
 * (Section 12.5, and the camera decisions in docs/DECISIONS.md). `Close` and `Far` put the
 * canvas at device resolution on most phones; `Medium`, and the few screens where a
 * whole-number scale cannot give the wanted view, size the canvas so the scale still is a
 * whole number and let the browser resample the finished frame by one uniform factor.
 * WebGL is preferred; Phaser falls back to its Canvas renderer when WebGL is unavailable.
 */
export function createRaceGame(parent: HTMLElement, config: RaceGameConfig): RaceGameHandle {
  const view: RaceSceneConfig['view'] = { scale: 1, distance: 'close', filter: 'pixelated' };
  // For judging how `Medium` is drawn, with `?debug=1` only: `mediumAs=nearest` scales the
  // same frame down without filtering, `mediumAs=upscale` draws one whole-number scale lower
  // and scales the frame up instead. Neither is offered to players (docs/DECISIONS.md).
  const mediumAs = debugEnabled()
    ? new URLSearchParams(window.location.search).get('mediumAs')
    : null;
  const measure = (): RaceView => {
    const choice = chooseRaceView(
      parent.clientWidth,
      parent.clientHeight,
      window.devicePixelRatio || 1,
      useApp.getState().settings.cameraDistance,
    );
    if (choice.distance === 'medium' && mediumAs === 'nearest') choice.filter = 'pixelated';
    if (choice.distance === 'medium' && mediumAs === 'upscale' && choice.scale > 1) {
      choice.renderRatio *= (choice.scale - 1) / choice.scale;
      choice.scale -= 1;
      choice.widthPx = Math.max(2, Math.round(parent.clientWidth * choice.renderRatio));
      choice.heightPx = Math.max(2, Math.round(parent.clientHeight * choice.renderRatio));
    }
    view.scale = choice.scale;
    view.distance = choice.distance;
    view.filter = choice.filter;
    return choice;
  };
  const initial = measure();
  const scene = new RaceScene();
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: initial.widthPx,
    height: initial.heightPx,
    backgroundColor: '#151C2C',
    banner: false,
    pixelArt: true,
    antialias: false,
    roundPixels: false,
    disableContextMenu: true,
    audio: { noAudio: true },
    input: { keyboard: false, mouse: false, touch: false, gamepad: false },
    scale: { mode: Phaser.Scale.NONE, zoom: 1 / initial.renderRatio, autoRound: false },
    render: { powerPreference: 'high-performance', antialias: false, pixelArt: true },
    // The scene paces itself from frame timestamps. Phaser's own delta smoothing averages the
    // last ten frames, which smears every dropped frame across the following nine.
    fps: { target: 60, smoothStep: false },
  });
  const sceneConfig: RaceSceneConfig = { ...config, view };
  game.scene.add('race', scene, true, sceneConfig);

  const applyCanvasStyle = (choice: RaceView) => {
    // A resampled canvas must be filtered, or the whole-number art gets uneven pixels back.
    game.canvas.style.imageRendering = choice.filter === 'pixelated' ? 'pixelated' : 'auto';
    // The canvas always covers its parent. Phaser leaves the CSS size alone when the zoom is
    // exactly 1, which after a change from another zoom is the size of the canvas before.
    game.canvas.style.width = `${choice.widthPx / choice.renderRatio}px`;
    game.canvas.style.height = `${choice.heightPx / choice.renderRatio}px`;
  };
  applyCanvasStyle(initial);

  const resize = () => {
    const next = measure();
    game.scale.setZoom(1 / next.renderRatio);
    game.scale.resize(next.widthPx, next.heightPx);
    applyCanvasStyle(next);
    game.scale.updateBounds();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(parent);
  window.addEventListener('orientationchange', resize);
  // The Camera setting applies at once, also from the pause menu of a race in progress.
  let distance = useApp.getState().settings.cameraDistance;
  const unsubscribe = useApp.subscribe((state) => {
    if (state.settings.cameraDistance === distance) return;
    distance = state.settings.cameraDistance;
    resize();
  });

  return {
    restart: () => scene.restart(),
    destroy: () => {
      observer.disconnect();
      unsubscribe();
      window.removeEventListener('orientationchange', resize);
      game.destroy(true);
    },
    renderer: game.config.renderType === Phaser.WEBGL ? 'webgl' : 'canvas',
  };
}
