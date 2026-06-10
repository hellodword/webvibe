import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadPolicy } from "../../src/config/loader.js";
import { assertToolInput, validateJsonSchema } from "../../src/policy/engine.js";
import type { RelayPolicy } from "../../src/policy/policy.js";
import { ToolRouter } from "../../src/router/tools-call.js";
import { prepareToolOutput } from "../../src/router/output.js";
import { WEBVIBE_INSTRUCTION_VERSION, webvibeServerInstructions } from "../../src/server/instructions.js";
import { AuditLog } from "../../src/state/audit.js";
import { builtInContracts, contractForTool } from "../../src/tools/contracts/index.js";
import { toolEnvelopeSchema } from "../../src/tools/contracts/schemas.js";
import { UpstreamManager } from "../../src/upstream/manager.js";
import { buildRegistry, type RegisteredTool } from "../../src/upstream/registry.js";

describe("tool contracts", () => {
  it("uses contract schemas for default built-ins and accepts the ChatGPT Web first-call sequence", async () => {
    for (const policyPath of ["policies/read-only.yaml", "policies/dev.yaml"]) {
      const setup = await setupRouter(policyPath);
      try {
        for (const entry of setup.registry.values()) {
          if (entry.policy.type !== "builtIn") continue;
          const contract = contractForTool(entry.policy.name);
          expect(contract, entry.policy.name).toBeTruthy();
          expect(entry.descriptor.inputSchema).toEqual(contract!.inputSchema);
          expect(entry.descriptor.outputSchema).toEqual(contract!.outputSchema);
          for (const example of contract!.examples) {
            validateJsonSchema(contract!.inputSchema, example.args, `example.${entry.policy.name}`);
          }
        }

        const caller = { clientId: `contract-${setup.policy.mode}` };
        await expect(setup.router.call("workspace.context", {}, caller)).resolves.toMatchObject({
          ok: true,
          data: {
            toolSurface: { version: "5.0.0" },
          },
        });

        const calls: Array<[string, Record<string, unknown>]> = [
          [
            "workspace.scan",
            {
              maxEntries: 5000,
              maxDepth: 6,
              includeManifests: true,
              includeTaskFiles: true,
              includeConfigFiles: true,
              includeScripts: true,
            },
          ],
          ["fs.tree", { path: ".", maxDepth: 3 }],
          [
            "fs.read_many",
            {
              paths: [
                "README.md",
                "package.json",
                "docs/architecture.md",
                "docs/chatgpt-web-workflow.md",
                "docs/chatgpt-web-known-limits.md",
                "docs/policy.md",
                "docs/security.md",
                "src/server/instructions.ts",
              ],
              maxBytes: 60000,
            },
          ],
          ["git.status", {}],
          ["fs.manifest", { paths: ["package.json"] }],
        ];

        for (const [tool, args] of calls) {
          const result = await setup.router.call(tool, args, caller);
          validateJsonSchema(toolEnvelopeSchema(), result, `envelope.${tool}`);
          expect(JSON.stringify(result)).not.toContain("input.maxEntries is not allowed");
          expect(JSON.stringify(result)).not.toContain("input.maxDepth is not allowed");
          expect(JSON.stringify(result)).not.toContain("input.files is required");
          expect(JSON.stringify(result)).not.toContain("output.command must be array");
          expect(JSON.stringify(result)).not.toContain("output.status is required");
        }
      } finally {
        await setup.upstreams.close();
      }
    }
  });

  it("rejects drifted inputs and returns structured unavailable for unknown task.run", async () => {
    const setup = await setupRouter("policies/dev.yaml");
    try {
      const byName = new Map(setup.policy.tools.map((tool) => [tool.name, tool]));
      const invalid: Array<[string, Record<string, unknown>, string]> = [
        ["workspace.scan", { maxFiles: 1 }, "input.maxFiles is not allowed"],
        ["fs.tree", { path: ".", depth: 3 }, "input.depth is not allowed"],
        ["fs.search", { query: "x", glob: "src/**" }, "input.glob is not allowed"],
        ["fs.read", { path: "README.md", offsetBytes: 1 }, "input.offsetBytes is not allowed"],
        ["fs.read_many", { paths: ["README.md"], offsetBytes: 1 }, "input.offsetBytes is not allowed"],
        ["fs.stat", {}, "input.path is required"],
        ["file.change_preview", { previewHash: `sha256:${"0".repeat(64)}`, changes: [{ op: "mkdir", path: "x" }] }, "input.previewHash is not allowed"],
        ["file.change_apply", { changes: [{ op: "mkdir", path: "x" }] }, "input.previewHash is required"],
        [
          "manual.gate",
          {
            command: "npm test",
            reason: "external_manual_step",
            manualFormatVersion: "WEBVIBE_MANUAL_REQUIRED v1",
            manualMessageHash: `sha256:${"0".repeat(64)}`,
            operation: { id: "manual-test", kind: "task" },
          },
          "input.command is not allowed",
        ],
      ];

      for (const [tool, args, message] of invalid) {
        expect(() => assertToolInput(byName.get(tool)!, args), tool).toThrow(message);
      }

      const caller = { clientId: "contract-negative" };
      await setup.router.call("workspace.context", {}, caller);
      await expect(
        setup.router.call("task.run", { taskId: "definitely-not-a-task" }, caller),
      ).resolves.toMatchObject({
        ok: false,
        status: "unavailable",
        data: {
          status: "unavailable",
          taskId: "definitely-not-a-task",
          unavailableReason: "Task id is not configured by policy",
        },
      });
      await expect(setup.router.call("fs.read", { path: "../outside" }, caller)).rejects.toThrow("outside workspace");
      await expect(setup.router.call("fs.read", { path: ".git/config" }, caller)).rejects.toThrow("protected");
    } finally {
      await setup.upstreams.close();
    }
  });

  it("keeps generated docs and instructions examples valid", async () => {
    expect(WEBVIBE_INSTRUCTION_VERSION).toBe("5.0.0");
    const snapshot = JSON.parse(await readFile("docs/generated/tool-contracts.json", "utf8"));
    expect(snapshot.tools).toEqual(builtInContracts());

    const docs = await readFile("docs/tools.md", "utf8");
    for (const [tool, args] of fencedExamples(`${docs}\n${webvibeServerInstructions}`)) {
      const contract = contractForTool(tool);
      expect(contract, tool).toBeTruthy();
      validateJsonSchema(contract!.inputSchema, args, `doc.${tool}`);
    }

    const prepared = prepareToolOutput({ status: "ok", hostRisk: "low" }, 60000);
    validateJsonSchema(toolEnvelopeSchema(), prepared, "preparedEnvelope");
  });
});

async function setupRouter(policyPath: string): Promise<{
  policy: RelayPolicy;
  upstreams: UpstreamManager;
  registry: Map<string, RegisteredTool>;
  router: ToolRouter;
}> {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "webvibe-contract-state-"));
  const workspaceRoot = process.cwd();
  const policy = await loadPolicy(policyPath, { workspaceRoot, stateDir });
  const upstreams = new UpstreamManager(policy, workspaceRoot);
  await upstreams.connectAll();
  const registry = buildRegistry(policy, upstreams);
  return {
    policy,
    upstreams,
    registry,
    router: new ToolRouter({
      registry,
      policy,
      upstreams,
      audit: new AuditLog(path.join(stateDir, "audit.log"), policy.audit),
      workspaceRoot,
      stateDir,
      publicBaseUrl: "http://localhost",
    }),
  };
}

function fencedExamples(text: string): Array<[string, Record<string, unknown>]> {
  const examples: Array<[string, Record<string, unknown>]> = [];
  const pattern = /```json[^\n]*\btool=([^\s]+)[^\n]*\n([\s\S]*?)```/g;
  for (const match of text.matchAll(pattern)) {
    const parsed = JSON.parse(match[2]) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      examples.push([match[1], parsed as Record<string, unknown>]);
    }
  }
  return examples;
}
