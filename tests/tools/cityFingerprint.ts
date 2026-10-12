import { cityFingerprints } from '../helpers/fingerprint.js';

/** Prints the Neon Cut fingerprints of tests/helpers/fingerprint.ts. */
const t0 = performance.now();
console.log(JSON.stringify(cityFingerprints(), null, 1));
console.log(`${((performance.now() - t0) / 1000).toFixed(1)} s`);
