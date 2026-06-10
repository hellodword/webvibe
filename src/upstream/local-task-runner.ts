import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import type { McpToolDescriptor } from "../descriptor/normalize.js";
import type { TaskPolicy, UpstreamPolicy, WorkspacePolicy } from "../policy/policy.js";
import { BadRequestError } from "../util/errors.js";
import { isInside, toWorkspaceRelative } from "../util/paths.js";
import { findExecutable } from "../workspace/inspect/command.js";
import { normalizeWorkspacePath } from "../workspace/inspect/path.js";
import type { UpstreamClient, UpstreamHealth } from "./client.js";
import {
  TaskLogStore,
  type TaskOutputLimits,
  type TaskOutputSummary,
  type TaskRunRecord,
} from "./task-log-store.js";
import { parseTaskDiagnostics, type TaskDiagnostic } from "./task-diagnostics.js";

type TaskResult = {
  status: "running" | "ok" | "failed" | "timeout" | "unavailable";
  runId: string;
  taskId: string;
  exitCode: number | null;
  stdout: TaskOutputSummary;
  stderr: TaskOutputSummary;
  diagnostics: TaskDiagnostic[];
  durationMs: number;
  timeoutSeconds: number;
  effectiveCommand: EffectiveCommand;
  checks: TaskCheck[];
  hostRisk: "medium";
  next: Record<string, unknown>;
  unavailableReason?: string;
  manualRequired?: ManualRequired;
};

type EffectiveCommand = {
  executable: string;
  args: string[];
  cwd: string;
};

type TaskCheck = {
  kind: string;
  name?: string;
  path?: string;
  ok: boolean;
  reason?: string;
};

export type ManualRequired = {
  nextTool: "manual.gate";
  reason: "external_manual_step";
  userInstructions: string;
  hostObservation: {
    toolName: string;
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
    private readonly outputLimits: TaskOutputLimits = {
      outputHeadBytes: 12000,
      outputTailBytes: 12000,
    },
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
            extra: {
              type: "object",
              properties: {
                packages: {
                  type: "array",
                  items: { type: "string" },
                  maxItems: 20,
                },
                modules: {
                  type: "array",
                  items: { type: "string" },
                  maxItems: 20,
                },
                dev: { type: "boolean" },
              },
              additionalProperties: false,
            },
            cwd: {
              type: "string",
              minLength: 1,
              maxLength: 500,
              description: "Workspace-relative task working directory.",
            },
            mode: {
              type: "string",
              enum: ["foreground", "background"],
            },
          },
          required: ["taskId"],
          additionalProperties: false,
        },
        outputSchema: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["running", "ok", "failed", "timeout", "unavailable"] },
            runId: { type: "string" },
            taskId: { type: "string" },
            exitCode: { type: ["integer", "null"] },
            stdout: taskOutputSummarySchema(),
            stderr: taskOutputSummarySchema(),
            diagnostics: taskDiagnosticsSchema(),
            durationMs: { type: "integer" },
            timeoutSeconds: { type: "integer" },
            effectiveCommand: effectiveCommandSchema(),
            checks: taskChecksSchema(),
            hostRisk: { type: "string", enum: ["medium"] },
            next: { type: "object", additionalProperties: true },
            unavailableReason: { type: "string" },
            manualRequired: {
              type: "object",
              properties: {
                nextTool: { type: "string", enum: ["manual.gate"] },
                reason: { type: "string", enum: ["external_manual_step"] },
                userInstructions: { type: "string" },
                hostObservation: {
                  type: "object",
                  properties: {
                    toolName: { type: "string" },
                    outputText: { type: "string" },
                  },
                  required: ["toolName", "outputText"],
                  additionalProperties: false,
                },
              },
              required: ["nextTool", "reason", "userInstructions", "hostObservation"],
              additionalProperties: false,
            },
          },
          required: [
            "status",
            "runId",
            "taskId",
            "exitCode",
            "stdout",
            "stderr",
            "diagnostics",
            "durationMs",
            "timeoutSeconds",
            "effectiveCommand",
            "checks",
            "hostRisk",
            "next",
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
    const extraArgs = this.extraArgsForTask(task, args);
    const cwdRelative = toWorkspaceRelative(this.workspaceRoot, cwd) || ".";
    const effectiveCommand: EffectiveCommand = {
      executable: displayExecutable(task.executable),
      args: [...(task.args ?? []), ...extraArgs],
      cwd: cwdRelative,
    };
    const checks = await this.resolveTaskChecks(task, cwd);
    const next = nextForTaskResult(taskId, checks);
    const background = args.mode === "background";
    const store = new TaskLogStore(this.workspaceRoot, this.outputLimits);
    const runId = store.newRunId();
    const stdoutCapture = await store.createCapture(runId, "stdout");
    const stderrCapture = await store.createCapture(runId, "stderr");
    const startedAtIso = new Date(startedAt).toISOString();
    const unavailable = await this.checkAvailability(
      runId,
      taskId,
      task,
      timeoutSeconds,
      startedAt,
      startedAtIso,
      cwd,
      extraArgs,
      effectiveCommand,
      checks,
      next,
      store,
      stdoutCapture,
      stderrCapture,
    );
    if (unavailable) return unavailable;

    const running = background
      ? runningResult({
          runId,
          taskId,
          timeoutSeconds,
          cwd: cwdRelative,
          startedAt: startedAtIso,
          stdoutLogPath: stdoutCapture.logPath,
          stderrLogPath: stderrCapture.logPath,
          effectiveCommand,
          checks,
          next,
        })
      : undefined;
    if (running) await store.writeRecord(running);

    const env = { ...process.env, ...this.policy.env, ...task.env };

    const completion = new Promise<TaskResult>((resolve) => {
      const child = spawn(task.executable, [...(task.args ?? []), ...extraArgs], {
        cwd,
        env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
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
      const finish = async (input: {
        status: TaskResult["status"];
        exitCode: number | null;
        errorMessage?: string;
        unavailableReason?: string;
        manualRequired?: ManualRequired;
      }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        if (input.errorMessage) stderrCapture.write(Buffer.from(input.errorMessage, "utf8"));
        const stdout = await stdoutCapture.finish();
        const stderr = await stderrCapture.finish();
        const diagnostics = parseTaskDiagnostics([stdout, stderr]);
        const result: TaskResult = {
          status: input.status,
          runId,
          taskId,
          exitCode: input.exitCode,
          stdout,
          stderr,
          diagnostics,
          durationMs: Date.now() - startedAt,
          timeoutSeconds,
          effectiveCommand,
          checks,
          hostRisk: "medium",
          next,
          ...(input.unavailableReason ? { unavailableReason: input.unavailableReason } : {}),
          ...(input.manualRequired ? { manualRequired: input.manualRequired } : {}),
        };
        await store.writeRecord(
          recordFromResult(result, cwdRelative, startedAtIso),
        );
        resolve(result);
      };

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutCapture.write(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderrCapture.write(chunk);
      });
      child.on("error", (error: NodeJS.ErrnoException) => {
        this.lastError = error.message;
        void finish({
          status: error.code === "ENOENT" ? "unavailable" : "failed",
          exitCode: null,
          errorMessage: error.message,
          ...(error.code === "ENOENT"
            ? {
                unavailableReason: `Missing executable: ${displayExecutable(task.executable)}`,
                manualRequired: manualRequiredForTask(
                  taskId,
                  `Missing executable: ${displayExecutable(task.executable)}`,
                  task,
                  cwd,
                  this.workspaceRoot,
                  extraArgs,
                ),
              }
            : {}),
        });
      });
      child.on("close", (code) => {
        const failedByStdout = task.failOnStdout === true && stdoutCapture.hasOutput;
        void finish({
          status: timedOut ? "timeout" : code === 0 && !failedByStdout ? "ok" : "failed",
          exitCode: code,
        });
      });
    });
    if (!background) return completion;

    void completion.catch((error) => {
      this.lastError = error instanceof Error ? error.message : String(error);
    });
    return running!;
  }

  private async checkAvailability(
    runId: string,
    taskId: string,
    task: TaskPolicy,
    timeoutSeconds: number,
    startedAt: number,
    startedAtIso: string,
    cwd: string,
    extraArgs: string[],
    effectiveCommand: EffectiveCommand,
    checks: TaskCheck[],
    next: Record<string, unknown>,
    store: TaskLogStore,
    stdoutCapture: Awaited<ReturnType<TaskLogStore["createCapture"]>>,
    stderrCapture: Awaited<ReturnType<TaskLogStore["createCapture"]>>,
  ): Promise<TaskResult | undefined> {
    const failed = checks.find((check) => !check.ok);
    if (failed) {
      return unavailable(
        runId,
        taskId,
        timeoutSeconds,
        startedAt,
        startedAtIso,
        failed.reason ?? "Task resolver check failed",
        task,
        cwd,
        this.workspaceRoot,
        extraArgs,
        effectiveCommand,
        checks,
        next,
        store,
        stdoutCapture,
        stderrCapture,
      );
    }
    return undefined;
  }

  private async resolveTaskChecks(task: TaskPolicy, cwd: string): Promise<TaskCheck[]> {
    const env = { ...process.env, ...this.policy.env, ...task.env };
    const executable = await findExecutable(task.executable, env, this.workspaceRoot);
    const checks: TaskCheck[] = [
      {
        kind: "executable",
        name: displayExecutable(task.executable),
        ok: executable.status !== "missing",
        ...(executable.status === "missing"
          ? { reason: `Missing executable: ${displayExecutable(task.executable)}` }
          : {}),
      },
    ];
    if (task.requiredPackageScript) {
      const packageJson = path.join(cwd, "package.json");
      const stat = await safeLstat(packageJson);
      let ok = false;
      let reason: string | undefined;
      if (!stat?.isFile()) {
        reason = `Missing package.json for script '${task.requiredPackageScript}'`;
      } else {
        try {
          const parsed = JSON.parse(await readFile(packageJson, "utf8")) as any;
          ok = Boolean(
            parsed.scripts &&
              typeof parsed.scripts === "object" &&
              task.requiredPackageScript in parsed.scripts,
          );
          if (!ok) reason = `Missing package script: ${task.requiredPackageScript}`;
        } catch {
          reason = `Cannot read package.json for script '${task.requiredPackageScript}'`;
        }
      }
      checks.push({
        kind: "packageScript",
        name: task.requiredPackageScript,
        ok,
        ...(reason ? { reason } : {}),
      });
    }
    for (const requiredFile of task.requiredFiles ?? []) {
      const absolutePath = path.resolve(cwd, requiredFile);
      let ok = true;
      let reason: string | undefined;
      if (!isInside(this.workspaceRoot, absolutePath)) {
        ok = false;
        reason = `Required file is outside workspace: ${requiredFile}`;
      } else {
        const stat = await safeLstat(absolutePath);
        if (!stat?.isFile()) {
          ok = false;
          reason = `Missing required file: ${requiredFile}`;
        }
      }
      checks.push({
        kind: "requiredFile",
        path: requiredFile,
        ok,
        ...(reason ? { reason } : {}),
      });
    }
    return checks;
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

  private extraArgsForTask(task: TaskPolicy, args: Record<string, unknown>): string[] {
    if (args.extraArgs !== undefined) {
      throw new BadRequestError("extraArgs is not accepted; use typed extra");
    }
    const raw = args.extra;
    if (raw === undefined || raw === null) return [];
    if (!task.allowExtraArgs) throw new BadRequestError("Task does not accept extra");
    if (typeof raw !== "object" || Array.isArray(raw)) {
      throw new BadRequestError("extra must be an object");
    }
    const extra = raw as {
      packages?: unknown;
      modules?: unknown;
      dev?: unknown;
    };
    const rawItems = extra.packages ?? extra.modules ?? [];
    if (!Array.isArray(rawItems)) throw new BadRequestError("extra packages/modules must be an array");
    const items = rawItems.slice();
    if (extra.dev === true) items.unshift("--save-dev");
    if (extra.dev !== undefined && typeof extra.dev !== "boolean") {
      throw new BadRequestError("extra.dev must be boolean");
    }
    const maxArgs = task.maxExtraArgs ?? 20;
    if (items.length > maxArgs) throw new BadRequestError("extra has too many items");
    const pattern = task.extraArgPattern ? new RegExp(task.extraArgPattern) : undefined;
    const allowed = new Set(task.allowedExtraArgs ?? []);
    return items.map((item) => {
      if (typeof item !== "string") throw new BadRequestError("extra items must be string");
      if (item.length === 0 || item.length > 200 || item.includes("\0")) {
        throw new BadRequestError("extra item is invalid");
      }
      if (!allowed.has(item) && pattern && !pattern.test(item)) {
        throw new BadRequestError(`extra item is not allowed: ${item}`);
      }
      if (!allowed.has(item) && !pattern) throw new BadRequestError("extra values are not allowed by pattern");
      return item;
    });
  }
}

function displayExecutable(executable: string): string {
  return executable.includes("/") || executable.includes("\\") ? path.basename(executable) : executable;
}

function nextForTaskResult(taskId: string, checks: TaskCheck[]): Record<string, unknown> {
  if (checks.every((check) => check.ok)) {
    return { tool: "task.result", when: "background", taskId };
  }
  return { tool: "manual.prepare", reason: "resolver_check_failed", taskId };
}

function taskOutputSummarySchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      head: { type: "string" },
      tail: { type: "string" },
      truncated: { type: "boolean" },
      sha256: { type: "string" },
      bytes: { type: "integer" },
      logPath: { type: "string" },
    },
    required: ["head", "tail", "truncated", "sha256", "bytes", "logPath"],
    additionalProperties: false,
  };
}

function taskDiagnosticsSchema(): Record<string, unknown> {
  return {
    type: "array",
    items: {
      type: "object",
      properties: {
        path: { type: "string" },
        line: { type: "integer" },
        column: { type: "integer" },
        message: { type: "string" },
        severity: { type: "string", enum: ["error", "warning", "info"] },
      },
      required: ["path", "line", "message"],
      additionalProperties: false,
    },
  };
}

function effectiveCommandSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      executable: { type: "string" },
      args: { type: "array", items: { type: "string" } },
      cwd: { type: "string" },
    },
    required: ["executable", "args", "cwd"],
    additionalProperties: false,
  };
}

function taskChecksSchema(): Record<string, unknown> {
  return {
    type: "array",
    items: {
      type: "object",
      properties: {
        kind: { type: "string" },
        name: { type: "string" },
        path: { type: "string" },
        ok: { type: "boolean" },
        reason: { type: "string" },
      },
      required: ["kind", "ok"],
      additionalProperties: false,
    },
  };
}

async function safeLstat(filePath: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(filePath);
  } catch (error: any) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

async function unavailable(
  runId: string,
  taskId: string,
  timeoutSeconds: number,
  startedAt: number,
  startedAtIso: string,
  reason: string,
  task: TaskPolicy,
  cwd: string,
  workspaceRoot: string,
  extraArgs: string[],
  effectiveCommand: EffectiveCommand,
  checks: TaskCheck[],
  next: Record<string, unknown>,
  store: TaskLogStore,
  stdoutCapture: Awaited<ReturnType<TaskLogStore["createCapture"]>>,
  stderrCapture: Awaited<ReturnType<TaskLogStore["createCapture"]>>,
): Promise<TaskResult> {
  stderrCapture.write(Buffer.from(`Task unavailable: ${reason}\n`, "utf8"));
  const stdout = await stdoutCapture.finish();
  const stderr = await stderrCapture.finish();
  const result: TaskResult = {
    status: "unavailable",
    runId,
    taskId,
    exitCode: null,
    stdout,
    stderr,
    diagnostics: parseTaskDiagnostics([stdout, stderr]),
    durationMs: Date.now() - startedAt,
    timeoutSeconds,
    effectiveCommand,
    checks,
    hostRisk: "medium",
    next,
    unavailableReason: reason,
    manualRequired: manualRequiredForTask(taskId, reason, task, cwd, workspaceRoot, extraArgs),
  };
  await store.writeRecord(
    recordFromResult(result, toWorkspaceRelative(workspaceRoot, cwd) || ".", startedAtIso),
  );
  return result;
}

function recordFromResult(
  result: TaskResult,
  cwd: string,
  startedAt: string,
): TaskRunRecord {
  return {
    runId: result.runId,
    taskId: result.taskId,
    status: result.status,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    timeoutSeconds: result.timeoutSeconds,
    cwd,
    startedAt,
    completedAt: new Date().toISOString(),
    stdout: result.stdout,
    stderr: result.stderr,
    diagnostics: result.diagnostics,
    effectiveCommand: result.effectiveCommand,
    checks: result.checks,
    hostRisk: result.hostRisk,
    next: result.next,
    ...(result.unavailableReason ? { unavailableReason: result.unavailableReason } : {}),
    ...(result.manualRequired ? { manualRequired: result.manualRequired } : {}),
  };
}

function runningResult(input: {
  runId: string;
  taskId: string;
  timeoutSeconds: number;
  cwd: string;
  startedAt: string;
  stdoutLogPath: string;
  stderrLogPath: string;
  effectiveCommand: EffectiveCommand;
  checks: TaskCheck[];
  next: Record<string, unknown>;
}): TaskRunRecord & TaskResult {
  return {
    runId: input.runId,
    taskId: input.taskId,
    status: "running",
    exitCode: null,
    durationMs: 0,
    timeoutSeconds: input.timeoutSeconds,
    cwd: input.cwd,
    startedAt: input.startedAt,
    stdout: emptySummary(input.stdoutLogPath),
    stderr: emptySummary(input.stderrLogPath),
    diagnostics: [],
    effectiveCommand: input.effectiveCommand,
    checks: input.checks,
    hostRisk: "medium",
    next: input.next,
  };
}

function emptySummary(logPath: string): TaskOutputSummary {
  return {
    head: "",
    tail: "",
    truncated: false,
    sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    bytes: 0,
    logPath,
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
    userInstructions:
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
      `Reply in the next ChatGPT message with /resume ${safeLogName(taskId)} ${logPath}.\n\n` +
      "Do not paste this command, stdout/stderr, or log contents into manual.prepare or manual.gate; the gate call must use only v1 proof fields, optional preparedId, reason, and the low-risk hostObservation.",
    hostObservation: {
      toolName: "capability.limit",
      outputText: "manual step required because configured task is unavailable",
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
