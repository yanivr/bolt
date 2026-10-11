import { PAINTS, STRINGS } from '@bolt/content';
import { MAX_BLUEPRINT_NAME_LENGTH, sanitizeBlueprintName } from '@bolt/shared';
import { useState } from 'react';
import { Dialog } from '../../components/Dialog.js';

type Props = {
  name: string;
  paintId: string;
  onPaint: (paintId: string) => void;
  onRename: (name: string) => void;
  onClose: () => void;
};

/** Paint and Name. Both are cosmetic: free, and they never change the build hash. */
export function PaintNameDialog({ name, paintId, onPaint, onRename, onClose }: Props) {
  const g = STRINGS.garage;
  const [draft, setDraft] = useState(name);
  const valid = sanitizeBlueprintName(draft, '') !== '';
  const finish = () => {
    if (valid) onRename(draft);
    onClose();
  };
  return (
    <Dialog title={g.paintAndName} onClose={onClose} className="dialog">
      <form
        className="name-form"
        onSubmit={(event) => {
          event.preventDefault();
          finish();
        }}
      >
        <div className="swatches" role="radiogroup" aria-label={STRINGS.home.paint}>
          {Object.values(PAINTS).map((paint) => (
            <button
              key={paint.id}
              type="button"
              role="radio"
              aria-checked={paintId === paint.id}
              aria-label={paint.displayName}
              className={`swatch swatch-${paint.id}${paintId === paint.id ? ' is-selected' : ''}`}
              onClick={() => onPaint(paint.id)}
            />
          ))}
        </div>
        <label className="field">
          <span>{g.name}</span>
          <input
            type="text"
            value={draft}
            maxLength={MAX_BLUEPRINT_NAME_LENGTH}
            autoComplete="off"
            autoCapitalize="words"
            spellCheck={false}
            enterKeyHint="done"
            onChange={(event) => setDraft(event.target.value.replace(/[^A-Za-z0-9 '.!?&+#-]/g, ''))}
          />
        </label>
        <p className="field-hint">{g.nameHint}</p>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            {g.cancel}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!valid} data-autofocus>
            {g.done}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
