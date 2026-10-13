import { ensureGuest, serverOrigin } from '../network/api.js';
import { createCodeClient } from './codeApi.js';

/**
 * The page's car code client: the game server this page talks to, and the anonymous guest of
 * `network/api.ts`. Kept apart from `codeApi.ts` so that module stays free of browser globals
 * and can be tested on its own.
 */
export const codes = createCodeClient({
  origin: serverOrigin,
  token: async () => (await ensureGuest()).token,
});
