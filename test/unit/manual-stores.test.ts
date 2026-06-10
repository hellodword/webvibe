import { mkdtemp, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ManualArtifactStore } from "../../src/manual/artifact-store.js";
import { openManualGate } from "../../src/manual/gate.js";
import { ManualPendingStore } from "../../src/manual/pending-store.js";
import { PreparedManualActionStore } from "../../src/manual/prepared-store.js";
import { resumeManualAction } from "../../src/manual/resume.js";
import { defaultLimits, limitsPolicySchema } from "../../src/policy/schema.js";
import type { LimitsPolicy, WorkspacePolicy } from "../../src/policy/policy.js";

describe("manual action stores", () => {
  it("uses private file modes and random ids for pending, prepared, and artifact state", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-manual-store-"));
    const stateDir = path.join(root, "state");
    const context = testContext(root, stateDir);
    const gate = await openManualGate(
      gateArgs("manual_review_requested", "manual-store"),
      context,
    );
    const pendingStore = new ManualPendingStore(stateDir);
    const pendingFile = pendingStore.filePath(gate.structuredContent.pendingId);
    expect((await stat(pendingStore.dir)).mode & 0o777).toBe(0o700);
    expect((await stat(pendingFile)).mode & 0o777).toBe(0o600);
    expect(path.basename(pendingFile)).not.toContain("secret");

    const prepared = await new PreparedManualActionStore(stateDir).create({
      operationId: "op",
      createdByTool: "test",
      title: "Prepared user title src/secret.txt",
      instructions: "Review manually.",
      artifacts: [],
      checks: [],
    });
    const preparedStore = new PreparedManualActionStore(stateDir);
    const preparedFile = preparedStore.filePath(prepared.preparedId);
    expect((await stat(preparedStore.dir)).mode & 0o777).toBe(0o700);
    expect((await stat(preparedFile)).mode & 0o777).toBe(0o600);
    expect(path.basename(preparedFile)).not.toContain("secret");

    const artifactStore = new ManualArtifactStore(stateDir);
    const artifact = await artifactStore.create({
      label: "Label with src/secret.txt",
      filename: "workspace-change-preview.diff",
      mimeType: "text/x-diff",
      content: "review material",
      createdByTool: "test",
      operationId: "op",
      publicBaseUrl: "http://localhost",
    });
    expect(artifact.record.kind).toBe("manual");
    expect(artifact.ref.kind).toBe("manual");
    expect((await stat(artifactStore.dir)).mode & 0o777).toBe(0o700);
    expect((await stat(artifactStore.dataPath(artifact.record.artifactId))).mode & 0o777).toBe(
      0o600,
    );
    expect((await stat(artifactStore.metaPath(artifact.record.artifactId))).mode & 0o777).toBe(
      0o600,
    );
    expect(path.basename(artifactStore.metaPath(artifact.record.artifactId))).not.toContain("secret");
    await expect(pendingStore.read("../bad")).rejects.toThrow("invalid format");
  });

  it("requires /resume and handles expired manual actions", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-manual-expiry-"));
    const stateDir = path.join(root, "state");
    const context = testContext(root, stateDir);
    const gate = await openManualGate(
      gateArgs("manual_review_requested", "manual-expiry"),
      context,
    );
    const pendingId = gate.structuredContent.pendingId;

    await expect(
      resumeManualAction({ resumeMessage: "completed" }, context),
    ).resolves.toMatchObject({ status: "blocked", code: "RESUME_COMMAND_REQUIRED" });

    const store = new ManualPendingStore(stateDir);
    const record = (await store.read(pendingId))!;
    await store.save({ ...record, expiresAt: new Date(Date.now() - 1000).toISOString() });
    await expect(
      resumeManualAction({ resumeMessage: "/resume" }, context),
    ).resolves.toMatchObject({ status: "expired" });
  });

  it("stores prepared manual state without debug payloads", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-prepared-store-"));
    const stateDir = path.join(root, "state");
    const store = new PreparedManualActionStore(stateDir);
    const prepared = await store.create({
      operationId: "op",
      createdByTool: "test",
      title: "Prepared change",
      instructions: "Review manually.",
      artifacts: [],
      checks: [],
      debugPayload: { secret: "should not be written" },
    } as any);

    const saved = await store.read(prepared.preparedId);
    expect(saved).toMatchObject({
      operationId: "op",
      createdByTool: "test",
      title: "Prepared change",
      artifacts: [],
      checks: [],
    });
    expect(saved).not.toHaveProperty("debugPayload");
  });
});

function testContext(
  root: string,
  stateDir: string,
): {
  workspaceRoot: string;
  workspace: WorkspacePolicy;
  limits: LimitsPolicy;
  stateDir: string;
  publicBaseUrl: string;
  caller: { clientId: string };
} {
  return {
    workspaceRoot: root,
    workspace: { root, protected: [".env"] },
    limits: limitsPolicySchema.parse(defaultLimits),
    stateDir,
    publicBaseUrl: "http://localhost",
    caller: { clientId: "manual-store-test" },
  };
}

function gateArgs(
  reason: "openai_safety_block" | "manual_review_requested" | "external_manual_step",
  operationId: string,
): Record<string, unknown> {
  return {
    reason,
    manualFormatVersion: "WEBVIBE_MANUAL_REQUIRED v1",
    manualMessageHash: "sha256:" + "b".repeat(64),
    operation: { id: operationId, kind: "external" },
  };
}
