import { STRINGS } from '@bolt/content';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { memo, useEffect, useRef } from 'react';
import { Glyph } from '../components/Glyph.js';
import type { GlyphName } from '../components/glyphs.js';
import { PartIcon } from '../components/PartIcon.js';
import type { GameManifests } from '../game/assets.js';
import { hudLive, onHudFrame, useCombat } from './hudStore.js';
import type { ActionView, BlockReason, HudAction } from './model.js';
import { cooldownFraction, spanProgress } from './model.js';

/** A different glyph for every reason, so no reason is told apart by color or by reading alone. */
export const BLOCK_GLYPH: Record<BlockReason, GlyphName> = {
  empty: 'empty',
  overheat: 'flame',
  nopower: 'bolt',
  destroyed: 'close',
  emp: 'emp',
  jammed: 'jam',
  airborne: 'up',
  notarget: 'weapon',
};

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));
}

/** What a screen reader hears for a button: its name, what is left, and why it will not act. */
export function actionLabel(action: HudAction, view: ActionView): string {
  const h = STRINGS.hud;
  const name = fill(action.category === 'weapon' ? h.fire : h.use, {
    weapon: action.name,
    part: action.name,
  });
  const bits = [name];
  if (view.charges >= 0) bits.push(fill(h.left, { count: view.charges }));
  if (view.block) bits.push(h.block[view.block]);
  else if (view.phase === 'cooling') bits.push(h.cooling);
  else if (view.phase === 'charging') bits.push(h.charging);
  else if (view.phase === 'active') bits.push(h.active);
  else if (view.phase === 'locked') bits.push(h.locked);
  else bits.push(h.ready);
  return bits.join('. ');
}

const READY: ActionView = { block: null, phase: 'ready', charges: -1 };

type Props = {
  manifests: GameManifests;
  action: HudAction;
  /** `primary` and `secondary` are the two fire buttons; `utility` the smaller equipment buttons. */
  role: 'primary' | 'secondary' | 'utility';
  /** The button went down, or came up. Held state is the caller's to send to the simulation. */
  onHold: (held: boolean) => void;
};

/**
 * A weapon or equipment button for a thumb (Sections 5.9 and 8.3).
 *
 * It acts on the press, not on the release, and stays pressed for as long as the finger is
 * down, because the simulation reads the two fire buttons as held state: a weapon that keeps
 * firing while held does, and a weapon that locks on fires when the lock comes. Each button
 * captures its own pointer, so one finger can steer, a second hold this button and a third
 * tap another, and a finger that slides off a held button still holds it until it lifts.
 *
 * What it shows, all readable without looking straight at it: a clock wipe over the whole
 * button for the wait until it is ready, a fill rising from the bottom while it charges, the
 * count of what is left in a corner the thumb does not cover, and, when it cannot act, the
 * reason as a word and a glyph of its own over a hatched face.
 */
export const FireButton = memo(function FireButton({ manifests, action, role, onHold }: Props) {
  const view = useCombat((s) => s.actions[action.part]) ?? READY;
  const refusal = useCombat((s) => (s.refusal?.part === action.part ? s.refusal : null));
  const node = useRef<HTMLButtonElement>(null);
  const wipe = useRef<HTMLSpanElement>(null);
  const charge = useRef<HTMLSpanElement>(null);
  const pointer = useRef<number | null>(null);
  const hold = useRef(onHold);
  hold.current = onHold;

  // The dial and the charge fill turn every frame, between snapshots, without a render.
  useEffect(() => {
    let lastWait = -1;
    let lastCharge = -1;
    return onHudFrame((tick) => {
      const module = hudLive.race?.car.combat?.modules[action.part];
      const wait = module ? cooldownFraction(module, tick) : 0;
      if (Math.abs(wait - lastWait) > 0.004 || (wait === 0 && lastWait !== 0)) {
        lastWait = wait;
        wipe.current?.style.setProperty('--wait', wait.toFixed(3));
        if (node.current) node.current.dataset.waiting = wait > 0 ? '1' : '0';
      }
      const until = hudLive.busyUntil[action.part] ?? 0;
      const progress =
        until > tick ? spanProgress(until, hudLive.busyTotal[action.part] ?? 0, tick) : 0;
      if (Math.abs(progress - lastCharge) > 0.004 || (progress === 0 && lastCharge !== 0)) {
        lastCharge = progress;
        charge.current?.style.setProperty('--charge', progress.toFixed(3));
      }
    });
  }, [action.part]);

  // A button that goes away while a finger is on it lets go.
  useEffect(
    () => () => {
      if (pointer.current !== null) hold.current(false);
    },
    [],
  );

  const down = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (pointer.current !== null) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    pointer.current = event.pointerId;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture can fail on synthetic events; the release below still ends the hold.
    }
    event.currentTarget.dataset.held = '1';
    hold.current(true);
  };
  const up = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (pointer.current !== event.pointerId) return;
    pointer.current = null;
    event.currentTarget.dataset.held = '0';
    hold.current(false);
  };

  const size = role === 'utility' ? 32 : 48;
  const reason =
    refusal && refusal.reason !== 'cooldown' ? STRINGS.hud.refusal[refusal.reason] : '';
  return (
    <button
      ref={node}
      type="button"
      // Keyboard players use the shortcut keys, which hold and release properly; a focused
      // button answering Space as a click would fire a second, shorter press.
      tabIndex={-1}
      className={`fire-btn is-${role} is-${view.phase}${view.block ? ` is-blocked block-${view.block}` : ''}`}
      aria-label={actionLabel(action, view)}
      aria-disabled={view.block !== null}
      data-testid={
        role === 'utility' ? `use-${action.useBit}` : role === 'primary' ? 'fire-0' : 'fire-1'
      }
      data-part={action.part}
      data-id={action.id}
      data-phase={view.phase}
      data-block={view.block ?? ''}
      data-charges={view.charges}
      data-held="0"
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={up}
      onContextMenu={(event) => event.preventDefault()}
    >
      <span className="fire-art">
        <PartIcon manifests={manifests} partId={action.id} category={action.category} size={size} />
      </span>
      <span className="fire-charge" ref={charge} aria-hidden="true" />
      <span className="fire-wipe" ref={wipe} aria-hidden="true" />
      {view.phase === 'locked' && !view.block && (
        <span className="fire-lock" aria-hidden="true">
          <Glyph name="weapon" size={12} />
        </span>
      )}
      {view.charges >= 0 && (
        <span className="fire-ammo" aria-hidden="true">
          {view.charges}
        </span>
      )}
      {view.block && (
        <span className="fire-block" aria-hidden="true">
          <Glyph name={BLOCK_GLYPH[view.block]} size={role === 'utility' ? 12 : 24} />
          <span className="fire-block-word">{STRINGS.hud.block[view.block]}</span>
        </span>
      )}
      {action.key && (
        <span className="fire-key" aria-hidden="true">
          {action.key}
        </span>
      )}
      {refusal && (
        // Keyed by the refusal, so each one restarts the shake and the word.
        <span
          className="fire-refusal"
          key={refusal.stamp}
          aria-hidden="true"
          data-reason={refusal.reason}
        >
          {reason && <span className="fire-refusal-word">{reason}</span>}
        </span>
      )}
    </button>
  );
});

/**
 * A part that works by itself: an automatic weapon or a reactive defense. No button, only a
 * small tile that says whether it is ready, working, waiting or out of action.
 */
export const AutoPip = memo(function AutoPip({
  manifests,
  action,
}: {
  manifests: GameManifests;
  action: HudAction;
}) {
  const view = useCombat((s) => s.actions[action.part]) ?? READY;
  const wipe = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let last = -1;
    return onHudFrame((tick) => {
      const module = hudLive.race?.car.combat?.modules[action.part];
      const wait = module ? cooldownFraction(module, tick) : 0;
      if (Math.abs(wait - last) > 0.01 || (wait === 0 && last !== 0)) {
        last = wait;
        wipe.current?.style.setProperty('--wait', wait.toFixed(3));
      }
    });
  }, [action.part]);
  const h = STRINGS.hud;
  const state = view.block
    ? h.block[view.block]
    : view.phase === 'active'
      ? h.active
      : view.phase === 'cooling'
        ? h.cooling
        : view.phase === 'locked'
          ? h.locked
          : h.ready;
  return (
    <span
      className={`auto-pip is-${view.phase}${view.block ? ` is-blocked block-${view.block}` : ''}`}
      role="img"
      aria-label={`${fill(h.auto, { part: action.name })}. ${state}`}
      title={action.name}
      data-part={action.part}
      data-phase={view.phase}
      data-block={view.block ?? ''}
    >
      <PartIcon manifests={manifests} partId={action.id} category={action.category} size={24} />
      <span className="fire-wipe" ref={wipe} aria-hidden="true" />
      {view.block && (
        <span className="auto-pip-mark" aria-hidden="true">
          <Glyph name={BLOCK_GLYPH[view.block]} size={12} />
        </span>
      )}
    </span>
  );
});
