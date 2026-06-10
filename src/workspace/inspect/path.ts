import type { Stats } from "node:fs";
import { lstat } from "node:fs/promises";
import path from "node:path";

import { minimatch } from "minimatch";

import type { LimitsPolicy, WorkspacePolicy } from "../../policy/policy.js";
import { BadRequestError, ForbiddenError } from "../../util/errors.js";
import { isInside, toWorkspaceRelative } from "../../util/paths.js";

export type InspectWorkspaceContext = {
  workspaceRoot: string;
  workspace: WorkspacePolicy;
  limits?: LimitsPolicy;
};

export type ResolvedInspectPath = {
  relativePath: string;
  absolutePath: string;
};

export function normalizeWorkspacePath(
  rawPath: unknown,
  context: InspectWorkspaceContext,
  options: { defaultPath?: string; allowRoot?: boolean; allowProtected?: boolean } = {},
): ResolvedInspectPath {
  const defaultPath = options.defaultPath ?? ".";
  const allowRoot = options.allowRoot ?? true;
  const text = rawPath === undefined || rawPath === null || rawPath === "" ? defaultPath : rawPath;
  if (typeof text !== "string") throw new BadRequestError("Path must be string");
  if (text.includes("\0")) throw new BadRequestError("Path contains a NUL byte");
  if (path.isAbsolute(text) || text.startsWith("/")) {
    throw new ForbiddenError(`Path must be workspace-relative: ${text}`);
  }

  const normalized = path.posix.normalize(text.replaceAll("\\", "/"));
  if ((!allowRoot && normalized === ".") || normalized === ".." || normalized.startsWith("../")) {
    throw new ForbiddenError(`Path is outside workspace: ${text}`);
  }
  const absolutePath = path.resolve(context.workspaceRoot, normalized);
  if (!isInside(context.workspaceRoot, absolutePath)) {
    throw new ForbiddenError(`Path is outside workspace: ${text}`);
  }
  const relativePath = toWorkspaceRelative(context.workspaceRoot, absolutePath) || ".";
  if (!options.allowProtected && relativePath !== "." && isProtectedPath(relativePath, context.workspace.protected)) {
    throw new ForbiddenError(`Path is protected by policy: ${relativePath}`);
  }
  return { relativePath, absolutePath };
}

export function isProtectedPath(relativePath: string, protectedPatterns: string[]): boolean {
  if (relativePath === ".") return false;
  return protectedPatterns.some(
    (pattern) =>
      minimatch(relativePath, pattern, { dot: true }) ||
      minimatch(`${relativePath}/__webvibe__`, pattern, { dot: true }),
  );
}

export async function safeLstat(filePath: string): Promise<Stats | undefined> {
  try {
    return await lstat(filePath);
  } catch (error: any) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}
