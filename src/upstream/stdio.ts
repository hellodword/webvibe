import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

import type { UpstreamClient, UpstreamHealth } from "./client.js";
import type { UpstreamPolicy } from "../policy/policy.js";
import { WEBVIBE_SERVER_NAME, WEBVIBE_SERVER_VERSION } from "../server/version.js";
import { TimeoutError, toError } from "../util/errors.js";
import type { JsonRpcRequest, JsonRpcResponse } from "../util/json-rpc.js";
import { failure } from "../util/json-rpc.js";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export class StdioUpstreamClient implements UpstreamClient {
  private child?: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private healthy = false;
  private lastError?: string;
  private stderrTail = "";

  constructor(
    readonly id: string,
    private readonly policy: UpstreamPolicy,
    private readonly workspaceRoot: string,
  ) {}

  get optional(): boolean {
    return this.policy.optional === true;
  }

  async initialize(): Promise<void> {
    if (!this.policy.command) throw new Error(`Missing command for upstream '${this.id}'`);
    this.child = spawn(this.policy.command, this.policy.args ?? [], {
      cwd: this.policy.cwd ?? this.workspaceRoot,
      env: { ...process.env, ...this.policy.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.on("error", (error) => {
      this.lastError = error.message;
      this.rejectAll(error);
    });
    this.child.on("exit", (code, signal) => {
      this.healthy = false;
      const message = `Upstream '${this.id}' exited (${code ?? signal ?? "unknown"})`;
      this.lastError = message;
      this.rejectAll(new Error(message));
    });
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderrTail = `${this.stderrTail}${chunk.toString("utf8")}`.slice(-4000);
    });
    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => this.handleLine(line));
    await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: WEBVIBE_SERVER_NAME, version: WEBVIBE_SERVER_VERSION },
    });
    this.notify("notifications/initialized", {});
    this.healthy = true;
  }

  async listTools(): Promise<any[]> {
    const result = await this.request("tools/list", {});
    return normalizeToolsResult(result);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.request("tools/call", { name, arguments: args });
  }

  async close(): Promise<void> {
    this.rejectAll(new Error("Upstream closed"));
    if (this.child && !this.child.killed) this.child.kill();
  }

  health(): UpstreamHealth {
    return {
      id: this.id,
      healthy: this.healthy,
      optional: this.optional,
      error: this.lastError ?? (this.stderrTail || undefined),
    };
  }

  private request(method: string, params: unknown): Promise<unknown> {
    if (!this.child) throw new Error(`Upstream '${this.id}' is not started`);
    const id = this.nextId++;
    const timeoutMs = this.policy.timeoutMs ?? 30000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new TimeoutError(`Upstream '${this.id}' timed out calling ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  private notify(method: string, params: unknown): void {
    this.child?.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;
    let message: JsonRpcResponse | JsonRpcRequest;
    try {
      message = JSON.parse(line) as JsonRpcResponse | JsonRpcRequest;
    } catch {
      this.lastError = `Invalid JSON from upstream '${this.id}'`;
      return;
    }
    if (!("id" in message) || message.id === undefined || message.id === null) return;
    const pending = this.pending.get(Number(message.id));
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(Number(message.id));
    if ("error" in message) {
      pending.reject(new Error(message.error.message));
    } else if ("result" in message) {
      pending.resolve(message.result);
    } else {
      pending.reject(new Error("Invalid JSON-RPC response from upstream"));
    }
  }

  private rejectAll(error: unknown): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(toError(error));
      this.pending.delete(id);
    }
  }
}

function normalizeToolsResult(result: unknown): any[] {
  if (typeof result === "object" && result !== null && Array.isArray((result as any).tools)) {
    return (result as any).tools;
  }
  if (Array.isArray(result)) return result;
  return [];
}

export function failedToolResponse(message: string): JsonRpcResponse {
  return failure(null, -32000, message);
}
