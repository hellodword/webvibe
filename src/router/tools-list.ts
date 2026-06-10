import type { RegisteredTool } from "../upstream/registry.js";

export function toolsList(registry: Map<string, RegisteredTool>): { tools: unknown[]; nextCursor: null } {
  return {
    tools: Array.from(registry.values()).map((entry) => entry.descriptor),
    nextCursor: null,
  };
}
