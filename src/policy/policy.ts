import type { z } from "zod";

import type {
  annotationsSchema,
  hostRiskSchema,
  inputPolicySchema,
  limitsOverrideSchema,
  limitsPolicySchema,
  modeSchema,
  policyInputSchema,
  policySchema,
  profileSchema,
  taskCatalogSchema,
  taskPolicySchema,
  taskBundlesSchema,
  toolPolicySchema,
  workflowToolSchema,
} from "./schema.js";

export type Mode = z.output<typeof modeSchema>;

export type ToolAnnotations = z.output<typeof annotationsSchema>;
export type TaskPolicy = z.output<typeof taskPolicySchema>;
export type InputPolicy = z.output<typeof inputPolicySchema>;
export type HostRiskPolicy = z.output<typeof hostRiskSchema>;
export type WorkflowToolPolicy = z.output<typeof workflowToolSchema>;
export type ToolPolicy = z.output<typeof toolPolicySchema>;
export type RelayPolicyInput = z.output<typeof policyInputSchema>;
export type RelayPolicy = z.output<typeof policySchema>;
export type WorkspacePolicy = RelayPolicy["workspace"];
export type LimitsOverride = z.output<typeof limitsOverrideSchema>;
export type LimitsPolicy = z.output<typeof limitsPolicySchema>;
export type PolicyProfile = z.output<typeof profileSchema>;
export type TaskBundlesPolicy = z.output<typeof taskBundlesSchema>;
export type TaskCatalogPolicy = z.output<typeof taskCatalogSchema>;
export type UpstreamPolicy = RelayPolicy["upstreams"][string];
