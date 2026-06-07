import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { OAuthStore } from "../auth/oauth-store.js";
import type { PairingManager } from "../auth/pairing.js";
import { ManualArtifactStore, sanitizeFilename } from "../manual/artifact-store.js";
import { ManualPendingStore } from "../manual/pending-store.js";
import type { RelayPolicy } from "../policy/policy.js";
import { ToolRouter } from "../router/tools-call.js";
import { AuditLog } from "../state/audit.js";
import type { UpstreamManager } from "../upstream/manager.js";
import { buildRegistry, type RegisteredTool } from "../upstream/registry.js";
import { BadRequestError, ForbiddenError, NotFoundError, WebvibeError } from "../util/errors.js";
import { sha256 } from "../util/hash.js";
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
    options.policy.audit,
  );
  const router = new ToolRouter({
    registry,
    policy: options.policy,
    upstreams: options.upstreams,
    audit,
    workspaceRoot: options.workspaceRoot,
    stateDir: options.stateDir,
    publicBaseUrl: options.publicBaseUrl,
  });
  const oauth = new OAuthServer({
    publicBaseUrl: options.publicBaseUrl,
    store: options.store,
    pairing: options.pairing,
    accessTokenTtlDays: options.accessTokenTtlDays,
  });
  const server = createServer(async (request, response) => {
    try {
      await route(request, response, options, oauth, registry, router, audit);
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
  audit: AuditLog,
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
      audit,
    });
    return;
  }
  if (request.method === "GET" && url.pathname.startsWith("/manual-artifacts/")) {
    await handleManualArtifactDownload(request, response, url, options, audit);
    return;
  }
  if (request.method === "GET" && url.pathname.startsWith("/manual-gates/")) {
    await handleManualGateDetail(response, url, options, audit);
    return;
  }
  response.writeHead(404).end("Not found");
}

async function handleManualGateDetail(
  response: ServerResponse,
  url: URL,
  options: HttpServerOptions,
  audit: AuditLog,
): Promise<void> {
  const startedAt = Date.now();
  const pendingId = decodeURIComponent(url.pathname.slice("/manual-gates/".length));
  try {
    const confirmToken = url.searchParams.get("t") ?? "";
    if (!pendingId || !confirmToken) throw new ForbiddenError("Manual gate token is required");
    const store = new ManualPendingStore(options.stateDir);
    const record = await store.read(pendingId);
    if (!record) throw new NotFoundError("Manual gate not found");
    if (record.confirmTokenHash !== sha256(confirmToken)) {
      throw new ForbiddenError("Manual gate token was rejected");
    }
    if (Date.now() > Date.parse(record.expiresAt)) {
      record.status = "expired";
      record.events.push({ at: new Date().toISOString(), type: "expired" });
      await store.save(record);
      throw new ForbiddenError("Manual gate expired");
    }
    record.events.push({ at: new Date().toISOString(), type: "widget_opened" });
    await store.save(record);
    await audit.write({
      timestamp: new Date().toISOString(),
      event: "manual.gate.detail",
      operationId: record.operationId,
      preparedId: record.preparedId,
      pendingId,
      status: "ok",
      durationMs: Date.now() - startedAt,
      rawOutput: {
        reason: record.reason,
        artifactCount: record.artifacts.length,
        checkCount: record.checks.length,
      },
    });
    sendJsonNoStore(response, 200, {
      operationId: record.operationId,
      pendingId: record.pendingId,
      preparedId: record.preparedId,
      reason: record.reason,
      status: record.status,
      title: record.title,
      instructions: record.instructions,
      artifacts: record.artifacts,
      checks: record.checks,
      expiresAt: record.expiresAt,
    });
  } catch (error) {
    await audit.write({
      timestamp: new Date().toISOString(),
      event: "manual.gate.detail",
      pendingId,
      status: "error",
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function handleManualArtifactDownload(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  options: HttpServerOptions,
  audit: AuditLog,
): Promise<void> {
  const startedAt = Date.now();
  const artifactId = decodeURIComponent(url.pathname.slice("/manual-artifacts/".length));
  try {
    const store = new ManualArtifactStore(options.stateDir);
    const { record, data } = await store.openDownload(artifactId, url.searchParams.get("t"));
    await audit.write({
      timestamp: new Date().toISOString(),
      event: "manual.artifact.download",
      operationId: record.operationId,
      artifactId: record.artifactId,
      status: "ok",
      durationMs: Date.now() - startedAt,
      rawOutput: {
        filename: record.filename,
        mimeType: record.mimeType,
        sizeBytes: record.sizeBytes,
        remoteAddress: request.socket.remoteAddress,
      },
    });
    response.writeHead(200, {
      "content-type": record.mimeType,
      "content-disposition": `attachment; filename="${sanitizeFilename(record.filename)}"`,
      "cache-control": "no-store",
    });
    response.end(data);
  } catch (error) {
    await audit.write({
      timestamp: new Date().toISOString(),
      event: "manual.artifact.download",
      artifactId,
      status: "error",
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      rawOutput: { remoteAddress: request.socket.remoteAddress },
    });
    if (error instanceof BadRequestError) throw new NotFoundError("Manual artifact not found");
    throw error;
  }
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

function sendJsonNoStore(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}
