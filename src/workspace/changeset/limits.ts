import { BadRequestError } from "../../util/errors.js";
import type { LimitsPolicy } from "../../policy/policy.js";
import type { ParsedChangeset } from "./schema.js";
import type { EffectiveLimits } from "./types.js";

export function effectiveLimits(limits: LimitsPolicy): EffectiveLimits {
  return {
    maxChangesetFiles: limits.change.maxFiles,
    maxChangesetBytes: limits.change.maxTotalBytes,
    maxChangesetFileBytes: limits.change.maxTextFileBytes,
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
