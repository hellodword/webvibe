import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { TextDecoder } from "node:util";

import { BadRequestError } from "../../util/errors.js";
import type { EffectiveLimits, FileState } from "./types.js";

export async function readTextFileState(
  absolutePath: string,
  relativePath: string,
  limits: EffectiveLimits,
): Promise<FileState> {
  const info = await lstat(absolutePath);
  if (info.size > limits.maxChangesetFileBytes) {
    throw new BadRequestError(
      `File is ${info.size} bytes; maximum is ${limits.maxChangesetFileBytes}: ${relativePath}`,
    );
  }
  const data = await readFile(absolutePath);
  const content = decodeUtf8(data, relativePath);
  return {
    content,
    sha256: sha256Buffer(data),
    sizeBytes: data.byteLength,
    mode: info.mode,
    mtimeMs: info.mtimeMs,
  };
}

export function decodeUtf8(data: Buffer, relativePath: string): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    throw new BadRequestError(`File is not valid UTF-8: ${relativePath}`);
  }
  if (text.includes("\0")) {
    throw new BadRequestError(`File appears to be binary: ${relativePath}`);
  }
  return text;
}

export function sha256Text(text: string): string {
  return sha256Buffer(Buffer.from(text, "utf8"));
}

export function sha256Buffer(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}
