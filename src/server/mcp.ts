import type { IncomingMessage, ServerResponse } from "node:http";

import type { OAuthStore } from "../auth/oauth-store.js";
import { requireBearerToken } from "../auth/token.js";
import { toolsList } from "../router/tools-list.js";
import type { ToolRouter } from "../router/tools-call.js";
import type { RegisteredTool } from "../upstream/registry.js";
import {
  BadRequestError,
  ForbiddenError,
  UnauthorizedError,
  WebvibeError,
} from "../util/errors.js";
import { failure, parseJsonRpcRequest, success, type JsonRpcRequest } from "../util/json-rpc.js";
import { readBody } from "./oauth.js";

export type McpHandlerOptions = {
  store: OAuthStore;
  registry: Map<string, RegisteredTool>;
  router: ToolRouter;
  publicBaseUrl: string;
};

export async function handleMcp(
  request: IncomingMessage,
  response: ServerResponse,
  options: McpHandlerOptions,
): Promise<void> {
  if (request.method !== "POST") {
    response.writeHead(405).end();
    return;
  }
  let caller;
  try {
    caller = await requireBearerToken(request, options.store);
  } catch {
    response.writeHead(401, {
      "www-authenticate": `Bearer resource_metadata="${options.publicBaseUrl}/.well-known/oauth-protected-resource"`,
    });
    response.end("Unauthorized");
    return;
  }
  const text = await readBody(request);
  const payload = JSON.parse(text);
  const requests = Array.isArray(payload) ? payload : [payload];
  const responses = [];
  for (const item of requests) {
    try {
      const rpc = parseJsonRpcRequest(item);
      const result = await handleMcpRequest(rpc, options, {
        clientId: caller.clientId,
        subject: caller.subject,
      });
      if (rpc.id !== undefined) responses.push(success(rpc.id, result));
    } catch (error) {
      const id =
        typeof item === "object" && item !== null && "id" in item ? (item as any).id : null;
      responses.push(toJsonRpcFailure(id, error));
    }
  }
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(Array.isArray(payload) ? responses : responses[0]));
}

async function handleMcpRequest(
  request: JsonRpcRequest,
  options: McpHandlerOptions,
  caller: { clientId?: string; subject?: string },
): Promise<unknown> {
  switch (request.method) {
    case "initialize":
      return {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "webvibe", version: "0.1.0" },
      };
    case "tools/list":
      return toolsList(options.registry);
    case "tools/call": {
      const params = normalizeToolCallParams(request.params);
      const result = await options.router.call(params.name, params.arguments, caller);
      return toToolResult(result);
    }
    case "notifications/initialized":
      return {};
    default:
      throw new BadRequestError(`Unsupported MCP method: ${request.method}`);
  }
}

function normalizeToolCallParams(params: unknown): {
  name: string;
  arguments: Record<string, unknown>;
} {
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    throw new BadRequestError("tools/call params must be object");
  }
  const record = params as Record<string, unknown>;
  if (typeof record.name !== "string") throw new BadRequestError("tools/call name is required");
  return {
    name: record.name,
    arguments:
      typeof record.arguments === "object" &&
      record.arguments !== null &&
      !Array.isArray(record.arguments)
        ? (record.arguments as Record<string, unknown>)
        : {},
  };
}

function toToolResult(result: unknown): unknown {
  if (typeof result === "object" && result !== null && Array.isArray((result as any).content)) {
    return result;
  }
  const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
  return {
    content: [{ type: "text", text }],
    structuredContent: result,
  };
}

function toJsonRpcFailure(id: any, error: unknown): unknown {
  if (error instanceof UnauthorizedError) return failure(id, -32001, error.message);
  if (error instanceof ForbiddenError) return failure(id, -32003, error.message);
  if (error instanceof BadRequestError) return failure(id, -32602, error.message);
  if (error instanceof WebvibeError) return failure(id, -32000, error.message);
  return failure(id, -32603, error instanceof Error ? error.message : String(error));
}
