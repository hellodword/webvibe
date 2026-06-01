import { interpolateValue, type InterpolationContext } from "../config/interpolation.js";
import type { UpstreamManager } from "../upstream/manager.js";
import type { WorkflowToolPolicy } from "../policy/policy.js";

export async function executeWorkflow(input: {
  tool: WorkflowToolPolicy;
  args: Record<string, unknown>;
  upstreams: UpstreamManager;
  context: Omit<InterpolationContext, "input" | "vars">;
  onStep?: (step: {
    upstream: string;
    tool: string;
    input: Record<string, unknown>;
    output: unknown;
    startedAt: number;
  }) => Promise<void>;
}): Promise<unknown> {
  const vars: Record<string, unknown> = {};
  let lastOutput: unknown = null;
  for (const step of input.tool.steps) {
    if (!input.upstreams.isAvailable(step.call.upstream)) {
      if (step.optional) continue;
      throw new Error(`Workflow upstream '${step.call.upstream}' is unavailable`);
    }
    const startedAt = Date.now();
    const stepInput = interpolateValue(step.call.input, {
      ...input.context,
      input: input.args,
      vars,
    });
    const normalizedInput =
      typeof stepInput === "object" && stepInput !== null && !Array.isArray(stepInput)
        ? (stepInput as Record<string, unknown>)
        : {};
    lastOutput = await input.upstreams.call(step.call.upstream, step.call.tool, normalizedInput);
    if (step.saveAs) vars[step.saveAs] = lastOutput;
    await input.onStep?.({
      upstream: step.call.upstream,
      tool: step.call.tool,
      input: normalizedInput,
      output: lastOutput,
      startedAt,
    });
  }
  return lastOutput;
}
