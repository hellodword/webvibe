import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadRuntimeConfig, parseCliArgs } from "../../src/config/loader.js";
import { writeFakePolicy } from "../support/policy.js";

describe("scaffold", () => {
  it("parses base CLI flags", () => {
    expect(
      parseCliArgs([
        "--mode",
        "dev",
        "--workspace",
        ".",
        "--public-base-url=http://127.0.0.1:3000",
        "--pairing-code",
        "123456",
      ]),
    ).toMatchObject({
      mode: "dev",
      workspace: ".",
      publicBaseUrl: "http://127.0.0.1:3000",
      pairingCode: "123456",
    });
  });

  it("applies CLI, config file, environment, and defaults in priority order", async () => {
    const previous = {
      WEBVIBE_LISTEN: process.env.WEBVIBE_LISTEN,
      WEBVIBE_WORKSPACE: process.env.WEBVIBE_WORKSPACE,
      WEBVIBE_POLICY: process.env.WEBVIBE_POLICY,
    };
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-config-"));
    const policyPath = await writeFakePolicy(root);
    const configPath = path.join(root, "config.yaml");
    const fileWorkspace = path.join(root, "from-file");
    const cliWorkspace = path.join(root, "from-cli");
    await writeFile(
      configPath,
      `version: 1
server:
  listen: "127.0.0.1:4444"
workspace:
  root: "${fileWorkspace}"
`,
    );

    try {
      process.env.WEBVIBE_LISTEN = "127.0.0.1:3333";
      process.env.WEBVIBE_WORKSPACE = path.join(root, "from-env");
      process.env.WEBVIBE_POLICY = policyPath;

      const fileWins = await loadRuntimeConfig({ config: configPath });
      expect(fileWins.listen.port).toBe(4444);
      expect(fileWins.workspaceRoot).toBe(fileWorkspace);
      expect(fileWins.policyPath).toBe(policyPath);

      const cliWins = await loadRuntimeConfig({
        config: configPath,
        listen: "127.0.0.1:5555",
        workspace: cliWorkspace,
      });
      expect(cliWins.listen.port).toBe(5555);
      expect(cliWins.workspaceRoot).toBe(cliWorkspace);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
