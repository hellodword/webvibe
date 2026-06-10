import { describe, expect, it } from "vitest";

import { classifyHostOutput, planHostRetry } from "../../src/manual/host-output.js";

const safetyBlock =
  "This tool call was blocked by OpenAI's safety checks. Please double check what you are sending.";

describe("host output classification", () => {
  it("classifies safety blocks and secondary confirmations", () => {
    expect(classifyHostOutput(safetyBlock)).toBe("blocked_by_openai_safety");
    expect(classifyHostOutput("受工具限制我无法用任意 shell 直接执行新增 Node 脚本")).toBe(
      "manual_required_capability_limit",
    );
    expect(
      classifyHostOutput("当前工具面不能直接执行任意 Node 命令，也没有暴露可用的 task id，所以没有实际跑到"),
    ).toBe("manual_required_capability_limit");
    expect(classifyHostOutput("Task unavailable: Missing executable: npm")).toBe(
      "manual_required_capability_limit",
    );
    expect(classifyHostOutput("This action requires confirmation. Please confirm to proceed.")).toBe(
      "secondary_confirmation_required",
    );
    expect(classifyHostOutput("applied: true")).toBe("normal_tool_result");
  });

  it("plans retries before manual gates", () => {
    expect(
      planHostRetry({
        outputText: "This action requires confirmation. Please confirm to proceed.",
        secondaryConfirmationAttempts: 0,
        safetyBlockAttempts: 0,
      }),
    ).toMatchObject({ action: "retry_same_tool_once" });
    expect(
      planHostRetry({
        outputText: "This action requires confirmation. Please confirm to proceed.",
        secondaryConfirmationAttempts: 1,
        safetyBlockAttempts: 0,
      }),
    ).toMatchObject({ action: "stop" });
    expect(
      planHostRetry({
        outputText: safetyBlock,
        secondaryConfirmationAttempts: 0,
        safetyBlockAttempts: 0,
      }),
    ).toMatchObject({ action: "retry_same_tool_once" });
    expect(
      planHostRetry({
        outputText: safetyBlock,
        secondaryConfirmationAttempts: 0,
        safetyBlockAttempts: 1,
      }),
    ).toMatchObject({ action: "manual.gate" });
    expect(
      planHostRetry({
        outputText: safetyBlock,
        secondaryConfirmationAttempts: 0,
        safetyBlockAttempts: 0,
        toolName: "manual.gate",
      }),
    ).toMatchObject({ action: "retry_same_tool_once" });
    expect(
      planHostRetry({
        outputText: safetyBlock,
        secondaryConfirmationAttempts: 0,
        safetyBlockAttempts: 1,
        toolName: "manual.gate",
      }),
    ).toMatchObject({ action: "stop", reason: "manual_gate_blocked" });
    expect(
      planHostRetry({
        outputText: "Cannot run arbitrary Node in this tool environment.",
        secondaryConfirmationAttempts: 0,
        safetyBlockAttempts: 0,
      }),
    ).toMatchObject({ action: "manual.gate" });
  });
});
