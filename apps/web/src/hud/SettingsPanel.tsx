import { STRINGS } from '@bolt/content';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { useApp } from '../app/store.js';

type Props = {
  onClose: () => void;
  /** Extra content above the controls, such as the pause notice. */
  notice?: ReactNode;
  /** Extra actions below the controls, such as Leave Race. */
  actions?: ReactNode;
  closeLabel?: string;
};

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="setting-row">
      <span>{label}</span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function Slider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="setting-row">
      <span>{label}</span>
      <input type="range" min={0} max={100} step={5} value={Math.round(value * 100)} onChange={(e) => onChange(Number(e.target.value) / 100)} />
    </label>
  );
}

function Choice<T extends string>({ label, name, value, options, onChange }: { label: string; name: string; value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  const id = `setting-${name}`;
  return (
    <div className="setting-row setting-choice" role="radiogroup" aria-labelledby={id}>
      <span id={id}>{label}</span>
      <div className="setting-options">
        {options.map(([key, text]) => (
          <label key={key} className={value === key ? 'is-selected' : undefined}>
            <input type="radio" name={name} checked={value === key} onChange={() => onChange(key)} />
            <span>{text}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

/** Settings shared by the home screen and the in-race menu (Section 5.13, Milestone A subset). */
export function SettingsPanel({ onClose, notice, actions, closeLabel }: Props) {
  const settings = useApp((s) => s.settings);
  const update = useApp((s) => s.updateSettings);

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
          <button className="btn btn-small" onClick={onClose} aria-label={closeLabel ?? STRINGS.settings.done}>
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
          <Toggle label={STRINGS.settings.reducedCamera} checked={settings.reducedCamera} onChange={(v) => update({ reducedCamera: v })} />
          <Toggle label={STRINGS.settings.reduceFlashes} checked={settings.reduceFlashes} onChange={(v) => update({ reduceFlashes: v })} />
          <Slider label={STRINGS.settings.cameraShake} value={settings.cameraShake} onChange={(v) => update({ cameraShake: v })} />
          <Slider label={STRINGS.settings.engine} value={settings.engineVolume} onChange={(v) => update({ engineVolume: v })} />
          <Slider label={STRINGS.settings.effects} value={settings.effectsVolume} onChange={(v) => update({ effectsVolume: v })} />
          <Toggle label={STRINGS.settings.mute} checked={settings.muted} onChange={(v) => update({ muted: v })} />
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
