import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("security docs", () => {
  it("describes manual completion as confirmation, not safety bypass", async () => {
    const text = await readFile("docs/security.md", "utf8");

    expect(text).toContain("manual.gate");
    expect(text).toContain("manual.resume");
    expect(text).toContain("/resume");
    expect(text).toContain("change.prepare");
    expect(text).toContain("change.apply");
    expect(text).toContain("does not bypass ChatGPT Web safety checks");
    expect(text).toContain("before it reaches `/mcp`");
    expect(text).toContain("workspace-relative manual log file path");
    expect(text).toContain("OpenAI limitation or bug");
    expect(text).toContain("minimal `manual.gate` arguments");
    expect(text).toContain("original interrupted request");
    expect(text).not.toContain("widget only collects");
    expect(text).not.toContain("manual.confirm");
    expect(text).toContain("redacted full tool inputs");
    expect(text).not.toContain("manual gate will apply");
    expect(text).not.toContain("manual gate deletes");
  });
});
