import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { defaultPolicyPaths } from "../../src/config/defaults.js";
import { helpText, loadRuntimeConfig, parseCliArgs } from "../../src/config/loader.js";
import { main } from "../../src/main.js";
import { writeFakePolicy } from "../support/policy.js";

describe("scaffold", () => {
  it("parses CLI flags and prints help without loading config", async () => {
    expect(parseCliArgs(["--config", "./config.yaml"])).toEqual({ config: "./config.yaml" });
    expect(parseCliArgs(["--config=./config.yaml"])).toEqual({ config: "./config.yaml" });
    expect(parseCliArgs(["--help"])).toEqual({ help: true });
    expect(helpText()).toContain("Usage: webvibe --config <path>");
    await expect(loadRuntimeConfig({})).rejects.toThrow("Missing required --config");

    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await main(["--help"]);
      expect(log).toHaveBeenCalledWith(helpText());
    } finally {
      log.mockRestore();
    }
  });

  it("loads runtime config from the config file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-config-"));
    const policyPath = await writeFakePolicy(root);
    const configPath = path.join(root, "config.yaml");
    const workspaceRoot = path.join(root, "workspace");
    const stateDir = path.join(root, "state");
    await writeFile(
      configPath,
      `version: 1
server:
  listen: "127.0.0.1:4444"
  stateDir: "${stateDir}"
  policy: "./policy.yaml"
workspace:
  root: "${workspaceRoot}"
auth:
  pairingCode: "123456"
`,
    );

    const runtime = await loadRuntimeConfig({ config: configPath });
    expect(runtime.listen.port).toBe(4444);
    expect(runtime.publicBaseUrl).toBe("http://127.0.0.1:4444");
    expect(runtime.workspaceRoot).toBe(workspaceRoot);
    expect(runtime.stateDir).toBe(stateDir);
    expect(runtime.policyPath).toBe(policyPath);
    expect(runtime.config.auth.accessTokenTtlDays).toBe(30);
    expect(runtime.config.auth.pairingFailures).toEqual({ maxAttempts: 5, windowSeconds: 600 });
  });

  it("uses server mode to select a built-in policy and rejects policy conflicts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-config-"));
    const modeConfigPath = path.join(root, "config.yaml");
    await writeFile(
      modeConfigPath,
      `version: 1
server:
  mode: "dev"
workspace:
  root: "."
auth:
  pairingCode: "123456"
`,
    );

    const runtime = await loadRuntimeConfig({ config: modeConfigPath });
    expect(runtime.workspaceRoot).toBe(root);
    expect(runtime.policyPath).toBe(defaultPolicyPaths.dev);

    const policyPath = await writeFakePolicy(root);
    const conflictConfigPath = path.join(root, "conflict.yaml");
    await writeFile(
      conflictConfigPath,
      `version: 1
server:
  mode: "dev"
  policy: "${policyPath}"
auth:
  pairingCode: "123456"
`,
    );

    await expect(loadRuntimeConfig({ config: conflictConfigPath })).rejects.toThrow(
      "server.mode and server.policy are mutually exclusive",
    );
  });
});
