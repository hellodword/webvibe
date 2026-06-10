import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadPolicy } from "../../src/config/loader.js";
import { SAFETY_BLOCK_TEXT } from "../../src/manual/constants.js";
import { classifyHostOutput, planHostRetry } from "../../src/manual/host-output.js";
import type { RelayPolicy } from "../../src/policy/policy.js";
import { ToolRouter } from "../../src/router/tools-call.js";
import { AuditLog } from "../../src/state/audit.js";
import { UpstreamManager } from "../../src/upstream/manager.js";
import { buildRegistry } from "../../src/upstream/registry.js";
import { enableBatchTools } from "../support/batch-policy.js";

describe("host-limit simulation", () => {
  it("routes host blocks, stale tools, unavailable tasks, and default batch-disabled state", async () => {
    expect(classifyHostOutput(SAFETY_BLOCK_TEXT)).toBe("blocked_by_openai_safety");
    expect(
      planHostRetry({
        outputText: SAFETY_BLOCK_TEXT,
        secondaryConfirmationAttempts: 0,
        safetyBlockAttempts: 0,
      }),
    ).toMatchObject({ action: "retry_same_tool_once" });
    expect(
      planHostRetry({
        outputText: SAFETY_BLOCK_TEXT,
        secondaryConfirmationAttempts: 0,
        safetyBlockAttempts: 1,
      }),
    ).toMatchObject({ action: "manual.gate" });
    expect(
      planHostRetry({
        outputText: SAFETY_BLOCK_TEXT,
        secondaryConfirmationAttempts: 0,
        safetyBlockAttempts: 1,
        toolName: "manual.gate",
      }),
    ).toMatchObject({ action: "stop", reason: "manual_gate_blocked" });
    expect(
      planHostRetry({
        outputText: "This action requires confirmation. Please confirm to proceed.",
        secondaryConfirmationAttempts: 0,
        safetyBlockAttempts: 0,
      }),
    ).toMatchObject({ action: "retry_same_tool_once" });

    const setup = await setupRouter();
    try {
      const caller = { clientId: "host-limit-default" };
      const context = (await setup.router.call("workspace.context", {}, caller)) as any;
      expect(context).toMatchObject({
        ok: true,
        status: "ok",
        data: {
          capabilities: {
            batchChange: false,
            editMode: "single",
          },
          editMode: {
            mode: "single",
            batchEnabled: false,
          },
        },
      });
      expect(setup.registry.has("batch.change_preview")).toBe(false);
      await expect(setup.router.call("change.prepare", {}, caller)).rejects.toThrow(
        "UNKNOWN_TOOL_SURFACE",
      );
      await expect(
        setup.router.call("task.explain", { taskId: "missing-task" }, caller),
      ).resolves.toMatchObject({
        ok: true,
        status: "manualFirst",
        data: {
          status: "manualFirst",
          next: { tool: "manual.prepare" },
        },
      });
      await expect(
        setup.router.call("task.run", { taskId: "node.typecheck", timeoutSeconds: 1 }, caller),
      ).resolves.toMatchObject({
        ok: false,
        status: "unavailable",
        data: {
          status: "unavailable",
          next: { tool: "manual.prepare" },
        },
      });

      setup.policy.limits.output.maxToolOutputBytes = 1000;
      await setup.router.call("workspace.context", {}, caller);
      await expect(setup.router.call("fs.read", { path: "large.txt" }, caller)).resolves.toMatchObject({
        truncated: true,
        warnings: [expect.objectContaining({ code: "OUTPUT_TRUNCATED" })],
      });
    } finally {
      await setup.close();
    }
  });

  it("reports batch capability when policy explicitly enables batch tools", async () => {
    const setup = await setupRouter({ batch: true });
    try {
      const caller = { clientId: "host-limit-batch" };
      const context = (await setup.router.call("workspace.context", {}, caller)) as any;
      expect(context).toMatchObject({
        ok: true,
        status: "ok",
        data: {
          capabilities: {
            batchChange: true,
            editMode: "batch",
          },
          editMode: {
            mode: "batch",
            batchEnabled: true,
          },
        },
      });
      expect(setup.registry.has("batch.change_preview")).toBe(true);
      expect(setup.registry.has("batch.change_apply")).toBe(true);
    } finally {
      await setup.close();
    }
  });
});

async function setupRouter(options: { batch?: boolean } = {}): Promise<{
  root: string;
  policy: RelayPolicy;
  registry: ReturnType<typeof buildRegistry>;
  router: ToolRouter;
  close: () => Promise<void>;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-host-limit-"));
  const stateDir = path.join(root, "state");
  await writeFile(path.join(root, "README.md"), "host limit simulation\n");
  await writeFile(path.join(root, "large.txt"), "x".repeat(20_000));
  const policy = await loadPolicy("policies/dev.yaml", { workspaceRoot: root, stateDir });
  if (options.batch) enableBatchTools(policy);
  const upstreams = new UpstreamManager(policy, root);
  await upstreams.connectAll();
  const registry = buildRegistry(policy, upstreams);
  return {
    root,
    policy,
    registry,
    router: new ToolRouter({
      registry,
      policy,
      upstreams,
      audit: new AuditLog(path.join(stateDir, "audit.log"), policy.audit),
      workspaceRoot: root,
      stateDir,
      publicBaseUrl: "http://localhost",
    }),
    close: () => upstreams.close(),
  };
}
