import type { ToolAnnotations } from "../policy/policy.js";

export function mergeAnnotations(base: unknown, override?: ToolAnnotations): ToolAnnotations {
  const baseRecord = typeof base === "object" && base !== null ? (base as ToolAnnotations) : {};
  return {
    ...baseRecord,
    ...override,
  };
}
