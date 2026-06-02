import { mkdir, readFile, rm, unlink } from "node:fs/promises";

import { writeFileAtomic } from "../../util/paths.js";
import { safeLstat } from "./path-guard.js";
import { decodeUtf8 } from "./text.js";
import type { ChangesetPlan, PlannedAction, Snapshot } from "./types.js";

export async function applyPlan(plan: ChangesetPlan): Promise<void> {
  const snapshots = await Promise.all(plan.actions.map((action) => snapshotPath(action)));
  try {
    for (const action of plan.actions) {
      await applyAction(action);
    }
  } catch (error) {
    await rollback(snapshots);
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
