import { readFile, stat } from "node:fs/promises";

import { z } from "zod";

import { MANUAL_LOG_PATH_MAX_CHARS } from "./constants.js";
import { ManualPendingStore } from "./pending-store.js";
import { buildManualActionScope } from "./scope.js";
import type { ManualActionReason, ManualCheck, ManualLogEvidence } from "./types.js";
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
  manualLog?: ManualLogEvidence;
};

type VerificationResult = {
  status: "passed" | "failed" | "not_configured" | "skipped";
  checks: Array<{
    kind: ManualCheck["kind"] | "manual-log";
    path?: string;
    expected: unknown;
    actual: unknown;
    ok: boolean;
  }>;
};

type ParsedResumeCommand =
  | {
      valid: true;
      outcome: "completed" | "cancelled";
      operationId?: string;
      evidence: ManualEvidence;
    }
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
  evidence?: ManualEvidence;
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
          "A manual action is pending. The next user message must begin with /resume, for example /resume <operationId> or /resume <operationId> .webvibe/manual-logs/task.log. Use /resume cancel <operationId> to cancel it.",
      },
    };
  }

  let evidence = parsed.evidence;
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

  if (!parsed.operationId && evidence.manualLogPath === record.operationId) {
    evidence = {};
  }

  if (parsed.operationId && parsed.operationId !== record.operationId) {
    const verification = {
      status: "failed" as const,
      checks: [
        {
          kind: "none" as const,
          expected: { operationId: record.operationId },
          actual: { operationId: parsed.operationId },
          ok: false,
        },
      ],
    };
    await writeResumeAudit(context.audit, startedAt, {
      status: "blocked",
      operationId: record.operationId,
      preparedId: record.preparedId,
      pendingId: record.pendingId,
      outcome,
      reason: record.reason,
      resumeCommandAccepted: false,
      verification,
      evidence,
    });
    return {
      ...recordResponse(base, record, "blocked"),
      outcome,
      verification,
      next: {
        recommendedTools: ["manual.resume"],
        mode: "await_resume_command",
        verifyBeforeContinuing: false,
        followUpPrompt: `Manual action ${record.pendingId} is still pending. /resume operationId must be ${record.operationId}.`,
      },
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

  const logVerification = await verifyManualLog(evidence.manualLogPath, context);
  evidence = { ...evidence, manualLog: logVerification.evidence };
  if (logVerification.result.status === "failed") {
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
      verification: logVerification.result,
      evidence,
    });
    return {
      ...recordResponse(base, record, "verification_failed"),
      outcome,
      verification: logVerification.result,
      next: nextResponse(record.pendingId, "verification_failed", evidence),
    };
  }

  const verification = await verifyChecks(record.checks, context);
  const combinedVerification = combineVerification(logVerification.result, verification);
  if (combinedVerification.status === "failed") {
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
      verification: combinedVerification,
      evidence,
    });
    return {
      ...recordResponse(base, record, "verification_failed"),
      outcome,
      verification: combinedVerification,
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
    verification: combinedVerification,
    evidence,
  });
  return {
    ...recordResponse(base, record, "confirmed"),
    outcome,
    verification: combinedVerification,
    next: nextResponse(record.pendingId, "confirmed", evidence),
    evidence,
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

async function verifyManualLog(
  manualLogPath: string | undefined,
  context: {
    workspaceRoot: string;
    workspace: WorkspacePolicy;
  },
): Promise<{ result: VerificationResult; evidence?: ManualLogEvidence }> {
  if (!manualLogPath) return { result: { status: "skipped", checks: [] } };
  const resolved = normalizeWorkspacePath(manualLogPath, context, { allowRoot: false });
  try {
    const info = await stat(resolved.absolutePath);
    if (!info.isFile()) {
      return {
        result: {
          status: "failed",
          checks: [
            {
              kind: "manual-log",
              path: resolved.relativePath,
              expected: { exists: true, type: "file" },
              actual: { exists: true, type: info.isDirectory() ? "directory" : "other" },
              ok: false,
            },
          ],
        },
      };
    }
    const data = await readFile(resolved.absolutePath);
    const text = data.toString("utf8");
    const evidence: ManualLogEvidence = {
      path: resolved.relativePath,
      sizeBytes: data.length,
      sha256: sha256(text),
      head: edgeText(text, "head"),
      tail: edgeText(text, "tail"),
    };
    const exitCode = parseExitCode(text);
    if (exitCode !== undefined) evidence.exitCode = exitCode;
    return {
      evidence,
      result: {
        status: "passed",
        checks: [
          {
            kind: "manual-log",
            path: resolved.relativePath,
            expected: { exists: true, type: "file" },
            actual: {
              exists: true,
              type: "file",
              sizeBytes: info.size,
              sha256: evidence.sha256,
            },
            ok: true,
          },
        ],
      },
    };
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
    return {
      result: {
        status: "failed",
        checks: [
          {
            kind: "manual-log",
            path: resolved.relativePath,
            expected: { exists: true, type: "file" },
            actual: { exists: false },
            ok: false,
          },
        ],
      },
    };
  }
}

function combineVerification(
  logVerification: VerificationResult,
  checksVerification: VerificationResult,
): VerificationResult {
  const checks = [...logVerification.checks, ...checksVerification.checks];
  if (logVerification.status === "failed" || checksVerification.status === "failed") {
    return { status: "failed", checks };
  }
  if (checks.length === 0) return { status: "not_configured", checks };
  return { status: "passed", checks };
}

const MANUAL_LOG_EDGE_CHARS = 2048;

function edgeText(text: string, edge: "head" | "tail"): string {
  if (text.length <= MANUAL_LOG_EDGE_CHARS) return text;
  return edge === "head" ? text.slice(0, MANUAL_LOG_EDGE_CHARS) : text.slice(-MANUAL_LOG_EDGE_CHARS);
}

function parseExitCode(text: string): number | undefined {
  const match = /(?:exit(?:\s+code)?|status)\s*[:=]\s*(-?\d+)/i.exec(text);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isInteger(value) ? value : undefined;
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
  const parts = tail.split(/\s+/, 2);
  if (parts[0] === "cancel") {
    return {
      valid: true,
      outcome: "cancelled",
      operationId: parts[1],
      evidence: {},
    };
  }
  if (parts.length === 2) {
    return {
      valid: true,
      outcome: "completed",
      operationId: parts[0],
      evidence: {
        manualLogPath: normalizeManualLogPath(tail.slice(parts[0].length).trim(), context),
      },
    };
  }
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
  const resumed = status === "confirmed";
  const followUp = followUpForStatus(status);
  return {
    recommendedTools: resumed
      ? ["workspace.context", "git.status", "git.diff", "fs.stat", "fs.read", "task.run"]
      : ["manual.status", "manual.resume"],
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

function followUpForStatus(status: string): string {
  if (status === "confirmed") {
    return "Treat /resume as a control signal, not a new task. Verify current workspace state with workspace.context and appropriate fs/git/task tools, then continue the original interrupted user request.";
  }
  if (status === "verification_failed") {
    return "Manual verification failed. Keep the manual action pending, report the failed checks, and wait for the user to complete or cancel the manual step before continuing.";
  }
  if (status === "cancelled") {
    return "Manual action was cancelled. Do not continue the original interrupted request unless the user asks for it again.";
  }
  if (status === "expired") {
    return "Manual action expired. Do not continue the original interrupted request unless the user asks for it again.";
  }
  if (status === "not_found") {
    return "No pending manual action was found. Do not treat this /resume as completion of an interrupted request.";
  }
  return "A manual action is still pending. Wait for a valid /resume command before continuing.";
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
      manualLog: input.evidence?.manualLog
        ? {
            path: input.evidence.manualLog.path,
            sizeBytes: input.evidence.manualLog.sizeBytes,
            sha256: input.evidence.manualLog.sha256,
            headBytes: Buffer.byteLength(input.evidence.manualLog.head, "utf8"),
            tailBytes: Buffer.byteLength(input.evidence.manualLog.tail, "utf8"),
            exitCode: input.evidence.manualLog.exitCode,
          }
        : undefined,
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
  manualLog?: ManualLogEvidence;
} {
  return {
    manualLogPath: evidence.manualLogPath,
    manualLog: evidence.manualLog,
  };
}

function formatEvidenceForFollowUp(evidence: ManualEvidence): string {
  if (!evidence.manualLogPath) return "";
  const log = evidence.manualLog
    ? `\nManual log sha256: ${evidence.manualLog.sha256}\nManual log bytes: ${evidence.manualLog.sizeBytes}`
    : "";
  return `Manual log file path:\n${evidence.manualLogPath}${log}`;
}
