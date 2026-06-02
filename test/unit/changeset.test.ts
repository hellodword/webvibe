import { createHash } from "node:crypto";
import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { applyChangeset, fileManifest, previewChangeset } from "../../src/workspace/changeset.js";
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
    limits: {
      maxToolOutputBytes: 60000,
      timeoutMs: 30000,
      maxCallsPerMinute: 120,
      maxChangesetFiles: 80,
      maxChangesetBytes: 5 * 1024 * 1024,
      maxChangesetFileBytes: 1024 * 1024,
    },
  };
}

function sha256(value: string): string {
  return sha256Buffer(Buffer.from(value, "utf8"));
}

function sha256Buffer(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
