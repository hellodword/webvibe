import { access, readFile } from "node:fs/promises";
import path from "node:path";

import type { RelayPolicy } from "../../policy/policy.js";
import type { RegisteredTool } from "../../upstream/registry.js";
import { findExecutable, pathCategorySummary, type CommandResolution } from "./command.js";
import { inspectProject } from "./project.js";

type Detection = {
  detected: boolean;
  confidence: "low" | "medium" | "high";
  kind?: string;
  evidence: string[];
};

const COMMANDS_TO_CHECK = [
  "git",
  "node",
  "npm",
  "npx",
  "go",
  "gofmt",
  "cargo",
  "rustc",
  "python",
  "python3",
  "pip",
  "pip3",
  "uv",
  "rg",
  "make",
];

const SAFE_ENV_VALUES = new Set(["CI", "NODE_ENV", "TERM", "LANG", "LC_ALL"]);
const SENSITIVE_KEY_PATTERN =
  /(TOKEN|SECRET|KEY|PASSWORD|PASSWD|COOKIE|AUTH|CREDENTIAL|AWS_|AZURE_|GOOGLE_|GCP_|KUBE|DOCKER_CONFIG|PRIVATE)/i;

export async function inspectEnvironment(input: {
  registry: Map<string, RegisteredTool>;
  policy: RelayPolicy;
  workspaceRoot: string;
}): Promise<{
  status: "ok";
  summary: {
    mode?: string;
    platform: string;
    arch: string;
    container: Detection;
    ci: Detection;
    editor: Detection;
    guidance: string[];
  };
  environment: {
    safeValues: Record<string, string>;
    keyCategories: Array<{ category: string; keys: string[]; count: number; truncated: boolean }>;
    sensitive: { present: boolean; count: number };
  };
  path: {
    categories: Array<{ category: string; count: number }>;
    commands: Array<Omit<CommandResolution, "executablePath">>;
  };
  project: Awaited<ReturnType<typeof inspectProject>>;
  webvibe: {
    tools: string[];
    missingTasks: Array<{ taskId: string; executable: string; reason: string; executableCategory?: string }>;
    missingTaskExecutables: Array<{ taskId: string; executable: string; reason: string; executableCategory?: string }>;
  };
  guidance: string[];
}> {
  const project = await inspectProject({}, { workspaceRoot: input.workspaceRoot, workspace: input.policy.workspace });
  const commands = await commandMatrix(input.policy, input.workspaceRoot);
  const missingTasks = await taskAvailability(input.policy, input.workspaceRoot);
  const guidance = buildGuidance(project, commands, missingTasks);
  return {
    status: "ok",
    summary: {
      mode: input.policy.mode,
      platform: process.platform,
      arch: process.arch,
      container: await detectContainer(),
      ci: detectCi(),
      editor: detectEditor(),
      guidance: guidance.slice(0, 5),
    },
    environment: inspectEnvKeys(process.env),
    path: {
      categories: pathCategorySummary(process.env, input.workspaceRoot),
      commands,
    },
    project,
    webvibe: {
      tools: Array.from(input.registry.keys()).sort(),
      missingTasks,
      missingTaskExecutables: missingTasks.filter((task) => task.reason === "missing executable"),
    },
    guidance,
  };
}

async function commandMatrix(policy: RelayPolicy, workspaceRoot: string): Promise<Array<Omit<CommandResolution, "executablePath">>> {
  const taskExecutables = Object.values(policy.upstreams)
    .flatMap((upstream) => Object.values(upstream.tasks ?? {}))
    .map((task) => task.executable);
  const commands = Array.from(new Set([...COMMANDS_TO_CHECK, ...taskExecutables])).sort();
  const matrix: Array<Omit<CommandResolution, "executablePath">> = [];
  for (const command of commands) {
    const { executablePath: _executablePath, ...safe } = await findExecutable(command, process.env, workspaceRoot);
    matrix.push({ ...safe, command: displayExecutable(command) });
  }
  return matrix;
}

async function taskAvailability(
  policy: RelayPolicy,
  workspaceRoot: string,
): Promise<Array<{ taskId: string; executable: string; reason: string; executableCategory?: string }>> {
  const missing: Array<{ taskId: string; executable: string; reason: string; executableCategory?: string }> = [];
  for (const upstream of Object.values(policy.upstreams)) {
    if (upstream.transport !== "local-task-runner") continue;
    for (const [taskId, task] of Object.entries(upstream.tasks ?? {})) {
      const resolution = await findExecutable(task.executable, { ...process.env, ...upstream.env, ...task.env }, workspaceRoot);
      if (resolution.status === "missing") {
        missing.push({
          taskId,
          executable: displayExecutable(task.executable),
          reason: "missing executable",
          executableCategory: resolution.pathCategory,
        });
        continue;
      }
    }
  }
  return missing.slice(0, 100);
}

async function detectContainer(): Promise<Detection> {
  const evidence: string[] = [];
  if (await exists("/.dockerenv")) evidence.push("marker:/.dockerenv");
  if (await exists("/run/.containerenv")) evidence.push("marker:/run/.containerenv");
  if (process.env.DEVCONTAINER) evidence.push("env:DEVCONTAINER");
  if (process.env.CODESPACES) evidence.push("env:CODESPACES");
  if (process.env.KUBERNETES_SERVICE_HOST) evidence.push("env:KUBERNETES_SERVICE_HOST");
  const cgroup = await safeRead("/proc/1/cgroup");
  if (cgroup) {
    if (/docker|containerd/i.test(cgroup)) evidence.push("cgroup:container-runtime");
    if (/kubepods|kubernetes/i.test(cgroup)) evidence.push("cgroup:kubernetes");
  }
  return {
    detected: evidence.length > 0,
    confidence: evidence.some((item) => item.startsWith("marker:")) ? "high" : evidence.length > 0 ? "medium" : "low",
    kind: evidence.find((item) => item.includes("kubernetes")) ? "kubernetes" : evidence.length > 0 ? "container" : undefined,
    evidence: evidence.slice(0, 6),
  };
}

function detectCi(): Detection {
  const evidence: string[] = [];
  if (process.env.CI) evidence.push("env:CI");
  if (process.env.GITHUB_ACTIONS) evidence.push("env:GITHUB_ACTIONS");
  if (process.env.GITLAB_CI) evidence.push("env:GITLAB_CI");
  if (process.env.BUILDKITE) evidence.push("env:BUILDKITE");
  return {
    detected: evidence.length > 0,
    confidence: evidence.length > 0 ? "high" : "low",
    kind: evidence.length > 0 ? "ci" : undefined,
    evidence,
  };
}

function detectEditor(): Detection {
  const evidence: string[] = [];
  if (process.env.VSCODE_IPC_HOOK_CLI || process.env.TERM_PROGRAM === "vscode") evidence.push("env:VSCODE");
  if (process.env.CURSOR_TRACE_ID || process.env.CURSOR_AGENT) evidence.push("env:CURSOR");
  if (process.env.CODESPACES) evidence.push("env:CODESPACES");
  return {
    detected: evidence.length > 0,
    confidence: evidence.length > 0 ? "medium" : "low",
    kind: evidence.find((item) => item.includes("CURSOR")) ? "cursor" : evidence.length > 0 ? "editor" : undefined,
    evidence,
  };
}

function inspectEnvKeys(env: NodeJS.ProcessEnv): {
  safeValues: Record<string, string>;
  keyCategories: Array<{ category: string; keys: string[]; count: number; truncated: boolean }>;
  sensitive: { present: boolean; count: number };
} {
  const safeValues: Record<string, string> = {};
  const categories = new Map<string, string[]>();
  let sensitiveCount = 0;
  for (const key of Object.keys(env).sort()) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      sensitiveCount += 1;
      continue;
    }
    if (SAFE_ENV_VALUES.has(key) && env[key] !== undefined) safeValues[key] = String(env[key]);
    const category = envCategory(key);
    const keys = categories.get(category) ?? [];
    keys.push(key);
    categories.set(category, keys);
  }
  return {
    safeValues,
    keyCategories: Array.from(categories.entries())
      .map(([category, keys]) => ({
        category,
        keys: keys.slice(0, 30),
        count: keys.length,
        truncated: keys.length > 30,
      }))
      .sort((left, right) => left.category.localeCompare(right.category)),
    sensitive: { present: sensitiveCount > 0, count: sensitiveCount },
  };
}

function envCategory(key: string): string {
  if (key === "PATH" || key.endsWith("_PATH")) return "path";
  if (key.startsWith("npm_")) return "npm";
  if (key.startsWith("NODE") || key === "NVM_DIR") return "node";
  if (key.startsWith("GIT")) return "git";
  if (key === "CI" || key.endsWith("_CI")) return "ci";
  if (/VSCODE|CURSOR|CODESPACES|TERM_PROGRAM/.test(key)) return "editor";
  if (/SHELL|TERM|LANG|LC_/.test(key)) return "shell";
  return "other";
}

function buildGuidance(
  project: Awaited<ReturnType<typeof inspectProject>>,
  commands: Array<Omit<CommandResolution, "executablePath">>,
  missingTasks: Array<{ taskId: string; executable: string; reason: string }>,
): string[] {
  const guidance = [
    "No raw shell/exec tool is exposed by default; use task.run and change.apply.",
    "Tool lists are stable. If a fixed task cannot run, call result status will be unavailable with a reason.",
  ];
  if (!commands.find((command) => command.command === "make" && command.status === "available")) {
    guidance.push("Do not assume make/Makefile; prefer npm scripts or existing webvibe task tools.");
  }
  if (project.npmScripts.length > 0) {
    guidance.push(`Available npm scripts include: ${project.npmScripts.slice(0, 12).map((script) => script.name).join(", ")}.`);
  }
  if (project.manifests.some((manifest) => manifest.path.includes("/"))) {
    guidance.push("For monorepos, choose the manifest directory from project.manifests and pass it as task.run cwd.");
  }
  if (missingTasks.length > 0) {
    guidance.push(`Some task tools are currently unavailable: ${missingTasks.slice(0, 8).map((task) => task.taskId).join(", ")}.`);
  }
  return guidance;
}

function displayExecutable(executable: string): string {
  return executable.includes("/") || executable.includes("\\") ? path.basename(executable) : executable;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function safeRead(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}
