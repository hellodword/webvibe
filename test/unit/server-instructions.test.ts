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
    expect(prefix).toContain("retry that same tool call once");
    expect(prefix).toContain("identical tool name");
    expect(prefix).toContain("identical JSON arguments");
    expect(webvibeServerInstructions).toContain("Before any manual.gate call");
    expect(webvibeServerInstructions).toContain("must first show the exact manual instructions");
    expect(webvibeServerInstructions).toContain("manual.resume");
    expect(webvibeServerInstructions).toContain("/resume");
    expect(webvibeServerInstructions).toContain("MANUAL_PENDING_REQUIRED");
    expect(webvibeServerInstructions).toContain("stop the assistant turn immediately");
  });

  it("classifies host output without bypass advice", () => {
    expect(webvibeServerInstructions).toContain("normal_tool_result");
    expect(webvibeServerInstructions).toContain("secondary_confirmation_required");
    expect(webvibeServerInstructions).toContain("blocked_by_openai_safety");
    expect(webvibeServerInstructions).toContain("manual_required_capability_limit");
    expect(webvibeServerInstructions).toContain("OpenAI host limitation or bug");
    expect(webvibeServerInstructions).toContain("retry the same manual.gate call once");
    expect(webvibeServerInstructions).toContain("original interrupted user request");
    expect(webvibeServerInstructions).toContain("cannot run arbitrary shell");
    expect(webvibeServerInstructions).toContain("requires confirmation");
    expect(webvibeServerInstructions).toContain("click allow");
    expect(webvibeServerInstructions).not.toContain("base64");
    expect(webvibeServerInstructions).not.toContain("split into smaller");
    expect(webvibeServerInstructions).not.toContain("applyById");
    expect(webvibeServerInstructions).not.toContain("applyPrepared");
  });
});
