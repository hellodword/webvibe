import type { UpstreamHealth } from "./client.js";

export function summarizeHealth(health: UpstreamHealth[]): Record<string, unknown>[] {
  return health.map((item) => ({
    id: item.id,
    healthy: item.healthy,
    optional: item.optional,
    error: item.error,
  }));
}
