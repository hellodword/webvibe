import { readOnlyAnnotations } from "./common.js";
import {
  arraySchema,
  booleanSchema,
  emptyObjectSchema,
  enumSchema,
  hostRiskSchema,
  integerSchema,
  nextSchema,
  nullable,
  objectSchema,
  recordSchema,
  stringArraySchema,
  stringSchema,
} from "./schemas.js";
import type { ToolContract } from "./types.js";

export const diagnosticsContracts: ToolContract[] = [
  {
    name: "diagnostics.health",
    modes: ["read-only", "dev"],
    description: "Return webvibe relay diagnostics, tool surface version, hashes, and upstream health.",
    annotations: readOnlyAnnotations,
    inputSchema: emptyObjectSchema(),
    outputSchema: objectSchema({
      status: enumSchema(["ok"]),
      hostRisk: hostRiskSchema(),
      truncated: booleanSchema(),
      nextCursor: nullable(stringSchema()),
      name: stringSchema(),
      server: objectSchema({
        name: stringSchema(),
        version: stringSchema(),
      }),
      mode: enumSchema(["read-only", "dev"]),
      activeProfile: stringSchema(),
      policy: recordSchema(),
      toolSurface: objectSchema({
        version: stringSchema(),
        hash: stringSchema(),
        toolCount: integerSchema({ minimum: 0 }),
        tools: stringArraySchema(),
      }),
      instructions: objectSchema({
        version: stringSchema(),
        hash: stringSchema(),
      }),
      validFor: recordSchema(),
      upstreams: arraySchema(recordSchema()),
      recentToolErrors: arraySchema(recordSchema()),
      next: nextSchema(),
    }),
    examples: [{ name: "health", args: {} }],
    instructionExample: {},
    docsSummary: "Reports relay, policy, tool surface, instruction, upstream, and recent tool error diagnostics.",
    risk: "low",
  },
];
