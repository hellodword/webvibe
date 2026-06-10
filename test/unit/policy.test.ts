import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadPolicy } from "../../src/config/loader.js";
import { normalizeDescriptor } from "../../src/descriptor/normalize.js";

describe("default policies", () => {
  it("selects default modes and keeps the default tool boundary narrow", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-policy-"));
    const readOnly = await loadPolicy("policies/read-only.yaml", {
      workspaceRoot: root,
      stateDir: path.join(root, "state"),
    });
    const dev = await loadPolicy("policies/dev.yaml", {
      workspaceRoot: root,
      stateDir: path.join(root, "state"),
    });

    expect(readOnly.version).toBe(2);
    expect(dev.version).toBe(2);
    expect(readOnly.mode).toBe("read-only");
    expect(dev.mode).toBe("dev");
    expect(dev.activeProfile).toBe("chatgptWebDefault");
    expect(readOnly.editMode).toEqual({ mode: "single", batch: { enabled: false } });
    expect(dev.editMode).toEqual({ mode: "single", batch: { enabled: false } });
    expect(dev.profiles.chatgptWebDefault).toBeTruthy();
    const readOnlyTools = readOnly.tools.map((tool) => tool.name);
    const devTools = dev.tools.map((tool) => tool.name);

    expect(readOnlyTools).toEqual([
      "workspace.context",
      "workspace.scan",
      "workspace.symbols",
      "fs.tree",
      "fs.search",
      "fs.read",
      "fs.read_many",
      "fs.stat",
      "fs.manifest",
      "git.status",
      "git.changed",
      "git.diff",
      "git.show",
      "git.blame",
      "git.commit_preview",
      "diagnostics.health",
    ]);
    expect(devTools).toEqual([
      "workspace.context",
      "workspace.scan",
      "workspace.symbols",
      "fs.tree",
      "fs.search",
      "fs.read",
      "fs.read_many",
      "fs.stat",
      "fs.manifest",
      "file.change_preview",
      "manual.prepare",
      "manual.gate",
      "manual.status",
      "manual.resume",
      "file.change_apply",
      "task.list",
      "task.run",
      "task.result",
      "git.status",
      "git.changed",
      "git.diff",
      "git.show",
      "git.blame",
      "git.commit_preview",
      "git.commit",
      "diagnostics.health",
    ]);
    expect(devTools).not.toEqual(
      expect.arrayContaining([
        "context.get",
        "read.tree",
        "read.search",
        "read.files",
        "read.stat",
        "change.preview",
        "change.apply",
        "batch.change_preview",
        "batch.change_apply",
        "change.plan",
        "change.prepare",
        "git.history",
      ]),
    );
    expect(devTools.filter((name) => name.startsWith("fs.") && /write|edit|create/.test(name))).toEqual(
      [],
    );
    expect(devTools.filter((name) => /applyPrepared|applyById/.test(name))).toEqual([]);
    expect(dev.upstreams.tasks.transport).toBe("local-task-runner");
    expect(devTools.filter((name) => /pnpm|yarn|bun|poetry|maven|gradle|dotnet|ruby|php/.test(name))).toEqual(
      [],
    );
    const readOnlyReadMany = normalizeDescriptor(readOnly.tools.find((tool) => tool.name === "fs.read_many")!);
    const devReadMany = normalizeDescriptor(dev.tools.find((tool) => tool.name === "fs.read_many")!);
    for (const descriptor of [readOnlyReadMany, devReadMany]) {
      const schema = descriptor.inputSchema as any;
      expect(Object.keys(schema.properties)).toEqual(["files", "maxBytesPerFile"]);
      expect(schema.properties.maxBytesPerFile).toEqual({
        type: "integer",
        minimum: 1,
        maximum: 131072,
      });
      expect(schema.required).toEqual(["files"]);
      expect(schema.additionalProperties).toBe(false);
    }
    const devRead = normalizeDescriptor(dev.tools.find((tool) => tool.name === "fs.read")!);
    expect((devRead.inputSchema as any).properties.byteOffset).toEqual({
      type: "integer",
      minimum: 0,
    });
    expect(
      readOnly.tools
        .filter((tool) => tool.name.startsWith("git."))
        .every((tool) => tool.type === "builtIn" && tool.outputSchema),
    ).toBe(true);
    expect(
      dev.tools
        .filter((tool) => tool.name.startsWith("task."))
        .every((tool) => tool.outputSchema),
    ).toBe(true);
    expect(dev.tools.filter((tool) => tool.name.startsWith("task."))).toHaveLength(3);
    expect(dev.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["manual.prepare", "manual.status"]),
    );
    const defaultTasks = Object.values(dev.upstreams.tasks.tasks ?? {}) as Array<Record<string, unknown>>;
    expect(defaultTasks.every((task) => !("requiredFiles" in task))).toBe(true);
    expect(defaultTasks.every((task) => !("requiredPackageScript" in task))).toBe(true);
    const taskRun = normalizeDescriptor(dev.tools.find((tool) => tool.name === "task.run")!);
    expect((taskRun.inputSchema as any).properties.cwd).toEqual({
      type: "string",
      minLength: 1,
      maxLength: 500,
    });
    expect(dev.limits.output).toMatchObject({
      preferredToolOutputBytes: 12000,
      maxToolOutputBytes: 60000,
    });
    expect(dev.limits.read).toMatchObject({
      defaultMaxBytes: 12000,
      maxBytes: 131072,
      maxReadManyFiles: 50,
    });
    expect(dev.limits.change).toMatchObject({
      maxFiles: 1000,
      defaultMaxFiles: 200,
      maxTotalBytes: 16 * 1024 * 1024,
      maxTextFileBytes: 2 * 1024 * 1024,
    });
    expect(dev.audit.payloads).toBe("full-redacted");

    expect(dev.tools.find((tool) => tool.name === "manual.confirm")).toBeUndefined();
    const manualResume = dev.tools.find((tool) => tool.name === "manual.resume")!;
    expect((manualResume._meta as any).ui).toBeUndefined();
    expect((manualResume._meta as any)["openai/widgetAccessible"]).toBeUndefined();
    expect((manualResume.inputSchema as any).properties.resumeMessage.maxLength).toBe(2000);
    expect((manualResume.inputSchema as any).properties.manualLogPath).toBeUndefined();
    expect((manualResume.inputSchema as any).properties.manualOutput).toBeUndefined();
    expect((manualResume.inputSchema as any).properties.manualOutputFormat).toBeUndefined();
    expect((manualResume.inputSchema as any).properties.evidenceNote).toBeUndefined();
    expect((manualResume.outputSchema as any).properties.status.enum).toContain("blocked");
    expect((manualResume.outputSchema as any).properties.evidence.type).toBe("object");
    expect((manualResume.outputSchema as any).properties.next.properties.followUpPrompt.type).toBe(
      "string",
    );
    expect((manualResume.outputSchema as any).properties.next.properties.mode.enum).toEqual([
      "await_resume_command",
      "resume_interrupted_workflow",
    ]);
    expect(
      (manualResume.outputSchema as any).properties.next.properties.verifyBeforeContinuing.type,
    ).toBe("boolean");
    const manualGate = normalizeDescriptor(dev.tools.find((tool) => tool.name === "manual.gate")!);
    const manualPrepare = normalizeDescriptor(dev.tools.find((tool) => tool.name === "manual.prepare")!);
    expect((manualPrepare.inputSchema as any).properties.command).toBeUndefined();
    expect((manualPrepare.inputSchema as any).properties.diff).toBeUndefined();
    expect((manualPrepare.inputSchema as any).properties.stdout).toBeUndefined();
    expect((manualPrepare.inputSchema as any).properties.stderr).toBeUndefined();
    expect((manualPrepare.inputSchema as any).properties.verificationPlan).toBeTruthy();
    expect((manualGate._meta as any).ui).toBeUndefined();
    expect((manualGate._meta as any)["openai/outputTemplate"]).toBeUndefined();
    expect((manualGate._meta as any)["openai/widgetAccessible"]).toBeUndefined();
    expect((manualGate.inputSchema as any).properties.reason.enum).toEqual([
      "openai_safety_block",
      "manual_review_requested",
      "external_manual_step",
    ]);
    expect((manualGate.inputSchema as any).required).toEqual([
      "reason",
      "manualFormatVersion",
      "manualMessageHash",
      "operation",
    ]);
    expect((manualGate.inputSchema as any).properties.manualFormatVersion.enum).toEqual([
      "WEBVIBE_MANUAL_REQUIRED v1",
    ]);
    expect((manualGate.inputSchema as any).properties.operation.required).toEqual(["id", "kind"]);
    expect((manualGate.outputSchema as any).properties.reason.enum).toEqual([
      "openai_safety_block",
      "manual_review_requested",
      "external_manual_step",
    ]);
    expect((manualGate.inputSchema as any).properties.title).toBeUndefined();
    expect((manualGate.inputSchema as any).properties.instructions).toBeUndefined();
    expect((manualGate.outputSchema as any).properties.title).toBeUndefined();
    expect((manualGate.outputSchema as any).properties.detailUrl).toBeUndefined();
    expect(
      (manualGate.outputSchema as any).properties.continuation.properties.mode.enum,
    ).toEqual(["await_resume_command"]);
    expect(
      (manualGate.outputSchema as any).properties.continuation.properties.mustEndTurn.type,
    ).toBe("boolean");
    expect(
      (dev.tools.find((tool) => tool.name === "task.run")!.outputSchema as any).properties
        .manualRequired.properties.nextTool.enum,
    ).toEqual(["manual.gate"]);
    expect(
      (dev.tools.find((tool) => tool.name === "task.run")!.outputSchema as any).properties
        .manualRequired.properties.title,
    ).toBeUndefined();
    expect(
      (dev.tools.find((tool) => tool.name === "task.run")!.outputSchema as any).properties
        .manualRequired.properties.instructions,
    ).toBeUndefined();
    expect(
      (dev.tools.find((tool) => tool.name === "task.run")!.outputSchema as any).properties
        .manualRequired.properties.userInstructions.type,
    ).toBe("string");
    const applySchema = dev.tools.find((tool) => tool.name === "file.change_apply")!.inputSchema as any;
    expect(applySchema.properties.preparedId).toBeUndefined();
    expect(applySchema.properties.changes.maxItems).toBe(1);
  });

  it("keeps nested JSON schema required and primitive fields valid when capping depth", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-policy-schema-"));
    const dev = await loadPolicy("policies/dev.yaml", {
      workspaceRoot: root,
      stateDir: path.join(root, "state"),
    });
    const preview = dev.tools.find((tool) => tool.name === "file.change_preview");
    expect(preview).toBeTruthy();
    const descriptor = normalizeDescriptor(preview!);
    const schema = descriptor.inputSchema as any;
    const editItem =
      schema.properties.changes.items.properties.edits.items;

    expect(editItem.properties.oldText).toEqual({ type: "string" });
    expect(editItem.properties.newText).toEqual({ type: "string" });
    expect(editItem.required).toEqual(["oldText", "newText"]);
  });

  it("merges profile defaults with explicit nested limit overrides", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-policy-v2-"));
    const policyPath = path.join(root, "policy.yaml");
    await writeFile(
      policyPath,
      `version: 2
profile: custom
profiles:
  custom:
    limits:
      output:
        maxToolOutputBytes: 45000
      read:
        defaultMaxBytes: 100
        maxBytes: 1000
tools:
  - name: workspace.context
    type: builtIn
limits:
  output:
    preferredToolOutputBytes: 12345
  rate:
    maxCallsPerMinute: 9
`,
    );

    const policy = await loadPolicy(policyPath, {
      workspaceRoot: root,
      stateDir: path.join(root, "state"),
    });

    expect(policy.activeProfile).toBe("custom");
    expect(policy.limits.output).toMatchObject({
      preferredToolOutputBytes: 12345,
      maxToolOutputBytes: 45000,
    });
    expect(policy.limits.read).toMatchObject({
      defaultMaxBytes: 100,
      maxBytes: 1000,
    });
    expect(policy.limits.rate.maxCallsPerMinute).toBe(9);
    expect(policy.limits.search.defaultMaxResults).toBe(80);
  });

  it("rejects invalid effective limits", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-policy-invalid-"));
    const policyPath = path.join(root, "policy.yaml");
    await writeFile(
      policyPath,
      `version: 2
tools:
  - name: workspace.context
    type: builtIn
limits:
  output:
    preferredToolOutputBytes: 70000
    maxToolOutputBytes: 60000
`,
    );

    await expect(
      loadPolicy(policyPath, {
        workspaceRoot: root,
        stateDir: path.join(root, "state"),
      }),
    ).rejects.toThrow(/preferredToolOutputBytes/);
  });
});
