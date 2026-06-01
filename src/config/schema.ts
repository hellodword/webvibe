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

const inputPolicySchema = z
  .object({
    require: z.record(z.string(), z.unknown()).optional(),
    deny: z.record(z.string(), z.unknown()).optional(),
    requirePriorPreview: z
      .object({
        previewTool: z.string(),
        matchFields: z.array(z.string()),
        ttlSeconds: z.number().int().positive().optional(),
      })
      .optional(),
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
    steps: z.array(workflowStepSchema).min(1),
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
            transport: z.enum(["stdio", "streamable-http"]),
            command: z.string().optional(),
            args: z.array(z.string()).optional(),
            url: z.string().optional(),
            cwd: z.string().optional(),
            env: z.record(z.string(), z.string()).optional(),
            headers: z.record(z.string(), z.string()).optional(),
            optional: z.boolean().optional(),
            timeoutMs: z.number().int().positive().optional(),
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
      })
      .default({ maxToolOutputBytes: 60000, timeoutMs: 30000 }),
    audit: z
      .object({
        enabled: z.boolean().default(true),
      })
      .default({ enabled: true }),
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
