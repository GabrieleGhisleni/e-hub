/** Sliding-window limiter: at most `max` acquisitions per `windowMs`. Default 100 per 5 minutes. */
export class RateLimiter {
  readonly max: number;
  readonly windowMs: number;
  private readonly stamps: number[] = [];
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    options: {
      max?: number;
      windowMs?: number;
      now?: () => number;
      sleep?: (ms: number) => Promise<void>;
    } = {},
  ) {
    this.max = options.max ?? 100;
    this.windowMs = options.windowMs ?? 5 * 60_000;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** Resolves when a request slot is available (callers are served in order). */
  acquire(): Promise<void> {
    const next = this.chain.then(() => this.take());
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async take(): Promise<void> {
    for (;;) {
      const now = this.now();
      while (this.stamps.length > 0 && now - this.stamps[0]! >= this.windowMs) this.stamps.shift();
      if (this.stamps.length < this.max) {
        this.stamps.push(now);
        return;
      }
      await this.sleep(Math.max(1, this.stamps[0]! + this.windowMs - now));
    }
  }
}
