import {
  CAPABILITY_LIMIT_FRAGMENTS,
  SAFETY_BLOCK_TEXT,
  SECONDARY_CONFIRMATION_FRAGMENTS,
} from "./constants.js";
import type { ManualActionRecord } from "./types.js";

export type HostOutputClassification = NonNullable<
  ManualActionRecord["hostObservation"]
>["classification"];

export type HostRetryDecision =
  | { action: "continue"; classification: HostOutputClassification }
  | {
      action: "retry_same_tool_once";
      classification: "secondary_confirmation_required" | "blocked_by_openai_safety";
    }
  | { action: "stop"; classification: "secondary_confirmation_required" }
  | {
      action: "manual.gate";
      classification: "blocked_by_openai_safety" | "manual_required_capability_limit";
    };

export function classifyHostOutput(outputText: string | undefined): HostOutputClassification {
  if (!outputText) return "unknown";
  if (outputText.includes(SAFETY_BLOCK_TEXT)) return "blocked_by_openai_safety";
  const lower = outputText.toLowerCase();
  if (
    CAPABILITY_LIMIT_FRAGMENTS.some((fragment) =>
      lower.includes(fragment.toLowerCase()),
    )
  ) {
    return "manual_required_capability_limit";
  }
  if (SECONDARY_CONFIRMATION_FRAGMENTS.some((fragment) => lower.includes(fragment))) {
    return "secondary_confirmation_required";
  }
  return "normal_tool_result";
}

export function planHostRetry(input: {
  outputText: string | undefined;
  secondaryConfirmationAttempts: number;
  safetyBlockAttempts: number;
}): HostRetryDecision {
  const classification = classifyHostOutput(input.outputText);
  if (classification === "blocked_by_openai_safety") {
    return input.safetyBlockAttempts > 0
      ? { action: "manual.gate", classification }
      : { action: "retry_same_tool_once", classification };
  }
  if (classification === "manual_required_capability_limit") {
    return { action: "manual.gate", classification };
  }
  if (classification === "secondary_confirmation_required") {
    return input.secondaryConfirmationAttempts > 0
      ? { action: "stop", classification }
      : { action: "retry_same_tool_once", classification };
  }
  return { action: "continue", classification };
}
