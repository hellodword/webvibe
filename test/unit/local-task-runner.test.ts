import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ scripts: { check: "node check.js" } }),
    );
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
        scriptGate: {
          executable: process.execPath,
          args: ["-e", "console.log('script-gated')"],
          requiredPackageScript: "check",
          defaultTimeoutSeconds: 2,
        },
        missingScript: {
          executable: process.execPath,
          args: ["-e", "console.log('should-not-run')"],
          requiredPackageScript: "missing",
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
            "runId",
            "taskId",
            "exitCode",
            "stdout",
            "stderr",
            "diagnostics",
            "durationMs",
            "timeoutSeconds",
          ],
        }),
      }),
    ]);
    const descriptor = (await runner.listTools())[0] as any;
    expect(descriptor.inputSchema.properties).toMatchObject({
      mode: { type: "string", enum: ["foreground", "background"] },
    });
    await expect(runner.callTool("run_task", { taskId: "unknown" })).rejects.toThrow("Unknown");
    const ok = (await runner.callTool("run_task", { taskId: "ok" })) as any;
    expect(ok).toMatchObject({
      status: "ok",
      timeoutSeconds: 2,
      runId: expect.stringMatching(/^tr_/),
      stdout: expect.objectContaining({
        head: "ok",
        tail: "ok",
        truncated: false,
        logPath: expect.stringContaining(".webvibe/task-logs/"),
      }),
    });
    expect(await readFile(path.join(root, ok.stdout.logPath), "utf8")).toBe("ok\n");
    await expect(runner.callTool("run_task", { taskId: "noManifestGate" })).resolves.toMatchObject({
      status: "ok",
      stdout: expect.objectContaining({ head: "no-gate" }),
    });
    await expect(runner.callTool("run_task", { taskId: "format" })).resolves.toMatchObject({
      status: "failed",
      stdout: expect.objectContaining({ head: "needs-format" }),
    });
    await expect(runner.callTool("run_task", { taskId: "cwd", cwd: "backend" })).resolves.toMatchObject({
      status: "ok",
      stdout: expect.objectContaining({ head: "backend" }),
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
      stdout: expect.objectContaining({ head: "alpha|beta" }),
    });
    await expect(
      runner.callTool("run_task", { taskId: "dynamic", extraArgs: ["bad arg"] }),
    ).rejects.toThrow("not allowed");
    await expect(runner.callTool("run_task", { taskId: "missingExecutable" })).resolves.toMatchObject(
      {
        status: "unavailable",
        unavailableReason: "Missing executable: webvibe-missing-executable",
        stderr: expect.objectContaining({
          head: expect.stringContaining("Task unavailable"),
        }),
        manualRequired: {
          nextTool: "manual.gate",
          reason: "external_manual_step",
          userInstructions: expect.stringContaining("webvibe-missing-executable"),
          hostObservation: {
            toolName: "capability.limit",
            outputText: "manual step required because configured task is unavailable",
          },
        },
      },
    );
    await expect(runner.callTool("run_task", { taskId: "scriptGate" })).resolves.toMatchObject({
      status: "ok",
      stdout: expect.objectContaining({ head: "script-gated" }),
    });
    await expect(runner.callTool("run_task", { taskId: "missingScript" })).resolves.toMatchObject({
      status: "unavailable",
      unavailableReason: "Missing package script: missing",
      stderr: expect.objectContaining({ head: expect.stringContaining("Missing package script") }),
    });
  });

  it("stores large task output as head and tail summaries", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-task-logs-"));
    const policy: UpstreamPolicy = {
      transport: "local-task-runner",
      cwd: root,
      tasks: {
        big: {
          executable: process.execPath,
          args: ["-e", "process.stdout.write('a'.repeat(5000) + 'z'.repeat(5000))"],
          defaultTimeoutSeconds: 2,
        },
      },
    };
    const runner = new LocalTaskRunnerClient(
      "tasks",
      policy,
      root,
      { root, protected: [] },
      { outputHeadBytes: 8, outputTailBytes: 8 },
    );
    await runner.initialize();

    const result = (await runner.callTool("run_task", { taskId: "big" })) as any;

    expect(result.stdout).toMatchObject({
      head: "aaaaaaaa",
      tail: "zzzzzzzz",
      truncated: true,
      bytes: 10000,
      logPath: expect.stringContaining(".webvibe/task-logs/"),
    });
    expect((await readFile(path.join(root, result.stdout.logPath), "utf8")).length).toBe(10000);
  });

  it("parses common diagnostics from task output", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-task-diagnostics-"));
    const policy: UpstreamPolicy = {
      transport: "local-task-runner",
      cwd: root,
      tasks: {
        diagnostics: {
          executable: process.execPath,
          args: [
            "-e",
            [
              "console.log('src/app.ts(10,5): error TS2304: Cannot find name x.');",
              "console.error('lib/main.go:12:3: undefined: y');",
              "console.error('error[E0425]: cannot find value `z` in this scope');",
              "console.error(' --> src/main.rs:7:9');",
              "console.error('error - lib/main.dart:4:2 - Undefined name q. - undefined_identifier');",
              "console.error('AssertionError: expected true to be false');",
              "console.error(' ❯ test/app.test.ts:22:7');",
              "console.error('src/lint.ts');",
              "console.error('  3:1  warning  Unexpected console statement  no-console');",
              "process.exit(1);",
            ].join(""),
          ],
          defaultTimeoutSeconds: 2,
        },
      },
    };
    const runner = new LocalTaskRunnerClient("tasks", policy, root, { root, protected: [] });
    await runner.initialize();

    const result = (await runner.callTool("run_task", { taskId: "diagnostics" })) as any;

    expect(result).toMatchObject({
      status: "failed",
      diagnostics: expect.arrayContaining([
        {
          path: "src/app.ts",
          line: 10,
          column: 5,
          severity: "error",
          message: "error TS2304: Cannot find name x.",
        },
        {
          path: "lib/main.go",
          line: 12,
          column: 3,
          message: "undefined: y",
        },
        {
          path: "src/main.rs",
          line: 7,
          column: 9,
          severity: "error",
          message: "cannot find value `z` in this scope",
        },
        {
          path: "lib/main.dart",
          line: 4,
          column: 2,
          severity: "error",
          message: "Undefined name q. - undefined_identifier",
        },
        {
          path: "test/app.test.ts",
          line: 22,
          column: 7,
          message: "AssertionError: expected true to be false",
        },
        {
          path: "src/lint.ts",
          line: 3,
          column: 1,
          severity: "warning",
          message: "Unexpected console statement  no-console",
        },
      ]),
    });
  });

  it("returns running records for background tasks and updates result logs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-task-background-"));
    const policy: UpstreamPolicy = {
      transport: "local-task-runner",
      cwd: root,
      tasks: {
        background: {
          executable: process.execPath,
          args: ["-e", "setTimeout(() => console.log('done'), 300)"],
          defaultTimeoutSeconds: 2,
        },
      },
    };
    const runner = new LocalTaskRunnerClient("tasks", policy, root, { root, protected: [] });
    await runner.initialize();

    const running = (await runner.callTool("run_task", {
      taskId: "background",
      mode: "background",
    })) as any;

    expect(running).toMatchObject({
      status: "running",
      runId: expect.stringMatching(/^tr_/),
      stdout: expect.objectContaining({ logPath: expect.stringContaining(".webvibe/task-logs/") }),
    });
    await new Promise((resolve) => setTimeout(resolve, 600));
    const record = JSON.parse(
      await readFile(path.join(root, ".webvibe/task-logs", `${running.runId}.json`), "utf8"),
    );
    expect(record).toMatchObject({
      status: "ok",
      runId: running.runId,
      stdout: expect.objectContaining({ head: "done" }),
    });
  });
});
