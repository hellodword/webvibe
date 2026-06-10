import { z } from "zod";

import {
  CAPABILITY_LIMIT_FRAGMENTS,
  MANUAL_PENDING_TTL_MS,
  SAFETY_BLOCK_TEXT,
  SECONDARY_CONFIRMATION_FRAGMENTS,
} from "./constants.js";
import { classifyHostOutput } from "./host-output.js";
import { ManualPendingStore } from "./pending-store.js";
import { PreparedManualActionStore } from "./prepared-store.js";
import { buildManualActionScope } from "./scope.js";
import type {
  ManualActionReason,
  ManualArtifactRef,
  ManualCheck,
  ManualInterruptedAt,
  ManualNextAfterResume,
  ManualOperation,
} from "./types.js";
import type { LimitsPolicy } from "../policy/policy.js";
import type { CallerIdentity } from "../router/tools-call.js";
import type { AuditLog } from "../state/audit.js";
import { BadRequestError } from "../util/errors.js";
import { randomToken, sha256 } from "../util/hash.js";

const MANUAL_FORMAT_VERSION = "WEBVIBE_MANUAL_REQUIRED v1";

const gateInputSchema = z
  .object({
    preparedId: z.string().optional(),
    reason: z.enum([
      "openai_safety_block",
      "manual_review_requested",
      "external_manual_step",
    ]),
    manualFormatVersion: z.literal(MANUAL_FORMAT_VERSION),
    manualMessageHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    operation: z
      .object({
        id: z.string().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/),
        kind: z.enum(["task", "change", "external"]),
      })
      .strict(),
    hostObservation: z
      .object({
        toolName: z.string().optional(),
        classification: z.string().optional(),
        outputText: z.string().max(4000).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export async function openManualGate(
  rawArgs: unknown,
  context: {
    workspaceRoot: string;
    stateDir: string;
    limits?: LimitsPolicy;
    caller: CallerIdentity;
    audit?: AuditLog;
  },
): Promise<{
  structuredContent: {
    status: "awaiting_manual_completion";
    operationId: string;
    operation: { id: string; kind: "task" | "change" | "external" };
    manualFormatVersion: "WEBVIBE_MANUAL_REQUIRED v1";
    manualMessageHash: string;
    pendingId: string;
    preparedId?: string;
    reason: ManualActionReason;
    expiresAt: string;
    resumeTool: "manual.resume";
    continuation: {
      mode: "await_resume_command";
      modelShouldStop: true;
      mustEndTurn: true;
      resumeMode: "resume_interrupted_workflow";
    };
  };
  content: Array<{ type: "text"; text: string }>;
}> {
  const input = gateInputSchema.parse(rawArgs);
  let title = "Manual action required";
  let instructions =
    "See the preceding ChatGPT message for the manual instructions. After completing the manual step, reply with /resume and an optional workspace-relative log file path.";
  let operationId = input.operation.id || randomToken(18);
  let operation: ManualOperation = input.operation;
  let originalRequestSummary: string | undefined;
  let interruptedAt: ManualInterruptedAt | undefined;
  let nextAfterResume: ManualNextAfterResume | undefined;
  let artifacts: ManualArtifactRef[] = [];
  let checks: ManualCheck[] = [];
  const preparedStore = new PreparedManualActionStore(context.stateDir);
  const prepared = input.preparedId ? await preparedStore.read(input.preparedId) : undefined;

  if (input.preparedId) {
    if (!prepared) throw new BadRequestError("preparedId was not found");
    if (Date.now() > Date.parse(prepared.expiresAt)) throw new BadRequestError("preparedId expired");
    title = prepared.title;
    instructions = prepared.instructions;
    operationId = prepared.operationId;
    operation = prepared.operation ?? input.operation;
    originalRequestSummary = prepared.originalRequestSummary;
    interruptedAt = prepared.interruptedAt;
    nextAfterResume = prepared.nextAfterResume;
    artifacts = prepared.artifacts;
    checks = prepared.checks;
  }

  const now = new Date();
  const ttlMs = (context.limits?.manual.ttlSeconds ?? MANUAL_PENDING_TTL_MS / 1000) * 1000;
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
  const pendingStore = new ManualPendingStore(context.stateDir);
  const pendingId = pendingStore.newPendingId();
  const scope = buildManualActionScope({
    workspaceRoot: context.workspaceRoot,
    caller: context.caller,
  });
  const classification = classifyHostOutput(input.hostObservation?.outputText);
  const hostObservation = input.hostObservation
    ? {
        ...input.hostObservation,
        classification,
      }
    : undefined;
  const record = await pendingStore.create({
    operationId,
    operation,
    originalRequestSummary,
    interruptedAt,
    nextAfterResume,
    manualFormatVersion: input.manualFormatVersion,
    manualMessageHash: input.manualMessageHash,
    pendingId,
    preparedId: input.preparedId,
    reason: input.reason,
    status: "pending",
    title,
    instructions,
    createdAt: now.toISOString(),
    expiresAt,
    createdByTool: "manual.gate",
    scope,
    hostObservation,
    artifacts,
    checks,
    events: [{ at: now.toISOString(), type: "created" }],
  });

  await context.audit?.write({
    timestamp: now.toISOString(),
    event: "manual.gate.created",
    operationId,
    preparedId: input.preparedId,
    pendingId,
    tool: "manual.gate",
    type: "builtIn",
    status: "ok",
    durationMs: 0,
    inputHash: sha256({
      preparedId: input.preparedId,
      reason: input.reason,
      operation,
      manualFormatVersion: input.manualFormatVersion,
      manualMessageHash: input.manualMessageHash,
      hostObservation,
    }),
    input: {
      preparedId: input.preparedId,
      reason: input.reason,
      operation,
      manualFormatVersion: input.manualFormatVersion,
      manualMessageHash: input.manualMessageHash,
      hostObservation,
      safetyBlockText: SAFETY_BLOCK_TEXT,
      secondaryConfirmationFragments: SECONDARY_CONFIRMATION_FRAGMENTS,
      capabilityLimitFragments: CAPABILITY_LIMIT_FRAGMENTS,
    },
    rawOutput: { pendingId, artifactCount: artifacts.length, checks },
    hostObservation,
  });

  return {
    structuredContent: {
      status: "awaiting_manual_completion",
      operationId: record.operationId,
      operation,
      manualFormatVersion: input.manualFormatVersion,
      manualMessageHash: input.manualMessageHash,
      pendingId: record.pendingId,
      preparedId: record.preparedId,
      reason: record.reason,
      expiresAt: record.expiresAt,
      resumeTool: "manual.resume",
      continuation: {
        mode: "await_resume_command",
        modelShouldStop: true,
        mustEndTurn: true,
        resumeMode: "resume_interrupted_workflow",
      },
    },
    content: [
      {
        type: "text",
        text: "Manual gate opened. End this assistant turn now. Do not summarize, call more tools, or continue any remaining work until the next user message starts with /resume and manual.resume returns confirmed. After confirmed resume, verify state and continue the original interrupted workflow.",
      },
    ],
  };
}
