import { createHash } from "node:crypto";
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
  it("exposes policy tools, routes calls, and enforces input policy", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-router-"));
    const stateDir = path.join(root, "state");
    const policyPath = await writeFakePolicy(root);
    const policy = await loadPolicy(policyPath, { workspaceRoot: root, stateDir });
    const upstreams = new UpstreamManager(policy, root);
    await upstreams.connectAll();
    try {
      const registry = buildRegistry(policy, upstreams);
      expect(Array.from(registry.keys())).toContain("x.read");
      expect(Array.from(registry.keys())).not.toContain("x.optional");

      const router = new ToolRouter({
        registry,
        policy,
        upstreams,
        audit: new AuditLog(path.join(stateDir, "audit.log"), policy.audit),
        workspaceRoot: root,
        stateDir,
        publicBaseUrl: "http://localhost",
      });

      await expect(
        router.call("read.files", { paths: ["README.md"] }, { clientId: "c1" }),
      ).resolves.toMatchObject({
        status: "blocked",
        code: "CONTEXT_REQUIRED",
        nextTool: "context.get",
      });
      await expect(router.call("context.get", {}, { clientId: "c1" })).resolves.toMatchObject({
        status: "ok",
        toolSurface: { version: "2.0.0" },
      });
      await expect(router.call("x.read", { path: ".env" }, { clientId: "c1" })).rejects.toThrow(
        "protected",
      );
      const applied = await router.call(
        "x.edit_apply",
        {
          path: "file.txt",
          edits: [{ oldText: "a", newText: "b" }],
          dryRun: false,
          bearer: "Bearer secret-router-token",
          apiKey: "OPENAI_API_KEY=sk-router-secret",
        },
        { clientId: "c1" },
      );
      expect(applied).toMatchObject({ ok: true, applied: true });

      await writeFile(path.join(root, "code.txt"), "old\n");
      const files = await router.call("read.files", { paths: ["code.txt"] }, { clientId: "c1" });
      expect(files).toMatchObject({
        files: [{ path: "code.txt", exists: true, type: "file", content: "old\n" }],
      });
      const changeset = await router.call(
        "change.apply",
        {
          changes: [
            {
              op: "edit",
              path: "code.txt",
              expectedSha256: sha256("old\n"),
              edits: [{ oldText: "old", newText: "new" }],
            },
            { op: "create", path: "new.txt", content: "created\n" },
          ],
        },
        { clientId: "c1" },
      );
      expect(changeset).toMatchObject({ applied: true });
      expect(await readFile(path.join(root, "code.txt"), "utf8")).toBe("new\n");
      expect(await readFile(path.join(root, "new.txt"), "utf8")).toBe("created\n");

      const workflow = await router.call("x.run", { timeoutSeconds: 2 }, { clientId: "c1" });
      expect(workflow).toMatchObject({ ok: true, command: "npm test", timeout: 2000 });
      policy.limits.maxToolOutputBytes = 10;
      await router.call("context.get", {}, { clientId: "c2" });
      await expect(
        router.call("x.read", { path: "README.md" }, { clientId: "c2" }),
      ).resolves.toMatchObject({ truncated: true });
      await expect(router.call("x.nope", {}, { clientId: "c1" })).rejects.toThrow("not exposed");
      const audit = await readFile(path.join(stateDir, "audit.log"), "utf8");
      expect(audit).toContain('"status":"blocked"');
      expect(audit).toContain('"tool":"x.edit_apply"');
      expect(audit).toContain('"tool":"x.nope"');
      expect(audit).toContain("oldText");
      expect(audit).toContain("rawOutput");
      expect(audit).toContain("clientOutput");
      expect(audit).toContain("read:README.md");
      expect(audit).not.toContain("secret-router-token");
      expect(audit).not.toContain("sk-router-secret");
      expect(audit).not.toContain("confirmToken");
    } finally {
      await upstreams.close();
    }
  });

  it("enforces per-client rate limits and tool call timeout", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-router-limits-"));
    const stateDir = path.join(root, "state");
    const policyPath = await writeFakePolicy(root);
    const policy = await loadPolicy(policyPath, { workspaceRoot: root, stateDir });
    const upstreams = new UpstreamManager(policy, root);
    await upstreams.connectAll();
    try {
      const registry = buildRegistry(policy, upstreams);
      const router = new ToolRouter({
        registry,
        policy,
        upstreams,
        audit: new AuditLog(path.join(stateDir, "audit.log"), policy.audit),
        workspaceRoot: root,
        stateDir,
        publicBaseUrl: "http://localhost",
      });

      policy.limits.maxCallsPerMinute = 2;
      await router.call("context.get", {}, { clientId: "rate-client" });
      await router.call("x.read", { path: "README.md" }, { clientId: "rate-client" });
      await expect(
        router.call("x.read", { path: "README.md" }, { clientId: "rate-client" }),
      ).rejects.toThrow("Rate limit");

      policy.limits.maxCallsPerMinute = 120;
      await router.call("context.get", {}, { clientId: "timeout-client" });
      await expect(
        router.call("x.slow", { delayMs: 7000 }, { clientId: "timeout-client" }),
      ).rejects.toThrow("timed out");
    } finally {
      await upstreams.close();
    }
  });
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
