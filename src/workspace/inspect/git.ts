import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { WorkspacePolicy } from "../../policy/policy.js";
import { BadRequestError } from "../../util/errors.js";
import { sha256 } from "../../util/hash.js";
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

export async function gitBlame(args: Record<string, unknown>, context: GitContext): Promise<GitToolResult> {
  const pathArgs = pathspecArgs(args.path, context);
  if (pathArgs.length !== 1) throw new BadRequestError("path is required");
  const startLine = lineNumber(args.startLine ?? 1, "startLine");
  const endLine = lineNumber(args.endLine ?? startLine, "endLine");
  if (endLine < startLine) throw new BadRequestError("endLine must be >= startLine");
  const result = await runGit(
    ["blame", "--line-porcelain", "-L", `${startLine},${endLine}`, "--", ...pathArgs],
    context,
    "git blame",
  );
  if (result.status !== "ok") return result;
  return {
    ...result,
    path: pathArgs[0],
    startLine,
    endLine,
    lines: parseBlame(result.stdout),
  };
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

export async function gitCommitPreview(args: Record<string, unknown>, context: GitContext): Promise<GitToolResult> {
  const paths = commitPaths(args, context);
  const repo = await ensureGitRepo(context, "git commit_preview");
  if (repo.status !== "ok") return repo;
  return withTemporaryIndex(context, async (env) => {
    const head = await runGit(["rev-parse", "--verify", "HEAD"], context, "git rev-parse", env);
    const readTree =
      head.status === "ok"
        ? await runGit(["read-tree", "HEAD"], context, "git read-tree", env)
        : await runGit(["read-tree", "--empty"], context, "git read-tree --empty", env);
    if (readTree.status !== "ok") return readTree;
    const add = await runGit(["add", "--all", "--", ...paths], context, "git add", env);
    if (add.status !== "ok") return add;
    const diff = await runGit(["diff", "--cached", "--binary", "--", ...paths], context, "git diff --cached", env);
    if (diff.status !== "ok") return diff;
    const nameStatus = await runGit(
      ["diff", "--cached", "--name-status", "--", ...paths],
      context,
      "git diff --cached --name-status",
      env,
    );
    if (nameStatus.status !== "ok") return nameStatus;
    const previewHash = `sha256:${sha256({ paths, diff: diff.stdout, nameStatus: nameStatus.stdout })}`;
    return {
      command: "git commit_preview",
      status: "ok",
      exitCode: 0,
      stdout: diff.stdout,
      stderr: "",
      durationMs: diff.durationMs + nameStatus.durationMs,
      paths,
      diff: diff.stdout,
      nameStatus: nameStatus.stdout,
      clean: diff.stdout.length === 0,
      previewHash,
    };
  });
}

export async function gitCommitPaths(args: Record<string, unknown>, context: GitContext): Promise<GitToolResult> {
  const message = typeof args.message === "string" ? args.message.trim() : "";
  if (!message) throw new BadRequestError("message must not be empty");
  const paths = commitPaths(args, context);
  const previewHash = typeof args.previewHash === "string" ? args.previewHash : "";
  if (!previewHash) throw new BadRequestError("previewHash is required");

  const preview = await gitCommitPreview(args, context);
  if (preview.status !== "ok") return preview;
  if (preview.previewHash !== previewHash) throw new BadRequestError("previewHash mismatch");
  if (preview.clean === true) return noChangesResult(preview.durationMs as number);

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

async function runGit(
  args: string[],
  context: GitContext,
  command: string,
  env?: NodeJS.ProcessEnv,
): Promise<GitToolResult> {
  const result = await runFixedCommand({
    executable: "git",
    args,
    cwd: context.workspaceRoot,
    env,
    timeoutMs: 30000,
  });
  if (result.status === "failed" && /not a git repository|not a gitdir/i.test(result.stderr)) {
    return unavailable(command, "Workspace is not a Git work tree", result);
  }
  return { command, ...result };
}

function commitPaths(args: Record<string, unknown>, context: GitContext): string[] {
  if (!Array.isArray(args.paths) || args.paths.length === 0) {
    throw new BadRequestError("paths must be a non-empty array");
  }
  return args.paths.map((item) => {
    if (typeof item !== "string") throw new BadRequestError("paths items must be string");
    const resolved = normalizeWorkspacePath(item, context, { allowRoot: false });
    return resolved.relativePath;
  });
}

async function ensureGitRepo(context: GitContext, command: string): Promise<GitToolResult> {
  const repo = await runGit(["rev-parse", "--is-inside-work-tree"], context, "git rev-parse");
  if (repo.status !== "ok" || repo.stdout.trim() !== "true") {
    return unavailable(command, "Workspace is not a Git work tree", repo);
  }
  return repo;
}

async function withTemporaryIndex(
  context: GitContext,
  callback: (env: NodeJS.ProcessEnv) => Promise<GitToolResult>,
): Promise<GitToolResult> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "webvibe-git-index-"));
  try {
    return await callback({ ...process.env, GIT_INDEX_FILE: path.join(dir, "index") });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function noChangesResult(durationMs: number): GitToolResult {
  return {
    command: "git commit",
    status: "failed",
    exitCode: null,
    stdout: "",
    stderr: "No changes in explicit paths",
    durationMs,
    unavailableReason: "No changes in explicit paths",
  };
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

function lineNumber(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new BadRequestError(`${field} must be a positive integer`);
  }
  return value as number;
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

function parseBlame(stdout: string): Array<{
  commit: string;
  line: number;
  author?: string;
  authorTime?: number;
  content: string;
}> {
  const lines = stdout.split(/\r?\n/);
  const result = [];
  let current:
    | {
        commit: string;
        line: number;
        author?: string;
        authorTime?: number;
      }
    | undefined;
  for (const line of lines) {
    const header = /^([0-9a-f]{40}) \d+ (\d+)/.exec(line);
    if (header) {
      current = { commit: header[1], line: Number(header[2]) };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("author ")) current.author = line.slice("author ".length);
    if (line.startsWith("author-time ")) current.authorTime = Number(line.slice("author-time ".length));
    if (line.startsWith("\t")) {
      result.push({ ...current, content: line.slice(1) });
      current = undefined;
    }
  }
  return result;
}
