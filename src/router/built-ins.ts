import { openManualGate } from "../manual/gate.js";
import { resumeManualAction } from "../manual/resume.js";
import type { RelayPolicy } from "../policy/policy.js";
import type { AuditLog } from "../state/audit.js";
import type { RegisteredTool } from "../upstream/registry.js";
import type { UpstreamManager } from "../upstream/manager.js";
import { ForbiddenError } from "../util/errors.js";
import { applyChangeset, fileManifest, previewChangeset } from "../workspace/changeset.js";
import { fileStat, fileTree, readFiles, searchCode } from "../workspace/inspect/code.js";
import { workspaceScan } from "../workspace/inspect/scan.js";
import { workspaceSymbols } from "../workspace/inspect/symbols.js";
import {
  gitCommitPaths,
  gitDiffStaged,
  gitDiffUnstaged,
  gitShow,
  gitStatus,
} from "../workspace/inspect/git.js";
import type { CallerIdentity } from "./tools-call.js";
import { getContext, getDiagnostics } from "./context.js";

export type BuiltInContext = {
  registry: Map<string, RegisteredTool>;
  policy: RelayPolicy;
  upstreams: UpstreamManager;
  workspaceRoot: string;
  stateDir: string;
  publicBaseUrl: string;
  caller: CallerIdentity;
  audit: AuditLog;
};

export async function callBuiltIn(
  name: string,
  args: Record<string, unknown>,
  context: BuiltInContext,
): Promise<unknown> {
  if (context.policy.mode === "read-only" && readOnlyBlockedTools.has(name)) {
    return unavailable(name, "Tool is unavailable in read-only mode");
  }
  if (name === "workspace.context") {
    return getContext({
      registry: context.registry,
      policy: context.policy,
      upstreams: context.upstreams,
      workspaceRoot: context.workspaceRoot,
    });
  }
  if (name === "workspace.scan") {
    return workspaceScan(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
      limits: context.policy.limits,
    });
  }
  if (name === "workspace.symbols") {
    return workspaceSymbols(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
      limits: context.policy.limits,
    });
  }
  if (name === "diagnostics.health") {
    return getDiagnostics({
      registry: context.registry,
      policy: context.policy,
      upstreams: context.upstreams,
      workspaceRoot: context.workspaceRoot,
    });
  }
  if (name === "fs.search") {
    return searchCode(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
      limits: context.policy.limits,
    });
  }
  if (name === "fs.tree") {
    return fileTree(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
      limits: context.policy.limits,
    });
  }
  if (name === "fs.read") {
    return readFiles(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
      limits: context.policy.limits,
    });
  }
  if (name === "fs.read_many") {
    return readFiles(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
      limits: context.policy.limits,
    });
  }
  if (name === "fs.stat") {
    return fileStat(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
      limits: context.policy.limits,
    });
  }
  if (name === "fs.manifest") {
    return fileManifest(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
      limits: context.policy.limits,
    });
  }
  if (name === "git.status") {
    return gitStatus(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
    });
  }
  if (name === "git.changed") {
    return gitStatus(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
    });
  }
  if (name === "git.diff") {
    const scope = args.scope === "staged" ? "staged" : "unstaged";
    const diff = scope === "staged" ? gitDiffStaged : gitDiffUnstaged;
    return diff(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
    });
  }
  if (name === "git.show") {
    return gitShow(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
    });
  }
  if (name === "git.blame") {
    return unavailable(name, "git.blame is not implemented in this phase");
  }
  if (name === "git.commit_preview") {
    return unavailable(name, "git.commit_preview is not implemented in this phase");
  }
  if (name === "git.commit") {
    return gitCommitPaths(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
    });
  }
  if (name === "change.preview") {
    const preview = await previewChangeset(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
      limits: context.policy.limits,
      stateDir: context.stateDir,
      publicBaseUrl: context.publicBaseUrl,
    });
    return {
      ok: preview.status === "ok",
      status: preview.status,
      data: preview,
      warnings: preview.warnings,
      limits: {
        requested: {},
        effective: {
          change: context.policy.limits.change,
        },
      },
      truncated: preview.diffInfo.truncated,
      nextCursor: null,
      artifacts: preview.artifacts,
    };
  }
  if (name === "change.apply") {
    return applyChangeset(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
      limits: context.policy.limits,
      audit: context.audit,
    });
  }
  if (name === "manual.gate") {
    return openManualGate(args, {
      workspaceRoot: context.workspaceRoot,
      stateDir: context.stateDir,
      limits: context.policy.limits,
      caller: context.caller,
      audit: context.audit,
    });
  }
  if (name === "manual.resume") {
    return resumeManualAction(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
      limits: context.policy.limits,
      stateDir: context.stateDir,
      caller: context.caller,
      audit: context.audit,
    });
  }
  if (name === "task.list") {
    return getContext({
      registry: context.registry,
      policy: context.policy,
      upstreams: context.upstreams,
      workspaceRoot: context.workspaceRoot,
    }).then((result) => ({ status: "ok", tasks: result.tasks }));
  }
  if (name === "task.run") {
    if (!context.upstreams.isAvailable("tasks")) {
      const taskId = typeof args.taskId === "string" ? args.taskId : "";
      const reason = "Task upstream is unavailable";
      return {
        status: "unavailable",
        taskId,
        exitCode: null,
        stdout: "",
        stderr: reason,
        durationMs: 0,
        timeoutSeconds: typeof args.timeoutSeconds === "number" ? args.timeoutSeconds : 0,
        unavailableReason: reason,
        manualRequired: manualRequiredForUnavailableTask(taskId, reason),
      };
    }
    return context.upstreams.call("tasks", "run_task", args);
  }
  if (name === "task.result") {
    return unavailable(name, "task.result is not implemented in this phase");
  }
  throw new ForbiddenError(`Unknown built-in tool: ${name}`);
}

const readOnlyBlockedTools = new Set(["change.apply", "task.run", "git.commit"]);

function unavailable(toolName: string, reason: string): {
  status: "unavailable";
  toolName: string;
  unavailableReason: string;
} {
  return {
    status: "unavailable",
    toolName,
    unavailableReason: reason,
  };
}

function manualRequiredForUnavailableTask(
  taskId: string,
  reason: string,
): {
  nextTool: "manual.gate";
  reason: "external_manual_step";
  userInstructions: string;
  hostObservation: { toolName: string; outputText: string };
} {
  const logPath = `.webvibe/manual-logs/${safeLogName(taskId || "task.run")}.log`;
  return {
    nextTool: "manual.gate",
    reason: "external_manual_step",
    userInstructions:
      `ChatGPT Web could not run task '${taskId || "task.run"}' because ${reason}.\n\n` +
      "Run the equivalent step outside ChatGPT from the workspace root, write stdout/stderr to a workspace-relative log file, then reply in the next ChatGPT message with /resume followed by that optional workspace-relative log file path.\n\n" +
      `Suggested log path: ${logPath}\n\n` +
      "Do not paste the command, stdout/stderr, or log contents into manual.gate; the gate call must use only reason and the low-risk hostObservation.",
    hostObservation: {
      toolName: "capability.limit",
      outputText: "manual step required because required execution capability is unavailable",
    },
  };
}

function safeLogName(taskId: string): string {
  return taskId.replace(/[^A-Za-z0-9_.-]+/g, "-") || "task";
}
