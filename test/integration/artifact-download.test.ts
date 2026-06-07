import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { OAuthStore } from "../../src/auth/oauth-store.js";
import { PairingManager } from "../../src/auth/pairing.js";
import { loadPolicy } from "../../src/config/loader.js";
import { ManualArtifactStore } from "../../src/manual/artifact-store.js";
import { startHttpServer } from "../../src/server/http.js";
import { AuditLog } from "../../src/state/audit.js";
import { UpstreamManager } from "../../src/upstream/manager.js";
import { prepareChangeset } from "../../src/workspace/changeset.js";

describe("manual artifact downloads", () => {
  it("serves prepared review material only with a valid unexpired token", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-artifact-"));
    const stateDir = path.join(root, "state");
    await writeFile(path.join(root, "code.txt"), "old\n");
    const policy = await loadPolicy("policies/dev.yaml", { workspaceRoot: root, stateDir });
    const audit = new AuditLog(path.join(stateDir, "audit.log"), policy.audit);
    const prepared = await prepareChangeset(
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
      {
        workspaceRoot: root,
        workspace: policy.workspace,
        limits: policy.limits,
        stateDir,
        publicBaseUrl: "http://artifact.test",
        audit,
      },
    );
    const artifactUrl = new URL(prepared.manualGate!.artifacts[0].downloadUrl);
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

      const artifactId = prepared.manualGate!.artifacts[0].artifactId;
      const artifactStore = new ManualArtifactStore(stateDir);
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

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
