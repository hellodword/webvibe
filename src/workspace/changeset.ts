import { ManualArtifactStore } from "../manual/artifact-store.js";
import { PreparedManualActionStore } from "../manual/prepared-store.js";
import type { ManualArtifactRef, ManualCheck } from "../manual/types.js";
import type { AuditLog } from "../state/audit.js";
import { randomToken, sha256 } from "../util/hash.js";
import { applyPlan } from "./changeset/apply.js";
import { buildChangesetPlan } from "./changeset/plan.js";
import { fileManifest } from "./changeset/manifest.js";
import type {
  ChangesetSummary,
  Conflict,
  PlannedAction,
  PlannedFile,
  WorkspaceContext,
} from "./changeset/types.js";

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

export async function prepareChangeset(
  rawArgs: unknown,
  context: WorkspaceContext & {
    stateDir: string;
    publicBaseUrl: string;
    audit?: AuditLog;
  },
): Promise<{
  status: "prepared" | "conflicted";
  valid: boolean;
  preparedId?: string;
  operationId?: string;
  baseRevision?: string;
  summary: ChangesetSummary;
  files: PlannedFile[];
  diff: string;
  conflicts: Conflict[];
  manualGate: null | {
    preparedId: string;
    reason: "manual_review_requested";
    artifacts: ManualArtifactRef[];
    checks: ManualCheck[];
    expiresAt: string;
    nextTool: "manual.gate";
  };
}> {
  const plan = await buildChangesetPlan(rawArgs, context);
  if (plan.conflicts.length > 0) {
    return {
      status: "conflicted",
      valid: false,
      baseRevision: plan.baseRevision,
      summary: plan.summary,
      files: plan.files,
      diff: plan.diff,
      conflicts: plan.conflicts,
      manualGate: null,
    };
  }

  const operationId = randomToken(18);
  const title = "Prepared workspace change";
  const instructions =
    "If ChatGPT Web cannot complete the write action, show the user the prepared workspace change details in ChatGPT Web before opening manual.gate. " +
    "If the diff is at most 12KB and 200 lines, show it in a code block; otherwise link the downloadable review artifact from change.prepare. " +
    "The user should complete the prepared workspace change manually outside ChatGPT, write any command output or logs to a workspace-relative path such as " +
    `.webvibe/manual-logs/${operationId}.log, then reply in the next ChatGPT message with /resume followed by that optional log file path.`;
  const artifactStore = new ManualArtifactStore(context.stateDir);
  const artifact = await artifactStore.create({
    label: "Workspace change review material",
    filename: "workspace-change-preview.diff",
    mimeType: "text/x-diff",
    content: plan.diff || "Review material for manual completion.\nNo textual diff was generated.\n",
    createdByTool: "change.prepare",
    operationId,
    publicBaseUrl: context.publicBaseUrl,
  });
  const checks = manualChecksForActions(plan.actions);
  const prepared = await new PreparedManualActionStore(context.stateDir).create({
    operationId,
    createdByTool: "change.prepare",
    title,
    instructions,
    artifacts: [artifact.ref],
    checks,
    debugPayload: {
      baseRevision: plan.baseRevision,
      summary: plan.summary,
      files: plan.files,
      diff: plan.diff,
    },
  });

  await context.audit?.write({
    timestamp: new Date().toISOString(),
    event: "manual.prepared.created",
    operationId,
    preparedId: prepared.preparedId,
    tool: "change.prepare",
    type: "builtIn",
    status: "ok",
    durationMs: 0,
    inputHash: sha256(rawArgs),
    input: rawArgs,
    rawOutput: {
      summary: plan.summary,
      files: plan.files,
      diff: plan.diff,
      artifact: artifact.record,
      checks,
    },
    rawOutputHash: sha256({ diff: plan.diff, files: plan.files }),
  });

  return {
    status: "prepared",
    valid: true,
    preparedId: prepared.preparedId,
    operationId,
    baseRevision: plan.baseRevision,
    summary: plan.summary,
    files: plan.files,
    diff: plan.diff,
    conflicts: [],
    manualGate: {
      preparedId: prepared.preparedId,
      reason: "manual_review_requested",
      artifacts: prepared.artifacts,
      checks: prepared.checks,
      expiresAt: prepared.expiresAt,
      nextTool: "manual.gate",
    },
  };
}

function manualChecksForActions(actions: PlannedAction[]): ManualCheck[] {
  return actions.map((action) => {
    if (action.op === "delete") {
      return { kind: "workspace-path-state", path: action.path, expected: { exists: false } };
    }
    if (action.op === "mkdir") {
      return {
        kind: "workspace-path-state",
        path: action.path,
        expected: { exists: true, type: "directory" },
      };
    }
    return {
      kind: "workspace-path-state",
      path: action.path,
      expected: { exists: true, type: "file", sha256: action.afterSha256 },
    };
  });
}
