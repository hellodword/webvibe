import path from "node:path";

import { minimatch } from "minimatch";

import type { InputPolicy, WorkspacePolicy } from "./policy.js";
import { ForbiddenError } from "../util/errors.js";
import { isInside, toWorkspaceRelative } from "../util/paths.js";

export function assertInputPolicy(input: {
  policy?: InputPolicy;
  args: Record<string, unknown>;
  workspace: WorkspacePolicy;
  workspaceRoot: string;
}): void {
  const policy = input.policy;
  if (!policy) return;
  if (policy.require) {
    for (const [field, expected] of Object.entries(policy.require)) {
      if (!deepEqual(getPath(input.args, field), expected)) {
        throw new ForbiddenError(`Input field '${field}' must equal policy value`);
      }
    }
  }
  if (policy.deny) {
    for (const [field, denied] of Object.entries(policy.deny)) {
      if (deepEqual(getPath(input.args, field), denied)) {
        throw new ForbiddenError(`Input field '${field}' is denied by policy`);
      }
    }
  }
  if (policy.protectedPathPolicy !== "allow") {
    for (const field of policy.pathFields ?? []) {
      const value = getPath(input.args, field);
      for (const item of normalizePathValues(value)) {
        assertAllowedPath(input.workspaceRoot, item, input.workspace.protected);
      }
    }
  }
}

export function getPath(value: unknown, dottedPath: string): unknown {
  return dottedPath.split(".").reduce<unknown>((current, part) => {
    if (typeof current !== "object" || current === null) return undefined;
    return (current as Record<string, unknown>)[part];
  }, value);
}

function normalizePathValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((item) => normalizePathValues(item));
  return [];
}

function assertAllowedPath(
  workspaceRoot: string,
  candidate: string,
  protectedPatterns: string[],
): void {
  const absolute = path.isAbsolute(candidate) ? candidate : path.resolve(workspaceRoot, candidate);
  if (!isInside(workspaceRoot, absolute)) {
    throw new ForbiddenError(`Path is outside workspace: ${candidate}`);
  }
  const relative = toWorkspaceRelative(workspaceRoot, absolute);
  if (protectedPatterns.some((pattern) => minimatch(relative, pattern, { dot: true }))) {
    throw new ForbiddenError(`Path is protected by policy: ${candidate}`);
  }
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
