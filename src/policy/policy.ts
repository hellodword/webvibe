export type Mode = "read-only" | "dev";

export type JsonSchema = Record<string, unknown>;

export type ToolAnnotations = {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

export type UpstreamPolicy = {
  transport: "stdio" | "streamable-http";
  command?: string;
  args?: string[];
  url?: string;
  cwd?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  optional?: boolean;
  timeoutMs?: number;
};

export type InputPolicy = {
  require?: Record<string, unknown>;
  deny?: Record<string, unknown>;
  requirePriorPreview?: {
    previewTool: string;
    matchFields: string[];
    ttlSeconds?: number;
  };
  pathFields?: string[];
  protectedPathPolicy?: "deny" | "allow";
};

export type BuiltInToolPolicy = {
  name: string;
  type: "builtIn";
  description?: string;
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
  annotations?: ToolAnnotations;
};

export type PassThroughToolPolicy = {
  name: string;
  type: "passThrough";
  upstream: string;
  upstreamTool: string;
  optional?: boolean;
  description?: string;
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
  annotations?: ToolAnnotations;
  inputPolicy?: InputPolicy;
  mapInput?: unknown;
  mapOutput?: unknown;
};

export type WorkflowStep = {
  call: {
    upstream: string;
    tool: string;
    input: unknown;
  };
  saveAs?: string;
  optional?: boolean;
};

export type WorkflowToolPolicy = {
  name: string;
  type: "workflow";
  optional?: boolean;
  description: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  annotations?: ToolAnnotations;
  steps: WorkflowStep[];
};

export type ToolPolicy = BuiltInToolPolicy | PassThroughToolPolicy | WorkflowToolPolicy;

export type WorkspacePolicy = {
  root: string;
  protected: string[];
};

export type LimitsPolicy = {
  maxToolOutputBytes: number;
  timeoutMs: number;
  maxCallsPerMinute: number;
};

export type AuditPolicy = {
  enabled: boolean;
  maxLogBytes: number;
};

export type RelayPolicy = {
  version: 1;
  mode?: Mode;
  extends?: string;
  workspace: WorkspacePolicy;
  upstreams: Record<string, UpstreamPolicy>;
  tools: ToolPolicy[];
  limits: LimitsPolicy;
  audit: AuditPolicy;
};

export const BUILT_IN_TOOLS = ["relay.info", "relay.list_upstreams", "relay.list_tools"] as const;

export type BuiltInToolName = (typeof BUILT_IN_TOOLS)[number];

export function isBuiltInToolName(name: string): name is BuiltInToolName {
  return (BUILT_IN_TOOLS as readonly string[]).includes(name);
}
