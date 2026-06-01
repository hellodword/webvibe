import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse as parseToml } from "toml";
import { parse as parseYaml } from "yaml";

import { defaultPolicyPaths, defaultPublicBaseUrl } from "./defaults.js";
import { appConfigSchema, policySchema, type AppConfig } from "./schema.js";
import { interpolateValue } from "./interpolation.js";
import type { Mode, RelayPolicy } from "../policy/policy.js";
import { BadRequestError } from "../util/errors.js";
import { resolvePath } from "../util/paths.js";

export type CliOptions = {
  config?: string;
  mode?: Mode;
  policy?: string;
  workspace?: string;
  publicBaseUrl?: string;
  pairingCode?: string;
  pairingCodeFile?: string;
  stateDir?: string;
  listen?: string;
};

export type RuntimeConfig = {
  config: AppConfig;
  workspaceRoot: string;
  stateDir: string;
  publicBaseUrl: string;
  listen: {
    host: string;
    port: number;
  };
  policyPath: string;
  policy: RelayPolicy;
};

export function parseCliArgs(args: string[]): CliOptions {
  const result: CliOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) continue;
    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    const value = inlineValue ?? args[++index];
    switch (rawKey) {
      case "config":
        result.config = value;
        break;
      case "mode":
        if (value !== "read-only" && value !== "dev")
          throw new BadRequestError(`Invalid mode: ${value}`);
        result.mode = value;
        break;
      case "policy":
        result.policy = value;
        break;
      case "workspace":
        result.workspace = value;
        break;
      case "public-base-url":
        result.publicBaseUrl = value;
        break;
      case "pairing-code":
        result.pairingCode = value;
        break;
      case "pairing-code-file":
        result.pairingCodeFile = value;
        break;
      case "state-dir":
        result.stateDir = value;
        break;
      case "listen":
        result.listen = value;
        break;
      default:
        throw new BadRequestError(`Unknown option: --${rawKey}`);
    }
  }
  return result;
}

export async function loadRuntimeConfig(cli: CliOptions): Promise<RuntimeConfig> {
  const configPath = cli.config ?? process.env.WEBVIBE_CONFIG;
  const fromEnv = envToConfig(process.env);
  const fromFile = configPath ? await loadDataFile(configPath) : {};
  const config = appConfigSchema.parse(
    mergeConfig(mergeConfig(fromEnv, fromFile), cliToConfig(cli)),
  );
  const workspaceRoot = resolvePath(config.workspace.root);
  const stateDir = resolvePath(config.server.stateDir);
  const publicBaseUrl = config.server.publicBaseUrl ?? defaultPublicBaseUrl(config.server.listen);
  const listen = parseListen(config.server.listen);
  const policyPath = resolvePolicyPath(config, config.server.mode);
  const policy = await loadPolicy(policyPath, { workspaceRoot, stateDir });
  return { config, workspaceRoot, stateDir, publicBaseUrl, listen, policyPath, policy };
}

export async function loadPolicy(
  filePath: string,
  context: { workspaceRoot: string; stateDir: string },
  seen = new Set<string>(),
): Promise<RelayPolicy> {
  const resolved = resolvePath(filePath);
  if (seen.has(resolved)) throw new BadRequestError(`Policy extends cycle: ${resolved}`);
  seen.add(resolved);
  const raw = await loadDataFile(resolved);
  const parsed = policySchema.parse(raw);
  let merged = parsed;
  if (parsed.extends) {
    const basePath = path.resolve(path.dirname(resolved), parsed.extends);
    const base = await loadPolicy(basePath, context, seen);
    merged = {
      ...base,
      ...parsed,
      workspace: { ...base.workspace, ...parsed.workspace },
      upstreams: { ...base.upstreams, ...parsed.upstreams },
      tools: [...base.tools, ...parsed.tools],
      limits: { ...base.limits, ...parsed.limits },
      audit: { ...base.audit, ...parsed.audit },
    };
  }
  const interpolated = interpolateValue(merged, {
    workspaceRoot: context.workspaceRoot,
    stateDir: context.stateDir,
    env: process.env,
  });
  return policySchema.parse(interpolated) as RelayPolicy;
}

async function loadDataFile(filePath: string): Promise<Record<string, unknown>> {
  const absolute = resolvePath(filePath);
  const text = await readFile(absolute, "utf8");
  if (absolute.endsWith(".json")) return JSON.parse(text) as Record<string, unknown>;
  if (absolute.endsWith(".toml")) return parseToml(text) as Record<string, unknown>;
  return parseYaml(text) as Record<string, unknown>;
}

function mergeConfig(base: unknown, overlay: unknown): unknown {
  if (!isRecord(base) || !isRecord(overlay)) return overlay ?? base;
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    if (value === undefined) continue;
    result[key] = isRecord(value) ? mergeConfig(result[key], value) : value;
  }
  return result;
}

function cliToConfig(cli: CliOptions): Record<string, unknown> {
  return {
    server: {
      mode: cli.mode,
      publicBaseUrl: cli.publicBaseUrl,
      stateDir: cli.stateDir,
      listen: cli.listen,
    },
    workspace: { root: cli.workspace },
    auth: {
      pairingCode: cli.pairingCode,
      pairingCodeFile: cli.pairingCodeFile,
    },
    policy: {
      path: cli.policy,
    },
  };
}

function envToConfig(env: NodeJS.ProcessEnv): Record<string, unknown> {
  return {
    server: {
      mode: env.WEBVIBE_MODE,
      publicBaseUrl: env.WEBVIBE_PUBLIC_BASE_URL,
      stateDir: env.WEBVIBE_STATE_DIR,
      listen: env.WEBVIBE_LISTEN,
    },
    workspace: { root: env.WEBVIBE_WORKSPACE },
    auth: {
      pairingCode: env.WEBVIBE_PAIRING_CODE,
      pairingCodeFile: env.WEBVIBE_PAIRING_CODE_FILE,
      accessTokenTtlDays: env.WEBVIBE_ACCESS_TOKEN_TTL_DAYS
        ? Number(env.WEBVIBE_ACCESS_TOKEN_TTL_DAYS)
        : undefined,
    },
    policy: {
      path: env.WEBVIBE_POLICY,
      readOnly: env.WEBVIBE_READ_ONLY_POLICY,
      dev: env.WEBVIBE_DEV_POLICY,
    },
  };
}

function resolvePolicyPath(config: AppConfig, mode: Mode): string {
  if (config.policy.path) return config.policy.path;
  if (mode === "read-only" && config.policy.readOnly) return config.policy.readOnly;
  if (mode === "dev" && config.policy.dev) return config.policy.dev;
  return defaultPolicyPaths[mode];
}

function parseListen(value: string): { host: string; port: number } {
  const separator = value.lastIndexOf(":");
  if (separator === -1) throw new BadRequestError(`Invalid listen address: ${value}`);
  const host = value.slice(0, separator);
  const port = Number(value.slice(separator + 1));
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new BadRequestError(`Invalid listen port: ${value}`);
  }
  return { host, port };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
