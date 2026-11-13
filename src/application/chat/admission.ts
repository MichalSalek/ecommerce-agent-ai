export type Admission =
  | { allowed: true; release: () => void }
  | { allowed: false; retryAfter: number; reason: "busy" | "rate" };
// A single-instance demo guard, separate from upstream model quotas. No IP/header trust is needed.
export class ChatAdmission {
  private active = 0;
  private timestamps: number[] = [];
  constructor(
    private readonly maxConcurrent: number,
    private readonly maxRequests: number,
    private readonly windowMs: number,
  ) {}
  acquire(now = Date.now()): Admission {
    this.timestamps = this.timestamps.filter(
      (time) => time > now - this.windowMs,
    );
    if (this.active >= this.maxConcurrent)
      return { allowed: false, reason: "busy", retryAfter: 5 };
    if (this.timestamps.length >= this.maxRequests)
      return {
        allowed: false,
        reason: "rate",
        retryAfter: Math.max(
          1,
          Math.ceil((this.timestamps[0] + this.windowMs - now) / 1000),
        ),
      };
    this.timestamps.push(now);
    this.active++;
    let released = false;
    return {
      allowed: true,
      release: () => {
        if (!released) {
          released = true;
          this.active--;
        }
      },
    };
  }
}
