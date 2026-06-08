import path from "node:path";

import type { CallerIdentity } from "../router/tools-call.js";
import { sha256 } from "../util/hash.js";
import type { ManualActionScope } from "./types.js";

export function buildManualActionScope(input: {
  workspaceRoot: string;
  caller: CallerIdentity;
}): ManualActionScope {
  return {
    workspaceRootHash: sha256(path.resolve(input.workspaceRoot)),
    clientIdHash: hashOptional(input.caller.clientId),
    subjectHash: hashOptional(input.caller.subject),
    sessionHash: hashOptional(input.caller.openaiSession),
    organizationHash: hashOptional(input.caller.openaiOrganization),
  };
}

export function manualActionScopeMatches(
  recordScope: ManualActionScope | undefined,
  targetScope: ManualActionScope,
): boolean {
  if (!recordScope) return true;
  if (recordScope.workspaceRootHash !== targetScope.workspaceRootHash) return false;
  if (recordScope.sessionHash && targetScope.sessionHash) {
    return recordScope.sessionHash === targetScope.sessionHash;
  }
  if (recordScope.subjectHash && targetScope.subjectHash) {
    return recordScope.subjectHash === targetScope.subjectHash;
  }
  if (recordScope.clientIdHash && targetScope.clientIdHash) {
    return recordScope.clientIdHash === targetScope.clientIdHash;
  }
  return (
    !recordScope.sessionHash &&
    !recordScope.subjectHash &&
    !recordScope.clientIdHash &&
    !targetScope.sessionHash &&
    !targetScope.subjectHash &&
    !targetScope.clientIdHash
  );
}

function hashOptional(value: string | undefined): string | undefined {
  return value ? sha256(value) : undefined;
}
