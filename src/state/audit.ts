import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import path from "node:path";

import { sha256 } from "../util/hash.js";
import { redactJson } from "./redaction.js";

export type AuditRecord = {
  timestamp: string;
  event?:
    | "tool.call"
    | "tool.blocked"
    | "tool.error"
    | "manual.prepared.created"
    | "manual.gate.created"
    | "manual.confirm"
    | "manual.artifact.download"
    | "mcp.resources.read";
  operationId?: string;
  preparedId?: string;
  pendingId?: string;
  artifactId?: string;
  clientId?: string;
  subject?: string;
  tool?: string;
  type?: string;
  upstream?: string;
  status: "ok" | "error" | "blocked";
  durationMs?: number;
  inputHash?: string;
  inputBytes?: number;
  input?: unknown;
  rawOutputHash?: string;
  rawOutputBytes?: number;
  rawOutput?: unknown;
  clientOutputHash?: string;
  clientOutputBytes?: number;
  clientOutput?: unknown;
  outputBytes?: number;
  hostObservation?: {
    toolName?: string;
    outputText?: string;
    classification?: string;
  };
  verification?: unknown;
  error?: string;
  errorCode?: string;
  errorStack?: string;
};

export type AuditOptions = {
  enabled: boolean;
  maxLogBytes: number;
  payloads: "hash-only" | "full-redacted";
  includeClientVisibleOutput: boolean;
  includeRawToolOutput: boolean;
  includeErrors: boolean;
  includeErrorStack: boolean;
  includeManualEvents: boolean;
  redact: boolean;
};

const defaultAuditOptions: AuditOptions = {
  enabled: true,
  maxLogBytes: 10 * 1024 * 1024,
  payloads: "hash-only",
  includeClientVisibleOutput: false,
  includeRawToolOutput: false,
  includeErrors: true,
  includeErrorStack: false,
  includeManualEvents: true,
  redact: true,
};

export class AuditLog {
  private readonly options: AuditOptions;

  constructor(
    private readonly filePath: string,
    optionsOrEnabled: boolean | Partial<AuditOptions>,
    maxLogBytes = 10 * 1024 * 1024,
  ) {
    this.options =
      typeof optionsOrEnabled === "boolean"
        ? { ...defaultAuditOptions, enabled: optionsOrEnabled, maxLogBytes }
        : { ...defaultAuditOptions, ...optionsOrEnabled };
  }

  async write(record: AuditRecord): Promise<void> {
    if (!this.options.enabled) return;
    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    await this.rotateIfNeeded();
    const filtered = this.filterRecord(record);
    const output = this.options.redact
      ? redactJson(filtered, { redactManualTokens: true })
      : filtered;
    await appendFile(this.filePath, `${JSON.stringify(output)}\n`, { mode: 0o600 });
  }

  private async rotateIfNeeded(): Promise<void> {
    try {
      const info = await stat(this.filePath);
      if (info.size < this.options.maxLogBytes) return;
      await rename(this.filePath, `${this.filePath}.1`);
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  private filterRecord(record: AuditRecord): AuditRecord {
    const filtered: AuditRecord = { ...record };
    if (this.options.payloads !== "full-redacted") {
      delete filtered.input;
    }
    if (!this.options.includeRawToolOutput) {
      delete filtered.rawOutput;
    }
    if (!this.options.includeClientVisibleOutput) {
      delete filtered.clientOutput;
    }
    if (!this.options.includeErrors) {
      delete filtered.error;
      delete filtered.errorCode;
      delete filtered.errorStack;
    } else if (!this.options.includeErrorStack) {
      delete filtered.errorStack;
    }
    if (!this.options.includeManualEvents && filtered.event?.startsWith("manual.")) {
      return { timestamp: filtered.timestamp, event: filtered.event, status: filtered.status };
    }
    return filtered;
  }
}

export function buildAuditRecord(input: {
  clientId?: string;
  subject?: string;
  tool: string;
  type: string;
  upstream?: string;
  status: "ok" | "error" | "blocked";
  startedAt: number;
  input: unknown;
  rawOutput?: unknown;
  clientOutput?: unknown;
  output?: unknown;
  error?: string;
  errorCode?: string;
  errorStack?: string;
}): AuditRecord {
  const rawOutput = "rawOutput" in input ? input.rawOutput : input.output;
  const clientOutput = "clientOutput" in input ? input.clientOutput : input.output;
  const outputText =
    typeof clientOutput === "string" ? clientOutput : JSON.stringify(clientOutput ?? null);
  const rawOutputText = typeof rawOutput === "string" ? rawOutput : JSON.stringify(rawOutput ?? null);
  const inputText = typeof input.input === "string" ? input.input : JSON.stringify(input.input ?? null);
  return {
    timestamp: new Date().toISOString(),
    event:
      input.status === "blocked" ? "tool.blocked" : input.status === "error" ? "tool.error" : "tool.call",
    clientId: input.clientId,
    subject: input.subject,
    tool: input.tool,
    type: input.type,
    upstream: input.upstream,
    status: input.status,
    durationMs: Date.now() - input.startedAt,
    inputHash: sha256(input.input),
    inputBytes: Buffer.byteLength(inputText),
    input: input.input,
    rawOutputHash: sha256(rawOutput ?? null),
    rawOutputBytes: Buffer.byteLength(rawOutputText),
    rawOutput,
    clientOutputHash: sha256(clientOutput ?? null),
    clientOutputBytes: Buffer.byteLength(outputText),
    clientOutput,
    outputBytes: Buffer.byteLength(outputText),
    error: input.error,
    errorCode: input.errorCode,
    errorStack: input.errorStack,
  };
}
