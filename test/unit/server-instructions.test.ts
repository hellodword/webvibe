import { describe, expect, it } from "vitest";

import {
  WEBVIBE_INSTRUCTION_VERSION,
  webvibeServerInstructions,
} from "../../src/server/instructions.js";

const safetyBlock =
  "This tool call was blocked by OpenAI's safety checks. Please double check what you are sending.";

describe("server instructions", () => {
  it("publishes a stable instruction contract version", () => {
    expect(WEBVIBE_INSTRUCTION_VERSION).toBe("4.0.2");
    expect(webvibeServerInstructions.length).toBeGreaterThan(1000);
  });

  it("publishes the initialize-time workflow contract", () => {
    expect(webvibeServerInstructions).toContain("workspace.context");
    expect(webvibeServerInstructions).toContain("change.preview");
    expect(webvibeServerInstructions).toContain("change.apply");
    expect(webvibeServerInstructions).toContain("manual.prepare");
    expect(webvibeServerInstructions).toContain("manual.gate");
    expect(webvibeServerInstructions).toContain("manual.status");
    expect(webvibeServerInstructions).toContain("manual.resume");
    expect(webvibeServerInstructions).toContain("/resume");
    expect(webvibeServerInstructions).toContain("fs.*");
    expect(webvibeServerInstructions).toContain("MANUAL_PENDING_REQUIRED");
    expect(webvibeServerInstructions).toContain(safetyBlock);
    expect(webvibeServerInstructions).toContain("identical JSON arguments");
    expect(webvibeServerInstructions).toContain("stop the assistant turn immediately");
    expect(webvibeServerInstructions).toContain("Only confirmed resumes");
  });

  it("covers host-output decisions without bypass advice", () => {
    expect(webvibeServerInstructions).toContain("normal_tool_result");
    expect(webvibeServerInstructions).toContain("secondary_confirmation_required");
    expect(webvibeServerInstructions).toContain("blocked_by_openai_safety");
    expect(webvibeServerInstructions).toContain("manual_required_capability_limit");
    expect(webvibeServerInstructions).toContain("OpenAI host limitation or bug");
    expect(webvibeServerInstructions).not.toContain("base64");
    expect(webvibeServerInstructions).not.toContain("split into smaller");
    expect(webvibeServerInstructions).not.toContain("applyById");
    expect(webvibeServerInstructions).not.toContain("applyPrepared");
  });
});
