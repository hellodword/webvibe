import type { UpstreamClient, UpstreamHealth } from "./client.js";
import { LocalTaskRunnerClient } from "./local-task-runner.js";
import { StdioUpstreamClient } from "./stdio.js";
import { StreamableHttpUpstreamClient } from "./streamable-http.js";
import type { McpToolDescriptor } from "../descriptor/normalize.js";
import type { RelayPolicy, UpstreamPolicy } from "../policy/policy.js";

export class UpstreamManager {
  private clients = new Map<string, UpstreamClient>();
  private descriptors = new Map<string, McpToolDescriptor[]>();
  private unavailable = new Map<string, UpstreamHealth>();

  constructor(
    private readonly policy: RelayPolicy,
    private readonly workspaceRoot: string,
  ) {}

  async connectAll(): Promise<void> {
    for (const [id, upstream] of Object.entries(this.policy.upstreams)) {
      const client = this.createClient(id, upstream);
      try {
        await client.initialize();
        this.clients.set(id, client);
        this.descriptors.set(id, await client.listTools());
      } catch (error: any) {
        await client.close().catch(() => {});
        const health = {
          id,
          healthy: false,
          optional: upstream.optional === true,
          error: String(error?.message ?? error),
        };
        this.unavailable.set(id, health);
        if (!upstream.optional) throw error;
      }
    }
  }

  listHealth(): UpstreamHealth[] {
    return [
      ...Array.from(this.clients.values()).map((client) => client.health()),
      ...Array.from(this.unavailable.values()),
    ];
  }

  isAvailable(id: string): boolean {
    return this.clients.has(id);
  }

  getToolDescriptor(upstreamId: string, toolName: string): McpToolDescriptor | undefined {
    return this.descriptors.get(upstreamId)?.find((tool) => tool.name === toolName);
  }

  listToolDescriptors(upstreamId: string): McpToolDescriptor[] {
    return this.descriptors.get(upstreamId) ?? [];
  }

  async call(
    upstreamId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const client = this.clients.get(upstreamId);
    if (!client) throw new Error(`Upstream '${upstreamId}' is unavailable`);
    return client.callTool(toolName, args);
  }

  async close(): Promise<void> {
    await Promise.all(Array.from(this.clients.values()).map((client) => client.close()));
  }

  private createClient(id: string, upstream: UpstreamPolicy): UpstreamClient {
    if (upstream.transport === "local-task-runner")
      return new LocalTaskRunnerClient(id, upstream, this.workspaceRoot);
    if (upstream.transport === "stdio")
      return new StdioUpstreamClient(id, upstream, this.workspaceRoot);
    return new StreamableHttpUpstreamClient(id, upstream);
  }
}
