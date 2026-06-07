export const MANUAL_PENDING_TTL_MS = 24 * 60 * 60 * 1000;
export const MANUAL_PREPARED_TTL_MS = 24 * 60 * 60 * 1000;
export const MANUAL_ARTIFACT_TTL_MS = 24 * 60 * 60 * 1000;

export const MANUAL_PENDING_DIR = "manual-pending";
export const MANUAL_PREPARED_DIR = "manual-prepared";
export const MANUAL_ARTIFACT_DIR = "manual-artifacts";

export const SAFETY_BLOCK_TEXT =
  "This tool call was blocked by OpenAI's safety checks. Please double check what you are sending.";

export const SECONDARY_CONFIRMATION_FRAGMENTS = [
  "requires confirmation",
  "requires approval",
  "please confirm",
  "confirm to proceed",
  "allow this action",
  "click allow",
  "needs user approval",
];
