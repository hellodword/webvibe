import { z } from "zod";

export const modeSchema = z.enum(["read-only", "dev"]);

const annotationsSchema = z
  .object({
    title: z.string().optional(),
    readOnlyHint: z.boolean().optional(),
    destructiveHint: z.boolean().optional(),
    idempotentHint: z.boolean().optional(),
    openWorldHint: z.boolean().optional(),
  })
  .passthrough();

const metaSchema = z.record(z.string(), z.unknown());

const inputPolicySchema = z
  .object({
    require: z.record(z.string(), z.unknown()).optional(),
    deny: z.record(z.string(), z.unknown()).optional(),
    pathFields: z.array(z.string()).optional(),
    protectedPathPolicy: z.enum(["deny", "allow"]).optional(),
  })
  .passthrough();

const builtInToolSchema = z
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

const passThroughToolSchema = z
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

const workflowStepSchema = z
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

const workflowToolSchema = z
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

const taskPolicySchema = z
  .object({
    executable: z.string(),
    args: z.array(z.string()).optional(),
    cwd: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
    requiredFiles: z.array(z.string()).optional(),
    requiredPackageScript: z.string().optional(),
    defaultTimeoutSeconds: z.number().int().positive().optional(),
    maxTimeoutSeconds: z.number().int().positive().optional(),
    failOnStdout: z.boolean().optional(),
    description: z.string().optional(),
  })
  .passthrough();

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
    tools: z.array(
      z.discriminatedUnion("type", [builtInToolSchema, passThroughToolSchema, workflowToolSchema]),
    ),
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

export const appConfigSchema = z
  .object({
    version: z.literal(1).default(1),
    server: z
      .object({
        listen: z.string().default("127.0.0.1:3000"),
        publicBaseUrl: z.string().optional(),
        stateDir: z.string().default("~/.webvibe"),
        mode: modeSchema.default("read-only"),
      })
      .default({ listen: "127.0.0.1:3000", stateDir: "~/.webvibe", mode: "read-only" }),
    workspace: z
      .object({
        root: z.string().default("."),
      })
      .default({ root: "." }),
    auth: z
      .object({
        pairingCode: z.string().optional(),
        pairingCodeFile: z.string().optional(),
        accessTokenTtlDays: z.number().int().positive().default(30),
      })
      .default({ accessTokenTtlDays: 30 }),
    policy: z
      .object({
        readOnly: z.string().optional(),
        dev: z.string().optional(),
        path: z.string().optional(),
      })
      .default({}),
  })
  .passthrough();

export type AppConfigInput = z.input<typeof appConfigSchema>;
export type AppConfig = z.output<typeof appConfigSchema>;
