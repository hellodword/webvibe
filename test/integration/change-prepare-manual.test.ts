import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadPolicy } from "../../src/config/loader.js";
import { ManualPendingStore } from "../../src/manual/pending-store.js";
import { PreparedManualActionStore } from "../../src/manual/prepared-store.js";
import { ToolRouter } from "../../src/router/tools-call.js";
import { AuditLog } from "../../src/state/audit.js";
import { UpstreamManager } from "../../src/upstream/manager.js";
import { buildRegistry } from "../../src/upstream/registry.js";

const safetyBlock =
  "This tool call was blocked by OpenAI's safety checks. Please double check what you are sending.";

describe("change.prepare manual fallback", () => {
  it("prepares review material without writing and verifies manual completion", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-change-prepare-"));
    const stateDir = path.join(root, "state");
    await writeFile(path.join(root, "code.txt"), "old\n");
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
      const caller = { clientId: "prepare-client" };
      await router.call("context.get", {}, caller);

      const prepared = (await router.call(
        "change.prepare",
        {
          changes: [
            {
              op: "edit",
              path: "code.txt",
              expectedSha256: sha256("old\n"),
              edits: [{ oldText: "old", newText: "new" }],
            },
          ],
        },
        caller,
      )) as any;

      expect(await readFile(path.join(root, "code.txt"), "utf8")).toBe("old\n");
      expect(prepared).toMatchObject({
        status: "prepared",
        valid: true,
        manualGate: { nextTool: "manual.gate" },
      });
      expect(prepared.preparedId).toBeTruthy();
      expect(prepared.manualGate.checks[0]).toMatchObject({
        kind: "workspace-path-state",
        path: "code.txt",
        expected: { exists: true, type: "file", sha256: sha256("new\n") },
      });

      const preparedRecord = await new PreparedManualActionStore(stateDir).read(prepared.preparedId);
      expect(preparedRecord?.artifacts[0].label).toBe("Workspace change review material");

      const gate = (await router.call(
        "manual.gate",
        {
          preparedId: prepared.preparedId,
          reason: "openai_safety_block",
          hostObservation: { toolName: "change.apply", outputText: safetyBlock },
        },
        caller,
      )) as any;
      const pending = await new ManualPendingStore(stateDir).read(gate.structuredContent.pendingId);
      expect(pending?.hostObservation?.classification).toBe("blocked_by_openai_safety");

      await writeFile(path.join(root, "code.txt"), "new\n");
      await expect(
        router.call(
          "manual.confirm",
          {
            pendingId: gate.structuredContent.pendingId,
            confirmToken: gate._meta.manualAction.confirmToken,
            outcome: "completed",
          },
          caller,
        ),
      ).resolves.toMatchObject({
        status: "confirmed",
        verification: { status: "passed" },
      });
    } finally {
      await upstreams.close();
    }
  });
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
