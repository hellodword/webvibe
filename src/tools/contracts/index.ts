import { changeContracts } from "./change.js";
import { diagnosticsContracts } from "./diagnostics.js";
import { fsContracts } from "./fs.js";
import { gitContracts } from "./git.js";
import { manualContracts } from "./manual.js";
import { taskContracts } from "./task.js";
import type { ToolContract, ToolExample } from "./types.js";
import { workspaceContracts } from "./workspace.js";

const contracts = [
  ...workspaceContracts,
  ...fsContracts,
  ...changeContracts,
  ...manualContracts,
  ...taskContracts,
  ...gitContracts,
  ...diagnosticsContracts,
];

const registry = new Map<string, ToolContract>();
for (const contract of contracts) {
  if (registry.has(contract.name)) {
    throw new Error(`Duplicate tool contract: ${contract.name}`);
  }
  registry.set(contract.name, contract);
}

export function contractForTool(name: string): ToolContract | undefined {
  return registry.get(name);
}

export function builtInContracts(): ToolContract[] {
  return Array.from(registry.values());
}

export function examplesForTool(name: string): ToolExample[] {
  return registry.get(name)?.examples ?? [];
}

export type { ToolContract, ToolExample } from "./types.js";
