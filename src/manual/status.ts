import { z } from "zod";

import { ManualPendingStore } from "./pending-store.js";
import { buildManualActionScope } from "./scope.js";
import type { CallerIdentity } from "../router/tools-call.js";

const statusInputSchema = z.object({}).strict();

export async function manualStatus(
  rawArgs: unknown,
  context: {
    workspaceRoot: string;
    stateDir: string;
    caller: CallerIdentity;
  },
): Promise<{
  status: "pending" | "none";
  pending?: {
    operationId: string;
    pendingId: string;
    preparedId?: string;
    reason: string;
    expiresAt: string;
    interruptedAt?: string;
    nextAfterResume?: { tool: string; reason: string };
    checkCount: number;
  };
  expired: Array<{ operationId: string; pendingId: string; expiredAt: string }>;
  next: {
    recommendedTools: string[];
    mode: "await_resume_command" | "normal_workflow";
    followUpPrompt: string;
  };
}> {
  statusInputSchema.parse(rawArgs);
  const store = new ManualPendingStore(context.stateDir);
  const scope = buildManualActionScope({
    workspaceRoot: context.workspaceRoot,
    caller: context.caller,
  });
  const expiredRecords = await store.expirePendingForScope(scope);
  const pending = await store.firstBlockingPending(scope);
  const expired = expiredRecords.map((record) => ({
    operationId: record.operationId,
    pendingId: record.pendingId,
    expiredAt: record.expiresAt,
  }));

  if (!pending) {
    return {
      status: "none",
      expired,
      next: {
        recommendedTools: ["workspace.context"],
        mode: "normal_workflow",
        followUpPrompt: "No manual action is pending for this caller. Continue normal workflow after workspace.context.",
      },
    };
  }

  return {
    status: "pending",
    pending: {
      operationId: pending.operationId,
      pendingId: pending.pendingId,
      preparedId: pending.preparedId,
      reason: pending.reason,
      expiresAt: pending.expiresAt,
      interruptedAt: pending.interruptedAt,
      nextAfterResume: pending.nextAfterResume,
      checkCount: pending.checks.length,
    },
    expired,
    next: {
      recommendedTools: ["manual.resume"],
      mode: "await_resume_command",
      followUpPrompt:
        "A manual action is pending. Wait for a user message that starts with /resume, then call manual.resume before any workspace tool.",
    },
  };
}
