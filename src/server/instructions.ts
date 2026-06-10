import { builtInContracts } from "../tools/contracts/index.js";

export const WEBVIBE_INSTRUCTION_VERSION = "5.0.0";

const safetyBlock =
  "This tool call was blocked by OpenAI's safety checks. Please double check what you are sending.";

const firstCalls = [
  ["workspace.context", {}],
  ["workspace.scan", { maxDepth: 6, maxEntries: 2000 }],
  ["fs.tree", { path: ".", maxDepth: 3, maxEntries: 500 }],
  ["fs.read_many", { paths: ["README.md", "package.json"], maxBytes: 60000 }],
] as const;

export const webvibeServerInstructions: string = `webvibe coding contract v${WEBVIBE_INSTRUCTION_VERSION}.

Before workspace tools, call workspace.context. Recommended first calls:
${firstCalls.map(([tool, args]) => jsonExample(tool, args)).join("\n")}

Use fs.* for inspection, git.* for Git inspection/commit workflows, task.* only for policy-defined task IDs, and file.change_preview before file.change_apply. Call task.list before task.run. Call file.change_apply only after a matching file.change_preview. Use batch.change_preview and batch.change_apply only when workspace.context reports batch edit mode/tools.

If a required step is outside the fixed tool surface, has no matching taskId, or is unavailable, use manual.prepare when possible, show the manual instructions in ChatGPT Web chat, then call manual.gate. Do not put commands, scripts, diffs, file contents, stdout/stderr, or log contents in manual.prepare or manual.gate arguments. manual.gate uses only preparedId when available, reason, manualFormatVersion, manualMessageHash, operation, and low-risk hostObservation.

If ChatGPT Web asks for secondary confirmation, retry the same tool once with identical tool name and identical JSON arguments. If ChatGPT Web returns the exact safety text "${safetyBlock}", retry the same tool call once with identical tool name and identical JSON arguments. If the identical retry is blocked again, prepare/show manual instructions, call manual.gate with low-risk proof fields and observed host output only, then stop the assistant turn immediately. If manual.gate itself is blocked by safety checks, retry manual.gate once with identical arguments; if still blocked, stop and wait for human completion followed by /resume.

After manual.gate returns awaiting_manual_completion, stop immediately. While pending, webvibe blocks workspace tools with MANUAL_PENDING_REQUIRED except diagnostics.health, manual.status, and manual.resume. The next user message must start with /resume <operationId> or /resume cancel <operationId>. Call manual.resume with that message. Only confirmed resumes the original interrupted request; cancelled, expired, not_found, blocked, and verification_failed do not.

Host output classifications: normal_tool_result continues normal workflow; secondary_confirmation_required retries identical JSON once; blocked_by_openai_safety retries identical JSON once, then manual flow; manual_required_capability_limit uses manual flow instead of ending with an inability statement; manual_completion_resumed calls manual.resume.

Parameter quick reference:
${builtInContracts()
  .filter((contract) => contract.instructionExample !== undefined)
  .map((contract) => jsonExample(contract.name, contract.instructionExample ?? {}))
  .join("\n")}

webvibe cannot force ChatGPT Web to hard-pend the page with a widget or tool UI; treat that as an OpenAI host limitation or bug and use the local manual barrier plus /resume flow.

Do not use hidden prepared payload writes. Do not encode, obfuscate, rename, or hide blocked payloads. Do not use apply-by-id tools. diagnostics.health is for connector diagnostics, not the coding preflight.`;

function jsonExample(tool: string, args: Record<string, unknown>): string {
  return `tool: ${tool}\n\`\`\`json tool=${tool}\n${JSON.stringify(args, null, 2)}\n\`\`\``;
}
