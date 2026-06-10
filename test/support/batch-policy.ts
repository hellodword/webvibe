import type { RelayPolicy, ToolPolicy } from "../../src/policy/policy.js";

export function enableBatchTools(policy: RelayPolicy): void {
  policy.editMode = { mode: "batch", batch: { enabled: true } };
  const preview = cloneTool(policy.tools.find((tool) => tool.name === "file.change_preview"));
  const apply = cloneTool(policy.tools.find((tool) => tool.name === "file.change_apply"));
  preview.name = "batch.change_preview";
  preview.description = "Validate and diff a batch of workspace file changes.";
  apply.name = "batch.change_apply";
  apply.description = "Apply a batch of workspace file changes after preview.";
  loosenChangeBatchLimit(preview.inputSchema);
  loosenChangeBatchLimit(apply.inputSchema);
  policy.tools.push(preview, apply);
}

function cloneTool(tool: ToolPolicy | undefined): ToolPolicy {
  if (!tool) throw new Error("missing tool to clone");
  return JSON.parse(JSON.stringify(tool)) as ToolPolicy;
}

function loosenChangeBatchLimit(schema: unknown): void {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) return;
  const changes = (schema as any).properties?.changes;
  if (typeof changes === "object" && changes !== null && !Array.isArray(changes)) {
    changes.maxItems = 100;
  }
}
