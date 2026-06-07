import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import path from "node:path";

import { BadRequestError, ForbiddenError } from "../util/errors.js";

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export function assertManualId(id: string, label: string): void {
  if (!ID_PATTERN.test(id)) throw new BadRequestError(`${label} has invalid format`);
}

export async function ensurePrivateDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
}

export function resolveStorePath(dir: string, id: string, suffix: string, label: string): string {
  assertManualId(id, label);
  const base = path.resolve(dir);
  const filePath = path.resolve(base, `${id}${suffix}`);
  if (filePath !== path.join(base, path.basename(filePath))) {
    throw new ForbiddenError(`${label} path escapes manual state directory`);
  }
  return filePath;
}

export async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error: any) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

export async function writePrivateJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(filePath, 0o600);
}
