import { z } from "zod";

export const modeSchema = z.enum(["read-only", "dev"]);

export const annotationsSchema = z
  .object({
    title: z.string().optional(),
    readOnlyHint: z.boolean().optional(),
    destructiveHint: z.boolean().optional(),
    idempotentHint: z.boolean().optional(),
    openWorldHint: z.boolean().optional(),
  })
  .passthrough();

export const metaSchema = z.record(z.string(), z.unknown());

export const inputPolicySchema = z
  .object({
    require: z.record(z.string(), z.unknown()).optional(),
    deny: z.record(z.string(), z.unknown()).optional(),
    pathFields: z.array(z.string()).optional(),
    protectedPathPolicy: z.enum(["deny", "allow"]).optional(),
  })
  .passthrough();

export const builtInToolSchema = z
  .object({
    name: z.string(),
    type: z.literal("builtIn"),
    description: z.string().optional(),
    inputSchema: z.record(z.string(), z.unknown()).optional(),
    outputSchema: z.record(z.string(), z.unknown()).optional(),
    annotations: annotationsSchema.optional(),
    _meta: metaSchema.optional(),
  })
  .passthrough();

export const passThroughToolSchema = z
  .object({
    name: z.string(),
    type: z.literal("passThrough"),
    upstream: z.string(),
    upstreamTool: z.string(),
    optional: z.boolean().optional(),
    description: z.string().optional(),
    inputSchema: z.record(z.string(), z.unknown()).optional(),
    outputSchema: z.record(z.string(), z.unknown()).optional(),
    annotations: annotationsSchema.optional(),
    _meta: metaSchema.optional(),
    inputPolicy: inputPolicySchema.optional(),
    mapInput: z.unknown().optional(),
    mapOutput: z.unknown().optional(),
  })
  .passthrough();

export const workflowStepSchema = z
  .object({
    call: z.object({
      upstream: z.string(),
      tool: z.string(),
      input: z.unknown(),
    }),
    saveAs: z.string().optional(),
    optional: z.boolean().optional(),
  })
  .passthrough();

export const workflowToolSchema = z
  .object({
    name: z.string(),
    type: z.literal("workflow"),
    optional: z.boolean().optional(),
    description: z.string(),
    inputSchema: z.record(z.string(), z.unknown()),
    outputSchema: z.record(z.string(), z.unknown()).optional(),
    annotations: annotationsSchema.optional(),
    _meta: metaSchema.optional(),
    timeoutSeconds: z
      .object({
        default: z.number().int().positive(),
        maximum: z.number().int().positive(),
        bufferSeconds: z.number().int().positive().optional(),
      })
      .optional(),
    steps: z.array(workflowStepSchema).min(1),
  })
  .passthrough();

export const taskPolicySchema = z
  .object({
    executable: z.string(),
    args: z.array(z.string()).optional(),
    cwd: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
    defaultTimeoutSeconds: z.number().int().positive().optional(),
    maxTimeoutSeconds: z.number().int().positive().optional(),
    failOnStdout: z.boolean().optional(),
    allowExtraArgs: z.boolean().optional(),
    maxExtraArgs: z.number().int().positive().optional(),
    extraArgPattern: z.string().optional(),
    allowedExtraArgs: z.array(z.string()).optional(),
    description: z.string().optional(),
  })
  .passthrough();

export const toolPolicySchema = z.discriminatedUnion("type", [
  builtInToolSchema,
  passThroughToolSchema,
  workflowToolSchema,
]);

export const policySchema = z
  .object({
    version: z.literal(1),
    mode: modeSchema.optional(),
    extends: z.string().optional(),
    workspace: z
      .object({
        root: z.string(),
        protected: z.array(z.string()).default([]),
      })
      .default({ root: "${workspaceRoot}", protected: [] }),
    upstreams: z
      .record(
        z.string(),
        z
          .object({
            transport: z.enum(["stdio", "streamable-http", "local-task-runner"]),
            command: z.string().optional(),
            args: z.array(z.string()).optional(),
            url: z.string().optional(),
            cwd: z.string().optional(),
            env: z.record(z.string(), z.string()).optional(),
            headers: z.record(z.string(), z.string()).optional(),
            optional: z.boolean().optional(),
            timeoutMs: z.number().int().positive().optional(),
            tasks: z.record(z.string(), taskPolicySchema).optional(),
          })
          .passthrough(),
      )
      .default({}),
    tools: z.array(toolPolicySchema),
    limits: z
      .object({
        maxToolOutputBytes: z.number().int().positive().default(60000),
        timeoutMs: z.number().int().positive().default(30000),
        maxCallsPerMinute: z.number().int().positive().default(120),
        maxChangesetFiles: z.number().int().positive().default(80),
        maxChangesetBytes: z
          .number()
          .int()
          .positive()
          .default(5 * 1024 * 1024),
        maxChangesetFileBytes: z
          .number()
          .int()
          .positive()
          .default(1024 * 1024),
      })
      .default({
        maxToolOutputBytes: 60000,
        timeoutMs: 30000,
        maxCallsPerMinute: 120,
        maxChangesetFiles: 80,
        maxChangesetBytes: 5 * 1024 * 1024,
        maxChangesetFileBytes: 1024 * 1024,
      }),
    audit: z
      .object({
        enabled: z.boolean().default(true),
        maxLogBytes: z
          .number()
          .int()
          .positive()
          .default(10 * 1024 * 1024),
      })
      .default({ enabled: true, maxLogBytes: 10 * 1024 * 1024 }),
  })
  .passthrough();
