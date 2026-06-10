import type { HostRiskPolicy, LimitsPolicy, WorkspacePolicy } from "../../policy/policy.js";
import type { ParsedChange } from "./schema.js";

export type WorkspaceContext = {
  workspaceRoot: string;
  workspace: WorkspacePolicy;
  limits: LimitsPolicy;
  hostRisk?: HostRiskPolicy;
};

export type EffectiveLimits = {
  maxChangesetFiles: number;
  maxChangesetBytes: number;
  maxChangesetFileBytes: number;
};

export type ResolvedWorkspacePath = {
  relativePath: string;
  absolutePath: string;
};

export type FileState = {
  content: string;
  sha256: string;
  sizeBytes: number;
  mode: number;
  mtimeMs: number;
};

export type Conflict = {
  path: string;
  reason: string;
  expectedSha256?: string;
  actualSha256?: string;
};

export type ChangesetSummary = {
  total: number;
  creates: number;
  edits: number;
  replaces: number;
  deletes: number;
  renames: number;
  mkdirs: number;
};

export type PlannedFile = {
  path: string;
  op: ParsedChange["op"];
  beforeSha256?: string;
  afterSha256?: string;
  sizeBytes?: number;
};

export type PlannedAction = {
  op: ParsedChange["op"];
  path: string;
  absolutePath: string;
  toPath?: string;
  toAbsolutePath?: string;
  before?: FileState;
  afterContent?: string;
  afterSha256?: string;
  diff?: string;
};

export type ChangesetPlan = {
  baseRevision?: string;
  summary: ChangesetSummary;
  files: PlannedFile[];
  diff: string;
  conflicts: Conflict[];
  actions: PlannedAction[];
};

export type Snapshot =
  | {
      kind: "missing";
      absolutePath: string;
      cleanup: "file" | "directory";
    }
  | {
      kind: "file";
      absolutePath: string;
      content: string;
      mode: number;
    }
  | {
      kind: "directory";
      absolutePath: string;
    };

export type ManifestEntry = {
  path: string;
  exists: boolean;
  type: "file" | "directory" | "symlink" | "other" | "missing";
  sizeBytes?: number;
  sha256?: string;
  mtimeMs?: number;
};
