import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { sha256 } from "../util/hash.js";
import { redactJson } from "./redaction.js";

export type AuditRecord = {
  timestamp: string;
  clientId?: string;
  subject?: string;
  tool: string;
  type: string;
  upstream?: string;
  status: "ok" | "error";
  durationMs: number;
  inputHash: string;
  outputBytes: number;
  error?: string;
};

export class AuditLog {
  constructor(
    private readonly filePath: string,
    private readonly enabled: boolean,
  ) {}

  async write(record: AuditRecord): Promise<void> {
    if (!this.enabled) return;
    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const redacted = redactJson(record);
    await appendFile(this.filePath, `${JSON.stringify(redacted)}\n`, { mode: 0o600 });
  }
}

export function buildAuditRecord(input: {
  clientId?: string;
  subject?: string;
  tool: string;
  type: string;
  upstream?: string;
  status: "ok" | "error";
  startedAt: number;
  input: unknown;
  output: unknown;
  error?: string;
}): AuditRecord {
  const outputText =
    typeof input.output === "string" ? input.output : JSON.stringify(input.output ?? null);
  return {
    timestamp: new Date().toISOString(),
    clientId: input.clientId,
    subject: input.subject,
    tool: input.tool,
    type: input.type,
    upstream: input.upstream,
    status: input.status,
    durationMs: Date.now() - input.startedAt,
    inputHash: sha256(input.input),
    outputBytes: Buffer.byteLength(outputText),
    error: input.error,
  };
}
