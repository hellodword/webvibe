import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { minimatch } from "minimatch";

import { BadRequestError } from "../../util/errors.js";
import type { InspectWorkspaceContext } from "./path.js";
import { isProtectedPath, normalizeWorkspacePath, safeLstat } from "./path.js";

type SearchMatch = {
  path: string;
  line: number;
  column: number;
  text: string;
};

type WalkCounters = {
  protected: number;
  binary: number;
  tooLarge: number;
  missing: number;
};

const DEFAULT_MAX_RESULTS = 50;
const MAX_RESULTS = 200;
const MAX_TREE_ENTRIES = 1000;
const MAX_SEARCH_FILE_BYTES = 1024 * 1024;

export async function searchCode(
  args: Record<string, unknown>,
  context: InspectWorkspaceContext,
): Promise<{
  status: "ok";
  query: string;
  matches: SearchMatch[];
  searchedFiles: number;
  skipped: WalkCounters;
  truncated: boolean;
}> {
  const query = requiredString(args.query, "query");
  if (query.length === 0) throw new BadRequestError("query must not be empty");
  const root = normalizeWorkspacePath(args.path, context);
  const maxResults = clampInteger(args.maxResults, DEFAULT_MAX_RESULTS, 1, MAX_RESULTS);
  const caseSensitive = args.caseSensitive === true;
  const glob = typeof args.glob === "string" && args.glob.length > 0 ? args.glob : undefined;
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: SearchMatch[] = [];
  const skipped: WalkCounters = { protected: 0, binary: 0, tooLarge: 0, missing: 0 };
  let searchedFiles = 0;
  let truncated = false;

  await walkFiles(root.absolutePath, root.relativePath, context, skipped, async (filePath, relativePath) => {
    if (truncated) return;
    if (glob && !minimatch(relativePath, glob, { dot: true })) return;
    const stat = await safeLstat(filePath);
    if (!stat) {
      skipped.missing += 1;
      return;
    }
    if (stat.size > MAX_SEARCH_FILE_BYTES) {
      skipped.tooLarge += 1;
      return;
    }
    const buffer = await readFile(filePath);
    if (buffer.includes(0)) {
      skipped.binary += 1;
      return;
    }
    searchedFiles += 1;
    const text = buffer.toString("utf8");
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const haystack = caseSensitive ? lines[index] : lines[index].toLowerCase();
      const column = haystack.indexOf(needle);
      if (column === -1) continue;
      matches.push({
        path: relativePath,
        line: index + 1,
        column: column + 1,
        text: lines[index].slice(0, 500),
      });
      if (matches.length >= maxResults) {
        truncated = true;
        return;
      }
    }
  });

  return { status: "ok", query, matches, searchedFiles, skipped, truncated };
}

export async function fileTree(
  args: Record<string, unknown>,
  context: InspectWorkspaceContext,
): Promise<{
  status: "ok";
  root: string;
  entries: Array<{ path: string; type: "directory" | "file" | "symlink" | "other"; size?: number }>;
  skipped: { protected: number; missing: number };
  truncated: boolean;
}> {
  const root = normalizeWorkspacePath(args.path, context);
  const depth = clampInteger(args.depth, 3, 0, 8);
  const maxEntries = clampInteger(args.maxEntries, 200, 1, MAX_TREE_ENTRIES);
  const entries: Array<{ path: string; type: "directory" | "file" | "symlink" | "other"; size?: number }> = [];
  const skipped = { protected: 0, missing: 0 };
  let truncated = false;

  const visit = async (absolutePath: string, relativePath: string, currentDepth: number): Promise<void> => {
    if (truncated) return;
    const stat = await safeLstat(absolutePath);
    if (!stat) {
      skipped.missing += 1;
      return;
    }
    const type = stat.isDirectory()
      ? "directory"
      : stat.isFile()
        ? "file"
        : stat.isSymbolicLink()
          ? "symlink"
          : "other";
    if (relativePath !== ".") {
      entries.push({
        path: relativePath,
        type,
        ...(stat.isFile() ? { size: stat.size } : {}),
      });
      if (entries.length >= maxEntries) {
        truncated = true;
        return;
      }
    }
    if (!stat.isDirectory() || stat.isSymbolicLink() || currentDepth >= depth) return;
    const children = await readdir(absolutePath, { withFileTypes: true });
    children.sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
    for (const child of children) {
      const childRelative = relativePath === "." ? child.name : `${relativePath}/${child.name}`;
      if (isProtectedPath(childRelative, context.workspace.protected)) {
        skipped.protected += 1;
        continue;
      }
      await visit(path.join(absolutePath, child.name), childRelative, currentDepth + 1);
      if (truncated) return;
    }
  };

  await visit(root.absolutePath, root.relativePath, 0);
  return { status: "ok", root: root.relativePath, entries, skipped, truncated };
}

async function walkFiles(
  absolutePath: string,
  relativePath: string,
  context: InspectWorkspaceContext,
  skipped: WalkCounters,
  onFile: (filePath: string, relativePath: string) => Promise<void>,
): Promise<void> {
  const stat = await safeLstat(absolutePath);
  if (!stat) {
    skipped.missing += 1;
    return;
  }
  if (stat.isSymbolicLink()) return;
  if (stat.isFile()) {
    await onFile(absolutePath, relativePath);
    return;
  }
  if (!stat.isDirectory()) return;
  const children = await readdir(absolutePath, { withFileTypes: true });
  children.sort((left, right) => left.name.localeCompare(right.name));
  for (const child of children) {
    const childRelative = relativePath === "." ? child.name : `${relativePath}/${child.name}`;
    if (isProtectedPath(childRelative, context.workspace.protected)) {
      skipped.protected += 1;
      continue;
    }
    await walkFiles(path.join(absolutePath, child.name), childRelative, context, skipped, onFile);
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new BadRequestError(`${field} must be string`);
  return value;
}

function clampInteger(value: unknown, defaultValue: number, minimum: number, maximum: number): number {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new BadRequestError("numeric option must be integer");
  }
  return Math.min(Math.max(value, minimum), maximum);
}
