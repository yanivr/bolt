import { STRINGS } from '@bolt/content';
import { PixelText } from './PixelText.js';

/** The BOLT RIVALS wordmark: stacked pixel lettering on a riveted plate with a bolt slash. */
export function Emblem({ scale = 4 }: { scale?: number }) {
  return (
    <div className="emblem" aria-label={STRINGS.productName} role="img">
      <div className="emblem-plate">
        <PixelText text="BOLT" scale={scale * 2} color="#F6C35B" shadow="#8a4a16" decorative />
        <span className="emblem-slash" aria-hidden="true" />
        <PixelText text="RIVALS" scale={scale} color="#F5EED9" shadow="#151C2C" decorative />
      </div>
      <p className="emblem-tag">{STRINGS.tagline}</p>
    </div>
  );
}
