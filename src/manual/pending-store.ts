import { readdir } from "node:fs/promises";
import path from "node:path";

import { MANUAL_PENDING_DIR } from "./constants.js";
import { manualActionScopeMatches } from "./scope.js";
import type { ManualActionRecord, ManualActionScope } from "./types.js";
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

  async list(): Promise<ManualActionRecord[]> {
    await ensurePrivateDir(this.dir);
    const entries = await readdir(this.dir, { withFileTypes: true });
    const records: ManualActionRecord[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const pendingId = entry.name.slice(0, -".json".length);
      const record = await this.read(pendingId);
      if (record) records.push(record);
    }
    return records;
  }

  async listPendingForScope(
    scope: ManualActionScope,
    now = Date.now(),
  ): Promise<ManualActionRecord[]> {
    const records = await this.list();
    const pending: ManualActionRecord[] = [];
    for (const record of records) {
      if (!manualActionScopeMatches(record.scope, scope)) continue;
      const active = await this.expireIfNeeded(record, now);
      if (active.status === "pending") pending.push(active);
    }
    return pending;
  }

  async expirePendingForScope(
    scope: ManualActionScope,
    now = Date.now(),
  ): Promise<ManualActionRecord[]> {
    const records = await this.list();
    const expired: ManualActionRecord[] = [];
    for (const record of records) {
      if (record.status !== "pending") continue;
      if (!manualActionScopeMatches(record.scope, scope)) continue;
      if (now <= Date.parse(record.expiresAt)) continue;
      expired.push(await this.expireIfNeeded(record, now));
    }
    return expired;
  }

  async firstBlockingPending(
    scope: ManualActionScope,
    now = Date.now(),
  ): Promise<ManualActionRecord | undefined> {
    const pending = await this.listPendingForScope(scope, now);
    return pending.sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  }

  filePath(pendingId: string): string {
    return resolveStorePath(this.dir, pendingId, ".json", "pendingId");
  }

  private async expireIfNeeded(
    record: ManualActionRecord,
    now: number,
  ): Promise<ManualActionRecord> {
    if (record.status !== "pending" || now <= Date.parse(record.expiresAt)) return record;
    const expired = {
      ...record,
      status: "expired" as const,
      events: [...record.events, { at: new Date(now).toISOString(), type: "expired" as const }],
    };
    await this.save(expired);
    return expired;
  }
}
