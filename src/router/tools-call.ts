import stableStringify from "fast-json-stable-stringify";

import { interpolateValue } from "../config/interpolation.js";
import { assertToolInput } from "../policy/engine.js";
import { assertInputPolicy, selectFields } from "../policy/matcher.js";
import type { RelayPolicy, ToolPolicy } from "../policy/policy.js";
import { AuditLog, buildAuditRecord } from "../state/audit.js";
import { redactJson } from "../state/redaction.js";
import type { UpstreamManager } from "../upstream/manager.js";
import type { RegisteredTool } from "../upstream/registry.js";
import { ForbiddenError, TimeoutError, toError } from "../util/errors.js";
import { sha256 } from "../util/hash.js";
import { assertToolAllowed } from "./namespace.js";
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

type PreviewRecord = {
  clientId?: string;
  tool: string;
  hash: string;
  expiresAt: number;
};

export class ToolRouter {
  private previews: PreviewRecord[] = [];
  private rateWindows = new Map<string, number[]>();

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
      args = assertToolInput(entry.policy, rawArgs);
      this.assertRateLimit(caller);
      const output = await this.withTimeout(
        this.execute(entry.policy, args, caller),
        this.toolTimeoutMs(entry.policy, args),
        name,
      );
      const finalOutput = this.prepareOutput(output);
      this.rememberPreview(name, args, caller);
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
        }),
      );
      throw err;
    }
  }

  private async execute(
    tool: ToolPolicy,
    args: Record<string, unknown>,
    caller: CallerIdentity,
  ): Promise<unknown> {
    if (tool.type === "builtIn") return this.callBuiltIn(tool.name);
    if (tool.type === "passThrough") {
      assertInputPolicy({
        policy: tool.inputPolicy,
        args,
        workspace: this.options.policy.workspace,
        workspaceRoot: this.options.workspaceRoot,
      });
      this.assertPreviewIfRequired(tool, args, caller);
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

  private callBuiltIn(name: string): unknown {
    if (name === "relay.info") {
      return {
        name: "webvibe",
        mode: this.options.policy.mode,
        tools: Array.from(this.options.registry.keys()),
      };
    }
    if (name === "relay.list_upstreams") {
      return { upstreams: this.options.upstreams.listHealth() };
    }
    if (name === "relay.list_tools") {
      return { tools: Array.from(this.options.registry.values()).map((entry) => entry.descriptor) };
    }
    throw new ForbiddenError(`Unknown built-in tool: ${name}`);
  }

  private assertPreviewIfRequired(
    tool: Extract<ToolPolicy, { type: "passThrough" }>,
    args: Record<string, unknown>,
    caller: CallerIdentity,
  ): void {
    const previewPolicy = tool.inputPolicy?.requirePriorPreview;
    if (!previewPolicy) return;
    const expectedHash = sha256(selectFields(args, previewPolicy.matchFields));
    const now = Date.now();
    this.previews = this.previews.filter((record) => record.expiresAt > now);
    const found = this.previews.find(
      (record) =>
        record.clientId === caller.clientId &&
        record.tool === previewPolicy.previewTool &&
        record.hash === expectedHash,
    );
    if (!found) throw new ForbiddenError("Tool call requires matching prior preview");
  }

  private rememberPreview(
    name: string,
    args: Record<string, unknown>,
    caller: CallerIdentity,
  ): void {
    const ttlSeconds = this.findLongestPreviewTtl(name);
    if (!ttlSeconds) return;
    for (const fields of this.findPreviewFieldSets(name)) {
      this.previews.push({
        clientId: caller.clientId,
        tool: name,
        hash: sha256(selectFields(args, fields)),
        expiresAt: Date.now() + ttlSeconds * 1000,
      });
    }
  }

  private findPreviewFieldSets(name: string): string[][] {
    const fieldSets: string[][] = [];
    for (const entry of this.options.registry.values()) {
      const tool = entry.policy;
      if (tool.type !== "passThrough") continue;
      const preview = tool.inputPolicy?.requirePriorPreview;
      if (preview?.previewTool === name) fieldSets.push(preview.matchFields);
    }
    return fieldSets;
  }

  private findLongestPreviewTtl(name: string): number {
    let ttl = 0;
    for (const entry of this.options.registry.values()) {
      const tool = entry.policy;
      if (tool.type !== "passThrough") continue;
      const preview = tool.inputPolicy?.requirePriorPreview;
      if (preview?.previewTool === name) ttl = Math.max(ttl, preview.ttlSeconds ?? 300);
    }
    return ttl;
  }

  private prepareOutput(output: unknown): unknown {
    const redacted = redactJson(output);
    const maxBytes = this.options.policy.limits.maxToolOutputBytes;
    const text = stableStringify(redacted);
    if (Buffer.byteLength(text) <= maxBytes) return redacted;
    return {
      truncated: true,
      text: Buffer.from(text).subarray(0, maxBytes).toString("utf8"),
    };
  }

  private assertRateLimit(caller: CallerIdentity): void {
    const limit = this.options.policy.limits.maxCallsPerMinute;
    const key = caller.clientId ?? caller.subject ?? "anonymous";
    const now = Date.now();
    const windowStart = now - 60_000;
    const current = (this.rateWindows.get(key) ?? []).filter(
      (timestamp) => timestamp > windowStart,
    );
    if (current.length >= limit) throw new ForbiddenError("Rate limit exceeded");
    current.push(now);
    this.rateWindows.set(key, current);
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    toolName: string,
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new TimeoutError(`Tool '${toolName}' timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private toolTimeoutMs(tool: ToolPolicy, args: Record<string, unknown>): number {
    if (tool.type !== "workflow" || !tool.timeoutSeconds)
      return this.options.policy.limits.timeoutMs;
    const raw = args.timeoutSeconds;
    const requested = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : undefined;
    const seconds = Math.min(
      Math.max(requested ?? tool.timeoutSeconds.default, 1),
      tool.timeoutSeconds.maximum,
    );
    return (seconds + (tool.timeoutSeconds.bufferSeconds ?? 5)) * 1000;
  }
}
