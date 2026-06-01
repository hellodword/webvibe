import readline from "node:readline";

const tools = [
  {
    name: "read",
    description: "Read fake file",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "edit",
    description: "Edit fake file",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        edits: { type: "array" },
        dryRun: { type: "boolean" },
      },
      required: ["path", "edits", "dryRun"],
      additionalProperties: true,
    },
  },
  {
    name: "run",
    description: "Run fake task",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        timeout_ms: { type: "integer" },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
];

const rl = readline.createInterface({ input: process.stdin });

rl.on("line", (line) => {
  if (!line.trim()) return;
  const request = JSON.parse(line);
  if (!("id" in request)) return;
  try {
    const result = handle(request.method, request.params ?? {});
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`);
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
      })}\n`,
    );
  }
});

function handle(method, params) {
  if (method === "initialize") {
    return {
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "fake" },
    };
  }
  if (method === "tools/list") return { tools };
  if (method === "tools/call") {
    if (params.name === "read")
      return { content: [{ type: "text", text: `read:${params.arguments.path}` }] };
    if (params.name === "edit")
      return { ok: true, applied: !params.arguments.dryRun, args: params.arguments };
    if (params.name === "run")
      return { ok: true, command: params.arguments.command, timeout: params.arguments.timeout_ms };
  }
  throw new Error(`Unsupported method: ${method}`);
}
