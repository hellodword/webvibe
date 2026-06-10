import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadPolicy } from "../../src/config/loader.js";
import { ToolRouter } from "../../src/router/tools-call.js";
import { AuditLog } from "../../src/state/audit.js";
import { UpstreamManager } from "../../src/upstream/manager.js";
import { buildRegistry } from "../../src/upstream/registry.js";

describe("change.preview", () => {
  it("previews a batch change without writing and rejects stale tool names", async () => {
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
        "change.preview",
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
    } finally {
      await upstreams.close();
    }
  });
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
