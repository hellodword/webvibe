import { z } from "zod";

export const modeSchema = z.enum(["read-only", "dev"]);

export const defaultLimits = {
  output: {
    preferredToolOutputBytes: 12000,
    maxToolOutputBytes: 60000,
  },
  http: {
    oauthMaxBodyBytes: 1024 * 1024,
    mcpMaxBodyBytes: 16 * 1024 * 1024,
  },
  tree: {
    defaultMaxEntries: 300,
    maxEntries: 5000,
    maxDepth: 12,
  },
  search: {
    engine: "rg" as const,
    defaultMaxResults: 80,
    maxResults: 1000,
    maxColumns: 300,
    maxContextLines: 5,
    maxScannedBytesPerFile: null as number | null,
  },
  read: {
    defaultMaxBytes: 12000,
    maxBytes: 128 * 1024,
    maxReadManyFiles: 50,
  },
  change: {
    maxFiles: 1000,
    defaultMaxFiles: 200,
    maxTotalBytes: 16 * 1024 * 1024,
    maxTextFileBytes: 2 * 1024 * 1024,
    maxInlineDiffBytes: 12288,
    maxInlineDiffLines: 200,
  },
  task: {
    defaultTimeoutSeconds: 300,
    maxTimeoutSeconds: 3600,
    outputHeadBytes: 12000,
    outputTailBytes: 12000,
  },
  manual: {
    ttlSeconds: 86400,
    manualMessageMaxBytes: 65536,
  },
  rate: {
    maxCallsPerMinute: 120,
  },
} satisfies Record<string, Record<string, unknown>>;

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
    pathFields: z.array(z.string()).min(1).optional(),
    noPathInput: z.boolean().optional(),
    protectedPathPolicy: z.enum(["deny", "allow"]).default("deny"),
  })
  .passthrough()
  .superRefine((policy, context) => {
    if (!policy.noPathInput && !policy.pathFields?.length) {
      context.addIssue({
        code: "custom",
        message: "inputPolicy must declare pathFields or noPathInput",
        path: ["pathFields"],
      });
    }
  });

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
    inputPolicy: inputPolicySchema,
    mapInput: z.unknown().optional(),
    mapOutput: z.unknown().optional(),
  })
  .passthrough();

export const workflowStepSchema = z
  .object({
    call: z
      .object({
        upstream: z.string(),
        tool: z.string(),
        input: z.unknown(),
      })
      .strict(),
    saveAs: z.string().optional(),
    optional: z.boolean().optional(),
  })
  .strict();

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
    requiredPackageScript: z.string().optional(),
    requiredFiles: z.array(z.string()).optional(),
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

const positiveInteger = z.number().int().positive();

export const defaultHostRisk = {
  rawShellShape: "manualFirst",
  unknownTask: "manualFirst",
  largeDiffBytes: defaultLimits.change.maxInlineDiffBytes,
  deleteFileCount: 3,
} as const;

export const hostRiskSchema = z
  .object({
    rawShellShape: z.enum(["manualFirst"]).default(defaultHostRisk.rawShellShape),
    unknownTask: z.enum(["manualFirst"]).default(defaultHostRisk.unknownTask),
    largeDiffBytes: positiveInteger.default(defaultHostRisk.largeDiffBytes),
    deleteFileCount: positiveInteger.default(defaultHostRisk.deleteFileCount),
  })
  .strict();

export const taskCatalogResolverSchema = z.enum([
  "nodeScript",
  "nodeScriptOrTool",
  "manifestCommand",
  "taskFileTarget",
  "codegenTool",
]);

export const taskCatalogEntrySchema = z
  .object({
    family: z.string(),
    intent: z.string(),
    resolver: taskCatalogResolverSchema,
    scriptNames: z.array(z.string()).optional(),
    taskIds: z.array(z.string()).optional(),
    taskFiles: z.array(z.string()).optional(),
    fallbackTools: z
      .array(
        z
          .object({
            executable: z.string(),
            args: z.array(z.string()).default([]),
            requiredFiles: z.array(z.string()).optional(),
          })
          .strict(),
      )
      .optional(),
    hostRisk: z.enum(["low", "medium", "high"]).default("medium"),
    description: z.string().optional(),
  })
  .strict();

export const taskCatalogSchema = z.record(z.string(), taskCatalogEntrySchema).default({});

export const outputLimitsSchema = z
  .object({
    preferredToolOutputBytes: positiveInteger.default(defaultLimits.output.preferredToolOutputBytes),
    maxToolOutputBytes: positiveInteger.default(defaultLimits.output.maxToolOutputBytes),
  })
  .strict()
  .superRefine((limits, context) => {
    if (limits.preferredToolOutputBytes > limits.maxToolOutputBytes) {
      context.addIssue({
        code: "custom",
        message: "preferredToolOutputBytes must be <= maxToolOutputBytes",
        path: ["preferredToolOutputBytes"],
      });
    }
  });

export const httpLimitsSchema = z
  .object({
    oauthMaxBodyBytes: positiveInteger.default(defaultLimits.http.oauthMaxBodyBytes),
    mcpMaxBodyBytes: positiveInteger.default(defaultLimits.http.mcpMaxBodyBytes),
  })
  .strict();

export const treeLimitsSchema = z
  .object({
    defaultMaxEntries: positiveInteger.default(defaultLimits.tree.defaultMaxEntries),
    maxEntries: positiveInteger.default(defaultLimits.tree.maxEntries),
    maxDepth: z.number().int().min(0).default(defaultLimits.tree.maxDepth),
  })
  .strict()
  .superRefine((limits, context) => {
    if (limits.defaultMaxEntries > limits.maxEntries) {
      context.addIssue({
        code: "custom",
        message: "defaultMaxEntries must be <= maxEntries",
        path: ["defaultMaxEntries"],
      });
    }
  });

export const searchLimitsSchema = z
  .object({
    engine: z.enum(["rg", "js"]).default(defaultLimits.search.engine),
    defaultMaxResults: positiveInteger.default(defaultLimits.search.defaultMaxResults),
    maxResults: positiveInteger.default(defaultLimits.search.maxResults),
    maxColumns: positiveInteger.default(defaultLimits.search.maxColumns),
    maxContextLines: z.number().int().min(0).default(defaultLimits.search.maxContextLines),
    maxScannedBytesPerFile: positiveInteger.nullable().default(
      defaultLimits.search.maxScannedBytesPerFile,
    ),
  })
  .strict()
  .superRefine((limits, context) => {
    if (limits.defaultMaxResults > limits.maxResults) {
      context.addIssue({
        code: "custom",
        message: "defaultMaxResults must be <= maxResults",
        path: ["defaultMaxResults"],
      });
    }
  });

export const readLimitsSchema = z
  .object({
    defaultMaxBytes: positiveInteger.default(defaultLimits.read.defaultMaxBytes),
    maxBytes: positiveInteger.default(defaultLimits.read.maxBytes),
    maxReadManyFiles: positiveInteger.default(defaultLimits.read.maxReadManyFiles),
  })
  .strict()
  .superRefine((limits, context) => {
    if (limits.defaultMaxBytes > limits.maxBytes) {
      context.addIssue({
        code: "custom",
        message: "defaultMaxBytes must be <= maxBytes",
        path: ["defaultMaxBytes"],
      });
    }
  });

export const changeLimitsSchema = z
  .object({
    maxFiles: positiveInteger.default(defaultLimits.change.maxFiles),
    defaultMaxFiles: positiveInteger.default(defaultLimits.change.defaultMaxFiles),
    maxTotalBytes: positiveInteger.default(defaultLimits.change.maxTotalBytes),
    maxTextFileBytes: positiveInteger.default(defaultLimits.change.maxTextFileBytes),
    maxInlineDiffBytes: positiveInteger.default(defaultLimits.change.maxInlineDiffBytes),
    maxInlineDiffLines: positiveInteger.default(defaultLimits.change.maxInlineDiffLines),
  })
  .strict()
  .superRefine((limits, context) => {
    if (limits.defaultMaxFiles > limits.maxFiles) {
      context.addIssue({
        code: "custom",
        message: "defaultMaxFiles must be <= maxFiles",
        path: ["defaultMaxFiles"],
      });
    }
  });

export const taskLimitsSchema = z
  .object({
    defaultTimeoutSeconds: positiveInteger.default(defaultLimits.task.defaultTimeoutSeconds),
    maxTimeoutSeconds: positiveInteger.default(defaultLimits.task.maxTimeoutSeconds),
    outputHeadBytes: positiveInteger.default(defaultLimits.task.outputHeadBytes),
    outputTailBytes: positiveInteger.default(defaultLimits.task.outputTailBytes),
  })
  .strict()
  .superRefine((limits, context) => {
    if (limits.defaultTimeoutSeconds > limits.maxTimeoutSeconds) {
      context.addIssue({
        code: "custom",
        message: "defaultTimeoutSeconds must be <= maxTimeoutSeconds",
        path: ["defaultTimeoutSeconds"],
      });
    }
  });

export const manualLimitsSchema = z
  .object({
    ttlSeconds: positiveInteger.default(defaultLimits.manual.ttlSeconds),
    manualMessageMaxBytes: positiveInteger.default(defaultLimits.manual.manualMessageMaxBytes),
  })
  .strict();

export const rateLimitsSchema = z
  .object({
    maxCallsPerMinute: positiveInteger.default(defaultLimits.rate.maxCallsPerMinute),
  })
  .strict();

export const limitsPolicySchema = z
  .object({
    output: outputLimitsSchema.default(defaultLimits.output),
    http: httpLimitsSchema.default(defaultLimits.http),
    tree: treeLimitsSchema.default(defaultLimits.tree),
    search: searchLimitsSchema.default(defaultLimits.search),
    read: readLimitsSchema.default(defaultLimits.read),
    change: changeLimitsSchema.default(defaultLimits.change),
    task: taskLimitsSchema.default(defaultLimits.task),
    manual: manualLimitsSchema.default(defaultLimits.manual),
    rate: rateLimitsSchema.default(defaultLimits.rate),
  })
  .strict();

export const limitsOverrideSchema = z
  .object({
    output: z
      .object({
        preferredToolOutputBytes: positiveInteger.optional(),
        maxToolOutputBytes: positiveInteger.optional(),
      })
      .strict()
      .optional(),
    http: z
      .object({
        oauthMaxBodyBytes: positiveInteger.optional(),
        mcpMaxBodyBytes: positiveInteger.optional(),
      })
      .strict()
      .optional(),
    tree: z
      .object({
        defaultMaxEntries: positiveInteger.optional(),
        maxEntries: positiveInteger.optional(),
        maxDepth: z.number().int().min(0).optional(),
      })
      .strict()
      .optional(),
    search: z
      .object({
        engine: z.enum(["rg", "js"]).optional(),
        defaultMaxResults: positiveInteger.optional(),
        maxResults: positiveInteger.optional(),
        maxColumns: positiveInteger.optional(),
        maxContextLines: z.number().int().min(0).optional(),
        maxScannedBytesPerFile: positiveInteger.nullable().optional(),
      })
      .strict()
      .optional(),
    read: z
      .object({
        defaultMaxBytes: positiveInteger.optional(),
        maxBytes: positiveInteger.optional(),
        maxReadManyFiles: positiveInteger.optional(),
      })
      .strict()
      .optional(),
    change: z
      .object({
        maxFiles: positiveInteger.optional(),
        defaultMaxFiles: positiveInteger.optional(),
        maxTotalBytes: positiveInteger.optional(),
        maxTextFileBytes: positiveInteger.optional(),
        maxInlineDiffBytes: positiveInteger.optional(),
        maxInlineDiffLines: positiveInteger.optional(),
      })
      .strict()
      .optional(),
    task: z
      .object({
        defaultTimeoutSeconds: positiveInteger.optional(),
        maxTimeoutSeconds: positiveInteger.optional(),
        outputHeadBytes: positiveInteger.optional(),
        outputTailBytes: positiveInteger.optional(),
      })
      .strict()
      .optional(),
    manual: z
      .object({
        ttlSeconds: positiveInteger.optional(),
        manualMessageMaxBytes: positiveInteger.optional(),
      })
      .strict()
      .optional(),
    rate: z
      .object({
        maxCallsPerMinute: positiveInteger.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const taskBundlesSchema = z
  .record(z.string(), z.unknown())
  .default({});

export const editModeSchema = z
  .object({
    mode: z.enum(["single", "batch"]).default("single"),
    batch: z
      .object({
        enabled: z.boolean().default(false),
      })
      .strict()
      .default({ enabled: false }),
  })
  .strict();

export const profileSchema = z
  .object({
    limits: limitsOverrideSchema.optional(),
    taskBundles: taskBundlesSchema.optional(),
  })
  .passthrough();

export const policyInputSchema = z
  .object({
    version: z.literal(3),
    profile: z.string().default("chatgptWebDefault"),
    mode: modeSchema.optional(),
    extends: z.string().optional(),
    workspace: z
      .object({
        root: z.string(),
        protected: z.array(z.string()).default([]),
      })
      .default({ root: "${workspaceRoot}", protected: [] }),
    profiles: z.record(z.string(), profileSchema).default({}),
    taskBundles: taskBundlesSchema.optional(),
    editMode: editModeSchema.default({ mode: "single", batch: { enabled: false } }),
    hostRisk: hostRiskSchema.optional(),
    taskCatalog: taskCatalogSchema.optional(),
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
            timeoutMs: positiveInteger.optional(),
            tasks: z.record(z.string(), taskPolicySchema).optional(),
          })
          .passthrough(),
      )
      .default({}),
    tools: z.array(toolPolicySchema),
    limits: limitsOverrideSchema.default({}),
    audit: z
      .object({
        enabled: z.boolean().default(true),
        maxLogBytes: positiveInteger.default(10 * 1024 * 1024),
        payloads: z.enum(["hash-only", "full-redacted"]).default("hash-only"),
        includeClientVisibleOutput: z.boolean().default(false),
        includeRawToolOutput: z.boolean().default(false),
        includeErrors: z.boolean().default(true),
        includeErrorStack: z.boolean().default(false),
        includeManualEvents: z.boolean().default(true),
        redact: z.boolean().default(true),
      })
      .default({
        enabled: true,
        maxLogBytes: 10 * 1024 * 1024,
        payloads: "hash-only",
        includeClientVisibleOutput: false,
        includeRawToolOutput: false,
        includeErrors: true,
        includeErrorStack: false,
        includeManualEvents: true,
        redact: true,
      }),
  })
  .passthrough();

export const policySchema = z
  .object({
    version: z.literal(3),
    profile: z.string(),
    activeProfile: z.string(),
    mode: modeSchema.optional(),
    extends: z.string().optional(),
    workspace: z
      .object({
        root: z.string(),
        protected: z.array(z.string()).default([]),
      })
      .default({ root: "${workspaceRoot}", protected: [] }),
    profiles: z.record(z.string(), profileSchema),
    taskBundles: taskBundlesSchema.optional(),
    editMode: editModeSchema.default({ mode: "single", batch: { enabled: false } }),
    hostRisk: hostRiskSchema.default(defaultHostRisk),
    taskCatalog: taskCatalogSchema,
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
            timeoutMs: positiveInteger.optional(),
            tasks: z.record(z.string(), taskPolicySchema).optional(),
          })
          .passthrough(),
      )
      .default({}),
    tools: z.array(toolPolicySchema),
    limits: limitsPolicySchema,
    audit: z
      .object({
        enabled: z.boolean().default(true),
        maxLogBytes: z
          .number()
          .int()
          .positive()
          .default(10 * 1024 * 1024),
        payloads: z.enum(["hash-only", "full-redacted"]).default("hash-only"),
        includeClientVisibleOutput: z.boolean().default(false),
        includeRawToolOutput: z.boolean().default(false),
        includeErrors: z.boolean().default(true),
        includeErrorStack: z.boolean().default(false),
        includeManualEvents: z.boolean().default(true),
        redact: z.boolean().default(true),
      })
      .default({
        enabled: true,
        maxLogBytes: 10 * 1024 * 1024,
        payloads: "hash-only",
        includeClientVisibleOutput: false,
        includeRawToolOutput: false,
        includeErrors: true,
        includeErrorStack: false,
        includeManualEvents: true,
        redact: true,
      }),
  })
  .passthrough();
