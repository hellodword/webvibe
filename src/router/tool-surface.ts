import type { RelayPolicy } from "../policy/policy.js";
import type { UpstreamManager } from "../upstream/manager.js";
import type { RegisteredTool } from "../upstream/registry.js";
import { sha256 } from "../util/hash.js";

export const TOOL_SURFACE_VERSION = "3.1.0";

export type PreflightFingerprint = {
  workspaceRootHash: string;
  mode?: string;
  policyHash: string;
  toolSurfaceVersion: string;
  toolDescriptorHash: string;
  upstreamHealthHash: string;
};

export function buildPreflightFingerprint(input: {
  workspaceRoot: string;
  policy: RelayPolicy;
  registry: Map<string, RegisteredTool>;
  upstreams: UpstreamManager;
}): PreflightFingerprint {
  return {
    workspaceRootHash: sha256(input.workspaceRoot),
    mode: input.policy.mode,
    policyHash: sha256(input.policy),
    toolSurfaceVersion: TOOL_SURFACE_VERSION,
    toolDescriptorHash: sha256(Array.from(input.registry.values()).map((entry) => entry.descriptor)),
    upstreamHealthHash: sha256(input.upstreams.listHealth()),
  };
}

export function fingerprintsEqual(left: PreflightFingerprint, right: PreflightFingerprint): boolean {
  return (
    left.workspaceRootHash === right.workspaceRootHash &&
    left.mode === right.mode &&
    left.policyHash === right.policyHash &&
    left.toolSurfaceVersion === right.toolSurfaceVersion &&
    left.toolDescriptorHash === right.toolDescriptorHash &&
    left.upstreamHealthHash === right.upstreamHealthHash
  );
}
