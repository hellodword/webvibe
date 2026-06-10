import type { ToolAnnotations } from "../../policy/policy.js";

export type ToolMode = "read-only" | "dev";
export type ToolRisk = "low" | "medium" | "high";
export type JsonSchema = Record<string, unknown>;

export type ToolExample = {
  name: string;
  args: Record<string, unknown>;
  mode?: ToolMode;
  fixture?: string;
  expect?: Record<string, unknown>;
};

export type ToolContract = {
  name: string;
  modes: ToolMode[];
  description: string;
  annotations: ToolAnnotations;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  examples: ToolExample[];
  instructionExample?: Record<string, unknown>;
  docsSummary: string;
  risk: ToolRisk;
};
