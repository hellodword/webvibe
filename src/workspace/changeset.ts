import { applyPlan } from "./changeset/apply.js";
import { buildChangesetPlan } from "./changeset/plan.js";
import { fileManifest } from "./changeset/manifest.js";
import type { ChangesetSummary, Conflict, PlannedFile, WorkspaceContext } from "./changeset/types.js";

export { fileManifest };

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

  await applyPlan(plan);
  return {
    applied: true,
    baseRevision: plan.baseRevision,
    summary: plan.summary,
    files: plan.files,
    conflicts: [],
  };
}
