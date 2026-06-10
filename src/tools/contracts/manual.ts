import { mediumWriteAnnotations, readOnlyAnnotations } from "./common.js";
import {
  arraySchema,
  booleanSchema,
  contentArraySchema,
  enumSchema,
  hostRiskSchema,
  integerSchema,
  objectSchema,
  recordSchema,
  stringArraySchema,
  stringSchema,
} from "./schemas.js";
import type { ToolContract } from "./types.js";

const operationSchema = objectSchema({
  id: stringSchema({ minLength: 1, maxLength: 100, pattern: "^[A-Za-z0-9_.-]+$" }),
  kind: enumSchema(["task", "change", "external"]),
});

const verificationCheckSchema = {
  oneOf: [
    objectSchema({
      kind: { const: "workspace-path-state" },
      path: stringSchema({ minLength: 1, maxLength: 500 }),
      expected: {
        oneOf: [
          objectSchema({ exists: { const: true }, type: enumSchema(["file", "directory"]), sha256: stringSchema() }, ["exists"]),
          objectSchema({ exists: { const: false } }),
        ],
      },
    }),
    objectSchema(
      {
        kind: { const: "git-worktree" },
        paths: arraySchema(stringSchema({ minLength: 1, maxLength: 500 }), { maxItems: 100 }),
        expected: enumSchema(["changed", "clean", "any"]),
      },
      ["kind", "expected"],
    ),
    objectSchema({
      kind: { const: "none" },
      description: stringSchema({ minLength: 1, maxLength: 500 }),
    }),
  ],
};

const nextAfterResumeSchema = objectSchema({
  tool: stringSchema({ minLength: 1, maxLength: 100 }),
  reason: stringSchema({ minLength: 1, maxLength: 500 }),
});

export const manualContracts: ToolContract[] = [
  {
    name: "manual.prepare",
    modes: ["dev"],
    description: "Prepare low-risk manual continuation metadata before showing manual instructions and opening manual.gate.",
    annotations: mediumWriteAnnotations,
    inputSchema: objectSchema(
      {
        operation: operationSchema,
        originalRequestSummary: stringSchema({ minLength: 1, maxLength: 1000 }),
        interruptedAt: enumSchema(["task", "edit", "test", "commit", "other"]),
        verificationPlan: arraySchema(verificationCheckSchema, { maxItems: 50 }),
        nextAfterResume: nextAfterResumeSchema,
      },
      ["operation", "originalRequestSummary", "interruptedAt", "nextAfterResume"],
    ),
    outputSchema: objectSchema({
      hostRisk: hostRiskSchema(),
      structuredContent: objectSchema({
        status: enumSchema(["prepared"]),
        operationId: stringSchema(),
        operation: operationSchema,
        preparedId: stringSchema(),
        expiresAt: stringSchema(),
        gateTool: enumSchema(["manual.gate"]),
        resumeTool: enumSchema(["manual.resume"]),
        verificationPlan: objectSchema({ checkCount: integerSchema({ minimum: 0 }) }),
        continuation: objectSchema({
          mode: enumSchema(["show_manual_instructions_then_open_gate"]),
          mustShowManualInstructions: booleanSchema(),
          mustNotIncludeManualPayloadInGate: booleanSchema(),
        }),
      }),
      content: contentArraySchema(),
    }),
    examples: [
      {
        name: "prepare manual task",
        args: {
          operation: { id: "manual-task", kind: "task" },
          originalRequestSummary: "Run a required external command.",
          interruptedAt: "task",
          verificationPlan: [{ kind: "none", description: "User reports command completion." }],
          nextAfterResume: { tool: "workspace.context", reason: "Verify workspace state after resume." },
        },
      },
    ],
    instructionExample: {
      operation: { id: "manual-task", kind: "task" },
      originalRequestSummary: "Run a required external command.",
      interruptedAt: "task",
      verificationPlan: [{ kind: "none", description: "User reports command completion." }],
      nextAfterResume: { tool: "workspace.context", reason: "Verify workspace state after resume." },
    },
    docsSummary: "Stores low-risk continuation metadata only; commands, diffs, stdout, stderr, logs, and content are rejected.",
    risk: "low",
  },
  {
    name: "manual.gate",
    modes: ["dev"],
    description: "Open a manual barrier after manual instructions were shown in chat.",
    annotations: mediumWriteAnnotations,
    inputSchema: objectSchema(
      {
        preparedId: stringSchema(),
        reason: enumSchema(["openai_safety_block", "manual_review_requested", "external_manual_step"]),
        manualFormatVersion: enumSchema(["WEBVIBE_MANUAL_REQUIRED v1"]),
        manualMessageHash: stringSchema({ pattern: "^sha256:[0-9a-f]{64}$" }),
        operation: operationSchema,
        hostObservation: objectSchema(
          {
            toolName: stringSchema(),
            classification: stringSchema(),
            outputText: stringSchema({ maxLength: 4000 }),
          },
          [],
        ),
      },
      ["reason", "manualFormatVersion", "manualMessageHash", "operation"],
    ),
    outputSchema: objectSchema({
      hostRisk: hostRiskSchema(),
      structuredContent: objectSchema(
        {
          status: enumSchema(["awaiting_manual_completion"]),
          operationId: stringSchema(),
          operation: operationSchema,
          manualFormatVersion: enumSchema(["WEBVIBE_MANUAL_REQUIRED v1"]),
          manualMessageHash: stringSchema({ pattern: "^sha256:[0-9a-f]{64}$" }),
          pendingId: stringSchema(),
          preparedId: stringSchema(),
          reason: enumSchema(["openai_safety_block", "manual_review_requested", "external_manual_step"]),
          expiresAt: stringSchema(),
          resumeTool: enumSchema(["manual.resume"]),
          continuation: objectSchema({
            mode: enumSchema(["await_resume_command"]),
            modelShouldStop: booleanSchema(),
            mustEndTurn: booleanSchema(),
            resumeMode: enumSchema(["resume_interrupted_workflow"]),
          }),
        },
        ["status", "operationId", "operation", "manualFormatVersion", "manualMessageHash", "pendingId", "reason", "expiresAt", "resumeTool", "continuation"],
      ),
      content: contentArraySchema(),
    }),
    examples: [
      {
        name: "open external manual gate",
        args: {
          reason: "external_manual_step",
          manualFormatVersion: "WEBVIBE_MANUAL_REQUIRED v1",
          manualMessageHash: `sha256:${"0".repeat(64)}`,
          operation: { id: "manual-task", kind: "task" },
          hostObservation: {
            toolName: "capability.limit",
            outputText: "manual step required because required execution capability is unavailable",
          },
        },
      },
    ],
    instructionExample: {
      reason: "external_manual_step",
      manualFormatVersion: "WEBVIBE_MANUAL_REQUIRED v1",
      manualMessageHash: `sha256:${"0".repeat(64)}`,
      operation: { id: "manual-task", kind: "task" },
      hostObservation: {
        toolName: "capability.limit",
        outputText: "manual step required because required execution capability is unavailable",
      },
    },
    docsSummary: "Opens the local manual barrier with v1 proof fields and low-risk hostObservation only.",
    risk: "low",
  },
  {
    name: "manual.status",
    modes: ["dev"],
    description: "Report current pending manual action for this caller.",
    annotations: readOnlyAnnotations,
    inputSchema: objectSchema({}, []),
    outputSchema: objectSchema({
      status: enumSchema(["pending", "none"]),
      hostRisk: hostRiskSchema(),
      pending: recordSchema(),
      expired: arraySchema(recordSchema()),
      next: objectSchema({
        recommendedTools: stringArraySchema(),
        mode: enumSchema(["await_resume_command", "normal_workflow"]),
        followUpPrompt: stringSchema(),
      }),
    }, ["status", "hostRisk", "expired", "next"]),
    examples: [{ name: "manual status", args: {} }],
    instructionExample: {},
    docsSummary: "Reports whether a manual barrier is pending and which resume route to use.",
    risk: "low",
  },
  {
    name: "manual.resume",
    modes: ["dev"],
    description: "Resume or cancel a pending manual action from a later user message that starts with /resume.",
    annotations: mediumWriteAnnotations,
    inputSchema: objectSchema({ resumeMessage: stringSchema({ minLength: 1, maxLength: 2000 }) }, ["resumeMessage"]),
    outputSchema: objectSchema({
      status: enumSchema(["confirmed", "cancelled", "verification_failed", "expired", "not_found", "blocked"]),
      hostRisk: hostRiskSchema(),
      code: enumSchema(["RESUME_COMMAND_REQUIRED"]),
      operationId: stringSchema(),
      pendingId: stringSchema(),
      preparedId: stringSchema(),
      reason: stringSchema(),
      outcome: enumSchema(["completed", "cancelled"]),
      verification: recordSchema(),
      evidence: recordSchema(),
      next: objectSchema({
        recommendedTools: stringArraySchema(),
        followUpPrompt: stringSchema(),
        mode: enumSchema(["await_resume_command", "resume_interrupted_workflow"]),
        verifyBeforeContinuing: booleanSchema(),
      }),
    }, ["status", "hostRisk", "verification", "next"]),
    examples: [{ name: "resume", args: { resumeMessage: "/resume manual-task" } }],
    instructionExample: { resumeMessage: "/resume manual-task" },
    docsSummary: "Validates the /resume control message, records optional log evidence, and verifies configured checks.",
    risk: "low",
  },
];
