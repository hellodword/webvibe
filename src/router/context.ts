import type { RelayPolicy, TaskBundlesPolicy, TaskPolicy } from "../policy/policy.js";
import type { UpstreamManager } from "../upstream/manager.js";
import type { RegisteredTool } from "../upstream/registry.js";
import {
  WEBVIBE_INSTRUCTION_VERSION,
  webvibeServerInstructions,
} from "../server/instructions.js";
import { WEBVIBE_SERVER_NAME, WEBVIBE_SERVER_VERSION } from "../server/version.js";
import { gitStatus } from "../workspace/inspect/git.js";
import { inspectEnvironment } from "../workspace/inspect/env.js";
import { buildPreflightFingerprint, TOOL_SURFACE_VERSION } from "./tool-surface.js";
import { sha256 } from "../util/hash.js";

export type RecentToolError = {
  timestamp: string;
  tool: string;
  type: string;
  code?: string;
  message: string;
};

export type ContextToolContext = {
  registry: Map<string, RegisteredTool>;
  policy: RelayPolicy;
  upstreams: UpstreamManager;
  workspaceRoot: string;
  recentToolErrors?: RecentToolError[];
};

export async function getContext(context: ContextToolContext): Promise<Record<string, unknown>> {
  const env = await inspectEnvironment({
    registry: context.registry,
    policy: context.policy,
    workspaceRoot: context.workspaceRoot,
  });
  const git = await gitStatus({}, { workspaceRoot: context.workspaceRoot, workspace: context.policy.workspace });
  const diagnostics = getDiagnostics(context);
  const tasks = taskSummary(context.policy, env.webvibe.missingTasks, env.project, env.path.commands);
  const tools = Array.from(context.registry.keys());
  const toolSurfaceHash = sha256(Array.from(context.registry.values()).map((entry) => entry.descriptor));
  const policyHash = sha256(context.policy);
  const editPolicy = context.policy.editMode ?? { mode: "single", batch: { enabled: false } };
  const editMode = editPolicy.mode;
  const batchEditEnabled = editPolicy.batch.enabled;
  const manualFallbackAvailable = tools.includes("manual.gate") && tools.includes("manual.resume");
  const hostConstraints = {
    avoidRawShellShape: true,
    preferFixedTask: true,
    preferSmallPayload: true,
    manualFallbackAvailable,
    editMode,
  };
  const hostRiskProfile = {
    low: ["read", "search", "stat", "status", "symbols"],
    medium: ["file.apply", "task.run", "git.commit"],
    high: ["batch.apply", "large-payload", "delete-heavy", "unknown-task", "manual-first"],
  };
  const capabilities = {
    rawShell: false,
    filesystemRead: tools.some((tool) => tool.startsWith("fs.")),
    fileChange: tools.includes("file.change_apply"),
    batchChange: batchEditEnabled && tools.includes("batch.change_apply"),
    editMode,
    namedTasks: tools.includes("task.run"),
    gitRead: tools.some((tool) => tool.startsWith("git.")),
    gitCommit: tools.includes("git.commit"),
  };
  return {
    status: "ok",
    truncated: false,
    nextCursor: null,
    toolSurface: {
      version: TOOL_SURFACE_VERSION,
      hash: toolSurfaceHash,
      tools,
    },
    policy: {
      profile: context.policy.activeProfile,
      hash: policyHash,
      effectiveLimits: context.policy.limits,
    },
    editMode: {
      mode: editMode,
      batchEnabled: batchEditEnabled,
    },
    validFor: diagnostics.validFor,
    workspace: {
      root: ".",
      mode: context.policy.mode,
      profile: context.policy.activeProfile,
      platform: env.summary.platform,
      arch: env.summary.arch,
      container: env.summary.container,
      ci: env.summary.ci,
      editor: env.summary.editor,
    },
    capabilities,
    hostConstraints,
    hostRiskProfile,
    project: projectBrief(env.project),
    git,
    tasks: taskBrief(tasks),
    manualFallback: manualFallbackGuide(),
    upstreams: diagnostics.upstreams,
    warnings: env.guidance.slice(0, 5),
    next: {
      tool: "task.list",
      reason: "Use task.list for full task resolver details; use workspace.scan for full project details.",
      alternatives: ["workspace.scan", "fs.tree", "fs.search"],
    },
  };
}

export function getDiagnostics(context: ContextToolContext): Record<string, unknown> {
  const toolSurfaceHash = sha256(Array.from(context.registry.values()).map((entry) => entry.descriptor));
  const instructionHash = sha256(webvibeServerInstructions);
  return {
    status: "ok",
    truncated: false,
    nextCursor: null,
    name: WEBVIBE_SERVER_NAME,
    server: {
      name: WEBVIBE_SERVER_NAME,
      version: WEBVIBE_SERVER_VERSION,
    },
    mode: context.policy.mode,
    activeProfile: context.policy.activeProfile,
    policy: {
      hash: sha256(context.policy),
      effectiveLimits: context.policy.limits,
    },
    toolSurface: {
      version: TOOL_SURFACE_VERSION,
      hash: toolSurfaceHash,
      toolCount: context.registry.size,
      tools: Array.from(context.registry.keys()),
    },
    instructions: {
      version: WEBVIBE_INSTRUCTION_VERSION,
      hash: instructionHash,
    },
    validFor: buildPreflightFingerprint(context),
    upstreams: context.upstreams.listHealth(),
    recentToolErrors: context.recentToolErrors ?? [],
    next: {
      tool: "workspace.context",
      reason: "Refresh coding preflight before workspace tools.",
    },
  };
}

export async function getTaskList(context: ContextToolContext): Promise<Record<string, unknown>> {
  const env = await inspectEnvironment({
    registry: context.registry,
    policy: context.policy,
    workspaceRoot: context.workspaceRoot,
  });
  return {
    status: "ok",
    tasks: taskSummary(context.policy, env.webvibe.missingTasks, env.project, env.path.commands),
    truncated: false,
    nextCursor: null,
    next: {
      tool: "task.explain",
      reason: "Call task.explain with a taskId when routing is unclear.",
    },
  };
}

function taskSummary(
  policy: RelayPolicy,
  missingTasks: Array<{ taskId: string; executable: string; reason: string; executableCategory?: string }>,
  project: Awaited<ReturnType<typeof inspectEnvironment>>["project"],
  commands: Awaited<ReturnType<typeof inspectEnvironment>>["path"]["commands"],
): {
  available: Array<Record<string, unknown>>;
  unavailable: Array<Record<string, unknown>>;
  candidates: Array<Record<string, unknown>>;
} {
  const missingById = new Map(missingTasks.map((task) => [task.taskId, task]));
  const available: Array<Record<string, unknown>> = [];
  const unavailable: Array<Record<string, unknown>> = [];
  for (const upstream of Object.values(policy.upstreams)) {
    if (upstream.transport !== "local-task-runner") continue;
    for (const [taskId, task] of Object.entries(upstream.tasks ?? {})) {
      const missing = missingById.get(taskId);
      const summary = taskInfo(taskId, task, missing);
      if (missing) {
        unavailable.push({
          ...summary,
          reason: missing.reason,
          executableCategory: missing.executableCategory,
          manualRequired: manualRequiredForUnavailableCapability(
            taskId,
            `Configured task is unavailable: ${missing.reason}`,
          ),
        });
      } else {
        available.push(summary);
      }
    }
  }
  return {
    available,
    unavailable,
    candidates: taskCandidates(policy.taskBundles ?? {}, project, commands, available),
  };
}

function projectBrief(project: Awaited<ReturnType<typeof inspectEnvironment>>["project"]): Record<string, unknown> {
  return {
    root: project.root,
    truncated: project.truncated,
    languages: project.languages,
    packageManagers: project.packageManagers,
    counts: {
      manifests: project.manifests.length,
      lockfiles: project.lockfiles.length,
      npmScripts: project.npmScripts.length,
      taskFiles: project.taskFiles.length,
      configFiles: project.configFiles.length,
    },
    manifestTypes: countBy(project.manifests.map((manifest) => manifest.type)),
    configKinds: countBy(project.configFiles.map((file) => file.kind)),
    next: {
      tool: "workspace.scan",
      reason: "Use workspace.scan for manifest paths, scripts, task files, and config files.",
    },
  };
}

function taskBrief(tasks: {
  available: Array<Record<string, unknown>>;
  unavailable: Array<Record<string, unknown>>;
  candidates: Array<Record<string, unknown>>;
}): Record<string, unknown> {
  const manualFirstCandidates = tasks.candidates.filter((task) => task.manualFirst === true);
  return {
    counts: {
      available: tasks.available.length,
      unavailable: tasks.unavailable.length,
      candidates: tasks.candidates.length,
      manualFirst: manualFirstCandidates.length,
    },
    availableTaskIds: tasks.available.map((task) => String(task.taskId)).slice(0, 50),
    unavailableTaskIds: tasks.unavailable.map((task) => String(task.taskId)).slice(0, 50),
    candidateSummary: {
      runnable: tasks.candidates.filter((task) => task.runnable === true).length,
      manualFirst: manualFirstCandidates.length,
      families: countBy(tasks.candidates.map((task) => String(task.family ?? "unknown"))),
    },
    next: {
      tool: "task.list",
      reason: "Use task.list for resolver checks, candidate commands, cwd, and manualRequired details.",
    },
  };
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function taskInfo(
  taskId: string,
  task: TaskPolicy,
  missing?: { reason: string; executableCategory?: string },
): Record<string, unknown> {
  return {
    taskId,
    description: task.description,
    executable: displayExecutable(task.executable),
    checks: taskChecks(task, missing),
    hostRisk: "medium",
    defaultTimeoutSeconds: task.defaultTimeoutSeconds,
    maxTimeoutSeconds: task.maxTimeoutSeconds,
    acceptsCwd: true,
    acceptsExtraArgs: task.allowExtraArgs === true,
    extraInput: task.allowExtraArgs === true ? "typed-extra-object" : "none",
    maxExtraArgs: task.maxExtraArgs,
    allowedExtraArgs: task.allowedExtraArgs,
    extraArgPattern: task.extraArgPattern,
  };
}

function taskChecks(
  task: TaskPolicy,
  missing?: { reason: string; executableCategory?: string },
): Array<Record<string, unknown>> {
  const checks: Array<Record<string, unknown>> = [
    {
      kind: "executable",
      name: displayExecutable(task.executable),
      ok: missing?.reason !== "missing executable",
      ...(missing?.reason === "missing executable" ? { reason: missing.reason } : {}),
    },
  ];
  if (task.requiredPackageScript) {
    const missingScript = missing?.reason === `missing package script: ${task.requiredPackageScript}`;
    checks.push({
      kind: "packageScript",
      name: task.requiredPackageScript,
      ok: !missingScript,
      ...(missingScript ? { reason: missing.reason } : {}),
    });
  }
  for (const requiredFile of task.requiredFiles ?? []) {
    const missingFile = missing?.reason === `missing required file: ${requiredFile}`;
    checks.push({
      kind: "requiredFile",
      path: requiredFile,
      ok: !missingFile,
      ...(missingFile ? { reason: missing.reason } : {}),
    });
  }
  return checks;
}

function displayExecutable(executable: string): string {
  const parts = executable.split(/[\\/]/);
  return parts[parts.length - 1] || executable;
}

function manualFallbackGuide(): Record<string, unknown> {
  return {
    nextTool: "manual.gate",
    prepareTool: "manual.prepare",
    statusTool: "manual.status",
    reason: "external_manual_step",
    when:
      "Use when the required next step is outside the fixed tool surface, has no matching taskId, or is blocked by an unavailable tool capability.",
    chatInstructions:
      "Show the exact manual command or step in ChatGPT Web chat only. Ask the user to run it outside ChatGPT, redirect stdout/stderr to a workspace-relative log file, and reply with /resume <operationId> followed by that optional log file path.",
    suggestedLogPathPattern: ".webvibe/manual-logs/<slug>.log",
    gatePayloadRule:
      "Never put manual commands, scripts, diffs, file contents, stdout/stderr, or log contents in manual.gate arguments.",
    hostObservation: capabilityLimitHostObservation(
      "manual step required because required execution capability is unavailable",
    ),
  };
}

function manualRequiredForUnavailableCapability(
  taskId: string,
  reason: string,
): Record<string, unknown> {
  const logPath = `.webvibe/manual-logs/${safeLogName(taskId)}.log`;
  return {
    nextTool: "manual.gate",
    reason: "external_manual_step",
    userInstructions:
      `Task '${taskId}' is unavailable (${reason}). If this task is required, show the manual command or equivalent step in ChatGPT Web chat only. ` +
      `Ask the user to run it outside ChatGPT, write stdout/stderr to ${logPath}, then reply with /resume ${safeLogName(taskId)} ${logPath}. ` +
      "Call manual.prepare when available, then call manual.gate with manualFormatVersion, manualMessageHash, operation, optional preparedId, reason, and the provided low-risk hostObservation; do not include the command or log contents in the tool arguments.",
    hostObservation: capabilityLimitHostObservation(
      "manual step required because configured task is unavailable",
    ),
  };
}

function capabilityLimitHostObservation(outputText: string): Record<string, string> {
  return {
    toolName: "capability.limit",
    outputText,
  };
}

function safeLogName(taskId: string): string {
  return taskId.replace(/[^A-Za-z0-9_.-]+/g, "-") || "task";
}

function taskCandidates(
  bundles: TaskBundlesPolicy,
  project: Awaited<ReturnType<typeof inspectEnvironment>>["project"],
  commands: Awaited<ReturnType<typeof inspectEnvironment>>["path"]["commands"],
  available: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const availableIds = new Set(available.map((task) => String(task.taskId)));
  const candidates = [
    ...nodeTaskCandidates(bundles, project, commands, availableIds),
    ...languageTaskCandidates("go", bundles, project, ["test_all", "vet", "fmt"], availableIds),
    ...languageTaskCandidates("rust", bundles, project, ["test", "check", "clippy", "fmt", "build"], availableIds),
    ...flutterTaskCandidates(bundles, project, availableIds),
    ...frontendTaskCandidates(bundles, project, commands, availableIds),
    ...codegenTaskCandidates(bundles, project, commands, availableIds),
    ...projectTaskFileCandidates(bundles, project),
  ];
  return candidates.slice(0, 200);
}

function nodeTaskCandidates(
  bundles: TaskBundlesPolicy,
  project: Awaited<ReturnType<typeof inspectEnvironment>>["project"],
  commands: Awaited<ReturnType<typeof inspectEnvironment>>["path"]["commands"],
  availableIds: Set<string>,
): Array<Record<string, unknown>> {
  const nodeBundle = bundleRecord(bundles.node);
  const allowedScripts = stringList(nodeBundle.scripts, ["test", "lint", "typecheck", "build", "format"]);
  const allowedPackageManagers = stringList(nodeBundle.packageManagers, ["npm", "pnpm", "yarn", "bun"]);
  const candidates: Array<Record<string, unknown>> = [];
  for (const manifest of project.manifests.filter((item) => item.type === "npm")) {
    const cwd = dirnameOrDot(manifest.path);
    const packageManager = packageManagerForManifest(manifest, project.lockfiles, commands, allowedPackageManagers);
    for (const script of manifest.scripts ?? []) {
      if (!allowedScripts.includes(script)) continue;
      const staticTaskId = `node.${script}`;
      candidates.push({
        taskId: `candidate:${cwd}:${script}`,
        family: "node",
        cwd,
        source: manifest.path,
        script,
        packageManager,
        command: [packageManager, "run", script],
        runnable: availableIds.has(staticTaskId),
        ...(availableIds.has(staticTaskId) ? { matchingTaskId: staticTaskId } : {}),
      });
    }
  }
  return candidates;
}

function languageTaskCandidates(
  language: "go" | "rust",
  bundles: TaskBundlesPolicy,
  project: Awaited<ReturnType<typeof inspectEnvironment>>["project"],
  defaultTasks: string[],
  availableIds: Set<string>,
): Array<Record<string, unknown>> {
  const bundle = bundleRecord(bundles[language]);
  const allowedTasks = stringList(bundle.tasks, defaultTasks);
  const prefix = language === "go" ? "go" : "cargo";
  const manifestType = language;
  return project.manifests
    .filter((manifest) => manifest.type === manifestType)
    .flatMap((manifest) => {
      const cwd = dirnameOrDot(manifest.path);
      return allowedTasks.map((task) => {
        const staticTaskId = language === "go" ? goStaticTaskId(task) : cargoStaticTaskId(task);
        return {
          taskId: `candidate:${cwd}:${language}:${task}`,
          family: language,
          cwd,
          source: manifest.path,
          task,
          command: commandForLanguageTask(language, task),
          runnable: staticTaskId ? availableIds.has(staticTaskId) : false,
          ...(staticTaskId && availableIds.has(staticTaskId) ? { matchingTaskId: staticTaskId } : {}),
          executable: prefix,
        };
      });
    });
}

function packageManagerForManifest(
  manifest: Awaited<ReturnType<typeof inspectEnvironment>>["project"]["manifests"][number],
  lockfiles: Awaited<ReturnType<typeof inspectEnvironment>>["project"]["lockfiles"],
  commands: Awaited<ReturnType<typeof inspectEnvironment>>["path"]["commands"],
  allowed: string[],
): string {
  const cwd = dirnameOrDot(manifest.path);
  const byLock = lockfiles.find((lockfile) => dirnameOrDot(lockfile.path) === cwd && allowed.includes(lockfile.type));
  if (byLock) return byLock.type;
  if (manifest.packageManager && allowed.includes(manifest.packageManager)) return manifest.packageManager;
  const available = commands.find((command) => allowed.includes(command.command) && command.status === "available");
  return available?.command ?? (allowed.includes("npm") ? "npm" : allowed[0] ?? "npm");
}

function commandForLanguageTask(language: "go" | "rust", task: string): string[] {
  if (language === "go") {
    if (task === "test_all") return ["go", "test", "./..."];
    if (task === "vet") return ["go", "vet", "./..."];
    if (task === "fmt") return ["go", "fmt", "./..."];
    if (task === "mod_download") return ["go", "mod", "download"];
    if (task === "mod_tidy") return ["go", "mod", "tidy"];
    return ["go", task];
  }
  if (task === "fmt") return ["cargo", "fmt", "--check"];
  if (task === "clippy") return ["cargo", "clippy", "--all-targets", "--all-features"];
  return ["cargo", task];
}

function flutterTaskCandidates(
  bundles: TaskBundlesPolicy,
  project: Awaited<ReturnType<typeof inspectEnvironment>>["project"],
  availableIds: Set<string>,
): Array<Record<string, unknown>> {
  const bundle = bundleRecord(bundles.flutter);
  const allowedTasks = stringList(bundle.tasks, ["pub_get", "analyze", "test", "dart_format"]);
  return project.manifests
    .filter((manifest) => manifest.type === "flutter" || manifest.type === "dart")
    .flatMap((manifest) => {
      const cwd = dirnameOrDot(manifest.path);
      const manifestType = manifest.type === "flutter" ? "flutter" : "dart";
      return allowedTasks.map((task) => {
        const staticTaskId = flutterStaticTaskId(task);
        return {
          taskId: `candidate:${cwd}:flutter:${task}`,
          family: manifestType,
          cwd,
          source: manifest.path,
          task,
          command: commandForFlutterTask(manifestType, task),
          runnable: staticTaskId ? availableIds.has(staticTaskId) : false,
          ...(staticTaskId && availableIds.has(staticTaskId) ? { matchingTaskId: staticTaskId } : {}),
        };
      });
    });
}

function frontendTaskCandidates(
  bundles: TaskBundlesPolicy,
  project: Awaited<ReturnType<typeof inspectEnvironment>>["project"],
  commands: Awaited<ReturnType<typeof inspectEnvironment>>["path"]["commands"],
  availableIds: Set<string>,
): Array<Record<string, unknown>> {
  const bundle = bundleRecord(bundles.frontend);
  const allowedTasks = stringList(bundle.tasks, [
    "playwright_test",
    "cypress_run",
    "vitest",
    "jest",
    "eslint",
    "biome",
    "prettier",
    "tsc_noemit",
  ]);
  const candidates: Array<Record<string, unknown>> = [];
  for (const config of project.configFiles.filter((file) => file.kind.startsWith("frontend:"))) {
    const cwd = dirnameOrDot(config.path);
    for (const task of frontendTasksForKind(config.kind)) {
      if (!allowedTasks.includes(task)) continue;
      const staticTaskId = frontendStaticTaskId(task);
      candidates.push({
        taskId: `candidate:${cwd}:frontend:${task}`,
        family: "frontend",
        cwd,
        source: config.path,
        task,
        command: commandForFrontendTask(task, project, commands, cwd),
        runnable: staticTaskId ? availableIds.has(staticTaskId) : false,
        ...(staticTaskId && availableIds.has(staticTaskId) ? { matchingTaskId: staticTaskId } : {}),
      });
    }
  }
  return uniqueCandidates(candidates);
}

function codegenTaskCandidates(
  bundles: TaskBundlesPolicy,
  project: Awaited<ReturnType<typeof inspectEnvironment>>["project"],
  commands: Awaited<ReturnType<typeof inspectEnvironment>>["path"]["commands"],
  availableIds: Set<string>,
): Array<Record<string, unknown>> {
  const bundle = bundleRecord(bundles.codegen);
  const allowedTasks = stringList(bundle.tasks, [
    "openapi_generate",
    "prisma_generate",
    "drizzle_generate",
    "sqlc_generate",
    "buf_lint",
    "buf_generate",
  ]);
  const candidates: Array<Record<string, unknown>> = [];
  for (const config of project.configFiles.filter((file) => isCodegenConfig(file.kind))) {
    const cwd = dirnameOrDot(config.path);
    for (const task of codegenTasksForKind(config.kind)) {
      if (!allowedTasks.includes(task)) continue;
      const staticTaskId = codegenStaticTaskId(task);
      candidates.push({
        taskId: `candidate:${cwd}:codegen:${task}`,
        family: "codegen",
        cwd,
        source: config.path,
        task,
        command: commandForCodegenTask(task, project, commands, cwd),
        runnable: staticTaskId ? availableIds.has(staticTaskId) : false,
        ...(staticTaskId && availableIds.has(staticTaskId) ? { matchingTaskId: staticTaskId } : {}),
      });
    }
  }
  return uniqueCandidates(candidates);
}

function commandForFlutterTask(manifestType: "dart" | "flutter", task: string): string[] {
  const tool = manifestType === "flutter" && task !== "dart_format" ? "flutter" : "dart";
  if (task === "pub_get") return [tool, "pub", "get"];
  if (task === "analyze") return [tool, "analyze"];
  if (task === "test") return [tool, "test"];
  if (task === "dart_format") return ["dart", "format", "--output=none", "--set-exit-if-changed", "."];
  return [tool, task];
}

function commandForFrontendTask(
  task: string,
  project: Awaited<ReturnType<typeof inspectEnvironment>>["project"],
  commands: Awaited<ReturnType<typeof inspectEnvironment>>["path"]["commands"],
  cwd: string,
): string[] {
  const exec = packageExecutorForCwd(project, commands, cwd);
  const toolArgs: Record<string, string[]> = {
    playwright_test: ["playwright", "test"],
    cypress_run: ["cypress", "run"],
    vitest: ["vitest", "run"],
    jest: ["jest"],
    eslint: ["eslint", "."],
    biome: ["biome", "check", "."],
    prettier: ["prettier", "--check", "."],
    tsc_noemit: ["tsc", "--noEmit"],
  };
  return [...exec, ...(toolArgs[task] ?? [task])];
}

function commandForCodegenTask(
  task: string,
  project: Awaited<ReturnType<typeof inspectEnvironment>>["project"],
  commands: Awaited<ReturnType<typeof inspectEnvironment>>["path"]["commands"],
  cwd: string,
): string[] {
  const exec = packageExecutorForCwd(project, commands, cwd);
  if (task === "openapi_generate") return [...exec, "openapi-generator-cli", "generate"];
  if (task === "prisma_generate") return [...exec, "prisma", "generate"];
  if (task === "drizzle_generate") return [...exec, "drizzle-kit", "generate"];
  if (task === "sqlc_generate") return ["sqlc", "generate"];
  if (task === "buf_lint") return ["buf", "lint"];
  if (task === "buf_generate") return ["buf", "generate"];
  return [...exec, task];
}

function packageExecutorForCwd(
  project: Awaited<ReturnType<typeof inspectEnvironment>>["project"],
  commands: Awaited<ReturnType<typeof inspectEnvironment>>["path"]["commands"],
  cwd: string,
): string[] {
  const manifest = nearestNpmManifest(project, cwd);
  const allowed = ["npm", "pnpm", "yarn", "bun"];
  const packageManager = manifest
    ? packageManagerForManifest(manifest, project.lockfiles, commands, allowed)
    : commands.find((command) => allowed.includes(command.command) && command.status === "available")?.command ?? "npm";
  if (packageManager === "pnpm") return ["pnpm", "exec"];
  if (packageManager === "yarn") return ["yarn"];
  if (packageManager === "bun") return ["bunx"];
  return ["npx"];
}

function nearestNpmManifest(
  project: Awaited<ReturnType<typeof inspectEnvironment>>["project"],
  cwd: string,
): Awaited<ReturnType<typeof inspectEnvironment>>["project"]["manifests"][number] | undefined {
  const npmManifests = project.manifests.filter((manifest) => manifest.type === "npm");
  return npmManifests
    .filter((manifest) => isSameOrParentDir(dirnameOrDot(manifest.path), cwd))
    .sort((left, right) => dirnameOrDot(right.path).length - dirnameOrDot(left.path).length)[0];
}

function isSameOrParentDir(parent: string, child: string): boolean {
  return parent === "." || child === parent || child.startsWith(`${parent}/`);
}

function frontendTasksForKind(kind: string): string[] {
  if (kind === "frontend:playwright") return ["playwright_test"];
  if (kind === "frontend:cypress") return ["cypress_run"];
  if (kind === "frontend:vitest") return ["vitest"];
  if (kind === "frontend:jest") return ["jest"];
  if (kind === "frontend:eslint") return ["eslint"];
  if (kind === "frontend:biome") return ["biome"];
  if (kind === "frontend:prettier") return ["prettier"];
  if (kind === "frontend:typescript") return ["tsc_noemit"];
  return [];
}

function codegenTasksForKind(kind: string): string[] {
  if (kind === "codegen:openapi") return ["openapi_generate"];
  if (kind === "database:prisma") return ["prisma_generate"];
  if (kind === "database:drizzle") return ["drizzle_generate"];
  if (kind === "codegen:sqlc") return ["sqlc_generate"];
  if (kind === "codegen:buf") return ["buf_lint", "buf_generate"];
  return [];
}

function isCodegenConfig(kind: string): boolean {
  return kind.startsWith("codegen:") || kind.startsWith("database:");
}

function flutterStaticTaskId(task: string): string | undefined {
  if (task === "pub_get") return "flutter_pub_get";
  if (task === "analyze") return "flutter_analyze";
  if (task === "test") return "flutter_test";
  if (task === "dart_format") return "dart_format";
  return undefined;
}

function frontendStaticTaskId(task: string): string | undefined {
  if (task === "tsc_noemit") return "node.typecheck";
  if (task === "eslint") return "node.lint";
  if (task === "prettier") return "node.format";
  return undefined;
}

function codegenStaticTaskId(task: string): string | undefined {
  if (task === "prisma_generate") return "prisma_generate";
  if (task === "drizzle_generate") return "drizzle_generate";
  if (task === "buf_lint") return "buf_lint";
  if (task === "buf_generate") return "buf_generate";
  if (task === "sqlc_generate") return "sqlc_generate";
  if (task === "openapi_generate") return "openapi_generate";
  return undefined;
}

function uniqueCandidates(candidates: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.taskId}:${candidate.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function goStaticTaskId(task: string): string | undefined {
  if (task === "test_all") return "go_test";
  if (task === "vet") return "go_vet";
  if (task === "fmt") return "go_fmt";
  if (task === "mod_download") return "go_mod_download";
  if (task === "mod_tidy") return "go_mod_tidy";
  return undefined;
}

function cargoStaticTaskId(task: string): string | undefined {
  if (task === "fmt") return "cargo_fmt";
  return `cargo_${task}`;
}

function projectTaskFileCandidates(
  bundles: TaskBundlesPolicy,
  project: Awaited<ReturnType<typeof inspectEnvironment>>["project"],
): Array<Record<string, unknown>> {
  const projectBundle = bundleRecord(bundles.project);
  const enabledTypes = new Set(stringList(projectBundle.taskFiles, ["make", "just", "task"]));
  const allowedTargets = new Set(stringList(projectBundle.allowedTargets, []));
  return project.taskFiles
    .filter((taskFile) => enabledTypes.has(taskFile.type))
    .flatMap((taskFile) =>
      taskFile.targets.map((target) => ({
        taskId: `candidate:${dirnameOrDot(taskFile.path)}:${taskFile.type}:${target}`,
        family: "project",
        taskFile: taskFile.type,
        source: taskFile.path,
        cwd: dirnameOrDot(taskFile.path),
        target,
        command: commandForTaskFile(taskFile.type, target),
        runnable: allowedTargets.has(target),
        ...(allowedTargets.has(target)
          ? { allowedByPolicy: true }
          : {
              manualFirst: true,
              reason: "task file target is not allowlisted by policy",
            }),
      })),
    );
}

function commandForTaskFile(type: string, target: string): string[] {
  if (type === "make") return ["make", target];
  if (type === "just") return ["just", target];
  return ["task", target];
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
