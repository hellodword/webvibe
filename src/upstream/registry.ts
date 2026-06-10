import { normalizeDescriptor, type McpToolDescriptor } from "../descriptor/normalize.js";
import type { UpstreamManager } from "./manager.js";
import type { RelayPolicy, ToolPolicy, WorkflowToolPolicy } from "../policy/policy.js";

export type RegisteredTool = {
  policy: ToolPolicy;
  descriptor: McpToolDescriptor;
};

export function buildRegistry(
  policy: RelayPolicy,
  upstreams: UpstreamManager,
): Map<string, RegisteredTool> {
  const registry = new Map<string, RegisteredTool>();
  for (const tool of policy.tools) {
    if (tool.type === "builtIn") {
      registry.set(tool.name, { policy: tool, descriptor: normalizeDescriptor(tool) });
      continue;
    }
    if (tool.type === "passThrough") {
      if (!upstreams.isAvailable(tool.upstream)) {
        if (tool.optional) {
          registry.set(tool.name, { policy: tool, descriptor: normalizeDescriptor(tool) });
          continue;
        }
        continue;
      }
      const upstreamDescriptor = upstreams.getToolDescriptor(tool.upstream, tool.upstreamTool);
      if (!upstreamDescriptor && tool.optional) continue;
      registry.set(tool.name, {
        policy: tool,
        descriptor: normalizeDescriptor(tool, upstreamDescriptor),
      });
      continue;
    }
    if (workflowAvailable(tool, upstreams)) {
      registry.set(tool.name, { policy: tool, descriptor: normalizeDescriptor(tool) });
    }
  }
  return registry;
}

function workflowAvailable(tool: WorkflowToolPolicy, upstreams: UpstreamManager): boolean {
  const missing = tool.steps.some(
    (step) => !step.optional && !upstreams.isAvailable(step.call.upstream),
  );
  return !missing;
}
