export type ManualActionReason =
  | "openai_safety_block"
  | "host_confirmation_block"
  | "manual_review_requested"
  | "external_manual_step"
  | "user_requested_manual_step";

export type ManualActionStatus = "pending" | "confirmed" | "cancelled" | "expired";

export type ManualArtifactRef = {
  artifactId: string;
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
  pendingId: string;
  preparedId?: string;
  reason: ManualActionReason;
  status: ManualActionStatus;
  title: string;
  instructions: string;
  createdAt: string;
  expiresAt: string;
  createdByTool: string;
  hostObservation?: {
    toolName?: string;
    outputText?: string;
    classification:
      | "secondary_confirmation_required"
      | "blocked_by_openai_safety"
      | "normal_tool_result"
      | "unknown";
  };
  artifacts: ManualArtifactRef[];
  checks: ManualCheck[];
  confirmTokenHash: string;
  events: Array<{
    at: string;
    type:
      | "created"
      | "widget_opened"
      | "confirmed"
      | "cancelled"
      | "expired"
      | "verification_failed";
    note?: string;
  }>;
};
