import { z } from "zod";

import { PreparedManualActionStore } from "./prepared-store.js";
import type { ManualCheck } from "./types.js";
import type { LimitsPolicy } from "../policy/policy.js";
import type { AuditLog } from "../state/audit.js";
import { sha256 } from "../util/hash.js";

const operationSchema = z
  .object({
    id: z.string().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/),
    kind: z.enum(["task", "change", "external"]),
  })
  .strict();

const manualCheckSchema: z.ZodType<ManualCheck> = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("workspace-path-state"),
      path: z.string().min(1).max(500),
      expected: z.union([
        z
          .object({
            exists: z.literal(true),
            type: z.enum(["file", "directory"]).optional(),
            sha256: z.string().optional(),
          })
          .strict(),
        z
          .object({
            exists: z.literal(false),
          })
          .strict(),
      ]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("git-worktree"),
      paths: z.array(z.string().min(1).max(500)).max(100).optional(),
      expected: z.enum(["changed", "clean", "any"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("none"),
      description: z.string().min(1).max(500),
    })
    .strict(),
]);

const prepareInputSchema = z
  .object({
    operation: operationSchema,
    originalRequestSummary: z.string().min(1).max(1000),
    interruptedAt: z.enum(["task", "edit", "test", "commit", "other"]),
    verificationPlan: z.array(manualCheckSchema).max(50).default([]),
    nextAfterResume: z
      .object({
        tool: z.string().min(1).max(100),
        reason: z.string().min(1).max(500),
      })
      .strict(),
  })
  .strict();

export async function prepareManualAction(
  rawArgs: unknown,
  context: {
    stateDir: string;
    limits?: LimitsPolicy;
    audit?: AuditLog;
  },
): Promise<{
  structuredContent: {
    status: "prepared";
    operationId: string;
    operation: { id: string; kind: "task" | "change" | "external" };
    preparedId: string;
    expiresAt: string;
    gateTool: "manual.gate";
    resumeTool: "manual.resume";
    verificationPlan: { checkCount: number };
    continuation: {
      mode: "show_manual_instructions_then_open_gate";
      mustShowManualInstructions: true;
      mustNotIncludeManualPayloadInGate: true;
    };
  };
  content: Array<{ type: "text"; text: string }>;
}> {
  const startedAt = Date.now();
  const input = prepareInputSchema.parse(rawArgs);
  const store = new PreparedManualActionStore(context.stateDir);
  const prepared = await store.create({
    operationId: input.operation.id,
    operation: input.operation,
    originalRequestSummary: input.originalRequestSummary,
    interruptedAt: input.interruptedAt,
    nextAfterResume: input.nextAfterResume,
    createdByTool: "manual.prepare",
    title: "Manual action prepared",
    instructions:
      "See the preceding ChatGPT message for the manual instructions. Do not put commands, diffs, stdout/stderr, or log contents in manual.gate arguments.",
    artifacts: [],
    checks: input.verificationPlan,
  });

  await context.audit?.write({
    timestamp: new Date().toISOString(),
    event: "manual.prepared.created",
    operationId: prepared.operationId,
    preparedId: prepared.preparedId,
    tool: "manual.prepare",
    type: "builtIn",
    status: "ok",
    durationMs: Date.now() - startedAt,
    inputHash: sha256(input),
    input: {
      operation: input.operation,
      originalRequestSummary: input.originalRequestSummary,
      interruptedAt: input.interruptedAt,
      verificationPlan: input.verificationPlan,
      nextAfterResume: input.nextAfterResume,
    },
    rawOutput: {
      preparedId: prepared.preparedId,
      expiresAt: prepared.expiresAt,
      checkCount: prepared.checks.length,
    },
  });

  return {
    structuredContent: {
      status: "prepared",
      operationId: prepared.operationId,
      operation: input.operation,
      preparedId: prepared.preparedId,
      expiresAt: prepared.expiresAt,
      gateTool: "manual.gate",
      resumeTool: "manual.resume",
      verificationPlan: { checkCount: prepared.checks.length },
      continuation: {
        mode: "show_manual_instructions_then_open_gate",
        mustShowManualInstructions: true,
        mustNotIncludeManualPayloadInGate: true,
      },
    },
    content: [
      {
        type: "text",
        text: "Manual action prepared. Show the manual instructions in chat, then call manual.gate with preparedId and minimal v1 proof fields.",
      },
    ],
  };
}
