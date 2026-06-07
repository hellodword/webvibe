import { z } from "zod";

import {
  MANUAL_EVIDENCE_NOTE_MAX_CHARS,
  MANUAL_OUTPUT_MAX_CHARS,
} from "./constants.js";
import { ManualPendingStore } from "./pending-store.js";
import type { ManualActionReason, ManualCheck, ManualOutputFormat } from "./types.js";
import type { LimitsPolicy, WorkspacePolicy } from "../policy/policy.js";
import type { AuditLog } from "../state/audit.js";
import { sha256 } from "../util/hash.js";
import { fileManifest } from "../workspace/changeset.js";
import { gitStatus } from "../workspace/inspect/git.js";

const confirmInputSchema = z
  .object({
    pendingId: z.string().min(1),
    confirmToken: z.string().min(1),
    outcome: z.enum(["completed", "cancelled"]),
    manualOutput: z.string().max(MANUAL_OUTPUT_MAX_CHARS).optional(),
    manualOutputFormat: z.enum(["text", "markdown", "json"]).optional(),
    evidenceNote: z.string().max(MANUAL_EVIDENCE_NOTE_MAX_CHARS).optional(),
  })
  .strict();

type ManualEvidence = {
  manualOutput?: string;
  manualOutputFormat?: ManualOutputFormat;
  evidenceNote?: string;
};

type VerificationResult = {
  status: "passed" | "failed" | "not_configured" | "skipped";
  checks: Array<{
    kind: ManualCheck["kind"];
    path?: string;
    expected: unknown;
    actual: unknown;
    ok: boolean;
  }>;
};

type ConfirmManualActionResult = {
  status:
    | "confirmed"
    | "cancelled"
    | "verification_failed"
    | "expired"
    | "not_found"
    | "forbidden";
  operationId?: string;
  pendingId: string;
  preparedId?: string;
  reason?: ManualActionReason;
  outcome: "completed" | "cancelled";
  verification: VerificationResult;
  next: {
    recommendedTools: string[];
    followUpPrompt: string;
  };
};

export async function confirmManualAction(
  rawArgs: unknown,
  context: {
    workspaceRoot: string;
    workspace: WorkspacePolicy;
    limits: LimitsPolicy;
    stateDir: string;
    audit?: AuditLog;
  },
): Promise<ConfirmManualActionResult> {
  const startedAt = Date.now();
  const input = confirmInputSchema.safeParse(rawArgs);
  const pendingId: string =
    input.success && input.data.pendingId
      ? input.data.pendingId
      : typeof (rawArgs as any)?.pendingId === "string"
        ? (rawArgs as any).pendingId
        : "";
  const outcome: "completed" | "cancelled" =
    input.success && input.data.outcome === "cancelled" ? "cancelled" : "completed";
  const token = input.success ? input.data.confirmToken : "";
  const evidence: ManualEvidence = input.success
    ? {
        manualOutput: normalizeOptional(input.data.manualOutput),
        manualOutputFormat: input.data.manualOutputFormat ?? "text",
        evidenceNote: normalizeOptional(input.data.evidenceNote),
      }
    : {};
  const tokenHash = token ? sha256(token) : "";
  const store = new ManualPendingStore(context.stateDir);
  const record = pendingId ? await store.read(pendingId) : undefined;
  const base: Pick<ConfirmManualActionResult, "pendingId" | "outcome" | "verification" | "next"> = {
    pendingId,
    outcome,
    verification: { status: "skipped", checks: [] } satisfies VerificationResult,
    next: nextResponse(pendingId, "skipped", evidence),
  };

  if (!input.success || !record) {
    const status = !input.success ? "forbidden" : "not_found";
    await writeConfirmAudit(context.audit, startedAt, {
      status,
      pendingId,
      outcome,
      confirmTokenHash: tokenHash,
      confirmTokenAccepted: false,
      verification: base.verification,
    });
    return { ...base, status };
  }

  if (record.confirmTokenHash !== tokenHash) {
    await writeConfirmAudit(context.audit, startedAt, {
      status: "forbidden",
      operationId: record.operationId,
      preparedId: record.preparedId,
      pendingId,
      outcome,
      reason: record.reason,
      confirmTokenHash: tokenHash,
      confirmTokenAccepted: false,
      verification: base.verification,
    });
    return {
      ...base,
      status: "forbidden",
      operationId: record.operationId,
      preparedId: record.preparedId,
      reason: record.reason,
    };
  }

  if (Date.now() > Date.parse(record.expiresAt)) {
    record.status = "expired";
    record.events.push({ at: new Date().toISOString(), type: "expired", ...eventEvidence(evidence) });
    await store.save(record);
    await writeConfirmAudit(context.audit, startedAt, {
      status: "expired",
      operationId: record.operationId,
      preparedId: record.preparedId,
      pendingId,
      outcome,
      reason: record.reason,
      confirmTokenHash: tokenHash,
      confirmTokenAccepted: true,
      verification: base.verification,
      evidence,
    });
    return {
      ...recordResponse(base, record, "expired"),
      next: nextResponse(pendingId, "expired", evidence),
    };
  }

  if (outcome === "cancelled") {
    record.status = "cancelled";
    record.events.push({ at: new Date().toISOString(), type: "cancelled", ...eventEvidence(evidence) });
    await store.save(record);
    await writeConfirmAudit(context.audit, startedAt, {
      status: "cancelled",
      operationId: record.operationId,
      preparedId: record.preparedId,
      pendingId,
      outcome,
      reason: record.reason,
      confirmTokenHash: tokenHash,
      confirmTokenAccepted: true,
      verification: base.verification,
      evidence,
    });
    return {
      ...recordResponse(base, record, "cancelled"),
      next: nextResponse(pendingId, "cancelled", evidence),
    };
  }

  const verification = await verifyChecks(record.checks, context);
  if (verification.status === "failed") {
    record.events.push({
      at: new Date().toISOString(),
      type: "verification_failed",
      ...eventEvidence(evidence),
    });
    await store.save(record);
    await writeConfirmAudit(context.audit, startedAt, {
      status: "verification_failed",
      operationId: record.operationId,
      preparedId: record.preparedId,
      pendingId,
      outcome,
      reason: record.reason,
      confirmTokenHash: tokenHash,
      confirmTokenAccepted: true,
      verification,
      evidence,
    });
    return {
      ...recordResponse(base, record, "verification_failed"),
      verification,
      next: nextResponse(pendingId, "verification_failed", evidence),
    };
  }

  record.status = "confirmed";
  record.events.push({ at: new Date().toISOString(), type: "confirmed", ...eventEvidence(evidence) });
  await store.save(record);
  await writeConfirmAudit(context.audit, startedAt, {
    status: "confirmed",
    operationId: record.operationId,
    preparedId: record.preparedId,
    pendingId,
    outcome,
    reason: record.reason,
    confirmTokenHash: tokenHash,
    confirmTokenAccepted: true,
    verification,
    evidence,
  });
  return {
    ...recordResponse(base, record, "confirmed"),
    verification,
    next: nextResponse(pendingId, "confirmed", evidence),
  };
}

async function verifyChecks(
  checks: ManualCheck[],
  context: {
    workspaceRoot: string;
    workspace: WorkspacePolicy;
    limits: LimitsPolicy;
  },
): Promise<VerificationResult> {
  if (checks.length === 0) return { status: "not_configured", checks: [] };
  const results = [];
  for (const check of checks) {
    if (check.kind === "workspace-path-state") {
      const actual = (await fileManifest({ paths: [check.path] }, context)).files[0];
      const expected = check.expected;
      const ok =
        expected.exists === false
          ? actual.exists === false
          : actual.exists === true &&
            (expected.type === undefined || actual.type === expected.type) &&
            (expected.sha256 === undefined || actual.sha256 === expected.sha256);
      results.push({ kind: check.kind, path: check.path, expected, actual, ok });
      continue;
    }
    if (check.kind === "git-worktree") {
      const actual = await gitStatus({}, context);
      const changedPaths = gitChangedPaths(actual.stdout);
      const scopedPaths = check.paths?.length
        ? changedPaths.filter((item) => check.paths!.some((prefix) => item === prefix || item.startsWith(`${prefix}/`)))
        : changedPaths;
      const ok =
        check.expected === "any" ||
        (check.expected === "changed" ? scopedPaths.length > 0 : scopedPaths.length === 0);
      results.push({ kind: check.kind, expected: check.expected, actual, ok });
      continue;
    }
    results.push({
      kind: check.kind,
      expected: check.description,
      actual: "user-confirmed",
      ok: true,
    });
  }
  return { status: results.every((item) => item.ok) ? "passed" : "failed", checks: results };
}

function gitChangedPaths(stdout: string): string[] {
  return stdout
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("##"))
    .map((line) => line.slice(3).trim().split(" -> ").pop() ?? "")
    .filter(Boolean);
}

function nextResponse(pendingId: string, status: string, evidence: ManualEvidence = {}): {
  recommendedTools: string[];
  followUpPrompt: string;
} {
  const evidenceText = formatEvidenceForFollowUp(evidence);
  return {
    recommendedTools: ["git.status", "git.diff", "read.stat", "task.run"],
    followUpPrompt: [
      `Manual action ${pendingId} was confirmed with status ${status}.`,
      evidenceText,
      "Continue by verifying current workspace state with appropriate read/git/task tools before making further changes.",
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

function recordResponse(
  base: Pick<ConfirmManualActionResult, "pendingId" | "outcome" | "verification" | "next">,
  record: {
    operationId: string;
    preparedId?: string;
    reason: ManualActionReason;
  },
  status: ConfirmManualActionResult["status"],
): ConfirmManualActionResult {
  return {
    ...base,
    status,
    operationId: record.operationId,
    preparedId: record.preparedId,
    reason: record.reason,
  };
}

async function writeConfirmAudit(
  audit: AuditLog | undefined,
  startedAt: number,
  input: {
    status: "confirmed" | "cancelled" | "verification_failed" | "expired" | "not_found" | "forbidden";
    operationId?: string;
    preparedId?: string;
    pendingId: string;
    outcome: "completed" | "cancelled";
    reason?: ManualActionReason;
    confirmTokenHash: string;
    confirmTokenAccepted: boolean;
    verification: VerificationResult;
    evidence?: ManualEvidence;
  },
): Promise<void> {
  await audit?.write({
    timestamp: new Date().toISOString(),
    event: "manual.confirm",
    operationId: input.operationId,
    preparedId: input.preparedId,
    pendingId: input.pendingId,
    tool: "manual.confirm",
    type: "builtIn",
    status: input.status === "forbidden" || input.status === "not_found" ? "error" : "ok",
    durationMs: Date.now() - startedAt,
    inputHash: sha256({
      pendingId: input.pendingId,
      outcome: input.outcome,
      confirmTokenHash: input.confirmTokenHash,
      manualOutput: input.evidence?.manualOutput,
      manualOutputFormat: input.evidence?.manualOutputFormat,
      evidenceNote: input.evidence?.evidenceNote,
    }),
    input: {
      pendingId: input.pendingId,
      outcome: input.outcome,
      confirmTokenHash: input.confirmTokenHash,
      confirmTokenAccepted: input.confirmTokenAccepted,
      manualOutput: input.evidence?.manualOutput,
      manualOutputFormat: input.evidence?.manualOutputFormat,
      evidenceNote: input.evidence?.evidenceNote,
    },
    rawOutput: {
      status: input.status,
      reason: input.reason,
      verification: input.verification,
      manualOutputBytes: Buffer.byteLength(input.evidence?.manualOutput ?? "", "utf8"),
      evidenceNoteBytes: Buffer.byteLength(input.evidence?.evidenceNote ?? "", "utf8"),
    },
    verification: input.verification,
  });
}

function normalizeOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function eventEvidence(evidence: ManualEvidence): {
  note?: string;
  manualOutput?: string;
  manualOutputFormat?: ManualOutputFormat;
} {
  return {
    note: evidence.evidenceNote,
    manualOutput: evidence.manualOutput,
    manualOutputFormat: evidence.manualOutput ? (evidence.manualOutputFormat ?? "text") : undefined,
  };
}

function formatEvidenceForFollowUp(evidence: ManualEvidence): string {
  const parts: string[] = [];
  if (evidence.evidenceNote) {
    parts.push(`Manual evidence note:\n${evidence.evidenceNote}`);
  }
  if (evidence.manualOutput) {
    const format = evidence.manualOutputFormat ?? "text";
    parts.push(`Manual output/logs (${format}):\n${fence(format, evidence.manualOutput)}`);
  }
  return parts.join("\n\n");
}

function fence(format: ManualOutputFormat, value: string): string {
  const info = format === "json" ? "json" : format === "markdown" ? "markdown" : "";
  return `\`\`\`${info}\n${value}\n\`\`\``;
}
