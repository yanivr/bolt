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
          <fieldset className="setting-row setting-choice">
            <legend>{STRINGS.settings.drivingHand}</legend>
            <label>
              <input type="radio" name="hand" checked={settings.drivingHand === 'left'} onChange={() => update({ drivingHand: 'left' })} />
              <span>{STRINGS.settings.leftThumb}</span>
            </label>
            <label>
              <input type="radio" name="hand" checked={settings.drivingHand === 'right'} onChange={() => update({ drivingHand: 'right' })} />
              <span>{STRINGS.settings.rightThumb}</span>
            </label>
          </fieldset>
          <Toggle label={STRINGS.settings.reducedCamera} checked={settings.reducedCamera} onChange={(v) => update({ reducedCamera: v })} />
          <Toggle label={STRINGS.settings.reduceFlashes} checked={settings.reduceFlashes} onChange={(v) => update({ reduceFlashes: v })} />
          <Slider label={STRINGS.settings.cameraShake} value={settings.cameraShake} onChange={(v) => update({ cameraShake: v })} />
          <Slider label={STRINGS.settings.engine} value={settings.engineVolume} onChange={(v) => update({ engineVolume: v })} />
          <Slider label={STRINGS.settings.effects} value={settings.effectsVolume} onChange={(v) => update({ effectsVolume: v })} />
          <Toggle label={STRINGS.settings.mute} checked={settings.muted} onChange={(v) => update({ muted: v })} />
          <fieldset className="setting-row setting-choice">
            <legend>{STRINGS.settings.speedUnit}</legend>
            <label>
              <input type="radio" name="unit" checked={settings.speedUnit === 'mph'} onChange={() => update({ speedUnit: 'mph' })} />
              <span>MPH</span>
            </label>
            <label>
              <input type="radio" name="unit" checked={settings.speedUnit === 'kmh'} onChange={() => update({ speedUnit: 'kmh' })} />
              <span>KM/H</span>
            </label>
          </fieldset>
        </div>
        {actions && <footer className="settings-actions">{actions}</footer>}
      </div>
    </div>
  );
}
