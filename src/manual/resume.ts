import { z } from "zod";

import { MANUAL_LOG_PATH_MAX_CHARS } from "./constants.js";
import { ManualPendingStore } from "./pending-store.js";
import { buildManualActionScope } from "./scope.js";
import type { ManualActionReason, ManualCheck } from "./types.js";
import type { LimitsPolicy, WorkspacePolicy } from "../policy/policy.js";
import type { CallerIdentity } from "../router/tools-call.js";
import type { AuditLog } from "../state/audit.js";
import { BadRequestError } from "../util/errors.js";
import { sha256 } from "../util/hash.js";
import { fileManifest } from "../workspace/changeset.js";
import { gitStatus } from "../workspace/inspect/git.js";
import { normalizeWorkspacePath } from "../workspace/inspect/path.js";

const resumeInputSchema = z
  .object({
    resumeMessage: z.string().min(1).max(2000),
  })
  .strict();

type ManualEvidence = {
  manualLogPath?: string;
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

type ParsedResumeCommand =
  | { valid: true; outcome: "completed" | "cancelled"; evidence: ManualEvidence }
  | { valid: false; message: string };

type ResumeManualActionResult = {
  status:
    | "confirmed"
    | "cancelled"
    | "verification_failed"
    | "expired"
    | "not_found"
    | "blocked";
  code?: "RESUME_COMMAND_REQUIRED";
  operationId?: string;
  pendingId?: string;
  preparedId?: string;
  reason?: ManualActionReason;
  outcome?: "completed" | "cancelled";
  verification: VerificationResult;
  next: {
    recommendedTools: string[];
    followUpPrompt: string;
    mode: "await_resume_command" | "resume_interrupted_workflow";
    verifyBeforeContinuing: boolean;
  };
};

export async function resumeManualAction(
  rawArgs: unknown,
  context: {
    workspaceRoot: string;
    workspace: WorkspacePolicy;
    limits: LimitsPolicy;
    stateDir: string;
    caller: CallerIdentity;
    audit?: AuditLog;
  },
): Promise<ResumeManualActionResult> {
  const startedAt = Date.now();
  const input = resumeInputSchema.safeParse(rawArgs);
  const parsed = input.success
    ? parseResumeMessage(input.data.resumeMessage, context)
    : ({ valid: false, message: "Next user message must start with /resume." } as const);
  const store = new ManualPendingStore(context.stateDir);
  const scope = buildManualActionScope({
    workspaceRoot: context.workspaceRoot,
    caller: context.caller,
  });
  const expired = await store.expirePendingForScope(scope);
  const record = await store.firstBlockingPending(scope);
  const expiredRecord = expired.sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  const pendingId = record?.pendingId ?? expiredRecord?.pendingId;
  const base: Pick<ResumeManualActionResult, "pendingId" | "verification" | "next"> = {
    pendingId,
    verification: { status: "skipped", checks: [] } satisfies VerificationResult,
    next: nextResponse(pendingId, "skipped"),
  };

  if (!input.success || !parsed.valid) {
    await writeResumeAudit(context.audit, startedAt, {
      status: "blocked",
      operationId: record?.operationId,
      preparedId: record?.preparedId,
      pendingId,
      reason: record?.reason,
      outcome: undefined,
      resumeCommandAccepted: false,
      verification: base.verification,
      evidence: {},
    });
    return {
      ...base,
      status: "blocked",
      code: "RESUME_COMMAND_REQUIRED",
      reason: record?.reason,
      next: {
        recommendedTools: ["manual.resume"],
        mode: "await_resume_command",
        verifyBeforeContinuing: false,
        followUpPrompt:
          "A manual action is pending. The next user message must begin with /resume, for example /resume or /resume .webvibe/manual-logs/task.log. Use /resume cancel to cancel it.",
      },
    };
  }

  const evidence = parsed.evidence;
  const outcome = parsed.outcome;
  if (!record) {
    const status = expiredRecord ? "expired" : "not_found";
    await writeResumeAudit(context.audit, startedAt, {
      status,
      operationId: expiredRecord?.operationId,
      preparedId: expiredRecord?.preparedId,
      pendingId: expiredRecord?.pendingId,
      outcome,
      reason: expiredRecord?.reason,
      resumeCommandAccepted: true,
      verification: base.verification,
      evidence,
    });
    return {
      ...recordResponse(base, expiredRecord, status),
      outcome,
      next: nextResponse(expiredRecord?.pendingId, status, evidence),
    };
  }

  if (outcome === "cancelled") {
    record.status = "cancelled";
    record.events.push({ at: new Date().toISOString(), type: "cancelled", ...eventEvidence(evidence) });
    await store.save(record);
    await writeResumeAudit(context.audit, startedAt, {
      status: "cancelled",
      operationId: record.operationId,
      preparedId: record.preparedId,
      pendingId: record.pendingId,
      outcome,
      reason: record.reason,
      resumeCommandAccepted: true,
      verification: base.verification,
      evidence,
    });
    return {
      ...recordResponse(base, record, "cancelled"),
      outcome,
      next: nextResponse(record.pendingId, "cancelled", evidence),
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
    await writeResumeAudit(context.audit, startedAt, {
      status: "verification_failed",
      operationId: record.operationId,
      preparedId: record.preparedId,
      pendingId: record.pendingId,
      outcome,
      reason: record.reason,
      resumeCommandAccepted: true,
      verification,
      evidence,
    });
    return {
      ...recordResponse(base, record, "verification_failed"),
      outcome,
      verification,
      next: nextResponse(record.pendingId, "verification_failed", evidence),
    };
  }

  record.status = "confirmed";
  record.events.push({ at: new Date().toISOString(), type: "confirmed", ...eventEvidence(evidence) });
  await store.save(record);
  await writeResumeAudit(context.audit, startedAt, {
    status: "confirmed",
    operationId: record.operationId,
    preparedId: record.preparedId,
    pendingId: record.pendingId,
    outcome,
    reason: record.reason,
    resumeCommandAccepted: true,
    verification,
    evidence,
  });
  return {
    ...recordResponse(base, record, "confirmed"),
    outcome,
    verification,
    next: nextResponse(record.pendingId, "confirmed", evidence),
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

function parseResumeMessage(
  value: string,
  context: { workspaceRoot: string; workspace: WorkspacePolicy },
): ParsedResumeCommand {
  const text = value.trimStart();
  const match = /^\/resume(?:\s+([\s\S]*))?$/.exec(text);
  if (!match) {
    return { valid: false, message: "Next user message must start with /resume." };
  }
  const tail = (match[1] ?? "").trim();
  if (!tail) return { valid: true, outcome: "completed", evidence: {} };
  if (tail === "cancel") return { valid: true, outcome: "cancelled", evidence: {} };
  return {
    valid: true,
    outcome: "completed",
    evidence: {
      manualLogPath: normalizeManualLogPath(tail, context),
    },
  };
}

function nextResponse(
  pendingId: string | undefined,
  status: string,
  evidence: ManualEvidence = {},
): {
  recommendedTools: string[];
  followUpPrompt: string;
  mode: "await_resume_command" | "resume_interrupted_workflow";
  verifyBeforeContinuing: boolean;
} {
  const evidenceText = formatEvidenceForFollowUp(evidence);
  const subject = pendingId ? `Manual action ${pendingId}` : "Manual action";
  const resumed =
    status === "confirmed" || status === "not_found" || status === "expired" || status === "cancelled";
  const followUp =
    status === "verification_failed"
      ? "Manual verification failed. Stay on the original interrupted request, report the failed checks, and wait for the user to complete or cancel the manual step before continuing."
      : "Treat /resume as a control signal, not a new task. Verify current workspace state with context.get and appropriate read/git/task tools, then continue the original interrupted user request.";
  return {
    recommendedTools: ["context.get", "git.status", "git.diff", "read.stat", "read.files", "task.run"],
    mode: resumed ? "resume_interrupted_workflow" : "await_resume_command",
    verifyBeforeContinuing: resumed,
    followUpPrompt: [
      `${subject} resumed with status ${status}.`,
      evidenceText,
      followUp,
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

function recordResponse(
  base: Pick<ResumeManualActionResult, "pendingId" | "verification" | "next">,
  record:
    | {
        operationId: string;
        pendingId: string;
        preparedId?: string;
        reason: ManualActionReason;
      }
    | undefined,
  status: ResumeManualActionResult["status"],
): ResumeManualActionResult {
  return {
    ...base,
    status,
    operationId: record?.operationId,
    pendingId: record?.pendingId ?? base.pendingId,
    preparedId: record?.preparedId,
    reason: record?.reason,
  };
}

async function writeResumeAudit(
  audit: AuditLog | undefined,
  startedAt: number,
  input: {
    status: "confirmed" | "cancelled" | "verification_failed" | "expired" | "not_found" | "blocked";
    operationId?: string;
    preparedId?: string;
    pendingId?: string;
    outcome?: "completed" | "cancelled";
    reason?: ManualActionReason;
    resumeCommandAccepted: boolean;
    verification: VerificationResult;
    evidence?: ManualEvidence;
  },
): Promise<void> {
  await audit?.write({
    timestamp: new Date().toISOString(),
    event: "manual.resume",
    operationId: input.operationId,
    preparedId: input.preparedId,
    pendingId: input.pendingId,
    tool: "manual.resume",
    type: "builtIn",
    status:
      input.status === "not_found"
        ? "error"
        : input.status === "blocked"
          ? "blocked"
          : "ok",
    durationMs: Date.now() - startedAt,
    inputHash: sha256({
      outcome: input.outcome,
      manualLogPath: input.evidence?.manualLogPath,
      resumeCommandAccepted: input.resumeCommandAccepted,
    }),
    input: {
      outcome: input.outcome,
      resumeCommandAccepted: input.resumeCommandAccepted,
      manualLogPath: input.evidence?.manualLogPath,
    },
    rawOutput: {
      status: input.status,
      reason: input.reason,
      verification: input.verification,
      manualLogPathBytes: Buffer.byteLength(input.evidence?.manualLogPath ?? "", "utf8"),
    },
    verification: input.verification,
  });
}

function normalizeManualLogPath(
  value: string | undefined,
  context: { workspaceRoot: string; workspace: WorkspacePolicy },
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MANUAL_LOG_PATH_MAX_CHARS) {
    throw new BadRequestError(`manualLogPath must be at most ${MANUAL_LOG_PATH_MAX_CHARS} characters`);
  }
  return normalizeWorkspacePath(trimmed, context, { allowRoot: false }).relativePath;
}

function eventEvidence(evidence: ManualEvidence): {
  manualLogPath?: string;
} {
  return {
    manualLogPath: evidence.manualLogPath,
  };
}

function formatEvidenceForFollowUp(evidence: ManualEvidence): string {
  if (!evidence.manualLogPath) return "";
  return `Manual log file path:\n${evidence.manualLogPath}`;
}
