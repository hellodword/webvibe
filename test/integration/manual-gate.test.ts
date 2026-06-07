import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadPolicy } from "../../src/config/loader.js";
import { ManualPendingStore } from "../../src/manual/pending-store.js";
import { ToolRouter } from "../../src/router/tools-call.js";
import { AuditLog } from "../../src/state/audit.js";
import { UpstreamManager } from "../../src/upstream/manager.js";
import { buildRegistry } from "../../src/upstream/registry.js";

describe("manual gate", () => {
  it("creates a pending action and confirms it with the component token", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-manual-gate-"));
    const stateDir = path.join(root, "state");
    const policy = await loadPolicy("policies/dev.yaml", { workspaceRoot: root, stateDir });
    const upstreams = new UpstreamManager(policy, root);
    await upstreams.connectAll();
    try {
      const router = new ToolRouter({
        registry: buildRegistry(policy, upstreams),
        policy,
        upstreams,
        audit: new AuditLog(path.join(stateDir, "audit.log"), policy.audit),
        workspaceRoot: root,
        stateDir,
        publicBaseUrl: "http://localhost",
      });
      const caller = { clientId: "manual-client" };
      await router.call("context.get", {}, caller);

      const gate = (await router.call(
        "manual.gate",
        {
          reason: "manual_review_requested",
          title: "Manual test action",
          instructions: "Create the observable condition outside ChatGPT, then return.",
        },
        caller,
      )) as any;

      expect(gate.structuredContent).toMatchObject({
        status: "awaiting_manual_completion",
        confirmTool: "manual.confirm",
      });
      const pendingId = gate.structuredContent.pendingId;
      const confirmToken = gate._meta.manualAction.confirmToken;
      expect(confirmToken).toBeTruthy();
      expect(gate.structuredContent.confirmToken).toBeUndefined();

      const pending = await new ManualPendingStore(stateDir).read(pendingId);
      expect(pending).toMatchObject({ status: "pending", title: "Manual test action" });

      await expect(
        router.call(
          "manual.confirm",
          { pendingId, confirmToken: "wrong-token", outcome: "completed" },
          caller,
        ),
      ).resolves.toMatchObject({ status: "forbidden" });

      await expect(
        router.call("manual.confirm", { pendingId, confirmToken, outcome: "completed" }, caller),
      ).resolves.toMatchObject({
        status: "confirmed",
        verification: { status: "not_configured" },
      });

      const confirmed = await new ManualPendingStore(stateDir).read(pendingId);
      expect(confirmed?.status).toBe("confirmed");
      expect(confirmed?.events.map((event) => event.type)).toContain("confirmed");

      await expect(readFile(path.join(root, "manual-test-output.txt"), "utf8")).rejects.toThrow(
        "ENOENT",
      );
      const audit = await readFile(path.join(stateDir, "audit.log"), "utf8");
      expect(audit).toContain("manual.gate.created");
      expect(audit).toContain("manual.confirm");
      expect(audit).not.toContain(confirmToken);
    } finally {
      await upstreams.close();
    }
  });
});
