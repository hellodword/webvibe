import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadPolicy } from "../../src/config/loader.js";
import { normalizeDescriptor } from "../../src/descriptor/normalize.js";

describe("default policies", () => {
  it("keeps preset upstream details outside src and selects expected modes", async () => {
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
    expect(readOnly.tools.map((tool) => tool.name)).toContain("fs.read_text_file");
    expect(readOnly.tools.map((tool) => tool.name)).not.toContain("fs.write_file");
    expect(dev.tools.map((tool) => tool.name)).toContain("fs.write_file");
    expect(dev.tools.map((tool) => tool.name)).toContain("task.npm_test");
    expect(dev.tools.map((tool) => tool.name)).toContain("task.npm_build");
    expect(dev.tools.map((tool) => tool.name)).toContain("task.cargo_clippy");
    expect(dev.tools.map((tool) => tool.name)).toContain("task.go_fmt_check");
    expect(Object.keys(dev.upstreams)).not.toContain(["desk", "top"].join(""));
    expect(JSON.stringify(dev)).not.toContain("execute_");
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
});
