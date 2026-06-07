import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ManualPendingStore } from "../../src/manual/pending-store.js";
import { runWebvibe } from "../../src/main.js";
import { sha256 } from "../../src/util/hash.js";
import { writeFakePolicy } from "../support/policy.js";

describe("HTTP OAuth MCP flow", () => {
  it("uses config pairing and persists token across restart", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-http-"));
    const stateDir = path.join(root, "state");
    const policyPath = await writeFakePolicy(root);
    const configPath = path.join(root, "config.yaml");
    await writeFile(
      configPath,
      `version: 1
server:
  listen: "127.0.0.1:0"
  publicBaseUrl: "http://127.0.0.1:0"
  stateDir: "${stateDir}"
  policy: "${policyPath}"
workspace:
  root: "${root}"
auth:
  pairingCode: "123456"
`,
    );
    const first = await runWebvibe({ config: configPath });
    const firstBase = baseUrl(first.http.server.address());
    try {
      const register = await fetch(`${firstBase}/oauth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ redirect_uris: ["http://client.test/callback"] }),
      });
      expect(register.status).toBe(201);
      const client = (await register.json()) as any;

      const authorize = await fetch(
        `${firstBase}/oauth/authorize?${new URLSearchParams({
          response_type: "code",
          client_id: client.client_id,
          redirect_uri: "http://client.test/callback",
          pairing_code: "123456",
        })}`,
        { redirect: "manual" },
      );
      expect(authorize.status).toBe(302);
      const redirect = new URL(authorize.headers.get("location")!);
      const code = redirect.searchParams.get("code")!;

      const tokenResponse = await fetch(`${firstBase}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: client.client_id,
          redirect_uri: "http://client.test/callback",
          code,
        }),
      });
      expect(tokenResponse.status).toBe(200);
      const token = (await tokenResponse.json()) as any;

      const initialize = await mcp(firstBase, token.access_token, "initialize", {});
      expect(initialize.result.capabilities).toMatchObject({ tools: {}, resources: {} });
      expect(initialize.result.instructions).toContain(
        "This tool call was blocked by OpenAI's safety checks. Please double check what you are sending.",
      );

      const tools = await mcp(firstBase, token.access_token, "tools/list", {});
      expect(tools.result.tools.map((tool: any) => tool.name)).toContain("x.read");

      const resource = await mcp(firstBase, token.access_token, "resources/read", {
        uri: "ui://webvibe/manual-gate.html",
      });
      expect(resource.result.contents[0].mimeType).toBe("text/html;profile=mcp-app");

      const context = await mcp(firstBase, token.access_token, "tools/call", {
        name: "context.get",
        arguments: {},
      });
      expect(context.result.content[0].text).toContain("toolSurface");

      const pendingStore = new ManualPendingStore(stateDir);
      const pendingId = pendingStore.newPendingId();
      const confirmToken = "manual-detail-token";
      await pendingStore.create({
        operationId: "manual-http-op",
        pendingId,
        reason: "external_manual_step",
        status: "pending",
        title: "Manual HTTP detail",
        instructions: "Run the external step and paste the resulting logs.",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        createdByTool: "manual.gate",
        artifacts: [],
        checks: [],
        confirmTokenHash: sha256(confirmToken),
        events: [{ at: new Date().toISOString(), type: "created" }],
      });
      const detail = await fetch(`${firstBase}/manual-gates/${pendingId}?t=${confirmToken}`);
      expect(detail.status).toBe(200);
      expect(detail.headers.get("cache-control")).toBe("no-store");
      await expect(detail.json()).resolves.toMatchObject({
        pendingId,
        title: "Manual HTTP detail",
        instructions: "Run the external step and paste the resulting logs.",
      });
      const badDetail = await fetch(`${firstBase}/manual-gates/${pendingId}?t=wrong`);
      expect(badDetail.status).toBe(403);

      const call = await mcp(firstBase, token.access_token, "tools/call", {
        name: "x.read",
        arguments: { path: "README.md" },
      });
      expect(call.result.content[0].text).toContain("read:README.md");
      expect(await readFile(path.join(stateDir, "oauth-store.json"), "utf8")).toContain(
        token.access_token,
      );
      expect(await readFile(path.join(stateDir, "audit.log"), "utf8")).toContain(
        "mcp.resources.read",
      );

      await first.close();

      const second = await runWebvibe({ config: configPath });
      const secondBase = baseUrl(second.http.server.address());
      try {
        const info = await mcp(secondBase, token.access_token, "tools/call", {
          name: "diagnostics.health",
          arguments: {},
        });
        expect(info.result.content[0].text).toContain("webvibe");
      } finally {
        await second.close();
      }
    } finally {
      await first.close().catch(() => {});
    }
  });
});

async function mcp(base: string, token: string, method: string, params: unknown): Promise<any> {
  const response = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  expect(response.status).toBe(200);
  return response.json();
}

function baseUrl(address: ReturnType<import("node:http").Server["address"]>): string {
  if (typeof address !== "object" || !address) throw new Error("No server address");
  return `http://127.0.0.1:${address.port}`;
}
