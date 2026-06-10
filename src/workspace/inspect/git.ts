import type { WorkspacePolicy } from "../../policy/policy.js";
import { BadRequestError } from "../../util/errors.js";
import { normalizeWorkspacePath } from "./path.js";
import { runFixedCommand, type FixedCommandResult } from "./command.js";

type GitContext = {
  workspaceRoot: string;
  workspace: WorkspacePolicy;
};

export type GitToolResult = FixedCommandResult & {
  command: string;
  [key: string]: unknown;
};

export async function gitStatus(_args: Record<string, unknown>, context: GitContext): Promise<GitToolResult> {
  const status = await runGit(["status", "--short", "--branch"], context, "git status --short --branch");
  if (status.status !== "ok") return status;
  const branch = parseBranchLine(status.stdout.split(/\r?\n/)[0] ?? "");
  const head = await runGit(["rev-parse", "--short", "HEAD"], context, "git rev-parse --short HEAD");
  return {
    ...status,
    branch: branch.branch,
    head: head.status === "ok" ? head.stdout.trim() : null,
    upstream: branch.upstream,
    aheadBehind: { ahead: branch.ahead, behind: branch.behind },
    clean: status.stdout
      .split(/\r?\n/)
      .filter((line) => line.length > 0 && !line.startsWith("##")).length === 0,
  };
}

export async function gitChanged(_args: Record<string, unknown>, context: GitContext): Promise<GitToolResult> {
  const result = await runGit(["status", "--porcelain=v1", "--branch"], context, "git status --porcelain");
  if (result.status !== "ok") return result;
  const changes = result.stdout
    .split(/\r?\n/)
    .filter((line) => line.length > 0 && !line.startsWith("##"))
    .map(parsePorcelainLine);
  return {
    ...result,
    staged: changes.filter((change) => change.index !== " " && change.index !== "?"),
    unstaged: changes.filter((change) => change.worktree !== " " && change.index !== "?"),
    untracked: changes.filter((change) => change.index === "?" && change.worktree === "?"),
    changes,
  };
}

export async function gitDiffUnstaged(args: Record<string, unknown>, context: GitContext): Promise<GitToolResult> {
  const pathArgs = pathspecArgs(args.path, context);
  return runGit(["diff", "--", ...pathArgs], context, "git diff");
}

export async function gitDiffStaged(args: Record<string, unknown>, context: GitContext): Promise<GitToolResult> {
  const pathArgs = pathspecArgs(args.path, context);
  return runGit(["diff", "--cached", "--", ...pathArgs], context, "git diff --cached");
}

export async function gitLog(args: Record<string, unknown>, context: GitContext): Promise<GitToolResult> {
  const maxCount =
    args.maxCount === undefined
      ? 20
      : Number.isInteger(args.maxCount)
        ? Math.min(Math.max(args.maxCount as number, 1), 200)
        : undefined;
  if (maxCount === undefined) throw new BadRequestError("maxCount must be integer");
  return runGit(["log", "--oneline", "--decorate", `--max-count=${maxCount}`], context, "git log");
}

export async function gitShow(args: Record<string, unknown>, context: GitContext): Promise<GitToolResult> {
  const revision = safeGitRevision(args.revision ?? "HEAD", "revision");
  const pathArgs = pathspecArgs(args.path, context);
  return runGit(["show", "--stat", "--patch", revision, "--", ...pathArgs], context, "git show");
}

export async function gitBranch(args: Record<string, unknown>, context: GitContext): Promise<GitToolResult> {
  const all = args.all === true;
  return runGit(["branch", all ? "--all" : "--list"], context, all ? "git branch --all" : "git branch --list");
}

export async function gitLsFiles(args: Record<string, unknown>, context: GitContext): Promise<GitToolResult> {
  const pathArgs = pathspecArgs(args.path, context);
  return runGit(["ls-files", "--", ...pathArgs], context, "git ls-files");
}

export async function gitRevParse(args: Record<string, unknown>, context: GitContext): Promise<GitToolResult> {
  const revision = safeGitRevision(args.revision ?? "HEAD", "revision");
  return runGit(["rev-parse", "--verify", revision], context, "git rev-parse");
}

export async function gitCommitPaths(args: Record<string, unknown>, context: GitContext): Promise<GitToolResult> {
  const message = typeof args.message === "string" ? args.message.trim() : "";
  if (!message) throw new BadRequestError("message must not be empty");
  if (!Array.isArray(args.paths) || args.paths.length === 0) {
    throw new BadRequestError("paths must be a non-empty array");
  }
  const paths = args.paths.map((item) => {
    if (typeof item !== "string") throw new BadRequestError("paths items must be string");
    const resolved = normalizeWorkspacePath(item, context, { allowRoot: false });
    return resolved.relativePath;
  });

  const repo = await runGit(["rev-parse", "--is-inside-work-tree"], context, "git rev-parse");
  if (repo.status !== "ok" || repo.stdout.trim() !== "true") {
    return unavailable("git commit", "Workspace is not a Git work tree", repo);
  }

  const add = await runGit(["add", "--all", "--", ...paths], context, "git add");
  if (add.status !== "ok") return add;

  const diff = await runGit(["diff", "--cached", "--quiet", "--", ...paths], context, "git diff --cached --quiet");
  if (diff.status === "ok") {
    return {
      command: "git commit",
      status: "failed",
      exitCode: null,
      stdout: "",
      stderr: "No changes in explicit paths",
      durationMs: diff.durationMs,
      unavailableReason: "No changes in explicit paths",
    };
  }
  if (diff.status !== "failed" || diff.exitCode !== 1) return diff;

  return runGit(["commit", "--only", "-m", message, "--", ...paths], context, "git commit --only");
}

async function runGit(args: string[], context: GitContext, command: string): Promise<GitToolResult> {
  const result = await runFixedCommand({
    executable: "git",
    args,
    cwd: context.workspaceRoot,
    timeoutMs: 30000,
  });
  if (result.status === "failed" && /not a git repository|not a gitdir/i.test(result.stderr)) {
    return unavailable(command, "Workspace is not a Git work tree", result);
  }
  return { command, ...result };
}

function pathspecArgs(rawPath: unknown, context: GitContext): string[] {
  if (rawPath === undefined || rawPath === null || rawPath === "") return [];
  const resolved = normalizeWorkspacePath(rawPath, context, { allowRoot: true });
  return resolved.relativePath === "." ? [] : [resolved.relativePath];
}

function safeGitRevision(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new BadRequestError(`${field} must be string`);
  }
  if (value.includes("\0") || /\s/.test(value) || value.startsWith("-") || value.length > 200) {
    throw new BadRequestError(`${field} is not a safe Git revision token`);
  }
  return value;
}

function unavailable(command: string, reason: string, base: FixedCommandResult): GitToolResult {
  return {
    command,
    status: "unavailable",
    exitCode: base.exitCode,
    stdout: base.stdout,
    stderr: base.stderr || reason,
    durationMs: base.durationMs,
    unavailableReason: reason,
  };
}

function parseBranchLine(line: string): {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
} {
  if (!line.startsWith("## ")) return { branch: null, upstream: null, ahead: 0, behind: 0 };
  const text = line.slice(3);
  const [left, meta = ""] = text.split(" [");
  const [branch, upstream = null] = left.split("...");
  return {
    branch: branch || null,
    upstream,
    ahead: numberFromMeta(meta, "ahead"),
    behind: numberFromMeta(meta, "behind"),
  };
}

function numberFromMeta(meta: string, key: "ahead" | "behind"): number {
  const match = new RegExp(`${key} (\\d+)`).exec(meta);
  return match ? Number(match[1]) : 0;
}

function parsePorcelainLine(line: string): {
  path: string;
  index: string;
  worktree: string;
  nameStatus: string;
  originalPath?: string;
} {
  const index = line[0] ?? " ";
  const worktree = line[1] ?? " ";
  const rawPath = line.slice(3);
  const rename = rawPath.includes(" -> ") ? rawPath.split(" -> ") : undefined;
  return {
    path: rename ? rename[1] : rawPath,
    ...(rename ? { originalPath: rename[0] } : {}),
    index,
    worktree,
    nameStatus: `${index}${worktree}`.trim() || "clean",
  };
}
