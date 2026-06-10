import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

import { describe, expect, it } from "vitest";

import { loadPolicy } from "../../src/config/loader.js";
import type { RelayPolicy } from "../../src/policy/policy.js";
import { ToolRouter } from "../../src/router/tools-call.js";
import { AuditLog } from "../../src/state/audit.js";
import { UpstreamManager } from "../../src/upstream/manager.js";
import { buildRegistry } from "../../src/upstream/registry.js";
import { enableBatchTools } from "../support/batch-policy.js";

const execFileAsync = promisify(execFile);

const fixturesRoot = path.join(process.cwd(), "fixtures", "projects");

const fixtureExpectations: Record<
  string,
  {
    languages?: string[];
    packageManagers?: string[];
    taskFileKinds?: string[];
    codegenKinds?: string[];
    databaseKinds?: string[];
  }
> = {
  empty: {},
  "plain-git": {},
  "node-npm-test": { languages: ["npm"] },
  "node-npm-no-scripts": { languages: ["npm"] },
  "node-tsconfig-no-typecheck": { languages: ["npm", "typescript"] },
  "pnpm-workspace": { languages: ["npm"], packageManagers: ["pnpm"] },
  "yarn-workspace": { languages: ["npm"], packageManagers: ["yarn"] },
  "bun-project": { languages: ["npm"], packageManagers: ["bun"] },
  "go-module": { languages: ["go"] },
  "rust-crate": { languages: ["rust"] },
  "python-uv": { languages: ["python"], packageManagers: ["uv"] },
  "python-pytest": { languages: ["python"] },
  "flutter-app": { languages: ["dart", "flutter"] },
  "dart-package": { languages: ["dart"] },
  "makefile-project": { taskFileKinds: ["task:make"] },
  "justfile-project": { taskFileKinds: ["task:just"] },
  "taskfile-project": { taskFileKinds: ["task:task"] },
  "codegen-openapi": { codegenKinds: ["codegen:openapi"] },
  "codegen-prisma": { databaseKinds: ["database:prisma"] },
  "ignored-hidden-protected": {},
};

describe("cross-project fixtures", () => {
  it.each(Object.keys(fixtureExpectations))(
    "runs the default tool flow against %s",
    async (fixtureName) => {
      const setup = await setupFixtureRouter(fixtureName);
      try {
        const caller = { clientId: `fixture-${fixtureName}` };

        const context = (await setup.router.call("workspace.context", {}, caller)) as any;
        expect(context).toMatchObject({
          ok: true,
          status: "ok",
          data: {
            status: "ok",
            capabilities: {
              editMode: "single",
              batchChange: false,
            },
            hostConstraints: {
              preferFixedTask: true,
              preferSmallPayload: true,
              editMode: "single",
            },
          },
        });

        const scan = (await setup.router.call("workspace.scan", { maxDepth: 6 }, caller)) as any;
        expect(scan).toMatchObject({
          ok: true,
          status: "ok",
          data: {
            status: "ok",
            project: { status: "ok" },
            next: { tool: "task.list" },
          },
        });
        expect(scan.data.languages).toEqual(
          expect.arrayContaining(fixtureExpectations[fixtureName].languages ?? []),
        );
        expect(scan.data.packageManagers).toEqual(
          expect.arrayContaining(fixtureExpectations[fixtureName].packageManagers ?? []),
        );
        expect(scan.data.taskFiles.map((file: any) => file.kind)).toEqual(
          expect.arrayContaining(fixtureExpectations[fixtureName].taskFileKinds ?? []),
        );
        expect(scan.data.codegen.map((file: any) => file.kind)).toEqual(
          expect.arrayContaining(fixtureExpectations[fixtureName].codegenKinds ?? []),
        );
        expect(scan.data.database.map((file: any) => file.kind)).toEqual(
          expect.arrayContaining(fixtureExpectations[fixtureName].databaseKinds ?? []),
        );

        await expect(
          setup.router.call(
            "fs.tree",
            { mode: "all", includeHidden: true, includeIgnored: true, maxEntries: 200 },
            caller,
          ),
        ).resolves.toMatchObject({
          ok: true,
          status: "ok",
          data: {
            status: "ok",
            skipped: expect.any(Object),
          },
        });
        const search = (await setup.router.call(
          "fs.search",
          { query: `webvibe fixture marker ${fixtureName}`, mode: "fixed", includeHidden: true },
          caller,
        )) as any;
        expect(search).toMatchObject({
          ok: true,
          status: "ok",
          data: {
            status: "ok",
            matches: [expect.objectContaining({ path: "fixture-marker.txt" })],
          },
        });
        const read = (await setup.router.call("fs.read", { path: "fixture-marker.txt" }, caller)) as any;
        expect(read).toMatchObject({
          ok: true,
          status: "ok",
          data: {
            status: "ok",
            files: [expect.objectContaining({ path: "fixture-marker.txt", exists: true })],
          },
        });

        const taskList = (await setup.router.call("task.list", {}, caller)) as any;
        expect(taskList).toMatchObject({
          ok: true,
          status: "ok",
          data: {
            status: "ok",
            tasks: {
              available: expect.any(Array),
              unavailable: expect.any(Array),
              candidates: expect.any(Array),
            },
          },
        });
        await expect(
          setup.router.call("task.explain", { taskId: "node.typecheck" }, caller),
        ).resolves.toMatchObject({
          ok: false,
          status: "unavailable",
          data: {
            status: "unavailable",
            taskId: "node.typecheck",
            next: expect.any(Object),
          },
        });
        await expect(
          setup.router.call("task.run", { taskId: "node.typecheck", timeoutSeconds: 1 }, caller),
        ).resolves.toMatchObject({
          ok: false,
          status: "unavailable",
          data: {
            status: "unavailable",
            taskId: "node.typecheck",
            next: { tool: "manual.prepare" },
          },
        });

        const before = await readFile(path.join(setup.root, "fixture-marker.txt"), "utf8");
        const changeArgs = {
          changes: [
            {
              op: "edit",
              path: "fixture-marker.txt",
              expectedSha256: sha256(before),
              edits: [{ oldText: "initial", newText: "changed" }],
            },
          ],
        };
        const preview = (await setup.router.call("file.change_preview", changeArgs, caller)) as any;
        expect(preview).toMatchObject({
          ok: true,
          status: "ok",
          data: {
            valid: true,
            risk: { recommendedRoute: { tool: "file.change_apply" } },
          },
        });
        await expect(
          setup.router.call(
            "file.change_apply",
            { ...changeArgs, previewHash: preview.data.previewHash },
            caller,
          ),
        ).resolves.toMatchObject({
          ok: true,
          status: "ok",
          data: {
            applied: true,
            verified: true,
          },
        });
        await expect(readFile(path.join(setup.root, "fixture-marker.txt"), "utf8")).resolves.toContain(
          "changed",
        );

        const operationId = `fixture-${fixtureName}`;
        const prepared = (await setup.router.call(
          "manual.prepare",
          {
            operation: { id: operationId, kind: "external" },
            originalRequestSummary: `Fixture flow manual checkpoint for ${fixtureName}.`,
            interruptedAt: "other",
            verificationPlan: [{ kind: "none", description: "Fixture flow checkpoint." }],
            nextAfterResume: { tool: "workspace.context", reason: "Refresh after fixture checkpoint." },
          },
          caller,
        )) as any;
        expect(prepared).toMatchObject({
          ok: true,
          status: "ok",
          data: {
            structuredContent: {
              status: "prepared",
              operationId,
              gateTool: "manual.gate",
            },
          },
        });
        const gate = (await setup.router.call(
          "manual.gate",
          {
            preparedId: prepared.data.structuredContent.preparedId,
            reason: "external_manual_step",
            manualFormatVersion: "WEBVIBE_MANUAL_REQUIRED v1",
            manualMessageHash: `sha256:${sha256(`fixture manual instruction ${fixtureName}`)}`,
            operation: { id: operationId, kind: "external" },
          },
          caller,
        )) as any;
        expect(gate).toMatchObject({
          ok: true,
          status: "ok",
          data: {
            structuredContent: {
              status: "awaiting_manual_completion",
              operationId,
              resumeTool: "manual.resume",
            },
          },
        });
        await expect(
          setup.router.call("manual.resume", { resumeMessage: `/resume ${operationId}` }, caller),
        ).resolves.toMatchObject({
          ok: true,
          status: "confirmed",
          data: {
            status: "confirmed",
            next: { mode: "resume_interrupted_workflow" },
          },
        });

        await expect(setup.router.call("diagnostics.health", {}, caller)).resolves.toMatchObject({
          ok: true,
          status: "ok",
          data: {
            status: "ok",
            toolSurface: { tools: expect.not.arrayContaining(["batch.change_apply"]) },
          },
        });
      } finally {
        await setup.close();
      }
    },
  );

  it("simulates batch-enabled preview, apply, artifact, and manual fallback", async () => {
    const setup = await setupFixtureRouter("node-npm-no-scripts", { batch: true });
    try {
      const caller = { clientId: "batch-fixture" };
      await writeFile(path.join(setup.root, "a.txt"), "alpha\n");
      await writeFile(path.join(setup.root, "b.txt"), "bravo\n");
      await setup.router.call("workspace.context", {}, caller);

      const previewArgs = {
        changes: [
          {
            op: "edit",
            path: "a.txt",
            expectedSha256: sha256("alpha\n"),
            edits: [{ oldText: "alpha", newText: "ALPHA" }],
          },
          {
            op: "edit",
            path: "b.txt",
            expectedSha256: sha256("bravo\n"),
            edits: [{ oldText: "bravo", newText: "BRAVO" }],
          },
        ],
      };
      const preview = (await setup.router.call("batch.change_preview", previewArgs, caller)) as any;
      expect(preview).toMatchObject({
        ok: true,
        status: "ok",
        data: {
          summary: { total: 2, edits: 2 },
          risk: { recommendedRoute: { tool: "batch.change_apply" } },
        },
      });
      await expect(
        setup.router.call(
          "batch.change_apply",
          { ...previewArgs, previewHash: preview.data.previewHash },
          caller,
        ),
      ).resolves.toMatchObject({
        ok: true,
        status: "ok",
        data: {
          applied: true,
          verified: true,
        },
      });
      await expect(readFile(path.join(setup.root, "a.txt"), "utf8")).resolves.toBe("ALPHA\n");
      await expect(readFile(path.join(setup.root, "b.txt"), "utf8")).resolves.toBe("BRAVO\n");

      setup.policy.limits.change.maxInlineDiffBytes = 80;
      setup.policy.limits.change.maxInlineDiffLines = 3;
      await setup.router.call("workspace.context", {}, caller);
      await writeFile(path.join(setup.root, "large.txt"), "old\n");
      const largeContent = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join("\n") + "\n";
      const largeArgs = {
        changes: [
          {
            op: "replace",
            path: "large.txt",
            expectedSha256: sha256("old\n"),
            content: largeContent,
          },
        ],
      };
      const largePreview = (await setup.router.call("batch.change_preview", largeArgs, caller)) as any;
      expect(largePreview).toMatchObject({
        ok: true,
        status: "ok",
        truncated: true,
        data: {
          hostRisk: "high",
          risk: {
            manualFirst: true,
            recommendedRoute: { tool: "manual.prepare" },
          },
          diffInfo: {
            truncated: true,
            artifact: expect.objectContaining({ mimeType: "text/x-diff" }),
          },
          manualPlan: { next: { tool: "manual.prepare" } },
        },
        artifacts: [expect.objectContaining({ mimeType: "text/x-diff" })],
      });
      const blockedApply = (await setup.router.call(
        "batch.change_apply",
        { ...largeArgs, previewHash: largePreview.data.previewHash },
        caller,
      )) as any;
      expect(blockedApply).toMatchObject({
        ok: false,
        status: "blocked",
        data: {
          status: "blocked",
          applied: false,
          hostRisk: "high",
          manualPlan: { next: { tool: "manual.prepare" } },
        },
      });

      const prepared = (await setup.router.call(
        "manual.prepare",
        {
          operation: { id: "batch-blocked-change", kind: "change" },
          originalRequestSummary: "Batch change was blocked as high host risk.",
          interruptedAt: "edit",
          verificationPlan: [{ kind: "none", description: "Manual batch fallback checkpoint." }],
          nextAfterResume: { tool: "workspace.context", reason: "Refresh after manual batch fallback." },
        },
        caller,
      )) as any;
      await setup.router.call(
        "manual.gate",
        {
          preparedId: prepared.data.structuredContent.preparedId,
          reason: "manual_review_requested",
          manualFormatVersion: "WEBVIBE_MANUAL_REQUIRED v1",
          manualMessageHash: `sha256:${sha256("batch blocked manual fallback")}`,
          operation: { id: "batch-blocked-change", kind: "change" },
          hostObservation: {
            toolName: "batch.change_apply",
            outputText: "batch change blocked by high host risk",
          },
        },
        caller,
      );
      await expect(
        setup.router.call("manual.resume", { resumeMessage: "/resume batch-blocked-change" }, caller),
      ).resolves.toMatchObject({
        ok: true,
        status: "confirmed",
      });
    } finally {
      await setup.close();
    }
  });
});

async function setupFixtureRouter(
  fixtureName: string,
  options: { batch?: boolean } = {},
): Promise<{
  root: string;
  stateDir: string;
  policy: RelayPolicy;
  router: ToolRouter;
  close: () => Promise<void>;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), `webvibe-fixture-${fixtureName}-`));
  await cp(path.join(fixturesRoot, fixtureName), root, { recursive: true });
  if (fixtureName === "plain-git") await initGit(root);
  await writeFile(
    path.join(root, "fixture-marker.txt"),
    `webvibe fixture marker ${fixtureName}\ninitial\n`,
  );

  const stateDir = path.join(root, "state");
  const policy = await loadPolicy("policies/dev.yaml", { workspaceRoot: root, stateDir });
  if (options.batch) enableBatchTools(policy);
  const upstreams = new UpstreamManager(policy, root);
  await upstreams.connectAll();
  const router = new ToolRouter({
    registry: buildRegistry(policy, upstreams),
    policy,
    upstreams,
    audit: new AuditLog(path.join(stateDir, "audit.log"), policy.audit),
    workspaceRoot: root,
    stateDir,
    publicBaseUrl: "http://localhost",
  });
  return {
    root,
    stateDir,
    policy,
    router,
    close: () => upstreams.close(),
  };
}

async function initGit(root: string): Promise<void> {
  try {
    await execFileAsync("git", ["init"], { cwd: root });
  } catch {
    // Git presence is not required for the fixture matrix.
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
