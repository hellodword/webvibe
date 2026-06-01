import type { UpstreamClient, UpstreamHealth } from "./client.js";
import type { McpToolDescriptor } from "../descriptor/normalize.js";
import type { UpstreamPolicy } from "../policy/policy.js";
import { TimeoutError } from "../util/errors.js";

export class StreamableHttpUpstreamClient implements UpstreamClient {
  private healthy = false;
  private lastError?: string;
  private nextId = 1;

  constructor(
    readonly id: string,
    private readonly policy: UpstreamPolicy,
  ) {}

  get optional(): boolean {
    return this.policy.optional === true;
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "webvibe", version: "0.1.0" },
    });
    this.healthy = true;
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    const result = await this.request("tools/list", {});
    if (typeof result === "object" && result !== null && Array.isArray((result as any).tools)) {
      return (result as any).tools;
    }
    return [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.request("tools/call", { name, arguments: args });
  }

  async close(): Promise<void> {}

  health(): UpstreamHealth {
    return { id: this.id, healthy: this.healthy, optional: this.optional, error: this.lastError };
  }

  private async request(method: string, params: unknown): Promise<unknown> {
    if (!this.policy.url) throw new Error(`Missing URL for upstream '${this.id}'`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.policy.timeoutMs ?? 30000);
    try {
      const response = await fetch(this.policy.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          ...this.policy.headers,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: this.nextId++, method, params }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const message = (await response.json()) as any;
      if (message.error) throw new Error(message.error.message);
      return message.result;
    } catch (error: any) {
      this.lastError =
        error?.name === "AbortError" ? "Request timed out" : String(error?.message ?? error);
      if (error?.name === "AbortError") throw new TimeoutError(this.lastError);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
