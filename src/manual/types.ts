export type ManualActionReason =
  | "openai_safety_block"
  | "manual_review_requested"
  | "external_manual_step";

export type ManualActionStatus = "pending" | "confirmed" | "cancelled" | "expired";

export type ManualActionScope = {
  workspaceRootHash: string;
  clientIdHash?: string;
  subjectHash?: string;
  sessionHash?: string;
  organizationHash?: string;
};

export type ManualOperation = {
  id: string;
  kind: "task" | "change" | "external";
};

export type ManualInterruptedAt = "task" | "edit" | "test" | "commit" | "other";

export type ManualNextAfterResume = {
  tool: string;
  reason: string;
};

export type ManualLogEvidence = {
  path: string;
  sizeBytes: number;
  sha256: string;
  head: string;
  tail: string;
  exitCode?: number;
};

export type ManualArtifactRef = {
  artifactId: string;
  kind: "diff" | "task-log" | "manual" | "generic";
  label: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  downloadUrl: string;
  expiresAt: string;
};

export type ManualCheck =
  | {
      kind: "workspace-path-state";
      path: string;
      expected:
        | { exists: true; type?: "file" | "directory"; sha256?: string }
        | { exists: false };
    }
  | {
      kind: "git-worktree";
      paths?: string[];
      expected: "changed" | "clean" | "any";
    }
  | {
      kind: "none";
      description: string;
    };

export type ManualActionRecord = {
  operationId: string;
  operation?: ManualOperation;
  originalRequestSummary?: string;
  interruptedAt?: ManualInterruptedAt;
  nextAfterResume?: ManualNextAfterResume;
  manualFormatVersion?: "WEBVIBE_MANUAL_REQUIRED v1";
  manualMessageHash?: string;
  pendingId: string;
  preparedId?: string;
  reason: ManualActionReason;
  status: ManualActionStatus;
  title: string;
  instructions: string;
  createdAt: string;
  expiresAt: string;
  createdByTool: string;
  scope: ManualActionScope;
  hostObservation?: {
    toolName?: string;
    outputText?: string;
    classification:
      | "secondary_confirmation_required"
      | "blocked_by_openai_safety"
      | "manual_required_capability_limit"
      | "normal_tool_result"
      | "unknown";
  };
  artifacts: ManualArtifactRef[];
  checks: ManualCheck[];
  events: Array<{
    at: string;
    type:
      | "created"
      | "confirmed"
      | "cancelled"
      | "expired"
      | "verification_failed";
    manualLogPath?: string;
    manualLog?: ManualLogEvidence;
  }>;
};
