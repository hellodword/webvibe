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
    expect(dev.limits.maxChangesetFiles).toBe(80);
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
