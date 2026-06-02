import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { RelayPolicy } from "../../src/policy/policy.js";
import { getContext } from "../../src/router/context.js";
import { fileTree, searchCode } from "../../src/workspace/inspect/code.js";
import { inspectEnvironment } from "../../src/workspace/inspect/env.js";
import { inspectProject } from "../../src/workspace/inspect/project.js";

describe("workspace inspection built-ins", () => {
  it("inspects project files and searches code without leaking protected files or env secrets", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-inspect-"));
    await mkdir(path.join(root, "src"));
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "sample", scripts: { test: "vitest", build: "tsc" } }),
    );
    await writeFile(path.join(root, "package-lock.json"), "{}\n");
    await writeFile(path.join(root, "src", "app.ts"), "export const target = 'visible';\n");
    await writeFile(path.join(root, ".env"), "SECRET_TARGET=hidden\n");
    const policy = policyFor(root);
    const registry = new Map([
      ["context.get", {} as any],
      ["read.search", {} as any],
      ["task.run", {} as any],
    ]);
    const previousToken = process.env.WEBVIBE_TEST_TOKEN;
    process.env.WEBVIBE_TEST_TOKEN = "super-secret";
    try {
      await expect(inspectProject({}, { workspaceRoot: root, workspace: policy.workspace })).resolves.toMatchObject({
        manifests: [{ path: "package.json", type: "npm", name: "sample" }],
        lockfiles: [{ path: "package-lock.json", type: "npm" }],
      });
      await expect(
        searchCode({ query: "target", maxResults: 10 }, { workspaceRoot: root, workspace: policy.workspace }),
      ).resolves.toMatchObject({
        matches: [{ path: "src/app.ts", line: 1 }],
        skipped: { protected: 1 },
      });
      await expect(fileTree({}, { workspaceRoot: root, workspace: policy.workspace })).resolves.toMatchObject({
        entries: expect.arrayContaining([{ path: "src", type: "directory" }]),
        skipped: { protected: 1, missing: 0 },
      });
      const env = await inspectEnvironment({ registry, policy, workspaceRoot: root });
      const serialized = JSON.stringify(env);
      expect(serialized).not.toContain("super-secret");
      expect(env.environment.sensitive.present).toBe(true);
      expect(env.path.commands.find((command) => command.command === "make")).toBeTruthy();
      expect(env.webvibe.tools).toEqual(["context.get", "read.search", "task.run"]);
    } finally {
      if (previousToken === undefined) delete process.env.WEBVIBE_TEST_TOKEN;
      else process.env.WEBVIBE_TEST_TOKEN = previousToken;
    }
  });

  it("reports nested manifests without marking tasks unavailable for missing root manifests", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-inspect-monorepo-"));
    await mkdir(path.join(root, "backend"));
    await writeFile(path.join(root, "backend", "go.mod"), "module example.test/backend\n");
    const policy = policyFor(root);
    policy.upstreams.tasks.tasks = {
      go_test: {
        executable: process.execPath,
        args: ["-e", ""],
      },
    };
    const registry = new Map([
      ["context.get", {} as any],
      ["task.run", {} as any],
    ]);

    const env = await inspectEnvironment({ registry, policy, workspaceRoot: root });

    expect(env.project.manifests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "backend/go.mod",
          type: "go",
          name: "example.test/backend",
        }),
      ]),
    );
    expect(env.webvibe.missingTasks).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ taskId: "go_test" })]),
    );
    const context = await getContext({
      registry,
      policy,
      upstreams: { listHealth: () => [] } as any,
      workspaceRoot: root,
    });
    expect((context.tasks as any).available).toEqual(
      expect.arrayContaining([expect.objectContaining({ taskId: "go_test", acceptsCwd: true })]),
    );
  });
});

function policyFor(root: string): RelayPolicy {
  return {
    version: 1,
    mode: "dev",
    workspace: {
      root,
      protected: [".env", ".git/**", "node_modules/**"],
    },
    upstreams: {
      tasks: {
        transport: "local-task-runner",
        cwd: root,
        tasks: {
          npm_test: {
            executable: "npm",
            args: ["test"],
          },
        },
      },
    },
    tools: [],
    limits: {
      maxToolOutputBytes: 60000,
      timeoutMs: 30000,
      maxCallsPerMinute: 120,
      maxChangesetFiles: 80,
      maxChangesetBytes: 5 * 1024 * 1024,
      maxChangesetFileBytes: 1024 * 1024,
    },
    audit: { enabled: true, maxLogBytes: 10 * 1024 * 1024 },
  };
}
