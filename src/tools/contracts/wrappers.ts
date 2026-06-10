import { objectSchema, recordSchema, stringSchema } from "./schemas.js";
import type { JsonSchema } from "./types.js";

export function unavailableWrapperOutputSchema(): JsonSchema {
  return objectSchema(
    {
      status: { enum: ["unavailable"] },
      hostRisk: { enum: ["low", "medium", "high"] },
      toolName: stringSchema(),
      upstream: stringSchema(),
      upstreamTool: stringSchema(),
      unavailableReason: stringSchema(),
      next: recordSchema(),
    },
    ["status", "hostRisk", "toolName", "upstream", "upstreamTool", "unavailableReason", "next"],
  );
}
