import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { UpstreamPolicy } from "../../src/policy/policy.js";
import { LocalTaskRunnerClient } from "../../src/upstream/local-task-runner.js";

describe("local task runner upstream", () => {
  it("runs configured tasks and reports unavailable/format/timeout states", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-tasks-"));
    await mkdir(path.join(root, "backend"));
    await mkdir(path.join(root, "secret"));
    await writeFile(path.join(root, "not-dir"), "not a directory\n");
    const policy: UpstreamPolicy = {
      transport: "local-task-runner",
      cwd: root,
      tasks: {
        ok: {
          executable: process.execPath,
          args: ["-e", "console.log('ok')"],
          defaultTimeoutSeconds: 2,
          maxTimeoutSeconds: 4,
        },
        noManifestGate: {
          executable: process.execPath,
          args: ["-e", "console.log('no-gate')"],
          defaultTimeoutSeconds: 2,
        },
        format: {
          executable: process.execPath,
          args: ["-e", "console.log('needs-format')"],
          failOnStdout: true,
          defaultTimeoutSeconds: 2,
        },
        cwd: {
          executable: process.execPath,
          args: ["-e", "console.log(process.cwd().replaceAll('\\\\', '/').split('/').pop())"],
          defaultTimeoutSeconds: 2,
        },
        slow: {
          executable: process.execPath,
          args: ["-e", "setTimeout(() => {}, 5000)"],
          defaultTimeoutSeconds: 1,
          maxTimeoutSeconds: 1,
        },
        dynamic: {
          executable: process.execPath,
          args: ["-e", "console.log(process.argv.slice(1).join('|'))"],
          allowExtraArgs: true,
          maxExtraArgs: 2,
          extraArgPattern: "^[A-Za-z0-9_-]+$",
          defaultTimeoutSeconds: 2,
        },
        missingExecutable: {
          executable: "webvibe-missing-executable",
          args: ["--version"],
          defaultTimeoutSeconds: 2,
        },
      },
    };
    const runner = new LocalTaskRunnerClient("tasks", policy, root, {
      root,
      protected: ["secret/**"],
    });
    await runner.initialize();

    await expect(runner.listTools()).resolves.toEqual([
      expect.objectContaining({
        name: "run_task",
        inputSchema: expect.objectContaining({
          properties: expect.objectContaining({
            cwd: expect.objectContaining({ type: "string" }),
          }),
        }),
        outputSchema: expect.objectContaining({
          required: [
            "status",
            "taskId",
            "exitCode",
            "stdout",
            "stderr",
            "durationMs",
            "timeoutSeconds",
          ],
        }),
      }),
    ]);
    await expect(runner.callTool("run_task", { taskId: "unknown" })).rejects.toThrow("Unknown");
    await expect(runner.callTool("run_task", { taskId: "ok" })).resolves.toMatchObject({
      status: "ok",
      stdout: "ok",
      timeoutSeconds: 2,
    });
    await expect(runner.callTool("run_task", { taskId: "noManifestGate" })).resolves.toMatchObject({
      status: "ok",
      stdout: "no-gate",
    });
    await expect(runner.callTool("run_task", { taskId: "format" })).resolves.toMatchObject({
      status: "failed",
      stdout: "needs-format",
    });
    await expect(runner.callTool("run_task", { taskId: "cwd", cwd: "backend" })).resolves.toMatchObject({
      status: "ok",
      stdout: "backend",
    });
    await expect(runner.callTool("run_task", { taskId: "cwd", cwd: "../outside" })).rejects.toThrow(
      "outside workspace",
    );
    await expect(runner.callTool("run_task", { taskId: "cwd", cwd: path.resolve(root, "backend") })).rejects.toThrow(
      "workspace-relative",
    );
    await expect(runner.callTool("run_task", { taskId: "cwd", cwd: "secret" })).rejects.toThrow("protected");
    await expect(runner.callTool("run_task", { taskId: "cwd", cwd: "missing" })).rejects.toThrow("does not exist");
    await expect(runner.callTool("run_task", { taskId: "cwd", cwd: "not-dir" })).rejects.toThrow(
      "not a directory",
    );
    await expect(runner.callTool("run_task", { taskId: "slow" })).resolves.toMatchObject({
      status: "timeout",
      timeoutSeconds: 1,
    });
    await expect(
      runner.callTool("run_task", { taskId: "dynamic", extraArgs: ["alpha", "beta"] }),
    ).resolves.toMatchObject({
      status: "ok",
      stdout: "alpha|beta",
    });
    await expect(
      runner.callTool("run_task", { taskId: "dynamic", extraArgs: ["bad arg"] }),
    ).rejects.toThrow("not allowed");
    await expect(runner.callTool("run_task", { taskId: "missingExecutable" })).resolves.toMatchObject(
      {
        status: "unavailable",
        unavailableReason: "Missing executable: webvibe-missing-executable",
        manualRequired: {
          nextTool: "manual.gate",
          reason: "external_manual_step",
          userInstructions: expect.stringContaining("webvibe-missing-executable"),
          hostObservation: {
            toolName: "task.run",
            outputText: "Task unavailable: Missing executable: webvibe-missing-executable",
          },
        },
      },
    );
  });
});
