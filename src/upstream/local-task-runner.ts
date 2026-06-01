import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import type { McpToolDescriptor } from "../descriptor/normalize.js";
import type { TaskPolicy, UpstreamPolicy } from "../policy/policy.js";
import { isInside } from "../util/paths.js";
import type { UpstreamClient, UpstreamHealth } from "./client.js";

type TaskResult = {
  status: "ok" | "failed" | "timeout" | "unavailable";
  taskId: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timeoutSeconds: number;
};

export class LocalTaskRunnerClient implements UpstreamClient {
  private healthy = false;
  private lastError?: string;

  constructor(
    readonly id: string,
    private readonly policy: UpstreamPolicy,
    private readonly workspaceRoot: string,
  ) {}

  get optional(): boolean {
    return this.policy.optional === true;
  }

  async initialize(): Promise<void> {
    if (Object.keys(this.tasks()).length === 0) {
      throw new Error(`No tasks configured for upstream '${this.id}'`);
    }
    this.healthy = true;
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    const taskIds = Object.keys(this.tasks());
    return [
      {
        name: "run_task",
        description: "Run a configured local task by id.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: { type: "string", enum: taskIds },
            timeoutSeconds: {
              type: "integer",
              minimum: 1,
              maximum: Math.max(...taskIds.map((taskId) => this.maxTimeoutSeconds(taskId)), 1),
            },
          },
          required: ["taskId"],
          additionalProperties: false,
        },
        outputSchema: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["ok", "failed", "timeout", "unavailable"] },
            taskId: { type: "string" },
            exitCode: { type: ["integer", "null"] },
            stdout: { type: "string" },
            stderr: { type: "string" },
            durationMs: { type: "integer" },
            timeoutSeconds: { type: "integer" },
          },
          required: [
            "status",
            "taskId",
            "exitCode",
            "stdout",
            "stderr",
            "durationMs",
            "timeoutSeconds",
          ],
          additionalProperties: false,
        },
      },
    ];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (name !== "run_task") throw new Error(`Unknown local task tool: ${name}`);
    const taskId = typeof args.taskId === "string" ? args.taskId : "";
    const task = this.tasks()[taskId];
    if (!task) throw new Error(`Unknown local task id: ${taskId}`);
    return this.runTask(taskId, task, args);
  }

  async close(): Promise<void> {
    this.healthy = false;
  }

  health(): UpstreamHealth {
    return { id: this.id, healthy: this.healthy, optional: this.optional, error: this.lastError };
  }

  private async runTask(
    taskId: string,
    task: TaskPolicy,
    args: Record<string, unknown>,
  ): Promise<TaskResult> {
    const startedAt = Date.now();
    const timeoutSeconds = this.effectiveTimeoutSeconds(taskId, args.timeoutSeconds);
    const cwd = this.resolveTaskCwd(task);
    const unavailable = await this.checkAvailability(taskId, task, cwd, timeoutSeconds, startedAt);
    if (unavailable) return unavailable;

    return new Promise<TaskResult>((resolve) => {
      const child = spawn(task.executable, task.args ?? [], {
        cwd,
        env: { ...process.env, ...this.policy.env, ...task.env },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;
      let killTimer: NodeJS.Timeout | undefined;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        killTimer = setTimeout(() => {
          if (!settled) child.kill("SIGKILL");
        }, 2000);
      }, timeoutSeconds * 1000);
      const finish = (result: TaskResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        resolve(result);
      };

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", (error: NodeJS.ErrnoException) => {
        this.lastError = error.message;
        finish({
          status: error.code === "ENOENT" ? "unavailable" : "failed",
          taskId,
          exitCode: null,
          stdout,
          stderr: stderr || error.message,
          durationMs: Date.now() - startedAt,
          timeoutSeconds,
        });
      });
      child.on("close", (code) => {
        const normalizedStdout = stdout.trimEnd();
        const normalizedStderr = stderr.trimEnd();
        const failedByStdout = task.failOnStdout === true && normalizedStdout.length > 0;
        finish({
          status: timedOut ? "timeout" : code === 0 && !failedByStdout ? "ok" : "failed",
          taskId,
          exitCode: code,
          stdout: normalizedStdout,
          stderr: normalizedStderr,
          durationMs: Date.now() - startedAt,
          timeoutSeconds,
        });
      });
    });
  }

  private async checkAvailability(
    taskId: string,
    task: TaskPolicy,
    cwd: string,
    timeoutSeconds: number,
    startedAt: number,
  ): Promise<TaskResult | undefined> {
    for (const file of task.requiredFiles ?? []) {
      const target = path.resolve(cwd, file);
      if (!isInside(cwd, target)) return unavailable(taskId, timeoutSeconds, startedAt, file);
      try {
        await access(target);
      } catch {
        return unavailable(taskId, timeoutSeconds, startedAt, file);
      }
    }
    if (task.requiredPackageScript) {
      try {
        const packageJson = JSON.parse(await readFile(path.resolve(cwd, "package.json"), "utf8"));
        if (
          typeof packageJson !== "object" ||
          packageJson === null ||
          typeof packageJson.scripts !== "object" ||
          packageJson.scripts === null ||
          typeof packageJson.scripts[task.requiredPackageScript] !== "string"
        ) {
          return unavailable(taskId, timeoutSeconds, startedAt, task.requiredPackageScript);
        }
      } catch {
        return unavailable(taskId, timeoutSeconds, startedAt, task.requiredPackageScript);
      }
    }
    return undefined;
  }

  private resolveTaskCwd(task: TaskPolicy): string {
    const raw = task.cwd ?? this.policy.cwd ?? this.workspaceRoot;
    const cwd = path.isAbsolute(raw) ? raw : path.resolve(this.workspaceRoot, raw);
    if (!isInside(this.workspaceRoot, cwd)) {
      throw new Error(`Task cwd is outside workspace: ${raw}`);
    }
    return cwd;
  }

  private effectiveTimeoutSeconds(taskId: string, raw: unknown): number {
    const requested = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : undefined;
    const defaultTimeout = this.tasks()[taskId]?.defaultTimeoutSeconds ?? 300;
    return Math.min(Math.max(requested ?? defaultTimeout, 1), this.maxTimeoutSeconds(taskId));
  }

  private maxTimeoutSeconds(taskId: string): number {
    return this.tasks()[taskId]?.maxTimeoutSeconds ?? 36000;
  }

  private tasks(): Record<string, TaskPolicy> {
    return this.policy.tasks ?? {};
  }
}

function unavailable(
  taskId: string,
  timeoutSeconds: number,
  startedAt: number,
  reason: string,
): TaskResult {
  return {
    status: "unavailable",
    taskId,
    exitCode: null,
    stdout: "",
    stderr: `Task unavailable: ${reason}`,
    durationMs: Date.now() - startedAt,
    timeoutSeconds,
  };
}
