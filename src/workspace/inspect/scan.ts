import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { InspectWorkspaceContext } from "./path.js";
import { isProtectedPath, safeLstat } from "./path.js";
import { inspectProject } from "./project.js";

type DetectedFile = {
  path: string;
  kind: string;
};

export async function workspaceScan(
  args: Record<string, unknown>,
  context: InspectWorkspaceContext,
): Promise<{
  status: "ok";
  root: ".";
  project: Awaited<ReturnType<typeof inspectProject>>;
  packageManagers: string[];
  languages: string[];
  frontend: DetectedFile[];
  codegen: DetectedFile[];
  taskFiles: DetectedFile[];
  database: DetectedFile[];
  workspaceCandidates: string[];
  truncated: boolean;
  nextCursor: string | null;
  next: {
    tool: "task.list";
    reason: string;
  };
}> {
  const project = await inspectProject({ maxDepth: args.maxDepth ?? 6, maxManifests: 200 }, context);
  const detected: DetectedFile[] = [];
  let truncated = false;
  const maxFiles = 2000;

  const visit = async (absoluteDir: string, relativeDir: string, depth: number): Promise<void> => {
    if (truncated) return;
    const entries = await readdir(absoluteDir, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = relativeDir === "." ? entry.name : `${relativeDir}/${entry.name}`;
      if (isProtectedPath(relativePath, context.workspace.protected)) continue;
      if (entry.isFile()) {
        const kind = classifyFile(relativePath);
        if (kind) detected.push({ path: relativePath, kind });
        if (detected.length >= maxFiles) {
          truncated = true;
          return;
        }
      }
    }
    if (depth >= 6) return;
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const relativePath = relativeDir === "." ? entry.name : `${relativeDir}/${entry.name}`;
      if (isProtectedPath(relativePath, context.workspace.protected)) continue;
      await visit(path.join(absoluteDir, entry.name), relativePath, depth + 1);
      if (truncated) return;
    }
  };

  await visit(context.workspaceRoot, ".", 0);
  const packageManagers = sortedUnique([
    ...project.packageManagers,
    ...detected.filter((file) => file.kind.startsWith("package-manager:")).map((file) => file.kind.slice(16)),
    ...(await packageManagerFromPackageJson(context.workspaceRoot)),
  ]);
  const languages = sortedUnique([
    ...project.languages,
    ...detected.filter((file) => file.kind.startsWith("language:")).map((file) => file.kind.slice(9)),
  ]);
  return {
    status: "ok",
    root: ".",
    project,
    packageManagers,
    languages,
    frontend: detected.filter((file) => file.kind.startsWith("frontend:")),
    codegen: detected.filter((file) => file.kind.startsWith("codegen:")),
    taskFiles: detected.filter((file) => file.kind.startsWith("task:")),
    database: detected.filter((file) => file.kind.startsWith("database:")),
    workspaceCandidates: sortedUnique(project.manifests.map((manifest) => path.posix.dirname(manifest.path))),
    truncated,
    nextCursor: null,
    next: {
      tool: "task.list",
      reason: "Inspect runnable task capabilities after reviewing project shape.",
    },
  };
}

function classifyFile(relativePath: string): string | undefined {
  const name = path.posix.basename(relativePath);
  if (name === "tsconfig.json" || /^tsconfig\..+\.json$/.test(name)) return "language:typescript";
  if (name === "package-lock.json") return "package-manager:npm";
  if (name === "pnpm-lock.yaml") return "package-manager:pnpm";
  if (name === "yarn.lock") return "package-manager:yarn";
  if (name === "bun.lockb" || name === "bun.lock") return "package-manager:bun";
  if (/^vitest\.config\./.test(name)) return "frontend:vitest";
  if (/^playwright\.config\./.test(name)) return "frontend:playwright";
  if (/^cypress\.config\./.test(name)) return "frontend:cypress";
  if (name === "eslint.config.js" || name === "eslint.config.mjs" || name.startsWith(".eslintrc")) return "frontend:eslint";
  if (/^jest\.config\./.test(name)) return "frontend:jest";
  if (name === "Makefile" || name === "makefile") return "task:make";
  if (name === "justfile" || name === "Justfile") return "task:just";
  if (name === "Taskfile.yml" || name === "Taskfile.yaml") return "task:task";
  if (name === "pubspec.yaml") return "language:dart";
  if (name === "melos.yaml") return "language:dart";
  if (name === "schema.prisma") return "database:prisma";
  if (name === "drizzle.config.ts" || name === "drizzle.config.js") return "database:drizzle";
  if (name === "buf.yaml" || name === "buf.gen.yaml") return "codegen:buf";
  if (name === "sqlc.yaml" || name === "sqlc.yml") return "codegen:sqlc";
  if (/openapi|swagger/i.test(name) && /\.(ya?ml|json)$/.test(name)) return "codegen:openapi";
  return undefined;
}

async function packageManagerFromPackageJson(workspaceRoot: string): Promise<string[]> {
  const filePath = path.join(workspaceRoot, "package.json");
  const info = await safeLstat(filePath);
  if (!info?.isFile()) return [];
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as { packageManager?: unknown };
    if (typeof parsed.packageManager !== "string") return [];
    const name = parsed.packageManager.split("@")[0];
    return name ? [name] : [];
  } catch {
    return [];
  }
}

function sortedUnique(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value && value !== "."))).sort();
}
