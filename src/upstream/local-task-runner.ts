import { lstat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import type { McpToolDescriptor } from "../descriptor/normalize.js";
import type { TaskPolicy, UpstreamPolicy, WorkspacePolicy } from "../policy/policy.js";
import { BadRequestError } from "../util/errors.js";
import { isInside, toWorkspaceRelative } from "../util/paths.js";
import { findExecutable } from "../workspace/inspect/command.js";
import { normalizeWorkspacePath } from "../workspace/inspect/path.js";
import type { UpstreamClient, UpstreamHealth } from "./client.js";

type TaskResult = {
  status: "ok" | "failed" | "timeout" | "unavailable";
  taskId: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timeoutSeconds: number;
  unavailableReason?: string;
  manualRequired?: ManualRequired;
};

type ManualRequired = {
  nextTool: "manual.gate";
  reason: "external_manual_step";
  title: string;
  instructions: string;
  hostObservation: {
    toolName: "task.run";
    outputText: string;
  };
};

export class LocalTaskRunnerClient implements UpstreamClient {
  private healthy = false;
  private lastError?: string;

  constructor(
    readonly id: string,
    private readonly policy: UpstreamPolicy,
    private readonly workspaceRoot: string,
    private readonly workspace: WorkspacePolicy,
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
        description: "Run a configured local task by id, optionally from a workspace-relative cwd.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: { type: "string", enum: taskIds },
            timeoutSeconds: {
              type: "integer",
              minimum: 1,
              maximum: Math.max(...taskIds.map((taskId) => this.maxTimeoutSeconds(taskId)), 1),
            },
            extraArgs: {
              type: "array",
              items: { type: "string" },
              maxItems: 20,
            },
            cwd: {
              type: "string",
              minLength: 1,
              maxLength: 500,
              description: "Workspace-relative task working directory.",
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
            unavailableReason: { type: "string" },
            manualRequired: {
              type: "object",
              properties: {
                nextTool: { type: "string", enum: ["manual.gate"] },
                reason: { type: "string", enum: ["external_manual_step"] },
                title: { type: "string" },
                instructions: { type: "string" },
                hostObservation: {
                  type: "object",
                  properties: {
                    toolName: { type: "string", enum: ["task.run"] },
                    outputText: { type: "string" },
                  },
                  required: ["toolName", "outputText"],
                  additionalProperties: false,
                },
              },
              required: ["nextTool", "reason", "title", "instructions", "hostObservation"],
              additionalProperties: false,
            },
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
    const cwd = await this.resolveTaskCwd(task, args.cwd);
    const extraArgs = this.extraArgsForTask(task, args.extraArgs);
    const unavailable = await this.checkAvailability(
      taskId,
      task,
      timeoutSeconds,
      startedAt,
      cwd,
      extraArgs,
    );
    if (unavailable) return unavailable;

    const env = { ...process.env, ...this.policy.env, ...task.env };

    return new Promise<TaskResult>((resolve) => {
      const child = spawn(task.executable, [...(task.args ?? []), ...extraArgs], {
        cwd,
        env,
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
          ...(error.code === "ENOENT"
            ? { unavailableReason: `Missing executable: ${displayExecutable(task.executable)}` }
            : {}),
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
    timeoutSeconds: number,
    startedAt: number,
    cwd: string,
    extraArgs: string[],
  ): Promise<TaskResult | undefined> {
    const env = { ...process.env, ...this.policy.env, ...task.env };
    const executable = await findExecutable(task.executable, env, this.workspaceRoot);
    if (executable.status === "missing") {
      return unavailable(
        taskId,
        timeoutSeconds,
        startedAt,
        `Missing executable: ${displayExecutable(task.executable)}`,
        task,
        cwd,
        this.workspaceRoot,
        extraArgs,
      );
    }
    return undefined;
  }

  private async resolveTaskCwd(task: TaskPolicy, rawCwd: unknown): Promise<string> {
    if (rawCwd === undefined || rawCwd === null) return this.resolveDefaultTaskCwd(task);
    if (typeof rawCwd !== "string") throw new BadRequestError("cwd must be string");
    if (rawCwd.length === 0) throw new BadRequestError("cwd must not be empty");
    const resolved = normalizeWorkspacePath(rawCwd, {
      workspaceRoot: this.workspaceRoot,
      workspace: this.workspace,
    });
    const stat = await safeLstat(resolved.absolutePath);
    if (!stat) throw new BadRequestError(`Task cwd does not exist: ${resolved.relativePath}`);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new BadRequestError(`Task cwd is not a directory: ${resolved.relativePath}`);
    }
    return resolved.absolutePath;
  }

  private resolveDefaultTaskCwd(task: TaskPolicy): string {
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

  private extraArgsForTask(task: TaskPolicy, raw: unknown): string[] {
    if (raw === undefined || raw === null) return [];
    if (!task.allowExtraArgs) throw new BadRequestError("Task does not accept extraArgs");
    if (!Array.isArray(raw)) throw new BadRequestError("extraArgs must be an array");
    const maxArgs = task.maxExtraArgs ?? 20;
    if (raw.length > maxArgs) throw new BadRequestError("extraArgs has too many items");
    const pattern = task.extraArgPattern ? new RegExp(task.extraArgPattern) : undefined;
    const allowed = new Set(task.allowedExtraArgs ?? []);
    return raw.map((item) => {
      if (typeof item !== "string") throw new BadRequestError("extraArgs items must be string");
      if (item.length === 0 || item.length > 200 || item.includes("\0")) {
        throw new BadRequestError("extraArgs item is invalid");
      }
      if (!allowed.has(item) && pattern && !pattern.test(item)) {
        throw new BadRequestError(`extraArgs item is not allowed: ${item}`);
      }
      if (!allowed.has(item) && !pattern) throw new BadRequestError("extraArgs are not allowed by pattern");
      return item;
    });
  }
}

function displayExecutable(executable: string): string {
  return executable.includes("/") || executable.includes("\\") ? path.basename(executable) : executable;
}

async function safeLstat(filePath: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(filePath);
  } catch (error: any) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

function unavailable(
  taskId: string,
  timeoutSeconds: number,
  startedAt: number,
  reason: string,
  task: TaskPolicy,
  cwd: string,
  workspaceRoot: string,
  extraArgs: string[],
): TaskResult {
  return {
    status: "unavailable",
    taskId,
    exitCode: null,
    stdout: "",
    stderr: `Task unavailable: ${reason}`,
    durationMs: Date.now() - startedAt,
    timeoutSeconds,
    unavailableReason: reason,
    manualRequired: manualRequiredForTask(taskId, reason, task, cwd, workspaceRoot, extraArgs),
  };
}

function manualRequiredForTask(
  taskId: string,
  reason: string,
  task: TaskPolicy,
  cwd: string,
  workspaceRoot: string,
  extraArgs: string[],
): ManualRequired {
  const outputText = `Task unavailable: ${reason}`;
  const logPath = `.webvibe/manual-logs/${safeLogName(taskId)}.log`;
  const cwdRelative = toWorkspaceRelative(workspaceRoot, cwd) || ".";
  const command = [...[task.executable, ...(task.args ?? []), ...extraArgs].map(shellQuote)].join(
    " ",
  );
  const commandInCwd =
    cwdRelative === "." ? command : `cd ${shellQuote(cwdRelative)} && ${command}`;
  return {
    nextTool: "manual.gate",
    reason: "external_manual_step",
    title: `Manual task required: ${taskId}`,
    instructions:
      `ChatGPT Web could not run task '${taskId}' because ${reason}.\n\n` +
      "Run this command outside ChatGPT from the workspace root:\n\n" +
      "```sh\n" +
      "mkdir -p .webvibe/manual-logs\n" +
      `LOG=${shellQuote(logPath)}\n` +
      `( ${commandInCwd} ) >"$LOG" 2>&1\n` +
      "STATUS=$?\n" +
      "printf '\\n[exit_code=%s]\\n' \"$STATUS\" >>\"$LOG\"\n" +
      "printf '%s\\n' \"$LOG\"\n" +
      "exit \"$STATUS\"\n" +
      "```\n\n" +
      `Reply in the next ChatGPT message with /resume ${logPath}`,
    hostObservation: {
      toolName: "task.run",
      outputText,
    },
  };
}

function safeLogName(taskId: string): string {
  return taskId.replace(/[^A-Za-z0-9_.-]+/g, "-") || "task";
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}
