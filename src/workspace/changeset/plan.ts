import { ForbiddenError, BadRequestError } from "../../util/errors.js";
import { unifiedDiff } from "./diff.js";
import { applyTextEdits } from "./edits.js";
import { assertChangesetLimits, assertContent, effectiveLimits } from "./limits.js";
import { resolveWorkspacePath, safeLstat } from "./path-guard.js";
import { changesetInputSchema, parseInput, type ParsedChange } from "./schema.js";
import { readTextFileState, sha256Text } from "./text.js";
import type {
  ChangesetPlan,
  ChangesetSummary,
  Conflict,
  EffectiveLimits,
  PlannedAction,
  PlannedFile,
  ResolvedWorkspacePath,
  WorkspaceContext,
} from "./types.js";

export async function buildChangesetPlan(
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
    if (!action) continue;
    if (action.afterContent !== undefined) {
      totalWriteBytes += Buffer.byteLength(action.afterContent, "utf8");
    }
    actions.push(action);
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

  if (change.op === "create" || change.op === "write") {
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

  if (change.op === "json_patch") {
    const afterContent = applyJsonPatch(before.content, change.patch, resolved.relativePath);
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
    creates: changes.filter((change) => change.op === "create" || change.op === "write").length,
    edits: changes.filter((change) => change.op === "edit" || change.op === "text_edit" || change.op === "json_patch").length,
    replaces: changes.filter((change) => change.op === "replace").length,
    deletes: changes.filter((change) => change.op === "delete").length,
    mkdirs: changes.filter((change) => change.op === "mkdir").length,
  };
}

function applyJsonPatch(
  content: string,
  patch: Array<{ op: "add" | "replace" | "remove"; path: string; value?: unknown }>,
  relativePath: string,
): string {
  let document: unknown;
  try {
    document = JSON.parse(content);
  } catch {
    throw new BadRequestError(`File is not valid JSON: ${relativePath}`);
  }
  for (const operation of patch) {
    applyJsonOperation(document, operation, relativePath);
  }
  return `${JSON.stringify(document, null, 2)}\n`;
}

function applyJsonOperation(
  document: unknown,
  operation: { op: "add" | "replace" | "remove"; path: string; value?: unknown },
  relativePath: string,
): void {
  const tokens = jsonPointerTokens(operation.path, relativePath);
  if (tokens.length === 0) {
    throw new BadRequestError(`JSON patch root replacement is not supported: ${relativePath}`);
  }
  const parent = jsonPointerParent(document, tokens.slice(0, -1), relativePath);
  const key = tokens[tokens.length - 1];
  if (Array.isArray(parent)) {
    applyJsonArrayOperation(parent, key, operation, relativePath);
    return;
  }
  if (!isJsonObject(parent)) {
    throw new BadRequestError(`JSON patch parent is not an object: ${operation.path}`);
  }
  if (operation.op !== "add" && !(key in parent)) {
    throw new BadRequestError(`JSON patch path does not exist: ${operation.path}`);
  }
  if (operation.op === "remove") {
    delete parent[key];
    return;
  }
  parent[key] = operation.value;
}

function applyJsonArrayOperation(
  parent: unknown[],
  key: string,
  operation: { op: "add" | "replace" | "remove"; path: string; value?: unknown },
  _relativePath: string,
): void {
  const index = key === "-" ? parent.length : Number(key);
  if (!Number.isInteger(index) || index < 0 || index > parent.length) {
    throw new BadRequestError(`JSON patch array index is invalid: ${operation.path}`);
  }
  if (operation.op === "add") {
    parent.splice(index, 0, operation.value);
    return;
  }
  if (index >= parent.length) {
    throw new BadRequestError(`JSON patch path does not exist: ${operation.path}`);
  }
  if (operation.op === "remove") {
    parent.splice(index, 1);
    return;
  }
  parent[index] = operation.value;
}

function jsonPointerParent(document: unknown, tokens: string[], relativePath: string): unknown {
  let current = document;
  for (const token of tokens) {
    if (Array.isArray(current)) {
      const index = Number(token);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        throw new BadRequestError(`JSON patch path does not exist: ${relativePath}`);
      }
      current = current[index];
      continue;
    }
    if (!isJsonObject(current) || !(token in current)) {
      throw new BadRequestError(`JSON patch path does not exist: ${relativePath}`);
    }
    current = current[token];
  }
  return current;
}

function jsonPointerTokens(pointer: string, relativePath: string): string[] {
  if (!pointer.startsWith("/")) throw new BadRequestError(`JSON patch path must start with /: ${relativePath}`);
  return pointer
    .slice(1)
    .split("/")
    .map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
