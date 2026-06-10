import { mkdir, readFile, rename, rm, unlink } from "node:fs/promises";
import path from "node:path";

import { writeFileAtomic } from "../../util/paths.js";
import { safeLstat } from "./path-guard.js";
import { decodeUtf8 } from "./text.js";
import type { ChangesetPlan, PlannedAction, Snapshot } from "./types.js";

export class ChangesetRollbackError extends Error {
  readonly code = "CHANGE_ROLLBACK_FAILED";
  readonly rollbackErrors: string[];
  readonly applyError: string;

  constructor(applyError: unknown, rollbackErrors: string[]) {
    const applyMessage = errorMessage(applyError);
    super(
      `Changeset apply failed and rollback had ${rollbackErrors.length} error(s): ${rollbackErrors.join("; ")}; original error: ${applyMessage}`,
      { cause: applyError },
    );
    this.name = "ChangesetRollbackError";
    this.rollbackErrors = rollbackErrors;
    this.applyError = applyMessage;
  }
}

export async function applyPlan(plan: ChangesetPlan): Promise<void> {
  const snapshots = (await Promise.all(plan.actions.map((action) => snapshotPaths(action)))).flat();
  try {
    for (const action of plan.actions) {
      await applyAction(action);
    }
  } catch (error) {
    const rollbackErrors = await rollback(snapshots);
    if (rollbackErrors.length > 0) {
      throw new ChangesetRollbackError(error, rollbackErrors);
    }
    throw error;
  }
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
  if (action.op === "rename") {
    if (!action.toAbsolutePath) throw new Error("Rename target is missing");
    await mkdir(path.dirname(action.toAbsolutePath), { recursive: true });
    await rename(action.absolutePath, action.toAbsolutePath);
    return;
  }
  const mode = action.before ? action.before.mode & 0o777 : 0o666;
  await writeFileAtomic(action.absolutePath, action.afterContent ?? "", mode);
}

async function snapshotPaths(action: PlannedAction): Promise<Snapshot[]> {
  if (action.op === "rename" && action.toAbsolutePath && action.toPath) {
    return [
      await snapshotOnePath(action.absolutePath, action.path, "file"),
      await snapshotOnePath(action.toAbsolutePath, action.toPath, "file"),
    ];
  }
  return [await snapshotOnePath(action.absolutePath, action.path, action.op === "mkdir" ? "directory" : "file")];
}

async function snapshotOnePath(
  absolutePath: string,
  relativePath: string,
  cleanup: "file" | "directory",
): Promise<Snapshot> {
  const info = await safeLstat(absolutePath);
  if (!info) {
    return {
      kind: "missing",
      absolutePath,
      cleanup,
    };
  }
  if (info.isDirectory()) return { kind: "directory", absolutePath };
  if (!info.isFile()) {
    return { kind: "missing", absolutePath, cleanup: "file" };
  }
  const data = await readFile(absolutePath);
  return {
    kind: "file",
    absolutePath,
    content: decodeUtf8(data, relativePath),
    mode: info.mode & 0o777,
  };
}

async function rollback(snapshots: Snapshot[]): Promise<string[]> {
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
  return errors;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
