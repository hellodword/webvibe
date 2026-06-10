import { ManualArtifactStore } from "../manual/artifact-store.js";
import { PreparedManualActionStore } from "../manual/prepared-store.js";
import type { ManualArtifactRef, ManualCheck } from "../manual/types.js";
import type { AuditLog } from "../state/audit.js";
import { BadRequestError } from "../util/errors.js";
import { randomToken, sha256 } from "../util/hash.js";
import { applyPlan } from "./changeset/apply.js";
import { buildChangesetPlan } from "./changeset/plan.js";
import { parseInput, changesetInputSchema } from "./changeset/schema.js";
import { fileManifest } from "./changeset/manifest.js";
import type {
  ChangesetSummary,
  Conflict,
  ManifestEntry,
  PlannedAction,
  PlannedFile,
  WorkspaceContext,
} from "./changeset/types.js";

type ManifestBase = {
  path: string;
  exists: boolean;
  type?: ManifestEntry["type"];
  sha256?: string;
  sizeBytes?: number;
};

type FileVerification = {
  path: string;
  op: PlannedAction["op"];
  expected: ManifestBase;
  actual: ManifestEntry;
  ok: boolean;
};

type ApplyVerification = {
  status: "skipped" | "passed" | "failed";
  manifestHash: string;
  files: FileVerification[];
};

type VerificationExpectation = {
  path: string;
  op: PlannedAction["op"];
  expected: ManifestBase;
};

export { fileManifest };

export async function previewChangeset(
  rawArgs: unknown,
  context: WorkspaceContext,
): Promise<{
  valid: boolean;
  status: "ok" | "conflicted";
  previewId: string;
  baseRevision?: string;
  base: { manifestHash: string };
  summary: ChangesetSummary;
  files: PlannedFile[];
  diff: string;
  conflicts: Conflict[];
  previewHash: string;
  changeHash: string;
}> {
  const plan = await buildChangesetPlan(rawArgs, context);
  const hashes = previewHashes(rawArgs, plan);
  return {
    valid: plan.conflicts.length === 0,
    status: plan.conflicts.length === 0 ? "ok" : "conflicted",
    previewId: `cp_${randomToken(12)}`,
    baseRevision: plan.baseRevision,
    base: { manifestHash: baseManifestHash(plan) },
    summary: plan.summary,
    files: plan.files,
    diff: plan.diff,
    conflicts: plan.conflicts,
    ...hashes,
  };
}

export async function applyChangeset(
  rawArgs: unknown,
  context: WorkspaceContext,
): Promise<{
  applied: boolean;
  verified: boolean;
  verification: ApplyVerification;
  baseRevision?: string;
  base: { manifestHash: string };
  summary: ChangesetSummary;
  files: PlannedFile[];
  conflicts: Conflict[];
  previewHash?: string;
}> {
  const input = parseInput(changesetInputSchema, rawArgs);
  if (!input.previewHash) {
    throw new BadRequestError("previewHash is required");
  }
  const plan = await buildChangesetPlan(rawArgs, context);
  const hashes = previewHashes(rawArgs, plan);
  if (input.previewHash !== hashes.previewHash) {
    throw new BadRequestError("previewHash mismatch");
  }
  if (plan.conflicts.length > 0) {
    return {
      applied: false,
      verified: false,
      verification: skippedVerification(plan),
      baseRevision: plan.baseRevision,
      base: { manifestHash: baseManifestHash(plan) },
      summary: plan.summary,
      files: plan.files,
      conflicts: plan.conflicts,
      previewHash: hashes.previewHash,
    };
  }

  await applyPlan(plan);
  const verification = await verifyApplied(plan, context);
  return {
    applied: true,
    verified: verification.status === "passed",
    verification,
    baseRevision: plan.baseRevision,
    base: { manifestHash: baseManifestHash(plan) },
    summary: plan.summary,
    files: plan.files,
    conflicts: [],
    previewHash: hashes.previewHash,
  };
}

async function verifyApplied(
  plan: { actions: PlannedAction[] },
  context: WorkspaceContext,
): Promise<ApplyVerification> {
  const expected = verificationExpectations(plan);
  const paths = Array.from(new Set(expected.map((item) => item.path)));
  if (paths.length === 0) {
    return { status: "passed", manifestHash: manifestHash([]), files: [] };
  }
  const manifest = await fileManifest({ paths }, context);
  const actualByPath = new Map(manifest.files.map((entry) => [entry.path, entry]));
  const files = expected.map((item) => {
    const actual = actualByPath.get(item.path) ?? {
      path: item.path,
      exists: false,
      type: "missing" as const,
    };
    return {
      path: item.path,
      op: item.op,
      expected: item.expected,
      actual,
      ok: manifestMatches(actual, item.expected),
    };
  });
  return {
    status: files.every((file) => file.ok) ? "passed" : "failed",
    manifestHash: manifestHash(manifest.files),
    files,
  };
}

function skippedVerification(plan: { actions: PlannedAction[] }): ApplyVerification {
  return {
    status: "skipped",
    manifestHash: baseManifestHash(plan),
    files: [],
  };
}

function baseManifestHash(plan: { actions: PlannedAction[] }): string {
  return manifestHash(baseManifestEntries(plan));
}

function baseManifestEntries(plan: { actions: PlannedAction[] }): ManifestBase[] {
  return plan.actions.flatMap((action) => {
    if (action.op === "rename") {
      return [
        {
          path: action.path,
          exists: true,
          type: "file" as const,
          sha256: action.before?.sha256,
          sizeBytes: action.before?.sizeBytes,
        },
        { path: action.toPath ?? action.path, exists: false, type: "missing" as const },
      ];
    }
    if (action.op === "create" || action.op === "write" || action.op === "mkdir") {
      return [{ path: action.path, exists: false, type: "missing" as const }];
    }
    return [
      {
        path: action.path,
        exists: true,
        type: "file" as const,
        sha256: action.before?.sha256,
        sizeBytes: action.before?.sizeBytes,
      },
    ];
  });
}

function verificationExpectations(plan: { actions: PlannedAction[] }): VerificationExpectation[] {
  return plan.actions.flatMap<VerificationExpectation>((action) => {
    if (action.op === "mkdir") {
      return [
        {
          path: action.path,
          op: action.op,
          expected: { path: action.path, exists: true, type: "directory" as const },
        },
      ];
    }
    if (action.op === "delete") {
      return [
        {
          path: action.path,
          op: action.op,
          expected: { path: action.path, exists: false, type: "missing" as const },
        },
      ];
    }
    if (action.op === "rename") {
      const target = action.toPath ?? action.path;
      return [
        {
          path: action.path,
          op: action.op,
          expected: { path: action.path, exists: false, type: "missing" as const },
        },
        {
          path: target,
          op: action.op,
          expected: {
            path: target,
            exists: true,
            type: "file" as const,
            sha256: action.afterSha256,
          },
        },
      ];
    }
    return [
      {
        path: action.path,
        op: action.op,
        expected: {
          path: action.path,
          exists: true,
          type: "file" as const,
          sha256: action.afterSha256,
        },
      },
    ];
  });
}

function manifestMatches(actual: ManifestEntry, expected: ManifestBase): boolean {
  if (actual.exists !== expected.exists) return false;
  if (!expected.exists) return actual.type === "missing";
  if (expected.type && actual.type !== expected.type) return false;
  if (expected.sha256 && actual.sha256 !== expected.sha256) return false;
  return true;
}

function manifestHash(entries: ManifestBase[]): string {
  return `sha256:${sha256(
    entries.map((entry) => ({
      path: entry.path,
      exists: entry.exists,
      type: entry.type,
      sha256: entry.sha256,
      sizeBytes: entry.sizeBytes,
    })),
  )}`;
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
    "If ChatGPT Web cannot complete the write action after the required identical safety-block retry, show the user the prepared workspace change details in ChatGPT Web before opening manual.gate. " +
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

function previewHashes(rawArgs: unknown, plan: {
  baseRevision?: string;
  summary: ChangesetSummary;
  files: PlannedFile[];
  diff: string;
  conflicts: Conflict[];
}): { previewHash: string; changeHash: string } {
  const input = parseInput(changesetInputSchema, rawArgs);
  const material = {
    baseRevision: input.baseRevision,
    changes: input.changes,
    summary: plan.summary,
    files: plan.files,
    diff: plan.diff,
    conflicts: plan.conflicts,
  };
  return {
    previewHash: `sha256:${sha256(material)}`,
    changeHash: `sha256:${sha256({ baseRevision: input.baseRevision, changes: input.changes })}`,
  };
}

function manualChecksForActions(actions: PlannedAction[]): ManualCheck[] {
  return actions.map((action) => {
    if (action.op === "rename") {
      return {
        kind: "workspace-path-state",
        path: action.toPath ?? action.path,
        expected: { exists: true, type: "file", sha256: action.afterSha256 },
      };
    }
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
