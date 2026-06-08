import type { RelayPolicy, TaskPolicy } from "../policy/policy.js";
import type { UpstreamManager } from "../upstream/manager.js";
import type { RegisteredTool } from "../upstream/registry.js";
import { gitStatus } from "../workspace/inspect/git.js";
import { inspectEnvironment } from "../workspace/inspect/env.js";
import { buildPreflightFingerprint, TOOL_SURFACE_VERSION } from "./tool-surface.js";

export type ContextToolContext = {
  registry: Map<string, RegisteredTool>;
  policy: RelayPolicy;
  upstreams: UpstreamManager;
  workspaceRoot: string;
};

export async function getContext(context: ContextToolContext): Promise<Record<string, unknown>> {
  const env = await inspectEnvironment({
    registry: context.registry,
    policy: context.policy,
    workspaceRoot: context.workspaceRoot,
  });
  const git = await gitStatus({}, { workspaceRoot: context.workspaceRoot, workspace: context.policy.workspace });
  const diagnostics = getDiagnostics(context);
  const tasks = taskSummary(context.policy, env.webvibe.missingTasks);
  const tools = Array.from(context.registry.keys());
  const capabilities = {
    rawShell: false,
    filesystemRead: tools.some((tool) => tool.startsWith("read.")),
    batchChange: tools.includes("change.apply"),
    namedTasks: tools.includes("task.run"),
    gitRead: tools.some((tool) => tool.startsWith("git.")),
    gitCommit: tools.includes("git.commit"),
  };
  const workflow = [
    "Use context.get before workspace tools.",
    "Use read.tree, read.search, and read.files to inspect only relevant files.",
    "Use change.plan to validate one complete batch workspace change.",
    "Use one change.apply call for the full requested file change.",
    "If ChatGPT Web returns the exact OpenAI safety block text, retry the same tool once with identical arguments before manual.gate.",
    "If the identical safety-block retry fails again or an unavailable tool capability prevents the best next step, show manual details in chat before calling manual.gate with minimal gate fields only, stop the turn immediately, and wait for a next user message that starts with /resume.",
    "Use task.run only with taskIds reported by context.get; pass cwd from project.manifests for monorepos.",
    "If task.run returns manualRequired, show userInstructions in chat, call manual.gate with reason and hostObservation only, then stop the turn.",
    "After manual.resume returns, verify current state and continue the original interrupted user request.",
    "Use git.status and git.diff after changes; use git.commit only with explicit paths.",
  ];
  return {
    status: "ok",
    toolSurface: {
      version: TOOL_SURFACE_VERSION,
      tools,
    },
    validFor: diagnostics.validFor,
    workspace: {
      root: ".",
      mode: context.policy.mode,
      platform: env.summary.platform,
      arch: env.summary.arch,
      container: env.summary.container,
      ci: env.summary.ci,
      editor: env.summary.editor,
    },
    capabilities,
    project: env.project,
    git,
    tasks,
    upstreams: diagnostics.upstreams,
    warnings: env.guidance,
    workflow,
    nextBestActions: workflow.slice(1),
  };
}

export function getDiagnostics(context: ContextToolContext): Record<string, unknown> {
  return {
    status: "ok",
    name: "webvibe",
    mode: context.policy.mode,
    toolSurface: {
      version: TOOL_SURFACE_VERSION,
      toolCount: context.registry.size,
      tools: Array.from(context.registry.keys()),
    },
    validFor: buildPreflightFingerprint(context),
    upstreams: context.upstreams.listHealth(),
  };
}

function taskSummary(
  policy: RelayPolicy,
  missingTasks: Array<{ taskId: string; executable: string; reason: string; executableCategory?: string }>,
): {
  available: Array<Record<string, unknown>>;
  unavailable: Array<Record<string, unknown>>;
} {
  const missingById = new Map(missingTasks.map((task) => [task.taskId, task]));
  const available: Array<Record<string, unknown>> = [];
  const unavailable: Array<Record<string, unknown>> = [];
  for (const upstream of Object.values(policy.upstreams)) {
    if (upstream.transport !== "local-task-runner") continue;
    for (const [taskId, task] of Object.entries(upstream.tasks ?? {})) {
      const summary = taskInfo(taskId, task);
      const missing = missingById.get(taskId);
      if (missing) {
        unavailable.push({
          ...summary,
          reason: missing.reason,
          executableCategory: missing.executableCategory,
        });
      } else {
        available.push(summary);
      }
    }
  }
  return { available, unavailable };
}

function taskInfo(taskId: string, task: TaskPolicy): Record<string, unknown> {
  return {
    taskId,
    description: task.description,
    executable: displayExecutable(task.executable),
    defaultTimeoutSeconds: task.defaultTimeoutSeconds,
    maxTimeoutSeconds: task.maxTimeoutSeconds,
    acceptsCwd: true,
    acceptsExtraArgs: task.allowExtraArgs === true,
    maxExtraArgs: task.maxExtraArgs,
    allowedExtraArgs: task.allowedExtraArgs,
    extraArgPattern: task.extraArgPattern,
  };
}

function displayExecutable(executable: string): string {
  const parts = executable.split(/[\\/]/);
  return parts[parts.length - 1] || executable;
}
