import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AuditLog, buildAuditRecord } from "../../src/state/audit.js";

describe("state", () => {
  it("rotates audit log before appending over the configured limit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-audit-"));
    const logPath = path.join(root, "audit.log");
    const audit = new AuditLog(logPath, true, 1);

    const record = buildAuditRecord({
      tool: "diagnostics.health",
      type: "builtIn",
      status: "ok",
      startedAt: Date.now(),
      input: { secret: "OPENAI_API_KEY=sk-test" },
      output: { ok: true },
    });

    await audit.write(record);
    await audit.write(record);

    expect((await stat(`${logPath}.1`)).size).toBeGreaterThan(0);
    expect(await readFile(logPath, "utf8")).not.toContain("sk-test");
  });

  it("summarizes large redacted audit payloads", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-audit-large-"));
    const logPath = path.join(root, "audit.log");
    const audit = new AuditLog(logPath, {
      enabled: true,
      maxLogBytes: 10 * 1024 * 1024,
      payloads: "full-redacted",
      includeClientVisibleOutput: true,
      includeRawToolOutput: true,
      includeErrors: true,
      includeErrorStack: false,
      includeManualEvents: true,
      redact: true,
    });
    const large = `${"a".repeat(70000)} OPENAI_API_KEY=sk-large-secret`;
    const record = buildAuditRecord({
      tool: "x.read",
      type: "passThrough",
      status: "ok",
      startedAt: Date.now(),
      input: { query: large },
      rawOutput: { text: large },
      clientOutput: { text: large },
    });

    await audit.write(record);

    const text = await readFile(logPath, "utf8");
    const line = JSON.parse(text) as any;
    expect(text).not.toContain("sk-large-secret");
    expect(text).not.toContain("a".repeat(70000));
    expect(line.input).toMatchObject({
      summarized: true,
      truncated: true,
      bytes: expect.any(Number),
      sha256: expect.any(String),
      head: expect.any(String),
      tail: expect.any(String),
    });
    expect(line.rawOutput).toMatchObject({ summarized: true });
    expect(line.clientOutput).toMatchObject({ summarized: true });
  });
});
