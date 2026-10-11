import { STRINGS } from '@bolt/content';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useApp } from '../app/store.js';
import type { AudioPrefs } from '../game/audio/index.js';
import {
  getAudioPrefs,
  hapticsSupported,
  onAudioPrefs,
  setAudioPrefs,
  uiSound,
} from '../game/audio/index.js';

type Props = {
  onClose: () => void;
  /** Extra content above the controls, such as the pause notice. */
  notice?: ReactNode;
  /** Extra actions below the controls, such as Leave Race. */
  actions?: ReactNode;
  closeLabel?: string;
};

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="setting-row">
      <span>{label}</span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => {
          uiSound(e.target.checked ? 'toggle_on' : 'toggle_off');
          onChange(e.target.checked);
        }}
      />
    </label>
  );
}

function Slider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="setting-row">
      <span>{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={Math.round(value * 100)}
        onChange={(e) => {
          onChange(Number(e.target.value) / 100);
          uiSound('slider');
        }}
      />
    </label>
  );
}

function Choice<T extends string>({
  label,
  name,
  value,
  options,
  onChange,
}: {
  label: string;
  name: string;
  value: T;
  options: Array<[T, string]>;
  onChange: (v: T) => void;
}) {
  const id = `setting-${name}`;
  return (
    <div className="setting-row setting-choice" role="radiogroup" aria-labelledby={id}>
      <span id={id}>{label}</span>
      <div className="setting-options">
        {options.map(([key, text]) => (
          <label key={key} className={value === key ? 'is-selected' : undefined}>
            <input
              type="radio"
              name={name}
              checked={value === key}
              onChange={() => {
                uiSound('select');
                onChange(key);
              }}
            />
            <span>{text}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

/**
 * Settings shared by the home screen and the in-race menu (Section 5.13). `Driving Hand` is
 * the left-handed layout of Section 16: it swaps the HUD's two columns.
 */
export function SettingsPanel({ onClose, notice, actions, closeLabel }: Props) {
  const settings = useApp((s) => s.settings);
  const update = useApp((s) => s.updateSettings);
  // Music, interface volume, vibration and softer effects are the audio module's own
  // preferences (docs/DECISIONS.md, entry 135); this panel is where the player sets them.
  const [audio, setAudio] = useState<AudioPrefs>(() => getAudioPrefs());
  useEffect(() => onAudioPrefs(setAudio), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={STRINGS.settings.title}>
      <div className="panel settings">
        <header className="settings-head">
          <h2>{STRINGS.settings.title}</h2>
          <button
            className="btn btn-small"
            onClick={onClose}
            aria-label={closeLabel ?? STRINGS.settings.done}
            // Keyboard players land inside the dialog, on the way back out of it.
            autoFocus
          >
            {closeLabel ?? STRINGS.settings.done}
          </button>
        </header>
        {notice}
        <div className="settings-body">
          <Choice
            label={STRINGS.settings.drivingHand}
            name="hand"
            value={settings.drivingHand}
            options={[
              ['left', STRINGS.settings.leftThumb],
              ['right', STRINGS.settings.rightThumb],
            ]}
            onChange={(v) => update({ drivingHand: v })}
          />
          <Choice
            label={STRINGS.settings.steering}
            name="steering"
            value={settings.steering}
            options={[
              ['direction', STRINGS.settings.steerDirection],
              ['wheel', STRINGS.settings.steerWheel],
            ]}
            onChange={(v) => update({ steering: v })}
          />
          <Choice
            label={STRINGS.settings.hudSize}
            name="hud-size"
            value={settings.hudScale}
            options={[
              ['normal', STRINGS.settings.hudNormal],
              ['large', STRINGS.settings.hudLarge],
            ]}
            onChange={(v) => update({ hudScale: v })}
          />
          <Toggle
            label={STRINGS.settings.callouts}
            checked={settings.callouts}
            onChange={(v) => update({ callouts: v })}
          />
          <Choice
            label={STRINGS.settings.effectsQuality}
            name="effects-quality"
            value={settings.effectsQuality}
            options={[
              ['auto', STRINGS.settings.qualityAuto],
              ['high', STRINGS.settings.qualityHigh],
              ['low', STRINGS.settings.qualityLow],
            ]}
            onChange={(v) => update({ effectsQuality: v })}
          />
          <Toggle
            label={STRINGS.settings.reduceFlashes}
            checked={settings.reduceFlashes}
            onChange={(v) => update({ reduceFlashes: v })}
          />
          <Slider
            label={STRINGS.settings.cameraShake}
            value={settings.cameraShake}
            onChange={(v) => update({ cameraShake: v })}
          />
          <Slider
            label={STRINGS.settings.music}
            value={audio.musicVolume}
            onChange={(v) => setAudioPrefs({ musicVolume: v })}
          />
          <Slider
            label={STRINGS.settings.engine}
            value={settings.engineVolume}
            onChange={(v) => update({ engineVolume: v })}
          />
          <Slider
            label={STRINGS.settings.effects}
            value={settings.effectsVolume}
            onChange={(v) => update({ effectsVolume: v })}
          />
          <Slider
            label={STRINGS.settings.ui}
            value={audio.uiVolume}
            onChange={(v) => setAudioPrefs({ uiVolume: v })}
          />
          <Toggle
            label={STRINGS.settings.mute}
            checked={settings.muted}
            onChange={(v) => update({ muted: v })}
          />
          <Toggle
            label={STRINGS.settings.reducedIntensity}
            checked={audio.reducedIntensity}
            onChange={(v) => setAudioPrefs({ reducedIntensity: v })}
          />
          {hapticsSupported() && (
            <Toggle
              label={STRINGS.settings.haptics}
              checked={audio.haptics}
              onChange={(v) => setAudioPrefs({ haptics: v })}
            />
          )}
          <Choice
            label={STRINGS.settings.speedUnit}
            name="unit"
            value={settings.speedUnit}
            options={[
              ['mph', 'MPH'],
              ['kmh', 'KM/H'],
            ]}
            onChange={(v) => update({ speedUnit: v })}
          />
        </div>
        {actions && <footer className="settings-actions">{actions}</footer>}
      </div>
    </div>
  );
}
