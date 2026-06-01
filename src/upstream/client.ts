import type { McpToolDescriptor } from "../descriptor/normalize.js";

export type UpstreamHealth = {
  id: string;
  healthy: boolean;
  optional: boolean;
  error?: string;
};

export type UpstreamClient = {
  readonly id: string;
  readonly optional: boolean;
  initialize(): Promise<void>;
  listTools(): Promise<McpToolDescriptor[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
  health(): UpstreamHealth;
};
