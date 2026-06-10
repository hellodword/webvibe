import { mergeAnnotations } from "./annotations.js";
import { capSchemaDepth } from "./schema-rewrite.js";
import type { ToolPolicy } from "../policy/policy.js";

export type McpToolDescriptor = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
};

export function normalizeDescriptor(
  policyTool: ToolPolicy,
  upstreamDescriptor?: McpToolDescriptor,
): McpToolDescriptor {
  const description = policyTool.description ?? upstreamDescriptor?.description ?? policyTool.name;
  const inputSchema =
    "inputSchema" in policyTool && policyTool.inputSchema
      ? policyTool.inputSchema
      : (upstreamDescriptor?.inputSchema ?? { type: "object", additionalProperties: false });
  const policyOutputSchema =
    "outputSchema" in policyTool && policyTool.outputSchema
      ? policyTool.outputSchema
      : upstreamDescriptor?.outputSchema;
  const builtInSchema = policyTool.type === "builtIn" ? builtInOutputSchema(policyTool.name) : undefined;
  const outputSchema = builtInSchema ?? policyOutputSchema;
  const annotations = mergeAnnotations(upstreamDescriptor?.annotations, policyTool.annotations);

  return {
    name: policyTool.name,
    title: annotations.title ?? upstreamDescriptor?.title ?? policyTool.name,
    description: trimDescription(description),
    inputSchema: capSchemaDepth(inputSchema) as Record<string, unknown>,
    ...(outputSchema
      ? { outputSchema: capSchemaDepth(outputSchema) as Record<string, unknown> }
      : {}),
    annotations,
    _meta: {
      ...(policyTool.type === "builtIn" ? builtInInvocationMeta(policyTool.name) : {}),
      ...upstreamDescriptor?._meta,
      ...policyTool._meta,
      securitySchemes: [{ type: "oauth2", scopes: [] }],
    },
  };
}

function builtInOutputSchema(name: string): Record<string, unknown> | undefined {
  switch (name) {
    case "workspace.context":
      return objectSchema({
        status: stringEnum(["ok"]),
        hostRisk: hostRiskSchema(),
        truncated: booleanSchema(),
        nextCursor: nullableString(),
        toolSurface: objectSchema({
          version: stringSchema(),
          hash: stringSchema(),
          tools: stringArraySchema(),
        }),
        policy: objectSchema({
          profile: stringSchema(),
          hash: stringSchema(),
          effectiveLimits: recordSchema(),
        }),
        editMode: objectSchema({
          mode: stringEnum(["single", "batch"]),
          batchEnabled: booleanSchema(),
        }),
        validFor: recordSchema(),
        workspace: recordSchema(),
        capabilities: recordSchema(),
        hostConstraints: recordSchema(),
        hostRiskProfile: recordSchema(),
        project: recordSchema(),
        git: recordSchema(),
        tasks: recordSchema(),
        manualFallback: recordSchema(),
        upstreams: arraySchema(recordSchema()),
        warnings: stringArraySchema(),
        next: nextSchema(),
      });
    case "workspace.scan":
      return objectSchema({
        status: stringEnum(["ok"]),
        hostRisk: hostRiskSchema(),
        root: stringSchema(),
        project: recordSchema(),
        languages: stringArraySchema(),
        packageManagers: stringArraySchema(),
        frontend: arraySchema(recordSchema()),
        codegen: arraySchema(recordSchema()),
        taskFiles: arraySchema(recordSchema()),
        database: arraySchema(recordSchema()),
        workspaceCandidates: stringArraySchema(),
        truncated: booleanSchema(),
        nextCursor: nullableString(),
        next: nextSchema(),
      });
    case "diagnostics.health":
      return objectSchema({
        status: stringEnum(["ok"]),
        hostRisk: hostRiskSchema(),
        truncated: booleanSchema(),
        nextCursor: nullableString(),
        name: stringSchema(),
        server: objectSchema({ name: stringSchema(), version: stringSchema() }),
        mode: stringEnum(["read-only", "dev"]),
        activeProfile: stringSchema(),
        policy: recordSchema(),
        toolSurface: recordSchema(),
        instructions: recordSchema(),
        validFor: recordSchema(),
        upstreams: arraySchema(recordSchema()),
        recentToolErrors: arraySchema(recordSchema()),
        next: nextSchema(),
      });
    case "workspace.symbols":
      return objectSchema({
        status: stringEnum(["ok"]),
        hostRisk: hostRiskSchema(),
        symbols: arraySchema(recordSchema()),
        imports: arraySchema(recordSchema()),
        truncated: booleanSchema(),
        nextCursor: nullableString(),
      });
    case "fs.tree":
      return objectSchema({
        status: stringEnum(["ok"]),
        hostRisk: hostRiskSchema(),
        root: stringSchema(),
        entries: arraySchema(
          objectSchema({
            path: stringSchema(),
            type: stringEnum(["directory", "file", "symlink", "other"]),
            size: numberSchema(),
          }, ["path", "type"]),
        ),
        skipped: recordSchema(),
        stats: recordSchema(),
        omitted: arraySchema(recordSchema()),
        truncated: booleanSchema(),
        nextCursor: nullableString(),
        effectiveOptions: recordSchema(),
      });
    case "fs.search":
      return objectSchema({
        status: stringEnum(["ok"]),
        hostRisk: hostRiskSchema(),
        query: stringSchema(),
        mode: stringEnum(["fixed", "regex"]),
        case: stringEnum(["smart", "sensitive", "insensitive"]),
        matches: arraySchema(recordSchema()),
        searchedFiles: numberSchema(),
        skipped: recordSchema(),
        truncated: booleanSchema(),
        nextCursor: nullableString(),
        engine: stringEnum(["rg", "js"]),
        effectiveOptions: recordSchema(),
      });
    case "fs.read":
    case "fs.read_many":
      return objectSchema({
        status: stringEnum(["ok"]),
        hostRisk: hostRiskSchema(),
        files: arraySchema(
          objectSchema({
            path: stringSchema(),
            exists: booleanSchema(),
            type: stringEnum(["file", "directory", "symlink", "other"]),
            kind: stringEnum(["text", "binary"]),
            size: numberSchema(),
            sha256: stringSchema(),
            offsetBytes: numberSchema(),
            returnedBytes: numberSchema(),
            nextOffsetBytes: numberSchema(),
            returnedLines: numberSchema(),
            truncated: booleanSchema(),
            format: stringEnum(["content", "lines"]),
            range: recordSchema(),
            content: stringSchema(),
            lines: arraySchema(objectSchema({ line: numberSchema(), text: stringSchema() })),
            error: stringSchema(),
          }, ["path", "exists"]),
        ),
        effectiveOptions: recordSchema(),
      });
    case "fs.stat":
    case "fs.manifest":
      return objectSchema({
        status: stringEnum(["ok"]),
        hostRisk: hostRiskSchema(),
        files: arraySchema(
          objectSchema({
            path: stringSchema(),
            exists: booleanSchema(),
            type: stringEnum(["file", "directory", "symlink", "other", "missing"]),
            kind: stringEnum(["text", "binary"]),
            size: numberSchema(),
            sizeBytes: numberSchema(),
            sha256: stringSchema(),
            modifiedAt: stringSchema(),
            createdAt: stringSchema(),
          }, ["path", "exists"]),
        ),
      });
    case "file.change_preview":
    case "batch.change_preview":
    case "change.preview":
      return envelopeSchema(
        objectSchema({
          valid: booleanSchema(),
          status: stringEnum(["ok", "conflicted"]),
          hostRisk: hostRiskSchema(),
          previewId: stringSchema(),
          previewHash: stringSchema(),
          changeHash: stringSchema(),
          base: recordSchema(),
          summary: recordSchema(),
          files: arraySchema(recordSchema()),
          diff: stringSchema(),
          diffInfo: recordSchema(),
          conflicts: arraySchema(recordSchema()),
          warnings: arraySchema(recordSchema()),
          artifacts: arraySchema(recordSchema()),
          risk: recordSchema(),
          manualPlan: recordSchema(),
        }, ["valid", "status", "hostRisk", "previewId", "previewHash", "changeHash", "base", "summary", "files", "diff", "diffInfo", "conflicts", "warnings", "artifacts", "risk"]),
      );
    case "file.change_apply":
    case "batch.change_apply":
    case "change.apply":
      return objectSchema({
        status: stringEnum(["blocked"]),
        applied: booleanSchema(),
        verified: booleanSchema(),
        hostRisk: hostRiskSchema(),
        verification: recordSchema(),
        base: recordSchema(),
        summary: recordSchema(),
        files: arraySchema(recordSchema()),
        conflicts: arraySchema(recordSchema()),
        previewHash: stringSchema(),
        risk: recordSchema(),
        manualPlan: recordSchema(),
      }, ["applied", "verified", "hostRisk", "verification", "base", "summary", "files", "conflicts", "risk"]);
    case "task.list":
      return objectSchema({
        status: stringEnum(["ok"]),
        hostRisk: hostRiskSchema(),
        tasks: objectSchema({
          available: arraySchema(recordSchema()),
          unavailable: arraySchema(recordSchema()),
          candidates: arraySchema(recordSchema()),
        }),
        truncated: booleanSchema(),
        nextCursor: nullableString(),
        next: nextSchema(),
      });
    case "task.explain":
      return objectSchema({
        status: stringEnum(["available", "unavailable", "candidate", "manualFirst"]),
        hostRisk: hostRiskSchema(),
        taskId: stringSchema(),
        task: recordSchema(),
        decision: stringSchema(),
        next: recordSchema(),
      }, ["status", "hostRisk", "taskId", "decision", "next"]);
    case "task.run":
    case "task.result":
      return taskRunResultSchema();
    case "manual.prepare":
      return objectSchema({
        hostRisk: hostRiskSchema(),
        structuredContent: objectSchema({
          status: stringEnum(["prepared"]),
          operationId: stringSchema(),
          operation: recordSchema(),
          preparedId: stringSchema(),
          expiresAt: stringSchema(),
          gateTool: stringEnum(["manual.gate"]),
          resumeTool: stringEnum(["manual.resume"]),
          verificationPlan: recordSchema(),
          continuation: recordSchema(),
        }),
        content: contentArraySchema(),
      }, ["hostRisk", "structuredContent", "content"]);
    case "manual.gate":
      return objectSchema({
        hostRisk: hostRiskSchema(),
        reason: stringEnum(["openai_safety_block", "manual_review_requested", "external_manual_step"]),
        continuation: objectSchema({
          mode: stringEnum(["await_resume_command"]),
          modelShouldStop: booleanSchema(),
          mustEndTurn: booleanSchema(),
          resumeMode: stringEnum(["resume_interrupted_workflow"]),
        }),
        structuredContent: objectSchema({
          status: stringEnum(["awaiting_manual_completion"]),
          operationId: stringSchema(),
          operation: recordSchema(),
          manualFormatVersion: stringSchema(),
          manualMessageHash: stringSchema(),
          pendingId: stringSchema(),
          preparedId: stringSchema(),
          reason: stringEnum(["openai_safety_block", "manual_review_requested", "external_manual_step"]),
          expiresAt: stringSchema(),
          resumeTool: stringEnum(["manual.resume"]),
          continuation: objectSchema({
            mode: stringEnum(["await_resume_command"]),
            modelShouldStop: booleanSchema(),
            mustEndTurn: booleanSchema(),
            resumeMode: stringEnum(["resume_interrupted_workflow"]),
          }),
        }, ["status", "operationId", "operation", "manualFormatVersion", "manualMessageHash", "pendingId", "reason", "expiresAt", "resumeTool", "continuation"]),
        content: contentArraySchema(),
      }, ["hostRisk", "structuredContent", "content"]);
    case "manual.status":
      return objectSchema({
        status: stringEnum(["pending", "none"]),
        hostRisk: hostRiskSchema(),
        pending: recordSchema(),
        expired: arraySchema(recordSchema()),
        next: objectSchema({
          recommendedTools: stringArraySchema(),
          mode: stringEnum(["await_resume_command", "normal_workflow"]),
          followUpPrompt: stringSchema(),
        }),
      }, ["status", "hostRisk", "expired", "next"]);
    case "manual.resume":
      return objectSchema({
        status: stringEnum(["confirmed", "cancelled", "verification_failed", "expired", "not_found", "blocked"]),
        hostRisk: hostRiskSchema(),
        code: stringEnum(["RESUME_COMMAND_REQUIRED"]),
        operationId: stringSchema(),
        pendingId: stringSchema(),
        preparedId: stringSchema(),
        reason: stringSchema(),
        outcome: stringEnum(["completed", "cancelled"]),
        verification: recordSchema(),
        evidence: recordSchema(),
        next: objectSchema({
          recommendedTools: stringArraySchema(),
          mode: stringEnum(["await_resume_command", "resume_interrupted_workflow"]),
          verifyBeforeContinuing: booleanSchema(),
          followUpPrompt: stringSchema(),
        }),
      }, ["status", "hostRisk", "verification", "next"]);
    case "git.status":
    case "git.changed":
    case "git.diff":
    case "git.show":
    case "git.blame":
    case "git.commit_preview":
    case "git.commit":
      return gitResultSchema();
    default:
      return undefined;
  }
}

function trimDescription(value: string): string {
  return value.length <= 2000 ? value : `${value.slice(0, 1997)}...`;
}

function builtInInvocationMeta(name: string): Record<string, string> {
  const labels: Record<string, [string, string]> = {
    "workspace.context": ["Loading workspace context", "Workspace context loaded"],
    "workspace.scan": ["Scanning workspace", "Workspace scan complete"],
    "workspace.symbols": ["Searching symbols", "Symbols returned"],
    "diagnostics.health": ["Checking diagnostics", "Diagnostics checked"],
    "fs.tree": ["Reading file tree", "File tree returned"],
    "fs.search": ["Searching files", "File search complete"],
    "fs.read": ["Reading file", "File read complete"],
    "fs.read_many": ["Reading files", "Files read complete"],
    "fs.stat": ["Inspecting paths", "Path metadata returned"],
    "fs.manifest": ["Hashing paths", "Path manifest returned"],
    "file.change_preview": ["Previewing change", "Change preview ready"],
    "batch.change_preview": ["Previewing batch change", "Batch preview ready"],
    "change.preview": ["Previewing change", "Change preview ready"],
    "file.change_apply": ["Applying change", "Change applied"],
    "batch.change_apply": ["Applying batch change", "Batch change applied"],
    "change.apply": ["Applying change", "Change applied"],
    "task.list": ["Listing tasks", "Tasks listed"],
    "task.explain": ["Explaining task", "Task explained"],
    "task.run": ["Running task", "Task finished"],
    "task.result": ["Reading task result", "Task result returned"],
    "manual.prepare": ["Preparing manual action", "Manual action prepared"],
    "manual.gate": ["Opening manual gate", "Manual gate opened"],
    "manual.status": ["Checking manual status", "Manual status checked"],
    "manual.resume": ["Resuming manual action", "Manual action resumed"],
    "git.status": ["Checking git status", "Git status returned"],
    "git.changed": ["Listing changed files", "Changed files returned"],
    "git.diff": ["Reading git diff", "Git diff returned"],
    "git.show": ["Reading git object", "Git object returned"],
    "git.blame": ["Reading git blame", "Git blame returned"],
    "git.commit_preview": ["Previewing commit", "Commit preview ready"],
    "git.commit": ["Creating commit", "Commit created"],
  };
  const [invoking, invoked] = labels[name] ?? ["Calling tool", "Tool call complete"];
  return {
    "openai/toolInvocation/invoking": invoking,
    "openai/toolInvocation/invoked": invoked,
  };
}

function taskRunResultSchema(): Record<string, unknown> {
  return objectSchema({
    status: stringEnum(["running", "ok", "failed", "timeout", "unavailable"]),
    hostRisk: hostRiskSchema(),
    runId: stringSchema(),
    taskId: stringSchema(),
    exitCode: { anyOf: [numberSchema(), { type: "null" }] },
    stdout: recordSchema(),
    stderr: recordSchema(),
    diagnostics: arraySchema(recordSchema()),
    durationMs: numberSchema(),
    timeoutSeconds: numberSchema(),
    effectiveCommand: objectSchema({
      executable: stringSchema(),
      args: stringArraySchema(),
      cwd: stringSchema(),
    }),
    checks: arraySchema(recordSchema()),
    unavailableReason: stringSchema(),
    manualRequired: recordSchema(),
    next: recordSchema(),
  }, ["status", "hostRisk"]);
}

function gitResultSchema(): Record<string, unknown> {
  return objectSchema({
    status: stringEnum(["ok", "failed", "timeout", "unavailable"]),
    hostRisk: hostRiskSchema(),
    command: stringArraySchema(),
    exitCode: numberSchema(),
    stdout: stringSchema(),
    stderr: stringSchema(),
    files: arraySchema(recordSchema()),
    changed: booleanSchema(),
    paths: stringArraySchema(),
    diff: stringSchema(),
    commit: stringSchema(),
    message: stringSchema(),
    unavailableReason: stringSchema(),
    truncated: booleanSchema(),
    nextCursor: nullableString(),
  }, ["status", "hostRisk"]);
}

function envelopeSchema(data: Record<string, unknown>): Record<string, unknown> {
  return objectSchema({
    ok: booleanSchema(),
    status: stringSchema(),
    data,
    warnings: arraySchema(recordSchema()),
    limits: recordSchema(),
    truncated: booleanSchema(),
    nextCursor: nullableString(),
    artifacts: arraySchema(recordSchema()),
  }, ["ok", "status", "data", "warnings", "limits", "truncated", "nextCursor", "artifacts"]);
}

function nextSchema(): Record<string, unknown> {
  return objectSchema({
    tool: stringSchema(),
    reason: stringSchema(),
    alternatives: stringArraySchema(),
    args: recordSchema(),
  }, ["tool", "reason"]);
}

function contentArraySchema(): Record<string, unknown> {
  return arraySchema(
    objectSchema({
      type: stringEnum(["text"]),
      text: stringSchema(),
    }),
  );
}

function objectSchema(
  properties: Record<string, unknown>,
  required = Object.keys(properties),
  additionalProperties = true,
): Record<string, unknown> {
  return {
    type: "object",
    properties,
    required,
    additionalProperties,
  };
}

function arraySchema(items: Record<string, unknown>): Record<string, unknown> {
  return { type: "array", items };
}

function recordSchema(): Record<string, unknown> {
  return { type: "object", additionalProperties: true };
}

function stringArraySchema(): Record<string, unknown> {
  return arraySchema(stringSchema());
}

function stringSchema(): Record<string, unknown> {
  return { type: "string" };
}

function nullableString(): Record<string, unknown> {
  return { anyOf: [stringSchema(), { type: "null" }] };
}

function numberSchema(): Record<string, unknown> {
  return { type: "number" };
}

function booleanSchema(): Record<string, unknown> {
  return { type: "boolean" };
}

function stringEnum(values: string[]): Record<string, unknown> {
  return { type: "string", enum: values };
}

function hostRiskSchema(): Record<string, unknown> {
  return stringEnum(["low", "medium", "high"]);
}
