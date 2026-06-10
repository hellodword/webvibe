import stableStringify from "fast-json-stable-stringify";

import { redactJson } from "../state/redaction.js";
import { sha256 } from "../util/hash.js";

export type ToolEnvelope = {
  ok: boolean;
  status: string;
  data: unknown;
  warnings: unknown[];
  limits: {
    requested: Record<string, unknown>;
    effective: Record<string, unknown>;
  };
  truncated: boolean;
  nextCursor: string | null;
  artifacts: unknown[];
};

export function prepareToolOutput(
  output: unknown,
  maxBytes: number,
  effectiveLimits: Record<string, unknown> = {},
): ToolEnvelope {
  const redacted = redactJson(output);
  const envelope = toEnvelope(redacted, effectiveLimits);
  if (byteLength(envelope) <= maxBytes) return envelope;

  const dataText = stableStringify(envelope.data) ?? "";
  const truncated: ToolEnvelope = {
    ...envelope,
    data: {
      outputTruncation: {
        reason: "global_maxToolOutputBytes",
        maxBytes,
        originalBytes: Buffer.byteLength(dataText),
        sha256: sha256(envelope.data),
        summary: summarizeValue(envelope.data),
      },
    },
    warnings: [
      ...envelope.warnings,
      {
        code: "OUTPUT_TRUNCATED",
        message: "Tool output exceeded maxToolOutputBytes; data was replaced by a summary.",
      },
    ],
    truncated: true,
  };
  if (byteLength(truncated) <= maxBytes) return truncated;

  return {
    ok: false,
    status: "failed",
    data: {
      outputTruncation: {
        reason: "global_maxToolOutputBytes",
        maxBytes,
        originalBytes: byteLength(envelope),
        sha256: sha256(envelope),
        summary: "output omitted",
      },
    },
    warnings: [
      {
        code: "OUTPUT_TRUNCATED",
        message: "Tool output exceeded maxToolOutputBytes; data was omitted.",
      },
    ],
    limits: envelope.limits,
    truncated: true,
    nextCursor: null,
    artifacts: [],
  };
}

function toEnvelope(output: unknown, effectiveLimits: Record<string, unknown>): ToolEnvelope {
  if (isEnvelope(output)) {
    return {
      ok: output.ok,
      status: output.status,
      data: output.data,
      warnings: Array.isArray(output.warnings) ? output.warnings : [],
      limits: isLimitsEnvelope(output.limits)
        ? output.limits
        : { requested: {}, effective: effectiveLimits },
      truncated: output.truncated === true,
      nextCursor: typeof output.nextCursor === "string" ? output.nextCursor : null,
      artifacts: Array.isArray(output.artifacts) ? output.artifacts : [],
    };
  }
  const status = statusFromOutput(output);
  return {
    ok: isSuccessfulStatus(status),
    status,
    data: output,
    warnings: [],
    limits: {
      requested: {},
      effective: effectiveLimits,
    },
    truncated: false,
    nextCursor: null,
    artifacts: [],
  };
}

function isSuccessfulStatus(status: string): boolean {
  return !["blocked", "conflicted", "error", "failed", "timeout", "unavailable"].includes(status);
}

function statusFromOutput(output: unknown): string {
  if (typeof output !== "object" || output === null || Array.isArray(output)) return "ok";
  const status = (output as Record<string, unknown>).status;
  if (typeof status === "string" && status.length > 0) return status;
  const ok = (output as Record<string, unknown>).ok;
  if (ok === false) return "failed";
  return "ok";
}

function isEnvelope(output: unknown): output is ToolEnvelope {
  return (
    typeof output === "object" &&
    output !== null &&
    !Array.isArray(output) &&
    typeof (output as Record<string, unknown>).ok === "boolean" &&
    typeof (output as Record<string, unknown>).status === "string" &&
    "data" in output
  );
}

function isLimitsEnvelope(value: unknown): value is ToolEnvelope["limits"] {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).requested === "object" &&
    typeof (value as Record<string, unknown>).effective === "object"
  );
}

function summarizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return { type: "array", length: value.length };
  if (typeof value === "object" && value !== null) {
    return {
      type: "object",
      keys: Object.keys(value).slice(0, 20),
    };
  }
  if (typeof value === "string") return { type: "string", length: value.length };
  return { type: typeof value };
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(stableStringify(value) ?? "", "utf8");
}
