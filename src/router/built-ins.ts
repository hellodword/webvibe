import type { RelayPolicy } from "../policy/policy.js";
import type { RegisteredTool } from "../upstream/registry.js";
import type { UpstreamManager } from "../upstream/manager.js";
import { ForbiddenError } from "../util/errors.js";
import { applyChangeset, fileManifest, previewChangeset } from "../workspace/changeset.js";
import { fileTree, searchCode } from "../workspace/inspect/code.js";
import { inspectEnvironment } from "../workspace/inspect/env.js";
import {
  gitBranch,
  gitCommitPaths,
  gitDiffStaged,
  gitDiffUnstaged,
  gitLog,
  gitLsFiles,
  gitRevParse,
  gitShow,
  gitStatus,
} from "../workspace/inspect/git.js";
import { inspectProject } from "../workspace/inspect/project.js";

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
  if (name === "env.inspect") {
    return inspectEnvironment({
      registry: context.registry,
      policy: context.policy,
      workspaceRoot: context.workspaceRoot,
    });
  }
  if (name === "project.inspect") {
    return inspectProject(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
    });
  }
  if (name === "code.search") {
    return searchCode(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
    });
  }
  if (name === "code.file_tree") {
    return fileTree(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
    });
  }
  if (name === "git.status") {
    return gitStatus(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
    });
  }
  if (name === "git.diff_unstaged") {
    return gitDiffUnstaged(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
    });
  }
  if (name === "git.diff_staged") {
    return gitDiffStaged(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
    });
  }
  if (name === "git.log") {
    return gitLog(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
    });
  }
  if (name === "git.show") {
    return gitShow(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
    });
  }
  if (name === "git.branch") {
    return gitBranch(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
    });
  }
  if (name === "git.ls_files") {
    return gitLsFiles(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
    });
  }
  if (name === "git.rev_parse") {
    return gitRevParse(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
    });
  }
  if (name === "git.commit_paths") {
    return gitCommitPaths(args, {
      workspaceRoot: context.workspaceRoot,
      workspace: context.policy.workspace,
    });
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
