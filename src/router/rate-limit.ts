import type { CallerIdentity } from "./tools-call.js";
import { ForbiddenError } from "../util/errors.js";

export class RateLimiter {
  private readonly windows = new Map<string, number[]>();

  assertAllowed(caller: CallerIdentity, maxCallsPerMinute: number): void {
    const key = caller.clientId ?? caller.subject ?? "anonymous";
    const now = Date.now();
    const windowStart = now - 60_000;
    const current = (this.windows.get(key) ?? []).filter((timestamp) => timestamp > windowStart);
    if (current.length >= maxCallsPerMinute) throw new ForbiddenError("Rate limit exceeded");
    current.push(now);
    this.windows.set(key, current);
  }
}
