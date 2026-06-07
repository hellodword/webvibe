import { confirmManualAction } from "../manual/confirm.js";
import { openManualGate } from "../manual/gate.js";
import type { RelayPolicy } from "../policy/policy.js";
import type { AuditLog } from "../state/audit.js";
import type { RegisteredTool } from "../upstream/registry.js";
import type { UpstreamManager } from "../upstream/manager.js";
import { ForbiddenError } from "../util/errors.js";
import { applyChangeset, prepareChangeset, previewChangeset } from "../workspace/changeset.js";
import { fileStat, fileTree, readFiles, searchCode } from "../workspace/inspect/code.js";
import {
  gitCommitPaths,
  gitDiffStaged,
  gitDiffUnstaged,
  gitLog,
  gitShow,
  gitStatus,
} from "../workspace/inspect/git.js";
import { getContext, getDiagnostics } from "./context.js";

export type BuiltInContext = {
  registry: Map<string, RegisteredTool>;
  policy: RelayPolicy;
  upstreams: UpstreamManager;
  workspaceRoot: string;
  stateDir: string;
  publicBaseUrl: string;
  audit: AuditLog;
};

export function callBuiltIn(
  name: string,
  args: Record<string, unknown>,
  context: BuiltInContext,
): unknown | Promise<unknown> {
  if (name === "context.get") {
    return getContext({
      registry: context.registry,
      policy: context.policy,
      upstreams: context.upstreams,
      workspaceRoot: context.workspaceRoot,
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
  if (name === "read.search") {
    return searchCode(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
    });
  }
  if (name === "read.tree") {
    return fileTree(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
    });
  }
  if (name === "read.files") {
    return readFiles(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
    });
  }
  if (name === "read.stat") {
    return fileStat(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
    });
  }
  if (name === "git.status") {
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
  if (name === "git.history") {
    return gitLog(args, {
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
  if (name === "git.commit") {
    return gitCommitPaths(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
    });
  }
  if (name === "change.plan") {
    return previewChangeset(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
      limits: context.policy.limits,
    });
  }
  if (name === "change.prepare") {
    return prepareChangeset(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
      limits: context.policy.limits,
      stateDir: context.stateDir,
      publicBaseUrl: context.publicBaseUrl,
      audit: context.audit,
    });
  }
  if (name === "change.apply") {
    return applyChangeset(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
      limits: context.policy.limits,
    });
  }
  if (name === "manual.gate") {
    return openManualGate(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
      limits: context.policy.limits,
      stateDir: context.stateDir,
      publicBaseUrl: context.publicBaseUrl,
      audit: context.audit,
    });
  }
  if (name === "manual.confirm") {
    return confirmManualAction(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
      limits: context.policy.limits,
      stateDir: context.stateDir,
      audit: context.audit,
    });
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
  throw new ForbiddenError(`Unknown built-in tool: ${name}`);
}

function manualRequiredForUnavailableTask(
  taskId: string,
  reason: string,
): {
  nextTool: "manual.gate";
  reason: "external_manual_step";
  title: string;
  instructions: string;
  hostObservation: { toolName: "task.run"; outputText: string };
} {
  return {
    nextTool: "manual.gate",
    reason: "external_manual_step",
    title: `Manual task required: ${taskId || "task.run"}`,
    instructions:
      `ChatGPT Web could not run task '${taskId || "task.run"}' because ${reason}. ` +
      "Run the equivalent step outside ChatGPT, paste stdout, stderr, logs, or result details into the manual completion widget, then confirm.",
    hostObservation: {
      toolName: "task.run",
      outputText: reason,
    },
  };
}
