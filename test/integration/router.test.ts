import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadPolicy } from "../../src/config/loader.js";
import { ToolRouter } from "../../src/router/tools-call.js";
import { webvibeServerInstructions } from "../../src/server/instructions.js";
import { AuditLog } from "../../src/state/audit.js";
import { UpstreamManager } from "../../src/upstream/manager.js";
import { buildRegistry } from "../../src/upstream/registry.js";
import { sha256 } from "../../src/util/hash.js";
import { writeFakePolicy } from "../support/policy.js";

describe("tool router", () => {
  it("exposes policy tools, requires preflight, and routes allowed calls", async () => {
    const setup = await setupRouter("webvibe-router-routing-");
    try {
      expect(Array.from(setup.registry.keys())).toContain("x.read");
      expect(Array.from(setup.registry.keys())).not.toContain("x.optional");

      await expect(
        setup.router.call("fs.read_many", { files: [{ path: "README.md" }] }, { clientId: "c1" }),
      ).resolves.toMatchObject({
        ok: false,
        status: "blocked",
        data: {
          code: "CONTEXT_REQUIRED",
          nextTool: "workspace.context",
        },
      });
      await expect(setup.router.call("workspace.context", {}, { clientId: "c1" })).resolves.toMatchObject({
        ok: true,
        status: "ok",
        data: {
          status: "ok",
          hostRisk: "low",
          toolSurface: { version: "4.0.4" },
          policy: { profile: "chatgptWebDefault" },
          capabilities: { editMode: "single" },
          hostConstraints: {
            avoidRawShellShape: true,
            preferFixedTask: true,
            preferSmallPayload: true,
            manualFallbackAvailable: false,
            editMode: "single",
          },
          hostRiskProfile: {
            low: expect.arrayContaining(["read", "search", "stat", "status"]),
            medium: expect.arrayContaining(["task.run", "git.commit"]),
            high: expect.arrayContaining(["large-payload", "manual-first"]),
          },
        },
      });
      await expect(setup.router.call("x.read", { path: ".env" }, { clientId: "c1" })).rejects.toThrow(
        "protected",
      );
      await expect(setup.router.call("diagnostics.health", {}, { clientId: "c1" })).resolves.toMatchObject({
        ok: true,
        status: "ok",
        data: {
          status: "ok",
          name: "webvibe",
          server: { name: "webvibe", version: "0.1.0" },
          activeProfile: "chatgptWebDefault",
          policy: {
            hash: expect.any(String),
            effectiveLimits: expect.any(Object),
          },
          toolSurface: {
            version: "4.0.4",
            hash: expect.any(String),
            toolCount: setup.registry.size,
          },
          instructions: {
            version: "4.0.4",
            hash: sha256(webvibeServerInstructions),
          },
          upstreams: expect.any(Array),
          recentToolErrors: [
            expect.objectContaining({
              tool: "x.read",
              type: "passThrough",
              code: "FORBIDDEN",
              message: expect.stringContaining("protected"),
            }),
          ],
        },
      });
      await expect(
        setup.router.call("task.explain", { taskId: "echo" }, { clientId: "c1" }),
      ).resolves.toMatchObject({
        ok: true,
        status: "available",
        data: {
          status: "available",
          taskId: "echo",
          next: { tool: "task.run", args: { taskId: "echo" } },
        },
      });
      await expect(
        setup.router.call("task.explain", { taskId: "missing-task" }, { clientId: "c1" }),
      ).resolves.toMatchObject({
        ok: true,
        status: "manualFirst",
        data: {
          status: "manualFirst",
          next: { tool: "manual.prepare" },
        },
      });
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
      ).resolves.toMatchObject({ ok: true, data: { ok: true, applied: true } });
      await expect(setup.router.call("x.run", { timeoutSeconds: 2 }, { clientId: "c1" })).resolves.toMatchObject({
        ok: true,
        data: {
          ok: true,
          command: "npm test",
          timeout: 2000,
        },
      });
      const taskRun = (await setup.router.call("task.run", { taskId: "echo" }, { clientId: "c1" })) as any;
      expect(taskRun).toMatchObject({
        ok: true,
        data: {
          status: "ok",
          runId: expect.stringMatching(/^tr_/),
          stdout: expect.objectContaining({ head: "task-ok" }),
        },
      });
      await expect(
        setup.router.call("task.result", { runId: taskRun.data.runId }, { clientId: "c1" }),
      ).resolves.toMatchObject({
        ok: true,
        data: {
          status: "ok",
          runId: taskRun.data.runId,
          stdout: expect.objectContaining({ head: "task-ok" }),
        },
      });
      const background = (await setup.router.call(
        "task.run",
        { taskId: "slow_task", mode: "background" },
        { clientId: "c1" },
      )) as any;
      expect(background).toMatchObject({
        ok: true,
        data: {
          status: "running",
          runId: expect.stringMatching(/^tr_/),
        },
      });
      await expect(
        setup.router.call("task.result", { runId: background.data.runId }, { clientId: "c1" }),
      ).resolves.toMatchObject({
        ok: true,
        data: {
          status: "running",
          runId: background.data.runId,
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await expect(
        setup.router.call("task.result", { runId: background.data.runId }, { clientId: "c1" }),
      ).resolves.toMatchObject({
        ok: true,
        data: {
          status: "ok",
          runId: background.data.runId,
          stdout: expect.objectContaining({ head: "slow-task-ok" }),
        },
      });
      await expect(setup.router.call("read.files", {}, { clientId: "c1" })).rejects.toThrow(
        "UNKNOWN_TOOL_SURFACE",
      );
    } finally {
      await setup.close();
    }
  });

  it("keeps large read.files results structured and supports explicit byte chunks", async () => {
    const setup = await setupRouter("webvibe-router-read-files-");
    try {
      await writeFile(path.join(setup.root, "large.txt"), "a".repeat(12050));
      await setup.router.call("workspace.context", {}, { clientId: "read-client" });

      const first = await setup.router.call(
        "fs.read_many",
        { files: [{ path: "large.txt" }] },
        { clientId: "read-client" },
      );

      expect(first).toMatchObject({
        ok: true,
        status: "ok",
        data: {
          status: "ok",
          files: [
            {
              path: "large.txt",
              size: 12050,
              offsetBytes: 0,
              returnedBytes: 12000,
              nextOffsetBytes: 12000,
              truncated: true,
            },
          ],
        },
      });
      expect((first as any).truncated).toBe(false);
      expect((first as any).text).toBeUndefined();

      await expect(
        setup.router.call(
          "fs.read",
          { path: "large.txt", byteOffset: 12000, maxBytes: 50 },
          { clientId: "read-client" },
        ),
      ).resolves.toMatchObject({
        ok: true,
        status: "ok",
        data: {
          status: "ok",
          files: [
            {
              path: "large.txt",
              offsetBytes: 12000,
              returnedBytes: 50,
              truncated: false,
              content: "a".repeat(50),
            },
          ],
        },
      });
    } finally {
      await setup.close();
    }
  });

  it("redacts audit payloads and caps client-visible output", async () => {
    const setup = await setupRouter("webvibe-router-audit-");
    try {
      await setup.router.call("workspace.context", {}, { clientId: "audit-client" });
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

      setup.policy.limits.output.maxToolOutputBytes = 10;
      await setup.router.call("workspace.context", {}, { clientId: "audit-client" });
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
      setup.policy.limits.rate.maxCallsPerMinute = 2;
      await setup.router.call("workspace.context", {}, { clientId: "rate-client" });
      await setup.router.call("x.read", { path: "README.md" }, { clientId: "rate-client" });
      await expect(
        setup.router.call("x.read", { path: "README.md" }, { clientId: "rate-client" }),
      ).rejects.toThrow("Rate limit");

      setup.policy.limits.rate.maxCallsPerMinute = 120;
      setup.policy.limits.task.defaultTimeoutSeconds = 1;
      await setup.router.call("workspace.context", {}, { clientId: "task-timeout-client" });
      await expect(
        setup.router.call("task.run", { taskId: "slow_task" }, { clientId: "task-timeout-client" }),
      ).resolves.toMatchObject({
        ok: true,
        data: {
          status: "ok",
          stdout: expect.objectContaining({ head: "slow-task-ok" }),
        },
      });

      await setup.router.call("workspace.context", {}, { clientId: "timeout-client" });
      await expect(
        setup.router.call("x.slow", { delayMs: 7000 }, { clientId: "timeout-client" }),
      ).rejects.toThrow("timed out");
    } finally {
      await setup.close();
    }
  });

  it("runs allowed project task-file candidates through task.run", async () => {
    const setup = await setupRouter("webvibe-router-project-task-");
    try {
      await writeFile(
        path.join(setup.root, "Makefile"),
        "print:\n\t@echo project-ok\nblocked:\n\t@echo blocked\n",
      );
      setup.policy.taskBundles = {
        project: { taskFiles: ["make"], allowedTargets: ["print"] },
      };
      const caller = { clientId: "project-task-client" };
      await setup.router.call("workspace.context", {}, caller);

      const result = (await setup.router.call(
        "task.run",
        { taskId: "candidate:.:make:print" },
        caller,
      )) as any;

      expect(result).toMatchObject({
        data: {
          taskId: "candidate:.:make:print",
        },
      });
      expect(["ok", "unavailable"]).toContain(result.data.status);
      if (result.data.status === "ok") {
        expect(result.data.stdout).toMatchObject({ head: "project-ok" });
      } else {
        expect(result.data.unavailableReason).toContain("Missing executable: make");
      }

      await expect(
        setup.router.call("task.run", { taskId: "candidate:.:make:blocked" }, caller),
      ).resolves.toMatchObject({
        data: {
          status: "unavailable",
          unavailableReason: "Candidate task target is not allowed by policy",
          effectiveCommand: { executable: "make", args: ["blocked"], cwd: "." },
          checks: [expect.objectContaining({ kind: "candidatePolicy", ok: false })],
          hostRisk: "medium",
          next: { tool: "manual.prepare", reason: "resolver_check_failed", taskId: "candidate:.:make:blocked" },
        },
      });
      await expect(
        setup.router.call("task.run", { taskId: "candidate:.:make:print", extra: { packages: ["x"] } }, caller),
      ).rejects.toThrow("Candidate task does not accept extra");
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
