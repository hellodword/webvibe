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
import type { CallerIdentity } from "../router/tools-call.js";
import type { AuditLog } from "../state/audit.js";
import { BadRequestError } from "../util/errors.js";
import { randomToken, sha256 } from "../util/hash.js";

const gateInputSchema = z
  .object({
    preparedId: z.string().optional(),
    reason: z.enum([
      "openai_safety_block",
      "manual_review_requested",
      "external_manual_step",
    ]),
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
    stateDir: string;
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
      hostObservation,
    }),
    input: {
      preparedId: input.preparedId,
      reason: input.reason,
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
        text: "Manual gate opened. End this assistant turn now. Do not summarize, call more tools, or continue any remaining work until the next user message starts with /resume and manual.resume returns a result. After resume, verify state and continue the original interrupted workflow.",
      },
    ],
  };
}
