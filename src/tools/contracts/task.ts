import {
  destructiveAnnotations,
  readOnlyAnnotations,
  taskRunResultSchema,
} from "./common.js";
import {
  arraySchema,
  booleanSchema,
  emptyObjectSchema,
  enumSchema,
  hostRiskSchema,
  integerSchema,
  nextSchema,
  objectSchema,
  recordSchema,
  stringSchema,
} from "./schemas.js";
import type { ToolContract } from "./types.js";

const taskIdSchema = stringSchema({ minLength: 1, maxLength: 200 });

export const taskContracts: ToolContract[] = [
  {
    name: "task.list",
    modes: ["dev"],
    description: "List available and unavailable policy-defined tasks.",
    annotations: readOnlyAnnotations,
    inputSchema: emptyObjectSchema(),
    outputSchema: objectSchema({
      status: enumSchema(["ok"]),
      hostRisk: hostRiskSchema(),
      tasks: objectSchema({
        available: arraySchema(recordSchema()),
        unavailable: arraySchema(recordSchema()),
        candidates: arraySchema(recordSchema()),
      }),
      truncated: booleanSchema(),
      nextCursor: { anyOf: [stringSchema(), { type: "null" }] },
      next: nextSchema(),
    }),
    examples: [{ name: "list tasks", args: {} }],
    instructionExample: {},
    docsSummary: "Returns configured task availability, resolver checks, unavailable reasons, and candidates.",
    risk: "low",
  },
  {
    name: "task.explain",
    modes: ["dev"],
    description: "Explain resolver checks and next route for one taskId or candidate task id.",
    annotations: readOnlyAnnotations,
    inputSchema: objectSchema({ taskId: taskIdSchema }, ["taskId"]),
    outputSchema: objectSchema({
      status: enumSchema(["available", "unavailable", "candidate", "manualFirst"]),
      hostRisk: hostRiskSchema(),
      taskId: stringSchema(),
      task: recordSchema(),
      decision: stringSchema(),
      next: recordSchema(),
    }, ["status", "hostRisk", "taskId", "decision", "next"]),
    examples: [{ name: "explain test", args: { taskId: "node.test" } }],
    instructionExample: { taskId: "node.test" },
    docsSummary: "Explains whether a task ID is runnable, unavailable, candidate-only, or manual-first.",
    risk: "low",
  },
  {
    name: "task.run",
    modes: ["dev"],
    description: "Run one policy-defined local task by taskId. No free-form command input.",
    annotations: destructiveAnnotations,
    inputSchema: objectSchema(
      {
        taskId: stringSchema({ minLength: 1, maxLength: 100 }),
        timeoutSeconds: integerSchema({ minimum: 1, maximum: 36000 }),
        extra: objectSchema(
          {
            packages: arraySchema(stringSchema(), { maxItems: 20 }),
            modules: arraySchema(stringSchema(), { maxItems: 20 }),
            dev: booleanSchema(),
          },
          [],
        ),
        cwd: stringSchema({ minLength: 1, maxLength: 500 }),
        mode: enumSchema(["foreground", "background"]),
      },
      ["taskId"],
    ),
    outputSchema: taskRunResultSchema(),
    examples: [{ name: "run test", args: { taskId: "node.test" } }],
    instructionExample: { taskId: "node.test" },
    docsSummary: "Runs only configured or policy-allowed candidate task IDs and returns bounded log summaries.",
    risk: "medium",
  },
  {
    name: "task.result",
    modes: ["dev"],
    description: "Read task run status and log summaries by runId.",
    annotations: readOnlyAnnotations,
    inputSchema: objectSchema({ runId: stringSchema({ minLength: 1 }) }, ["runId"]),
    outputSchema: taskRunResultSchema(),
    examples: [{ name: "read task result", args: { runId: "tr_example" } }],
    instructionExample: { runId: "tr_example" },
    docsSummary: "Reads a foreground or background task record by runId.",
    risk: "low",
  },
];
