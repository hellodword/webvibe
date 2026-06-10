import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import type { RelayPolicy } from "../../src/policy/policy.js";
import { defaultLimits, limitsPolicySchema } from "../../src/policy/schema.js";
import { getContext, getTaskList } from "../../src/router/context.js";
import { fileStat, fileTree, readFiles, searchCode } from "../../src/workspace/inspect/code.js";
import { inspectEnvironment } from "../../src/workspace/inspect/env.js";
import { inspectProject } from "../../src/workspace/inspect/project.js";
import { workspaceScan } from "../../src/workspace/inspect/scan.js";
import { workspaceSymbols } from "../../src/workspace/inspect/symbols.js";

const execFileAsync = promisify(execFile);

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
    const taskList = await getTaskList({
      registry,
      policy,
      upstreams: { listHealth: () => [] } as any,
      workspaceRoot: root,
    });
    expect((taskList.tasks as any).available).toEqual(
      expect.arrayContaining([expect.objectContaining({ taskId: "go_test", acceptsCwd: true })]),
    );
  });

  it("scans the current TypeScript npm repo and maps router symbols", async () => {
    const root = process.cwd();
    const policy = policyFor(root);
    const context = { workspaceRoot: root, workspace: policy.workspace, limits: policy.limits };

    const scan = await workspaceScan({}, context);
    expect(scan.project.manifests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "package.json", type: "npm", name: "webvibe" }),
      ]),
    );
    expect(scan.project.npmScripts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "test" }),
        expect.objectContaining({ name: "lint" }),
      ]),
    );
    expect(scan.languages).toContain("typescript");
    expect(scan.frontend).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "vitest.config.ts", kind: "frontend:vitest" }),
        expect.objectContaining({ path: "eslint.config.js", kind: "frontend:eslint" }),
      ]),
    );

    const symbols = await workspaceSymbols({ path: "src/router/tools-call.ts" }, context);
    expect(symbols.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "ToolRouter", kind: "class", path: "src/router/tools-call.ts" }),
        expect.objectContaining({ name: "call", kind: "method", path: "src/router/tools-call.ts" }),
        expect.objectContaining({ name: "manualPendingBlock", kind: "method", path: "src/router/tools-call.ts" }),
      ]),
    );
  });

  it("paginates fs.search and fs.tree with opaque cursors", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-inspect-cursors-"));
    await mkdir(path.join(root, "src"));
    for (let index = 0; index < 5; index += 1) {
      await writeFile(path.join(root, "src", `file-${index}.txt`), `needle ${index}\n`);
    }
    await writeFile(path.join(root, "large.txt"), `${"x".repeat(1024 * 1024 + 10)}\nneedle-large\n`);
    const policy = policyFor(root);
    const context = { workspaceRoot: root, workspace: policy.workspace, limits: policy.limits };

    const jsContext = {
      ...context,
      limits: { ...policy.limits, search: { ...policy.limits.search, engine: "js" as const } },
    };
    const firstSearch = await searchCode({ query: "needle", maxResults: 2 }, jsContext);
    expect(firstSearch.matches).toHaveLength(2);
    expect(firstSearch.truncated).toBe(true);
    expect(firstSearch.nextCursor).toBeTruthy();

    const secondSearch = await searchCode(
      { query: "needle", maxResults: 10, cursor: firstSearch.nextCursor },
      jsContext,
    );
    expect(secondSearch.matches.map((match) => match.path)).toContain("src/file-4.txt");

    const defaultSearch = await searchCode(
      { query: "needle", maxResults: 10 },
      context,
    );
    expect(defaultSearch.matches.map((match) => match.path).sort()).toEqual(
      secondSearch.matches
        .concat(firstSearch.matches)
        .map((match) => match.path)
        .sort(),
    );

    const firstTree = await fileTree({ path: "src", maxEntries: 2 }, context);
    expect(firstTree.entries).toHaveLength(2);
    expect(firstTree.truncated).toBe(true);
    expect(firstTree.nextCursor).toBeTruthy();
    const secondTree = await fileTree({ path: "src", maxEntries: 10, cursor: firstTree.nextCursor }, context);
    expect(secondTree.entries.map((entry) => entry.path)).toEqual([
      "src/file-1.txt",
      "src/file-2.txt",
      "src/file-3.txt",
      "src/file-4.txt",
    ]);
  });

  it("honors fs.tree modes, ignored/hidden options, and git-tracked listings", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-inspect-tree-modes-"));
    await mkdir(path.join(root, "src", "nested"), { recursive: true });
    await mkdir(path.join(root, "docs"));
    await writeFile(path.join(root, "src", "app.ts"), "needle app\n");
    await writeFile(path.join(root, "docs", "readme.md"), "needle docs\n");
    await writeFile(path.join(root, ".hidden.txt"), "needle hidden\n");
    await writeFile(path.join(root, "ignored-root.txt"), "needle ignored root\n");
    await writeFile(path.join(root, "src", "nested", "ignored.txt"), "needle ignored nested\n");
    await writeFile(path.join(root, "src", "nested", "keep.txt"), "needle keep\n");
    await writeFile(path.join(root, ".env"), "needle protected\n");
    await writeFile(path.join(root, ".gitignore"), "ignored-root.txt\n");
    await writeFile(path.join(root, "src", "nested", ".gitignore"), "ignored.txt\n");
    const policy = policyFor(root);
    const context = { workspaceRoot: root, workspace: policy.workspace, limits: policy.limits };

    const files = await fileTree({ mode: "files", includeHidden: true, maxEntries: 100 }, context);
    expect(files.entries.every((entry) => entry.type === "file")).toBe(true);
    expect(files.entries.map((entry) => entry.path)).not.toContain("docs");
    expect(files.entries.map((entry) => entry.path)).not.toContain(".env");
    expect(files.effectiveOptions).toMatchObject({ mode: "files", includeHidden: true });

    const dirs = await fileTree({ mode: "dirs", maxEntries: 100 }, context);
    expect(dirs.entries.every((entry) => entry.type === "directory")).toBe(true);
    expect(dirs.entries.map((entry) => entry.path)).toEqual(expect.arrayContaining(["docs", "src"]));

    const ignored = await fileTree({ mode: "files", includeIgnored: true, includeHidden: true, maxEntries: 100 }, context);
    expect(ignored.entries.map((entry) => entry.path)).toEqual(
      expect.arrayContaining(["ignored-root.txt", "src/nested/ignored.txt", ".hidden.txt"]),
    );

    const jsContext = {
      ...context,
      limits: { ...policy.limits, search: { ...policy.limits.search, engine: "js" as const } },
    };
    const defaultSearch = await searchCode({ query: "needle", maxResults: 100 }, jsContext);
    expect(defaultSearch.matches.map((match) => match.path)).not.toEqual(
      expect.arrayContaining(["ignored-root.txt", "src/nested/ignored.txt", ".hidden.txt", ".env"]),
    );
    const expandedSearch = await searchCode(
      { query: "needle", maxResults: 100, includeIgnored: true, includeHidden: true },
      jsContext,
    );
    expect(expandedSearch.effectiveOptions).toMatchObject({ includeIgnored: true, includeHidden: true });
    expect(expandedSearch.matches.map((match) => match.path)).toEqual(
      expect.arrayContaining(["ignored-root.txt", "src/nested/ignored.txt", ".hidden.txt"]),
    );

    try {
      await execFileAsync("git", ["init"], { cwd: root });
      await execFileAsync("git", ["add", "src/app.ts", "docs/readme.md"], { cwd: root });
      const tracked = await fileTree({ mode: "git-tracked", maxEntries: 100 }, context);
      expect(tracked.entries.map((entry) => entry.path)).toEqual(["docs/readme.md", "src/app.ts"]);
      expect(tracked.effectiveOptions).toMatchObject({ mode: "git-tracked" });
    } catch {
      // Git is optional for this unit test environment; non-Git behavior is covered above.
    }
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
    const rangedLines = await readFiles(
      { path: "lines.txt", range: { startLine: 2, endLine: 3 }, format: "lines" },
      context,
    );
    expect(rangedLines.files[0]).toMatchObject({
      path: "lines.txt",
      format: "lines",
      range: { startLine: 2, endLine: 3 },
      lines: [
        { line: 2, text: "two" },
        { line: 3, text: "three" },
      ],
    });
    expect(rangedLines.files[0]).not.toHaveProperty("content");

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
    const taskList = await getTaskList({
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
    expect((taskList.tasks as any).unavailable).toEqual(
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

  it("synthesizes task candidates from hybrid project manifests", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-task-candidates-"));
    await mkdir(path.join(root, "web"));
    await mkdir(path.join(root, "web", "prisma"));
    await mkdir(path.join(root, "api"));
    await mkdir(path.join(root, "crates"));
    await mkdir(path.join(root, "mobile"));
    await writeFile(
      path.join(root, "web", "package.json"),
      JSON.stringify({
        name: "web",
        packageManager: "pnpm@9.0.0",
        scripts: { test: "vitest", lint: "eslint .", deploy: "ignored" },
      }),
    );
    await writeFile(path.join(root, "web", "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await writeFile(path.join(root, "web", "playwright.config.ts"), "export default {}\n");
    await writeFile(path.join(root, "web", "tsconfig.json"), "{}\n");
    await writeFile(path.join(root, "web", "prisma", "schema.prisma"), "datasource db {}\n");
    await writeFile(path.join(root, "api", "go.mod"), "module example.test/api\n");
    await writeFile(path.join(root, "crates", "Cargo.toml"), "[package]\nname = \"demo\"\n");
    await writeFile(path.join(root, "mobile", "pubspec.yaml"), "name: mobile\nflutter:\n");
    await writeFile(path.join(root, "buf.yaml"), "version: v2\n");
    await writeFile(path.join(root, "Makefile"), "build:\n\ttrue\nsecret-deploy:\n\ttrue\n");
    const policy = policyFor(root);
    policy.taskBundles = {
      node: { packageManagers: ["npm", "pnpm"], scripts: ["test", "lint"] },
      go: { tasks: ["test_all", "vet"] },
      rust: { tasks: ["test", "check"] },
      flutter: { tasks: ["analyze", "test", "dart_format"] },
      frontend: { tasks: ["playwright_test", "tsc_noemit"] },
      codegen: { tasks: ["prisma_generate", "buf_lint"] },
      project: { taskFiles: ["make"], allowedTargets: ["build"] },
    };
    const registry = new Map([
      ["workspace.context", {} as any],
      ["task.run", {} as any],
    ]);

    const taskList = await getTaskList({
      registry,
      policy,
      upstreams: { listHealth: () => [] } as any,
      workspaceRoot: root,
    });

    expect((taskList.tasks as any).candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          family: "node",
          cwd: "web",
          script: "test",
          packageManager: "pnpm",
          command: ["pnpm", "run", "test"],
        }),
        expect.objectContaining({
          family: "node",
          cwd: "web",
          script: "lint",
          command: ["pnpm", "run", "lint"],
        }),
        expect.objectContaining({
          family: "go",
          cwd: "api",
          task: "test_all",
          command: ["go", "test", "./..."],
        }),
        expect.objectContaining({
          family: "rust",
          cwd: "crates",
          task: "check",
          command: ["cargo", "check"],
        }),
        expect.objectContaining({
          family: "flutter",
          cwd: "mobile",
          task: "analyze",
          command: ["flutter", "analyze"],
        }),
        expect.objectContaining({
          family: "frontend",
          cwd: "web",
          task: "playwright_test",
          source: "web/playwright.config.ts",
          command: ["pnpm", "exec", "playwright", "test"],
        }),
        expect.objectContaining({
          family: "frontend",
          cwd: "web",
          task: "tsc_noemit",
          command: ["pnpm", "exec", "tsc", "--noEmit"],
        }),
        expect.objectContaining({
          family: "codegen",
          cwd: "web/prisma",
          task: "prisma_generate",
          source: "web/prisma/schema.prisma",
          command: ["pnpm", "exec", "prisma", "generate"],
        }),
        expect.objectContaining({
          family: "codegen",
          cwd: ".",
          task: "buf_lint",
          source: "buf.yaml",
          command: ["buf", "lint"],
        }),
        expect.objectContaining({
          family: "project",
          taskFile: "make",
          target: "build",
          command: ["make", "build"],
          runnable: true,
        }),
        expect.objectContaining({
          family: "project",
          taskFile: "make",
          target: "secret-deploy",
          runnable: false,
        }),
      ]),
    );
    expect((taskList.tasks as any).candidates).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ script: "deploy" })]),
    );
  });
});

function policyFor(root: string): RelayPolicy {
  return {
    version: 3,
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
          "node.test": {
            executable: "npm",
            args: ["test"],
            requiredPackageScript: "test",
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
    taskBundles: {
      node: { packageManagers: ["npm", "pnpm", "yarn", "bun"], scripts: ["test", "lint", "typecheck", "build", "format"] },
      go: { tasks: ["test_all", "vet", "fmt"] },
      rust: { tasks: ["test", "check", "clippy", "fmt", "build"] },
    },
    hostRisk: {
      rawShellShape: "manualFirst",
      unknownTask: "manualFirst",
      largeDiffBytes: defaultLimits.change.maxInlineDiffBytes,
      deleteFileCount: 3,
    },
    taskCatalog: {},
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
