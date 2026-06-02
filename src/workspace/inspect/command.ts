import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { isInside } from "../../util/paths.js";

export type CommandStatus = "available" | "missing";
export type PathCategory =
  | "workspace"
  | "node-modules"
  | "nix-store"
  | "homebrew"
  | "system"
  | "user-home"
  | "other";

export type CommandResolution = {
  command: string;
  status: CommandStatus;
  pathCategory?: PathCategory;
  executablePath?: string;
};

export type FixedCommandResult = {
  status: "ok" | "failed" | "timeout" | "unavailable";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  unavailableReason?: string;
};

export async function findExecutable(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
  workspaceRoot = process.cwd(),
): Promise<CommandResolution> {
  if (command.includes(path.sep) || (path.sep === "\\" && command.includes("/"))) {
    return executableResolution(command, command, workspaceRoot);
  }

  const pathValue = env.PATH ?? "";
  for (const dir of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const candidate of executableCandidates(path.join(dir, command))) {
      const result = await executableResolution(command, candidate, workspaceRoot);
      if (result.status === "available") return result;
    }
  }
  return { command, status: "missing" };
}

export function categorizePath(targetPath: string, workspaceRoot = process.cwd()): PathCategory {
  const normalized = targetPath.replaceAll("\\", "/");
  const home = os.homedir().replaceAll("\\", "/");
  const workspace = workspaceRoot.replaceAll("\\", "/");
  if (isInside(workspaceRoot, targetPath)) return normalized.includes("/node_modules/") ? "node-modules" : "workspace";
  if (normalized.startsWith("/nix/store/")) return "nix-store";
  if (normalized.startsWith("/opt/homebrew/") || normalized.startsWith("/usr/local/Homebrew/")) {
    return "homebrew";
  }
  if (
    normalized.startsWith("/bin/") ||
    normalized.startsWith("/usr/bin/") ||
    normalized.startsWith("/usr/local/bin/") ||
    normalized.startsWith("/sbin/") ||
    normalized.startsWith("/usr/sbin/")
  ) {
    return "system";
  }
  if (home !== "/" && (normalized === home || normalized.startsWith(`${home}/`))) return "user-home";
  if (normalized === workspace || normalized.startsWith(`${workspace}/`)) return "workspace";
  return "other";
}

export function pathCategorySummary(
  env: NodeJS.ProcessEnv = process.env,
  workspaceRoot = process.cwd(),
): Array<{ category: PathCategory; count: number }> {
  const counts = new Map<PathCategory, number>();
  for (const dir of (env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    const category = categorizePath(dir, workspaceRoot);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((left, right) => left.category.localeCompare(right.category));
}

export async function runFixedCommand(input: {
  executable: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}): Promise<FixedCommandResult> {
  const startedAt = Date.now();
  const env = input.env ?? process.env;
  const resolution = await findExecutable(input.executable, env, input.cwd);
  if (resolution.status === "missing") {
    return {
      status: "unavailable",
      exitCode: null,
      stdout: "",
      stderr: `Command unavailable: ${input.executable}`,
      durationMs: Date.now() - startedAt,
      unavailableReason: `Missing executable: ${input.executable}`,
    };
  }

  return new Promise<FixedCommandResult>((resolve) => {
    const child = spawn(input.executable, input.args, {
      cwd: input.cwd,
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;
    const timeout =
      input.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
            killTimer = setTimeout(() => {
              if (!settled) child.kill("SIGKILL");
            }, 2000);
          }, input.timeoutMs);

    const finish = (result: FixedCommandResult) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      resolve(result);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      finish({
        status: error.code === "ENOENT" ? "unavailable" : "failed",
        exitCode: null,
        stdout: stdout.trimEnd(),
        stderr: (stderr || error.message).trimEnd(),
        durationMs: Date.now() - startedAt,
        ...(error.code === "ENOENT"
          ? { unavailableReason: `Missing executable: ${input.executable}` }
          : {}),
      });
    });
    child.on("close", (code) => {
      finish({
        status: timedOut ? "timeout" : code === 0 ? "ok" : "failed",
        exitCode: code,
        stdout: stdout.trimEnd(),
        stderr: stderr.trimEnd(),
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

async function executableResolution(
  command: string,
  candidate: string,
  workspaceRoot: string,
): Promise<CommandResolution> {
  try {
    await access(candidate, constants.X_OK);
    return {
      command,
      status: "available",
      pathCategory: categorizePath(candidate, workspaceRoot),
      executablePath: candidate,
    };
  } catch {
    return { command, status: "missing" };
  }
}

function executableCandidates(candidate: string): string[] {
  if (process.platform !== "win32") return [candidate];
  const extensions = (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";");
  if (extensions.some((extension) => candidate.toUpperCase().endsWith(extension))) return [candidate];
  return extensions.map((extension) => `${candidate}${extension.toLowerCase()}`);
}

