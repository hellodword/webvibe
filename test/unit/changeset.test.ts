import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { applyChangeset, fileManifest, previewChangeset } from "../../src/workspace/changeset.js";
import { applyPlan } from "../../src/workspace/changeset/apply.js";
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
          { op: "create", path: "src/new.ts", content: "export const value = 1;\n" },
          {
            op: "edit",
            path: "a.txt",
            expectedSha256: currentHash,
            edits: [{ oldText: "alpha", newText: "gamma" }],
          },
        ],
      },
      context,
    );

    expect(preview.valid).toBe(true);
    expect(preview.diff).toContain("+++ b/src/new.ts");
    expect(await readFile(path.join(root, "a.txt"), "utf8")).toBe("alpha\nbeta\n");

    const applied = await applyChangeset(
      {
        changes: [
          { op: "mkdir", path: "src" },
          { op: "create", path: "src/new.ts", content: "export const value = 1;\n" },
          {
            op: "edit",
            path: "a.txt",
            expectedSha256: currentHash,
            edits: [{ oldText: "alpha", newText: "gamma" }],
          },
        ],
      },
      context,
    );

    expect(applied.applied).toBe(true);
    expect(await readFile(path.join(root, "a.txt"), "utf8")).toBe("gamma\nbeta\n");
    expect(await readFile(path.join(root, "src/new.ts"), "utf8")).toBe(
      "export const value = 1;\n",
    );
  });

  it("returns conflicts without partial writes on stale hashes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-conflict-"));
    await writeFile(path.join(root, "a.txt"), "one\n");

    const result = await applyChangeset(
      {
        changes: [
          {
            op: "replace",
            path: "a.txt",
            expectedSha256: "0".repeat(64),
            content: "two\n",
          },
          { op: "create", path: "created.txt", content: "new\n" },
        ],
      },
      testContext(root),
    );

    expect(result.applied).toBe(false);
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
      applyChangeset(
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
