import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { parse as parseToml } from "toml";

import { BadRequestError } from "../../util/errors.js";
import type { InspectWorkspaceContext } from "./path.js";
import { isProtectedPath, safeLstat } from "./path.js";

type ProjectManifest = {
  path: string;
  type: "npm" | "go" | "rust" | "python" | "requirements" | "dart" | "flutter" | "unknown";
  name?: string;
  scripts?: string[];
  packageManager?: string;
};

type TaskFile = {
  path: string;
  type: "make" | "just" | "task";
  targets: string[];
};

type ProjectConfigFile = {
  path: string;
  kind: string;
};

const MANIFEST_TYPES: Record<string, ProjectManifest["type"]> = {
  "package.json": "npm",
  "go.mod": "go",
  "Cargo.toml": "rust",
  "pyproject.toml": "python",
  "requirements.txt": "requirements",
  "pubspec.yaml": "dart",
};

const LOCKFILE_TYPES: Record<string, string> = {
  "package-lock.json": "npm",
  "pnpm-lock.yaml": "pnpm",
  "yarn.lock": "yarn",
  "bun.lockb": "bun",
  "bun.lock": "bun",
  "npm-shrinkwrap.json": "npm",
  "go.sum": "go",
  "Cargo.lock": "rust",
  "uv.lock": "uv",
};

export async function inspectProject(
  args: Record<string, unknown>,
  context: InspectWorkspaceContext,
): Promise<{
  status: "ok";
  root: ".";
  manifests: ProjectManifest[];
  lockfiles: Array<{ path: string; type: string }>;
  npmScripts: Array<{ manifest: string; name: string; command: string }>;
  packageManagers: string[];
  languages: string[];
  taskFiles: TaskFile[];
  configFiles: ProjectConfigFile[];
  truncated: boolean;
}> {
  const maxDepth = clampInteger(args.maxDepth, 3, 0, 8);
  const maxManifests = clampInteger(args.maxManifests, 50, 1, 200);
  const manifests: ProjectManifest[] = [];
  const lockfiles: Array<{ path: string; type: string }> = [];
  const npmScripts: Array<{ manifest: string; name: string; command: string }> = [];
  const taskFiles: TaskFile[] = [];
  const configFiles: ProjectConfigFile[] = [];
  let truncated = false;

  const visit = async (absoluteDir: string, relativeDir: string, depth: number): Promise<void> => {
    if (truncated) return;
    const entries = await readdir(absoluteDir, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = relativeDir === "." ? entry.name : `${relativeDir}/${entry.name}`;
      if (isProtectedPath(relativePath, context.workspace.protected)) continue;
      const absolutePath = path.join(absoluteDir, entry.name);
      if (entry.isFile()) {
        if (entry.name in MANIFEST_TYPES) {
          const manifest = await readManifest(absolutePath, relativePath, MANIFEST_TYPES[entry.name]);
          manifests.push(manifest);
          if (manifest.type === "npm") {
            for (const script of await readNpmScripts(absolutePath, relativePath)) {
              npmScripts.push(script);
            }
          }
        }
        if (entry.name in LOCKFILE_TYPES) {
          lockfiles.push({ path: relativePath, type: LOCKFILE_TYPES[entry.name] });
        }
        const configKind = configKindForPath(relativePath);
        if (configKind) {
          configFiles.push({ path: relativePath, kind: configKind });
        }
        const taskFileType = taskFileTypeForName(entry.name);
        if (taskFileType) {
          taskFiles.push(await readTaskFile(absolutePath, relativePath, taskFileType));
        }
        if (manifests.length >= maxManifests) {
          truncated = true;
          return;
        }
      }
    }
    if (depth >= maxDepth) return;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const relativePath = relativeDir === "." ? entry.name : `${relativeDir}/${entry.name}`;
      if (isProtectedPath(relativePath, context.workspace.protected)) continue;
      await visit(path.join(absoluteDir, entry.name), relativePath, depth + 1);
      if (truncated) return;
    }
  };

  await visit(context.workspaceRoot, ".", 0);
  const packageManagers = sortedUnique(lockfiles.map((lockfile) => lockfile.type));
  const languages = sortedUnique(manifests.map((manifest) => manifest.type).filter((type) => type !== "unknown"));
  return {
    status: "ok",
    root: ".",
    manifests,
    lockfiles,
    npmScripts,
    packageManagers,
    languages,
    taskFiles,
    configFiles,
    truncated,
  };
}

async function readManifest(
  absolutePath: string,
  relativePath: string,
  type: ProjectManifest["type"],
): Promise<ProjectManifest> {
  const stat = await safeLstat(absolutePath);
  if (!stat || stat.size > 1024 * 1024) return { path: relativePath, type };
  try {
    const text = await readFile(absolutePath, "utf8");
    if (type === "npm") {
      const parsed = JSON.parse(text) as any;
      return {
        path: relativePath,
        type,
        ...(typeof parsed.name === "string" ? { name: parsed.name } : {}),
        ...(typeof parsed.packageManager === "string"
          ? { packageManager: parsed.packageManager.split("@")[0] }
          : {}),
        ...(parsed.scripts && typeof parsed.scripts === "object"
          ? { scripts: Object.keys(parsed.scripts).sort() }
          : {}),
      };
    }
    if (type === "rust" || type === "python") {
      const parsed = parseToml(text) as any;
      const name =
        type === "rust" && typeof parsed.package?.name === "string"
          ? parsed.package.name
          : type === "python" && typeof parsed.project?.name === "string"
            ? parsed.project.name
            : undefined;
      return { path: relativePath, type, ...(name ? { name } : {}) };
    }
    if (type === "go") {
      const moduleLine = text.split(/\r?\n/).find((line) => line.startsWith("module "));
      return { path: relativePath, type, ...(moduleLine ? { name: moduleLine.slice(7).trim() } : {}) };
    }
    if (type === "dart") {
      const name = text.match(/^name:\s*([A-Za-z0-9_.-]+)/m)?.[1];
      const manifestType = /^\s*flutter\s*:/m.test(text) || /^\s*sdk:\s*flutter\s*$/m.test(text)
        ? "flutter"
        : "dart";
      return { path: relativePath, type: manifestType, ...(name ? { name } : {}) };
    }
  } catch {
    return { path: relativePath, type };
  }
  return { path: relativePath, type };
}

async function readNpmScripts(
  absolutePath: string,
  relativePath: string,
): Promise<Array<{ manifest: string; name: string; command: string }>> {
  try {
    const parsed = JSON.parse(await readFile(absolutePath, "utf8")) as any;
    if (!parsed.scripts || typeof parsed.scripts !== "object") return [];
    return Object.entries(parsed.scripts)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([name, command]) => ({ manifest: relativePath, name, command }))
      .sort((left, right) => left.name.localeCompare(right.name));
  } catch {
    return [];
  }
}

async function readTaskFile(
  absolutePath: string,
  relativePath: string,
  type: TaskFile["type"],
): Promise<TaskFile> {
  const stat = await safeLstat(absolutePath);
  if (!stat || stat.size > 512 * 1024) return { path: relativePath, type, targets: [] };
  try {
    const text = await readFile(absolutePath, "utf8");
    return {
      path: relativePath,
      type,
      targets: taskTargets(text, type),
    };
  } catch {
    return { path: relativePath, type, targets: [] };
  }
}

function taskFileTypeForName(name: string): TaskFile["type"] | undefined {
  if (name === "Makefile" || name === "makefile") return "make";
  if (name === "justfile" || name === "Justfile") return "just";
  if (name === "Taskfile.yml" || name === "Taskfile.yaml") return "task";
  return undefined;
}

function configKindForPath(relativePath: string): string | undefined {
  const name = path.posix.basename(relativePath);
  if (name === "tsconfig.json" || /^tsconfig\..+\.json$/.test(name)) return "frontend:typescript";
  if (/^vitest\.config\./.test(name)) return "frontend:vitest";
  if (/^playwright\.config\./.test(name)) return "frontend:playwright";
  if (/^cypress\.config\./.test(name)) return "frontend:cypress";
  if (/^jest\.config\./.test(name)) return "frontend:jest";
  if (name === "eslint.config.js" || name === "eslint.config.mjs" || name.startsWith(".eslintrc")) return "frontend:eslint";
  if (name === "biome.json" || name === "biome.jsonc") return "frontend:biome";
  if (name.startsWith(".prettierrc") || /^prettier\.config\./.test(name)) return "frontend:prettier";
  if (name === "schema.prisma") return "database:prisma";
  if (name === "drizzle.config.ts" || name === "drizzle.config.js") return "database:drizzle";
  if (name === "buf.yaml" || name === "buf.gen.yaml") return "codegen:buf";
  if (name === "sqlc.yaml" || name === "sqlc.yml") return "codegen:sqlc";
  if (/openapi|swagger/i.test(name) && /\.(ya?ml|json)$/.test(name)) return "codegen:openapi";
  return undefined;
}

function taskTargets(text: string, type: TaskFile["type"]): string[] {
  const targets = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const match =
      type === "task"
        ? /^\s{2}([A-Za-z0-9_.-]+):\s*$/.exec(line)
        : /^([A-Za-z0-9_.-]+)\s*:/.exec(line);
    const target = match?.[1];
    if (!target || target.startsWith(".")) continue;
    targets.add(target);
  }
  return Array.from(targets).sort();
}

function sortedUnique(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function clampInteger(value: unknown, defaultValue: number, minimum: number, maximum: number): number {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new BadRequestError("numeric option must be integer");
  }
  return Math.min(Math.max(value, minimum), maximum);
}
