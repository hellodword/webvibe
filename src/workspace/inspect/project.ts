import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { parse as parseToml } from "toml";

import { BadRequestError } from "../../util/errors.js";
import type { InspectWorkspaceContext } from "./path.js";
import { isProtectedPath, safeLstat } from "./path.js";

type ProjectManifest = {
  path: string;
  type: "npm" | "go" | "rust" | "python" | "requirements" | "unknown";
  name?: string;
  scripts?: string[];
};

const MANIFEST_TYPES: Record<string, ProjectManifest["type"]> = {
  "package.json": "npm",
  "go.mod": "go",
  "Cargo.toml": "rust",
  "pyproject.toml": "python",
  "requirements.txt": "requirements",
};

const LOCKFILE_TYPES: Record<string, string> = {
  "package-lock.json": "npm",
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
  truncated: boolean;
}> {
  const maxDepth = clampInteger(args.maxDepth, 3, 0, 8);
  const maxManifests = clampInteger(args.maxManifests, 50, 1, 200);
  const manifests: ProjectManifest[] = [];
  const lockfiles: Array<{ path: string; type: string }> = [];
  const npmScripts: Array<{ manifest: string; name: string; command: string }> = [];
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
  return { status: "ok", root: ".", manifests, lockfiles, npmScripts, packageManagers, languages, truncated };
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
