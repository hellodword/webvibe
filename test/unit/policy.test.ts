import { mkdtemp } from "node:fs/promises";
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

    expect(readOnly.mode).toBe("read-only");
    expect(dev.mode).toBe("dev");
    const readOnlyTools = readOnly.tools.map((tool) => tool.name);
    const devTools = dev.tools.map((tool) => tool.name);

    expect(readOnlyTools).toEqual([
      "context.get",
      "read.tree",
      "read.search",
      "read.files",
      "read.stat",
      "git.status",
      "git.diff",
      "git.history",
      "git.show",
      "diagnostics.health",
    ]);
    expect(devTools).toEqual([
      "context.get",
      "read.tree",
      "read.search",
      "read.files",
      "read.stat",
      "change.plan",
      "change.prepare",
      "manual.gate",
      "manual.confirm",
      "change.apply",
      "task.run",
      "git.status",
      "git.diff",
      "git.history",
      "git.show",
      "git.commit",
      "diagnostics.health",
    ]);
    expect(devTools.filter((name) => name.startsWith("fs.") && /write|edit|create/.test(name))).toEqual(
      [],
    );
    expect(devTools.filter((name) => /applyPrepared|applyById/.test(name))).toEqual([]);
    expect(dev.upstreams.tasks.transport).toBe("local-task-runner");
    expect(devTools.filter((name) => /pnpm|yarn|bun|poetry|maven|gradle|dotnet|ruby|php/.test(name))).toEqual(
      [],
    );
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
    expect(dev.tools.filter((tool) => tool.name.startsWith("task."))).toHaveLength(1);
    const defaultTasks = Object.values(dev.upstreams.tasks.tasks ?? {}) as Array<Record<string, unknown>>;
    expect(defaultTasks.every((task) => !("requiredFiles" in task))).toBe(true);
    expect(defaultTasks.every((task) => !("requiredPackageScript" in task))).toBe(true);
    const taskRun = normalizeDescriptor(dev.tools.find((tool) => tool.name === "task.run")!);
    expect((taskRun.inputSchema as any).properties.cwd).toEqual({
      type: "string",
      minLength: 1,
      maxLength: 500,
    });
    expect(dev.limits.maxChangesetFiles).toBe(80);
    expect(dev.audit.payloads).toBe("full-redacted");

    const manualConfirm = dev.tools.find((tool) => tool.name === "manual.confirm")!;
    expect((manualConfirm._meta as any).ui.visibility).toEqual(["app"]);
    expect((manualConfirm.inputSchema as any).properties.manualOutput.maxLength).toBe(20000);
    expect((manualConfirm.outputSchema as any).properties.next.properties.followUpPrompt.type).toBe(
      "string",
    );
    const manualGate = normalizeDescriptor(dev.tools.find((tool) => tool.name === "manual.gate")!);
    expect((manualGate._meta as any).ui.resourceUri).toBe("ui://webvibe/manual-gate.html");
    expect((manualGate._meta as any)["openai/outputTemplate"]).toBe(
      "ui://webvibe/manual-gate.html",
    );
    expect((manualGate._meta as any)["openai/widgetAccessible"]).toBe(true);
    expect((manualGate.outputSchema as any).properties.detailUrl.type).toBe("string");
    expect(
      (dev.tools.find((tool) => tool.name === "task.run")!.outputSchema as any).properties
        .manualRequired.properties.nextTool.enum,
    ).toEqual(["manual.gate"]);
    const applySchema = dev.tools.find((tool) => tool.name === "change.apply")!.inputSchema as any;
    expect(applySchema.properties.preparedId).toBeUndefined();
    const devPolicyText = JSON.stringify(dev);
    expect(devPolicyText).not.toContain("preparedChangeId");
    expect(devPolicyText).not.toContain("hiddenPayloadId");
    expect(devPolicyText).not.toContain("serverSidePayloadId");
  });

  it("keeps context.get first and strongly described", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-policy-context-"));
    const dev = await loadPolicy("policies/dev.yaml", {
      workspaceRoot: root,
      stateDir: path.join(root, "state"),
    });
    const descriptor = normalizeDescriptor(dev.tools[0]);
    expect(descriptor.name).toBe("context.get");
    expect(descriptor.description).toContain("Call this first");
    expect(descriptor.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
  });

  it("keeps nested JSON schema required and primitive fields valid when capping depth", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-policy-schema-"));
    const dev = await loadPolicy("policies/dev.yaml", {
      workspaceRoot: root,
      stateDir: path.join(root, "state"),
    });
    const preview = dev.tools.find((tool) => tool.name === "change.plan");
    expect(preview).toBeTruthy();
    const descriptor = normalizeDescriptor(preview!);
    const schema = descriptor.inputSchema as any;
    const editItem =
      schema.properties.changes.items.properties.edits.items;

    expect(editItem.properties.oldText).toEqual({ type: "string" });
    expect(editItem.properties.newText).toEqual({ type: "string" });
    expect(editItem.required).toEqual(["oldText", "newText"]);
  });
});
