import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { OAuthStore } from "../auth/oauth-store.js";
import type { PairingManager } from "../auth/pairing.js";
import type { RelayPolicy } from "../policy/policy.js";
import { ToolRouter } from "../router/tools-call.js";
import { AuditLog } from "../state/audit.js";
import type { UpstreamManager } from "../upstream/manager.js";
import { buildRegistry, type RegisteredTool } from "../upstream/registry.js";
import { WebvibeError } from "../util/errors.js";
import { OAuthServer, sendJson } from "./oauth.js";
import { handleMcp } from "./mcp.js";

export type HttpServerOptions = {
  listen: { host: string; port: number };
  publicBaseUrl: string;
  workspaceRoot: string;
  stateDir: string;
  policy: RelayPolicy;
  upstreams: UpstreamManager;
  store: OAuthStore;
  pairing: PairingManager;
  accessTokenTtlDays: number;
};

export type WebvibeServer = {
  server: Server;
  registry: Map<string, RegisteredTool>;
  router: ToolRouter;
  close(): Promise<void>;
};

export async function startHttpServer(options: HttpServerOptions): Promise<WebvibeServer> {
  const registry = buildRegistry(options.policy, options.upstreams);
  const audit = new AuditLog(
    `${options.stateDir}/audit.log`,
    options.policy.audit.enabled,
    options.policy.audit.maxLogBytes,
  );
  const router = new ToolRouter({
    registry,
    policy: options.policy,
    upstreams: options.upstreams,
    audit,
    workspaceRoot: options.workspaceRoot,
    stateDir: options.stateDir,
  });
  const oauth = new OAuthServer({
    publicBaseUrl: options.publicBaseUrl,
    store: options.store,
    pairing: options.pairing,
    accessTokenTtlDays: options.accessTokenTtlDays,
  });
  const server = createServer(async (request, response) => {
    try {
      await route(request, response, options, oauth, registry, router);
    } catch (error) {
      sendError(response, error);
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.listen.port, options.listen.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return {
    server,
    registry,
    router,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  options: HttpServerOptions,
  oauth: OAuthServer,
  registry: Map<string, RegisteredTool>,
  router: ToolRouter,
): Promise<void> {
  const url = new URL(request.url ?? "/", options.publicBaseUrl);
  if (url.pathname === "/health") {
    sendJson(response, 200, { ok: true });
    return;
  }
  if (await oauth.handle(request, response, url)) return;
  if (url.pathname === "/mcp") {
    await handleMcp(request, response, {
      store: options.store,
      registry,
      router,
      publicBaseUrl: options.publicBaseUrl,
    });
    return;
  }
  response.writeHead(404).end("Not found");
}

function sendError(response: ServerResponse, error: unknown): void {
  if (response.headersSent) {
    response.end();
    return;
  }
  if (error instanceof WebvibeError) {
    sendJson(response, error.status, { error: error.code, message: error.message });
    return;
  }
  sendJson(response, 500, {
    error: "INTERNAL_ERROR",
    message: error instanceof Error ? error.message : String(error),
  });
}
