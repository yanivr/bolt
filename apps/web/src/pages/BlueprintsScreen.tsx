import { STRINGS } from '@bolt/content';
import { buildHash } from '@bolt/shared';
import { useEffect } from 'react';
import { getManifests } from '../app/App.js';
import { useApp } from '../app/store.js';
import { BlueprintsView } from '../components/BlueprintsView.js';

/** My Blueprints as its own screen, reached from Home. `Use` makes a car the last build. */
export function BlueprintsScreen() {
  const setScreen = useApp((s) => s.setScreen);
  const blueprint = useApp((s) => s.blueprint);
  const setBlueprint = useApp((s) => s.setBlueprint);
  const openGarageWith = useApp((s) => s.openGarageWith);
  const manifests = getManifests();

  // Escape goes back, as the Back button does. An open dialog takes the key first.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setScreen('home');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setScreen]);

  if (!manifests) return null;
  return (
    <main className="screen blueprints" aria-label={STRINGS.blueprints.title}>
      <h1 className="visually-hidden">{STRINGS.blueprints.title}</h1>
      <BlueprintsView
        manifests={manifests}
        current={blueprint}
        currentHash={buildHash(blueprint)}
        closeLabel={STRINGS.blueprints.back}
        onClose={() => setScreen('home')}
        onUse={(picked) => {
          if (setBlueprint(picked)) setScreen('home');
        }}
        onReview={(draft) => openGarageWith(draft)}
      />
    </main>
  );
}
