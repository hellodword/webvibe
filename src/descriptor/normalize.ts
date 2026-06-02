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
  if (name === "relay.info") {
    return {
      type: "object",
      properties: {
        name: { type: "string" },
        mode: { type: "string", enum: ["read-only", "dev"] },
        tools: { type: "array", items: { type: "string" } },
      },
      required: ["name", "tools"],
      additionalProperties: false,
    };
  }
  if (name === "relay.list_upstreams") {
    return {
      type: "object",
      properties: {
        upstreams: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              healthy: { type: "boolean" },
              optional: { type: "boolean" },
              error: { type: "string" },
            },
            required: ["id", "healthy", "optional"],
            additionalProperties: false,
          },
        },
      },
      required: ["upstreams"],
      additionalProperties: false,
    };
  }
  if (name === "relay.list_tools") {
    return {
      type: "object",
      properties: {
        tools: {
          type: "array",
          items: { type: "object", additionalProperties: true },
        },
      },
      required: ["tools"],
      additionalProperties: false,
    };
  }
  return undefined;
}

function trimDescription(value: string): string {
  return value.length <= 2000 ? value : `${value.slice(0, 1997)}...`;
}
