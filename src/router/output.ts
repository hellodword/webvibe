import stableStringify from "fast-json-stable-stringify";

import { redactJson } from "../state/redaction.js";

export function prepareToolOutput(output: unknown, maxBytes: number): unknown {
  const redacted = redactJson(output);
  const text = stableStringify(redacted);
  if (Buffer.byteLength(text) <= maxBytes) return redacted;
  return {
    truncated: true,
    text: Buffer.from(text).subarray(0, maxBytes).toString("utf8"),
  };
}
