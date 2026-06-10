import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse as parseToml } from "toml";
import { parse as parseYaml } from "yaml";

import { defaultPolicyPaths, defaultPublicBaseUrl } from "./defaults.js";
import { interpolateValue } from "./interpolation.js";
import { appConfigSchema, type AppConfig } from "./schema.js";
import { defaultLimits, limitsPolicySchema, policyInputSchema, policySchema } from "../policy/schema.js";
import type { Mode, PolicyProfile, RelayPolicy, RelayPolicyInput } from "../policy/policy.js";
import { BadRequestError } from "../util/errors.js";
import { resolvePath } from "../util/paths.js";

export type CliOptions = {
  config?: string;
  help?: boolean;
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
    if (!token.startsWith("--")) throw new BadRequestError(`Unknown argument: ${token}`);
    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    switch (rawKey) {
      case "config": {
        const value = inlineValue ?? args[++index];
        if (!value || value.startsWith("--")) throw new BadRequestError("Missing --config value");
        result.config = value;
        break;
      }
      case "help":
        if (inlineValue !== undefined) throw new BadRequestError("Unexpected --help value");
        result.help = true;
        break;
      default:
        throw new BadRequestError(`Unknown option: --${rawKey}`);
    }
  }
  return result;
}

export function helpText(): string {
  return `Usage: webvibe --config <path>

Options:
  --config <path>  Path to config file.
  --help           Show this help.
`;
}

export async function loadRuntimeConfig(cli: CliOptions): Promise<RuntimeConfig> {
  if (!cli.config) throw new BadRequestError("Missing required --config <path>");
  const configPath = resolvePath(cli.config);
  const configDir = path.dirname(configPath);
  const config = appConfigSchema.parse(await loadDataFile(configPath));
  const workspaceRoot = resolvePath(config.workspace.root, configDir);
  const stateDir = resolvePath(config.server.stateDir, configDir);
  const publicBaseUrl = config.server.publicBaseUrl ?? defaultPublicBaseUrl(config.server.listen);
  const listen = parseListen(config.server.listen);
  const policyPath = resolvePolicyPath(config, configDir);
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
  const parsed = policyInputSchema.parse(raw);
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
      profiles: deepMergeRecords(base.profiles, parsed.profiles),
      taskBundles: deepMerge(base.taskBundles ?? {}, parsed.taskBundles ?? {}),
      taskCatalog: deepMerge(base.taskCatalog ?? {}, parsed.taskCatalog ?? {}),
      hostRisk: deepMerge(base.hostRisk, parsed.hostRisk),
      limits: deepMerge(base.limits, parsed.limits),
      audit: { ...base.audit, ...parsed.audit },
    };
  }
  const interpolated = interpolateValue(merged, {
    workspaceRoot: context.workspaceRoot,
    stateDir: context.stateDir,
    env: process.env,
  });
  return composeEffectivePolicy(policyInputSchema.parse(interpolated));
}

async function loadDataFile(filePath: string): Promise<Record<string, unknown>> {
  const absolute = resolvePath(filePath);
  const text = await readFile(absolute, "utf8");
  if (absolute.endsWith(".json")) return JSON.parse(text) as Record<string, unknown>;
  if (absolute.endsWith(".toml")) return parseToml(text) as Record<string, unknown>;
  return parseYaml(text) as Record<string, unknown>;
}

function resolvePolicyPath(config: AppConfig, configDir: string): string {
  if (config.server.policy) return resolvePath(config.server.policy, configDir);
  const mode: Mode = config.server.mode ?? "read-only";
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

function composeEffectivePolicy(input: RelayPolicyInput): RelayPolicy {
  const profiles: Record<string, PolicyProfile> = deepMergeRecords(
    {
      chatgptWebDefault: {
        limits: defaultLimits,
        taskBundles: {},
      },
    },
    input.profiles,
  );
  const activeProfile = input.profile;
  const profile = profiles[activeProfile];
  if (!profile) throw new BadRequestError(`Unknown policy profile: ${activeProfile}`);
  const effectiveLimits = limitsPolicySchema.parse(
    deepMerge(defaultLimits, profile.limits ?? {}, input.limits ?? {}),
  );
  const effectiveTaskBundles = deepMerge(profile.taskBundles ?? {}, input.taskBundles ?? {});
  return policySchema.parse({
    ...input,
    profiles,
    activeProfile,
    taskBundles: effectiveTaskBundles,
    limits: effectiveLimits,
  });
}

function deepMergeRecords<T extends Record<string, unknown>>(
  ...items: Array<T | undefined>
): Record<string, T[keyof T]> {
  return deepMerge(...items) as Record<string, T[keyof T]>;
}

function deepMerge<T>(...items: Array<T | undefined>): T {
  const result: Record<string, unknown> = {};
  for (const item of items) {
    if (!isPlainObject(item)) continue;
    for (const [key, value] of Object.entries(item)) {
      const current = result[key];
      result[key] =
        isPlainObject(current) && isPlainObject(value)
          ? deepMerge(current, value)
          : value;
    }
  }
  return result as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
