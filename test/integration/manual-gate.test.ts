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
  it("creates a pending action and resumes it with /resume", async () => {
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
      const caller = { clientId: "manual-client", openaiSession: "session-a" };
      await router.call("context.get", {}, caller);

      const gate = (await router.call(
        "manual.gate",
        {
          reason: "manual_review_requested",
        },
        caller,
      )) as any;

      expect(gate.structuredContent).toMatchObject({
        status: "awaiting_manual_completion",
        resumeTool: "manual.resume",
        continuation: {
          mode: "await_resume_command",
          modelShouldStop: true,
          mustEndTurn: true,
          resumeMode: "resume_interrupted_workflow",
        },
      });
      const pendingId = gate.structuredContent.pendingId;
      expect(gate._meta).toBeUndefined();
      expect(gate.structuredContent.title).toBeUndefined();
      expect(gate.structuredContent.instructions).toBeUndefined();
      expect(gate.structuredContent.artifacts).toBeUndefined();
      expect(gate.structuredContent.checks).toBeUndefined();
      expect(gate.structuredContent.detailUrl).toBeUndefined();
      expect(Buffer.byteLength(JSON.stringify(gate), "utf8")).toBeLessThan(4096);

      const pending = await new ManualPendingStore(stateDir).read(pendingId);
      expect(pending).toMatchObject({ status: "pending", title: "Manual action required" });
      expect(pending?.scope.sessionHash).toBeTruthy();

      await expect(router.call("read.tree", {}, caller)).resolves.toMatchObject({
        status: "blocked",
        code: "MANUAL_PENDING_REQUIRED",
        pendingId,
        resumeTool: "manual.resume",
      });
      await expect(
        router.call(
          "manual.gate",
          {
            reason: "manual_review_requested",
          },
          caller,
        ),
      ).resolves.toMatchObject({
        status: "blocked",
        code: "MANUAL_PENDING_REQUIRED",
        pendingId,
      });
      await expect(router.call("context.get", {}, caller)).resolves.toMatchObject({
        status: "blocked",
        code: "MANUAL_PENDING_REQUIRED",
      });
      await expect(router.call("diagnostics.health", {}, caller)).resolves.toMatchObject({
        status: "ok",
      });

      const otherCaller = { clientId: "manual-client", openaiSession: "session-b" };
      await router.call("context.get", {}, otherCaller);
      await expect(router.call("read.tree", {}, otherCaller)).resolves.not.toMatchObject({
        code: "MANUAL_PENDING_REQUIRED",
      });

      await expect(
        router.call(
          "manual.resume",
          { resumeMessage: "done" },
          caller,
        ),
      ).resolves.toMatchObject({ status: "blocked", code: "RESUME_COMMAND_REQUIRED" });

      await expect(
        router.call("manual.resume", { resumeMessage: " /resume" }, caller),
      ).resolves.toMatchObject({
        status: "confirmed",
        verification: { status: "not_configured" },
        next: {
          mode: "resume_interrupted_workflow",
          verifyBeforeContinuing: true,
        },
      });

      await expect(
        router.call(
          "manual.gate",
          {
            reason: "manual_review_requested",
            title: "Old title field should be rejected",
          },
          caller,
        ),
      ).rejects.toThrow("input.title is not allowed");

      const outputGate = (await router.call(
        "manual.gate",
        {
          reason: "external_manual_step",
        },
        caller,
      )) as any;
      const outputPendingId = outputGate.structuredContent.pendingId;
      const outputConfirm = (await router.call(
        "manual.resume",
        {
          resumeMessage: "/resume .webvibe/manual-logs/manual-output-action.log",
        },
        caller,
      )) as any;
      expect(outputConfirm.next.followUpPrompt).toContain(
        ".webvibe/manual-logs/manual-output-action.log",
      );
      const outputRecord = await new ManualPendingStore(stateDir).read(outputPendingId);
      expect(outputRecord?.events.at(-1)).toMatchObject({
        type: "confirmed",
        manualLogPath: ".webvibe/manual-logs/manual-output-action.log",
      });

      const cancelGate = (await router.call(
        "manual.gate",
        {
          reason: "external_manual_step",
        },
        caller,
      )) as any;
      await expect(
        router.call("manual.resume", { resumeMessage: "/resume cancel" }, caller),
      ).resolves.toMatchObject({
        status: "cancelled",
        pendingId: cancelGate.structuredContent.pendingId,
      });

      const confirmed = await new ManualPendingStore(stateDir).read(pendingId);
      expect(confirmed?.status).toBe("confirmed");
      expect(confirmed?.events.map((event) => event.type)).toContain("confirmed");

      await expect(readFile(path.join(root, "manual-test-output.txt"), "utf8")).rejects.toThrow(
        "ENOENT",
      );
      const audit = await readFile(path.join(stateDir, "audit.log"), "utf8");
      expect(audit).toContain("manual.gate.created");
      expect(audit).toContain("manual.resume");
    } finally {
      await upstreams.close();
    }
  });
});
