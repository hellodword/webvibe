import { BadRequestError } from "../../util/errors.js";
import type { LimitsPolicy } from "../../policy/policy.js";
import type { ParsedChangeset } from "./schema.js";
import type { EffectiveLimits } from "./types.js";

const DEFAULT_MAX_CHANGESET_FILES = 80;
const DEFAULT_MAX_CHANGESET_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_CHANGESET_FILE_BYTES = 1024 * 1024;

export function effectiveLimits(limits: LimitsPolicy): EffectiveLimits {
  return {
    maxChangesetFiles: limits.maxChangesetFiles ?? DEFAULT_MAX_CHANGESET_FILES,
    maxChangesetBytes: limits.maxChangesetBytes ?? DEFAULT_MAX_CHANGESET_BYTES,
    maxChangesetFileBytes:
      limits.maxChangesetFileBytes ?? DEFAULT_MAX_CHANGESET_FILE_BYTES,
  };
}

export function assertChangesetLimits(input: ParsedChangeset, limits: EffectiveLimits): void {
  if (input.changes.length > limits.maxChangesetFiles) {
    throw new BadRequestError(`Too many changes; maximum is ${limits.maxChangesetFiles}`);
  }
  const inputBytes = Buffer.byteLength(JSON.stringify(input), "utf8");
  if (inputBytes > limits.maxChangesetBytes) {
    throw new BadRequestError(
      `Changeset input is ${inputBytes} bytes; maximum is ${limits.maxChangesetBytes}`,
    );
  }
}

export function assertContent(
  content: string,
  relativePath: string,
  limits: EffectiveLimits,
): void {
  if (content.includes("\0")) {
    throw new BadRequestError(`Content contains a NUL byte: ${relativePath}`);
  }
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > limits.maxChangesetFileBytes) {
    throw new BadRequestError(
      `Content is ${bytes} bytes; maximum is ${limits.maxChangesetFileBytes}: ${relativePath}`,
    );
  }
}
