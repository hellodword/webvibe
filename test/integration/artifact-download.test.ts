import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { OAuthStore } from "../../src/auth/oauth-store.js";
import { PairingManager } from "../../src/auth/pairing.js";
import { loadPolicy } from "../../src/config/loader.js";
import { ManualArtifactStore } from "../../src/manual/artifact-store.js";
import { startHttpServer } from "../../src/server/http.js";
import { UpstreamManager } from "../../src/upstream/manager.js";

describe("manual artifact downloads", () => {
  it("serves review artifacts only with a valid unexpired token", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-artifact-"));
    const stateDir = path.join(root, "state");
    const policy = await loadPolicy("policies/dev.yaml", { workspaceRoot: root, stateDir });
    const artifactStore = new ManualArtifactStore(stateDir);
    const artifact = await artifactStore.create({
      label: "Workspace change preview diff",
      filename: "workspace-change-preview.diff",
      mimeType: "text/x-diff",
      content: "--- a/code.txt\n+++ b/code.txt\n@@ -1 +1 @@\n-old\n+new\n",
      createdByTool: "change.preview",
      operationId: "op",
      publicBaseUrl: "http://artifact.test",
    });
    const artifactUrl = new URL(artifact.ref.downloadUrl);
    const store = OAuthStore.atStateDir(stateDir);
    await store.load();
    const pairing = new PairingManager({ pairingCode: "123456" });
    await pairing.load();
    const upstreams = new UpstreamManager(policy, root);
    await upstreams.connectAll();
    const server = await startHttpServer({
      listen: { host: "127.0.0.1", port: 0 },
      publicBaseUrl: "http://127.0.0.1:0",
      workspaceRoot: root,
      stateDir,
      policy,
      upstreams,
      store,
      pairing,
      accessTokenTtlDays: 1,
    });
    try {
      const base = baseUrl(server.server.address());
      const good = await fetch(`${base}${artifactUrl.pathname}${artifactUrl.search}`);
      expect(good.status).toBe(200);
      expect(good.headers.get("content-type")).toContain("text/x-diff");
      expect(await good.text()).toContain("new");

      const wrong = await fetch(`${base}${artifactUrl.pathname}?t=wrong`);
      expect(wrong.status).toBe(403);

      const traversal = await fetch(`${base}/manual-artifacts/..%2Fbad?t=wrong`);
      expect(traversal.status).toBe(404);

      const artifactId = artifact.ref.artifactId;
      const metadata = (await artifactStore.readMetadata(artifactId))!;
      await artifactStore.saveMetadata({
        ...metadata,
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      });
      const expired = await fetch(`${base}${artifactUrl.pathname}${artifactUrl.search}`);
      expect(expired.status).toBe(403);

      const auditText = await readFile(path.join(stateDir, "audit.log"), "utf8");
      expect(auditText).toContain("manual.artifact.download");
      expect(auditText).not.toContain(artifactUrl.searchParams.get("t")!);
    } finally {
      await server.close();
      await upstreams.close();
    }
  });
});

function baseUrl(address: ReturnType<import("node:http").Server["address"]>): string {
  if (typeof address !== "object" || !address) throw new Error("No server address");
  return `http://127.0.0.1:${address.port}`;
}
