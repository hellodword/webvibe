import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadPolicy } from "../../src/config/loader.js";
import { ToolRouter } from "../../src/router/tools-call.js";
import { AuditLog } from "../../src/state/audit.js";
import { UpstreamManager } from "../../src/upstream/manager.js";
import { buildRegistry } from "../../src/upstream/registry.js";
import { writeFakePolicy } from "../support/policy.js";

describe("tool router", () => {
  it("exposes policy tools, requires preflight, and routes allowed calls", async () => {
    const setup = await setupRouter("webvibe-router-routing-");
    try {
      expect(Array.from(setup.registry.keys())).toContain("x.read");
      expect(Array.from(setup.registry.keys())).not.toContain("x.optional");

      await expect(
        setup.router.call("read.files", { paths: ["README.md"] }, { clientId: "c1" }),
      ).resolves.toMatchObject({
        status: "blocked",
        code: "CONTEXT_REQUIRED",
        nextTool: "context.get",
      });
      await expect(setup.router.call("context.get", {}, { clientId: "c1" })).resolves.toMatchObject({
        status: "ok",
        toolSurface: { version: "3.2.0" },
      });
      await expect(setup.router.call("x.read", { path: ".env" }, { clientId: "c1" })).rejects.toThrow(
        "protected",
      );
      await expect(
        setup.router.call(
          "x.edit_apply",
          {
            path: "file.txt",
            edits: [{ oldText: "a", newText: "b" }],
            dryRun: false,
          },
          { clientId: "c1" },
        ),
      ).resolves.toMatchObject({ ok: true, applied: true });
      await expect(setup.router.call("x.run", { timeoutSeconds: 2 }, { clientId: "c1" })).resolves.toMatchObject({
        ok: true,
        command: "npm test",
        timeout: 2000,
      });
      await expect(setup.router.call("x.nope", {}, { clientId: "c1" })).rejects.toThrow("not exposed");
    } finally {
      await setup.close();
    }
  });

  it("keeps large read.files results structured and supports explicit byte chunks", async () => {
    const setup = await setupRouter("webvibe-router-read-files-");
    try {
      await writeFile(path.join(setup.root, "large.txt"), "a".repeat(12050));
      await setup.router.call("context.get", {}, { clientId: "read-client" });

      const first = await setup.router.call(
        "read.files",
        { paths: ["large.txt"] },
        { clientId: "read-client" },
      );

      expect(first).toMatchObject({
        status: "ok",
        files: [
          {
            path: "large.txt",
            size: 12050,
            offsetBytes: 0,
            returnedBytes: 10000,
            nextOffsetBytes: 10000,
            truncated: true,
          },
        ],
      });
      expect((first as any).truncated).toBeUndefined();
      expect((first as any).text).toBeUndefined();

      await expect(
        setup.router.call(
          "read.files",
          { paths: ["large.txt"], offsetBytes: 10000, maxBytes: 50 },
          { clientId: "read-client" },
        ),
      ).resolves.toMatchObject({
        status: "ok",
        files: [
          {
            path: "large.txt",
            offsetBytes: 10000,
            returnedBytes: 50,
            nextOffsetBytes: 10050,
            truncated: true,
            content: "a".repeat(50),
          },
        ],
      });
    } finally {
      await setup.close();
    }
  });

  it("redacts audit payloads and caps client-visible output", async () => {
    const setup = await setupRouter("webvibe-router-audit-");
    try {
      await setup.router.call("context.get", {}, { clientId: "audit-client" });
      await setup.router.call(
        "x.edit_apply",
        {
          path: "file.txt",
          edits: [{ oldText: "a", newText: "b" }],
          dryRun: false,
          bearer: "Bearer secret-router-token",
          apiKey: "OPENAI_API_KEY=sk-router-secret",
        },
        { clientId: "audit-client" },
      );

      setup.policy.limits.maxToolOutputBytes = 10;
      await setup.router.call("context.get", {}, { clientId: "audit-client" });
      await expect(
        setup.router.call("x.read", { path: "README.md" }, { clientId: "audit-client" }),
      ).resolves.toMatchObject({ truncated: true });

      const audit = await readFile(setup.auditPath, "utf8");
      expect(audit).toContain('"tool":"x.edit_apply"');
      expect(audit).toContain('"tool":"x.read"');
      expect(audit).toContain("oldText");
      expect(audit).toContain("rawOutput");
      expect(audit).toContain("clientOutput");
      expect(audit).toContain("read:README.md");
      expect(audit).not.toContain("secret-router-token");
      expect(audit).not.toContain("sk-router-secret");
    } finally {
      await setup.close();
    }
  });

  it("enforces per-client rate limits and tool call timeout", async () => {
    const setup = await setupRouter("webvibe-router-limits-");
    try {
      setup.policy.limits.maxCallsPerMinute = 2;
      await setup.router.call("context.get", {}, { clientId: "rate-client" });
      await setup.router.call("x.read", { path: "README.md" }, { clientId: "rate-client" });
      await expect(
        setup.router.call("x.read", { path: "README.md" }, { clientId: "rate-client" }),
      ).rejects.toThrow("Rate limit");

      setup.policy.limits.maxCallsPerMinute = 120;
      await setup.router.call("context.get", {}, { clientId: "timeout-client" });
      await expect(
        setup.router.call("x.slow", { delayMs: 7000 }, { clientId: "timeout-client" }),
      ).rejects.toThrow("timed out");
    } finally {
      await setup.close();
    }
  });
});

async function setupRouter(prefix: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  const stateDir = path.join(root, "state");
  const policyPath = await writeFakePolicy(root);
  const policy = await loadPolicy(policyPath, { workspaceRoot: root, stateDir });
  const upstreams = new UpstreamManager(policy, root);
  await upstreams.connectAll();
  const registry = buildRegistry(policy, upstreams);
  const auditPath = path.join(stateDir, "audit.log");
  const router = new ToolRouter({
    registry,
    policy,
    upstreams,
    audit: new AuditLog(auditPath, policy.audit),
    workspaceRoot: root,
    stateDir,
    publicBaseUrl: "http://localhost",
  });

  return {
    root,
    stateDir,
    policy,
    registry,
    auditPath,
    router,
    close: () => upstreams.close(),
  };
}
