import { readFile } from "node:fs/promises";

import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";

import { assertToolOutput, validateJsonSchema } from "../../src/policy/engine.js";

describe("policy JSON Schema engine", () => {
  it("validates with Ajv JSON Schema features beyond the old handwritten subset", () => {
    const schema = {
      type: "object",
      properties: {
        op: { const: "write" },
        payload: {
          oneOf: [
            {
              type: "object",
              properties: { content: { type: "string", minLength: 1 } },
              required: ["content"],
              additionalProperties: false,
            },
            {
              type: "object",
              properties: { lines: { type: "array", items: { type: "string" }, minItems: 1 } },
              required: ["lines"],
              additionalProperties: false,
            },
          ],
        },
      },
      required: ["op", "payload"],
      additionalProperties: false,
    };

    expect(() => validateJsonSchema(schema, { op: "write", payload: { lines: ["ok"] } })).not.toThrow();
    expect(() => validateJsonSchema(schema, { op: "write", payload: {} })).toThrow(
      "input.payload.content is required",
    );
  });

  it("keeps stable validation messages for common tool input failures", () => {
    const schema = {
      type: "object",
      properties: {
        changes: { type: "array", maxItems: 1, items: { type: "object" } },
      },
      required: ["changes"],
      additionalProperties: false,
    };

    expect(() => validateJsonSchema(schema, { changes: [{}], title: "bad" })).toThrow(
      "input.title is not allowed",
    );
    expect(() => validateJsonSchema(schema, { changes: [{}, {}] })).toThrow(
      "input.changes has too many items",
    );
  });

  it("rejects unsafe schema refs, complex regex patterns, and excessive depth", () => {
    expect(() => validateJsonSchema({ $ref: "https://example.com/schema.json" }, {})).toThrow(
      "input.$ref remote refs are not allowed",
    );
    expect(() => validateJsonSchema({ type: "string", pattern: "(a+)+$" }, "aaa")).toThrow(
      "input.pattern pattern is too complex",
    );
    expect(() => validateJsonSchema(deepObjectSchema(70), {})).toThrow("schema is too deep");
  });

  it("validates structured tool output against output schemas", () => {
    const schema = {
      type: "object",
      properties: {
        status: { const: "ok" },
        hostRisk: { type: "string", enum: ["low", "medium", "high"] },
      },
      required: ["status", "hostRisk"],
      additionalProperties: false,
    };

    expect(() => assertToolOutput(schema, { status: "ok", hostRisk: "low" })).not.toThrow();
    expect(() => assertToolOutput(schema, { status: "ok" })).toThrow("output.hostRisk is required");
  });

  it("validates built-in v3 policies with the generated policy schema", async () => {
    const schema = JSON.parse(await readFile("policies/schema.json", "utf8"));
    const dev = parseYaml(await readFile("policies/dev.yaml", "utf8"));
    const readOnly = parseYaml(await readFile("policies/read-only.yaml", "utf8"));

    expect(() => validateJsonSchema(schema, dev, "policy")).not.toThrow();
    expect(() => validateJsonSchema(schema, readOnly, "policy")).not.toThrow();
  });
});

function deepObjectSchema(depth: number): Record<string, unknown> {
  let schema: Record<string, unknown> = { type: "string" };
  for (let index = 0; index < depth; index += 1) {
    schema = {
      type: "object",
      properties: { child: schema },
    };
  }
  return schema;
}
