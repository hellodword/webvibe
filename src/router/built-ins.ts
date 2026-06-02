import type { RelayPolicy } from "../policy/policy.js";
import type { RegisteredTool } from "../upstream/registry.js";
import type { UpstreamManager } from "../upstream/manager.js";
import { ForbiddenError } from "../util/errors.js";
import { applyChangeset, fileManifest, previewChangeset } from "../workspace/changeset.js";

export type BuiltInContext = {
  registry: Map<string, RegisteredTool>;
  policy: RelayPolicy;
  upstreams: UpstreamManager;
  workspaceRoot: string;
};

export function callBuiltIn(
  name: string,
  args: Record<string, unknown>,
  context: BuiltInContext,
): unknown | Promise<unknown> {
  if (name === "relay.info") {
    return {
      name: "webvibe",
      mode: context.policy.mode,
      tools: Array.from(context.registry.keys()),
    };
  }
  if (name === "relay.list_upstreams") {
    return { upstreams: context.upstreams.listHealth() };
  }
  if (name === "relay.list_tools") {
    return { tools: Array.from(context.registry.values()).map((entry) => entry.descriptor) };
  }
  if (name === "repo.file_manifest") {
    return fileManifest(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
      limits: context.policy.limits,
    });
  }
  if (name === "repo.preview_changeset") {
    return previewChangeset(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
      limits: context.policy.limits,
    });
  }
  if (name === "repo.apply_changeset") {
    return applyChangeset(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
      limits: context.policy.limits,
    });
  }
  throw new ForbiddenError(`Unknown built-in tool: ${name}`);
}
