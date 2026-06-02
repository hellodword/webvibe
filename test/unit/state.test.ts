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
});
