import { describe, expect, it } from "vitest";

import { webvibeServerInstructions } from "../../src/server/instructions.js";

const safetyBlock =
  "This tool call was blocked by OpenAI's safety checks. Please double check what you are sending.";

describe("server instructions", () => {
  it("front-loads ChatGPT Web write and manual gate rules", () => {
    const prefix = webvibeServerInstructions.slice(0, 512);

    expect(prefix).toContain("context.get");
    expect(prefix).toContain("change.prepare");
    expect(prefix).toContain("change.apply");
    expect(prefix).toContain("manual.gate");
    expect(prefix).toContain(safetyBlock);
    expect(prefix).toContain("retry once");
    expect(prefix).toContain("identical tool name");
    expect(prefix).toContain("identical JSON arguments");
    expect(webvibeServerInstructions).toContain("manual.confirm");
  });

  it("classifies host output without bypass advice", () => {
    expect(webvibeServerInstructions).toContain("normal_tool_result");
    expect(webvibeServerInstructions).toContain("secondary_confirmation_required");
    expect(webvibeServerInstructions).toContain("blocked_by_openai_safety");
    expect(webvibeServerInstructions).toContain("manual_required_capability_limit");
    expect(webvibeServerInstructions).toContain("cannot run arbitrary shell");
    expect(webvibeServerInstructions).toContain("requires confirmation");
    expect(webvibeServerInstructions).toContain("click allow");
    expect(webvibeServerInstructions).not.toContain("base64");
    expect(webvibeServerInstructions).not.toContain("split into smaller");
    expect(webvibeServerInstructions).not.toContain("applyById");
    expect(webvibeServerInstructions).not.toContain("applyPrepared");
    expect(webvibeServerInstructions).not.toContain("try another tool");
  });
});
