import { STRINGS } from '@bolt/content';
import { useApp } from '../app/store.js';
import { Emblem } from '../components/Emblem.js';

/** Boot and loading (Section 5.2): emblem, staged progress, and a real retry on failure. */
export function BootScreen() {
  const boot = useApp((s) => s.boot);
  const label =
    boot.stage === 'garage'
      ? STRINGS.loading.garage
      : boot.stage === 'track'
        ? STRINGS.loading.track
        : boot.stage === 'connecting'
          ? STRINGS.loading.connecting
          : '';
  const progress = 'progress' in boot ? boot.progress : 1;

  return (
    <main className="screen boot">
      <Emblem scale={5} />
      {boot.stage === 'error' ? (
        <div className="panel boot-error" role="alert">
          <p>
            {boot.kind === 'assets'
              ? STRINGS.loading.assetFailure
              : STRINGS.loading.rendererUnsupported}
          </p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            {STRINGS.loading.retry}
          </button>
        </div>
      ) : (
        <div
          className="boot-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          aria-label={label}
        >
          <div className="boot-bar">
            <div className="boot-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <div className="boot-label">
            <span>{label}</span>
            <span>{Math.round(progress * 100)}%</span>
          </div>
        </div>
      )}
    </main>
  );
}
