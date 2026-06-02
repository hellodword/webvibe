import type { ToolPolicy } from "../policy/policy.js";
import { TimeoutError } from "../util/errors.js";

export async function withToolTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  toolName: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new TimeoutError(`Tool '${toolName}' timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function toolTimeoutMs(
  tool: ToolPolicy,
  args: Record<string, unknown>,
  defaultTimeoutMs: number,
): number {
  if (tool.type !== "workflow" || !tool.timeoutSeconds) return defaultTimeoutMs;
  const raw = args.timeoutSeconds;
  const requested = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : undefined;
  const seconds = Math.min(
    Math.max(requested ?? tool.timeoutSeconds.default, 1),
    tool.timeoutSeconds.maximum,
  );
  return (seconds + (tool.timeoutSeconds.bufferSeconds ?? 5)) * 1000;
}
