import { readFile } from "node:fs/promises";

import { BadRequestError } from "../../util/errors.js";
import { effectiveLimits } from "./limits.js";
import { resolveWorkspacePath, safeLstat } from "./path-guard.js";
import { manifestInputSchema, parseInput } from "./schema.js";
import { sha256Buffer } from "./text.js";
import type { ManifestEntry, ResolvedWorkspacePath, WorkspaceContext } from "./types.js";

export async function fileManifest(
  rawArgs: unknown,
  context: WorkspaceContext,
): Promise<{ status: "ok"; files: ManifestEntry[] }> {
  const input = parseInput(manifestInputSchema, rawArgs);
  const limits = effectiveLimits(context.limits);
  if (input.paths.length > limits.maxChangesetFiles) {
    throw new BadRequestError(`Too many paths; maximum is ${limits.maxChangesetFiles}`);
  }
  const files = [];
  for (const item of input.paths) {
    const resolved = await resolveWorkspacePath(item, context);
    files.push(await manifestEntry(resolved, limits.maxChangesetFileBytes));
  }
  return { status: "ok", files };
}

async function manifestEntry(
  resolved: ResolvedWorkspacePath,
  maxFileBytes: number,
): Promise<ManifestEntry> {
  const info = await safeLstat(resolved.absolutePath);
  if (!info) return { path: resolved.relativePath, exists: false, type: "missing" };
  if (info.isSymbolicLink()) {
    return {
      path: resolved.relativePath,
      exists: true,
      type: "symlink",
      sizeBytes: info.size,
      mtimeMs: info.mtimeMs,
    };
  }
  if (info.isDirectory()) {
    return {
      path: resolved.relativePath,
      exists: true,
      type: "directory",
      sizeBytes: info.size,
      mtimeMs: info.mtimeMs,
    };
  }
  if (!info.isFile()) {
    return {
      path: resolved.relativePath,
      exists: true,
      type: "other",
      sizeBytes: info.size,
      mtimeMs: info.mtimeMs,
    };
  }
  if (info.size > maxFileBytes) {
    return {
      path: resolved.relativePath,
      exists: true,
      type: "file",
      sizeBytes: info.size,
      mtimeMs: info.mtimeMs,
    };
  }
  const data = await readFile(resolved.absolutePath);
  return {
    path: resolved.relativePath,
    exists: true,
    type: "file",
    sizeBytes: data.byteLength,
    sha256: sha256Buffer(data),
    mtimeMs: info.mtimeMs,
  };
}
