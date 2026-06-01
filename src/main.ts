#!/usr/bin/env node

import { mkdir } from "node:fs/promises";

import { OAuthStore } from "./auth/oauth-store.js";
import { PairingManager } from "./auth/pairing.js";
import { loadRuntimeConfig, parseCliArgs, type CliOptions } from "./config/loader.js";
import { startHttpServer, type WebvibeServer } from "./server/http.js";
import { UpstreamManager } from "./upstream/manager.js";

export type RunningWebvibe = {
  http: WebvibeServer;
  upstreams: UpstreamManager;
  close(): Promise<void>;
};

export async function runWebvibe(cli: CliOptions): Promise<RunningWebvibe> {
  const runtime = await loadRuntimeConfig(cli);
  await mkdir(runtime.stateDir, { recursive: true, mode: 0o700 });
  const pairing = new PairingManager({
    stateDir: runtime.stateDir,
    pairingCode: runtime.config.auth.pairingCode,
    pairingCodeFile: runtime.config.auth.pairingCodeFile,
  });
  await pairing.load();
  const store = OAuthStore.atStateDir(runtime.stateDir);
  await store.load();
  const upstreams = new UpstreamManager(runtime.policy, runtime.workspaceRoot);
  await upstreams.connectAll();
  const http = await startHttpServer({
    listen: runtime.listen,
    publicBaseUrl: runtime.publicBaseUrl,
    workspaceRoot: runtime.workspaceRoot,
    stateDir: runtime.stateDir,
    policy: runtime.policy,
    upstreams,
    store,
    pairing,
    accessTokenTtlDays: runtime.config.auth.accessTokenTtlDays,
  });
  return {
    http,
    upstreams,
    close: async () => {
      await http.close();
      await upstreams.close();
    },
  };
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const running = await runWebvibe(parseCliArgs(args));
  const address = running.http.server.address();
  const printable =
    typeof address === "object" && address
      ? `${address.address}:${address.port}`
      : String(address ?? "unknown");
  console.log(`webvibe listening on ${printable}`);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      running
        .close()
        .finally(() => process.exit(signal === "SIGINT" ? 130 : 143))
        .catch(() => process.exit(1));
    });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
