import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { applyChangeset, fileManifest, previewChangeset } from "../../src/workspace/changeset.js";
import { applyPlan, ChangesetRollbackError } from "../../src/workspace/changeset/apply.js";
import { defaultLimits, limitsPolicySchema } from "../../src/policy/schema.js";
import type { LimitsPolicy, WorkspacePolicy } from "../../src/policy/policy.js";

describe("workspace changesets", () => {
  it("previews without writing and applies multiple file changes in one call", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-changeset-"));
    await writeFile(path.join(root, "a.txt"), "alpha\nbeta\n");
    const context = testContext(root);
    const currentHash = sha256("alpha\nbeta\n");

    const preview = await previewChangeset(
      {
        changes: [
          { op: "mkdir", path: "src" },
          { op: "write", path: "src/new.ts", content: "export const value = 1;\n" },
          {
            op: "text_edit",
            path: "a.txt",
            expectedSha256: currentHash,
            edits: [{ oldText: "alpha", newText: "gamma" }],
          },
        ],
      },
      context,
    );

    expect(preview.valid).toBe(true);
    expect(preview.status).toBe("ok");
    expect(preview.previewId).toMatch(/^cp_/);
    expect(preview.previewHash).toMatch(/^sha256:/);
    expect(preview.hostRisk).toBe("medium");
    expect(preview.risk.recommendedRoute).toMatchObject({ tool: "batch.change_apply" });
    expect(preview.base.manifestHash).toMatch(/^sha256:/);
    expect(preview.diff).toContain("+++ b/src/new.ts");
    expect(await readFile(path.join(root, "a.txt"), "utf8")).toBe("alpha\nbeta\n");

    const applied = await applyChangeset(
      {
        changes: [
          { op: "mkdir", path: "src" },
          { op: "write", path: "src/new.ts", content: "export const value = 1;\n" },
          {
            op: "text_edit",
            path: "a.txt",
            expectedSha256: currentHash,
            edits: [{ oldText: "alpha", newText: "gamma" }],
          },
        ],
        previewHash: preview.previewHash,
      },
      context,
    );

    expect(applied.applied).toBe(true);
    expect(applied.verified).toBe(true);
    expect(applied.hostRisk).toBe("medium");
    expect(applied.base.manifestHash).toBe(preview.base.manifestHash);
    expect(applied.verification).toMatchObject({
      status: "passed",
      manifestHash: expect.stringMatching(/^sha256:/),
    });
    expect(applied.verification.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "src",
          ok: true,
          expected: expect.objectContaining({ type: "directory" }),
          actual: expect.objectContaining({ type: "directory" }),
        }),
        expect.objectContaining({
          path: "a.txt",
          ok: true,
          expected: expect.objectContaining({ sha256: sha256("gamma\nbeta\n") }),
        }),
      ]),
    );
    expect(await readFile(path.join(root, "a.txt"), "utf8")).toBe("gamma\nbeta\n");
    expect(await readFile(path.join(root, "src/new.ts"), "utf8")).toBe(
      "export const value = 1;\n",
    );
  });

  it("returns conflicts without partial writes on stale hashes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-conflict-"));
    await writeFile(path.join(root, "a.txt"), "one\n");
    const preview = await previewChangeset(
      {
        changes: [
          {
            op: "replace",
            path: "a.txt",
            expectedSha256: "0".repeat(64),
            content: "two\n",
          },
          { op: "write", path: "created.txt", content: "new\n" },
        ],
      },
      testContext(root),
    );

    const result = await applyChangeset(
      {
        previewHash: preview.previewHash,
        changes: [
          {
            op: "replace",
            path: "a.txt",
            expectedSha256: "0".repeat(64),
            content: "two\n",
          },
          { op: "write", path: "created.txt", content: "new\n" },
        ],
      },
      testContext(root),
    );

    expect(result.applied).toBe(false);
    expect(result.verified).toBe(false);
    expect(result.verification.status).toBe("skipped");
    expect(result.conflicts).toMatchObject([{ path: "a.txt", reason: "File hash mismatch" }]);
    expect(await readFile(path.join(root, "a.txt"), "utf8")).toBe("one\n");
    await expect(readFile(path.join(root, "created.txt"), "utf8")).rejects.toThrow("ENOENT");
  });

  it("enforces workspace, protected path, binary, and symlink guards", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-guards-"));
    const context = testContext(root);
    await writeFile(path.join(root, "real.txt"), "real\n");
    await writeFile(path.join(root, "binary.txt"), Buffer.from([0, 1, 2]));
    await symlink(path.join(root, "real.txt"), path.join(root, "link.txt"));

    await expect(
      previewChangeset({ changes: [{ op: "create", path: "../outside.txt", content: "" }] }, context),
    ).rejects.toThrow("outside workspace");
    await expect(
      previewChangeset({ changes: [{ op: "create", path: ".env", content: "" }] }, context),
    ).rejects.toThrow("protected");
    await expect(
      applyChangeset(
        {
          previewHash: "sha256:" + "0".repeat(64),
          changes: [
            {
              op: "delete",
              path: "binary.txt",
              expectedSha256: sha256Buffer(Buffer.from([0, 1, 2])),
            },
          ],
        },
        context,
      ),
    ).rejects.toThrow("binary");
    await expect(
      previewChangeset(
        {
          changes: [
            {
              op: "replace",
              path: "link.txt",
              expectedSha256: sha256("real\n"),
              content: "changed\n",
            },
          ],
        },
        context,
      ),
    ).rejects.toThrow("symlink");

    const manifest = await fileManifest({ paths: ["real.txt", "missing.txt", "link.txt"] }, context);
    expect(manifest.files).toMatchObject([
      { path: "real.txt", exists: true, type: "file", sha256: sha256("real\n") },
      { path: "missing.txt", exists: false, type: "missing" },
      { path: "link.txt", exists: true, type: "symlink" },
    ]);
  });

  it("requires matching previewHash before applying", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-preview-hash-"));
    const context = testContext(root);
    await writeFile(path.join(root, "a.txt"), "one\n");
    const changes = [
      {
        op: "replace" as const,
        path: "a.txt",
        expectedSha256: sha256("one\n"),
        content: "two\n",
      },
    ];
    const preview = await previewChangeset({ changes }, context);

    await expect(applyChangeset({ changes }, context)).rejects.toThrow("previewHash is required");
    await expect(
      applyChangeset({ changes, previewHash: "sha256:" + "0".repeat(64) }, context),
    ).rejects.toThrow("previewHash mismatch");

    await expect(applyChangeset({ changes, previewHash: preview.previewHash }, context)).resolves.toMatchObject({
      applied: true,
      verified: true,
      verification: { status: "passed" },
      previewHash: preview.previewHash,
    });
  });

  it("marks high-risk deletes manual-first and blocks direct apply", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-delete-risk-"));
    const context = testContext(root);
    await writeFile(path.join(root, "a.txt"), "a\n");
    await writeFile(path.join(root, "b.txt"), "b\n");
    await writeFile(path.join(root, "c.txt"), "c\n");
    const changes = [
      { op: "delete" as const, path: "a.txt", expectedSha256: sha256("a\n") },
      { op: "delete" as const, path: "b.txt", expectedSha256: sha256("b\n") },
      { op: "delete" as const, path: "c.txt", expectedSha256: sha256("c\n") },
    ];

    const preview = await previewChangeset({ changes }, context);
    const applied = await applyChangeset({ changes, previewHash: preview.previewHash }, context);

    expect(preview).toMatchObject({
      hostRisk: "high",
      risk: {
        manualFirst: true,
        deleteRisk: { deleteCount: 3, threshold: 3, high: true },
        recommendedRoute: { tool: "manual.prepare", reason: "high_host_risk" },
      },
      manualPlan: {
        operation: { kind: "change" },
        next: { tool: "manual.prepare" },
      },
    });
    expect(applied).toMatchObject({
      status: "blocked",
      applied: false,
      verified: false,
      hostRisk: "high",
      manualPlan: { next: { tool: "manual.prepare" } },
    });
    expect(await readFile(path.join(root, "a.txt"), "utf8")).toBe("a\n");
    expect(await readFile(path.join(root, "b.txt"), "utf8")).toBe("b\n");
    expect(await readFile(path.join(root, "c.txt"), "utf8")).toBe("c\n");
  });

  it("applies JSON patch changes through preview hash", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-json-patch-"));
    const context = testContext(root);
    await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "old" }, deps: ["a"] }, null, 2));
    const before = JSON.stringify({ scripts: { test: "old" }, deps: ["a"] }, null, 2);
    const changes = [
      {
        op: "json_patch" as const,
        path: "package.json",
        expectedSha256: sha256(before),
        patch: [
          { op: "replace" as const, path: "/scripts/test", value: "vitest run" },
          { op: "add" as const, path: "/deps/-", value: "b" },
        ],
      },
    ];
    const preview = await previewChangeset({ changes }, context);
    expect(preview.valid).toBe(true);
    expect(preview.diff).toContain("vitest run");

    await applyChangeset({ changes, previewHash: preview.previewHash }, context);
    expect(JSON.parse(await readFile(path.join(root, "package.json"), "utf8"))).toEqual({
      scripts: { test: "vitest run" },
      deps: ["a", "b"],
    });
  });

  it("renames files through preview hash without losing content", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-rename-"));
    const context = testContext(root);
    await writeFile(path.join(root, "old.txt"), "move me\n");
    const changes = [
      {
        op: "rename" as const,
        from: "old.txt",
        to: "nested/new.txt",
        expectedSha256: sha256("move me\n"),
      },
    ];
    const preview = await previewChangeset({ changes }, context);
    expect(preview.valid).toBe(true);
    expect(preview.summary.renames).toBe(1);
    expect(preview.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "nested/new.txt", op: "rename", afterSha256: sha256("move me\n") }),
      ]),
    );

    const applied = await applyChangeset({ changes, previewHash: preview.previewHash }, context);
    expect(applied.verification.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "old.txt",
          ok: true,
          actual: expect.objectContaining({ exists: false, type: "missing" }),
        }),
        expect.objectContaining({
          path: "nested/new.txt",
          ok: true,
          expected: expect.objectContaining({ sha256: sha256("move me\n") }),
        }),
      ]),
    );
    await expect(readFile(path.join(root, "old.txt"), "utf8")).rejects.toThrow("ENOENT");
    expect(await readFile(path.join(root, "nested/new.txt"), "utf8")).toBe("move me\n");
  });

  it("applies unified diff hunks through preview hash", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-unified-diff-"));
    const context = testContext(root);
    await writeFile(path.join(root, "a.txt"), "one\ntwo\nthree\n");
    const changes = [
      {
        op: "unified_diff" as const,
        path: "a.txt",
        expectedSha256: sha256("one\ntwo\nthree\n"),
        diff: [
          "--- a/a.txt",
          "+++ b/a.txt",
          "@@ -1,3 +1,3 @@",
          " one",
          "-two",
          "+TWO",
          " three",
        ].join("\n"),
      },
    ];
    const preview = await previewChangeset({ changes }, context);
    expect(preview.valid).toBe(true);
    expect(preview.diff).toContain("TWO");

    await applyChangeset({ changes, previewHash: preview.previewHash }, context);
    expect(await readFile(path.join(root, "a.txt"), "utf8")).toBe("one\nTWO\nthree\n");
  });

  it("rejects ambiguous plans before writing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-plan-guards-"));
    const context = testContext(root);
    await writeFile(path.join(root, "a.txt"), "same\nsame\n");
    await mkdir(path.join(root, "real-dir"));
    await symlink(path.join(root, "real-dir"), path.join(root, "linked-dir"));

    await expect(
      previewChangeset(
        {
          changes: [
            { op: "create", path: "one.txt", content: "one\n" },
            { op: "create", path: "one.txt", content: "two\n" },
          ],
        },
        context,
      ),
    ).rejects.toThrow("Duplicate changeset path");

    const ambiguous = await previewChangeset(
      {
        changes: [
          {
            op: "edit",
            path: "a.txt",
            expectedSha256: sha256("same\nsame\n"),
            edits: [{ oldText: "same", newText: "once" }],
          },
        ],
      },
      context,
    );
    expect(ambiguous).toMatchObject({
      valid: false,
      status: "conflicted",
      conflicts: [{ path: "a.txt", reason: "Edit text matched more than once" }],
    });
    expect(await readFile(path.join(root, "a.txt"), "utf8")).toBe("same\nsame\n");

    await expect(
      previewChangeset(
        {
          changes: [{ op: "create", path: "linked-dir/new.txt", content: "new\n" }],
        },
        context,
      ),
    ).rejects.toThrow("parent is a symlink");

    await expect(
      previewChangeset(
        {
          changes: [{ op: "create", path: "large.txt", content: "123456" }],
        },
        {
          ...context,
          limits: {
            ...context.limits,
            change: { ...context.limits.change, maxTextFileBytes: 5 },
          },
        },
      ),
    ).rejects.toThrow("maximum is 5");
  });

  it("rolls back earlier writes when a later apply action fails", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-rollback-"));
    await writeFile(path.join(root, "a.txt"), "old\n");
    await mkdir(path.join(root, "target-dir"));

    await expect(
      applyPlan({
        summary: {
          total: 2,
          creates: 0,
          edits: 0,
          replaces: 2,
          deletes: 0,
          renames: 0,
          mkdirs: 0,
        },
        files: [],
        diff: "",
        conflicts: [],
        actions: [
          {
            op: "replace",
            path: "a.txt",
            absolutePath: path.join(root, "a.txt"),
            before: {
              content: "old\n",
              sha256: sha256("old\n"),
              sizeBytes: 4,
              mode: 0o666,
              mtimeMs: 0,
            },
            afterContent: "new\n",
            afterSha256: sha256("new\n"),
          },
          {
            op: "replace",
            path: "target-dir",
            absolutePath: path.join(root, "target-dir"),
            afterContent: "not a directory\n",
            afterSha256: sha256("not a directory\n"),
          },
        ],
      }),
    ).rejects.toThrow();

    expect(await readFile(path.join(root, "a.txt"), "utf8")).toBe("old\n");
  });

  it("surfaces rollback failures separately from apply failures", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-rollback-failure-"));
    await mkdir(path.join(root, "dir"));
    await writeFile(path.join(root, "dir/a.txt"), "old\n");
    await mkdir(path.join(root, "target-dir"));

    await expect(
      applyPlan({
        summary: {
          total: 3,
          creates: 0,
          edits: 0,
          replaces: 2,
          deletes: 0,
          renames: 1,
          mkdirs: 0,
        },
        files: [],
        diff: "",
        conflicts: [],
        actions: [
          {
            op: "replace",
            path: "dir/a.txt",
            absolutePath: path.join(root, "dir/a.txt"),
            before: {
              content: "old\n",
              sha256: sha256("old\n"),
              sizeBytes: 4,
              mode: 0o666,
              mtimeMs: 0,
            },
            afterContent: "new\n",
            afterSha256: sha256("new\n"),
          },
          {
            op: "rename",
            path: "dir",
            absolutePath: path.join(root, "dir"),
            toPath: "dir-moved",
            toAbsolutePath: path.join(root, "dir-moved"),
          },
          {
            op: "replace",
            path: "target-dir",
            absolutePath: path.join(root, "target-dir"),
            afterContent: "not a directory\n",
            afterSha256: sha256("not a directory\n"),
          },
        ],
      }),
    ).rejects.toMatchObject({
      name: "ChangesetRollbackError",
      code: "CHANGE_ROLLBACK_FAILED",
      applyError: expect.stringContaining("directory"),
      rollbackErrors: expect.arrayContaining([expect.stringContaining("dir-moved")]),
    } satisfies Partial<ChangesetRollbackError>);
  });
});

function testContext(root: string): {
  workspaceRoot: string;
  workspace: WorkspacePolicy;
  limits: LimitsPolicy;
} {
  return {
    workspaceRoot: root,
    workspace: {
      root,
      protected: [".env", "dist/**"],
    },
    limits: limitsPolicySchema.parse(defaultLimits),
  };
}

function sha256(value: string): string {
  return sha256Buffer(Buffer.from(value, "utf8"));
}

function sha256Buffer(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
