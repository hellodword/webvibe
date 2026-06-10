import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadPolicy } from "../../src/config/loader.js";
import { ManualArtifactStore } from "../../src/manual/artifact-store.js";
import { ToolRouter } from "../../src/router/tools-call.js";
import { AuditLog } from "../../src/state/audit.js";
import { UpstreamManager } from "../../src/upstream/manager.js";
import { buildRegistry } from "../../src/upstream/registry.js";

describe("file.change_preview", () => {
  it("previews one logical change without writing and rejects stale tool names", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-change-preview-"));
    const stateDir = path.join(root, "state");
    await writeFile(path.join(root, "code.txt"), "old\n");
    const policy = await loadPolicy("policies/dev.yaml", { workspaceRoot: root, stateDir });
    const upstreams = new UpstreamManager(policy, root);
    await upstreams.connectAll();
    try {
      const router = new ToolRouter({
        registry: buildRegistry(policy, upstreams),
        policy,
        upstreams,
        audit: new AuditLog(path.join(stateDir, "audit.log"), policy.audit),
        workspaceRoot: root,
        stateDir,
        publicBaseUrl: "http://localhost",
      });
      const caller = { clientId: "preview-client" };
      await router.call("workspace.context", {}, caller);

      const preview = (await router.call(
        "file.change_preview",
        {
          changes: [
            {
              op: "edit",
              path: "code.txt",
              expectedSha256: sha256("old\n"),
              edits: [{ oldText: "old", newText: "new" }],
            },
          ],
        },
        caller,
      )) as any;

      expect(await readFile(path.join(root, "code.txt"), "utf8")).toBe("old\n");
      expect(preview).toMatchObject({
        ok: true,
        status: "ok",
        data: {
          valid: true,
          files: [{ path: "code.txt", op: "edit" }],
          conflicts: [],
        },
      });
      await expect(router.call("change.prepare", {}, caller)).rejects.toThrow(
        "UNKNOWN_TOOL_SURFACE",
      );
      await expect(router.call("change.preview", { changes: [] }, caller)).rejects.toThrow(
        "UNKNOWN_TOOL_SURFACE",
      );
      await expect(
        router.call(
          "file.change_preview",
          {
            changes: [
              { op: "create", path: "a.txt", content: "a\n" },
              { op: "create", path: "b.txt", content: "b\n" },
            ],
          },
          caller,
        ),
      ).rejects.toThrow("too many items");
    } finally {
      await upstreams.close();
    }
  });

  it("stores oversized preview diffs as artifacts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-change-artifact-"));
    const stateDir = path.join(root, "state");
    await writeFile(path.join(root, "code.txt"), "old\n");
    const policy = await loadPolicy("policies/dev.yaml", { workspaceRoot: root, stateDir });
    policy.limits.change.maxInlineDiffBytes = 80;
    policy.limits.change.maxInlineDiffLines = 3;
    const upstreams = new UpstreamManager(policy, root);
    await upstreams.connectAll();
    try {
      const router = new ToolRouter({
        registry: buildRegistry(policy, upstreams),
        policy,
        upstreams,
        audit: new AuditLog(path.join(stateDir, "audit.log"), policy.audit),
        workspaceRoot: root,
        stateDir,
        publicBaseUrl: "http://artifact.test",
      });
      const caller = { clientId: "preview-artifact-client" };
      await router.call("workspace.context", {}, caller);

      const content = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join("\n") + "\n";
      const preview = (await router.call(
        "file.change_preview",
        {
          changes: [
            {
              op: "replace",
              path: "code.txt",
              expectedSha256: sha256("old\n"),
              content,
            },
          ],
        },
        caller,
      )) as any;

      expect(preview).toMatchObject({
        ok: true,
        status: "ok",
        truncated: true,
        data: {
          diff: "",
          diffInfo: {
            truncated: true,
            artifact: expect.objectContaining({ mimeType: "text/x-diff" }),
          },
        },
      });
      expect(preview.artifacts).toHaveLength(1);
      const artifact = preview.artifacts[0];
      const artifactUrl = new URL(artifact.downloadUrl);
      const opened = await new ManualArtifactStore(stateDir).openDownload(
        artifact.artifactId,
        artifactUrl.searchParams.get("t"),
      );
      expect(opened.record.createdByTool).toBe("file.change_preview");
      expect(opened.record.kind).toBe("diff");
      expect(opened.data.toString("utf8")).toContain("+line 20");
    } finally {
      await upstreams.close();
    }
  });
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
