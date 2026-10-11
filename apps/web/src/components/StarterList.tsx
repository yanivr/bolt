import { STARTER_TEMPLATES } from '@bolt/content';
import type { BlueprintTemplate } from '@bolt/content';
import type { GameManifests } from '../game/assets.js';
import { BlueprintCard, isDrawable } from './BlueprintCard.js';

type Props = {
  manifests: GameManifests;
  /** The label of the one action on each card. */
  actionLabel: string;
  onPick: (template: BlueprintTemplate) => void;
};

/**
 * The starter cars (Section 5.3 Quick Build, Section 5.12 Starter Cars). Every one is a real
 * legal blueprint from the content package. A starter on a frame the artists have not drawn
 * yet is listed and marked, and cannot be picked until its art lands.
 */
export function StarterList({ manifests, actionLabel, onPick }: Props) {
  return (
    <div className="bp-grid">
      {STARTER_TEMPLATES.map((template) => {
        const drawable = isDrawable(manifests, template.blueprint);
        return (
          <BlueprintCard
            key={template.id}
            manifests={manifests}
            blueprint={template.blueprint}
            note={template.description}
          >
            <button
              className="btn btn-primary btn-small"
              disabled={!drawable}
              onClick={() => onPick(template)}
              aria-label={`${actionLabel}: ${template.name}`}
            >
              {actionLabel}
            </button>
          </BlueprintCard>
        );
      })}
    </div>
  );
}
