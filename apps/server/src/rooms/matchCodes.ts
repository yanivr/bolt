import { randomInt } from 'node:crypto';
import { generateMatchCode } from '@bolt/shared';

/**
 * Friend codes of the open lobbies on this node: code to room id. A code lives exactly as long
 * as its room (Section 3.2: it expires with the lobby after 15 minutes of inactivity), is never
 * reused while its room exists, and is drawn from a cryptographic source so the next one cannot
 * be guessed from the last. The space is 30^6 (about 729 million) against at most a few hundred
 * open rooms, and lookups are rate limited per address and per guest (`routes/match.ts`).
 */
export class MatchCodeRegistry {
  private readonly rooms = new Map<string, string>();
  private readonly codes = new Map<string, string>();

  constructor(private readonly random: (n: number) => number = randomInt) {}

  /** A fresh code for a room. Collisions with a live code are drawn again. */
  issue(roomId: string): string {
    const existing = this.codes.get(roomId);
    if (existing) return existing;
    for (let attempt = 0; attempt < 32; attempt++) {
      const code = generateMatchCode(this.random);
      if (this.rooms.has(code)) continue;
      this.rooms.set(code, roomId);
      this.codes.set(roomId, code);
      return code;
    }
    throw new Error('could not draw a free match code');
  }

  lookup(code: string): string | undefined {
    return this.rooms.get(code);
  }

  codeOf(roomId: string): string | undefined {
    return this.codes.get(roomId);
  }

  release(roomId: string): void {
    const code = this.codes.get(roomId);
    if (code === undefined) return;
    this.codes.delete(roomId);
    this.rooms.delete(code);
  }

  get size(): number {
    return this.rooms.size;
  }
}
