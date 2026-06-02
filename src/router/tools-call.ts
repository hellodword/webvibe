import { interpolateValue } from "../config/interpolation.js";
import { assertToolInput } from "../policy/engine.js";
import { assertInputPolicy } from "../policy/matcher.js";
import type { RelayPolicy, ToolPolicy } from "../policy/policy.js";
import { AuditLog, buildAuditRecord } from "../state/audit.js";
import type { UpstreamManager } from "../upstream/manager.js";
import type { RegisteredTool } from "../upstream/registry.js";
import { toError } from "../util/errors.js";
import { callBuiltIn } from "./built-ins.js";
import { assertToolAllowed } from "./namespace.js";
import { prepareToolOutput } from "./output.js";
import { RateLimiter } from "./rate-limit.js";
import { toolTimeoutMs, withToolTimeout } from "./timeout.js";
import {
  buildPreflightFingerprint,
  fingerprintsEqual,
  type PreflightFingerprint,
} from "./tool-surface.js";
import { executeWorkflow } from "./workflow.js";

export type CallerIdentity = {
  clientId?: string;
  subject?: string;
};

export type ToolCallOptions = {
  registry: Map<string, RegisteredTool>;
  policy: RelayPolicy;
  upstreams: UpstreamManager;
  audit: AuditLog;
  workspaceRoot: string;
  stateDir: string;
};

export class ToolRouter {
  private readonly rateLimiter = new RateLimiter();
  private readonly preflight = new Map<
    string,
    { inspectedAt: string; fingerprint: PreflightFingerprint }
  >();

  constructor(private readonly options: ToolCallOptions) {}

  async call(name: string, rawArgs: unknown, caller: CallerIdentity): Promise<unknown> {
    const startedAt = Date.now();
    let entry: RegisteredTool | undefined;
    let args: Record<string, unknown> =
      typeof rawArgs === "object" && rawArgs !== null && !Array.isArray(rawArgs)
        ? (rawArgs as Record<string, unknown>)
        : {};
    try {
      assertToolAllowed(name, this.options.registry);
      entry = this.options.registry.get(name)!;
      this.rateLimiter.assertAllowed(caller, this.options.policy.limits.maxCallsPerMinute);
      const contextBlock = this.contextBlock(name, caller);
      if (contextBlock) {
        await this.options.audit.write(
          buildAuditRecord({
            clientId: caller.clientId,
            subject: caller.subject,
            tool: name,
            type: entry.policy.type,
            upstream: entry.policy.type === "passThrough" ? entry.policy.upstream : undefined,
            status: "blocked",
            startedAt,
            input: args,
            output: contextBlock,
            errorCode: contextBlock.code,
          }),
        );
        return contextBlock;
      }
      args = assertToolInput(entry.policy, rawArgs);
      const output = await withToolTimeout(
        this.execute(entry.policy, args, caller),
        toolTimeoutMs(entry.policy, args, this.options.policy.limits.timeoutMs),
        name,
      );
      if (name === "context.get") {
        this.preflight.set(this.callerKey(caller), {
          inspectedAt: new Date().toISOString(),
          fingerprint: this.currentFingerprint(),
        });
      }
      const finalOutput = prepareToolOutput(output, this.options.policy.limits.maxToolOutputBytes);
      await this.options.audit.write(
        buildAuditRecord({
          clientId: caller.clientId,
          subject: caller.subject,
          tool: name,
          type: entry.policy.type,
          upstream: entry.policy.type === "passThrough" ? entry.policy.upstream : undefined,
          status: "ok",
          startedAt,
          input: args,
          output: finalOutput,
        }),
      );
      return finalOutput;
    } catch (error) {
      const err = toError(error);
      await this.options.audit.write(
        buildAuditRecord({
          clientId: caller.clientId,
          subject: caller.subject,
          tool: name,
          type: entry?.policy.type ?? "unknown",
          upstream: entry?.policy.type === "passThrough" ? entry.policy.upstream : undefined,
          status: "error",
          startedAt,
          input: args,
          output: null,
          error: err.message,
          errorCode: "code" in err && typeof (err as any).code === "string" ? (err as any).code : undefined,
        }),
      );
      throw err;
    }
  }

  private contextBlock(
    name: string,
    caller: CallerIdentity,
  ): { status: "blocked"; code: "CONTEXT_REQUIRED"; message: string; nextTool: "context.get"; reason: string } | undefined {
    if (name === "context.get" || name === "diagnostics.health") return undefined;
    const state = this.preflight.get(this.callerKey(caller));
    if (!state) return contextRequired("missing");
    if (!fingerprintsEqual(state.fingerprint, this.currentFingerprint())) return contextRequired("stale");
    return undefined;
  }

  private callerKey(caller: CallerIdentity): string {
    return caller.subject ?? caller.clientId ?? "anonymous";
  }

  private currentFingerprint(): PreflightFingerprint {
    return buildPreflightFingerprint({
      workspaceRoot: this.options.workspaceRoot,
      policy: this.options.policy,
      registry: this.options.registry,
      upstreams: this.options.upstreams,
    });
  }

  private async execute(
    tool: ToolPolicy,
    args: Record<string, unknown>,
    caller: CallerIdentity,
  ): Promise<unknown> {
    if (tool.type === "builtIn") {
      return callBuiltIn(tool.name, args, {
        registry: this.options.registry,
        policy: this.options.policy,
        upstreams: this.options.upstreams,
        workspaceRoot: this.options.workspaceRoot,
      });
    }
    if (tool.type === "passThrough") {
      assertInputPolicy({
        policy: tool.inputPolicy,
        args,
        workspace: this.options.policy.workspace,
        workspaceRoot: this.options.workspaceRoot,
      });
      const upstreamInput = tool.mapInput
        ? (interpolateValue(tool.mapInput, {
            workspaceRoot: this.options.workspaceRoot,
            stateDir: this.options.stateDir,
            env: process.env,
            input: args,
          }) as Record<string, unknown>)
        : args;
      const output = await this.options.upstreams.call(
        tool.upstream,
        tool.upstreamTool,
        upstreamInput,
      );
      return tool.mapOutput
        ? interpolateValue(tool.mapOutput, {
            workspaceRoot: this.options.workspaceRoot,
            stateDir: this.options.stateDir,
            env: process.env,
            input: args,
            vars: { output },
          })
        : output;
    }
    return executeWorkflow({
      tool,
      args,
      upstreams: this.options.upstreams,
      context: {
        workspaceRoot: this.options.workspaceRoot,
        stateDir: this.options.stateDir,
        env: process.env,
      },
      onStep: async (step) => {
        await this.options.audit.write(
          buildAuditRecord({
            clientId: caller.clientId,
            subject: caller.subject,
            tool: `${tool.name}#${step.tool}`,
            type: "workflowStep",
            upstream: step.upstream,
            status: "ok",
            startedAt: step.startedAt,
            input: step.input,
            output: step.output,
          }),
        );
      },
    });
  }
}

function contextRequired(reason: string): {
  status: "blocked";
  code: "CONTEXT_REQUIRED";
  message: string;
  nextTool: "context.get";
  reason: string;
} {
  return {
    status: "blocked",
    code: "CONTEXT_REQUIRED",
    message: "Call context.get before using workspace tools.",
    nextTool: "context.get",
    reason,
  };
}
