import { createHash } from "node:crypto";
import { open, readdir, readFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";

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
  submatches: Array<{ start: number; end: number }>;
  before: string[];
  after: string[];
};

type WalkCounters = {
  protected: number;
  binary: number;
  tooLarge: number;
  missing: number;
};

const fallbackLimits = limitsPolicySchema.parse(defaultLimits);
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

type ReadFileRequest = {
  path: unknown;
  byteOffset?: unknown;
  offsetBytes?: unknown;
  maxBytes?: unknown;
  range?: unknown;
};

type FileReadResult = {
  path: string;
  exists: boolean;
  type?: "file" | "directory" | "symlink" | "other";
  kind?: "text" | "binary";
  size?: number;
  sha256?: string;
  offsetBytes?: number;
  returnedBytes?: number;
  nextOffsetBytes?: number;
  range?: { startLine: number; endLine: number };
  returnedLines?: number;
  content?: string;
  truncated?: boolean;
  error?: string;
};

export async function searchCode(
  args: Record<string, unknown>,
  context: InspectWorkspaceContext,
): Promise<{
  status: "ok";
  query: string;
  mode: "fixed" | "regex";
  case: "smart" | "sensitive" | "insensitive";
  matches: SearchMatch[];
  searchedFiles: number;
  skipped: WalkCounters;
  truncated: boolean;
}> {
  const query = requiredString(args.query, "query");
  if (query.length === 0) throw new BadRequestError("query must not be empty");
  const limits = context.limits ?? fallbackLimits;
  const root = normalizeWorkspacePath(args.path, context);
  const mode = args.mode === "regex" ? "regex" : "fixed";
  const caseMode =
    args.case === "sensitive" || args.case === "insensitive" || args.case === "smart"
      ? args.case
      : args.caseSensitive === true
        ? "sensitive"
        : "smart";
  const maxResults = clampInteger(
    args.maxResults,
    limits.search.defaultMaxResults,
    1,
    limits.search.maxResults,
  );
  const maxColumns = clampInteger(args.maxColumns, limits.search.maxColumns, 1, limits.search.maxColumns);
  const contextLines = clampInteger(args.contextLines, 0, 0, limits.search.maxContextLines);
  const caseSensitive = caseMode === "sensitive" || (caseMode === "smart" && /[A-Z]/.test(query));
  const include = globList(args.include, typeof args.glob === "string" ? [args.glob] : []);
  const exclude = globList(args.exclude);
  const matcher = buildMatcher(query, mode, caseSensitive);
  const matches: SearchMatch[] = [];
  const skipped: WalkCounters = { protected: 0, binary: 0, tooLarge: 0, missing: 0 };
  let searchedFiles = 0;
  let truncated = false;

  await walkFiles(root.absolutePath, root.relativePath, context, skipped, async (filePath, relativePath) => {
    if (truncated) return;
    if (include.length > 0 && !include.some((glob) => minimatch(relativePath, glob, { dot: true }))) return;
    if (exclude.some((glob) => minimatch(relativePath, glob, { dot: true }))) return;
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
      const submatches = findSubmatches(lines[index], matcher);
      if (submatches.length === 0) continue;
      matches.push({
        path: relativePath,
        line: index + 1,
        column: submatches[0].start + 1,
        text: lines[index].slice(0, maxColumns),
        submatches,
        before: lines.slice(Math.max(0, index - contextLines), index).map((line) => line.slice(0, maxColumns)),
        after: lines.slice(index + 1, index + 1 + contextLines).map((line) => line.slice(0, maxColumns)),
      });
      if (matches.length >= maxResults) {
        truncated = true;
        return;
      }
    }
  });

  return { status: "ok", query, mode, case: caseMode, matches, searchedFiles, skipped, truncated };
}

function globList(value: unknown, fallback: string[] = []): string[] {
  if (value === undefined || value === null) return fallback.filter(Boolean);
  if (typeof value === "string") return value.length > 0 ? [value] : fallback.filter(Boolean);
  if (!Array.isArray(value)) throw new BadRequestError("glob list must be string or array");
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function buildMatcher(
  query: string,
  mode: "fixed" | "regex",
  caseSensitive: boolean,
): { mode: "fixed" | "regex"; query: string; regex?: RegExp; caseSensitive: boolean } {
  if (mode === "fixed") return { mode, query, caseSensitive };
  try {
    return { mode, query, caseSensitive, regex: new RegExp(query, caseSensitive ? "g" : "gi") };
  } catch {
    throw new BadRequestError("query must be a valid regular expression");
  }
}

function findSubmatches(
  line: string,
  matcher: { mode: "fixed" | "regex"; query: string; regex?: RegExp; caseSensitive: boolean },
): Array<{ start: number; end: number }> {
  if (matcher.mode === "regex") {
    const regex = matcher.regex!;
    regex.lastIndex = 0;
    const submatches: Array<{ start: number; end: number }> = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(line)) !== null) {
      const text = match[0];
      submatches.push({ start: match.index, end: match.index + text.length });
      if (text.length === 0) regex.lastIndex += 1;
    }
    return submatches;
  }
  const haystack = matcher.caseSensitive ? line : line.toLowerCase();
  const needle = matcher.caseSensitive ? matcher.query : matcher.query.toLowerCase();
  const submatches: Array<{ start: number; end: number }> = [];
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    submatches.push({ start: index, end: index + needle.length });
    index = haystack.indexOf(needle, index + Math.max(needle.length, 1));
  }
  return submatches;
}

export async function fileTree(
  args: Record<string, unknown>,
  context: InspectWorkspaceContext,
): Promise<{
  status: "ok";
  root: string;
  entries: Array<{ path: string; type: "directory" | "file" | "symlink" | "other"; size?: number }>;
  skipped: { protected: number; missing: number };
  stats: { filesSeen: number; dirsSeen: number; protectedSkipped: number };
  omitted: Array<{ path: string; reason: string }>;
  truncated: boolean;
}> {
  const limits = context.limits ?? fallbackLimits;
  const root = normalizeWorkspacePath(args.path, context);
  const mode = args.mode === "packages" ? "packages" : "all";
  const include = globList(args.include);
  const exclude = globList(args.exclude);
  const respectGitignore = args.respectGitignore !== false;
  const includeHidden = args.includeHidden === true;
  const gitignore = respectGitignore ? await readGitignore(context.workspaceRoot) : [];
  const depth = clampInteger(args.depth, 3, 0, limits.tree.maxDepth);
  const maxEntries = clampInteger(
    args.maxEntries,
    limits.tree.defaultMaxEntries,
    1,
    limits.tree.maxEntries,
  );
  const entries: Array<{ path: string; type: "directory" | "file" | "symlink" | "other"; size?: number }> = [];
  const skipped = { protected: 0, missing: 0 };
  const stats = { filesSeen: 0, dirsSeen: 0, protectedSkipped: 0 };
  const omitted: Array<{ path: string; reason: string }> = [];
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
    if (stat.isDirectory()) stats.dirsSeen += 1;
    if (stat.isFile()) stats.filesSeen += 1;
    const shouldEmit =
      relativePath !== "." &&
      (mode !== "packages" || isPackageManifest(relativePath)) &&
      (include.length === 0 || include.some((glob) => minimatch(relativePath, glob, { dot: true })));
    if (shouldEmit) {
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
        stats.protectedSkipped += 1;
        omitted.push({ path: childRelative, reason: "protected" });
        continue;
      }
      if (!includeHidden && child.name.startsWith(".")) {
        omitted.push({ path: childRelative, reason: "hidden" });
        continue;
      }
      if (exclude.some((glob) => minimatch(childRelative, glob, { dot: true }))) {
        omitted.push({ path: childRelative, reason: "excluded" });
        continue;
      }
      if (gitignore.some((glob) => minimatch(childRelative, glob, { dot: true }))) {
        omitted.push({ path: childRelative, reason: "gitignored" });
        continue;
      }
      await visit(path.join(absolutePath, child.name), childRelative, currentDepth + 1);
      if (truncated) return;
    }
  };

  await visit(root.absolutePath, root.relativePath, 0);
  return { status: "ok", root: root.relativePath, entries, skipped, stats, omitted, truncated };
}

async function readGitignore(workspaceRoot: string): Promise<string[]> {
  try {
    const text = await readFile(path.join(workspaceRoot, ".gitignore"), "utf8");
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function isPackageManifest(relativePath: string): boolean {
  return /(^|\/)(package\.json|go\.mod|go\.work|Cargo\.toml|pyproject\.toml|requirements\.txt|pubspec\.yaml|melos\.yaml)$/.test(
    relativePath,
  );
}

export async function readFiles(
  args: Record<string, unknown>,
  context: InspectWorkspaceContext,
): Promise<{
  status: "ok";
  files: FileReadResult[];
}> {
  const limits = context.limits ?? fallbackLimits;
  const requests = readRequests(args);
  if (requests.length > limits.read.maxReadManyFiles) throw new BadRequestError("files has too many items");
  const defaultMaxBytes = boundedInteger(
    args.maxBytesPerFile,
    "maxBytesPerFile",
    limits.read.defaultMaxBytes,
    1,
    limits.read.maxBytes,
  );
  const files: FileReadResult[] = [];
  for (const request of requests) {
    const resolved = normalizeWorkspacePath(request.path, context, { allowRoot: false });
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
    const data = await readFile(resolved.absolutePath);
    const sha256 = sha256Buffer(data);
    const text = decodeText(data);
    if (text === undefined) {
      files.push({
        path: resolved.relativePath,
        exists: true,
        type,
        kind: "binary",
        size: stat.size,
        sha256,
        truncated: false,
      });
      continue;
    }
    const range = parseLineRange(request.range);
    if (range) {
      files.push(readLineRange(resolved.relativePath, stat.size, sha256, text, range));
      continue;
    }
    const offsetField = request.byteOffset === undefined ? "offsetBytes" : "byteOffset";
    const requestedOffset = boundedInteger(
      request.byteOffset ?? request.offsetBytes,
      offsetField,
      0,
      0,
      Number.MAX_SAFE_INTEGER,
    );
    const maxBytes = boundedInteger(
      request.maxBytes,
      "maxBytes",
      defaultMaxBytes,
      1,
      limits.read.maxBytes,
    );
    const chunk = await readUtf8FileChunk(resolved.absolutePath, stat.size, requestedOffset, maxBytes);
    files.push({
      path: resolved.relativePath,
      exists: true,
      type,
      kind: "text",
      size: stat.size,
      sha256,
      offsetBytes: chunk.offsetBytes,
      returnedBytes: chunk.returnedBytes,
      ...(chunk.nextOffsetBytes === undefined ? {} : { nextOffsetBytes: chunk.nextOffsetBytes }),
      truncated: chunk.truncated,
      content: chunk.content,
    });
  }
  return { status: "ok", files };
}

function readRequests(args: Record<string, unknown>): ReadFileRequest[] {
  if (Array.isArray(args.files)) {
    if (args.files.length === 0) throw new BadRequestError("files must be a non-empty array");
    return args.files.map((item) => {
      if (typeof item === "string") return { path: item };
      if (typeof item === "object" && item !== null && !Array.isArray(item)) {
        return item as ReadFileRequest;
      }
      throw new BadRequestError("files items must be objects");
    });
  }
  if (Array.isArray(args.paths)) {
    if (args.paths.length === 0) throw new BadRequestError("paths must be a non-empty array");
    return args.paths.map((item) => ({
      path: item,
      offsetBytes: args.offsetBytes,
      maxBytes: args.maxBytes,
    }));
  }
  if ("path" in args) return [{ ...args, path: args.path }];
  throw new BadRequestError("path or files must be provided");
}

function parseLineRange(value: unknown): { startLine: number; endLine: number } | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestError("range must be object");
  }
  const raw = value as Record<string, unknown>;
  const startLine = boundedInteger(raw.startLine, "range.startLine", 1, 1, Number.MAX_SAFE_INTEGER);
  const endLine = boundedInteger(raw.endLine, "range.endLine", startLine, startLine, Number.MAX_SAFE_INTEGER);
  return { startLine, endLine };
}

function readLineRange(
  relativePath: string,
  size: number,
  sha256: string,
  text: string,
  range: { startLine: number; endLine: number },
): FileReadResult {
  const lines = text.split(/\r?\n/);
  const selected = lines.slice(range.startLine - 1, range.endLine);
  const content = selected.join("\n");
  return {
    path: relativePath,
    exists: true,
    type: "file",
    kind: "text",
    size,
    sha256,
    range,
    returnedLines: selected.length,
    returnedBytes: Buffer.byteLength(content, "utf8"),
    truncated: range.endLine < lines.length,
    content,
  };
}

function decodeText(data: Buffer): string | undefined {
  if (data.includes(0)) return undefined;
  try {
    return utf8Decoder.decode(data);
  } catch {
    return undefined;
  }
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
  files: Array<{
    path: string;
    exists: boolean;
    type?: "file" | "directory" | "symlink" | "other";
    kind?: "text" | "binary";
    size?: number;
    sha256?: string;
    modifiedAt?: string;
    createdAt?: string;
  }>;
}> {
  const paths = Array.isArray(args.paths) ? args.paths : [args.path];
  if (paths.length === 0) throw new BadRequestError("path or paths must be provided");
  const files = [];
  for (const item of paths) {
    files.push(await statOnePath(item, context));
  }
  return { status: "ok", files };
}

async function statOnePath(
  rawPath: unknown,
  context: InspectWorkspaceContext,
): Promise<{
  path: string;
  exists: boolean;
  type?: "file" | "directory" | "symlink" | "other";
  kind?: "text" | "binary";
  size?: number;
  sha256?: string;
  modifiedAt?: string;
  createdAt?: string;
}> {
  const resolved = normalizeWorkspacePath(rawPath, context, { allowRoot: true });
  const stat = await safeLstat(resolved.absolutePath);
  if (!stat) return { path: resolved.relativePath, exists: false };
  const type = stat.isDirectory()
    ? "directory"
    : stat.isFile()
      ? "file"
      : stat.isSymbolicLink()
        ? "symlink"
        : "other";
  const data = stat.isFile() ? await readFile(resolved.absolutePath) : undefined;
  return {
    path: resolved.relativePath,
    exists: true,
    type,
    size: stat.size,
    ...(data ? { sha256: sha256Buffer(data), kind: decodeText(data) === undefined ? "binary" : "text" } : {}),
    modifiedAt: stat.mtime.toISOString(),
    createdAt: stat.birthtime.toISOString(),
  };
}

function sha256Buffer(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
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
