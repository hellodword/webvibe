import path from "node:path";

import { MANUAL_PREPARED_DIR, MANUAL_PREPARED_TTL_MS } from "./constants.js";
import type { ManualArtifactRef, ManualCheck } from "./types.js";
import { randomToken } from "../util/hash.js";
import {
  ensurePrivateDir,
  readJsonFile,
  resolveStorePath,
  writePrivateJson,
} from "./store-utils.js";

export type PreparedManualAction = {
  operationId: string;
  preparedId: string;
  createdAt: string;
  expiresAt: string;
  createdByTool: string;
  title: string;
  instructions: string;
  artifacts: ManualArtifactRef[];
  checks: ManualCheck[];
  debugPayload?: unknown;
};

export class PreparedManualActionStore {
  readonly dir: string;

  constructor(private readonly stateDir: string) {
    this.dir = path.join(stateDir, MANUAL_PREPARED_DIR);
  }

  async create(
    input: Omit<PreparedManualAction, "preparedId" | "createdAt" | "expiresAt"> & {
      createdAt?: string;
      expiresAt?: string;
    },
  ): Promise<PreparedManualAction> {
    const createdAt = input.createdAt ?? new Date().toISOString();
    const record: PreparedManualAction = {
      ...input,
      preparedId: randomToken(18),
      createdAt,
      expiresAt: input.expiresAt ?? new Date(Date.parse(createdAt) + MANUAL_PREPARED_TTL_MS).toISOString(),
    };
    await ensurePrivateDir(this.dir);
    await writePrivateJson(this.filePath(record.preparedId), record);
    return record;
  }

  async read(preparedId: string): Promise<PreparedManualAction | undefined> {
    await ensurePrivateDir(this.dir);
    return readJsonFile<PreparedManualAction>(this.filePath(preparedId));
  }

  filePath(preparedId: string): string {
    return resolveStorePath(this.dir, preparedId, ".json", "preparedId");
  }
}
