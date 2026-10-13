import net from 'node:net';
import { mulberry32 } from '@bolt/shared';

/**
 * A TCP proxy that makes a loopback connection behave like a mobile network (Sections 15.4 and
 * 19.3). Every byte of HTTP and WebSocket traffic between a test client and the real game
 * server goes through it, in both directions, so the matchmaking request, the socket handshake,
 * every state patch and every input packet all pay the same price.
 *
 * - Latency and jitter: each chunk is delivered `latencyMs + U(0, jitterMs)` after it was read,
 *   but never before the chunk ahead of it (TCP keeps order, so jitter compresses into bursts).
 * - Loss: TCP never loses data; a lost segment is retransmitted and everything behind it waits
 *   (head-of-line blocking). With probability `lossRate` a chunk is held for a retransmission
 *   timeout of `max(200 ms, 2 x RTT)`, and the rest of that direction queues behind it. That is
 *   what packet loss looks like to a WebSocket. Dropping or reordering whole messages, which TCP
 *   cannot do, is done at the application level by the test client (`tests/net/headless.ts`).
 * - Outages: `cut()` drops every connection at once, as a phone losing its network does;
 *   `blackout(ms)` stops delivery in both directions for a while and then delivers it all.
 *
 * Bytes are counted per direction, so tests can report bandwidth per client.
 */

export type LinkProfile = {
  /** One way, milliseconds. */
  latencyMs: number;
  /** Extra one-way delay, uniform from zero to this. */
  jitterMs: number;
  /** Share of chunks that stall the stream for a retransmission timeout. */
  lossRate: number;
  seed: number;
};

export const PERFECT: LinkProfile = { latencyMs: 0, jitterMs: 0, lossRate: 0, seed: 1 };

type Direction = {
  lastAt: number;
  bytes: number;
  chunks: number;
  stalls: number;
};

export class NetSim {
  private server: net.Server | null = null;
  private readonly sockets = new Set<net.Socket>();
  private readonly rng: () => number;
  readonly up: Direction = { lastAt: 0, bytes: 0, chunks: 0, stalls: 0 };
  readonly down: Direction = { lastAt: 0, bytes: 0, chunks: 0, stalls: 0 };
  private blackoutUntil = 0;
  port = 0;

  constructor(
    private readonly targetPort: number,
    public profile: LinkProfile,
    private readonly targetHost = '127.0.0.1',
  ) {
    this.rng = mulberry32(profile.seed);
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  get wsUrl(): string {
    return `ws://127.0.0.1:${this.port}`;
  }

  async listen(): Promise<number> {
    this.server = net.createServer((downstream) => this.pipe(downstream));
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.port = (this.server!.address() as net.AddressInfo).port;
    return this.port;
  }

  /** Resets the byte counters, for measuring one phase. */
  resetCounters(): void {
    for (const d of [this.up, this.down]) {
      d.bytes = 0;
      d.chunks = 0;
      d.stalls = 0;
    }
  }

  /** Every connection through the proxy dies now: a phone that lost its network. */
  cut(): void {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
  }

  /** Nothing is delivered for `ms`, then everything that queued is, in order. */
  blackout(ms: number): void {
    this.blackoutUntil = Date.now() + ms;
  }

  async close(): Promise<void> {
    this.cut();
    await new Promise<void>((resolve) =>
      this.server ? this.server.close(() => resolve()) : resolve(),
    );
  }

  private delay(dir: Direction): number {
    const p = this.profile;
    const now = Date.now();
    let at = now + p.latencyMs + this.rng() * p.jitterMs;
    if (p.lossRate > 0 && this.rng() < p.lossRate) {
      at += Math.max(200, 4 * p.latencyMs);
      dir.stalls += 1;
    }
    at = Math.max(at, dir.lastAt, this.blackoutUntil);
    dir.lastAt = at;
    return Math.max(0, at - now);
  }

  private pipe(downstream: net.Socket): void {
    const upstream = net.connect(this.targetPort, this.targetHost);
    this.sockets.add(downstream);
    this.sockets.add(upstream);
    downstream.setNoDelay(true);
    upstream.setNoDelay(true);
    const forward = (from: net.Socket, to: net.Socket, dir: Direction) => {
      // One FIFO per direction and connection, drained by a single timer: separate timers per
      // chunk can fire out of order when their deadlines meet, which TCP never does.
      const queue: Array<{ at: number; chunk: Buffer | null }> = [];
      let timer: ReturnType<typeof setTimeout> | null = null;
      const drain = () => {
        timer = null;
        const now = Date.now();
        while (queue.length > 0 && queue[0]!.at <= now) {
          const { chunk } = queue.shift()!;
          if (chunk === null) to.end();
          else if (!to.destroyed) to.write(chunk);
        }
        if (queue.length > 0) timer = setTimeout(drain, Math.max(0, queue[0]!.at - Date.now()));
      };
      const push = (at: number, chunk: Buffer | null) => {
        queue.push({ at, chunk });
        if (timer === null) timer = setTimeout(drain, Math.max(0, queue[0]!.at - Date.now()));
      };
      from.on('data', (chunk: Buffer) => {
        dir.bytes += chunk.length;
        dir.chunks += 1;
        push(Date.now() + this.delay(dir), chunk);
      });
      // Close after whatever is still in flight has been delivered.
      from.on('end', () => push(Math.max(Date.now(), dir.lastAt) + 1, null));
      to.on('close', () => {
        if (timer !== null) clearTimeout(timer);
        queue.length = 0;
      });
    };
    forward(downstream, upstream, this.up);
    forward(upstream, downstream, this.down);
    const kill = () => {
      downstream.destroy();
      upstream.destroy();
      this.sockets.delete(downstream);
      this.sockets.delete(upstream);
    };
    downstream.on('error', kill);
    upstream.on('error', kill);
    downstream.on('close', kill);
    upstream.on('close', kill);
  }
}
