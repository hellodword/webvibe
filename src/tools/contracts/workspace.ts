import {
  readOnlyAnnotations,
} from "./common.js";
import {
  arraySchema,
  booleanSchema,
  emptyObjectSchema,
  enumSchema,
  hostRiskSchema,
  integerSchema,
  nextSchema,
  nullable,
  objectSchema,
  recordSchema,
  stringArraySchema,
  stringSchema,
} from "./schemas.js";
import type { ToolContract } from "./types.js";

const scanIncludeFields = {
  includeManifests: booleanSchema(),
  includeTaskFiles: booleanSchema(),
  includeConfigFiles: booleanSchema(),
  includeScripts: booleanSchema(),
  includeFrontend: booleanSchema(),
  includeCodegen: booleanSchema(),
  includeDatabase: booleanSchema(),
  includeWorkspaceCandidates: booleanSchema(),
};

const detectedFileSchema = objectSchema({
  path: stringSchema(),
  kind: stringSchema(),
});

export const workspaceContracts: ToolContract[] = [
  {
    name: "workspace.context",
    modes: ["read-only", "dev"],
    description: "Preflight context for ChatGPT Web coding. Call before workspace tools.",
    annotations: readOnlyAnnotations,
    inputSchema: emptyObjectSchema(),
    outputSchema: objectSchema({
      status: enumSchema(["ok"]),
      hostRisk: hostRiskSchema(),
      truncated: booleanSchema(),
      nextCursor: nullable(stringSchema()),
      toolSurface: objectSchema({
        version: stringSchema(),
        hash: stringSchema(),
        tools: stringArraySchema(),
      }),
      policy: objectSchema({
        profile: stringSchema(),
        hash: stringSchema(),
        effectiveLimits: recordSchema(),
      }),
      editMode: objectSchema({
        mode: enumSchema(["single", "batch"]),
        batchEnabled: booleanSchema(),
      }),
      validFor: recordSchema(),
      workspace: recordSchema(),
      capabilities: recordSchema(),
      hostConstraints: recordSchema(),
      hostRiskProfile: recordSchema(),
      project: recordSchema(),
      git: recordSchema(),
      tasks: recordSchema(),
      manualFallback: recordSchema(),
      upstreams: arraySchema(recordSchema()),
      warnings: stringArraySchema(),
      toolGuidance: objectSchema({
        recommendedFirstCalls: arraySchema(
          objectSchema({
            tool: stringSchema(),
            args: recordSchema(),
          }),
        ),
      }),
      next: nextSchema(),
    }),
    examples: [{ name: "preflight", args: {} }],
    instructionExample: {},
    docsSummary: "Returns the current policy, tool surface, host constraints, project/task summaries, and first-call guidance.",
    risk: "low",
  },
  {
    name: "workspace.scan",
    modes: ["read-only", "dev"],
    description: "Deep workspace scan for project manifests, languages, tools, task files, and codegen.",
    annotations: readOnlyAnnotations,
    inputSchema: objectSchema(
      {
        maxDepth: integerSchema({ minimum: 0, maximum: 12 }),
        maxEntries: integerSchema({ minimum: 1, maximum: 5000 }),
        ...scanIncludeFields,
      },
      [],
    ),
    outputSchema: objectSchema({
      status: enumSchema(["ok"]),
      hostRisk: hostRiskSchema(),
      root: enumSchema(["."]),
      project: recordSchema(),
      packageManagers: stringArraySchema(),
      languages: stringArraySchema(),
      frontend: arraySchema(detectedFileSchema),
      codegen: arraySchema(detectedFileSchema),
      taskFiles: arraySchema(detectedFileSchema),
      database: arraySchema(detectedFileSchema),
      workspaceCandidates: stringArraySchema(),
      truncated: booleanSchema(),
      nextCursor: nullable(stringSchema()),
      effectiveOptions: objectSchema({
        maxDepth: integerSchema({ minimum: 0 }),
        maxEntries: integerSchema({ minimum: 1 }),
        includeManifests: booleanSchema(),
        includeTaskFiles: booleanSchema(),
        includeConfigFiles: booleanSchema(),
        includeScripts: booleanSchema(),
        includeFrontend: booleanSchema(),
        includeCodegen: booleanSchema(),
        includeDatabase: booleanSchema(),
        includeWorkspaceCandidates: booleanSchema(),
      }),
      next: objectSchema({
        tool: enumSchema(["task.list"]),
        reason: stringSchema(),
      }),
    }),
    examples: [
      {
        name: "scan current workspace",
        args: {
          maxDepth: 6,
          maxEntries: 2000,
          includeManifests: true,
          includeTaskFiles: true,
          includeConfigFiles: true,
          includeScripts: true,
        },
      },
    ],
    instructionExample: { maxDepth: 6, maxEntries: 2000 },
    docsSummary: "Scans manifests, task/config files, frontend/codegen/database markers, and workspace candidates with explicit effective options.",
    risk: "low",
  },
  {
    name: "workspace.symbols",
    modes: ["read-only", "dev"],
    description: "Query workspace symbol definitions and imports.",
    annotations: readOnlyAnnotations,
    inputSchema: objectSchema(
      {
        query: stringSchema(),
        path: stringSchema(),
        kind: enumSchema(["class", "function", "method", "type", "interface", "const", "enum", "import"]),
        cursor: stringSchema(),
        maxResults: integerSchema({ minimum: 1, maximum: 1000 }),
      },
      [],
    ),
    outputSchema: objectSchema({
      status: enumSchema(["ok"]),
      hostRisk: hostRiskSchema(),
      symbols: arraySchema(
        objectSchema({
          name: stringSchema(),
          kind: enumSchema(["class", "function", "method", "type", "interface", "const", "enum", "import"]),
          path: stringSchema(),
          line: integerSchema({ minimum: 1 }),
          exported: booleanSchema(),
        }),
      ),
      imports: arraySchema(
        objectSchema({
          path: stringSchema(),
          source: stringSchema(),
          line: integerSchema({ minimum: 1 }),
        }),
      ),
      truncated: booleanSchema(),
      nextCursor: nullable(stringSchema()),
    }),
    examples: [{ name: "find router symbols", args: { path: "src/router/tools-call.ts", maxResults: 50 } }],
    instructionExample: { path: "src/router/tools-call.ts", maxResults: 50 },
    docsSummary: "Returns lightweight TypeScript/JavaScript declarations and imports for bounded symbol discovery.",
    risk: "low",
  },
];
