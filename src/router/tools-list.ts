import type { RegisteredTool } from "../upstream/registry.js";

export function toolsList(registry: Map<string, RegisteredTool>): { tools: unknown[] } {
  return {
    tools: Array.from(registry.values()).map((entry) => entry.descriptor),
  };
}
