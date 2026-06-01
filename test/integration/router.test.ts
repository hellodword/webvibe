import { mkdtemp, readFile } from "node:fs/promises";
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
  it("exposes policy tools, routes calls, and enforces preview/apply", async () => {
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
        audit: new AuditLog(path.join(stateDir, "audit.log"), true),
        workspaceRoot: root,
        stateDir,
      });

      await expect(router.call("x.read", { path: ".env" }, { clientId: "c1" })).rejects.toThrow(
        "protected",
      );
      await expect(
        router.call(
          "x.edit_apply",
          { path: "file.txt", edits: [{ oldText: "a", newText: "b" }], dryRun: false },
          { clientId: "c1" },
        ),
      ).rejects.toThrow("prior preview");

      await router.call(
        "x.edit_preview",
        { path: "file.txt", edits: [{ oldText: "a", newText: "b" }], dryRun: true },
        { clientId: "c1" },
      );
      const applied = await router.call(
        "x.edit_apply",
        { path: "file.txt", edits: [{ oldText: "a", newText: "b" }], dryRun: false },
        { clientId: "c1" },
      );
      expect(applied).toMatchObject({ ok: true, applied: true });

      const workflow = await router.call("x.run", { timeoutSeconds: 2 }, { clientId: "c1" });
      expect(workflow).toMatchObject({ ok: true, command: "npm test", timeout: 2000 });
      const audit = await readFile(path.join(stateDir, "audit.log"), "utf8");
      expect(audit).toContain('"tool":"x.edit_apply"');
      expect(audit).not.toContain("oldText");
    } finally {
      await upstreams.close();
    }
  });
});
