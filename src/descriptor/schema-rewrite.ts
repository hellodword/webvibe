import { DEFAULT_SCHEMA_DEPTH_LIMIT } from "../policy/defaults.js";

export function capSchemaDepth(value: unknown, depth = DEFAULT_SCHEMA_DEPTH_LIMIT): unknown {
  if (depth <= 0) return { type: "object", additionalProperties: true };
  if (Array.isArray(value)) return value.map((item) => capSchemaDepth(item, depth - 1));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, capSchemaDepth(item, depth - 1)]),
    );
  }
  return value;
}
