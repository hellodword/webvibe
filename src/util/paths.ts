import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function expandHome(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}

export function resolvePath(input: string, base = process.cwd()): string {
  const expanded = expandHome(input);
  return path.resolve(base, expanded);
}

export function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function readTextIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error: any) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

export async function writeFileAtomic(filePath: string, data: string, mode = 0o600): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, data, { mode });
  const handle = await open(tempPath, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tempPath, filePath);
}

export function toWorkspaceRelative(workspaceRoot: string, candidate: string): string {
  const absolute = path.isAbsolute(candidate) ? candidate : path.resolve(workspaceRoot, candidate);
  return path.relative(workspaceRoot, absolute).replaceAll(path.sep, "/");
}
