import { DEFAULT_SCHEMA_DEPTH_LIMIT } from "../policy/defaults.js";

export function capSchemaDepth(value: unknown, depth = DEFAULT_SCHEMA_DEPTH_LIMIT): unknown {
  if (Array.isArray(value)) return value.map((item) => capSchemaDepth(item, depth));
  if (typeof value !== "object" || value === null) return value;
  if (depth <= 0) return { type: "object", additionalProperties: true };

  const record = value as Record<string, unknown>;
  if (isPropertiesMap(record)) {
    return Object.fromEntries(
      Object.entries(record).map(([key, item]) => [key, capSchemaDepth(item, depth - 1)]),
    );
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, capSchemaEntry(key, item, depth)]),
  );
}

function capSchemaEntry(key: string, value: unknown, depth: number): unknown {
  if (key === "properties" && isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([property, schema]) => [
        property,
        capSchemaDepth(schema, depth - 1),
      ]),
    );
  }
  if (key === "items") {
    return Array.isArray(value)
      ? value.map((item) => capSchemaDepth(item, depth - 1))
      : capSchemaDepth(value, depth - 1);
  }
  if ((key === "oneOf" || key === "anyOf" || key === "allOf") && Array.isArray(value)) {
    return value.map((item) => capSchemaDepth(item, depth - 1));
  }
  if ((key === "not" || key === "additionalProperties") && isRecord(value)) {
    return capSchemaDepth(value, depth - 1);
  }
  return value;
}

function isPropertiesMap(value: Record<string, unknown>): boolean {
  return !("type" in value) && !("properties" in value) && !("items" in value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value === "object" && value !== null) {
    return !Array.isArray(value);
  }
  return false;
}
