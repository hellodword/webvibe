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

export const CAPABILITY_LIMIT_FRAGMENTS = [
  "受工具限制",
  "无法用任意 shell",
  "无法使用任意 shell",
  "无法执行任意 shell",
  "不能用任意 shell",
  "cannot run arbitrary shell",
  "cannot execute arbitrary shell",
  "unable to run arbitrary shell",
  "arbitrary shell is unavailable",
  "task unavailable",
  "tool unavailable",
  "missing executable",
  "task upstream is unavailable",
];

export const MANUAL_OUTPUT_MAX_CHARS = 20_000;
export const MANUAL_EVIDENCE_NOTE_MAX_CHARS = 4_000;
