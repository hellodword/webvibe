import type { JsonSchema } from "./types.js";

export const emptyObjectSchema = (): JsonSchema => objectSchema({}, []);

export function objectSchema(
  properties: Record<string, unknown>,
  required: string[] = Object.keys(properties),
  additionalProperties = false,
): JsonSchema {
  return {
    type: "object",
    properties,
    required,
    additionalProperties,
  };
}

export function recordSchema(): JsonSchema {
  return { type: "object", additionalProperties: true };
}

export function arraySchema(items: unknown, options: Record<string, unknown> = {}): JsonSchema {
  return { type: "array", items, ...options };
}

export function stringArraySchema(options: Record<string, unknown> = {}): JsonSchema {
  return arraySchema(stringSchema(), options);
}

export function stringSchema(options: Record<string, unknown> = {}): JsonSchema {
  return { type: "string", ...options };
}

export function integerSchema(options: Record<string, unknown> = {}): JsonSchema {
  return { type: "integer", ...options };
}

export function numberSchema(options: Record<string, unknown> = {}): JsonSchema {
  return { type: "number", ...options };
}

export function booleanSchema(): JsonSchema {
  return { type: "boolean" };
}

export function enumSchema(values: string[]): JsonSchema {
  return { type: "string", enum: values };
}

export function constSchema(value: unknown): JsonSchema {
  return { const: value };
}

export function nullable(schema: unknown): JsonSchema {
  return { anyOf: [schema, { type: "null" }] };
}

export function oneOf(schemas: unknown[]): JsonSchema {
  return { oneOf: schemas };
}

export function anyOf(schemas: unknown[]): JsonSchema {
  return { anyOf: schemas };
}

export function hostRiskSchema(): JsonSchema {
  return enumSchema(["low", "medium", "high"]);
}

export function nextSchema(additionalProperties = true): JsonSchema {
  return objectSchema(
    {
      tool: stringSchema(),
      reason: stringSchema(),
      alternatives: stringArraySchema(),
      args: recordSchema(),
    },
    ["tool", "reason"],
    additionalProperties,
  );
}

export function contentArraySchema(): JsonSchema {
  return arraySchema(
    objectSchema({
      type: enumSchema(["text"]),
      text: stringSchema(),
    }),
  );
}

export function envelopeSchema(data: unknown): JsonSchema {
  return objectSchema({
    ok: booleanSchema(),
    status: stringSchema(),
    data,
    warnings: arraySchema(recordSchema()),
    limits: objectSchema({
      requested: recordSchema(),
      effective: recordSchema(),
    }),
    truncated: booleanSchema(),
    nextCursor: nullable(stringSchema()),
    artifacts: arraySchema(recordSchema()),
  });
}

export function toolEnvelopeSchema(): JsonSchema {
  return envelopeSchema(recordSchema());
}

export function hostRiskObject(properties: Record<string, unknown>, required?: string[]): JsonSchema {
  return objectSchema(
    {
      status: stringSchema(),
      hostRisk: hostRiskSchema(),
      ...properties,
    },
    required ?? ["status", "hostRisk", ...Object.keys(properties)],
  );
}
