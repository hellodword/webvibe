import path from "node:path";

import { MANUAL_PENDING_DIR } from "./constants.js";
import type { ManualActionRecord } from "./types.js";
import { randomToken } from "../util/hash.js";
import {
  ensurePrivateDir,
  readJsonFile,
  resolveStorePath,
  writePrivateJson,
} from "./store-utils.js";

export class ManualPendingStore {
  readonly dir: string;

  constructor(private readonly stateDir: string) {
    this.dir = path.join(stateDir, MANUAL_PENDING_DIR);
  }

  newPendingId(): string {
    return randomToken(18);
  }

  async create(record: ManualActionRecord): Promise<ManualActionRecord> {
    await ensurePrivateDir(this.dir);
    await writePrivateJson(this.filePath(record.pendingId), record);
    return record;
  }

  async read(pendingId: string): Promise<ManualActionRecord | undefined> {
    await ensurePrivateDir(this.dir);
    return readJsonFile<ManualActionRecord>(this.filePath(pendingId));
  }

  async save(record: ManualActionRecord): Promise<void> {
    await ensurePrivateDir(this.dir);
    await writePrivateJson(this.filePath(record.pendingId), record);
  }

  filePath(pendingId: string): string {
    return resolveStorePath(this.dir, pendingId, ".json", "pendingId");
  }
}
