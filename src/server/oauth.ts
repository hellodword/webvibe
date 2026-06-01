import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";

import type { PairingManager } from "../auth/pairing.js";
import { DEFAULT_SCOPES } from "../auth/scopes.js";
import type { OAuthStore } from "../auth/oauth-store.js";
import { randomToken } from "../util/hash.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "../util/errors.js";
import { authorizationServerMetadata, protectedResourceMetadata } from "./metadata.js";

type AuthorizationCode = {
  code: string;
  clientId: string;
  redirectUri: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  expiresAt: number;
  subject: string;
};

export class OAuthServer {
  private codes = new Map<string, AuthorizationCode>();

  constructor(
    private readonly options: {
      publicBaseUrl: string;
      store: OAuthStore;
      pairing: PairingManager;
      accessTokenTtlDays: number;
    },
  ) {}

  async handle(request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> {
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      sendJson(response, 200, authorizationServerMetadata(this.options.publicBaseUrl));
      return true;
    }
    if (url.pathname === "/.well-known/oauth-protected-resource") {
      sendJson(response, 200, protectedResourceMetadata(this.options.publicBaseUrl));
      return true;
    }
    if (url.pathname === "/oauth/register" && request.method === "POST") {
      await this.register(request, response);
      return true;
    }
    if (url.pathname === "/oauth/authorize" && request.method === "GET") {
      await this.authorizeGet(request, response, url);
      return true;
    }
    if (url.pathname === "/oauth/authorize" && request.method === "POST") {
      await this.authorizePost(request, response);
      return true;
    }
    if (url.pathname === "/oauth/token" && request.method === "POST") {
      await this.token(request, response);
      return true;
    }
    return false;
  }

  private async register(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await readBodyAsJson(request);
    const redirectUris = Array.isArray(body.redirect_uris)
      ? body.redirect_uris.filter((item): item is string => typeof item === "string")
      : [];
    if (redirectUris.length === 0) throw new BadRequestError("redirect_uris is required");
    const client = {
      client_id: randomToken(18),
      client_secret: randomToken(24),
      redirect_uris: redirectUris,
      client_name: typeof body.client_name === "string" ? body.client_name : undefined,
      createdAt: new Date().toISOString(),
    };
    await this.options.store.saveClient(client);
    sendJson(response, 201, {
      ...client,
      token_endpoint_auth_method: "client_secret_post",
      grant_types: ["authorization_code"],
      response_types: ["code"],
    });
  }

  private async authorizeGet(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<void> {
    if (url.searchParams.has("pairing_code")) {
      await this.completeAuthorize(
        request,
        response,
        Object.fromEntries(url.searchParams.entries()),
      );
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(renderAuthorizeForm(url));
  }

  private async authorizePost(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await readBodyAsForm(request);
    await this.completeAuthorize(request, response, body);
  }

  private async completeAuthorize(
    request: IncomingMessage,
    response: ServerResponse,
    params: Record<string, string>,
  ): Promise<void> {
    if (params.response_type !== "code") throw new BadRequestError("response_type must be code");
    const client = this.options.store.getClient(params.client_id);
    if (!client) throw new NotFoundError("Unknown client_id");
    if (!client.redirect_uris.includes(params.redirect_uri)) {
      throw new ForbiddenError("redirect_uri is not registered");
    }
    this.options.pairing.verify(params.pairing_code, request.socket.remoteAddress ?? "unknown");
    const code = randomToken(24);
    this.codes.set(code, {
      code,
      clientId: client.client_id,
      redirectUri: params.redirect_uri,
      codeChallenge: params.code_challenge,
      codeChallengeMethod: params.code_challenge_method,
      expiresAt: Date.now() + 5 * 60_000,
      subject: "local-user",
    });
    const redirect = new URL(params.redirect_uri);
    redirect.searchParams.set("code", code);
    if (params.state) redirect.searchParams.set("state", params.state);
    response.writeHead(302, { location: redirect.toString() });
    response.end();
  }

  private async token(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await readBodyAsFormOrJson(request);
    if (body.grant_type !== "authorization_code")
      throw new BadRequestError("unsupported grant_type");
    const code = this.codes.get(body.code);
    if (!code || code.expiresAt <= Date.now())
      throw new ForbiddenError("Invalid authorization code");
    const client = this.options.store.getClient(body.client_id);
    if (!client || client.client_id !== code.clientId) throw new ForbiddenError("Invalid client");
    if (body.redirect_uri !== code.redirectUri) throw new ForbiddenError("Invalid redirect_uri");
    if (code.codeChallenge && !verifyPkce(code, body.code_verifier)) {
      throw new ForbiddenError("Invalid code_verifier");
    }
    this.codes.delete(code.code);
    const accessToken = randomToken(32);
    const expiresIn = this.options.accessTokenTtlDays * 24 * 60 * 60;
    await this.options.store.saveToken({
      accessToken,
      refreshToken: randomToken(32),
      clientId: client.client_id,
      subject: code.subject,
      scopes: DEFAULT_SCOPES,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      createdAt: new Date().toISOString(),
    });
    sendJson(response, 200, {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: expiresIn,
      scope: DEFAULT_SCOPES.join(" "),
    });
  }
}

function verifyPkce(code: AuthorizationCode, verifier: string | undefined): boolean {
  if (!code.codeChallenge) return true;
  if (!verifier) return false;
  if (code.codeChallengeMethod === "S256") {
    const digest = createHash("sha256").update(verifier).digest("base64url");
    return digest === code.codeChallenge;
  }
  return verifier === code.codeChallenge;
}

function renderAuthorizeForm(url: URL): string {
  const hidden = Array.from(url.searchParams.entries())
    .map(
      ([key, value]) =>
        `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}" />`,
    )
    .join("");
  return `<!doctype html>
<html><body>
<form method="post" action="/oauth/authorize">
${hidden}
<label>Pairing code <input name="pairing_code" autocomplete="one-time-code" /></label>
<button type="submit">Authorize</button>
</form>
</body></html>`;
}

export async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function readBodyAsJson(request: IncomingMessage): Promise<Record<string, any>> {
  const text = await readBody(request);
  return text.trim() ? (JSON.parse(text) as Record<string, any>) : {};
}

async function readBodyAsForm(request: IncomingMessage): Promise<Record<string, string>> {
  const text = await readBody(request);
  return Object.fromEntries(new URLSearchParams(text).entries());
}

async function readBodyAsFormOrJson(request: IncomingMessage): Promise<Record<string, string>> {
  const contentType = request.headers["content-type"] ?? "";
  if (String(contentType).includes("application/json")) {
    const body = await readBodyAsJson(request);
    return Object.fromEntries(Object.entries(body).map(([key, value]) => [key, String(value)]));
  }
  return readBodyAsForm(request);
}

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
