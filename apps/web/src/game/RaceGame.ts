import Phaser from 'phaser';
import type { RaceSceneConfig } from './scenes/RaceScene.js';
import { RaceScene } from './scenes/RaceScene.js';

export type RaceGameHandle = {
  restart: () => void;
  destroy: () => void;
  renderer: 'webgl' | 'canvas';
};

/** Device pixels are capped so very dense phones do not pay for detail nobody can see. */
function devicePixelRatio(): number {
  return Math.min(window.devicePixelRatio || 1, 3);
}

/**
 * Creates the Phaser instance for one race. The canvas is rendered at device resolution and
 * the scene scales world pixels by a whole number, which keeps art crisp while the camera
 * rotates and glides smoothly (Section 12.5). WebGL is preferred; Phaser falls back to its
 * Canvas renderer when WebGL is unavailable.
 */
export function createRaceGame(parent: HTMLElement, config: RaceSceneConfig): RaceGameHandle {
  const dpr = devicePixelRatio();
  const size = () => ({
    width: Math.max(2, Math.round(parent.clientWidth * dpr)),
    height: Math.max(2, Math.round(parent.clientHeight * dpr)),
  });
  const initial = size();
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
    scale: { mode: Phaser.Scale.NONE, zoom: 1 / dpr, autoRound: false },
    render: { powerPreference: 'high-performance', antialias: false, pixelArt: true },
    fps: { target: 60, smoothStep: true },
  });
  game.scene.add('race', scene, true, config);

  const resize = () => {
    const next = size();
    game.scale.resize(next.width, next.height);
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
