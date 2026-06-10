import {
  arraySchema,
  booleanSchema,
  enumSchema,
  hostRiskSchema,
  integerSchema,
  nullable,
  numberSchema,
  objectSchema,
  recordSchema,
  stringArraySchema,
  stringSchema,
} from "./schemas.js";
import type { JsonSchema } from "./types.js";

export const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
};

export const mediumWriteAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
};

export const destructiveAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: false,
};

export function rangeSchema(): JsonSchema {
  return objectSchema({
    startLine: integerSchema({ minimum: 1 }),
    endLine: integerSchema({ minimum: 1 }),
  });
}

export function readFileOutputItemSchema(): JsonSchema {
  return objectSchema(
    {
      path: stringSchema(),
      exists: booleanSchema(),
      type: enumSchema(["file", "directory", "symlink", "other"]),
      kind: enumSchema(["text", "binary"]),
      size: integerSchema({ minimum: 0 }),
      sha256: stringSchema(),
      offsetBytes: integerSchema({ minimum: 0 }),
      returnedBytes: integerSchema({ minimum: 0 }),
      nextOffsetBytes: integerSchema({ minimum: 0 }),
      returnedLines: integerSchema({ minimum: 0 }),
      format: enumSchema(["content", "lines"]),
      range: rangeSchema(),
      content: stringSchema(),
      lines: arraySchema(objectSchema({ line: integerSchema({ minimum: 1 }), text: stringSchema() })),
      truncated: booleanSchema(),
      error: stringSchema(),
    },
    ["path", "exists"],
  );
}

export function taskOutputSummarySchema(): JsonSchema {
  return objectSchema({
    head: stringSchema(),
    tail: stringSchema(),
    truncated: booleanSchema(),
    sha256: stringSchema(),
    bytes: integerSchema({ minimum: 0 }),
    logPath: stringSchema(),
  });
}

export function taskDiagnosticsSchema(): JsonSchema {
  return arraySchema(
    objectSchema(
      {
        path: stringSchema(),
        line: integerSchema({ minimum: 1 }),
        column: integerSchema({ minimum: 1 }),
        message: stringSchema(),
        severity: enumSchema(["error", "warning", "info"]),
      },
      ["path", "line", "message"],
    ),
  );
}

export function taskRunResultSchema(): JsonSchema {
  return objectSchema(
    {
      status: enumSchema(["running", "ok", "failed", "timeout", "unavailable"]),
      hostRisk: enumSchema(["medium"]),
      runId: stringSchema(),
      taskId: stringSchema(),
      exitCode: nullable(integerSchema()),
      stdout: taskOutputSummarySchema(),
      stderr: taskOutputSummarySchema(),
      diagnostics: taskDiagnosticsSchema(),
      durationMs: integerSchema({ minimum: 0 }),
      timeoutSeconds: integerSchema({ minimum: 0 }),
      effectiveCommand: objectSchema({
        executable: stringSchema(),
        args: stringArraySchema(),
        cwd: stringSchema(),
      }),
      checks: arraySchema(
        objectSchema(
          {
            kind: stringSchema(),
            name: stringSchema(),
            path: stringSchema(),
            ok: booleanSchema(),
            reason: stringSchema(),
          },
          ["kind", "ok"],
        ),
      ),
      cwd: stringSchema(),
      startedAt: stringSchema(),
      completedAt: stringSchema(),
      unavailableReason: stringSchema(),
      manualRequired: objectSchema({
        nextTool: enumSchema(["manual.gate"]),
        reason: enumSchema(["external_manual_step"]),
        userInstructions: stringSchema(),
        hostObservation: objectSchema({
          toolName: stringSchema(),
          outputText: stringSchema(),
        }),
      }),
      next: recordSchema(),
    },
    [
      "status",
      "hostRisk",
      "runId",
      "taskId",
      "exitCode",
      "stdout",
      "stderr",
      "diagnostics",
      "durationMs",
      "timeoutSeconds",
      "effectiveCommand",
      "checks",
      "next",
    ],
  );
}

export function gitCommonOutput(extra: Record<string, unknown> = {}, extraRequired: string[] = []): JsonSchema {
  return objectSchema(
    {
      status: enumSchema(["ok", "failed", "timeout", "unavailable"]),
      hostRisk: hostRiskSchema(),
      command: stringSchema(),
      exitCode: nullable(integerSchema()),
      stdout: stringSchema(),
      stderr: stringSchema(),
      durationMs: integerSchema({ minimum: 0 }),
      unavailableReason: stringSchema(),
      ...extra,
    },
    ["status", "hostRisk", "command", "exitCode", "stdout", "stderr", "durationMs", ...extraRequired],
  );
}

export function gitPaginationFields(): Record<string, unknown> {
  return {
    offsetBytes: integerSchema({ minimum: 0 }),
    returnedBytes: integerSchema({ minimum: 0 }),
    totalBytes: integerSchema({ minimum: 0 }),
    stdoutSha256: stringSchema({ pattern: "^sha256:[a-f0-9]{64}$" }),
    truncated: booleanSchema(),
    nextCursor: nullable(stringSchema()),
  };
}

export function changeHashSchema(): JsonSchema {
  return stringSchema({ pattern: "^sha256:[a-f0-9]{64}$" });
}

export function sha256Schema(): JsonSchema {
  return stringSchema({ pattern: "^[a-f0-9]{64}$" });
}

export function outputNumberSchema(): JsonSchema {
  return numberSchema();
}
