import { writeFile } from "node:fs/promises";
import path from "node:path";

export async function writeFakePolicy(dir: string): Promise<string> {
  const fake = path.resolve("test/fixtures/fake-upstream.mjs");
  const policyPath = path.join(dir, "policy.yaml");
  await writeFile(
    policyPath,
    `version: 1
mode: dev
workspace:
  root: "\${workspaceRoot}"
  protected:
    - ".env"
upstreams:
  main:
    transport: stdio
    command: "${process.execPath}"
    args:
      - "${fake}"
  missing:
    transport: stdio
    command: "__webvibe_missing_command__"
    optional: true
tools:
  - name: context.get
    type: builtIn
  - name: diagnostics.health
    type: builtIn
  - name: read.files
    type: builtIn
    inputSchema:
      type: object
      properties:
        paths:
          type: array
          minItems: 1
          items:
            type: string
      required: [paths]
      additionalProperties: false
  - name: change.apply
    type: builtIn
    annotations:
      readOnlyHint: false
      destructiveHint: true
      openWorldHint: false
  - name: x.read
    type: passThrough
    upstream: main
    upstreamTool: read
    inputPolicy:
      pathFields: ["path"]
    annotations:
      readOnlyHint: true
      destructiveHint: false
      openWorldHint: false
  - name: x.optional
    type: passThrough
    upstream: missing
    upstreamTool: read
    optional: true
  - name: x.edit_preview
    type: passThrough
    upstream: main
    upstreamTool: edit
    inputPolicy:
      require:
        dryRun: true
      pathFields: ["path"]
    annotations:
      readOnlyHint: false
      destructiveHint: false
      openWorldHint: false
  - name: x.edit_apply
    type: passThrough
    upstream: main
    upstreamTool: edit
    inputPolicy:
      require:
        dryRun: false
      pathFields: ["path"]
    annotations:
      readOnlyHint: false
      destructiveHint: true
      openWorldHint: false
  - name: x.run
    type: workflow
    optional: true
    description: Run fake workflow
    inputSchema:
      type: object
      properties:
        timeoutSeconds:
          type: integer
      additionalProperties: false
    steps:
      - call:
          upstream: main
          tool: run
          input:
            command: "npm test"
            timeout_ms: "\${coalesce(input.timeoutSeconds, 5) * 1000}"
  - name: x.slow
    type: workflow
    description: Run slow fake workflow
    inputSchema:
      type: object
      properties:
        delayMs:
          type: integer
      required: ["delayMs"]
      additionalProperties: false
    timeoutSeconds:
      default: 1
      maximum: 1
    steps:
      - call:
          upstream: main
          tool: slow
          input:
            delayMs: "\${input.delayMs}"
limits:
  maxToolOutputBytes: 60000
  timeoutMs: 30000
audit:
  enabled: true
  maxLogBytes: 10485760
  payloads: full-redacted
  includeClientVisibleOutput: true
  includeRawToolOutput: true
  includeErrors: true
  includeErrorStack: true
  includeManualEvents: true
  redact: true
`,
  );
  return policyPath;
}
