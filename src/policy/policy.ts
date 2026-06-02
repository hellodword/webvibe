import type { z } from "zod";

import type {
  annotationsSchema,
  inputPolicySchema,
  modeSchema,
  policySchema,
  taskPolicySchema,
  toolPolicySchema,
  workflowToolSchema,
} from "./schema.js";

export type Mode = z.output<typeof modeSchema>;

export type ToolAnnotations = z.output<typeof annotationsSchema>;
export type TaskPolicy = z.output<typeof taskPolicySchema>;
export type InputPolicy = z.output<typeof inputPolicySchema>;
export type WorkflowToolPolicy = z.output<typeof workflowToolSchema>;
export type ToolPolicy = z.output<typeof toolPolicySchema>;
export type RelayPolicy = z.output<typeof policySchema>;
export type WorkspacePolicy = RelayPolicy["workspace"];
export type LimitsPolicy = RelayPolicy["limits"];
export type UpstreamPolicy = RelayPolicy["upstreams"][string];
