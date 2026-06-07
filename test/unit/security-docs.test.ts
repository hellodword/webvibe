import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("security docs", () => {
  it("describes manual completion as confirmation, not safety bypass", async () => {
    const text = await readFile("docs/security.md", "utf8");

    expect(text).toContain("manual.gate");
    expect(text).toContain("manual.confirm");
    expect(text).toContain("change.prepare");
    expect(text).toContain("change.apply");
    expect(text).toContain("does not bypass ChatGPT Web safety checks");
    expect(text).toContain("before it reaches `/mcp`");
    expect(text).toContain("output/logs/evidence");
    expect(text).toContain("/manual-gates/:pendingId");
    expect(text).toContain("redacted full tool inputs");
    expect(text).not.toContain("manual gate will apply");
    expect(text).not.toContain("manual gate deletes");
  });
});
