import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const safetyBlock =
  "This tool call was blocked by OpenAI's safety checks. Please double check what you are sending.";

describe("ChatGPT Web workflow docs", () => {
  it("documents manual gate decisions and continuation semantics", async () => {
    const text = await readFile("docs/chatgpt-web-workflow.md", "utf8");

    expect(text).toContain(safetyBlock);
    expect(text).toContain("secondary_confirmation_required");
    expect(text).toContain("blocked_by_openai_safety");
    expect(text).toContain("manual_required_capability_limit");
    expect(text).toContain("workspace-relative log file path");
    expect(text).toContain("/resume");
    expect(text).toContain("12KB and 200 lines");
    expect(text).toContain("manual.gate");
    expect(text).toContain("manual.resume");
    expect(text).toContain("retry the identical tool call once");
    expect(text).toContain("retries the same `manual.gate`");
    expect(text).toContain("OpenAI limitation or bug");
    expect(text).toContain("not suspend an in-flight JSON-RPC");
    expect(text).toContain("MANUAL_PENDING_REQUIRED");
    expect(text).toContain("Do not put detailed manual instructions into `manual.gate` arguments.");
    expect(text).toContain("if still blocked, stop immediately and wait for human completion followed by `/resume`");
    expect(text).toContain("continues the original interrupted request");
    expect(text).not.toContain("sendFollowUpMessage");
    expect(text).not.toContain("manual.confirm");
    expect(text).not.toContain("applyPrepared");
    expect(text).not.toContain("applyById");
    expect(text).not.toContain("base64");
    expect(text).not.toContain("split into smaller write calls");
  });
});
