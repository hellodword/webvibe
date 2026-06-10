import { createHash } from "node:crypto";
import { appendFile, chmod, writeFile } from "node:fs/promises";
import path from "node:path";

import { ensurePrivateDir, readJsonFile, resolveStorePath, writePrivateJson } from "../manual/store-utils.js";
import type { ManualRequired } from "./local-task-runner.js";
import { randomToken } from "../util/hash.js";

export type TaskOutputSummary = {
  head: string;
  tail: string;
  truncated: boolean;
  sha256: string;
  bytes: number;
  logPath: string;
};

export type TaskRunRecord = {
  runId: string;
  taskId: string;
  status: "running" | "ok" | "failed" | "timeout" | "unavailable";
  exitCode: number | null;
  durationMs: number;
  timeoutSeconds: number;
  cwd?: string;
  startedAt: string;
  completedAt?: string;
  stdout: TaskOutputSummary;
  stderr: TaskOutputSummary;
  unavailableReason?: string;
  manualRequired?: ManualRequired;
};

export type TaskOutputLimits = {
  outputHeadBytes: number;
  outputTailBytes: number;
};

export class TaskLogStore {
  readonly dir: string;

  constructor(
    private readonly workspaceRoot: string,
    private readonly limits: TaskOutputLimits = { outputHeadBytes: 12000, outputTailBytes: 12000 },
  ) {
    this.dir = path.join(workspaceRoot, ".webvibe", "task-logs");
  }

  newRunId(): string {
    return `tr_${randomToken(12)}`;
  }

  stdoutPath(runId: string): string {
    return resolveStorePath(this.dir, runId, ".stdout.log", "runId");
  }

  stderrPath(runId: string): string {
    return resolveStorePath(this.dir, runId, ".stderr.log", "runId");
  }

  metaPath(runId: string): string {
    return resolveStorePath(this.dir, runId, ".json", "runId");
  }

  async createCapture(runId: string, stream: "stdout" | "stderr"): Promise<TaskOutputCapture> {
    await ensurePrivateDir(this.dir);
    const absolutePath = stream === "stdout" ? this.stdoutPath(runId) : this.stderrPath(runId);
    await writeFile(absolutePath, "", { mode: 0o600 });
    await chmod(absolutePath, 0o600);
    return new TaskOutputCapture({
      absolutePath,
      logPath: path.relative(this.workspaceRoot, absolutePath).replaceAll(path.sep, "/"),
      headBytes: this.limits.outputHeadBytes,
      tailBytes: this.limits.outputTailBytes,
    });
  }

  async writeRecord(record: TaskRunRecord): Promise<void> {
    await ensurePrivateDir(this.dir);
    await writePrivateJson(this.metaPath(record.runId), record);
  }

  async readRecord(runId: string): Promise<TaskRunRecord | undefined> {
    await ensurePrivateDir(this.dir);
    return readJsonFile<TaskRunRecord>(this.metaPath(runId));
  }
}

export function emptyTaskOutputSummary(logPath = ""): TaskOutputSummary {
  return taskOutputSummaryFromText("", logPath);
}

export function taskOutputSummaryFromText(text: string, logPath = ""): TaskOutputSummary {
  const data = Buffer.from(text, "utf8");
  return {
    head: text.trimEnd(),
    tail: text.trimEnd(),
    truncated: false,
    sha256: createHash("sha256").update(data).digest("hex"),
    bytes: data.byteLength,
    logPath,
  };
}

export class TaskOutputCapture {
  private readonly hash = createHash("sha256");
  private head = Buffer.alloc(0);
  private tail = Buffer.alloc(0);
  private bytes = 0;
  private pendingWrite = Promise.resolve();

  constructor(
    private readonly options: {
      absolutePath: string;
      logPath: string;
      headBytes: number;
      tailBytes: number;
    },
  ) {}

  get hasOutput(): boolean {
    return this.bytes > 0;
  }

  get logPath(): string {
    return this.options.logPath;
  }

  write(chunk: Buffer): void {
    const data = Buffer.from(chunk);
    this.hash.update(data);
    this.bytes += data.byteLength;
    if (this.head.byteLength < this.options.headBytes) {
      const needed = this.options.headBytes - this.head.byteLength;
      this.head = Buffer.concat([this.head, data.subarray(0, needed)]);
    }
    this.tail = Buffer.concat([this.tail, data]).subarray(-this.options.tailBytes);
    this.pendingWrite = this.pendingWrite.then(() => appendFile(this.options.absolutePath, data));
  }

  async finish(): Promise<TaskOutputSummary> {
    await this.pendingWrite;
    return {
      head: decodeOutput(this.head),
      tail: decodeOutput(this.tail),
      truncated: this.bytes > this.options.headBytes || this.bytes > this.options.tailBytes,
      sha256: this.hash.digest("hex"),
      bytes: this.bytes,
      logPath: this.options.logPath,
    };
  }
}

function decodeOutput(buffer: Buffer): string {
  return buffer.toString("utf8").trimEnd();
}
