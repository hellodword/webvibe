import { mergeAnnotations } from "./annotations.js";
import { capSchemaDepth } from "./schema-rewrite.js";
import type { ToolPolicy } from "../policy/policy.js";

export type McpToolDescriptor = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
};

export function normalizeDescriptor(
  policyTool: ToolPolicy,
  upstreamDescriptor?: McpToolDescriptor,
): McpToolDescriptor {
  const description = policyTool.description ?? upstreamDescriptor?.description ?? policyTool.name;
  const inputSchema =
    "inputSchema" in policyTool && policyTool.inputSchema
      ? policyTool.inputSchema
      : (upstreamDescriptor?.inputSchema ?? { type: "object", additionalProperties: false });
  const outputSchema =
    "outputSchema" in policyTool && policyTool.outputSchema
      ? policyTool.outputSchema
      : (upstreamDescriptor?.outputSchema ??
        (policyTool.type === "builtIn" ? builtInOutputSchema(policyTool.name) : undefined));
  const annotations = mergeAnnotations(upstreamDescriptor?.annotations, policyTool.annotations);

  return {
    name: policyTool.name,
    title: annotations.title ?? upstreamDescriptor?.title ?? policyTool.name,
    description: trimDescription(description),
    inputSchema: capSchemaDepth(inputSchema) as Record<string, unknown>,
    ...(outputSchema
      ? { outputSchema: capSchemaDepth(outputSchema) as Record<string, unknown> }
      : {}),
    annotations,
    _meta: {
      ...upstreamDescriptor?._meta,
      ...policyTool._meta,
      securitySchemes: [{ type: "oauth2", scopes: [] }],
    },
  };
}

function builtInOutputSchema(name: string): Record<string, unknown> | undefined {
  if (name === "context.get" || name === "diagnostics.health") {
    return {
      type: "object",
      additionalProperties: true,
    };
  }
  return undefined;
}

function trimDescription(value: string): string {
  return value.length <= 2000 ? value : `${value.slice(0, 1997)}...`;
}
