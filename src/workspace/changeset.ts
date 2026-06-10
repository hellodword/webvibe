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

type HostRisk = "low" | "medium" | "high";

type ChangeRiskAssessment = {
  hostRisk: HostRisk;
  estimatedPayloadBytes: number;
  pathRisk: {
    affectedPaths: string[];
    protectedPathsBlocked: true;
    symlinkPathsBlocked: true;
  };
  deleteRisk: {
    deleteCount: number;
    threshold: number;
    high: boolean;
  };
  diffRisk: {
    bytes: number;
    lines: number;
    maxInlineBytes: number;
    maxInlineLines: number;
    truncated: boolean;
    high: boolean;
  };
  reasons: string[];
  manualFirst: boolean;
  recommendedRoute: {
    tool: "file.change_apply" | "batch.change_apply" | "manual.prepare";
    reason: string;
  };
};

type ManualPlan = {
  operation: {
    id: string;
    kind: "change";
  };
  reason: "high_host_risk";
  displayInstructions: string;
  verificationPlan: Array<Record<string, unknown>>;
  resumeCommand: string;
  next: {
    tool: "manual.prepare";
    args: {
      operation: {
        id: string;
        kind: "change";
      };
      originalRequestSummary: string;
      interruptedAt: "edit";
      verificationPlan: Array<Record<string, unknown>>;
      nextAfterResume: {
        tool: "workspace.context";
        reason: string;
      };
    };
  };
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
    toolName?: string;
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
  hostRisk: HostRisk;
  risk: ChangeRiskAssessment;
  manualPlan?: ManualPlan;
}> {
  const plan = await buildChangesetPlan(rawArgs, context);
  const hashes = previewHashes(rawArgs, plan);
  const previewId = `cp_${randomToken(12)}`;
  const diffInfo = await buildDiffPreview(plan, context, previewId);
  const risk = assessChangeRisk(plan, diffInfo, context.toolName);
  const warnings = changeRiskWarnings(diffInfo, risk);
  const manualPlan = risk.hostRisk === "high" ? manualPlanForChange(previewId, risk) : undefined;
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
    hostRisk: risk.hostRisk,
    risk,
    ...(manualPlan ? { manualPlan } : {}),
  };
}

export async function applyChangeset(
  rawArgs: unknown,
  context: WorkspaceContext & {
    audit?: AuditLog;
    toolName?: string;
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
  status?: "blocked";
  hostRisk: HostRisk;
  risk: ChangeRiskAssessment;
  manualPlan?: ManualPlan;
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
  const risk = assessChangeRisk(plan, diffPreviewFromPlan(plan, context), context.toolName);
  if (risk.hostRisk === "high") {
    const operationId = `cp_${randomToken(12)}`;
    return {
      status: "blocked",
      applied: false,
      verified: false,
      verification: skippedVerification(plan),
      baseRevision: plan.baseRevision,
      base: { manifestHash: baseManifestHash(plan) },
      summary: plan.summary,
      files: plan.files,
      conflicts: plan.conflicts,
      previewHash: hashes.previewHash,
      hostRisk: risk.hostRisk,
      risk,
      manualPlan: manualPlanForChange(operationId, risk),
    };
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
      hostRisk: risk.hostRisk,
      risk,
    };
  }

  try {
    await applyPlan(plan);
  } catch (error) {
    await auditApplyFailure(rawArgs, plan, hashes.previewHash, error, context.audit, context.toolName);
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
    hostRisk: risk.hostRisk,
    risk,
  };
}

async function auditApplyFailure(
  rawArgs: unknown,
  plan: { summary: ChangesetSummary; files: PlannedFile[]; conflicts: Conflict[] },
  previewHash: string,
  error: unknown,
  audit?: AuditLog,
  toolName = "change.apply",
): Promise<void> {
  if (!audit) return;
  const err = error instanceof Error ? error : new Error(String(error));
  await audit.write({
    timestamp: new Date().toISOString(),
    event:
      error instanceof ChangesetRollbackError ? "change.apply.rollback_failed" : "change.apply.failed",
    tool: toolName,
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
  context: WorkspaceContext & { stateDir?: string; publicBaseUrl?: string; toolName?: string },
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
        createdByTool: context.toolName ?? "change.preview",
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

function diffPreviewFromPlan(plan: { diff: string; files: PlannedFile[] }, context: WorkspaceContext): DiffPreview {
  const bytes = Buffer.byteLength(plan.diff, "utf8");
  const lines = countLines(plan.diff);
  const maxInlineBytes = context.limits.change.maxInlineDiffBytes;
  const maxInlineLines = context.limits.change.maxInlineDiffLines;
  return {
    text: "",
    truncated: bytes > maxInlineBytes || lines > maxInlineLines,
    bytes,
    lines,
    maxInlineBytes,
    maxInlineLines,
    affectedPaths: plan.files.map((file) => file.path),
    artifact: null,
  };
}

function assessChangeRisk(
  plan: { summary: ChangesetSummary; files: PlannedFile[] },
  diffInfo: DiffPreview,
  toolName = "change.preview",
): ChangeRiskAssessment {
  const deleteThreshold = 3;
  const deleteRiskHigh = plan.summary.deletes >= deleteThreshold;
  const diffRiskHigh = diffInfo.truncated;
  const reasons = [
    ...(deleteRiskHigh
      ? [`delete count ${plan.summary.deletes} meets manual-first threshold ${deleteThreshold}`]
      : []),
    ...(diffRiskHigh ? ["diff exceeds inline payload limits"] : []),
  ];
  const hostRisk: HostRisk = reasons.length > 0 ? "high" : "medium";
  const applyTool = toolName.startsWith("batch.") || toolName === "change.preview"
    ? "batch.change_apply"
    : "file.change_apply";
  return {
    hostRisk,
    estimatedPayloadBytes: diffInfo.bytes,
    pathRisk: {
      affectedPaths: diffInfo.affectedPaths,
      protectedPathsBlocked: true,
      symlinkPathsBlocked: true,
    },
    deleteRisk: {
      deleteCount: plan.summary.deletes,
      threshold: deleteThreshold,
      high: deleteRiskHigh,
    },
    diffRisk: {
      bytes: diffInfo.bytes,
      lines: diffInfo.lines,
      maxInlineBytes: diffInfo.maxInlineBytes,
      maxInlineLines: diffInfo.maxInlineLines,
      truncated: diffInfo.truncated,
      high: diffRiskHigh,
    },
    reasons,
    manualFirst: hostRisk === "high",
    recommendedRoute:
      hostRisk === "high"
        ? { tool: "manual.prepare", reason: "high_host_risk" }
        : { tool: applyTool, reason: "risk_acceptable" },
  };
}

function changeRiskWarnings(diffInfo: DiffPreview, risk: ChangeRiskAssessment): PreviewWarning[] {
  const warnings: PreviewWarning[] = [];
  if (diffInfo.truncated) {
    warnings.push({
      code: "DIFF_TRUNCATED",
      message: diffInfo.artifact
        ? "Diff exceeded inline limits and was saved as an artifact."
        : "Diff exceeded inline limits and no artifact store was configured.",
    });
  }
  if (risk.hostRisk === "high") {
    warnings.push({
      code: "HIGH_HOST_RISK",
      message: "Change preview is high risk for ChatGPT Web; use the manual plan instead of direct apply.",
    });
  }
  return warnings;
}

function manualPlanForChange(operationId: string, risk: ChangeRiskAssessment): ManualPlan {
  const logPath = `.webvibe/manual-logs/${operationId}.log`;
  const operation = { id: operationId, kind: "change" as const };
  const verificationPlan = [
    {
      kind: "fs.manifest",
      paths: risk.pathRisk.affectedPaths,
      reason: "Verify manually applied change paths before continuing.",
    },
  ];
  return {
    operation,
    reason: "high_host_risk",
    displayInstructions:
      "Show the high-risk change instructions in ChatGPT Web chat, ask the user to apply them outside ChatGPT, write stdout/stderr to the suggested workspace log path, and reply with the resume command.",
    verificationPlan,
    resumeCommand: `/resume ${operationId} ${logPath}`,
    next: {
      tool: "manual.prepare",
      args: {
        operation,
        originalRequestSummary: "High-risk workspace change requires manual application.",
        interruptedAt: "edit",
        verificationPlan,
        nextAfterResume: {
          tool: "workspace.context",
          reason: "Verify workspace state after manual change resume.",
        },
      },
    },
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
