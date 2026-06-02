import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { defaultPolicyPaths } from "../../src/config/defaults.js";
import { helpText, loadRuntimeConfig, parseCliArgs } from "../../src/config/loader.js";
import { main } from "../../src/main.js";
import { writeFakePolicy } from "../support/policy.js";

describe("scaffold", () => {
  it("parses config CLI flags and help", () => {
    expect(parseCliArgs(["--config", "./config.yaml"])).toEqual({ config: "./config.yaml" });
    expect(parseCliArgs(["--config=./config.yaml"])).toEqual({ config: "./config.yaml" });
    expect(parseCliArgs(["--help"])).toEqual({ help: true });
    expect(helpText()).toContain("Usage: webvibe --config <path>");
  });

  it("requires a config file", async () => {
    await expect(loadRuntimeConfig({})).rejects.toThrow("Missing required --config");
  });

  it("prints help without loading config", async () => {
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
  });

  it("uses server mode to select a built-in policy", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-config-"));
    const configPath = path.join(root, "config.yaml");
    await writeFile(
      configPath,
      `version: 1
server:
  mode: "dev"
workspace:
  root: "."
auth:
  pairingCode: "123456"
`,
    );

    const runtime = await loadRuntimeConfig({ config: configPath });
    expect(runtime.workspaceRoot).toBe(root);
    expect(runtime.policyPath).toBe(defaultPolicyPaths.dev);
  });

  it("rejects configs with server mode and server policy", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-config-"));
    const policyPath = await writeFakePolicy(root);
    const configPath = path.join(root, "config.yaml");
    await writeFile(
      configPath,
      `version: 1
server:
  mode: "dev"
  policy: "${policyPath}"
auth:
  pairingCode: "123456"
`,
    );

    await expect(loadRuntimeConfig({ config: configPath })).rejects.toThrow(
      "server.mode and server.policy are mutually exclusive",
    );
  });

  it("rejects top-level policy config", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-config-"));
    const policyPath = await writeFakePolicy(root);
    const configPath = path.join(root, "config.yaml");
    await writeFile(
      configPath,
      `version: 1
server:
  mode: "dev"
auth:
  pairingCode: "123456"
policy:
  path: "${policyPath}"
`,
    );

    await expect(loadRuntimeConfig({ config: configPath })).rejects.toThrow("Unrecognized key");
  });
});
