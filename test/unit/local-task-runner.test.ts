import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { UpstreamPolicy } from "../../src/policy/policy.js";
import { LocalTaskRunnerClient } from "../../src/upstream/local-task-runner.js";

describe("local task runner upstream", () => {
  it("runs configured tasks and reports unavailable/format/timeout states", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-tasks-"));
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ scripts: { test: "node -e ok" } }),
    );
    await writeFile(path.join(root, "go.mod"), "module example.test/webvibe\n");
    const policy: UpstreamPolicy = {
      transport: "local-task-runner",
      cwd: root,
      tasks: {
        ok: {
          executable: process.execPath,
          args: ["-e", "console.log('ok')"],
          requiredFiles: ["package.json"],
          requiredPackageScript: "test",
          defaultTimeoutSeconds: 2,
          maxTimeoutSeconds: 4,
        },
        missingScript: {
          executable: process.execPath,
          args: ["-e", "console.log('missing')"],
          requiredFiles: ["package.json"],
          requiredPackageScript: "build",
          defaultTimeoutSeconds: 2,
        },
        format: {
          executable: process.execPath,
          args: ["-e", "console.log('needs-format')"],
          requiredFiles: ["go.mod"],
          failOnStdout: true,
          defaultTimeoutSeconds: 2,
        },
        slow: {
          executable: process.execPath,
          args: ["-e", "setTimeout(() => {}, 5000)"],
          defaultTimeoutSeconds: 1,
          maxTimeoutSeconds: 1,
        },
      },
    };
    const runner = new LocalTaskRunnerClient("tasks", policy, root);
    await runner.initialize();

    await expect(runner.listTools()).resolves.toEqual([
      expect.objectContaining({
        name: "run_task",
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
    await expect(runner.callTool("run_task", { taskId: "missingScript" })).resolves.toMatchObject({
      status: "unavailable",
    });
    await expect(runner.callTool("run_task", { taskId: "format" })).resolves.toMatchObject({
      status: "failed",
      stdout: "needs-format",
    });
    await expect(runner.callTool("run_task", { taskId: "slow" })).resolves.toMatchObject({
      status: "timeout",
      timeoutSeconds: 1,
    });
  });
});
