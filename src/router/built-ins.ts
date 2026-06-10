import { openManualGate } from "../manual/gate.js";
import { prepareManualAction } from "../manual/prepare.js";
import { resumeManualAction } from "../manual/resume.js";
import { manualStatus } from "../manual/status.js";
import type { RelayPolicy } from "../policy/policy.js";
import type { AuditLog } from "../state/audit.js";
import { LocalTaskRunnerClient } from "../upstream/local-task-runner.js";
import type { RegisteredTool } from "../upstream/registry.js";
import type { UpstreamManager } from "../upstream/manager.js";
import {
  emptyTaskOutputSummary,
  taskOutputSummaryFromText,
  TaskLogStore,
} from "../upstream/task-log-store.js";
import { ForbiddenError } from "../util/errors.js";
import { applyChangeset, fileManifest, previewChangeset } from "../workspace/changeset.js";
import { fileStat, fileTree, readFiles, searchCode } from "../workspace/inspect/code.js";
import { inspectProject } from "../workspace/inspect/project.js";
import { workspaceScan } from "../workspace/inspect/scan.js";
import { workspaceSymbols } from "../workspace/inspect/symbols.js";
import {
  gitBlame,
  gitChanged,
  gitCommitPreview,
  gitCommitPaths,
  gitDiffStaged,
  gitDiffUnstaged,
  gitShow,
  gitStatus,
} from "../workspace/inspect/git.js";
import type { CallerIdentity } from "./tools-call.js";
import { getContext, getDiagnostics, type RecentToolError } from "./context.js";

export type BuiltInContext = {
  registry: Map<string, RegisteredTool>;
  policy: RelayPolicy;
  upstreams: UpstreamManager;
  workspaceRoot: string;
  stateDir: string;
  publicBaseUrl: string;
  caller: CallerIdentity;
  audit: AuditLog;
  recentToolErrors: RecentToolError[];
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
      recentToolErrors: context.recentToolErrors,
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
    return gitChanged(args, {
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
    return gitBlame(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
    });
  }
  if (name === "git.commit_preview") {
    return gitCommitPreview(args, {
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
  if (name === "file.change_preview") {
    assertSingleChangeInput(args);
    const preview = await previewChangeset(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
      limits: context.policy.limits,
      stateDir: context.stateDir,
      publicBaseUrl: context.publicBaseUrl,
      toolName: name,
    });
    return changePreviewResponse(preview, context);
  }
  if (name === "batch.change_preview" || name === "change.preview") {
    const preview = await previewChangeset(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
      limits: context.policy.limits,
      stateDir: context.stateDir,
      publicBaseUrl: context.publicBaseUrl,
      toolName: name,
    });
    return changePreviewResponse(preview, context);
  }
  if (name === "file.change_apply") {
    assertSingleChangeInput(args);
    return applyChangeset(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
      limits: context.policy.limits,
      audit: context.audit,
      toolName: name,
    });
  }
  if (name === "batch.change_apply" || name === "change.apply") {
    return applyChangeset(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
      limits: context.policy.limits,
      audit: context.audit,
      toolName: name,
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
  if (name === "manual.prepare") {
    return prepareManualAction(args, {
      stateDir: context.stateDir,
      limits: context.policy.limits,
      audit: context.audit,
    });
  }
  if (name === "manual.status") {
    return manualStatus(args, {
      workspaceRoot: context.workspaceRoot,
      stateDir: context.stateDir,
      caller: context.caller,
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
  if (name === "task.explain") {
    return getContext({
      registry: context.registry,
      policy: context.policy,
      upstreams: context.upstreams,
      workspaceRoot: context.workspaceRoot,
    }).then((result) => explainTask(args, result));
  }
  if (name === "task.run") {
    const dynamicProjectTask = await runProjectTaskCandidate(args, context);
    if (dynamicProjectTask) return dynamicProjectTask;
    if (!context.upstreams.isAvailable("tasks")) {
      const taskId = typeof args.taskId === "string" ? args.taskId : "";
      const reason = "Task upstream is unavailable";
      return {
        status: "unavailable",
        runId: "",
        taskId,
        exitCode: null,
        stdout: emptyTaskOutputSummary(),
        stderr: taskOutputSummaryFromText(reason),
        diagnostics: [],
        durationMs: 0,
        timeoutSeconds: typeof args.timeoutSeconds === "number" ? args.timeoutSeconds : 0,
        unavailableReason: reason,
        manualRequired: manualRequiredForUnavailableTask(taskId, reason),
      };
    }
    return context.upstreams.call("tasks", "run_task", args);
  }
  if (name === "task.result") {
    const runId = typeof args.runId === "string" ? args.runId : "";
    const record = await new TaskLogStore(
      context.workspaceRoot,
      context.policy.limits.task,
    ).readRecord(runId);
    if (!record) {
      return {
        status: "unavailable",
        runId,
        unavailableReason: "Task run not found",
      };
    }
    return { ...record, diagnostics: record.diagnostics ?? [] };
  }
  throw new ForbiddenError(`Unknown built-in tool: ${name}`);
}

function assertSingleChangeInput(args: Record<string, unknown>): void {
  const changes = args.changes;
  if (!Array.isArray(changes) || changes.length !== 1) {
    throw new ForbiddenError("Single edit mode accepts exactly one logical file change per call");
  }
}

function changePreviewResponse(
  preview: Awaited<ReturnType<typeof previewChangeset>>,
  context: BuiltInContext,
): Record<string, unknown> {
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

async function runProjectTaskCandidate(
  args: Record<string, unknown>,
  context: BuiltInContext,
): Promise<unknown | undefined> {
  const taskId = typeof args.taskId === "string" ? args.taskId : "";
  if (!taskId.startsWith("candidate:")) return undefined;
  const parsed = parseProjectTaskCandidateId(taskId);
  if (!parsed) {
    return unavailableCandidateTask(args, "Candidate task id is not runnable by policy");
  }
  if (args.cwd !== undefined) throw new ForbiddenError("Candidate task cwd is fixed by the candidate id");
  if (args.extraArgs !== undefined) throw new ForbiddenError("Candidate task does not accept extraArgs");
  const project = await inspectProject({}, {
    workspaceRoot: context.workspaceRoot,
    workspace: context.policy.workspace,
  });
  const taskFile = project.taskFiles.find(
    (file) =>
      file.type === parsed.type &&
      dirnameOrDot(file.path) === parsed.cwd &&
      file.targets.includes(parsed.target),
  );
  const allowedTargets = new Set(
    stringList(bundleRecord(context.policy.taskBundles?.project).allowedTargets, []),
  );
  if (!taskFile || !allowedTargets.has(parsed.target)) {
    return unavailableCandidateTask(args, "Candidate task target is not allowed by policy");
  }

  const runner = new LocalTaskRunnerClient(
    "candidate-project-task",
    {
      transport: "local-task-runner",
      cwd: context.workspaceRoot,
      env: context.policy.upstreams.tasks?.env,
      tasks: {
        [taskId]: {
          executable: executableForTaskFile(parsed.type),
          args: [parsed.target],
          cwd: parsed.cwd,
          defaultTimeoutSeconds: context.policy.limits.task.defaultTimeoutSeconds,
          maxTimeoutSeconds: context.policy.limits.task.maxTimeoutSeconds,
        },
      },
    },
    context.workspaceRoot,
    context.policy.workspace,
    context.policy.limits.task,
  );
  await runner.initialize();
  return runner.callTool("run_task", {
    ...args,
    taskId,
  });
}

function parseProjectTaskCandidateId(taskId: string):
  | { cwd: string; type: "make" | "just" | "task"; target: string }
  | undefined {
  const match = /^candidate:(.*):(make|just|task):([A-Za-z0-9_.-]+)$/.exec(taskId);
  if (!match) return undefined;
  return {
    cwd: match[1] || ".",
    type: match[2] as "make" | "just" | "task",
    target: match[3],
  };
}

function unavailableCandidateTask(args: Record<string, unknown>, reason: string): Record<string, unknown> {
  const taskId = typeof args.taskId === "string" ? args.taskId : "";
  return {
    status: "unavailable",
    runId: "",
    taskId,
    exitCode: null,
    stdout: emptyTaskOutputSummary(),
    stderr: taskOutputSummaryFromText(reason),
    diagnostics: [],
    durationMs: 0,
    timeoutSeconds: typeof args.timeoutSeconds === "number" ? args.timeoutSeconds : 0,
    unavailableReason: reason,
    manualRequired: manualRequiredForUnavailableTask(taskId, reason),
  };
}

function executableForTaskFile(type: "make" | "just" | "task"): string {
  if (type === "make") return "make";
  if (type === "just") return "just";
  return "task";
}

function bundleRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function dirnameOrDot(filePath: string): string {
  const dir = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : ".";
  return dir || ".";
}

const readOnlyBlockedTools = new Set([
  "file.change_apply",
  "batch.change_apply",
  "change.apply",
  "task.run",
  "git.commit",
]);

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

function explainTask(args: Record<string, unknown>, context: Record<string, unknown>): Record<string, unknown> {
  const taskId = typeof args.taskId === "string" ? args.taskId : "";
  const tasks = context.tasks as
    | {
        available?: Array<Record<string, unknown>>;
        unavailable?: Array<Record<string, unknown>>;
        candidates?: Array<Record<string, unknown>>;
      }
    | undefined;
  const available = tasks?.available?.find((task) => task.taskId === taskId);
  if (available) {
    return {
      status: "available",
      taskId,
      task: available,
      decision: "Task is available and can be run with task.run.",
      next: { tool: "task.run", args: { taskId } },
    };
  }
  const unavailableTask = tasks?.unavailable?.find((task) => task.taskId === taskId);
  if (unavailableTask) {
    return {
      status: "unavailable",
      taskId,
      task: unavailableTask,
      decision: "Task is configured but resolver checks failed; do not run it until checks pass.",
      next: unavailableTask.manualRequired ?? { tool: "manual.prepare" },
    };
  }
  const candidate = tasks?.candidates?.find((task) => task.taskId === taskId);
  if (candidate) {
    return {
      status: candidate.manualFirst ? "manualFirst" : "candidate",
      taskId,
      task: candidate,
      decision: candidate.manualFirst
        ? "Candidate exists but is not runnable by policy; use manual fallback if this step is required."
        : candidate.runnable
          ? "Candidate maps to a runnable policy task."
          : "Candidate is informational and has no runnable policy task.",
      next: candidate.manualFirst
        ? { tool: "manual.prepare" }
        : candidate.matchingTaskId
          ? { tool: "task.run", args: { taskId: candidate.matchingTaskId } }
          : { tool: "manual.prepare" },
    };
  }
  return {
    status: "manualFirst",
    taskId,
    decision: "No configured task or candidate matches this id; use manual fallback if this step is required.",
    next: { tool: "manual.prepare" },
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
      "Run the equivalent step outside ChatGPT from the workspace root, write stdout/stderr to a workspace-relative log file, then reply in the next ChatGPT message with /resume <operationId> followed by that optional workspace-relative log file path.\n\n" +
      `Suggested resume command: /resume ${safeLogName(taskId || "task.run")} ${logPath}\n\n` +
      "Call manual.prepare when available. Do not paste the command, stdout/stderr, or log contents into manual.prepare or manual.gate; the gate call must use only v1 proof fields, optional preparedId, reason, and the low-risk hostObservation.",
    hostObservation: {
      toolName: "capability.limit",
      outputText: "manual step required because required execution capability is unavailable",
    },
  };
}

function safeLogName(taskId: string): string {
  return taskId.replace(/[^A-Za-z0-9_.-]+/g, "-") || "task";
}
