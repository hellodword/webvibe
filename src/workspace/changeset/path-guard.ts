import type { Stats } from "node:fs";
import { lstat } from "node:fs/promises";
import path from "node:path";

import { minimatch } from "minimatch";

import { ForbiddenError, BadRequestError } from "../../util/errors.js";
import { isInside, toWorkspaceRelative } from "../../util/paths.js";
import type { ResolvedWorkspacePath, WorkspaceContext } from "./types.js";

export async function resolveWorkspacePath(
  rawPath: string,
  context: WorkspaceContext,
): Promise<ResolvedWorkspacePath> {
  if (rawPath.includes("\0")) throw new BadRequestError("Path contains a NUL byte");
  if (path.isAbsolute(rawPath) || rawPath.startsWith("/")) {
    throw new ForbiddenError(`Path must be workspace-relative: ${rawPath}`);
  }
  const normalized = path.posix.normalize(rawPath.replaceAll("\\", "/"));
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new ForbiddenError(`Path is outside workspace: ${rawPath}`);
  }
  const absolutePath = path.resolve(context.workspaceRoot, normalized);
  if (!isInside(context.workspaceRoot, absolutePath)) {
    throw new ForbiddenError(`Path is outside workspace: ${rawPath}`);
  }
  const relativePath = toWorkspaceRelative(context.workspaceRoot, absolutePath);
  assertUnprotectedPath(relativePath, context.workspace.protected);
  await assertNoSymlinkAncestors(context.workspaceRoot, absolutePath, relativePath);
  return { relativePath, absolutePath };
}

export async function safeLstat(filePath: string): Promise<Stats | undefined> {
  try {
    return await lstat(filePath);
  } catch (error: any) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

async function assertNoSymlinkAncestors(
  workspaceRoot: string,
  absolutePath: string,
  relativePath: string,
): Promise<void> {
  const parent = path.dirname(absolutePath);
  const parts = path.relative(workspaceRoot, parent).split(path.sep).filter(Boolean);
  let current = workspaceRoot;
  for (const part of parts) {
    current = path.join(current, part);
    const info = await safeLstat(current);
    if (!info) return;
    if (info.isSymbolicLink()) {
      throw new ForbiddenError(`Path parent is a symlink: ${relativePath}`);
    }
    if (!info.isDirectory()) return;
  }
}

function assertUnprotectedPath(relativePath: string, protectedPatterns: string[]): void {
  const protectedPath = protectedPatterns.some(
    (pattern) =>
      minimatch(relativePath, pattern, { dot: true }) ||
      minimatch(`${relativePath}/__webvibe__`, pattern, { dot: true }),
  );
  if (protectedPath) throw new ForbiddenError(`Path is protected by policy: ${relativePath}`);
}
