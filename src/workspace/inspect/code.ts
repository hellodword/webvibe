import { open, readdir, readFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";

import { minimatch } from "minimatch";

import { defaultLimits, limitsPolicySchema } from "../../policy/schema.js";
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

const fallbackLimits = limitsPolicySchema.parse(defaultLimits);

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
  const limits = context.limits ?? fallbackLimits;
  const root = normalizeWorkspacePath(args.path, context);
  const maxResults = clampInteger(
    args.maxResults,
    limits.search.defaultMaxResults,
    1,
    limits.search.maxResults,
  );
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
    if (
      limits.search.maxScannedBytesPerFile !== null &&
      stat.size > limits.search.maxScannedBytesPerFile
    ) {
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
  const limits = context.limits ?? fallbackLimits;
  const root = normalizeWorkspacePath(args.path, context);
  const depth = clampInteger(args.depth, 3, 0, limits.tree.maxDepth);
  const maxEntries = clampInteger(
    args.maxEntries,
    limits.tree.defaultMaxEntries,
    1,
    limits.tree.maxEntries,
  );
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

export async function readFiles(
  args: Record<string, unknown>,
  context: InspectWorkspaceContext,
): Promise<{
  status: "ok";
  files: Array<{
    path: string;
    exists: boolean;
    type?: "file" | "directory" | "symlink" | "other";
    size?: number;
    offsetBytes?: number;
    returnedBytes?: number;
    nextOffsetBytes?: number;
    content?: string;
    truncated?: boolean;
    error?: string;
  }>;
}> {
  const limits = context.limits ?? fallbackLimits;
  const rawPaths = Array.isArray(args.paths) ? args.paths : undefined;
  if (!rawPaths || rawPaths.length === 0) throw new BadRequestError("paths must be a non-empty array");
  if (rawPaths.length > limits.read.maxReadManyFiles) throw new BadRequestError("paths has too many items");
  const requestedOffset = boundedInteger(args.offsetBytes, "offsetBytes", 0, 0, Number.MAX_SAFE_INTEGER);
  const maxBytes = boundedInteger(
    args.maxBytes,
    "maxBytes",
    limits.read.defaultMaxBytes,
    1,
    limits.read.maxBytes,
  );
  const files: Array<{
    path: string;
    exists: boolean;
    type?: "file" | "directory" | "symlink" | "other";
    size?: number;
    offsetBytes?: number;
    returnedBytes?: number;
    nextOffsetBytes?: number;
    content?: string;
    truncated?: boolean;
    error?: string;
  }> = [];
  for (const rawPath of rawPaths) {
    const resolved = normalizeWorkspacePath(rawPath, context, { allowRoot: false });
    const stat = await safeLstat(resolved.absolutePath);
    if (!stat) {
      files.push({ path: resolved.relativePath, exists: false });
      continue;
    }
    const type = stat.isDirectory()
      ? "directory"
      : stat.isFile()
        ? "file"
        : stat.isSymbolicLink()
          ? "symlink"
          : "other";
    if (!stat.isFile()) {
      files.push({
        path: resolved.relativePath,
        exists: true,
        type,
        size: stat.size,
        error: "Path is not a file",
      });
      continue;
    }
    const chunk = await readUtf8FileChunk(resolved.absolutePath, stat.size, requestedOffset, maxBytes);
    files.push({
      path: resolved.relativePath,
      exists: true,
      type,
      size: stat.size,
      offsetBytes: chunk.offsetBytes,
      returnedBytes: chunk.returnedBytes,
      ...(chunk.nextOffsetBytes === undefined ? {} : { nextOffsetBytes: chunk.nextOffsetBytes }),
      truncated: chunk.truncated,
      content: chunk.content,
    });
  }
  return { status: "ok", files };
}

async function readUtf8FileChunk(
  filePath: string,
  size: number,
  requestedOffset: number,
  maxBytes: number,
): Promise<{
  offsetBytes: number;
  returnedBytes: number;
  nextOffsetBytes?: number;
  truncated: boolean;
  content: string;
}> {
  if (requestedOffset >= size) {
    return { offsetBytes: requestedOffset, returnedBytes: 0, truncated: false, content: "" };
  }

  const handle = await open(filePath, "r");
  try {
    const offsetBytes = await nextUtf8Boundary(handle, requestedOffset, size);
    if (offsetBytes >= size) {
      return { offsetBytes, returnedBytes: 0, truncated: false, content: "" };
    }

    const bytesToRead = Math.min(maxBytes, size - offsetBytes);
    const buffer = Buffer.alloc(bytesToRead);
    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, offsetBytes);
    const readBuffer = buffer.subarray(0, bytesRead);
    const returnedBytes =
      offsetBytes + bytesRead >= size ? bytesRead : completeUtf8PrefixLength(readBuffer);
    if (bytesRead > 0 && returnedBytes === 0 && offsetBytes + bytesRead < size) {
      throw new BadRequestError("maxBytes is too small to include the next UTF-8 character");
    }

    const nextOffsetBytes = offsetBytes + returnedBytes;
    const truncated = nextOffsetBytes < size;
    return {
      offsetBytes,
      returnedBytes,
      ...(truncated ? { nextOffsetBytes } : {}),
      truncated,
      content: readBuffer.subarray(0, returnedBytes).toString("utf8"),
    };
  } finally {
    await handle.close();
  }
}

async function nextUtf8Boundary(handle: FileHandle, requestedOffset: number, size: number): Promise<number> {
  const probe = Buffer.alloc(1);
  let offset = requestedOffset;
  while (offset < size) {
    const { bytesRead } = await handle.read(probe, 0, 1, offset);
    if (bytesRead === 0 || !isUtf8ContinuationByte(probe[0])) return offset;
    offset += 1;
  }
  return offset;
}

function completeUtf8PrefixLength(buffer: Buffer): number {
  if (buffer.length === 0) return 0;
  let leadIndex = buffer.length - 1;
  while (leadIndex >= 0 && isUtf8ContinuationByte(buffer[leadIndex])) {
    leadIndex -= 1;
  }
  if (leadIndex < 0) return 0;
  const expectedLength = utf8SequenceLength(buffer[leadIndex]);
  if (expectedLength === 0) return buffer.length;
  return buffer.length - leadIndex >= expectedLength ? buffer.length : leadIndex;
}

function isUtf8ContinuationByte(byte: number): boolean {
  return byte >= 0x80 && byte <= 0xbf;
}

function utf8SequenceLength(byte: number): number {
  if (byte <= 0x7f) return 1;
  if (byte >= 0xc2 && byte <= 0xdf) return 2;
  if (byte >= 0xe0 && byte <= 0xef) return 3;
  if (byte >= 0xf0 && byte <= 0xf4) return 4;
  return 0;
}

export async function fileStat(
  args: Record<string, unknown>,
  context: InspectWorkspaceContext,
): Promise<{
  status: "ok";
  path: string;
  exists: boolean;
  type?: "file" | "directory" | "symlink" | "other";
  size?: number;
  modifiedAt?: string;
  createdAt?: string;
}> {
  const resolved = normalizeWorkspacePath(args.path, context, { allowRoot: true });
  const stat = await safeLstat(resolved.absolutePath);
  if (!stat) return { status: "ok", path: resolved.relativePath, exists: false };
  const type = stat.isDirectory()
    ? "directory"
    : stat.isFile()
      ? "file"
      : stat.isSymbolicLink()
        ? "symlink"
        : "other";
  return {
    status: "ok",
    path: resolved.relativePath,
    exists: true,
    type,
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    createdAt: stat.birthtime.toISOString(),
  };
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

function boundedInteger(
  value: unknown,
  field: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new BadRequestError(`${field} must be integer`);
  }
  if (value < minimum) throw new BadRequestError(`${field} is below minimum`);
  if (value > maximum) throw new BadRequestError(`${field} is above maximum`);
  return value;
}
