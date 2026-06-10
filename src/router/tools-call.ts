import { interpolateValue } from "../config/interpolation.js";
import { ManualPendingStore } from "../manual/pending-store.js";
import { buildManualActionScope } from "../manual/scope.js";
import type { ManualActionRecord } from "../manual/types.js";
import { assertToolInput, assertToolOutput } from "../policy/engine.js";
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
import type { RecentToolError } from "./context.js";
import {
  buildPreflightFingerprint,
  fingerprintsEqual,
  type PreflightFingerprint,
} from "./tool-surface.js";
import { executeWorkflow } from "./workflow.js";

export type CallerIdentity = {
  clientId?: string;
  subject?: string;
  openaiSession?: string;
  openaiOrganization?: string;
  openaiUserAgent?: string;
};

export type ToolCallOptions = {
  registry: Map<string, RegisteredTool>;
  policy: RelayPolicy;
  upstreams: UpstreamManager;
  audit: AuditLog;
  workspaceRoot: string;
  stateDir: string;
  publicBaseUrl: string;
};

export class ToolRouter {
  private readonly rateLimiter = new RateLimiter();
  private readonly recentToolErrors: RecentToolError[] = [];
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
      this.rateLimiter.assertAllowed(caller, this.options.policy.limits.rate.maxCallsPerMinute);
      const manualBlock = await this.manualPendingBlock(name, caller);
      if (manualBlock) {
        const finalOutput = prepareToolOutput(
          attachHostRisk(manualBlock, hostRiskForTool(entry.policy)),
          this.options.policy.limits.output.maxToolOutputBytes,
          this.toolOutputLimits(),
        );
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
            output: manualBlock,
            clientOutput: finalOutput,
            errorCode: manualBlock.code,
          }),
        );
        return finalOutput;
      }
      const contextBlock = this.contextBlock(name, caller);
      if (contextBlock) {
        const finalOutput = prepareToolOutput(
          attachHostRisk(contextBlock, hostRiskForTool(entry.policy)),
          this.options.policy.limits.output.maxToolOutputBytes,
          this.toolOutputLimits(),
        );
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
            clientOutput: finalOutput,
            errorCode: contextBlock.code,
          }),
        );
        return finalOutput;
      }
      args = assertToolInput(entry.policy, rawArgs);
      const output = await withToolTimeout(
        this.execute(entry.policy, args, caller),
        this.toolCallTimeoutMs(entry.policy, args),
        name,
      );
      const outputWithRisk = attachHostRisk(output, hostRiskForTool(entry.policy));
      assertToolOutput(entry.descriptor.outputSchema, outputWithRisk);
      if (name === "workspace.context") {
        this.preflight.set(this.callerKey(caller), {
          inspectedAt: new Date().toISOString(),
          fingerprint: this.currentFingerprint(),
        });
      }
      const finalOutput = prepareToolOutput(
        outputWithRisk,
        this.options.policy.limits.output.maxToolOutputBytes,
        this.toolOutputLimits(),
      );
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
          rawOutput: outputWithRisk,
          clientOutput: finalOutput,
        }),
      );
      return finalOutput;
    } catch (error) {
      const err = toError(error);
      const errorCode =
        "code" in err && typeof (err as any).code === "string" ? (err as any).code : undefined;
      this.recordToolError({
        timestamp: new Date().toISOString(),
        tool: name,
        type: entry?.policy.type ?? "unknown",
        code: errorCode,
        message: err.message,
      });
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
          rawOutput: null,
          clientOutput: null,
          error: err.message,
          errorStack: err.stack,
          errorCode,
        }),
      );
      throw err;
    }
  }

  private contextBlock(
    name: string,
    caller: CallerIdentity,
  ): { status: "blocked"; code: "CONTEXT_REQUIRED"; message: string; nextTool: "workspace.context"; reason: string } | undefined {
    if (isContextPreflightAllowedTool(name)) return undefined;
    const state = this.preflight.get(this.callerKey(caller));
    if (!state) return contextRequired("missing");
    if (!fingerprintsEqual(state.fingerprint, this.currentFingerprint())) return contextRequired("stale");
    return undefined;
  }

  private async manualPendingBlock(
    name: string,
    caller: CallerIdentity,
  ): Promise<ManualPendingBlockedResult | undefined> {
    if (isManualBarrierAllowedTool(name)) return undefined;
    const store = new ManualPendingStore(this.options.stateDir);
    const scope = buildManualActionScope({
      workspaceRoot: this.options.workspaceRoot,
      caller,
    });
    const expired = await store.expirePendingForScope(scope);
    for (const record of expired) {
      await this.options.audit.write({
        timestamp: new Date().toISOString(),
        event: "manual.gate.expired",
        operationId: record.operationId,
        preparedId: record.preparedId,
        pendingId: record.pendingId,
        tool: "manual.gate",
        type: "builtIn",
        status: "ok",
        rawOutput: {
          reason: "manual_action_expired",
          expiresAt: record.expiresAt,
        },
      });
    }
    const pending = await store.firstBlockingPending(scope);
    return pending ? manualPendingRequired(pending) : undefined;
  }

  private callerKey(caller: CallerIdentity): string {
    return caller.openaiSession ?? caller.subject ?? caller.clientId ?? "anonymous";
  }

  private currentFingerprint(): PreflightFingerprint {
    return buildPreflightFingerprint({
      workspaceRoot: this.options.workspaceRoot,
      policy: this.options.policy,
      registry: this.options.registry,
      upstreams: this.options.upstreams,
    });
  }

  private toolOutputLimits(): Record<string, unknown> {
    return {
      output: this.options.policy.limits.output,
      activeProfile: this.options.policy.activeProfile,
    };
  }

  private toolCallTimeoutMs(tool: ToolPolicy, args: Record<string, unknown>): number {
    if (tool.type === "builtIn" && tool.name === "task.run") {
      const taskId = typeof args.taskId === "string" ? args.taskId : "";
      const task = this.options.policy.upstreams.tasks?.tasks?.[taskId];
      const raw = args.timeoutSeconds;
      const requested =
        typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : undefined;
      const defaultSeconds =
        task?.defaultTimeoutSeconds ?? this.options.policy.limits.task.defaultTimeoutSeconds;
      const maxSeconds = task?.maxTimeoutSeconds ?? this.options.policy.limits.task.maxTimeoutSeconds;
      const seconds = Math.min(Math.max(requested ?? defaultSeconds, 1), maxSeconds);
      return (seconds + 5) * 1000;
    }
    return toolTimeoutMs(
      tool,
      args,
      this.options.policy.limits.task.defaultTimeoutSeconds * 1000,
    );
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
        stateDir: this.options.stateDir,
        publicBaseUrl: this.options.publicBaseUrl,
        caller,
        audit: this.options.audit,
        recentToolErrors: this.recentToolErrors.slice(),
      });
    }
    if (tool.type === "passThrough") {
      if (!this.options.upstreams.isAvailable(tool.upstream)) {
        return {
          status: "unavailable",
          toolName: tool.name,
          upstream: tool.upstream,
          upstreamTool: tool.upstreamTool,
          unavailableReason: `Optional upstream '${tool.upstream}' is unavailable`,
          next: { tool: "manual.prepare", reason: "upstream_unavailable" },
        };
      }
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

  private recordToolError(error: RecentToolError): void {
    this.recentToolErrors.push(error);
    if (this.recentToolErrors.length > 10) {
      this.recentToolErrors.splice(0, this.recentToolErrors.length - 10);
    }
  }
}

type ManualPendingBlockedResult = {
  status: "blocked";
  code: "MANUAL_PENDING_REQUIRED";
  message: string;
  reason: "manual_action_pending";
  pendingId: string;
  operationId: string;
  preparedId?: string;
  expiresAt: string;
  resumeTool: "manual.resume";
  nextAction: "reply_with_resume_command";
};

type HostRisk = "low" | "medium" | "high";

function hostRiskForTool(tool: ToolPolicy): HostRisk {
  if (tool.type === "builtIn") {
    if (
      [
        "workspace.context",
        "workspace.scan",
        "workspace.symbols",
        "diagnostics.health",
        "fs.search",
        "fs.tree",
        "fs.read",
        "fs.read_many",
        "fs.stat",
        "fs.manifest",
        "git.status",
        "git.changed",
        "git.diff",
        "git.show",
        "git.blame",
        "git.commit_preview",
        "task.list",
        "task.explain",
        "task.result",
        "manual.prepare",
        "manual.status",
        "manual.resume",
      ].includes(tool.name)
    ) {
      return "low";
    }
    if (tool.name === "manual.gate") return "low";
    if (tool.name === "batch.change_apply" || tool.name === "change.apply") return "high";
    if (tool.name === "file.change_apply" || tool.name === "task.run" || tool.name === "git.commit") {
      return "medium";
    }
    if (tool.name === "file.change_preview" || tool.name === "batch.change_preview" || tool.name === "change.preview") {
      return "medium";
    }
  }
  if (tool.annotations?.readOnlyHint === true) return "low";
  if (tool.annotations?.destructiveHint === true) return "high";
  return "medium";
}

function attachHostRisk(output: unknown, risk: HostRisk): unknown {
  if (!isPlainRecord(output)) return output;
  if (isEnvelopeLike(output) && isPlainRecord(output.data)) {
    return { ...output, data: withHostRisk(output.data, risk) };
  }
  return withHostRisk(output, risk);
}

function withHostRisk(output: Record<string, unknown>, risk: HostRisk): Record<string, unknown> {
  if (typeof output.hostRisk === "string") return output;
  return { ...output, hostRisk: risk };
}

function isEnvelopeLike(output: Record<string, unknown>): output is Record<string, unknown> & { data: unknown } {
  return typeof output.ok === "boolean" && typeof output.status === "string" && "data" in output;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isManualBarrierAllowedTool(name: string): boolean {
  return name === "diagnostics.health" || name === "manual.resume" || name === "manual.status";
}

function isContextPreflightAllowedTool(name: string): boolean {
  return name === "workspace.context" || name === "diagnostics.health" || name === "manual.resume" || name === "manual.status";
}

function manualPendingRequired(record: ManualActionRecord): ManualPendingBlockedResult {
  return {
    status: "blocked",
    code: "MANUAL_PENDING_REQUIRED",
    message:
      "A manual action is still pending for this ChatGPT session. The next user message must begin with /resume. Call manual.resume with that message to confirm or cancel before continuing.",
    reason: "manual_action_pending",
    pendingId: record.pendingId,
    operationId: record.operationId,
    preparedId: record.preparedId,
    expiresAt: record.expiresAt,
    resumeTool: "manual.resume",
    nextAction: "reply_with_resume_command",
  };
}

function contextRequired(reason: string): {
  status: "blocked";
  code: "CONTEXT_REQUIRED";
  message: string;
  nextTool: "workspace.context";
  reason: string;
} {
  return {
    status: "blocked",
    code: "CONTEXT_REQUIRED",
    message: "Call workspace.context before using workspace tools.",
    nextTool: "workspace.context",
    reason,
  };
}
