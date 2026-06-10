import { createHash } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { MANUAL_ARTIFACT_DIR, MANUAL_ARTIFACT_TTL_MS } from "./constants.js";
import type { ManualArtifactRef } from "./types.js";
import { ForbiddenError, NotFoundError } from "../util/errors.js";
import { randomToken, sha256 } from "../util/hash.js";
import {
  ensurePrivateDir,
  readJsonFile,
  resolveStorePath,
  writePrivateJson,
} from "./store-utils.js";

export type ManualArtifactRecord = {
  artifactId: string;
  kind: "diff" | "task-log" | "manual" | "generic";
  filename: string;
  label: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
  expiresAt: string;
  downloadTokenHash: string;
  createdByTool: string;
  operationId: string;
};

export class ManualArtifactStore {
  readonly dir: string;

  constructor(stateDir: string) {
    this.dir = path.join(stateDir, MANUAL_ARTIFACT_DIR);
  }

  async create(input: {
    kind?: ManualArtifactRecord["kind"];
    label: string;
    filename: string;
    mimeType: string;
    content: string | Buffer;
    createdByTool: string;
    operationId: string;
    publicBaseUrl: string;
    createdAt?: string;
    expiresAt?: string;
  }): Promise<{ record: ManualArtifactRecord; ref: ManualArtifactRef; downloadToken: string }> {
    const artifactId = randomToken(18);
    const downloadToken = randomToken(24);
    const createdAt = input.createdAt ?? new Date().toISOString();
    const data = typeof input.content === "string" ? Buffer.from(input.content, "utf8") : input.content;
    const record: ManualArtifactRecord = {
      artifactId,
      kind: input.kind ?? "manual",
      filename: sanitizeFilename(input.filename),
      label: input.label,
      mimeType: supportedMimeType(input.mimeType),
      sizeBytes: data.byteLength,
      sha256: createHash("sha256").update(data).digest("hex"),
      createdAt,
      expiresAt: input.expiresAt ?? new Date(Date.parse(createdAt) + MANUAL_ARTIFACT_TTL_MS).toISOString(),
      downloadTokenHash: sha256(downloadToken),
      createdByTool: input.createdByTool,
      operationId: input.operationId,
    };

    await ensurePrivateDir(this.dir);
    await writeFile(this.dataPath(artifactId), data, { mode: 0o600 });
    await chmod(this.dataPath(artifactId), 0o600);
    await writePrivateJson(this.metaPath(artifactId), record);
    return {
      record,
      downloadToken,
      ref: {
        artifactId,
        kind: record.kind,
        label: record.label,
        filename: record.filename,
        mimeType: record.mimeType,
        sizeBytes: record.sizeBytes,
        sha256: record.sha256,
        downloadUrl: `${input.publicBaseUrl.replace(/\/$/, "")}/manual-artifacts/${artifactId}?t=${encodeURIComponent(downloadToken)}`,
        expiresAt: record.expiresAt,
      },
    };
  }

  async readMetadata(artifactId: string): Promise<ManualArtifactRecord | undefined> {
    await ensurePrivateDir(this.dir);
    return readJsonFile<ManualArtifactRecord>(this.metaPath(artifactId));
  }

  async saveMetadata(record: ManualArtifactRecord): Promise<void> {
    await ensurePrivateDir(this.dir);
    await writePrivateJson(this.metaPath(record.artifactId), record);
  }

  async openDownload(
    artifactId: string,
    downloadToken: string | null,
  ): Promise<{ record: ManualArtifactRecord; data: Buffer }> {
    if (!downloadToken) throw new ForbiddenError("Missing artifact download token");
    const record = await this.readMetadata(artifactId);
    if (!record) throw new NotFoundError("Manual artifact not found");
    if (record.downloadTokenHash !== sha256(downloadToken)) {
      throw new ForbiddenError("Invalid artifact download token");
    }
    if (Date.now() > Date.parse(record.expiresAt)) {
      throw new ForbiddenError("Manual artifact expired");
    }
    try {
      const data = await readFile(this.dataPath(artifactId));
      return { record, data };
    } catch (error: any) {
      if (error?.code === "ENOENT") throw new NotFoundError("Manual artifact file not found");
      throw error;
    }
  }

  dataPath(artifactId: string): string {
    return resolveStorePath(this.dir, artifactId, ".data", "artifactId");
  }

  metaPath(artifactId: string): string {
    return resolveStorePath(this.dir, artifactId, ".json", "artifactId");
  }
}

export function sanitizeFilename(filename: string): string {
  const base = path.basename(filename).replace(/[\0\r\n"]/g, "_").trim();
  return base || "manual-artifact.bin";
}

function supportedMimeType(mimeType: string): string {
  const allowed = new Set([
    "text/plain",
    "text/markdown",
    "text/x-diff",
    "application/json",
    "application/octet-stream",
  ]);
  return allowed.has(mimeType) ? mimeType : "application/octet-stream";
}
