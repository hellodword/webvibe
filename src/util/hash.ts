import { createHash, randomBytes } from "node:crypto";

import stableStringify from "fast-json-stable-stringify";

export function sha256(value: unknown): string {
  const text = typeof value === "string" ? value : stableStringify(value);
  return createHash("sha256").update(text).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
