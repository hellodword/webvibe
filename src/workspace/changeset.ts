import { ManualArtifactStore } from "../manual/artifact-store.js";
import type { ManualArtifactRef } from "../manual/types.js";
import type { AuditLog } from "../state/audit.js";
import { BadRequestError } from "../util/errors.js";
import { randomToken, sha256 } from "../util/hash.js";
import { applyPlan, ChangesetRollbackError } from "./changeset/apply.js";
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

type PreviewWarning = {
  code: string;
  message: string;
};

type DiffPreview = {
  text: string;
  truncated: boolean;
  bytes: number;
  lines: number;
  maxInlineBytes: number;
  maxInlineLines: number;
  affectedPaths: string[];
  artifact: ManualArtifactRef | null;
};

type VerificationExpectation = {
  path: string;
  op: PlannedAction["op"];
  expected: ManifestBase;
};

export { fileManifest };

export async function previewChangeset(
  rawArgs: unknown,
  context: WorkspaceContext & {
    stateDir?: string;
    publicBaseUrl?: string;
  },
): Promise<{
  valid: boolean;
  status: "ok" | "conflicted";
  previewId: string;
  baseRevision?: string;
  base: { manifestHash: string };
  summary: ChangesetSummary;
  files: PlannedFile[];
  diff: string;
  diffInfo: DiffPreview;
  conflicts: Conflict[];
  warnings: PreviewWarning[];
  artifacts: ManualArtifactRef[];
  previewHash: string;
  changeHash: string;
}> {
  const plan = await buildChangesetPlan(rawArgs, context);
  const hashes = previewHashes(rawArgs, plan);
  const previewId = `cp_${randomToken(12)}`;
  const diffInfo = await buildDiffPreview(plan, context, previewId);
  const warnings = diffInfo.truncated
    ? [
        {
          code: "DIFF_TRUNCATED",
          message: diffInfo.artifact
            ? "Diff exceeded inline limits and was saved as an artifact."
            : "Diff exceeded inline limits and no artifact store was configured.",
        },
      ]
    : [];
  return {
    valid: plan.conflicts.length === 0,
    status: plan.conflicts.length === 0 ? "ok" : "conflicted",
    previewId,
    baseRevision: plan.baseRevision,
    base: { manifestHash: baseManifestHash(plan) },
    summary: plan.summary,
    files: plan.files,
    diff: diffInfo.text,
    diffInfo,
    conflicts: plan.conflicts,
    warnings,
    artifacts: diffInfo.artifact ? [diffInfo.artifact] : [],
    ...hashes,
  };
}

export async function applyChangeset(
  rawArgs: unknown,
  context: WorkspaceContext & {
    audit?: AuditLog;
  },
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

  try {
    await applyPlan(plan);
  } catch (error) {
    await auditApplyFailure(rawArgs, plan, hashes.previewHash, error, context.audit);
    throw error;
  }
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

async function auditApplyFailure(
  rawArgs: unknown,
  plan: { summary: ChangesetSummary; files: PlannedFile[]; conflicts: Conflict[] },
  previewHash: string,
  error: unknown,
  audit?: AuditLog,
): Promise<void> {
  if (!audit) return;
  const err = error instanceof Error ? error : new Error(String(error));
  await audit.write({
    timestamp: new Date().toISOString(),
    event:
      error instanceof ChangesetRollbackError ? "change.apply.rollback_failed" : "change.apply.failed",
    tool: "change.apply",
    type: "builtIn",
    status: "error",
    inputHash: sha256(rawArgs),
    input: rawArgs,
    rawOutput: {
      previewHash,
      summary: plan.summary,
      files: plan.files,
      conflicts: plan.conflicts,
      ...(error instanceof ChangesetRollbackError
        ? { rollbackErrors: error.rollbackErrors, applyError: error.applyError }
        : {}),
    },
    rawOutputHash: sha256({ previewHash, files: plan.files, conflicts: plan.conflicts }),
    error: err.message,
    errorCode:
      error instanceof ChangesetRollbackError
        ? error.code
        : "code" in err && typeof (err as any).code === "string"
          ? (err as any).code
          : undefined,
    errorStack: err.stack,
  });
}

async function buildDiffPreview(
  plan: { diff: string; files: PlannedFile[] },
  context: WorkspaceContext & { stateDir?: string; publicBaseUrl?: string },
  previewId: string,
): Promise<DiffPreview> {
  const bytes = Buffer.byteLength(plan.diff, "utf8");
  const lines = countLines(plan.diff);
  const maxInlineBytes = context.limits.change.maxInlineDiffBytes;
  const maxInlineLines = context.limits.change.maxInlineDiffLines;
  const affectedPaths = plan.files.map((file) => file.path);
  if (bytes <= maxInlineBytes && lines <= maxInlineLines) {
    return {
      text: plan.diff,
      truncated: false,
      bytes,
      lines,
      maxInlineBytes,
      maxInlineLines,
      affectedPaths,
      artifact: null,
    };
  }

  let artifact: ManualArtifactRef | null = null;
  if (context.stateDir && context.publicBaseUrl) {
    artifact = (
      await new ManualArtifactStore(context.stateDir).create({
        kind: "diff",
        label: "Workspace change preview diff",
        filename: "workspace-change-preview.diff",
        mimeType: "text/x-diff",
        content: plan.diff,
        createdByTool: "change.preview",
        operationId: previewId,
        publicBaseUrl: context.publicBaseUrl,
      })
    ).ref;
  }
  return {
    text: "",
    truncated: true,
    bytes,
    lines,
    maxInlineBytes,
    maxInlineLines,
    affectedPaths,
    artifact,
  };
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  return text.split(/\r\n|\r|\n/).length;
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
