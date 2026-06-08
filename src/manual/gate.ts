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
import type { ManualActionReason, ManualArtifactRef, ManualCheck } from "./types.js";
import type { LimitsPolicy, WorkspacePolicy } from "../policy/policy.js";
import type { CallerIdentity } from "../router/tools-call.js";
import type { AuditLog } from "../state/audit.js";
import { BadRequestError } from "../util/errors.js";
import { randomToken, sha256 } from "../util/hash.js";

const gateInputSchema = z
  .object({
    preparedId: z.string().optional(),
    reason: z.enum([
      "openai_safety_block",
      "host_confirmation_block",
      "manual_review_requested",
      "external_manual_step",
      "user_requested_manual_step",
    ]),
    title: z.string().max(200).optional(),
    instructions: z.string().max(20000).optional(),
    hostObservation: z
      .object({
        toolName: z.string().optional(),
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
    workspace: WorkspacePolicy;
    limits: LimitsPolicy;
    stateDir: string;
    publicBaseUrl: string;
    caller: CallerIdentity;
    audit?: AuditLog;
  },
): Promise<{
  structuredContent: {
    status: "awaiting_manual_completion";
    operationId: string;
    pendingId: string;
    preparedId?: string;
    reason: ManualActionReason;
    title: string;
    expiresAt: string;
    resumeTool: "manual.resume";
    continuation: {
      mode: "await_resume_command";
      modelShouldStop: true;
    };
  };
  content: Array<{ type: "text"; text: string }>;
}> {
  void context.workspaceRoot;
  void context.workspace;
  void context.limits;

  const input = gateInputSchema.parse(rawArgs);
  let title = input.title?.trim() ?? "";
  let instructions = input.instructions?.trim() ?? "";
  let operationId = randomToken(18);
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
    artifacts = prepared.artifacts;
    checks = prepared.checks;
  } else if (!title || !instructions) {
    throw new BadRequestError("title and instructions are required without preparedId");
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + MANUAL_PENDING_TTL_MS).toISOString();
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
      title,
      instructions,
      hostObservation,
    }),
    input: {
      preparedId: input.preparedId,
      reason: input.reason,
      title,
      instructions,
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
      pendingId: record.pendingId,
      preparedId: record.preparedId,
      reason: record.reason,
      title: record.title,
      expiresAt: record.expiresAt,
      resumeTool: "manual.resume",
      continuation: {
        mode: "await_resume_command",
        modelShouldStop: true,
      },
    },
    content: [
      {
        type: "text",
        text: "Manual gate opened. Stop this assistant turn now. Do not summarize, call more tools, or continue the task until the next user message starts with /resume and manual.resume returns confirmed, cancelled, expired, or verification_failed.",
      },
    ],
  };
}
