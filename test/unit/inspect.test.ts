import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { RelayPolicy } from "../../src/policy/policy.js";
import { defaultLimits, limitsPolicySchema } from "../../src/policy/schema.js";
import { getContext } from "../../src/router/context.js";
import { fileStat, fileTree, readFiles, searchCode } from "../../src/workspace/inspect/code.js";
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
      ["workspace.context", {} as any],
      ["fs.search", {} as any],
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
        matches: [{ path: "src/app.ts", line: 1, submatches: [{ start: 13, end: 19 }] }],
        skipped: { protected: 1 },
      });
      await expect(
        searchCode(
          {
            query: "TARGET",
            mode: "fixed",
            case: "insensitive",
            include: ["src/**/*.ts"],
            exclude: ["**/*.md"],
            contextLines: 1,
            maxResults: 10,
          },
          { workspaceRoot: root, workspace: policy.workspace },
        ),
      ).resolves.toMatchObject({
        matches: [
          {
            path: "src/app.ts",
            line: 1,
            before: [],
            after: [""],
          },
        ],
      });
      await expect(
        searchCode(
          { query: "target\\s*=", mode: "regex", include: ["src/**/*.ts"], maxResults: 10 },
          { workspaceRoot: root, workspace: policy.workspace },
        ),
      ).resolves.toMatchObject({
        matches: [{ path: "src/app.ts", line: 1, column: 14 }],
      });
      await expect(fileTree({}, { workspaceRoot: root, workspace: policy.workspace })).resolves.toMatchObject({
        entries: expect.arrayContaining([{ path: "src", type: "directory" }]),
        skipped: { protected: 1, missing: 0 },
        stats: { protectedSkipped: 1 },
        omitted: expect.arrayContaining([{ path: ".env", reason: "protected" }]),
      });
      await expect(
        fileTree({ mode: "packages" }, { workspaceRoot: root, workspace: policy.workspace }),
      ).resolves.toMatchObject({
        entries: expect.arrayContaining([expect.objectContaining({ path: "package.json", type: "file" })]),
      });
      const env = await inspectEnvironment({ registry, policy, workspaceRoot: root });
      const serialized = JSON.stringify(env);
      expect(serialized).not.toContain("super-secret");
      expect(env.environment.sensitive.present).toBe(true);
      expect(env.path.commands.find((command) => command.command === "make")).toBeTruthy();
      expect(env.webvibe.tools).toEqual(["fs.search", "task.run", "workspace.context"]);
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
      ["workspace.context", {} as any],
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

  it("reads text files in bounded UTF-8 byte chunks", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-inspect-read-files-"));
    await writeFile(path.join(root, "small.txt"), "hello");
    await writeFile(path.join(root, "big.txt"), `${"x".repeat(13050)}tail`);
    await writeFile(path.join(root, "unicode.txt"), "aébc");
    await writeFile(path.join(root, "lines.txt"), "one\ntwo\nthree\nfour\n");
    await writeFile(path.join(root, "binary.bin"), Buffer.from([0, 1, 2, 3]));
    const policy = policyFor(root);
    const context = { workspaceRoot: root, workspace: policy.workspace, limits: policy.limits };

    await expect(readFiles({ paths: ["big.txt"], offsetBytes: -1 }, context)).rejects.toThrow(
      "offsetBytes is below minimum",
    );
    await expect(readFiles({ paths: ["big.txt"], maxBytes: 131073 }, context)).rejects.toThrow(
      "maxBytes is above maximum",
    );

    const small = await readFiles({ paths: ["small.txt"] }, context);

    expect(small.files[0]).toMatchObject({
      path: "small.txt",
      kind: "text",
      offsetBytes: 0,
      returnedBytes: 5,
      truncated: false,
      content: "hello",
    });
    expect(small.files[0]).not.toHaveProperty("nextOffsetBytes");

    const first = await readFiles({ paths: ["big.txt"] }, context);

    expect(first.files[0]).toMatchObject({
      path: "big.txt",
      exists: true,
      type: "file",
      size: 13054,
      offsetBytes: 0,
      returnedBytes: 12000,
      nextOffsetBytes: 12000,
      truncated: true,
    });
    expect(Object.keys(first.files[0]!)).toEqual([
      "path",
      "exists",
      "type",
      "kind",
      "size",
      "sha256",
      "offsetBytes",
      "returnedBytes",
      "nextOffsetBytes",
      "truncated",
      "content",
    ]);
    expect(Buffer.byteLength(first.files[0]!.content ?? "", "utf8")).toBe(12000);

    const second = await readFiles(
      { paths: ["big.txt"], offsetBytes: first.files[0]!.nextOffsetBytes, maxBytes: 10 },
      context,
    );

    expect(second.files[0]).toMatchObject({
      path: "big.txt",
      offsetBytes: 12000,
      returnedBytes: 10,
      nextOffsetBytes: 12010,
      truncated: true,
    });
    expect(second.files[0]!.content).toBe("xxxxxxxxxx");

    const unicodeFirst = await readFiles({ paths: ["unicode.txt"], maxBytes: 2 }, context);

    expect(unicodeFirst.files[0]).toMatchObject({
      path: "unicode.txt",
      offsetBytes: 0,
      returnedBytes: 1,
      nextOffsetBytes: 1,
      truncated: true,
      content: "a",
    });

    const unicodeSecond = await readFiles(
      { paths: ["unicode.txt"], offsetBytes: unicodeFirst.files[0]!.nextOffsetBytes, maxBytes: 3 },
      context,
    );

    expect(unicodeSecond.files[0]).toMatchObject({
      path: "unicode.txt",
      offsetBytes: 1,
      returnedBytes: 3,
      nextOffsetBytes: 4,
      truncated: true,
      content: "éb",
    });

    await expect(
      readFiles({ paths: ["unicode.txt"], offsetBytes: 2, maxBytes: 10 }, context),
    ).resolves.toMatchObject({
      files: [{ offsetBytes: 3, returnedBytes: 2, truncated: false, content: "bc" }],
    });
    const eof = await readFiles({ paths: ["unicode.txt"], offsetBytes: 999 }, context);

    expect(eof.files[0]).toMatchObject({
      offsetBytes: 999,
      returnedBytes: 0,
      truncated: false,
      content: "",
    });
    expect(eof.files[0]).not.toHaveProperty("nextOffsetBytes");

    const ranged = await readFiles(
      { path: "lines.txt", range: { startLine: 2, endLine: 3 } },
      context,
    );
    expect(ranged.files[0]).toMatchObject({
      path: "lines.txt",
      kind: "text",
      range: { startLine: 2, endLine: 3 },
      returnedLines: 2,
      content: "two\nthree",
    });

    const binary = await readFiles({ path: "binary.bin" }, context);
    expect(binary.files[0]).toMatchObject({
      path: "binary.bin",
      kind: "binary",
      sha256: expect.any(String),
      truncated: false,
    });
    expect(binary.files[0]).not.toHaveProperty("content");

    const stat = await fileStat({ paths: ["small.txt", "binary.bin"] }, context);
    expect(stat.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "small.txt", kind: "text", sha256: expect.any(String) }),
        expect.objectContaining({ path: "binary.bin", kind: "binary", sha256: expect.any(String) }),
      ]),
    );
  });

  it("keeps read.files protected, missing, and non-file behavior unchanged", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-inspect-read-files-errors-"));
    await mkdir(path.join(root, "dir"));
    await writeFile(path.join(root, ".env"), "SECRET_TARGET=hidden\n");
    const policy = policyFor(root);
    const context = { workspaceRoot: root, workspace: policy.workspace };

    await expect(readFiles({ paths: [".env"] }, context)).rejects.toThrow("protected");
    const result = await readFiles({ paths: ["missing.txt", "dir"] }, context);

    expect(result).toMatchObject({
      files: [
        { path: "missing.txt", exists: false },
        {
          path: "dir",
          exists: true,
          type: "directory",
          error: "Path is not a file",
        },
      ],
    });
    expect(result.files[0]).not.toHaveProperty("offsetBytes");
    expect(result.files[1]).not.toHaveProperty("offsetBytes");
  });

  it("reports manual fallback guidance for capability gaps and unavailable tasks", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-inspect-manual-fallback-"));
    const policy = policyFor(root);
    policy.upstreams.tasks.tasks = {
      missing_node_check: {
        executable: "webvibe-missing-node",
        args: ["scripts/check.js"],
      },
    };
    const registry = new Map([
      ["workspace.context", {} as any],
      ["task.run", {} as any],
      ["manual.gate", {} as any],
    ]);

    const context = await getContext({
      registry,
      policy,
      upstreams: { listHealth: () => [] } as any,
      workspaceRoot: root,
    });

    expect(context.manualFallback).toMatchObject({
      nextTool: "manual.gate",
      reason: "external_manual_step",
      gatePayloadRule: expect.stringContaining("Never put manual commands"),
      hostObservation: {
        toolName: "capability.limit",
        outputText: "manual step required because required execution capability is unavailable",
      },
    });
    expect((context.tasks as any).unavailable).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "missing_node_check",
          manualRequired: expect.objectContaining({
            nextTool: "manual.gate",
            reason: "external_manual_step",
            userInstructions: expect.stringContaining(".webvibe/manual-logs/missing_node_check.log"),
            hostObservation: {
              toolName: "capability.limit",
              outputText: "manual step required because configured task is unavailable",
            },
          }),
        }),
      ]),
    );
  });
});

function policyFor(root: string): RelayPolicy {
  return {
    version: 2,
    profile: "chatgptWebDefault",
    activeProfile: "chatgptWebDefault",
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
    profiles: {
      chatgptWebDefault: {
        limits: defaultLimits,
        taskBundles: {},
      },
    },
    taskBundles: {},
    limits: limitsPolicySchema.parse(defaultLimits),
    audit: {
      enabled: true,
      maxLogBytes: 10 * 1024 * 1024,
      payloads: "hash-only",
      includeClientVisibleOutput: false,
      includeRawToolOutput: false,
      includeErrors: true,
      includeErrorStack: false,
      includeManualEvents: true,
      redact: true,
    },
  };
}
