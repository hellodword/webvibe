import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { lstat, mkdir, readFile, rm, unlink } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";

import { minimatch } from "minimatch";
import { z } from "zod";

import type { LimitsPolicy, WorkspacePolicy } from "../policy/policy.js";
import { BadRequestError, ForbiddenError } from "../util/errors.js";
import { isInside, toWorkspaceRelative, writeFileAtomic } from "../util/paths.js";

const DEFAULT_MAX_CHANGESET_FILES = 80;
const DEFAULT_MAX_CHANGESET_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_CHANGESET_FILE_BYTES = 1024 * 1024;

const sha256Pattern = /^[a-f0-9]{64}$/;

const manifestInputSchema = z
  .object({
    paths: z.array(z.string()).min(1),
  })
  .strict();

const editSchema = z
  .object({
    oldText: z.string().min(1),
    newText: z.string(),
    replaceAll: z.boolean().optional(),
  })
  .strict();

const changeSchema = z.discriminatedUnion("op", [
  z
    .object({
      op: z.literal("create"),
      path: z.string().min(1),
      content: z.string(),
    })
    .strict(),
  z
    .object({
      op: z.literal("replace"),
      path: z.string().min(1),
      expectedSha256: z.string().regex(sha256Pattern),
      content: z.string(),
    })
    .strict(),
  z
    .object({
      op: z.literal("edit"),
      path: z.string().min(1),
      expectedSha256: z.string().regex(sha256Pattern),
      edits: z.array(editSchema).min(1),
    })
    .strict(),
  z
    .object({
      op: z.literal("delete"),
      path: z.string().min(1),
      expectedSha256: z.string().regex(sha256Pattern),
    })
    .strict(),
  z
    .object({
      op: z.literal("mkdir"),
      path: z.string().min(1),
    })
    .strict(),
]);

const changesetInputSchema = z
  .object({
    baseRevision: z.string().min(1).optional(),
    changes: z.array(changeSchema).min(1),
  })
  .strict();

type ParsedChange = z.infer<typeof changeSchema>;
type ParsedChangeset = z.infer<typeof changesetInputSchema>;

type WorkspaceContext = {
  workspaceRoot: string;
  workspace: WorkspacePolicy;
  limits: LimitsPolicy;
};

type EffectiveLimits = {
  maxChangesetFiles: number;
  maxChangesetBytes: number;
  maxChangesetFileBytes: number;
};

type ResolvedWorkspacePath = {
  inputPath: string;
  relativePath: string;
  absolutePath: string;
};

type FileState = {
  content: string;
  sha256: string;
  sizeBytes: number;
  mode: number;
  mtimeMs: number;
};

type PlannedAction = {
  op: ParsedChange["op"];
  path: string;
  absolutePath: string;
  before?: FileState;
  afterContent?: string;
  afterSha256?: string;
  diff?: string;
};

type Conflict = {
  path: string;
  reason: string;
  expectedSha256?: string;
  actualSha256?: string;
};

type ChangesetPlan = {
  baseRevision?: string;
  summary: ChangesetSummary;
  files: PlannedFile[];
  diff: string;
  conflicts: Conflict[];
  actions: PlannedAction[];
};

type ChangesetSummary = {
  total: number;
  creates: number;
  edits: number;
  replaces: number;
  deletes: number;
  mkdirs: number;
};

type PlannedFile = {
  path: string;
  op: ParsedChange["op"];
  beforeSha256?: string;
  afterSha256?: string;
  sizeBytes?: number;
};

type Snapshot =
  | {
      kind: "missing";
      absolutePath: string;
      cleanup: "file" | "directory";
    }
  | {
      kind: "file";
      absolutePath: string;
      content: string;
      mode: number;
    }
  | {
      kind: "directory";
      absolutePath: string;
    };

export async function fileManifest(
  rawArgs: unknown,
  context: WorkspaceContext,
): Promise<{
  files: Array<{
    path: string;
    exists: boolean;
    type: "file" | "directory" | "symlink" | "other" | "missing";
    sizeBytes?: number;
    sha256?: string;
    mtimeMs?: number;
  }>;
}> {
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
  return { files };
}

export async function previewChangeset(
  rawArgs: unknown,
  context: WorkspaceContext,
): Promise<{
  valid: boolean;
  baseRevision?: string;
  summary: ChangesetSummary;
  files: PlannedFile[];
  diff: string;
  conflicts: Conflict[];
}> {
  const plan = await buildChangesetPlan(rawArgs, context);
  return {
    valid: plan.conflicts.length === 0,
    baseRevision: plan.baseRevision,
    summary: plan.summary,
    files: plan.files,
    diff: plan.diff,
    conflicts: plan.conflicts,
  };
}

export async function applyChangeset(
  rawArgs: unknown,
  context: WorkspaceContext,
): Promise<{
  applied: boolean;
  baseRevision?: string;
  summary: ChangesetSummary;
  files: PlannedFile[];
  conflicts: Conflict[];
}> {
  const plan = await buildChangesetPlan(rawArgs, context);
  if (plan.conflicts.length > 0) {
    return {
      applied: false,
      baseRevision: plan.baseRevision,
      summary: plan.summary,
      files: plan.files,
      conflicts: plan.conflicts,
    };
  }

  const snapshots = await Promise.all(plan.actions.map((action) => snapshotPath(action)));
  try {
    for (const action of plan.actions) {
      await applyAction(action);
    }
  } catch (error) {
    await rollback(snapshots);
    throw error;
  }

  return {
    applied: true,
    baseRevision: plan.baseRevision,
    summary: plan.summary,
    files: plan.files,
    conflicts: [],
  };
}

async function buildChangesetPlan(
  rawArgs: unknown,
  context: WorkspaceContext,
): Promise<ChangesetPlan> {
  const input = parseInput(changesetInputSchema, rawArgs);
  const limits = effectiveLimits(context.limits);
  assertChangesetLimits(input, limits);

  const seenPaths = new Set<string>();
  const conflicts: Conflict[] = [];
  const actions: PlannedAction[] = [];
  let totalWriteBytes = 0;

  for (const change of input.changes) {
    const resolved = await resolveWorkspacePath(change.path, context);
    if (seenPaths.has(resolved.relativePath)) {
      throw new BadRequestError(`Duplicate changeset path: ${resolved.relativePath}`);
    }
    seenPaths.add(resolved.relativePath);
    const action = await planAction(change, resolved, limits, conflicts);
    if (action) {
      if (action.afterContent !== undefined) {
        totalWriteBytes += Buffer.byteLength(action.afterContent, "utf8");
      }
      actions.push(action);
    }
  }

  if (totalWriteBytes > limits.maxChangesetBytes) {
    throw new BadRequestError(
      `Changeset writes ${totalWriteBytes} bytes; maximum is ${limits.maxChangesetBytes}`,
    );
  }

  const files = actions.map((action) => plannedFile(action));
  return {
    baseRevision: input.baseRevision,
    summary: summarize(input.changes),
    files,
    diff: actions
      .map((action) => action.diff)
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .join("\n"),
    conflicts,
    actions,
  };
}

async function planAction(
  change: ParsedChange,
  resolved: ResolvedWorkspacePath,
  limits: EffectiveLimits,
  conflicts: Conflict[],
): Promise<PlannedAction | undefined> {
  const info = await safeLstat(resolved.absolutePath);
  if (info?.isSymbolicLink()) {
    throw new ForbiddenError(`Path is a symlink: ${resolved.relativePath}`);
  }

  if (change.op === "mkdir") {
    if (!info) {
      return { op: change.op, path: resolved.relativePath, absolutePath: resolved.absolutePath };
    }
    if (info.isDirectory()) return undefined;
    conflicts.push({ path: resolved.relativePath, reason: "Path exists and is not a directory" });
    return undefined;
  }

  if (change.op === "create") {
    assertContent(change.content, resolved.relativePath, limits);
    if (info) {
      conflicts.push({ path: resolved.relativePath, reason: "Path already exists" });
      return undefined;
    }
    const afterSha256 = sha256Text(change.content);
    return {
      op: change.op,
      path: resolved.relativePath,
      absolutePath: resolved.absolutePath,
      afterContent: change.content,
      afterSha256,
      diff: unifiedDiff(resolved.relativePath, undefined, change.content),
    };
  }

  if (!info) {
    conflicts.push({ path: resolved.relativePath, reason: "Path does not exist" });
    return undefined;
  }
  if (!info.isFile()) {
    conflicts.push({ path: resolved.relativePath, reason: "Path is not a file" });
    return undefined;
  }

  const before = await readTextFileState(resolved.absolutePath, resolved.relativePath, limits);
  if (before.sha256 !== change.expectedSha256) {
    conflicts.push({
      path: resolved.relativePath,
      reason: "File hash mismatch",
      expectedSha256: change.expectedSha256,
      actualSha256: before.sha256,
    });
    return undefined;
  }

  if (change.op === "delete") {
    return {
      op: change.op,
      path: resolved.relativePath,
      absolutePath: resolved.absolutePath,
      before,
      diff: unifiedDiff(resolved.relativePath, before.content, undefined),
    };
  }

  const afterContent =
    change.op === "replace"
      ? change.content
      : applyTextEdits(before.content, change.edits, resolved.relativePath, conflicts);
  if (afterContent === undefined) return undefined;
  assertContent(afterContent, resolved.relativePath, limits);
  const afterSha256 = sha256Text(afterContent);
  return {
    op: change.op,
    path: resolved.relativePath,
    absolutePath: resolved.absolutePath,
    before,
    afterContent,
    afterSha256,
    diff: unifiedDiff(resolved.relativePath, before.content, afterContent),
  };
}

async function applyAction(action: PlannedAction): Promise<void> {
  if (action.op === "mkdir") {
    await mkdir(action.absolutePath, { recursive: true });
    return;
  }
  if (action.op === "delete") {
    await unlink(action.absolutePath);
    return;
  }
  const mode = action.before ? action.before.mode & 0o777 : 0o666;
  await writeFileAtomic(action.absolutePath, action.afterContent ?? "", mode);
}

async function snapshotPath(action: PlannedAction): Promise<Snapshot> {
  const info = await safeLstat(action.absolutePath);
  if (!info) {
    return {
      kind: "missing",
      absolutePath: action.absolutePath,
      cleanup: action.op === "mkdir" ? "directory" : "file",
    };
  }
  if (info.isDirectory()) return { kind: "directory", absolutePath: action.absolutePath };
  if (!info.isFile()) {
    return { kind: "missing", absolutePath: action.absolutePath, cleanup: "file" };
  }
  const data = await readFile(action.absolutePath);
  return {
    kind: "file",
    absolutePath: action.absolutePath,
    content: decodeUtf8(data, action.path),
    mode: info.mode & 0o777,
  };
}

async function rollback(snapshots: Snapshot[]): Promise<void> {
  const errors: string[] = [];
  for (const snapshot of snapshots.slice().reverse()) {
    try {
      if (snapshot.kind === "missing") {
        await rm(snapshot.absolutePath, {
          force: true,
          recursive: snapshot.cleanup === "directory",
        });
      } else if (snapshot.kind === "directory") {
        await mkdir(snapshot.absolutePath, { recursive: true });
      } else {
        await writeFileAtomic(snapshot.absolutePath, snapshot.content, snapshot.mode);
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (errors.length > 0) {
    throw new Error(`Changeset rollback failed: ${errors.join("; ")}`);
  }
}

async function manifestEntry(
  resolved: ResolvedWorkspacePath,
  maxFileBytes: number,
): Promise<{
  path: string;
  exists: boolean;
  type: "file" | "directory" | "symlink" | "other" | "missing";
  sizeBytes?: number;
  sha256?: string;
  mtimeMs?: number;
}> {
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

async function readTextFileState(
  absolutePath: string,
  relativePath: string,
  limits: EffectiveLimits,
): Promise<FileState> {
  const info = await lstat(absolutePath);
  if (info.size > limits.maxChangesetFileBytes) {
    throw new BadRequestError(
      `File is ${info.size} bytes; maximum is ${limits.maxChangesetFileBytes}: ${relativePath}`,
    );
  }
  const data = await readFile(absolutePath);
  const content = decodeUtf8(data, relativePath);
  return {
    content,
    sha256: sha256Buffer(data),
    sizeBytes: data.byteLength,
    mode: info.mode,
    mtimeMs: info.mtimeMs,
  };
}

async function resolveWorkspacePath(
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
  return { inputPath: rawPath, relativePath, absolutePath };
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

function assertChangesetLimits(input: ParsedChangeset, limits: EffectiveLimits): void {
  if (input.changes.length > limits.maxChangesetFiles) {
    throw new BadRequestError(`Too many changes; maximum is ${limits.maxChangesetFiles}`);
  }
  const inputBytes = Buffer.byteLength(JSON.stringify(input), "utf8");
  if (inputBytes > limits.maxChangesetBytes) {
    throw new BadRequestError(
      `Changeset input is ${inputBytes} bytes; maximum is ${limits.maxChangesetBytes}`,
    );
  }
}

function assertContent(content: string, relativePath: string, limits: EffectiveLimits): void {
  if (content.includes("\0")) {
    throw new BadRequestError(`Content contains a NUL byte: ${relativePath}`);
  }
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > limits.maxChangesetFileBytes) {
    throw new BadRequestError(
      `Content is ${bytes} bytes; maximum is ${limits.maxChangesetFileBytes}: ${relativePath}`,
    );
  }
}

function applyTextEdits(
  content: string,
  edits: Array<{ oldText: string; newText: string; replaceAll?: boolean }>,
  relativePath: string,
  conflicts: Conflict[],
): string | undefined {
  let current = content;
  for (const edit of edits) {
    const count = countOccurrences(current, edit.oldText);
    if (count === 0) {
      conflicts.push({ path: relativePath, reason: "Edit text not found" });
      return undefined;
    }
    if (edit.replaceAll !== true && count !== 1) {
      conflicts.push({ path: relativePath, reason: "Edit text matched more than once" });
      return undefined;
    }
    current =
      edit.replaceAll === true
        ? current.split(edit.oldText).join(edit.newText)
        : current.replace(edit.oldText, edit.newText);
  }
  return current;
}

function countOccurrences(text: string, needle: string): number {
  let count = 0;
  let index = 0;
  while (index <= text.length) {
    const found = text.indexOf(needle, index);
    if (found === -1) return count;
    count += 1;
    index = found + needle.length;
  }
  return count;
}

function plannedFile(action: PlannedAction): PlannedFile {
  return {
    path: action.path,
    op: action.op,
    beforeSha256: action.before?.sha256,
    afterSha256: action.afterSha256,
    sizeBytes:
      action.afterContent === undefined ? undefined : Buffer.byteLength(action.afterContent, "utf8"),
  };
}

function summarize(changes: ParsedChange[]): ChangesetSummary {
  return {
    total: changes.length,
    creates: changes.filter((change) => change.op === "create").length,
    edits: changes.filter((change) => change.op === "edit").length,
    replaces: changes.filter((change) => change.op === "replace").length,
    deletes: changes.filter((change) => change.op === "delete").length,
    mkdirs: changes.filter((change) => change.op === "mkdir").length,
  };
}

function unifiedDiff(relativePath: string, before: string | undefined, after: string | undefined): string {
  const beforeLines = before === undefined ? [] : splitLines(before);
  const afterLines = after === undefined ? [] : splitLines(after);
  return [
    `--- ${before === undefined ? "/dev/null" : `a/${relativePath}`}`,
    `+++ ${after === undefined ? "/dev/null" : `b/${relativePath}`}`,
    "@@",
    ...beforeLines.map((line) => `-${line}`),
    ...afterLines.map((line) => `+${line}`),
  ].join("\n");
}

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  return text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
}

function decodeUtf8(data: Buffer, relativePath: string): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    throw new BadRequestError(`File is not valid UTF-8: ${relativePath}`);
  }
  if (text.includes("\0")) {
    throw new BadRequestError(`File appears to be binary: ${relativePath}`);
  }
  return text;
}

function sha256Text(text: string): string {
  return sha256Buffer(Buffer.from(text, "utf8"));
}

function sha256Buffer(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

async function safeLstat(filePath: string): Promise<Stats | undefined> {
  try {
    return await lstat(filePath);
  } catch (error: any) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

function effectiveLimits(limits: LimitsPolicy): EffectiveLimits {
  return {
    maxChangesetFiles: limits.maxChangesetFiles ?? DEFAULT_MAX_CHANGESET_FILES,
    maxChangesetBytes: limits.maxChangesetBytes ?? DEFAULT_MAX_CHANGESET_BYTES,
    maxChangesetFileBytes:
      limits.maxChangesetFileBytes ?? DEFAULT_MAX_CHANGESET_FILE_BYTES,
  };
}

function parseInput<T>(schema: z.ZodType<T>, rawArgs: unknown): T {
  const parsed = schema.safeParse(rawArgs);
  if (parsed.success) return parsed.data;
  const message = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
    .join("; ");
  throw new BadRequestError(message);
}
