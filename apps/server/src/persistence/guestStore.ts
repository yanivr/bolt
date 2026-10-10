/**
 * Guest session persistence. The record mirrors the `guest_sessions` table in Section 15.8
 * (opaque id, token hash, created, last seen, expiration) and the interface is asynchronous,
 * so a database-backed store can replace the in-memory one without touching its callers.
 */

export type GuestSessionRecord = {
  /** Opaque random guest id. */
  id: string;
  /** SHA-256 hex digest of the most recently issued token. The token itself is never stored. */
  tokenHash: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
};

export type GuestSessionRotation = { tokenHash: string; expiresAt: Date };

export interface GuestSessionStore {
  create(record: GuestSessionRecord): Promise<void>;
  /** Returns the session, or undefined when it does not exist or has expired. */
  get(id: string, now: Date): Promise<GuestSessionRecord | undefined>;
  /**
   * Records activity and, when a token was rotated, the new hash and expiry.
   * Resolves false when the session does not exist or has expired.
   */
  touch(id: string, now: Date, rotation?: GuestSessionRotation): Promise<boolean>;
  /** Deletes every session that expired at or before `now` and resolves the number removed. */
  expire(now: Date): Promise<number>;
  count(): Promise<number>;
}

export type InMemoryGuestStoreOptions = {
  /** Hard cap on retained sessions so a flood of guest requests cannot exhaust memory. */
  maxSessions?: number;
};

const DEFAULT_MAX_SESSIONS = 100_000;

/**
 * Process-local store used through the early milestones. Sessions vanish on restart, which
 * is acceptable while nothing durable (saved blueprints, match history) hangs off a guest.
 */
export class InMemoryGuestStore implements GuestSessionStore {
  private readonly sessions = new Map<string, GuestSessionRecord>();
  private readonly maxSessions: number;

  constructor(options: InMemoryGuestStoreOptions = {}) {
    this.maxSessions = Math.max(1, options.maxSessions ?? DEFAULT_MAX_SESSIONS);
  }

  async create(record: GuestSessionRecord): Promise<void> {
    if (!this.sessions.has(record.id) && this.sessions.size >= this.maxSessions) {
      this.evict(record.createdAt);
    }
    this.sessions.set(record.id, { ...record });
  }

  async get(id: string, now: Date): Promise<GuestSessionRecord | undefined> {
    const record = this.sessions.get(id);
    if (!record) return undefined;
    if (record.expiresAt.getTime() <= now.getTime()) {
      this.sessions.delete(id);
      return undefined;
    }
    return { ...record };
  }

  async touch(id: string, now: Date, rotation?: GuestSessionRotation): Promise<boolean> {
    const record = this.sessions.get(id);
    if (!record) return false;
    if (record.expiresAt.getTime() <= now.getTime()) {
      this.sessions.delete(id);
      return false;
    }
    record.lastSeenAt = now;
    if (rotation) {
      record.tokenHash = rotation.tokenHash;
      record.expiresAt = rotation.expiresAt;
    }
    return true;
  }

  async expire(now: Date): Promise<number> {
    let removed = 0;
    for (const [id, record] of this.sessions) {
      if (record.expiresAt.getTime() <= now.getTime()) {
        this.sessions.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  async count(): Promise<number> {
    return this.sessions.size;
  }

  /** Makes room for one more session: expired entries first, then the oldest one created. */
  private evict(now: Date): void {
    for (const [id, record] of this.sessions) {
      if (record.expiresAt.getTime() <= now.getTime()) this.sessions.delete(id);
    }
    if (this.sessions.size < this.maxSessions) return;
    // Map iteration follows insertion order, so the first key is the oldest session.
    const oldest = this.sessions.keys().next();
    if (!oldest.done) this.sessions.delete(oldest.value);
  }
}
