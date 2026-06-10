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
  const warnings: Array<Record<string, unknown>> = [];
  for (const step of input.tool.steps) {
    if (!input.upstreams.isAvailable(step.call.upstream)) {
      const warning = workflowStepWarning(step.call.upstream, step.call.tool, "upstream_unavailable");
      if (step.optional) {
        warnings.push(warning);
        continue;
      }
      return workflowFailed(warning, warnings);
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
    try {
      lastOutput = await input.upstreams.call(step.call.upstream, step.call.tool, normalizedInput);
    } catch (error) {
      const warning = workflowStepWarning(
        step.call.upstream,
        step.call.tool,
        error instanceof Error ? error.message : String(error),
      );
      if (step.optional) {
        warnings.push(warning);
        continue;
      }
      return workflowFailed(warning, warnings);
    }
    if (step.saveAs) vars[step.saveAs] = lastOutput;
    await input.onStep?.({
      upstream: step.call.upstream,
      tool: step.call.tool,
      input: normalizedInput,
      output: lastOutput,
      startedAt,
    });
  }
  if (warnings.length > 0) {
    return {
      ok: true,
      status: "ok",
      data: lastOutput,
      warnings,
      limits: { requested: {}, effective: {} },
      truncated: false,
      nextCursor: null,
      artifacts: [],
    };
  }
  return lastOutput;
}

function workflowStepWarning(upstream: string, tool: string, reason: string): Record<string, unknown> {
  return {
    code: "WORKFLOW_STEP_FAILED",
    upstream,
    tool,
    reason,
  };
}

function workflowFailed(
  failedStep: Record<string, unknown>,
  warnings: Array<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    status: "failed",
    failedStep,
    warnings,
    next: { tool: "manual.prepare", reason: "workflow_step_failed" },
  };
}
