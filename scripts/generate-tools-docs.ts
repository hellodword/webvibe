import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { builtInContracts } from "../src/tools/contracts/index.js";

const root = process.cwd();
const generatedDir = path.join(root, "docs", "generated");
const contractsPath = path.join(generatedDir, "tool-contracts.json");
const docsPath = path.join(root, "docs", "tools.md");

const contracts = builtInContracts();

await mkdir(generatedDir, { recursive: true });
await writeFile(
  contractsPath,
  `${JSON.stringify(
    {
      generatedBy: "npm run generate:tools",
      contractVersion: "5.0.0",
      tools: contracts,
    },
    null,
    2,
  )}\n`,
);
await writeFile(docsPath, renderToolsMarkdown());

function renderToolsMarkdown(): string {
  const lines = [
    "# Tool Contracts",
    "",
    "Generated from `src/tools/contracts`. Do not hand-edit tool schemas here; run `npm run generate:tools`.",
    "",
    "Recommended first calls:",
    "",
    exampleBlock("workspace.context", {}),
    exampleBlock("workspace.scan", { maxDepth: 6, maxEntries: 2000 }),
    exampleBlock("fs.tree", { path: ".", maxDepth: 3, maxEntries: 500 }),
    exampleBlock("fs.read_many", { paths: ["README.md", "package.json"], maxBytes: 60000 }),
    "",
  ];

  for (const contract of contracts) {
    lines.push(`## ${contract.name}`);
    lines.push("");
    lines.push(contract.docsSummary);
    lines.push("");
    lines.push(`Modes: ${contract.modes.join(", ")}`);
    lines.push(`Risk: ${contract.risk}`);
    lines.push("");
    lines.push("Input schema:");
    lines.push("");
    lines.push(fencedJson(contract.inputSchema));
    lines.push("");
    lines.push("Output schema:");
    lines.push("");
    lines.push(fencedJson(contract.outputSchema));
    lines.push("");
    if (contract.examples.length > 0) {
      lines.push("Examples:");
      lines.push("");
      for (const example of contract.examples) {
        lines.push(`- ${example.name}`);
        lines.push(exampleBlock(contract.name, example.args));
      }
      lines.push("");
    }
  }

  return `${lines.join("\n")}\n`;
}

function exampleBlock(tool: string, args: Record<string, unknown>): string {
  return `tool: ${tool}\n${fencedJson(args, tool)}`;
}

function fencedJson(value: unknown, tool?: string): string {
  const suffix = tool ? ` tool=${tool}` : "";
  return `\`\`\`json${suffix}\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}
