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

    expect(readOnlyTools).toContain("fs.read_text_file");
    expect(devTools).toEqual(
      expect.arrayContaining([
        "repo.file_manifest",
        "repo.preview_changeset",
        "repo.apply_changeset",
        "task.npm_test",
        "task.npm_build",
        "task.cargo_clippy",
        "task.go_fmt_check",
      ]),
    );
    expect(devTools.filter((name) => name.startsWith("fs.") && /write|edit|create/.test(name))).toEqual(
      [],
    );
    expect(dev.upstreams.tasks.transport).toBe("local-task-runner");
    expect(
      readOnly.tools
        .filter((tool) => tool.name.startsWith("git."))
        .every((tool) => tool.outputSchema),
    ).toBe(true);
    expect(
      dev.tools
        .filter((tool) => tool.name.startsWith("task."))
        .every((tool) => tool.outputSchema),
    ).toBe(true);
    expect(dev.limits.maxChangesetFiles).toBe(80);
  });

  it("adds output schemas to built-in relay descriptors", () => {
    expect(normalizeDescriptor({ name: "relay.info", type: "builtIn" })).toMatchObject({
      outputSchema: {
        type: "object",
        required: ["name", "tools"],
      },
    });
    expect(normalizeDescriptor({ name: "relay.list_upstreams", type: "builtIn" })).toMatchObject({
      outputSchema: {
        type: "object",
        required: ["upstreams"],
      },
    });
    expect(normalizeDescriptor({ name: "relay.list_tools", type: "builtIn" })).toMatchObject({
      outputSchema: {
        type: "object",
        required: ["tools"],
      },
    });
  });

  it("keeps nested JSON schema required and primitive fields valid when capping depth", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-policy-schema-"));
    const dev = await loadPolicy("policies/dev.yaml", {
      workspaceRoot: root,
      stateDir: path.join(root, "state"),
    });
    const preview = dev.tools.find((tool) => tool.name === "repo.preview_changeset");
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
